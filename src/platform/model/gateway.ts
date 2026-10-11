// The one place the app talks to the model provider: every Responses and Embeddings call goes
// through here, so retries, timeouts, the missing-key error and the provider choice (OpenAI or
// claude-cli, see ./provider.ts) are decided once.
import OpenAI from 'openai';
import type { EmbeddingCreateParams } from 'openai/resources/embeddings';
import type { ResponseCreateParamsNonStreaming } from 'openai/resources/responses/responses';
import { claudeCliAvailable, createClaudeResponse } from './claude-cli';
import { isQuotaError, providerSetting, selectProvider, type ModelProvider } from './provider';
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
/**
 * The provider a call starts with. The claude binary is only probed (once, cached) when the
 * answer depends on it: `auto` without an OpenAI key.
 */
export async function activeProvider(): Promise<ModelProvider> {
  const env = process.env;
  const probe = providerSetting(env) === 'auto' && !env.OPENAI_API_KEY?.trim();
  return selectProvider(env, probe && (await claudeCliAvailable()))!;
}
/**
 * The provider to retry a failed OpenAI call with (claude-cli on a quota error in `auto` mode when
 * the binary is available), or `undefined` to rethrow. A fallback is logged.
 */
export async function fallbackProvider(error: unknown, operation: string) {
  const available = isQuotaError(error) && (await claudeCliAvailable());
  const provider = selectProvider(process.env, available, error);
  if (provider)
    console.warn(
      JSON.stringify({
        event: 'model_provider_fallback',
        operation,
        from: 'openai',
        to: provider,
        code: (error as { code?: string }).code,
      }),
    );
  return provider;
}
export async function createResponse(body: ResponseCreateParamsNonStreaming) {
  if ((await activeProvider()) === 'claude-cli') return createClaudeResponse(body);
  try {
    return await openai().responses.create(body);
  } catch (e) {
    if (!(await fallbackProvider(e, 'responses'))) throw e;
    return createClaudeResponse(body);
  }
}
/** OpenAI only: Claude has no embeddings. Search falls back to lexical retrieval instead. */
export async function createEmbeddings(body: EmbeddingCreateParams) {
  return openai().embeddings.create(body);
}
