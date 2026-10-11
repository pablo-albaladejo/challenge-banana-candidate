#!/usr/bin/env node
// A stand-in for the `claude` CLI, spawned by src/platform/model/claude-cli.ts in tests. It records
// every call (argv, stdin, cwd, the system prompt file, the env it got) to calls.jsonl and answers
// with the next turn queued in script.json (a JSON array, consumed in order). Both files sit next
// to this copy of the script: the adapter passes the child an allowlisted env, so no test variable
// can carry their paths. See tests/support/claude-cli.ts.
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
if (args.includes('--version')) {
  process.stdout.write('2.1.296 (Claude Code)\n');
  process.exit(0);
}

let stdin = '';
for await (const chunk of process.stdin) stdin += chunk;

const dir = path.dirname(process.argv[1]);
const scriptPath = path.join(dir, 'script.json');
const promptFile = args[args.indexOf('--system-prompt-file') + 1];
fs.appendFileSync(
  path.join(dir, 'calls.jsonl'),
  JSON.stringify({
    args,
    stdin,
    cwd: process.cwd(),
    systemPrompt:
      args.includes('--system-prompt-file') && fs.existsSync(promptFile)
        ? fs.readFileSync(promptFile, 'utf8')
        : undefined,
    envKeys: Object.keys(process.env).sort(),
    env: {
      DISABLE_OMC: process.env.DISABLE_OMC,
      OMC_SKIP_HOOKS: process.env.OMC_SKIP_HOOKS,
    },
  }) + '\n',
);

const turns = fs.existsSync(scriptPath) ? JSON.parse(fs.readFileSync(scriptPath, 'utf8')) : [];
const turn = turns.shift();
fs.writeFileSync(scriptPath, JSON.stringify(turns));

const result = (fields) =>
  JSON.stringify({
    type: 'result',
    subtype: fields.isError ? 'error_during_execution' : 'success',
    is_error: !!fields.isError,
    duration_ms: 1,
    num_turns: 1,
    result: fields.result ?? '',
    ...(fields.structured === undefined ? {} : { structured_output: fields.structured }),
    session_id: 'fake-session',
    total_cost_usd: 0,
    usage: { input_tokens: 11, output_tokens: 7, cache_read_input_tokens: 0 },
    modelUsage: { 'claude-fake-haiku': { inputTokens: 11, outputTokens: 7 } },
  });

if (!turn) {
  process.stderr.write('No scripted claude turn left.\n');
  process.exit(1);
}
if (turn.kind === 'hang') setInterval(() => {}, 60_000);
else if (turn.kind === 'exit') {
  process.stderr.write(turn.stderr ?? '');
  process.exit(turn.code);
} else if (turn.kind === 'raw') process.stdout.write(turn.stdout);
else if (turn.kind === 'split') {
  // The result written in two chunks, cut after the first byte of its first multi-byte character.
  const bytes = Buffer.from(result({ result: turn.text }));
  const at = bytes.findIndex((b) => b >= 0x80) + 1;
  process.stdout.write(bytes.subarray(0, at));
  setTimeout(() => process.stdout.write(bytes.subarray(at)), 50);
} else if (turn.kind === 'flood') {
  // Writes `bytes` to the stream in 64 KiB chunks, then hangs: only the output cap can stop it.
  const stream = turn.stream === 'stderr' ? process.stderr : process.stdout;
  const chunk = Buffer.alloc(64 * 1024, 'x');
  let left = turn.bytes;
  const pump = () => {
    while (left > 0) {
      left -= chunk.length;
      if (!stream.write(chunk)) return stream.once('drain', pump);
    }
  };
  pump();
  setInterval(() => {}, 60_000);
} else process.stdout.write(result(turn));
