import dotenv from 'dotenv';
import path from 'node:path';
dotenv.config({ path: '.env.local', quiet: true });
dotenv.config({ path: '.env', quiet: true });
type Env = Record<string, string | undefined>;
/**
 * The public development secrets (also in `.env.example`): the fallback when a variable is unset,
 * and the values `assertProductionSecrets` refuses in production.
 */
export const localDefaultSecrets = {
  serviceSecret: 'banana-local-service',
  adminSecret: 'banana-local-admin',
  sessionSecret: 'banana-local-session',
} as const;
/** Pure: builds the configuration from an environment and never throws. */
export function loadConfig(env: Env) {
  return {
    dataDir: path.resolve(env.DATA_DIR || '.data'),
    bankDataDir: path.resolve(env.BANK_DATA_DIR || env.DATA_DIR || '.data'),
    bankUrl: env.BANK_URL || 'http://127.0.0.1:4001',
    bankPort: Number(env.BANK_PORT || 4001),
    appPort: Number(env.APP_PORT || 3000),
    serviceSecret: env.BANK_SERVICE_SECRET || localDefaultSecrets.serviceSecret,
    adminSecret: env.BANK_ADMIN_SECRET || localDefaultSecrets.adminSecret,
    sessionSecret: env.SESSION_SECRET || localDefaultSecrets.sessionSecret,
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
/** Case and `-`, `_`, `.`, space are ignored when secrets are compared. */
const normalized = (value: string) => value.toLowerCase().replace(/[-_ .]/g, '');
/**
 * Pure: in production, every secret must be set, at least 32 characters long, free of the public
 * local defaults (a padded default passes the length rule) and different from the other two.
 * The error names the variables, never their values. Low-entropy values are not detected.
 */
export function assertProductionSecrets(config: Config, nodeEnv: string | undefined) {
  if (nodeEnv !== 'production') return;
  const secrets = Object.entries({
    BANK_SERVICE_SECRET: config.serviceSecret,
    BANK_ADMIN_SECRET: config.adminSecret,
    SESSION_SECRET: config.sessionSecret,
  }).map(([name, value]) => ({ name, value, key: normalized(value ?? '') }));
  const defaults = Object.values(localDefaultSecrets).map(normalized);
  const isWeak = ({ value, key }: (typeof secrets)[number]) =>
    !value || value.length < MIN_SECRET_LENGTH || defaults.some((local) => key.includes(local));
  const weak = secrets.filter(isWeak).map(({ name }) => name);
  const strong = secrets.filter((secret) => !isWeak(secret));
  const reused = strong
    .filter((secret) => strong.some((other) => other !== secret && other.key === secret.key))
    .map(({ name }) => name);
  const problems = [
    weak.length
      ? `Set ${weak.join(', ')} to random values of at least ${MIN_SECRET_LENGTH} characters, not based on the local development defaults.`
      : '',
    reused.length ? `Give ${reused.join(', ')} different values, one per variable.` : '',
  ].filter(Boolean);
  if (problems.length) throw new Error(problems.join(' '));
}
export { referenceDate } from '../shared/domain/reference-date';
