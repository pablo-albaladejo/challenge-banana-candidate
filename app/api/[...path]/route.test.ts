import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { POST } from './route';
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

/** Exact text of the first chunk of a document, so search ranks it without a model call. */
async function chunkText(documentId: string) {
  const chunks = await api('GET', `documents/${documentId}/chunks`, { as: 'marta' });
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
        cookie: `banana_actor=${sessionToken('lucia')}`,
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
    const result = await api('POST', 'search', { as: 'lucia', body: { query } });
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
    const result = await api('POST', 'search', { as: 'lucia', body: { query } });
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
    const result = await api('POST', 'search', { as: 'marta', body: { query } });
    // Assert
    assert.equal(result.status, 200);
    assert.equal(result.body.sources[0].documentId, documentId);
    assert.equal(result.body.sources[0].audience, 'internal');
  });

  it('should return sources without embedding vectors', async () => {
    // Arrange
    const query = await chunkText(publicDocumentId());
    // Act
    const result = await api('POST', 'search', { as: 'lucia', body: { query } });
    // Assert
    assert.ok(result.body.sources.every((s: any) => !('vector' in s)));
  });

  it('should reject an empty query as invalid request data', async () => {
    // Arrange
    const body = { query: '' };
    // Act
    const result = await api('POST', 'search', { as: 'lucia', body });
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
    assert.equal(result.body.length, 10);
    assert.deepEqual(
      result.body.filter((p: any) => p.role === 'operator').map((p: any) => p.id),
      ['marta', 'pablo'],
    );
  });
});

describe('POST /api/session', () => {
  it('should select the requested person and return it', async () => {
    // Arrange
    const body = { userId: 'lucia' };
    // Act
    const result = await api('POST', 'session', { body });
    // Assert
    assert.equal(result.status, 200);
    assert.equal(result.body.person.id, 'lucia');
    assert.equal(result.body.person.role, 'customer');
  });

  it('should set a signed HttpOnly SameSite=Strict session cookie', async () => {
    // Arrange
    const body = { userId: 'lucia' };
    // Act
    const result = await api('POST', 'session', { body });
    // Assert
    const cookie = result.headers.get('set-cookie') ?? '';
    assert.ok(cookie.startsWith(`banana_actor=${sessionToken('lucia')};`));
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);
    assert.match(cookie, /Path=\//);
  });

  it('should reject an unknown person', async () => {
    // Arrange
    const body = { userId: 'mallory' };
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
    const result = await api('POST', 'session', { body: { userId: 'lucia' }, headers });
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
    const result = await api('GET', 'session', { as: 'marta' });
    // Assert
    assert.equal(result.status, 200);
    assert.equal(result.body.person.id, 'marta');
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
    const headers = { cookie: `banana_actor=marta.${sessionToken('lucia').split('.')[1]}` };
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
    const result = await api('GET', 'dashboard', { as: 'lucia' });
    // Assert
    assert.equal(result.status, 200);
    assert.deepEqual(
      result.body.accounts.map((a: any) => a.id),
      ['acc-lucia', 'acc-lucia-savings'],
    );
    assert.ok(result.body.accounts.every((a: any) => a.userId === 'lucia'));
  });

  it('should give a customer their movements, contacts and pending approvals', async () => {
    // Arrange
    // Act
    const result = await api('GET', 'dashboard', { as: 'lucia' });
    // Assert
    assert.ok(Array.isArray(result.body.movements));
    assert.ok(result.body.movements.length > 0);
    assert.ok(result.body.contacts.length > 0);
    assert.ok(result.body.contacts.every((c: any) => c.userId !== 'lucia'));
    assert.deepEqual(result.body.approvals, []);
  });

  it('should give an operator the support cases instead of banking data', async () => {
    // Arrange
    // Act
    const result = await api('GET', 'dashboard', { as: 'marta' });
    // Assert
    assert.equal(result.status, 200);
    assert.equal(result.body.incidents.length, 17);
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
    const result = await api('GET', 'conversations', { as: 'lucia' });
    // Assert
    assert.equal(result.status, 200);
    assert.ok(result.body.length > 0);
    assert.ok(result.body.every((c: any) => c.user_id === 'lucia'));
    assert.ok(result.body.some((c: any) => c.id === 'conv-lucia-welcome'));
  });

  it('should reject an operator', async () => {
    // Arrange
    // Act
    const result = await api('GET', 'conversations', { as: 'marta' });
    // Assert
    assert.equal(result.status, 403);
  });
});

describe('POST /api/conversations', () => {
  beforeEach(() => seedApp());

  it('should create a new conversation owned by the customer', async () => {
    // Arrange
    // Act
    const created = await api('POST', 'conversations', { as: 'lucia' });
    // Assert
    assert.equal(created.status, 201);
    const detail = await api('GET', `conversations/${created.body.id}`, { as: 'lucia' });
    assert.equal(detail.body.conversation.user_id, 'lucia');
    assert.equal(detail.body.conversation.title, 'New conversation');
    assert.deepEqual(detail.body.messages, []);
  });

  it('should reject an operator', async () => {
    // Arrange
    // Act
    const result = await api('POST', 'conversations', { as: 'marta' });
    // Assert
    assert.equal(result.status, 403);
  });
});

describe('GET /api/conversations/:id', () => {
  beforeEach(() => seedApp());

  it('should return an owned conversation with its messages in order', async () => {
    // Arrange
    // Act
    const result = await api('GET', 'conversations/conv-lucia-welcome', { as: 'lucia' });
    // Assert
    assert.equal(result.status, 200);
    assert.equal(result.body.conversation.id, 'conv-lucia-welcome');
    assert.ok(result.body.messages.length > 0);
    assert.ok(result.body.messages.every((m: any) => m.conversation_id === 'conv-lucia-welcome'));
  });

  it('should hide a conversation of another customer as not found', async () => {
    // Arrange
    // Act
    const result = await api('GET', 'conversations/conv-bruno-welcome', { as: 'lucia' });
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
    const { body } = await api('POST', 'conversations', { as: 'lucia' });
    fake.script(reply('Your card limit is 1,000 EUR.'));
    // Act
    const result = await api('POST', `conversations/${body.id}/messages`, {
      as: 'lucia',
      body: { content: 'What is my card limit?' },
    });
    // Assert
    assert.equal(result.status, 200);
    assert.equal(result.body.answer, 'Your card limit is 1,000 EUR.');
    const detail = await api('GET', `conversations/${body.id}`, { as: 'lucia' });
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
    const { body } = await api('POST', 'conversations', { as: 'lucia' });
    const content = 'How do I dispute a card payment I do not recognise from last week?';
    fake.script(reply('Open a dispute from the card screen.'));
    // Act
    await api('POST', `conversations/${body.id}/messages`, { as: 'lucia', body: { content } });
    // Assert
    const detail = await api('GET', `conversations/${body.id}`, { as: 'lucia' });
    assert.equal(detail.body.conversation.title, content.slice(0, 50));
  });

  it('should reject blank content', async () => {
    // Arrange
    const { body } = await api('POST', 'conversations', { as: 'lucia' });
    // Act
    const result = await api('POST', `conversations/${body.id}/messages`, {
      as: 'lucia',
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
    const result = await api('POST', 'conversations/conv-bruno-welcome/messages', {
      as: 'lucia',
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
    const result = await api('POST', 'actions', { as: 'lucia', body });
    // Assert
    assert.equal(result.status, 200);
    assert.deepEqual(
      result.body.accounts.map((a: any) => a.id),
      ['acc-lucia', 'acc-lucia-savings'],
    );
    assert.ok(result.body.contacts.every((c: any) => c.userId !== 'lucia'));
  });

  it('should propose a transfer for review without moving any money', async () => {
    // Arrange
    const input = {
      fromAccountId: 'acc-lucia',
      toAccountId: 'acc-bruno',
      amountCents: 1234,
      concept: 'Lunch',
    };
    const before = await bankSnapshot();
    // Act
    const result = await api('POST', 'actions', {
      as: 'lucia',
      body: { name: 'transfer_money', arguments: input },
    });
    // Assert
    assert.equal(result.status, 200);
    assert.equal(result.body.status, 'requires_confirmation');
    assert.deepEqual(result.body.approval.payload, input);
    assert.deepEqual(await bankSnapshot(), before);
    const dashboard = await api('GET', 'dashboard', { as: 'lucia' });
    assert.deepEqual(
      dashboard.body.approvals.map((a: any) => a.id),
      [result.body.approval.id],
    );
  });

  it('should keep a single proposal when the same intent is proposed again', async () => {
    // Arrange
    const body = {
      name: 'transfer_money',
      arguments: {
        fromAccountId: 'acc-lucia',
        toAccountId: 'acc-bruno',
        amountCents: 900,
        concept: 'Tea',
      },
      intentId: 'intent-same-proposal',
    };
    const first = await api('POST', 'actions', { as: 'lucia', body });
    // Act
    const second = await api('POST', 'actions', { as: 'lucia', body });
    // Assert
    assert.equal(second.body.approval.id, first.body.approval.id);
    const dashboard = await api('GET', 'dashboard', { as: 'lucia' });
    assert.equal(dashboard.body.approvals.length, 1);
  });

  it('should fail a transfer from an account of another customer and keep the ledger', async () => {
    // Arrange
    const input = {
      fromAccountId: 'acc-bruno',
      toAccountId: 'acc-lucia',
      amountCents: 500,
      concept: 'Not mine',
    };
    const before = await balanceOf('acc-bruno');
    // Act
    const result = await api('POST', 'actions', {
      as: 'lucia',
      body: { name: 'transfer_money', arguments: input },
    });
    // Assert
    assert.equal(result.body.status, 'failed');
    assert.equal(await balanceOf('acc-bruno'), before);
  });

  it('should reject an operator', async () => {
    // Arrange
    const body = { name: 'list_accounts', arguments: {} };
    // Act
    const result = await api('POST', 'actions', { as: 'marta', body });
    // Assert
    assert.equal(result.status, 403);
  });

  it('should reject an unknown action name', async () => {
    // Arrange
    const body = { name: 'delete_account', arguments: {} };
    // Act
    const result = await api('POST', 'actions', { as: 'lucia', body });
    // Assert
    assert.equal(result.status, 400);
    assert.equal(result.body.error, 'Invalid request data.');
  });

  it('should reject a conversation of another customer as not found', async () => {
    // Arrange
    const body = {
      name: 'request_human',
      arguments: { summary: 'Help' },
      conversationId: 'conv-bruno-welcome',
    };
    // Act
    const result = await api('POST', 'actions', { as: 'lucia', body });
    // Assert
    assert.equal(result.status, 404);
  });

  it('should open a single human support case per conversation', async () => {
    // Arrange
    const { body: conversation } = await api('POST', 'conversations', { as: 'lucia' });
    const body = {
      name: 'request_human',
      arguments: { summary: 'I need a person' },
      conversationId: conversation.id,
    };
    // Act
    const first = await api('POST', 'actions', { as: 'lucia', body });
    const second = await api('POST', 'actions', { as: 'lucia', body });
    // Assert
    assert.equal(first.body.status, 'open');
    assert.equal(second.body.incidentId, first.body.incidentId);
  });
});

describe('POST /api/approvals/:id/confirm', () => {
  before(startBank);
  after(stopBank);
  beforeEach(async () => {
    seedApp();
    await resetBank();
  });
  const input = {
    fromAccountId: 'acc-lucia',
    toAccountId: 'acc-bruno',
    amountCents: 1234,
    concept: 'Lunch',
  };
  const propose = async () =>
    (
      await api('POST', 'actions', {
        as: 'lucia',
        body: { name: 'transfer_money', arguments: input },
      })
    ).body.approval.id as string;

  it('should report an unknown proposal as not found', async () => {
    // Arrange
    // Act
    const result = await api('POST', 'approvals/does-not-exist/confirm', { as: 'lucia' });
    // Assert
    assert.equal(result.status, 404);
    assert.equal(result.body.error, 'Proposal not found.');
  });

  it('should execute a confirmed proposal and move the amount exactly once', async () => {
    // Arrange
    const approvalId = await propose();
    const [fromBefore, toBefore] = [await balanceOf('acc-lucia'), await balanceOf('acc-bruno')];
    const operationsBefore = (await operationsFor('lucia')).length;
    // Act
    const result = await api('POST', `approvals/${approvalId}/confirm`, { as: 'lucia' });
    // Assert
    assert.equal(result.status, 200);
    assert.equal(result.body.status, 'completed');
    assert.equal(result.body.operation.amountCents, 1234);
    assert.equal(await balanceOf('acc-lucia'), fromBefore - 1234);
    assert.equal(await balanceOf('acc-bruno'), toBefore + 1234);
    assert.equal((await operationsFor('lucia')).length, operationsBefore + 1);
  });

  it('should remove a confirmed proposal from the pending approvals', async () => {
    // Arrange
    const approvalId = await propose();
    // Act
    await api('POST', `approvals/${approvalId}/confirm`, { as: 'lucia' });
    // Assert
    const dashboard = await api('GET', 'dashboard', { as: 'lucia' });
    assert.deepEqual(dashboard.body.approvals, []);
  });

  it('should answer a repeated confirmation with the same operation', async () => {
    // Arrange
    const approvalId = await propose();
    const first = await api('POST', `approvals/${approvalId}/confirm`, { as: 'lucia' });
    const before = await bankSnapshot();
    // Act
    const second = await api('POST', `approvals/${approvalId}/confirm`, { as: 'lucia' });
    // Assert
    assert.equal(second.body.status, 'completed');
    assert.equal(second.body.operation.id, first.body.operation.id);
    assert.deepEqual(await bankSnapshot(), before);
  });

  it('should reject an expired proposal and keep the ledger', async () => {
    // Arrange
    const approvalId = await propose();
    appDb()
      .prepare('UPDATE approvals SET expires_at=? WHERE id=?')
      .run(new Date(Date.now() - 1000).toISOString(), approvalId);
    const before = await bankSnapshot();
    // Act
    const result = await api('POST', `approvals/${approvalId}/confirm`, { as: 'lucia' });
    // Assert
    assert.equal(result.status, 409);
    assert.deepEqual(await bankSnapshot(), before);
  });

  it('should hide a proposal from another customer as not found', async () => {
    // Arrange
    const approvalId = await propose();
    const before = await bankSnapshot();
    // Act
    const result = await api('POST', `approvals/${approvalId}/confirm`, { as: 'bruno' });
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
    const result = await api('GET', 'incidents', { as: 'marta' });
    // Assert
    assert.equal(result.status, 200);
    assert.equal(result.body.length, 17);
  });

  it('should reject a customer', async () => {
    // Arrange
    // Act
    const result = await api('GET', 'incidents', { as: 'lucia' });
    // Assert
    assert.equal(result.status, 403);
  });
});

describe('GET /api/incidents/:id', () => {
  beforeEach(() => seedApp());

  it('should return the case with its customer and last message to an operator', async () => {
    // Arrange
    const [incident] = (await api('GET', 'incidents', { as: 'marta' })).body;
    // Act
    const result = await api('GET', `incidents/${incident.id}`, { as: 'marta' });
    // Assert
    assert.equal(result.status, 200);
    assert.equal(result.body.incident.id, incident.id);
    assert.equal(result.body.customer.id, incident.user_id);
    assert.equal(result.body.lastMessage.conversation_id, incident.conversation_id);
  });

  it('should report an unknown case as not found', async () => {
    // Arrange
    // Act
    const result = await api('GET', 'incidents/does-not-exist', { as: 'marta' });
    // Assert
    assert.equal(result.status, 404);
  });

  it('should reject a customer', async () => {
    // Arrange
    // Act
    const result = await api('GET', 'incidents/does-not-exist', { as: 'lucia' });
    // Assert
    assert.equal(result.status, 403);
  });
});

describe('GET /api/documents', () => {
  beforeEach(() => seedApp());

  it('should list only the 68 public documents to a customer', async () => {
    // Arrange
    // Act
    const result = await api('GET', 'documents', { as: 'lucia' });
    // Assert
    assert.equal(result.status, 200);
    assert.equal(result.body.documents.length, 68);
    assert.ok(result.body.documents.every((d: any) => d.audience === 'public'));
  });

  it('should list all 80 documents to an operator', async () => {
    // Arrange
    // Act
    const result = await api('GET', 'documents', { as: 'marta' });
    // Assert
    assert.equal(result.body.documents.length, 80);
    assert.ok(result.body.index.chunks > 0);
  });
});

describe('GET /api/documents/:id', () => {
  beforeEach(() => seedApp());

  it('should return a public document with its text to a customer', async () => {
    // Arrange
    const id = publicDocumentId();
    // Act
    const result = await api('GET', `documents/${id}`, { as: 'lucia' });
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
    const result = await api('GET', `documents/${id}`, { as: 'lucia' });
    // Assert
    assert.equal(result.status, 404);
  });

  it('should return an internal document to an operator', async () => {
    // Arrange
    const id = internalDocumentId();
    // Act
    const result = await api('GET', `documents/${id}`, { as: 'marta' });
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
    const result = await api('GET', `documents/${id}/chunks`, { as: 'lucia' });
    // Assert
    assert.equal(result.status, 200);
    assert.ok(result.body.length > 0);
    assert.ok(result.body.every((c: any) => c.documentId === id && !('vector' in c)));
  });

  it('should hide the chunks of an internal document from a customer', async () => {
    // Arrange
    const id = internalDocumentId();
    // Act
    const result = await api('GET', `documents/${id}/chunks`, { as: 'lucia' });
    // Assert
    assert.equal(result.status, 404);
  });
});

describe('POST /api/preview-answer', () => {
  let fake: FakeOpenAI;
  const source = {
    id: 'chunk-1',
    documentId: 'doc-1',
    text: 'Card limits are 1,000 EUR per day.',
    title: 'Cards',
    version: 1,
    validFrom: '2026-01-01',
    validTo: null,
    audience: 'public',
    score: 0.9,
  };
  before(async () => {
    fake = await startFakeOpenAI();
  });
  after(() => fake.close());
  beforeEach(() => fake.reset());

  it('should answer an operator question from the supplied sources', async () => {
    // Arrange
    fake.script(reply('The daily card limit is 1,000 EUR.'));
    // Act
    const result = await api('POST', 'preview-answer', {
      as: 'marta',
      body: { question: 'What is the card limit?', sources: [source] },
    });
    // Assert
    assert.equal(result.status, 200);
    assert.equal(result.body.answer, 'The daily card limit is 1,000 EUR.');
    const sent = fake.requests.find((r) => r.path.endsWith('/responses'))!;
    assert.equal(sent.body.input, 'What is the card limit?');
    assert.match(sent.body.instructions, /1,000 EUR per day/);
  });

  it('should reject a customer', async () => {
    // Arrange
    const body = { question: 'What is the card limit?', sources: [source] };
    // Act
    const result = await api('POST', 'preview-answer', { as: 'lucia', body });
    // Assert
    assert.equal(result.status, 403);
    assert.equal(fake.requests.length, 0);
  });

  it('should reject more than ten sources', async () => {
    // Arrange
    const body = { question: 'What is the card limit?', sources: Array(11).fill(source) };
    // Act
    const result = await api('POST', 'preview-answer', { as: 'marta', body });
    // Assert
    assert.equal(result.status, 400);
    assert.equal(fake.requests.length, 0);
  });
});

describe('POST /api/ingestion', () => {
  it('should reject a customer', async () => {
    // Arrange
    // Act
    const result = await api('POST', 'ingestion', { as: 'lucia' });
    // Assert
    assert.equal(result.status, 403);
  });
});

describe('unknown routes', () => {
  it('should answer an unknown route with not found', async () => {
    // Arrange
    // Act
    const result = await api('GET', 'does-not-exist', { as: 'lucia' });
    // Assert
    assert.equal(result.status, 404);
    assert.equal(result.body.error, 'Route not found.');
  });
});
