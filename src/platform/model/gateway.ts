// The one place the app talks to the model provider: every Responses and Embeddings call goes
// through here, so retries, timeouts, the missing-key error and the provider choice (OpenAI or
// claude-cli, see ./provider.ts) are decided once.
import OpenAI from 'openai';
import type { EmbeddingCreateParams } from 'openai/resources/embeddings';
import type {
  Response,
  ResponseCreateParamsNonStreaming,
} from 'openai/resources/responses/responses';
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
/** After a quota fallback, `auto` skips OpenAI for this long (it would fail the same way). */
export const quotaMemoMs = 5 * 60_000;
let now = () => Date.now();
let quotaExhaustedUntil = 0;
let lastFallbackAt: string | undefined;
let announcedAutoCli = false;
/** Replaces the time source (tests) and forgets the quota memo, last fallback and one-time log. */
export function setGatewayClock(clock: () => number = () => Date.now()) {
  now = clock;
  quotaExhaustedUntil = 0;
  lastFallbackAt = undefined;
  announcedAutoCli = false;
}
/** When the last OpenAI quota fallback happened (ISO time), if any since start-up. */
export const lastModelFallbackAt = () => lastFallbackAt;
/**
 * The provider a call starts with. The claude binary is only probed (once, cached) when the
 * answer depends on it: `auto` without an OpenAI key, or within `quotaMemoMs` of a quota fallback
 * (then claude-cli answers at once). `auto` resolving to claude-cli without a key is logged once.
 */
export async function activeProvider(): Promise<ModelProvider> {
  const env = process.env;
  const auto = providerSetting(env) === 'auto';
  const quotaExhausted = auto && now() < quotaExhaustedUntil;
  const probe = auto && (quotaExhausted || !env.OPENAI_API_KEY?.trim());
  const available = probe && (await claudeCliAvailable());
  if (quotaExhausted && available) return 'claude-cli';
  const provider = selectProvider(env, available)!;
  if (auto && provider === 'claude-cli' && !announcedAutoCli) {
    announcedAutoCli = true;
    console.info(
      JSON.stringify({ event: 'model_provider_auto', provider, reason: 'no OPENAI_API_KEY' }),
    );
  }
  return provider;
}
/**
 * The provider to retry a failed OpenAI call with (claude-cli on a quota error in `auto` mode when
 * the binary is available), or `undefined` to rethrow. A fallback is logged (an embeddings call
 * falls back to lexical search) and remembered for `quotaMemoMs`.
 */
export async function fallbackProvider(error: unknown, operation: 'responses' | 'embeddings') {
  const available = isQuotaError(error) && (await claudeCliAvailable());
  const provider = selectProvider(process.env, available, error);
  if (provider) {
    quotaExhaustedUntil = now() + quotaMemoMs;
    lastFallbackAt = new Date(now()).toISOString();
    console.warn(
      JSON.stringify({
        event: 'model_provider_fallback',
        operation,
        from: 'openai',
        to: operation === 'embeddings' ? 'lexical' : provider,
        code: (error as { code?: string }).code,
      }),
    );
  }
  return provider;
}
/**
 * Per-call OpenAI request options (`timeout`, `maxRetries`, `signal`), on top of the client's
 * defaults. claude-cli has its own time limit and ignores them.
 */
export type ResponseRequestOptions = Parameters<OpenAI['responses']['create']>[1];
/** A Responses call and the provider that actually answered it (after any quota fallback). */
export async function createAttributedResponse(
  body: ResponseCreateParamsNonStreaming,
  options?: ResponseRequestOptions,
): Promise<{ provider: ModelProvider; response: Response }> {
  if ((await activeProvider()) === 'claude-cli')
    return { provider: 'claude-cli', response: await createClaudeResponse(body) };
  try {
    return { provider: 'openai', response: await openai().responses.create(body, options) };
  } catch (e) {
    if (!(await fallbackProvider(e, 'responses'))) throw e;
    return { provider: 'claude-cli', response: await createClaudeResponse(body) };
  }
}
export async function createResponse(
  body: ResponseCreateParamsNonStreaming,
  options?: ResponseRequestOptions,
) {
  return (await createAttributedResponse(body, options)).response;
}
/** OpenAI only: Claude has no embeddings. Search falls back to lexical retrieval instead. */
export async function createEmbeddings(body: EmbeddingCreateParams) {
  return openai().embeddings.create(body);
}
