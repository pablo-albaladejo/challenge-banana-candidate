import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { faker } from '@faker-js/faker';
import { support, wireSupport } from '../../entry-points/dependencies';
import { conversations as conversationsApp } from '../../../conversations';
import { seedApp } from '../../../server/seed';
import { httpStatusOf } from '../../../platform/http/errors';
import { config } from '../../../platform/config';
import { transfer } from '../../../platform/bank/bank';
import { resetBank, startBank, stopBank } from '../../../../tests/support/bank';
import { events, intentRow } from '../../../../tests/support/db';
import { fixedClock, sequentialIds } from '../../../../tests/support/clock';
import { messageFactory, persistIntent } from '../../../../tests/fixtures/factories';
import { MUST_NOT } from '../../../../tests/fixtures/case-brief-golden';
import {
  cases,
  conversations,
  customers,
  historicTransfer,
  operators,
  unknown,
  unlinkedTransfer,
} from '../../../../tests/fixtures/world';
import type { CaseBrief } from '../../domain/case-brief';

const brief = (incidentId: string, operatorId: string = operators.marta) =>
  support().generateCaseBrief({ operatorId, incidentId });
const rejectsWith = (status: number) => (e: unknown) => {
  assert.equal(httpStatusOf(e), status);
  return true;
};
/** Each claim's quote with its verdict and reason. */
const judged = (b: CaseBrief) =>
  b.verdicts.map((v) => [b.claims.find((c) => c.id === v.claimId)?.kind, v.verdict, v.reason]);
const assertNoForbiddenPhrase = (b: CaseBrief) => {
  const reply = b.templateReply!.toLowerCase();
  for (const phrase of MUST_NOT[b.incidentId])
    assert.ok(!reply.includes(phrase.toLowerCase()), phrase);
};

/**
 * A fresh case of lucia's: a conversation started now in which the assistant said `said`, and an
 * intent of that conversation stored with `status`, whose transfer the bank booked.
 */
async function caseWithBookedIntent(status: 'processing' | 'unknown', said: string) {
  const { id: conversationId } = conversationsApp().startConversation({ userId: customers.lucia });
  conversationsApp().appendMessage(
    messageFactory.build({ conversationId, role: 'assistant', content: said, runId: null }),
  );
  const { incidentId } = support().requestHuman({
    userId: customers.lucia,
    conversationId,
    summary: 'Please check my transfer.',
  });
  const longAgo = new Date(Date.now() - 3600_000).toISOString();
  const intent = persistIntent({
    conversationId,
    status,
    bankReference: `ref-${faker.string.uuid()}`,
    createdAt: longAgo,
    dispatchedAt: longAgo,
  });
  await transfer(customers.lucia, intent.payload, intent.bankReference!);
  return { incidentId, intent };
}

describe('generateCaseBrief', () => {
  before(startBank);
  after(stopBank);
  beforeEach(async () => {
    seedApp();
    await resetBank();
  });

  describe('on the pinned seeded cases', () => {
    it('should contradict the failure lucia was told about and flag the retry advice', async () => {
      // Arrange
      const incidentId = cases.lucia;
      // Act
      const b = await brief(incidentId);
      // Assert
      assert.deepEqual(judged(b), [
        ['operation_status', 'contradicted', 'contradicted_by_operation'],
      ]);
      assert.deepEqual(
        b.findings.map((f) => f.kind),
        ['retry_advice', 'false_status_claim', 'missing_agent_activity'],
      );
      assert.deepEqual(
        b.procedures.map((p) => p.citation),
        ['[procedure-3 v2]', '[procedure-8 v2]', '[procedure-10 v2]'],
      );
      const verdict = b.verdicts[0];
      const fact = b.facts.find(
        (f) => verdict.verdict === 'contradicted' && f.id === verdict.correctFactId,
      );
      assert.equal(fact?.value, 'completed');
      assert.deepEqual(
        fact?.evidence.map((e) => e.id),
        [historicTransfer.intentId, historicTransfer.operationId],
      );
      assert.match(
        b.templateReply!,
        /Correction: The bank completed your transfer of EUR 85\.00 to Bruno Vidal/,
      );
      assert.match(b.templateReply!, /Please do not send this payment again/);
      assertNoForbiddenPhrase(b);
    });

    it('should verify the completion elena was told about and flag the transfer no intent holds', async () => {
      // Arrange
      const incidentId = cases.elena;
      // Act
      const b = await brief(incidentId);
      // Assert
      assert.deepEqual(judged(b), [['operation_status', 'verified', 'matches_operation']]);
      assert.deepEqual(b.findings[0], {
        kind: 'unlinked_operation',
        operationId: unlinkedTransfer.operationId,
      });
      assert.equal(b.procedures[0].citation, '[procedure-1 v2]');
      assert.ok(
        b.facts.some((f) => f.kind === 'reference' && f.value === unlinkedTransfer.reference),
      );
      assertNoForbiddenPhrase(b);
    });

    it('should leave the failure diego was told about unverifiable when nothing was sent', async () => {
      // Arrange
      const incidentId = cases.diego;
      // Act
      const b = await brief(incidentId);
      // Assert
      assert.deepEqual(judged(b), [['operation_status', 'unverifiable', 'no_subject_found']]);
      assert.deepEqual(
        b.procedures.map((p) => p.citation),
        ['[procedure-10 v2]'],
      );
      assert.ok(!b.facts.some((f) => f.kind === 'status'));
      assert.match(b.templateReply!, /We are still confirming some details/);
      assertNoForbiddenPhrase(b);
    });

    it('should state the Aurora fee, its waiver and the salary carla received on the deterministic path', async () => {
      // Arrange
      const incidentId = cases.carla;
      // Act
      const b = await brief(incidentId);
      // Assert
      assert.deepEqual(judged(b), [['amount', 'unverifiable', 'no_subject_found']]);
      assert.equal(b.procedures[0].citation, '[procedure-10 v2]');
      const values = b.facts.map((f) => f.value);
      for (const value of ['EUR 1,750.00', 'EUR 6.00', 'EUR 1,200.00'])
        assert.ok(values.includes(value), value);
      assertNoForbiddenPhrase(b);
    });

    it('should state that the referral reward ines was told about is not published on the deterministic path', async () => {
      // Arrange
      const incidentId = cases.ines;
      // Act
      const b = await brief(incidentId);
      // Assert
      assert.deepEqual(judged(b), [['amount', 'unverifiable', 'no_subject_found']]);
      assert.equal(b.procedures[0].citation, '[procedure-10 v2]');
      assert.ok(
        b.facts.some(
          (f) => f.statement === "Banana Bank's documentation does not specify referral rewards.",
        ),
      );
      assertNoForbiddenPhrase(b);
    });
  });

  it('should take the deterministic path with no model prose', async () => {
    // Arrange
    const incidentId = cases.lucia;
    // Act
    const b = await brief(incidentId);
    // Assert
    assert.equal(b.mode, 'degraded');
    assert.equal(b.degradedReason, null);
    assert.equal(b.prose, null);
    assert.ok(b.claims.every((c) => c.extractedBy === 'regex'));
  });

  it('should show an unreachable bank as a gap and verify nothing that needs it', async () => {
    // Arrange
    const original = config.bankUrl;
    config.bankUrl = 'http://127.0.0.1:9';
    // Act
    let b: CaseBrief;
    try {
      b = await brief(cases.lucia);
    } finally {
      config.bankUrl = original;
    }
    // Assert
    assert.deepEqual(judged(b), [['operation_status', 'unverifiable', 'bank_unreachable']]);
    assert.ok(b.findings.some((f) => f.kind === 'bank_unreachable'));
    assert.ok(!b.verdicts.some((v) => v.verdict === 'verified'));
    assert.ok(!b.facts.some((f) => f.kind === 'status'));
  });

  it('should settle a stale processing intent with the bank before judging the case', async () => {
    // Arrange
    const { incidentId, intent } = await caseWithBookedIntent(
      'processing',
      'The transfer could not be completed.',
    );
    // Act
    const b = await brief(incidentId);
    // Assert
    assert.equal(intentRow(intent.id)?.status, 'completed');
    assert.deepEqual(judged(b), [
      ['operation_status', 'contradicted', 'contradicted_by_operation'],
    ]);
  });

  it('should contradict a failure claim on a transfer whose response was lost but the bank booked', async () => {
    // Arrange
    const { incidentId } = await caseWithBookedIntent(
      'unknown',
      'The transfer could not be completed.',
    );
    // Act
    const b = await brief(incidentId);
    // Assert
    assert.deepEqual(judged(b), [
      ['operation_status', 'contradicted', 'contradicted_by_operation'],
    ]);
  });

  it('should audit each brief in the case conversation without customer text', async () => {
    // Arrange
    const incidentId = cases.lucia;
    // Act
    const b = await brief(incidentId);
    // Assert
    const audit = events().filter((e) => e.kind === 'case.brief_generated');
    assert.equal(audit.length, 1);
    assert.equal(audit[0].conversation_id, conversations.luciaSupport);
    assert.equal(audit[0].user_id, operators.marta);
    const data = JSON.parse(audit[0].data);
    assert.equal(data.incidentId, incidentId);
    assert.deepEqual(data.verdicts, { 'contradicted:contradicted_by_operation': 1 });
    assert.match(data.evidenceHash, /^[0-9a-f]{64}$/);
    assert.deepEqual(Object.keys(data).sort(), [
      'degradedReason',
      'dropped',
      'evidenceHash',
      'findings',
      'flags',
      'incidentId',
      'mode',
      'procedures',
      'promptVersion',
      'verdicts',
    ]);
    const customerText = [
      ...b.timeline.filter((e) => e.kind === 'message').map((e) => e.label),
      ...b.claims.map((c) => c.quote),
    ];
    assert.ok(customerText.length > 0);
    for (const text of customerText) assert.ok(!audit[0].data.includes(text), text);
    assert.doesNotMatch(audit[0].data, /Bruno|dinner|try again/i);
  });

  it('should keep reporting missing agent activity on a second brief', async () => {
    // Arrange
    await brief(cases.lucia);
    // Act
    const second = await brief(cases.lucia);
    // Assert
    assert.ok(second.findings.some((f) => f.kind === 'missing_agent_activity'));
    assert.ok(!second.timeline.some((e) => e.kind === 'tool'));
  });

  it('should reject customers with 403', async () => {
    // Arrange
    const customer = customers.lucia;
    // Act & Assert
    await assert.rejects(brief(cases.lucia, customer), rejectsWith(403));
  });

  it('should reject unknown people with 403', async () => {
    // Arrange
    const stranger = unknown.person;
    // Act & Assert
    await assert.rejects(brief(cases.lucia, stranger), rejectsWith(403));
  });

  it('should refuse a customer before looking up the case', async () => {
    // Arrange
    const customer = customers.lucia;
    // Act & Assert
    await assert.rejects(brief(unknown.case, customer), rejectsWith(403));
  });

  it('should report an unknown case as 404', async () => {
    // Arrange
    const missing = unknown.case;
    // Act & Assert
    await assert.rejects(brief(missing), rejectsWith(404));
  });

  it('should record no audit event when the operator is refused', async () => {
    // Arrange
    const customer = customers.lucia;
    // Act
    await brief(cases.lucia, customer).catch(() => undefined);
    // Assert
    assert.equal(events().filter((e) => e.kind === 'case.brief_generated').length, 0);
  });
});

describe('generateCaseBrief with a fixed clock', () => {
  before(startBank);
  after(stopBank);
  beforeEach(async () => {
    seedApp();
    await resetBank();
  });

  it('should stamp the brief and its audit event with the clock time and id', async () => {
    // Arrange
    const clock = fixedClock();
    const { generateCaseBrief } = wireSupport({ clock, ids: sequentialIds('brief') });
    // Act
    const b = await generateCaseBrief({ operatorId: operators.marta, incidentId: cases.lucia });
    // Assert
    assert.equal(b.generatedAt, clock.now().toISOString());
    const audit = events().find((e) => e.kind === 'case.brief_generated');
    assert.equal(audit?.id, 'brief-1');
    assert.equal(audit?.created_at, b.generatedAt);
  });
});
