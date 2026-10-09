// Rosie factories for the objects tests build. Faker fills only free values (amounts, concepts,
// texts, generated ids); every bank-known id comes from world.ts, because the real bank validates
// it. Faker is seeded once per run in tests/setup.ts, so a failing build reproduces with TEST_SEED.
// Assert against the object a factory returned, never against a literal Faker could change.
import { Factory } from 'rosie';
import { faker } from '@faker-js/faker';
import { appDb } from '../../src/db';
import type { IntentRow, NewIntent } from '../../src/persistence/intents';
import type {
  Chunk,
  DocumentRecord,
  SearchResult,
  ToolContext,
  TransferInput,
} from '../../src/types';
import type { NewConversation } from '../../src/persistence/conversations';
import type { NewMessage } from '../../src/persistence/messages';
import type { NewRun } from '../../src/persistence/runs';
import type { NewApproval } from '../../src/persistence/approvals';
import type { NewIncident } from '../../src/persistence/incidents';
import type { NewEvent } from '../../src/persistence/events';
import { accounts, conversations, customers, money } from './world';

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
  .attr('createdAt', () => new Date().toISOString());

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
});

/** Builds an intent and stores it, as transferMoney does before it dispatches to the bank. */
export function persistIntent(attributes: Partial<Intent> = {}): Intent {
  const intent = intentFactory.build(attributes);
  // Raw SQL on purpose: the harness is an oracle and never calls src/persistence (tests/AGENTS.md).
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

// Rows the app repositories store (src/persistence/*), in camelCase. Ids of app-only records are
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
  .attr('runId', () => `run-${faker.string.uuid()}`);

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
  .attr('expiresAt', () => new Date(Date.now() + 60_000).toISOString());

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
