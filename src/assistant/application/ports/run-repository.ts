export type NewRun = {
  id: string;
  userId: string;
  conversationId: string | null;
  startedAt: string;
  status: string;
  error: string | null;
};
export type RunRepository = {
  insert(r: NewRun): void;
  /** Sets the run status; the error is written only when one is given. */
  setStatus(id: string, status: string, error?: string): void;
};
