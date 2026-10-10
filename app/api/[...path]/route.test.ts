import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { faker } from '@faker-js/faker';
import { GET, POST } from './route';
import { seedApp } from '../../../src/seed';
import { appDb } from '../../../src/db';
import { sessionToken } from '../../../src/auth';
import { documents } from '../../../src/ingestion/pipeline';
import { api } from '../../../tests/support/api';
import {
  balanceOf,
  bankSnapshot,
  operationsFor,
  resetBank,
  startBank,
  stopBank,
} from '../../../tests/support/bank';
import { reply, startFakeOpenAI, type FakeOpenAI } from '../../../tests/support/openai';
import { startLossyBank } from '../../../tests/support/network';
import { approvalsFor, intentRow } from '../../../tests/support/db';
import {
  persistIntent,
  searchResultFactory,
  transferInputFactory,
} from '../../../tests/fixtures/factories';
import {
  accounts,
  conversations,
  counts,
  customers,
  historicTransfer,
  operators,
  unknown,
} from '../../../tests/fixtures/world';
import type { TransferInput } from '../../../src/types';

/** Exact text of the first chunk of a document, so search ranks it without a model call. */
async function chunkText(documentId: string) {
  const chunks = await api('GET', `documents/${documentId}/chunks`, { as: operators.marta });
  return chunks.body[0].text as string;
}

const publicDocumentId = () => documents().find((d) => d.audience === 'public')!.id;
const internalDocumentId = () => documents().find((d) => d.audience === 'internal')!.id;

describe('POST /api/search', () => {
  beforeEach(() => seedApp());

  it('should return actionable configuration guidance when the API key is missing', async () => {
    // Arrange
    process.env.OPENAI_API_KEY = '';
    const request = new Request('http://localhost/api/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie: `banana_actor=${sessionToken(customers.lucia)}`,
      },
      body: JSON.stringify({ query: `configuration-check-${Date.now()}` }),
    });
    // Act
    const response = await POST(request, { params: Promise.resolve({ path: ['search'] }) });
    // Assert
    assert.equal(response.status, 503);
    const result = await response.json();
    assert.equal(result.code, 'missing_openai_api_key');
    assert.match(result.error, /OPENAI_API_KEY/);
    assert.match(result.error, /restart/);
  });

  it('should return only public sources to a customer even for internal text', async () => {
    // Arrange
    const query = await chunkText(internalDocumentId());
    // Act
    const result = await api('POST', 'search', { as: customers.lucia, body: { query } });
    // Assert
    assert.equal(result.status, 200);
    assert.ok(result.body.sources.length > 0);
    assert.ok(result.body.sources.every((s: any) => s.audience === 'public'));
  });

  it('should rank the exactly matching public chunk first for a customer', async () => {
    // Arrange
    const documentId = publicDocumentId();
    const query = await chunkText(documentId);
    // Act
    const result = await api('POST', 'search', { as: customers.lucia, body: { query } });
    // Assert
    assert.equal(result.status, 200);
    assert.equal(result.body.sources[0].documentId, documentId);
    assert.equal(result.body.sources[0].text, query);
  });

  it('should let an operator retrieve internal sources', async () => {
    // Arrange
    const documentId = internalDocumentId();
    const query = await chunkText(documentId);
    // Act
    const result = await api('POST', 'search', { as: operators.marta, body: { query } });
    // Assert
    assert.equal(result.status, 200);
    assert.equal(result.body.sources[0].documentId, documentId);
    assert.equal(result.body.sources[0].audience, 'internal');
  });

  it('should return sources without embedding vectors', async () => {
    // Arrange
    const query = await chunkText(publicDocumentId());
    // Act
    const result = await api('POST', 'search', { as: customers.lucia, body: { query } });
    // Assert
    assert.ok(result.body.sources.every((s: any) => !('vector' in s)));
  });

  it('should reject an empty query as invalid request data', async () => {
    // Arrange
    const body = { query: '' };
    // Act
    const result = await api('POST', 'search', { as: customers.lucia, body });
    // Assert
    assert.equal(result.status, 400);
    assert.equal(result.body.error, 'Invalid request data.');
  });
});

describe('GET /api/health', () => {
  it('should report the service and configured models without a session', async () => {
    // Arrange
    // Act
    const result = await api('GET', 'health');
    // Assert
    assert.equal(result.status, 200);
    assert.equal(result.body.ok, true);
    assert.equal(result.body.service, 'banana-app');
    assert.equal(typeof result.body.chatModel, 'string');
    assert.equal(typeof result.body.embeddingModel, 'string');
  });

  it('should mark every response as not cacheable', async () => {
    // Arrange
    // Act
    const result = await api('GET', 'health');
    // Assert
    assert.equal(result.headers.get('cache-control'), 'no-store');
  });
});

describe('GET /api/people', () => {
  it('should list the ten selectable people without a session', async () => {
    // Arrange
    // Act
    const result = await api('GET', 'people');
    // Assert
    assert.equal(result.status, 200);
    assert.equal(result.body.length, counts.people);
    assert.deepEqual(
      result.body.filter((p: any) => p.role === 'operator').map((p: any) => p.id),
      [operators.marta, operators.pablo],
    );
  });
});

describe('POST /api/session', () => {
  it('should select the requested person and return it', async () => {
    // Arrange
    const body = { userId: customers.lucia };
    // Act
    const result = await api('POST', 'session', { body });
    // Assert
    assert.equal(result.status, 200);
    assert.equal(result.body.person.id, customers.lucia);
    assert.equal(result.body.person.role, 'customer');
  });

  it('should set a signed HttpOnly SameSite=Strict session cookie', async () => {
    // Arrange
    const body = { userId: customers.lucia };
    // Act
    const result = await api('POST', 'session', { body });
    // Assert
    const cookie = result.headers.get('set-cookie') ?? '';
    assert.ok(cookie.startsWith(`banana_actor=${sessionToken(customers.lucia)};`));
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);
    assert.match(cookie, /Path=\//);
  });

  it('should reject an unknown person', async () => {
    // Arrange
    const body = { userId: unknown.person };
    // Act
    const result = await api('POST', 'session', { body });
    // Assert
    assert.equal(result.status, 400);
    assert.equal(result.body.error, 'Unknown person.');
    assert.equal(result.headers.get('set-cookie'), null);
  });

  it('should reject a request from another origin', async () => {
    // Arrange
    const headers = { origin: 'http://evil.example', host: '127.0.0.1:3000' };
    // Act
    const result = await api('POST', 'session', { body: { userId: customers.lucia }, headers });
    // Assert
    assert.equal(result.status, 403);
    assert.equal(result.headers.get('set-cookie'), null);
  });

  it('should reject malformed JSON as invalid request data', async () => {
    // Arrange
    const request = new Request('http://127.0.0.1:3000/api/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"userId":',
    });
    // Act
    const response = await POST(request, { params: Promise.resolve({ path: ['session'] }) });
    // Assert
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, 'Invalid request data.');
  });
});

describe('GET /api/session', () => {
  it('should return the person resolved from the signed session', async () => {
    // Arrange
    // Act
    const result = await api('GET', 'session', { as: operators.marta });
    // Assert
    assert.equal(result.status, 200);
    assert.equal(result.body.person.id, operators.marta);
    assert.equal(result.body.person.role, 'operator');
  });

  it('should require a session', async () => {
    // Arrange
    // Act
    const result = await api('GET', 'session');
    // Assert
    assert.equal(result.status, 401);
  });

  it('should reject a tampered session cookie', async () => {
    // Arrange
    const headers = {
      cookie: `banana_actor=${operators.marta}.${sessionToken(customers.lucia).split('.')[1]}`,
    };
    // Act
    const result = await api('GET', 'session', { headers });
    // Assert
    assert.equal(result.status, 401);
    assert.equal(result.body.error, 'Invalid session.');
  });
});

describe('GET /api/dashboard', () => {
  before(startBank);
  after(stopBank);
  beforeEach(async () => {
    seedApp();
    await resetBank();
  });

  it('should give a customer their own accounts from the bank', async () => {
    // Arrange
    // Act
    const result = await api('GET', 'dashboard', { as: customers.lucia });
    // Assert
    assert.equal(result.status, 200);
    assert.deepEqual(
      result.body.accounts.map((a: any) => a.id),
      [accounts.lucia, accounts.luciaSavings],
    );
    assert.ok(result.body.accounts.every((a: any) => a.userId === customers.lucia));
  });

  it('should give a customer their movements, contacts and pending approvals', async () => {
    // Arrange
    // Act
    const result = await api('GET', 'dashboard', { as: customers.lucia });
    // Assert
    assert.ok(Array.isArray(result.body.movements));
    assert.ok(result.body.movements.length > 0);
    assert.ok(result.body.contacts.length > 0);
    assert.ok(result.body.contacts.every((c: any) => c.userId !== customers.lucia));
    assert.deepEqual(result.body.approvals, []);
  });

  it('should show a transfer left unknown by lost responses as completed once the bank confirms it', async () => {
    // Arrange
    const input = transferInputFactory.build();
    const network = await startLossyBank(
      (method, path) => method === 'POST' && path === '/v1/transfers',
    );
    let intentId: string;
    try {
      const proposal = await api('POST', 'actions', {
        as: customers.lucia,
        body: { name: 'transfer_money', arguments: input },
      });
      const confirmation = await api('POST', `approvals/${proposal.body.approval.id}/confirm`, {
        as: customers.lucia,
      });
      assert.equal(confirmation.body.status, 'unknown');
      intentId = confirmation.body.intentId;
    } finally {
      await network.close();
    }
    // Act
    const result = await api('GET', 'dashboard', { as: customers.lucia });
    // Assert
    const booked = (await bankSnapshot()).operations.find(
      (o) => o.reference === intentRow(intentId)!.bank_reference,
    )!;
    const [pending] = result.body.pendingTransfers;
    assert.deepEqual(
      { id: pending.id, status: pending.status, payload: pending.payload },
      { id: intentId, status: 'completed', payload: input },
    );
    assert.equal(pending.operationId, booked.id);
    assert.equal(intentRow(intentId)!.status, 'completed');
  });

  it('should keep showing a transfer as unknown while the bank cannot confirm it', async () => {
    // Arrange
    const intent = persistIntent({
      status: 'unknown',
      bankReference: `ref-${faker.string.uuid()}`,
    });
    const network = await startLossyBank(
      (method, path) => method === 'GET' && path.startsWith('/v1/operations/'),
    );
    // Act
    let result;
    try {
      result = await api('GET', 'dashboard', { as: customers.lucia });
    } finally {
      await network.close();
    }
    // Assert
    assert.equal(result.status, 200);
    assert.deepEqual(result.body.pendingTransfers, [
      { id: intent.id, status: 'unknown', payload: intent.payload, createdAt: intent.createdAt },
    ]);
  });

  it('should show a recent failed transfer as completed once the bank has its operation', async () => {
    // Arrange
    const intent = persistIntent({
      status: 'failed',
      bankReference: historicTransfer.reference,
      payload: historicTransfer.payload,
      error: 'No response received from the bank.',
    });
    // Act
    const result = await api('GET', 'dashboard', { as: customers.lucia });
    // Assert
    const shown = result.body.pendingTransfers.find((p: any) => p.id === intent.id);
    assert.deepEqual(
      { status: shown?.status, operationId: shown?.operationId },
      { status: 'completed', operationId: historicTransfer.operationId },
    );
  });

  it('should list only the ten newest pending transfers of the session customer', async () => {
    // Arrange
    const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();
    const intents = Array.from({ length: 11 }, (_, i) =>
      persistIntent({ status: 'processing', createdAt: at(11 - i) }),
    );
    persistIntent({ userId: customers.bruno, status: 'processing' });
    // Act
    const result = await api('GET', 'dashboard', { as: customers.lucia });
    // Assert
    assert.deepEqual(
      result.body.pendingTransfers.map((p: any) => p.id),
      intents
        .slice(1)
        .reverse()
        .map((i) => i.id),
    );
  });

  it('should give an operator the support cases instead of banking data', async () => {
    // Arrange
    // Act
    const result = await api('GET', 'dashboard', { as: operators.marta });
    // Assert
    assert.equal(result.status, 200);
    assert.equal(result.body.incidents.length, counts.cases);
    assert.equal(result.body.accounts, undefined);
  });

  it('should require a session', async () => {
    // Arrange
    // Act
    const result = await api('GET', 'dashboard');
    // Assert
    assert.equal(result.status, 401);
  });
});

describe('GET /api/conversations', () => {
  beforeEach(() => seedApp());

  it('should list only the conversations of the session customer', async () => {
    // Arrange
    // Act
    const result = await api('GET', 'conversations', { as: customers.lucia });
    // Assert
    assert.equal(result.status, 200);
    assert.ok(result.body.length > 0);
    assert.ok(result.body.every((c: any) => c.user_id === customers.lucia));
    assert.ok(result.body.some((c: any) => c.id === conversations.luciaWelcome));
  });

  it('should reject an operator', async () => {
    // Arrange
    // Act
    const result = await api('GET', 'conversations', { as: operators.marta });
    // Assert
    assert.equal(result.status, 403);
  });
});

describe('POST /api/conversations', () => {
  beforeEach(() => seedApp());

  it('should create a new conversation owned by the customer', async () => {
    // Arrange
    // Act
    const created = await api('POST', 'conversations', { as: customers.lucia });
    // Assert
    assert.equal(created.status, 201);
    const detail = await api('GET', `conversations/${created.body.id}`, { as: customers.lucia });
    assert.equal(detail.body.conversation.user_id, customers.lucia);
    assert.equal(detail.body.conversation.title, 'New conversation');
    assert.deepEqual(detail.body.messages, []);
  });

  it('should reject an operator', async () => {
    // Arrange
    // Act
    const result = await api('POST', 'conversations', { as: operators.marta });
    // Assert
    assert.equal(result.status, 403);
  });
});

describe('GET /api/conversations/:id', () => {
  beforeEach(() => seedApp());

  it('should return an owned conversation with its messages in order', async () => {
    // Arrange
    // Act
    const result = await api('GET', `conversations/${conversations.luciaWelcome}`, {
      as: customers.lucia,
    });
    // Assert
    assert.equal(result.status, 200);
    assert.equal(result.body.conversation.id, conversations.luciaWelcome);
    assert.ok(result.body.messages.length > 0);
    assert.ok(
      result.body.messages.every((m: any) => m.conversation_id === conversations.luciaWelcome),
    );
  });

  it('should hide a conversation of another customer as not found', async () => {
    // Arrange
    // Act
    const result = await api('GET', `conversations/${conversations.brunoWelcome}`, {
      as: customers.lucia,
    });
    // Assert
    assert.equal(result.status, 404);
    assert.equal(result.body.error, 'Conversation not found.');
  });
});

describe('POST /api/conversations/:id/messages', () => {
  let fake: FakeOpenAI;
  before(async () => {
    fake = await startFakeOpenAI();
  });
  after(() => fake.close());
  beforeEach(() => {
    seedApp();
    fake.reset();
  });

  it('should answer with the model reply and store both messages', async () => {
    // Arrange
    const { body } = await api('POST', 'conversations', { as: customers.lucia });
    fake.script(reply('Your card limit is 1,000 EUR.'));
    // Act
    const result = await api('POST', `conversations/${body.id}/messages`, {
      as: customers.lucia,
      body: { content: 'What is my card limit?' },
    });
    // Assert
    assert.equal(result.status, 200);
    assert.equal(result.body.answer, 'Your card limit is 1,000 EUR.');
    const detail = await api('GET', `conversations/${body.id}`, { as: customers.lucia });
    assert.deepEqual(
      detail.body.messages.map((m: any) => [m.role, m.content]),
      [
        ['user', 'What is my card limit?'],
        ['assistant', 'Your card limit is 1,000 EUR.'],
      ],
    );
  });

  it('should title a new conversation from its first message', async () => {
    // Arrange
    const { body } = await api('POST', 'conversations', { as: customers.lucia });
    const content = 'How do I dispute a card payment I do not recognise from last week?';
    fake.script(reply('Open a dispute from the card screen.'));
    // Act
    await api('POST', `conversations/${body.id}/messages`, {
      as: customers.lucia,
      body: { content },
    });
    // Assert
    const detail = await api('GET', `conversations/${body.id}`, { as: customers.lucia });
    assert.equal(detail.body.conversation.title, content.slice(0, 50));
  });

  it('should reject blank content', async () => {
    // Arrange
    const { body } = await api('POST', 'conversations', { as: customers.lucia });
    // Act
    const result = await api('POST', `conversations/${body.id}/messages`, {
      as: customers.lucia,
      body: { content: '   ' },
    });
    // Assert
    assert.equal(result.status, 400);
    assert.equal(fake.requests.length, 0);
  });

  it('should reject a message to a conversation of another customer', async () => {
    // Arrange
    const content = 'Hello';
    // Act
    const result = await api('POST', `conversations/${conversations.brunoWelcome}/messages`, {
      as: customers.lucia,
      body: { content },
    });
    // Assert
    assert.equal(result.status, 404);
    assert.equal(fake.requests.length, 0);
  });
});

describe('POST /api/actions', () => {
  before(startBank);
  after(stopBank);
  beforeEach(async () => {
    seedApp();
    await resetBank();
  });

  it('should list the accounts and contacts of the session customer', async () => {
    // Arrange
    const body = { name: 'list_accounts', arguments: {} };
    // Act
    const result = await api('POST', 'actions', { as: customers.lucia, body });
    // Assert
    assert.equal(result.status, 200);
    assert.deepEqual(
      result.body.accounts.map((a: any) => a.id),
      [accounts.lucia, accounts.luciaSavings],
    );
    assert.ok(result.body.contacts.every((c: any) => c.userId !== customers.lucia));
  });

  it('should propose a transfer for review without moving any money', async () => {
    // Arrange
    const input = transferInputFactory.build();
    const before = await bankSnapshot();
    // Act
    const result = await api('POST', 'actions', {
      as: customers.lucia,
      body: { name: 'transfer_money', arguments: input },
    });
    // Assert
    assert.equal(result.status, 200);
    assert.equal(result.body.status, 'requires_confirmation');
    assert.deepEqual(result.body.approval.payload, input);
    assert.deepEqual(await bankSnapshot(), before);
    const dashboard = await api('GET', 'dashboard', { as: customers.lucia });
    assert.deepEqual(
      dashboard.body.approvals.map((a: any) => a.id),
      [result.body.approval.id],
    );
  });

  it('should keep a single proposal when the same intent is proposed again', async () => {
    // Arrange
    const body = {
      name: 'transfer_money',
      arguments: transferInputFactory.build(),
      intentId: `intent-${faker.string.uuid()}`,
    };
    const first = await api('POST', 'actions', { as: customers.lucia, body });
    // Act
    const second = await api('POST', 'actions', { as: customers.lucia, body });
    // Assert
    assert.equal(second.body.approval.id, first.body.approval.id);
    const dashboard = await api('GET', 'dashboard', { as: customers.lucia });
    assert.equal(dashboard.body.approvals.length, 1);
  });

  it('should fail a transfer from an account of another customer and keep the ledger', async () => {
    // Arrange
    const input = transferInputFactory.build({
      fromAccountId: accounts.bruno,
      toAccountId: accounts.lucia,
    });
    const before = await balanceOf(input.fromAccountId);
    // Act
    const result = await api('POST', 'actions', {
      as: customers.lucia,
      body: { name: 'transfer_money', arguments: input },
    });
    // Assert
    assert.equal(result.body.status, 'failed');
    assert.equal(await balanceOf(input.fromAccountId), before);
  });

  it('should reject an operator', async () => {
    // Arrange
    const body = { name: 'list_accounts', arguments: {} };
    // Act
    const result = await api('POST', 'actions', { as: operators.marta, body });
    // Assert
    assert.equal(result.status, 403);
  });

  it('should reject an unknown action name', async () => {
    // Arrange
    const body = { name: 'delete_account', arguments: {} };
    // Act
    const result = await api('POST', 'actions', { as: customers.lucia, body });
    // Assert
    assert.equal(result.status, 400);
    assert.equal(result.body.error, 'Invalid request data.');
  });

  it('should reject a conversation of another customer as not found', async () => {
    // Arrange
    const body = {
      name: 'request_human',
      arguments: { summary: 'Help' },
      conversationId: conversations.brunoWelcome,
    };
    // Act
    const result = await api('POST', 'actions', { as: customers.lucia, body });
    // Assert
    assert.equal(result.status, 404);
  });

  it('should open a single human support case per conversation', async () => {
    // Arrange
    const { body: conversation } = await api('POST', 'conversations', { as: customers.lucia });
    const body = {
      name: 'request_human',
      arguments: { summary: 'I need a person' },
      conversationId: conversation.id,
    };
    // Act
    const first = await api('POST', 'actions', { as: customers.lucia, body });
    const second = await api('POST', 'actions', { as: customers.lucia, body });
    // Assert
    assert.equal(first.body.status, 'open');
    assert.equal(second.body.incidentId, first.body.incidentId);
  });
});

describe('POST /api/actions with a matching transfer still unverified', () => {
  before(startBank);
  after(stopBank);
  beforeEach(async () => {
    seedApp();
    await resetBank();
  });
  const transfer = (input: TransferInput, extra: Record<string, unknown> = {}) =>
    api('POST', 'actions', {
      as: customers.lucia,
      body: { name: 'transfer_money', arguments: input, ...extra },
    });
  /** Proposes and confirms the transfer through the UI routes; returns the confirmation body. */
  const sent = async (input: TransferInput) => {
    const proposal = await transfer(input);
    return (
      await api('POST', `approvals/${proposal.body.approval.id}/confirm`, { as: customers.lucia })
    ).body;
  };
  /** A bank that books transfers but whose answers, and lookups of them, never come back. */
  const unverifiable = () =>
    startLossyBank(
      (method, path) =>
        (method === 'POST' && path === '/v1/transfers') ||
        (method === 'GET' && path.startsWith('/v1/operations/')),
    );

  it('should hold an identical transfer for review instead of proposing it again', async () => {
    // Arrange
    const input = transferInputFactory.build();
    const network = await unverifiable();
    let first, second;
    try {
      first = await sent(input);
      // Act
      second = await transfer(input);
    } finally {
      await network.close();
    }
    // Assert
    assert.equal(first.status, 'unknown');
    assert.equal(second.status, 200);
    assert.deepEqual(
      {
        status: second.body.status,
        pendingIntentId: second.body.pendingIntentId,
        error: second.body.error,
      },
      {
        status: 'requires_review',
        pendingIntentId: first.intentId,
        error: 'A matching transfer is still being verified with the bank.',
      },
    );
    assert.equal(second.body.approval, undefined);
    assert.equal(approvalsFor(second.body.intentId), 0);
    const booked = (await operationsFor(customers.lucia)).filter(
      (o) => o.amountCents === input.amountCents && o.toAccountId === input.toAccountId,
    );
    assert.equal(booked.length, 1);
  });

  it('should propose the identical transfer when the customer sends it anyway', async () => {
    // Arrange
    const input = transferInputFactory.build();
    const network = await unverifiable();
    let result, held;
    try {
      const first = await sent(input);
      held = await transfer(input);
      // Act
      result = await transfer(input, {
        intentId: held.body.intentId,
        overridePendingIntentId: first.intentId,
      });
    } finally {
      await network.close();
    }
    // Assert
    assert.equal(result.body.status, 'requires_confirmation');
    assert.deepEqual(result.body.approval.payload, input);
    assert.equal(result.body.intentId, held.body.intentId);
    assert.equal(approvalsFor(held.body.intentId), 1);
  });

  it('should ignore an override naming another customer pending transfer', async () => {
    // Arrange
    const input = transferInputFactory.build();
    const foreign = persistIntent({
      userId: customers.bruno,
      status: 'unknown',
      payload: transferInputFactory.build({
        fromAccountId: accounts.bruno,
        toAccountId: accounts.lucia,
      }),
    });
    const network = await unverifiable();
    let first, result;
    try {
      first = await sent(input);
      // Act
      result = await transfer(input, { overridePendingIntentId: foreign.id });
    } finally {
      await network.close();
    }
    // Assert
    assert.equal(result.body.status, 'requires_review');
    assert.equal(result.body.pendingIntentId, first.intentId);
    assert.equal(approvalsFor(result.body.intentId), 0);
  });

  it('should ignore an override naming a transfer that is not the pending one', async () => {
    // Arrange
    const input = transferInputFactory.build();
    const settled = await sent(transferInputFactory.build());
    const network = await unverifiable();
    let first, result;
    try {
      first = await sent(input);
      // Act
      result = await transfer(input, { overridePendingIntentId: settled.intentId });
    } finally {
      await network.close();
    }
    // Assert
    assert.equal(settled.status, 'completed');
    assert.equal(result.body.status, 'requires_review');
    assert.equal(result.body.pendingIntentId, first.intentId);
  });

  it('should propose an identical transfer without friction once the first one completed', async () => {
    // Arrange
    const input = transferInputFactory.build();
    const first = await sent(input);
    // Act
    const second = await transfer(input);
    // Assert
    assert.equal(first.status, 'completed');
    assert.equal(second.body.status, 'requires_confirmation');
  });

  it('should propose an identical transfer once the bank confirms the earlier unknown one', async () => {
    // Arrange
    const input = transferInputFactory.build();
    const network = await startLossyBank(
      (method, path) => method === 'POST' && path === '/v1/transfers',
    );
    let first;
    try {
      first = await sent(input);
    } finally {
      await network.close();
    }
    // Act
    const second = await transfer(input);
    // Assert
    assert.equal(first.status, 'unknown');
    assert.equal(second.body.status, 'requires_confirmation');
    assert.equal(intentRow(first.intentId)!.status, 'completed');
  });

  /** Two live proposals of the same transfer under different intents, as two tabs would make. */
  const twoProposals = async (input: TransferInput) => {
    const a = (await transfer(input)).body;
    const b = (await transfer(input)).body;
    return { a, b };
  };
  const confirm = (approvalId: string, body?: Record<string, unknown>) =>
    api('POST', `approvals/${approvalId}/confirm`, { as: customers.lucia, body });
  const matching = async (input: TransferInput) =>
    (await operationsFor(customers.lucia)).filter(
      (o) => o.amountCents === input.amountCents && o.toAccountId === input.toAccountId,
    ).length;

  it('should hold the confirmation of an identical proposal while the first is still unverified', async () => {
    // Arrange
    const input = transferInputFactory.build();
    const { a, b } = await twoProposals(input);
    const network = await unverifiable();
    let first, second;
    try {
      first = await confirm(a.approval.id);
      // Act
      second = await confirm(b.approval.id);
    } finally {
      await network.close();
    }
    // Assert
    assert.equal(first.body.status, 'unknown');
    assert.deepEqual(
      { status: second.body.status, pendingIntentId: second.body.pendingIntentId },
      { status: 'requires_review', pendingIntentId: a.intentId },
    );
    assert.equal(await matching(input), 1);
  });

  it('should confirm the identical proposal when the customer sends it anyway', async () => {
    // Arrange
    const input = transferInputFactory.build();
    const { a, b } = await twoProposals(input);
    const network = await unverifiable();
    let result;
    try {
      await confirm(a.approval.id);
      await confirm(b.approval.id);
      // Act
      result = await confirm(b.approval.id, { overridePendingIntentId: a.intentId });
    } finally {
      await network.close();
    }
    // Assert
    assert.notEqual(result.body.status, 'requires_review');
    assert.equal(await matching(input), 2);
  });

  it('should hold the confirmation of an identical proposal while the first is still being sent', async () => {
    // Arrange
    const input = transferInputFactory.build();
    const { a, b } = await twoProposals(input);
    const network = await startLossyBank(
      (method, path) => method === 'POST' && path === '/v1/transfers',
      'hang',
    );
    let first, second;
    try {
      first = confirm(a.approval.id);
      const deadline = Date.now() + 5000;
      while (network.lost === 0 && Date.now() < deadline)
        await new Promise((resolve) => setTimeout(resolve, 5));
      // Act
      second = await confirm(b.approval.id);
    } finally {
      network.release();
      await first?.catch(() => {});
      await network.close();
    }
    // Assert
    assert.deepEqual(
      { status: second.body.status, pendingIntentId: second.body.pendingIntentId },
      { status: 'requires_review', pendingIntentId: a.intentId },
    );
    assert.equal((await first).body.status, 'completed');
    assert.equal(await matching(input), 1);
  });

  it('should dispatch only one of two identical proposals confirmed at the same time', async () => {
    // Arrange
    const input = transferInputFactory.build();
    const unverified = persistIntent({
      status: 'unknown',
      payload: input,
      bankReference: `ref-${faker.string.uuid()}`,
    });
    const override = { overridePendingIntentId: unverified.id };
    const a = (await transfer(input, override)).body;
    const b = (await transfer(input, override)).body;
    // Both confirmations wait on the bank check of the older twin, then race for the dispatch.
    const network = await startLossyBank(
      (method, path) => method === 'GET' && path.startsWith('/v1/operations/'),
      'hang',
    );
    let results, both;
    try {
      both = Promise.all([confirm(a.approval.id, override), confirm(b.approval.id, override)]);
      const deadline = Date.now() + 5000;
      while (network.lost < 2 && Date.now() < deadline)
        await new Promise((resolve) => setTimeout(resolve, 5));
      network.release();
      // Act
      results = (await both).map((r) => r.body);
    } finally {
      await network.close();
      await both?.catch(() => {});
    }
    // Assert
    const sentOne = results.find((r) => r.status !== 'requires_review');
    const heldOne = results.find((r) => r.status === 'requires_review');
    assert.equal(a.status, 'requires_confirmation');
    assert.equal(b.status, 'requires_confirmation');
    assert.equal(sentOne?.status, 'completed');
    assert.equal(heldOne?.pendingIntentId, sentOne?.intentId);
    assert.equal(await matching(input), 1);
  });

  it('should answer the stored outcome to a re-proposal that a confirmation overtook', async () => {
    // Arrange
    const input = transferInputFactory.build();
    const unverified = persistIntent({
      status: 'unknown',
      payload: input,
      bankReference: `ref-${faker.string.uuid()}`,
    });
    const override = { overridePendingIntentId: unverified.id };
    const proposal = (await transfer(input, override)).body;
    // Only the first bank check of the older twin hangs: the re-proposal's.
    let checks = 0;
    const network = await startLossyBank(
      (method, path) => method === 'GET' && path.startsWith('/v1/operations/') && checks++ === 0,
      'hang',
    );
    let reproposal, confirmed, pending;
    try {
      pending = transfer(input, { intentId: proposal.intentId, ...override });
      const deadline = Date.now() + 5000;
      while (network.lost === 0 && Date.now() < deadline)
        await new Promise((resolve) => setTimeout(resolve, 5));
      confirmed = (await confirm(proposal.approval.id, override)).body;
      network.release();
      // Act
      reproposal = await pending;
    } finally {
      await network.close();
      await pending?.catch(() => {});
    }
    // Assert
    assert.equal(confirmed.status, 'completed');
    assert.equal(reproposal.status, 200);
    assert.deepEqual(
      { status: reproposal.body.status, replay: reproposal.body.replay },
      { status: 'completed', replay: true },
    );
    assert.equal(approvalsFor(proposal.intentId), 1);
    assert.equal(await matching(input), 1);
  });
});

describe('POST /api/approvals/:id/confirm', () => {
  before(startBank);
  after(stopBank);
  beforeEach(async () => {
    seedApp();
    await resetBank();
  });
  const propose = async (input: TransferInput) =>
    (
      await api('POST', 'actions', {
        as: customers.lucia,
        body: { name: 'transfer_money', arguments: input },
      })
    ).body.approval.id as string;

  it('should report an unknown proposal as not found', async () => {
    // Arrange
    // Act
    const result = await api('POST', 'approvals/does-not-exist/confirm', { as: customers.lucia });
    // Assert
    assert.equal(result.status, 404);
    assert.equal(result.body.error, 'Proposal not found.');
  });

  it('should execute a confirmed proposal and move the amount exactly once', async () => {
    // Arrange
    const input = transferInputFactory.build();
    const approvalId = await propose(input);
    const [fromBefore, toBefore] = [
      await balanceOf(input.fromAccountId),
      await balanceOf(input.toAccountId),
    ];
    const operationsBefore = (await operationsFor(customers.lucia)).length;
    // Act
    const result = await api('POST', `approvals/${approvalId}/confirm`, { as: customers.lucia });
    // Assert
    assert.equal(result.status, 200);
    assert.equal(result.body.status, 'completed');
    assert.equal(result.body.operation.amountCents, input.amountCents);
    assert.equal(await balanceOf(input.fromAccountId), fromBefore - input.amountCents);
    assert.equal(await balanceOf(input.toAccountId), toBefore + input.amountCents);
    assert.equal((await operationsFor(customers.lucia)).length, operationsBefore + 1);
  });

  it('should remove a confirmed proposal from the pending approvals', async () => {
    // Arrange
    const input = transferInputFactory.build();
    const approvalId = await propose(input);
    // Act
    await api('POST', `approvals/${approvalId}/confirm`, { as: customers.lucia });
    // Assert
    const dashboard = await api('GET', 'dashboard', { as: customers.lucia });
    assert.deepEqual(dashboard.body.approvals, []);
  });

  it('should answer a repeated confirmation with the same operation', async () => {
    // Arrange
    const input = transferInputFactory.build();
    const approvalId = await propose(input);
    const first = await api('POST', `approvals/${approvalId}/confirm`, { as: customers.lucia });
    const before = await bankSnapshot();
    // Act
    const second = await api('POST', `approvals/${approvalId}/confirm`, { as: customers.lucia });
    // Assert
    assert.equal(second.body.status, 'completed');
    assert.equal(second.body.operation.id, first.body.operation.id);
    assert.deepEqual(await bankSnapshot(), before);
  });

  it('should reject an expired proposal and keep the ledger', async () => {
    // Arrange
    const input = transferInputFactory.build();
    const approvalId = await propose(input);
    appDb()
      .prepare('UPDATE approvals SET expires_at=? WHERE id=?')
      .run(new Date(Date.now() - 1000).toISOString(), approvalId);
    const before = await bankSnapshot();
    // Act
    const result = await api('POST', `approvals/${approvalId}/confirm`, { as: customers.lucia });
    // Assert
    assert.equal(result.status, 409);
    assert.deepEqual(await bankSnapshot(), before);
  });

  it('should hide a proposal from another customer as not found', async () => {
    // Arrange
    const input = transferInputFactory.build();
    const approvalId = await propose(input);
    const before = await bankSnapshot();
    // Act
    const result = await api('POST', `approvals/${approvalId}/confirm`, { as: customers.bruno });
    // Assert
    assert.equal(result.status, 404);
    assert.deepEqual(await bankSnapshot(), before);
  });
});

describe('GET /api/incidents', () => {
  beforeEach(() => seedApp());

  it('should list every support case to an operator', async () => {
    // Arrange
    // Act
    const result = await api('GET', 'incidents', { as: operators.marta });
    // Assert
    assert.equal(result.status, 200);
    assert.equal(result.body.length, counts.cases);
  });

  it('should reject a customer', async () => {
    // Arrange
    // Act
    const result = await api('GET', 'incidents', { as: customers.lucia });
    // Assert
    assert.equal(result.status, 403);
  });
});

describe('GET /api/incidents/:id', () => {
  beforeEach(() => seedApp());

  it('should return the case with its customer and last message to an operator', async () => {
    // Arrange
    const [incident] = (await api('GET', 'incidents', { as: operators.marta })).body;
    // Act
    const result = await api('GET', `incidents/${incident.id}`, { as: operators.marta });
    // Assert
    assert.equal(result.status, 200);
    assert.equal(result.body.incident.id, incident.id);
    assert.equal(result.body.customer.id, incident.user_id);
    assert.equal(result.body.lastMessage.conversation_id, incident.conversation_id);
  });

  it('should report an unknown case as not found', async () => {
    // Arrange
    // Act
    const result = await api('GET', `incidents/${unknown.case}`, { as: operators.marta });
    // Assert
    assert.equal(result.status, 404);
  });

  it('should reject a customer', async () => {
    // Arrange
    // Act
    const result = await api('GET', `incidents/${unknown.case}`, { as: customers.lucia });
    // Assert
    assert.equal(result.status, 403);
  });
});

describe('GET /api/documents', () => {
  beforeEach(() => seedApp());

  it('should list only the 68 public documents to a customer', async () => {
    // Arrange
    // Act
    const result = await api('GET', 'documents', { as: customers.lucia });
    // Assert
    assert.equal(result.status, 200);
    assert.equal(result.body.documents.length, counts.publicDocuments);
    assert.ok(result.body.documents.every((d: any) => d.audience === 'public'));
  });

  it('should list all 80 documents to an operator', async () => {
    // Arrange
    // Act
    const result = await api('GET', 'documents', { as: operators.marta });
    // Assert
    assert.equal(result.body.documents.length, counts.documents);
    assert.ok(result.body.index.chunks > 0);
  });
});

describe('GET /api/documents/:id', () => {
  beforeEach(() => seedApp());

  it('should return a public document with its text to a customer', async () => {
    // Arrange
    const id = publicDocumentId();
    // Act
    const result = await api('GET', `documents/${id}`, { as: customers.lucia });
    // Assert
    assert.equal(result.status, 200);
    assert.equal(result.body.id, id);
    assert.equal(typeof result.body.text, 'string');
    assert.ok(result.body.text.length > 0);
  });

  it('should hide an internal document from a customer as not found', async () => {
    // Arrange
    const id = internalDocumentId();
    // Act
    const result = await api('GET', `documents/${id}`, { as: customers.lucia });
    // Assert
    assert.equal(result.status, 404);
  });

  it('should return an internal document to an operator', async () => {
    // Arrange
    const id = internalDocumentId();
    // Act
    const result = await api('GET', `documents/${id}`, { as: operators.marta });
    // Assert
    assert.equal(result.status, 200);
    assert.equal(result.body.audience, 'internal');
  });
});

describe('GET /api/documents/:id/chunks', () => {
  beforeEach(() => seedApp());

  it('should return the chunks of a document without vectors', async () => {
    // Arrange
    const id = publicDocumentId();
    // Act
    const result = await api('GET', `documents/${id}/chunks`, { as: customers.lucia });
    // Assert
    assert.equal(result.status, 200);
    assert.ok(result.body.length > 0);
    assert.ok(result.body.every((c: any) => c.documentId === id && !('vector' in c)));
  });

  it('should hide the chunks of an internal document from a customer', async () => {
    // Arrange
    const id = internalDocumentId();
    // Act
    const result = await api('GET', `documents/${id}/chunks`, { as: customers.lucia });
    // Assert
    assert.equal(result.status, 404);
  });
});

describe('POST /api/preview-answer', () => {
  let fake: FakeOpenAI;
  before(async () => {
    fake = await startFakeOpenAI();
  });
  after(() => fake.close());
  beforeEach(() => fake.reset());

  it('should answer an operator question from the supplied sources', async () => {
    // Arrange
    const source = searchResultFactory.build();
    fake.script(reply('The daily card limit is 1,000 EUR.'));
    // Act
    const result = await api('POST', 'preview-answer', {
      as: operators.marta,
      body: { question: 'What is the card limit?', sources: [source] },
    });
    // Assert
    assert.equal(result.status, 200);
    assert.equal(result.body.answer, 'The daily card limit is 1,000 EUR.');
    const sent = fake.requests.find((r) => r.path.endsWith('/responses'))!;
    assert.equal(sent.body.input, 'What is the card limit?');
    assert.ok(sent.body.instructions.includes(source.text));
  });

  it('should reject a customer', async () => {
    // Arrange
    const body = { question: 'What is the card limit?', sources: [searchResultFactory.build()] };
    // Act
    const result = await api('POST', 'preview-answer', { as: customers.lucia, body });
    // Assert
    assert.equal(result.status, 403);
    assert.equal(fake.requests.length, 0);
  });

  it('should reject more than ten sources', async () => {
    // Arrange
    const body = {
      question: 'What is the card limit?',
      sources: searchResultFactory.buildList(11),
    };
    // Act
    const result = await api('POST', 'preview-answer', { as: operators.marta, body });
    // Assert
    assert.equal(result.status, 400);
    assert.equal(fake.requests.length, 0);
  });
});

describe('POST /api/ingestion', () => {
  it('should reject a customer', async () => {
    // Arrange
    // Act
    const result = await api('POST', 'ingestion', { as: customers.lucia });
    // Assert
    assert.equal(result.status, 403);
  });
});

describe('unknown routes', () => {
  it('should answer an unknown route with not found', async () => {
    // Arrange
    // Act
    const result = await api('GET', 'does-not-exist', { as: customers.lucia });
    // Assert
    assert.equal(result.status, 404);
    assert.equal(result.body.error, 'Route not found.');
  });
});

// Routing semantics of src/http/handle.ts: the order of the origin, session, route and body
// checks; explicit methods (405 with `Allow`, HEAD answered as GET); exact paths only.
describe('routing order', () => {
  beforeEach(() => seedApp());

  it('should require a session before answering an unknown route', async () => {
    // Arrange
    // Act
    const result = await api('GET', 'does-not-exist');
    // Assert
    assert.equal(result.status, 401);
  });

  it('should require a session before answering a private route with the wrong method', async () => {
    // Arrange
    // Act
    const actions = await api('GET', 'actions');
    const incidents = await api('POST', 'incidents');
    // Assert
    assert.equal(actions.status, 401);
    assert.equal(actions.headers.get('allow'), null);
    assert.equal(incidents.status, 401);
    assert.equal(incidents.headers.get('allow'), null);
  });

  it('should reject a post to an unknown route from another origin', async () => {
    // Arrange
    const headers = { origin: 'http://evil.example', host: '127.0.0.1:3000' };
    // Act
    const result = await api('POST', 'does-not-exist', { headers });
    // Assert
    assert.equal(result.status, 403);
    assert.equal(result.body.error, 'Origin not allowed.');
  });

  it('should reject a post to a public route from another origin', async () => {
    // Arrange
    const headers = { origin: 'http://evil.example', host: '127.0.0.1:3000' };
    // Act
    const result = await api('POST', 'health', { headers });
    // Assert
    assert.equal(result.status, 403);
    assert.equal(result.body.error, 'Origin not allowed.');
  });

  it('should check the customer role before validating an action body', async () => {
    // Arrange
    const body = { name: 'delete_account', arguments: {} };
    // Act
    const result = await api('POST', 'actions', { as: operators.marta, body });
    // Assert
    assert.equal(result.status, 403);
    assert.equal(result.body.error, 'A customer is required.');
  });

  it('should check conversation ownership before validating a message body', async () => {
    // Arrange
    const body = { content: '' };
    // Act
    const result = await api('POST', `conversations/${conversations.brunoWelcome}/messages`, {
      as: customers.lucia,
      body,
    });
    // Assert
    assert.equal(result.status, 404);
    assert.equal(result.body.error, 'Conversation not found.');
  });

  it('should check the operator role before validating a preview body', async () => {
    // Arrange
    const body = { question: '' };
    // Act
    const result = await api('POST', 'preview-answer', { as: customers.lucia, body });
    // Assert
    assert.equal(result.status, 403);
    assert.equal(result.body.error, 'Operator role required.');
  });
});

describe('explicit methods', () => {
  beforeEach(() => seedApp());

  it('should answer a post to health with method not allowed without a session', async () => {
    // Arrange
    // Act
    const result = await api('POST', 'health');
    // Assert
    assert.equal(result.status, 405);
    assert.equal(result.body.error, 'Method not allowed.');
    assert.equal(result.headers.get('allow'), 'GET, HEAD');
  });

  it('should answer a post to people with method not allowed without a session', async () => {
    // Arrange
    // Act
    const result = await api('POST', 'people');
    // Assert
    assert.equal(result.status, 405);
    assert.equal(result.headers.get('allow'), 'GET, HEAD');
  });

  it('should answer a post to incidents with method not allowed and allow GET', async () => {
    // Arrange
    // Act
    const result = await api('POST', 'incidents', { as: operators.marta });
    // Assert
    assert.equal(result.status, 405);
    assert.equal(result.body.error, 'Method not allowed.');
    assert.equal(result.headers.get('allow'), 'GET, HEAD');
    assert.equal(result.headers.get('cache-control'), 'no-store');
  });

  it('should answer a get of actions with method not allowed and allow POST', async () => {
    // Arrange
    // Act
    const result = await api('GET', 'actions', { as: customers.lucia });
    // Assert
    assert.equal(result.status, 405);
    assert.equal(result.body.error, 'Method not allowed.');
    assert.equal(result.headers.get('allow'), 'POST');
  });

  it('should answer a get of a confirmation with method not allowed and allow POST', async () => {
    // Arrange
    // Act
    const result = await api('GET', 'approvals/does-not-exist/confirm', { as: customers.lucia });
    // Assert
    assert.equal(result.status, 405);
    assert.equal(result.headers.get('allow'), 'POST');
  });

  it('should answer a post to a conversation with method not allowed and allow GET', async () => {
    // Arrange
    // Act
    const result = await api('POST', `conversations/${conversations.luciaWelcome}`, {
      as: customers.lucia,
    });
    // Assert
    assert.equal(result.status, 405);
    assert.equal(result.headers.get('allow'), 'GET, HEAD');
  });

  it('should answer a get of conversation messages with method not allowed and allow POST', async () => {
    // Arrange
    // Act
    const result = await api('GET', `conversations/${conversations.luciaWelcome}/messages`, {
      as: customers.lucia,
    });
    // Assert
    assert.equal(result.status, 405);
    assert.equal(result.headers.get('allow'), 'POST');
  });

  it('should answer a head request to a public route like a get', async () => {
    // Arrange
    const request = new Request('http://127.0.0.1:3000/api/health', { method: 'HEAD' });
    // Act
    const response = await GET(request, { params: Promise.resolve({ path: ['health'] }) });
    // Assert
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  });

  it('should answer a head request to a private read route for the session', async () => {
    // Arrange
    const request = new Request('http://127.0.0.1:3000/api/documents', {
      method: 'HEAD',
      headers: { cookie: `banana_actor=${sessionToken(customers.lucia)}` },
    });
    // Act
    const response = await GET(request, { params: Promise.resolve({ path: ['documents'] }) });
    // Assert
    assert.equal(response.status, 200);
  });
});

describe('exact paths', () => {
  beforeEach(() => seedApp());

  it('should answer a post to conversations/:id/messages/x as an unknown route', async () => {
    // Arrange
    const body = { content: 'Hello' };
    // Act
    const result = await api('POST', `conversations/${conversations.luciaWelcome}/messages/x`, {
      as: customers.lucia,
      body,
    });
    // Assert
    assert.equal(result.status, 404);
    assert.equal(result.body.error, 'Route not found.');
  });

  it('should answer a post to approvals/:id/confirm/x as an unknown route', async () => {
    // Arrange
    // Act
    const result = await api('POST', 'approvals/does-not-exist/confirm/x', {
      as: customers.lucia,
    });
    // Assert
    assert.equal(result.status, 404);
    assert.equal(result.body.error, 'Route not found.');
  });

  it('should answer a get of documents/:id/chunks/x as an unknown route', async () => {
    // Arrange
    const id = publicDocumentId();
    // Act
    const result = await api('GET', `documents/${id}/chunks/x`, { as: customers.lucia });
    // Assert
    assert.equal(result.status, 404);
    assert.equal(result.body.error, 'Route not found.');
  });

  it('should answer extra segments after a conversation, case or document as an unknown route', async () => {
    // Arrange
    const id = publicDocumentId();
    // Act
    const conversation = await api('GET', `conversations/${conversations.luciaWelcome}/x`, {
      as: customers.lucia,
    });
    const incident = await api('GET', 'incidents/case-1/x', { as: operators.marta });
    const document = await api('GET', `documents/${id}/x`, { as: customers.lucia });
    // Assert
    assert.equal(conversation.status, 404);
    assert.equal(conversation.body.error, 'Route not found.');
    assert.equal(incident.status, 404);
    assert.equal(incident.body.error, 'Route not found.');
    assert.equal(document.status, 404);
    assert.equal(document.body.error, 'Route not found.');
  });
});

describe('roles and side effects', () => {
  let fake: FakeOpenAI;
  before(async () => {
    fake = await startFakeOpenAI();
  });
  after(() => fake.close());
  beforeEach(() => {
    seedApp();
    fake.reset();
  });

  it('should reject an operator on both reading and creating conversations', async () => {
    // Arrange
    // Act
    const list = await api('GET', 'conversations', { as: operators.marta });
    const create = await api('POST', 'conversations', { as: operators.marta });
    // Assert
    assert.equal(list.status, 403);
    assert.equal(list.body.error, 'Select a customer to open a chat.');
    assert.equal(create.status, 403);
    assert.equal(create.body.error, 'Select a customer to open a chat.');
  });

  // Intended for a model failure: sendMessage has already stored the message, so the title names it.
  it('should title a new conversation from its first message even when the model fails', async () => {
    // Arrange
    const { body } = await api('POST', 'conversations', { as: customers.lucia });
    const content = 'Why was my card declined at the supermarket this morning?';
    fake.script({ status: 500, error: 'Scripted model failure.' });
    // Act
    const result = await api('POST', `conversations/${body.id}/messages`, {
      as: customers.lucia,
      body: { content },
    });
    // Assert
    assert.equal(result.status, 502);
    const detail = await api('GET', `conversations/${body.id}`, { as: customers.lucia });
    assert.equal(detail.body.conversation.title, content.slice(0, 50));
  });

  it('should mark the session cookie response as not cacheable', async () => {
    // Arrange
    const body = { userId: customers.lucia };
    // Act
    const result = await api('POST', 'session', { body });
    // Assert
    assert.ok(result.headers.get('set-cookie'));
    assert.equal(result.headers.get('cache-control'), 'no-store');
  });
});
