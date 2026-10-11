/** An agent event as the `events` table holds it; `data` is still JSON. */
export type CaseEventRow = {
  id: string;
  run_id: string;
  user_id: string;
  conversation_id: string | null;
  kind: string;
  data: string;
  created_at: string;
};
/** The agent events of a conversation. */
export type EventReader = {
  /** A conversation's events in recording order. */
  inConversation(conversationId: string): CaseEventRow[];
};
