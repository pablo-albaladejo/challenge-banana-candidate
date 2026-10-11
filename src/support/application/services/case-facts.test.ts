import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { makeCaseFacts } from './case-facts';
import { seedApp } from '../../../server/seed';
import { BankFailure } from '../../../shared/domain/bank-failure';
import { sqliteIncidents } from '../../infrastructure/sqlite-incidents.repo';
import { verifyClaim } from '../../domain/claim-verification';
import { verifiedFacts } from '../../domain/verified-facts';
import type { CaseEventRow } from '../ports/event-reader';
import type { OperatorBank } from '../ports/operator-bank';
import { policyClaimFactory, windowOperationFactory } from '../../../../tests/fixtures/factories';
import { accounts, cases, customers, operators } from '../../../../tests/fixtures/world';

/** Lucía's booked transfer as the bank lists it (no link to an intent yet). */
const bookedOperation = () => {
  const { linkedIntentId, ...operation } = windowOperationFactory.build();
  void linkedIntentId;
  return operation;
};
/** A bank that answers every read for lucia's case; override the reads a case is about. */
const answeringBank = (overrides: Partial<OperatorBank> = {}): OperatorBank => ({
  customer: async () => ({
    accounts: [{ id: accounts.lucia, label: 'Aurora account' }],
    operations: [bookedOperation()],
  }),
  contactsOf: async () => [{ id: accounts.bruno, name: 'Bruno Vidal' }],
  movementsOf: async () => [],
  ...overrides,
});
/** `case-facts` over the seeded cases, with stub ports for everything but the case store. */
const caseFactsWith = (bank: OperatorBank, recorded: CaseEventRow[] = []) =>
  makeCaseFacts({
    people: {
      find: (id) => ({
        id,
        name: id,
        role: id === operators.marta ? 'operator' : 'customer',
        initials: 'XX',
        color: '#000000',
      }),
    },
    incidents: sqliteIncidents,
    history: {
      messagesIn: () => [],
      conversation: (id) => ({ id, created_at: '2026-09-23T16:40:00.000Z' }),
    },
    events: { inConversation: () => recorded },
    transfers: {
      reconcileAndList: async () => [],
      reconcile: async () => undefined,
      customerIntents: () => [],
    },
    bank,
  });
const luciaCase = { operatorId: operators.marta, incidentId: cases.lucia };

describe('makeCaseFacts with stub ports', () => {
  before(() => seedApp());

  it("should read the contacts and movements of the case's customer, never the operator's", async () => {
    // Arrange
    const asked: string[] = [];
    const bank = answeringBank({
      contactsOf: async (id) => (asked.push(`contacts:${id}`), []),
      movementsOf: async (id) => (asked.push(`movements:${id}`), []),
    });
    // Act
    await caseFactsWith(bank)(luciaCase);
    // Assert
    assert.deepEqual(asked.sort(), [`contacts:${customers.lucia}`, `movements:${customers.lucia}`]);
  });

  it('should start every bank read before any of them answers', async () => {
    // Arrange
    const log: string[] = [];
    const later = <T>(name: string, value: T) => {
      log.push(`start:${name}`);
      return new Promise<T>((resolve) =>
        setImmediate(() => {
          log.push(`end:${name}`);
          resolve(value);
        }),
      );
    };
    const bank = answeringBank({
      customer: () => later('customer', { accounts: [], operations: [] }),
      contactsOf: () => later('contacts', []),
      movementsOf: () => later('movements', []),
    });
    // Act
    await caseFactsWith(bank)(luciaCase);
    // Assert
    assert.deepEqual(log.slice(0, 3).sort(), [
      'start:contacts',
      'start:customer',
      'start:movements',
    ]);
  });

  it('should propagate an error that is not a bank failure', async () => {
    // Arrange
    const bank = answeringBank({
      contactsOf: async () => {
        throw new TypeError('contacts adapter broke');
      },
    });
    // Act & Assert
    await assert.rejects(caseFactsWith(bank)(luciaCase), TypeError);
  });

  it('should name the recipient neutrally when only the contacts could not be read', async () => {
    // Arrange
    const bank = answeringBank({
      contactsOf: async () => {
        throw new BankFailure('unreachable', 503, 'Service unavailable');
      },
    });
    // Act
    const { evidence } = await caseFactsWith(bank)(luciaCase);
    // Assert
    assert.equal(evidence.contacts, null);
    assert.equal(evidence.allOperations?.length, 1);
    const { facts } = verifiedFacts(evidence, [], []);
    assert.match(facts[0].statement, /transfer of EUR 85\.00 to the recipient account/);
  });

  it('should say the ledger could not be read when only the movements failed', async () => {
    // Arrange
    const bank = answeringBank({
      movementsOf: async () => {
        throw new BankFailure('unreachable', 503, 'Service unavailable');
      },
    });
    // Act
    const { evidence } = await caseFactsWith(bank)(luciaCase);
    // Assert
    assert.equal(evidence.movements, null);
    assert.notEqual(evidence.allOperations, null);
    const verdict = verifyClaim(policyClaimFactory.build(), evidence);
    assert.equal(verdict.reason, 'conditional_policy');
    assert.match(
      verdict.verdict === 'unverifiable' ? verdict.detail : '',
      /^The ledger could not be read/,
    );
  });

  it('should keep an agent event whose stored data is not JSON, with no data', async () => {
    // Arrange
    const malformed: CaseEventRow = {
      id: 'event-malformed',
      run_id: 'run-1',
      user_id: customers.lucia,
      conversation_id: null,
      kind: 'tool.completed',
      data: '{not json',
      created_at: '2026-09-23T16:41:00.000Z',
    };
    // Act
    const { evidence } = await caseFactsWith(answeringBank(), [malformed])(luciaCase);
    // Assert
    assert.deepEqual(evidence.events, [
      {
        id: 'event-malformed',
        kind: 'tool.completed',
        created_at: '2026-09-23T16:41:00.000Z',
        data: null,
      },
    ]);
  });

  it('should tell a bank that refused the request from one that could not be reached', async () => {
    // Arrange
    const refusing = answeringBank({
      customer: async () => {
        throw new BankFailure('rejected', 403, 'Forbidden');
      },
    });
    const down = answeringBank({
      customer: async () => {
        throw new BankFailure('unreachable', 503, 'Service unavailable');
      },
    });
    // Act
    const refused = (await caseFactsWith(refusing)(luciaCase)).evidence;
    const unreachable = (await caseFactsWith(down)(luciaCase)).evidence;
    // Assert
    assert.deepEqual([refused.allOperations, refused.bankFailure], [null, 'refused']);
    assert.deepEqual([unreachable.allOperations, unreachable.bankFailure], [null, 'unreachable']);
  });
});
