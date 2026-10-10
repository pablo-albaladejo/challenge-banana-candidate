import fs from 'node:fs';
import { seedApp } from '../src/server/seed';
import { seedBank } from '../simulator/seed';
import { config } from '../src/platform/config';
import { appDb } from '../src/platform/db/db';
import { bankDb } from '../simulator/db';
if (!fs.existsSync('.env.local')) {
  fs.copyFileSync('.env.example', '.env.local');
  console.log('Created .env.local: set OPENAI_API_KEY to use the assistant.');
}
if (!appDb().prepare('SELECT value FROM meta WHERE key=?').get('seed')) console.log(seedApp());
if (!(bankDb().prepare('SELECT COUNT(*) n FROM accounts').get() as { n: number }).n) seedBank();
console.log(`Ready. Data in ${config.dataDir}. Run npm run dev.`);
