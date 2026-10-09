// Preloaded with --import before every test file. node:test runs each file in its own process,
// so every file gets isolated databases and its own bank port. src/config.ts reads the environment
// at import time, which is why this must run before any application module is loaded.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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
// dotenv never overrides a defined variable, so an empty key keeps a real one in .env.local
// from reaching tests: they must not spend quota or depend on model output. Tests that need a
// model use tests/support/openai.ts, which points the SDK at a local fake.
process.env.OPENAI_API_KEY = '';
delete process.env.OPENAI_BASE_URL;
process.on('exit', () => fs.rmSync(temp, { recursive: true, force: true }));
