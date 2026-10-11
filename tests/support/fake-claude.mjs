#!/usr/bin/env node
// A stand-in for the `claude` CLI, spawned by src/platform/model/claude-cli.ts in tests. It records
// every call (argv, stdin, cwd, the isolation env) to FAKE_CLAUDE_LOG and answers with the next turn
// queued in FAKE_CLAUDE_SCRIPT (a JSON array, consumed in order). See tests/support/claude-cli.ts.
import fs from 'node:fs';

const args = process.argv.slice(2);
if (args.includes('--version')) {
  process.stdout.write('2.1.296 (Claude Code)\n');
  process.exit(0);
}

let stdin = '';
for await (const chunk of process.stdin) stdin += chunk;

const { FAKE_CLAUDE_SCRIPT: scriptPath, FAKE_CLAUDE_LOG: logPath } = process.env;
if (logPath)
  fs.appendFileSync(
    logPath,
    JSON.stringify({
      args,
      stdin,
      cwd: process.cwd(),
      env: {
        DISABLE_OMC: process.env.DISABLE_OMC,
        OMC_SKIP_HOOKS: process.env.OMC_SKIP_HOOKS,
        OPENAI_API_KEY: process.env.OPENAI_API_KEY,
      },
    }) + '\n',
  );

const turns =
  scriptPath && fs.existsSync(scriptPath) ? JSON.parse(fs.readFileSync(scriptPath, 'utf8')) : [];
const turn = turns.shift();
if (scriptPath) fs.writeFileSync(scriptPath, JSON.stringify(turns));

if (!turn) {
  process.stderr.write('No scripted claude turn left.\n');
  process.exit(1);
}
if (turn.kind === 'hang') setInterval(() => {}, 60_000);
else if (turn.kind === 'exit') {
  process.stderr.write(turn.stderr ?? '');
  process.exit(turn.code);
} else if (turn.kind === 'raw') process.stdout.write(turn.stdout);
else
  process.stdout.write(
    JSON.stringify({
      type: 'result',
      subtype: turn.isError ? 'error_during_execution' : 'success',
      is_error: !!turn.isError,
      duration_ms: 1,
      num_turns: 1,
      result: turn.result ?? '',
      ...(turn.structured === undefined ? {} : { structured_output: turn.structured }),
      session_id: 'fake-session',
      total_cost_usd: 0,
      usage: { input_tokens: 11, output_tokens: 7, cache_read_input_tokens: 0 },
      modelUsage: { 'claude-fake-haiku': { inputTokens: 11, outputTokens: 7 } },
    }),
  );
