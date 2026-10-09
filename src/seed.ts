import { appDb } from './db';
import { existsSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { restoreIndex } from './retrieval/store';
import { documents } from './ingestion/pipeline';
import { insertConversation } from './persistence/conversations';
import { insertMessage } from './persistence/messages';
import { insertIncident } from './persistence/incidents';
import { insertIntent } from './persistence/intents';
export function seedApp() {
  const db = appDb();
  db.transaction(() => {
    db.exec(
      'DELETE FROM messages; DELETE FROM conversations; DELETE FROM incidents; DELETE FROM intents; DELETE FROM approvals; DELETE FROM events; DELETE FROM runs; DELETE FROM chunks; DELETE FROM embedding_cache; DELETE FROM meta;',
    );
    const histories: {
      id: string;
      userId: string;
      title: string;
      createdAt: string;
      messages: { role: string; content: string }[];
      case?: { id: string; status: string };
    }[] = JSON.parse(readFileSync(path.resolve('fixtures/conversations.json'), 'utf8'));
    for (const history of histories) {
      insertConversation({
        id: history.id,
        userId: history.userId,
        title: history.title,
        createdAt: history.createdAt,
      });
      history.messages.forEach((entry, index) => {
        const at = new Date(Date.parse(history.createdAt) + index * 10000).toISOString();
        insertMessage({
          id: `${history.id}-message-${index}`,
          conversationId: history.id,
          role: entry.role,
          content: entry.content,
          createdAt: at,
          runId: null,
        });
      });
      if (history.case) {
        insertIncident({
          id: history.case.id,
          userId: history.userId,
          conversationId: history.id,
          summary: history.messages.at(-1)!.content,
          status: history.case.status,
          createdAt: history.createdAt,
        });
      }
    }
    insertIntent({
      id: 'intent-historic-lucia',
      userId: 'lucia',
      conversationId: 'conv-lucia-support',
      runId: 'run-historic-lucia',
      payload: JSON.stringify({
        fromAccountId: 'acc-lucia',
        toAccountId: 'acc-bruno',
        amountCents: 8500,
        concept: 'Team dinner',
      }),
      status: 'failed',
      bankReference: 'ref-historic-lucia',
      operationId: null,
      error: 'No response received from the bank.',
      createdAt: '2026-09-23T16:41:12.000Z',
    });
    db.prepare('INSERT INTO meta(key,value) VALUES(?,?)').run('seed', 'banana-v3-2026-09-25');
  })();
  const index = path.resolve('fixtures/embeddings/index.json.gz');
  if (existsSync(index)) {
    restoreIndex(JSON.parse(gunzipSync(readFileSync(index)).toString()));
    // The supplied index only labels each document's first chunk; vectors depend on text alone,
    // so every chunk gets its document's title, version and validity from the manifest.
    const label = db.prepare(
      'UPDATE chunks SET title=?,version=?,valid_from=?,valid_to=? WHERE document_id=?',
    );
    db.transaction(() => {
      for (const d of documents()) label.run(d.title, d.version, d.validFrom, d.validTo, d.id);
    })();
  }
  return {
    conversations: (db.prepare('SELECT COUNT(*) n FROM conversations').get() as { n: number }).n,
    incidents: (db.prepare('SELECT COUNT(*) n FROM incidents').get() as { n: number }).n,
    indexLoaded: existsSync(index),
  };
}
