// Preloaded with --import before every test file. node:test runs each file in its own process,
// so every file gets isolated databases and its own bank port. src/config.ts reads the environment
// at import time, which is why this must run before any application module is loaded.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { faker } from '@faker-js/faker';
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'banana-tests-'));
// A free port must be known synchronously, before config is imported; ask a short-lived child.
const port = execFileSync(process.execPath, [
  '-e',
  "const s=require('net').createServer().listen(0,'127.0.0.1',()=>{process.stdout.write(String(s.address().port));s.close()})",
])
  .toString()
  .trim();
process.env.DATA_DIR = temp;
process.env.BANK_DATA_DIR = temp;
process.env.BANK_PORT = port;
process.env.BANK_URL = `http://127.0.0.1:${port}`;
// A secret per file lets tests/support/bank.ts tell its own simulator from another file's process.
process.env.BANK_ADMIN_SECRET = `test-admin-${randomUUID()}`;
// dotenv never overrides a defined variable, so an empty key keeps a real one in .env.local
// from reaching tests: they must not spend quota or depend on model output. Tests that need a
// model use tests/support/openai.ts, which points the SDK at a local fake.
process.env.OPENAI_API_KEY = '';
delete process.env.OPENAI_BASE_URL;
process.on('exit', () => fs.rmSync(temp, { recursive: true, force: true }));
// One Faker seed per run: `npm test` sets TEST_SEED in tests/global-setup.ts and every file inherits
// it. A single file run without TEST_SEED gets its own seed, printed so a failure can be replayed.
if (!/^\d+$/.test(process.env.TEST_SEED ?? '')) {
  process.env.TEST_SEED = String(Math.floor(Math.random() * 2 ** 31));
  console.log(
    `Test seed ${process.env.TEST_SEED} · reproduce with TEST_SEED=${process.env.TEST_SEED} and the same command`,
  );
}
faker.seed(Number(process.env.TEST_SEED));
