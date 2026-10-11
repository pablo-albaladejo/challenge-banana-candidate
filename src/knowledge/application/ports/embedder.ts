/** Text embeddings through the model gateway, cached by model, dimensions and text. */
export type Embedder = {
  /** False when the active model provider has no embeddings (claude-cli): search goes lexical. */
  available(): Promise<boolean>;
  embed(texts: string[]): Promise<number[][]>;
  /** Whether a failed `embed` may be answered lexically instead (the gateway's `auto` fallback). */
  fallsBackOn(error: unknown): Promise<boolean>;
};
