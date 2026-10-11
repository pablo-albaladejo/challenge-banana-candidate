// Pure: which model provider serves a call. The gateway feeds it the environment, whether the
// claude binary answered `--version`, and (on a retry decision) the error OpenAI threw.
export type ModelProvider = 'openai' | 'claude-cli';
export type ProviderSetting = 'auto' | ModelProvider;
type Env = Record<string, string | undefined>;

/** OpenAI error codes that mean "no credit left", as opposed to a transient rate limit. */
export const quotaCodes = ['insufficient_quota', 'credit_balance_exhausted'];

/** `MODEL_PROVIDER`, trimmed and lower-cased; anything other than a known provider is `auto`. */
export function providerSetting(env: Env): ProviderSetting {
  const value = env.MODEL_PROVIDER?.trim().toLowerCase();
  return value === 'openai' || value === 'claude-cli' ? value : 'auto';
}

/** An HTTP 429 whose code (top level or in the error body) says the account is out of credit. */
export function isQuotaError(e: unknown): boolean {
  const error = e as { status?: unknown; code?: unknown; error?: { code?: unknown } } | undefined;
  const code = error?.code ?? error?.error?.code;
  return error?.status === 429 && typeof code === 'string' && quotaCodes.includes(code);
}

/**
 * Without `error`: the provider to try first. A forced setting always wins; `auto` uses OpenAI
 * when a key is configured, else claude-cli when its binary is available, else OpenAI (which then
 * throws `MissingOpenAIKeyError`, exactly as before). With the `error` an OpenAI call threw: the
 * provider to retry that call with (claude-cli, only in `auto`, only for a quota error, only when
 * the binary is available), or `undefined` to rethrow it.
 */
export function selectProvider(
  env: Env,
  cliAvailable: boolean,
  error?: unknown,
): ModelProvider | undefined {
  const setting = providerSetting(env);
  if (error !== undefined)
    return setting === 'auto' && cliAvailable && isQuotaError(error) ? 'claude-cli' : undefined;
  if (setting !== 'auto') return setting;
  if (env.OPENAI_API_KEY?.trim()) return 'openai';
  return cliAvailable ? 'claude-cli' : 'openai';
}
