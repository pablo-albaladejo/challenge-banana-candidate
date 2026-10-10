// The one place the app talks to the model provider: every Responses and Embeddings call goes
// through here, so retries, timeouts and the missing-key error are decided once.
import OpenAI from 'openai';
import type { EmbeddingCreateParams } from 'openai/resources/embeddings';
import type { ResponseCreateParamsNonStreaming } from 'openai/resources/responses/responses';
export class MissingOpenAIKeyError extends Error {
  constructor() {
    super(
      'Set OPENAI_API_KEY in .env.local or the environment to use the agent and semantic search, then restart the services.',
    );
    this.name = 'MissingOpenAIKeyError';
  }
}
/** A new client per call, so a key set after start-up (or cleared by a test) takes effect. */
export function openai() {
  if (!process.env.OPENAI_API_KEY?.trim()) throw new MissingOpenAIKeyError();
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 2, timeout: 45000 });
}
export async function createResponse(body: ResponseCreateParamsNonStreaming) {
  return openai().responses.create(body);
}
export async function createEmbeddings(body: EmbeddingCreateParams) {
  return openai().embeddings.create(body);
}
