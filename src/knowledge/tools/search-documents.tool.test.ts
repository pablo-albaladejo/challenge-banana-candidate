import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runTool } from '../../assistant';
import { seedApp } from '../../server/seed';
import { resetBank, startBank, stopBank } from '../../../tests/support/bank';
import { toolContextFactory } from '../../../tests/fixtures/factories';
import { allChunks } from '../search/store';
import { conversations } from '../../../tests/fixtures/world';
import type { ToolContext } from '../../types';

/** A run in lucia's welcome conversation, where a support case can be opened. */
const context = (overrides: Partial<ToolContext> = {}) =>
  toolContextFactory.build({ conversationId: conversations.luciaWelcome, ...overrides });

describe('runTool', () => {
  before(async () => {
    seedApp();
    await startBank();
  });
  after(stopBank);
  beforeEach(() => resetBank());

  it('should return the matching documentation chunk as the top source', async () => {
    // Arrange
    const chunk = allChunks().find((c) => c.audience === 'public')!;
    // Act
    const result = (await runTool('search_documents', { query: chunk.text }, context())) as {
      sources: { id: string; documentId: string; text: string }[];
    };
    // Assert
    assert.equal(result.sources[0].id, chunk.id);
    assert.equal(result.sources[0].documentId, chunk.documentId);
    assert.ok(result.sources.length <= 5);
  });

  it('should restrict customer documentation searches to public sources', async () => {
    // Arrange
    const internal = allChunks().find((c) => c.audience !== 'public')!;
    // Act
    const result = (await runTool('search_documents', { query: internal.text }, context())) as {
      sources: { id: string; audience: string }[];
    };
    // Assert
    assert.ok(result.sources.every((s) => s.audience === 'public'));
    assert.ok(result.sources.every((s) => s.id !== internal.id));
  });

  it('should reject a documentation search without a query as a failed result', async () => {
    // Arrange
    const ctx = context();
    // Act
    const result = (await runTool('search_documents', {}, ctx)) as { status: string };
    // Assert
    assert.equal(result.status, 'failed');
  });
});
