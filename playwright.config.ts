import { defineConfig, devices } from '@playwright/test';
import { e2e } from './tests/support/e2e-env';
// The stack under test: the project's own dev launcher (bank + Next) on other ports, a fresh
// data dir, its own Next output dir, and a local fake model instead of OpenAI.
const stack = {
  DATA_DIR: e2e.dataDir,
  BANK_DATA_DIR: e2e.dataDir,
  APP_PORT: String(e2e.appPort),
  BANK_PORT: String(e2e.bankPort),
  BANK_URL: e2e.bankUrl,
  BANK_ADMIN_SECRET: e2e.adminSecret,
  NEXT_DIST_DIR: e2e.distDir,
  OPENAI_API_KEY: 'e2e-fake-key',
  OPENAI_BASE_URL: `http://127.0.0.1:${e2e.openaiPort}/v1`,
  NEXT_TELEMETRY_DISABLED: '1',
};
export default defineConfig({
  testDir: 'app',
  testMatch: '**/*.e2e.ts',
  // Journeys share one bank; run them one at a time so ledger assertions stay exact.
  workers: 1,
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: { baseURL: e2e.appUrl, trace: 'retain-on-failure', ...devices['Desktop Chrome'] },
  webServer: [
    {
      command: 'node --import tsx tests/support/fake-openai-server.ts',
      url: `http://127.0.0.1:${e2e.openaiPort}/health`,
      reuseExistingServer: false,
      env: stack,
      timeout: 30_000,
    },
    {
      command: `rm -rf ${e2e.dataDir} && node --import tsx scripts/setup.ts && node --import tsx scripts/dev.ts`,
      url: `${e2e.appUrl}/api/health`,
      reuseExistingServer: false,
      env: stack,
      timeout: 180_000,
    },
  ],
});
