import dotenv from 'dotenv';
import path from 'node:path';
dotenv.config({ path: '.env.local', quiet: true });
dotenv.config({ path: '.env', quiet: true });
type Env = Record<string, string | undefined>;
/** Pure: builds the configuration from an environment and never throws. */
export function loadConfig(env: Env) {
  return {
    dataDir: path.resolve(env.DATA_DIR || '.data'),
    bankDataDir: path.resolve(env.BANK_DATA_DIR || env.DATA_DIR || '.data'),
    bankUrl: env.BANK_URL || 'http://127.0.0.1:4001',
    bankPort: Number(env.BANK_PORT || 4001),
    appPort: Number(env.APP_PORT || 3000),
    serviceSecret: env.BANK_SERVICE_SECRET || 'banana-local-service',
    adminSecret: env.BANK_ADMIN_SECRET || 'banana-local-admin',
    sessionSecret: env.SESSION_SECRET || 'banana-local-session',
    chatModel: env.OPENAI_CHAT_MODEL || 'gpt-6-luna',
    embeddingModel: env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small',
    bankTimeoutMs: Number(env.BANK_TIMEOUT_MS || 1400),
  };
}
export type Config = ReturnType<typeof loadConfig>;
/**
 * Mutable on purpose: tests (and `tests/support/network.ts`) change keys at runtime, so modules
 * read `config.x` at call time and never destructure it.
 */
export const config = loadConfig(process.env);
const MIN_SECRET_LENGTH = 32;
/** Pure: in production, every secret must be set and at least 32 characters long. */
export function assertProductionSecrets(config: Config, nodeEnv: string | undefined) {
  if (nodeEnv !== 'production') return;
  const secrets = {
    BANK_SERVICE_SECRET: config.serviceSecret,
    BANK_ADMIN_SECRET: config.adminSecret,
    SESSION_SECRET: config.sessionSecret,
  };
  const weak = Object.entries(secrets)
    .filter(([, value]) => !value || value.length < MIN_SECRET_LENGTH)
    .map(([name]) => name);
  if (weak.length)
    throw new Error(
      `Set ${weak.join(', ')} to random values of at least ${MIN_SECRET_LENGTH} characters in production.`,
    );
}
export const referenceDate = '2026-09-24';
