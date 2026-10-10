// Readers of the app database that tests use to assert what the application stored.
// Rows keep their SQLite column names, so a failing assertion shows exactly what is on disk.
import { appDb } from '../../src/platform/db/db';
import type { IntentRow } from '../../src/transfers/intents.repo';
import type { EventRow } from '../../src/platform/telemetry/events.repo';

export type RunRow = {
  user_id: string;
  conversation_id: string | null;
  status: string;
  error: string | null;
};

export const intentRow = (id: string) =>
  appDb().prepare('SELECT * FROM intents WHERE id=?').get(id) as IntentRow | undefined;

/** How many approvals were created for an intent. */
export const approvalsFor = (intentId: string) =>
  (
    appDb().prepare('SELECT COUNT(*) AS n FROM approvals WHERE intent_id=?').get(intentId) as {
      n: number;
    }
  ).n;

export const runOf = (runId: string) =>
  appDb()
    .prepare('SELECT user_id,conversation_id,status,error FROM runs WHERE id=?')
    .get(runId) as RunRow;

export const latestRun = () =>
  appDb().prepare('SELECT id FROM runs ORDER BY rowid DESC LIMIT 1').get() as { id: string };

export const messagesOf = (runId: string) =>
  appDb()
    .prepare('SELECT role,content FROM messages WHERE run_id=? ORDER BY created_at,rowid')
    .all(runId) as { role: string; content: string }[];

/** Every stored event, as raw rows. */
export const events = () => appDb().prepare('SELECT * FROM events').all() as EventRow[];

/** The events of one run in recording order, with their data parsed. */
export const eventsFor = (runId: string) =>
  (
    appDb()
      .prepare('SELECT kind,user_id,data FROM events WHERE run_id=? ORDER BY rowid')
      .all(runId) as Pick<EventRow, 'kind' | 'user_id' | 'data'>[]
  ).map((e) => ({ kind: e.kind, userId: e.user_id, data: JSON.parse(e.data) }));
