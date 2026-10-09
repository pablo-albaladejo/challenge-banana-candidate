// Preloaded with --import before every test file. node:test runs each file in its own process,
// so every file gets isolated databases. src/config.ts reads the environment at import time,
// which is why this must run before any application module is loaded.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'banana-tests-'));
process.env.DATA_DIR = temp;
process.env.BANK_DATA_DIR = temp;
// dotenv never overrides a defined variable, so an empty key keeps a real one in .env.local
// from reaching tests: they must not spend quota or depend on model output.
process.env.OPENAI_API_KEY = '';
process.on('exit', () => fs.rmSync(temp, { recursive: true, force: true }));
