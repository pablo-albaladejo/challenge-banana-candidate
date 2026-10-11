// Rosie factories for the objects tests build. Faker fills only free values (amounts, concepts,
// texts, generated ids); every bank-known id comes from world.ts, because the real bank validates
// it. Faker is seeded once per run in tests/setup.ts, so a failing build reproduces with TEST_SEED.
// Assert against the object a factory returned, never against a literal Faker could change.
import { Factory } from 'rosie';
import { faker } from '@faker-js/faker';
import { appDb } from '../../src/platform/db/db';
import type { IntentRow, NewIntent } from '../../src/transfers/domain/intent';
import type {
  Account,
  Chunk,
  DocumentRecord,
  SearchResult,
  ToolContext,
  TransferInput,
} from '../../src/types';
import type { NewConversation, NewMessage } from '../../src/conversations/domain/conversation';
import type { NewRun } from '../../src/assistant/application/ports/run-repository';
import type { NewApproval } from '../../src/transfers/domain/approval';
import type { NewIncident } from '../../src/support/domain/incident';
import type { NewEvent } from '../../src/platform/telemetry/events.repo';
import type {
  CaseEvidence,
  EvidenceIntent,
  EvidenceMessage,
  WindowOperation,
} from '../../src/support/domain/case-evidence';
import type { Claim, VerifiedFact } from '../../src/support/domain/claims';
import type { ExtractedClaimRow } from '../../src/support/domain/anchoring';
import {
  accounts,
  cases,
  conversations,
  customers,
  historicTransfer,
  money,
} from './world';

const isoDate = () =>
  faker.date.between({ from: '2025-01-01', to: '2026-06-30' }).toISOString().slice(0, 10);
const vector = (dimensions: number) =>
  Array.from({ length: dimensions }, () => faker.number.float({ min: -1, max: 1 }));

/** The server-side identity of one agent run: lucia, outside a conversation, fresh ids. */
export const toolContextFactory = new Factory<ToolContext>()
  .attr('userId', customers.lucia)
  .attr('conversationId', null)
  .attr('runId', () => `run-${faker.string.uuid()}`)
  .attr('intentId', () => `intent-${faker.string.uuid()}`);

/**
 * A valid transfer: lucia's main account to bruno's. The amount stays far below the lowest seeded
 * balance, so a default transfer never fails for funds and several can run in one test.
 */
export const transferInputFactory = new Factory<TransferInput>()
  .attr('fromAccountId', accounts.lucia)
  .attr('toAccountId', accounts.bruno)
  .attr('amountCents', () =>
    faker.number.int({ min: 100, max: Math.floor(money.lowestBalanceCents / 2) }),
  )
  .attr('concept', () => faker.commerce.productName());

/** A bank account of lucia's, as `GET /v1/accounts` lists it; the balance covers any default transfer. */
export const accountFactory = new Factory<Account>()
  .attr('id', accounts.lucia)
  .attr('userId', customers.lucia)
  .attr('label', 'Aurora account')
  .attr('iban', () => faker.finance.iban())
  .attr('balanceCents', () => faker.number.int({ min: money.lowestBalanceCents, max: 500_000 }));

export type IntentStatus =
  | 'requires_confirmation'
  | 'processing'
  | 'completed'
  | 'unknown'
  | 'failed';

/** A row of the app `intents` table, in camelCase. */
export type Intent = {
  id: string;
  userId: string;
  conversationId: string | null;
  runId: string | null;
  payload: TransferInput;
  status: IntentStatus;
  bankReference: string | null;
  operationId: string | null;
  error: string | null;
  createdAt: string;
  /** When the intent entered `processing`; null until then (and on rows older than migration 2). */
  dispatchedAt: string | null;
};

export const intentFactory = new Factory<Intent>()
  .attr('id', () => `intent-${faker.string.uuid()}`)
  .attr('userId', customers.lucia)
  .attr('conversationId', null)
  .attr('runId', () => `run-${faker.string.uuid()}`)
  .attr('payload', () => transferInputFactory.build())
  .attr('status', 'processing')
  .attr('bankReference', null)
  .attr('operationId', null)
  .attr('error', null)
  .attr('createdAt', () => new Date().toISOString())
  .attr('dispatchedAt', null);

/** The intent as the repository stores it: the payload serialised to JSON. */
export const storedIntent = (intent: Intent): NewIntent => ({
  ...intent,
  payload: JSON.stringify(intent.payload),
});

/** The `intents` row the intent reads back as, with its SQLite column names. */
export const intentRowOf = (intent: Intent): IntentRow => ({
  id: intent.id,
  user_id: intent.userId,
  conversation_id: intent.conversationId,
  run_id: intent.runId,
  payload: JSON.stringify(intent.payload),
  status: intent.status,
  bank_reference: intent.bankReference,
  operation_id: intent.operationId,
  error: intent.error,
  created_at: intent.createdAt,
  dispatched_at: intent.dispatchedAt,
});

/** Builds an intent and stores it, as transferMoney does before it dispatches to the bank. */
export function persistIntent(attributes: Partial<Intent> = {}): Intent {
  const intent = intentFactory.build(attributes);
  // Raw SQL on purpose: the harness is an oracle and never calls the app repos (tests/AGENTS.md).
  const row = intentRowOf(intent);
  appDb()
    .prepare(
      `INSERT INTO intents(${Object.keys(row).join(',')}) VALUES(${Object.keys(row).map((k) => `@${k}`).join(',')})`,
    )
    .run(row);
  return intent;
}

/** A retrieved passage, as search returns it and the prompt cites it. */
export const searchResultFactory = new Factory<SearchResult>()
  .attr('id', () => `chunk-${faker.string.hexadecimal({ length: 24, casing: 'lower', prefix: '' })}`)
  .attr('documentId', () => `doc-${faker.string.alphanumeric({ length: 8, casing: 'lower' })}`)
  .attr('text', () => faker.lorem.sentence())
  .attr('title', () => faker.lorem.words(2))
  .attr('version', () => faker.number.int({ min: 1, max: 5 }))
  .attr('validFrom', isoDate)
  .attr('validTo', null)
  .attr('audience', 'public')
  .attr('score', () => faker.number.float({ min: 0, max: 1 }));

/** An indexed chunk. `{ dimensions }` sizes its vector (1536 like the real index by default). */
export const chunkFactory = new Factory<Chunk>()
  .option('dimensions', 1536)
  .attr('id', () => `chunk-${faker.string.hexadecimal({ length: 24, casing: 'lower', prefix: '' })}`)
  .attr('documentId', () => `doc-${faker.string.alphanumeric({ length: 8, casing: 'lower' })}`)
  .attr('text', () => faker.lorem.sentence())
  .attr('title', () => faker.lorem.words(2))
  .attr('version', () => faker.number.int({ min: 1, max: 5 }))
  .attr('validFrom', isoDate)
  .attr('validTo', null)
  .attr('audience', 'public')
  .attr('vector', ['dimensions'], (dimensions: number) => vector(dimensions));

/** A corpus document as the manifest describes it: public, current, stored as Markdown. */
export const documentRecordFactory = new Factory<DocumentRecord>()
  .attr('id', () => `doc-${faker.string.alphanumeric({ length: 8, casing: 'lower' })}`)
  .attr('title', () => faker.lorem.words(3))
  .attr('file', ['id'], (id: string) => `${id}.md`)
  .attr('version', () => faker.number.int({ min: 1, max: 5 }))
  .attr('validFrom', isoDate)
  .attr('validTo', null)
  .attr('audience', 'public')
  .attr('family', () =>
    faker.helpers.arrayElement(['fees', 'conditions', 'operations', 'faq', 'procedure']),
  );

export type EventData = { tool: string; status: string; [key: string]: unknown };

/** The data of a telemetry event about one tool call. */
export const eventDataFactory = new Factory<EventData>()
  .attr('tool', () =>
    faker.helpers.arrayElement([
      'list_accounts',
      'search_documents',
      'transfer_money',
      'operation_status',
      'request_human',
    ]),
  )
  .attr('status', () => faker.helpers.arrayElement(['started', 'completed', 'failed']));

// Rows the app repositories store (src/**/*.repo.ts), in camelCase. Ids of app-only records are
// generated; people and seeded conversations come from world.ts.

/** A new conversation of lucia's, outside the seed. */
export const conversationFactory = new Factory<NewConversation>()
  .attr('id', () => `conv-${faker.string.uuid()}`)
  .attr('userId', customers.lucia)
  .attr('title', () => faker.lorem.words(3))
  .attr('createdAt', () => new Date().toISOString());

/** A customer message in a conversation. Override `conversationId` with a stored conversation. */
export const messageFactory = new Factory<NewMessage>()
  .attr('id', () => `message-${faker.string.uuid()}`)
  .attr('conversationId', conversations.luciaWelcome)
  .attr('role', 'user')
  .attr('content', () => faker.lorem.sentence())
  .attr('createdAt', () => new Date().toISOString())
  .attr('runId', () => `run-${faker.string.uuid()}`)
  .attr('authorId', null);

/** An agent run that just started in lucia's welcome conversation. */
export const runFactory = new Factory<NewRun>()
  .attr('id', () => `run-${faker.string.uuid()}`)
  .attr('userId', customers.lucia)
  .attr('conversationId', conversations.luciaWelcome)
  .attr('startedAt', () => new Date().toISOString())
  .attr('status', 'running')
  .attr('error', null);

/** A live transfer proposal of lucia's, expiring in a minute. */
export const approvalFactory = new Factory<NewApproval>()
  .attr('id', () => `approval-${faker.string.uuid()}`)
  .attr('userId', customers.lucia)
  .attr('intentId', () => `intent-${faker.string.uuid()}`)
  .attr('payload', () => JSON.stringify(transferInputFactory.build()))
  .attr('expiresAt', () => new Date(Date.now() + 60_000).toISOString())
  .attr('checks', () => []);

/** An open support case of lucia's in a conversation outside the seed. */
export const incidentFactory = new Factory<NewIncident>()
  .attr('id', () => `case-${faker.string.uuid()}`)
  .attr('userId', customers.lucia)
  .attr('conversationId', () => `conv-${faker.string.uuid()}`)
  .attr('summary', () => faker.lorem.sentence())
  .attr('status', 'open')
  .attr('createdAt', () => new Date().toISOString());

/** A stored telemetry event about one tool call in lucia's welcome conversation. */
export const eventFactory = new Factory<NewEvent>()
  .attr('id', () => `event-${faker.string.uuid()}`)
  .attr('runId', () => `run-${faker.string.uuid()}`)
  .attr('userId', customers.lucia)
  .attr('conversationId', conversations.luciaWelcome)
  .attr('kind', 'tool.completed')
  .attr('data', () => JSON.stringify(eventDataFactory.build()))
  .attr('createdAt', () => new Date().toISOString());

// What the verified case brief judges (src/support/domain). The defaults are lucia's seeded case:
// the conversation, its messages, the intent stored as failed and the operation the bank booked.

/** A message of lucia's support conversation, at its seeded time. */
export const evidenceMessageFactory = new Factory<EvidenceMessage>()
  .sequence('id', (i) => `message-evidence-${i}`)
  .attr('role', 'assistant')
  .attr('content', () => faker.lorem.sentence())
  .attr('created_at', '2026-09-23T16:40:00.000Z');

/** A transfer intent of lucia's support conversation; by default the historic one, stored as failed. */
export const evidenceIntentFactory = new Factory<EvidenceIntent>()
  .attr('id', historicTransfer.intentId)
  .attr('status', 'failed')
  .attr('bank_reference', historicTransfer.reference)
  .attr('payload', () => ({ ...historicTransfer.payload }))
  .attr('created_at', '2026-09-23T16:41:10.000Z');

/** A bank operation of the case window; by default the historic one, linked to its intent. */
export const windowOperationFactory = new Factory<WindowOperation>()
  .attr('id', historicTransfer.operationId)
  .attr('userId', customers.lucia)
  .attr('reference', historicTransfer.reference)
  .attr('fromAccountId', historicTransfer.fromAccountId)
  .attr('toAccountId', historicTransfer.toAccountId)
  .attr('amountCents', historicTransfer.amountCents)
  .attr('concept', historicTransfer.concept)
  .attr('createdAt', '2026-09-23T16:41:12.000Z')
  .attr('status', 'completed')
  .attr('linkedIntentId', historicTransfer.intentId);

/** Lucía's seeded case as `case-facts` gathers it: the bank reachable, no agent activity recorded. */
export const caseEvidenceFactory = new Factory<CaseEvidence>()
  .attr('incident', () => ({ id: cases.lucia, created_at: '2026-09-23T16:40:00.000Z' }))
  .attr('customer', () => ({ id: customers.lucia, name: 'Lucía Martín' }))
  .attr('conversation', () => ({
    id: conversations.luciaSupport,
    created_at: '2026-09-23T16:40:00.000Z',
  }))
  .attr('messages', () => [
    evidenceMessageFactory.build({
      id: 'message-lucia-1',
      role: 'user',
      content: 'Transfer EUR 85 to Bruno for the team dinner.',
    }),
    evidenceMessageFactory.build({
      id: 'message-lucia-2',
      content: 'I could not complete the transfer. You can try again.',
    }),
  ])
  .attr('events', () => [])
  .attr('intents', () => [evidenceIntentFactory.build()])
  .attr('customerReferences', () => [
    { id: historicTransfer.intentId, bank_reference: historicTransfer.reference },
  ])
  .attr('allOperations', () => [windowOperationFactory.build()])
  .attr('bankFailure', null)
  .attr('accounts', () => [{ id: accounts.lucia, label: 'Aurora account' }])
  .attr('contacts', () => [{ id: accounts.bruno, name: 'Bruno Vidal' }])
  .attr('movements', () => [])
  .attr('previousCases', () => [])
  .attr('caseDate', '2026-09-23');

/** A fact the brief established. Override `kind`, `value` and `statement` with what the case is about. */
export const verifiedFactFactory = new Factory<VerifiedFact>()
  .sequence('id', (i) => `F${i}`)
  .attr('kind', 'amount')
  .attr('value', 'EUR 85.00')
  .attr('statement', 'The bank completed your transfer of EUR 85.00 to Bruno Vidal.')
  .attr('evidence', () => [
    {
      kind: 'operation' as const,
      id: historicTransfer.operationId,
      citation: `${historicTransfer.operationId} (bank)`,
    },
  ]);

type ClaimOf<K extends Claim['kind']> = Extract<Claim, { kind: K }>;
// Hand-built claims stand in for the model extractor's: the oracle judges them on its rules alone.
// Pattern-matched claims come from `regexClaims`, which also decides whether each may be judged.
const claimBase = { messageId: 'message-lucia-2', quote: 'quoted', extractedBy: 'model' as const };

/** A status claim of lucia's assistant message; by default the failure she was told about. */
export const statusClaimFactory = new Factory<ClaimOf<'operation_status'>>()
  .sequence('id', (i) => `message-lucia-2#s${i}`)
  .attrs({ ...claimBase, kind: 'operation_status', status: 'not_completed' })
  .attr('amountCents', null)
  .attr('reference', null);

/** An amount claim of lucia's assistant message. Override `quote` with the sentence it came from. */
export const amountClaimFactory = new Factory<ClaimOf<'amount'>>()
  .sequence('id', (i) => `message-lucia-2#a${i}`)
  .attrs({ ...claimBase, kind: 'amount' })
  .attr('amountCents', historicTransfer.amountCents)
  .attr('reference', null);

/** A policy claim of lucia's assistant message (the model extractor's kind); by default the Aurora fee. */
export const policyClaimFactory = new Factory<ClaimOf<'policy_amount'>>()
  .sequence('id', (i) => `message-lucia-2#p${i}`)
  .attrs({ ...claimBase, kind: 'policy_amount', policy: 'monthly_fee' })
  .attr('product', 'aurora')
  .attr('amountCents', 600);

/**
 * A row as the model extractor returns it (`case_claims`), before anchoring. By default the
 * failure lucia was told about, quoted from her seeded assistant message.
 */
export const extractedClaimRowFactory = new Factory<ExtractedClaimRow>()
  .attr('messageId', 'message-lucia-2')
  .attr('quote', 'I could not complete the transfer.')
  .attr('kind', 'operation_status')
  .attr('amountCents', null)
  .attr('reference', null)
  .attr('status', 'not_completed')
  .attr('policy', null)
  .attr('product', null);
