// A local stand-in for the `claude` binary: tests/support/fake-claude.mjs, copied into a temp dir
// as an executable and pointed at through CLAUDE_CLI_BIN. Tests script its turns and inspect what
// the adapter sent it (argv, stdin, cwd, system prompt, env), the way tests/support/openai.ts fakes
// OpenAI. The script and the call log live next to the copy, where the fake finds them itself.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type FakeClaudeTurn =
  | { kind: 'result'; result?: string; structured?: unknown; isError?: boolean }
  | { kind: 'exit'; code: number; stderr?: string }
  | { kind: 'raw'; stdout: string }
  /** A plain-text result written in two chunks cut inside its first multi-byte character. */
  | { kind: 'split'; text: string }
  /** `bytes` written to one stream, then a hang that only the output cap ends. */
  | { kind: 'flood'; stream: 'stdout' | 'stderr'; bytes: number }
  | { kind: 'hang' };
export type FakeClaudeCall = {
  args: string[];
  stdin: string;
  cwd: string;
  /** The content of the `--system-prompt-file` the adapter wrote. */
  systemPrompt?: string;
  /** Every variable name the fake inherited. */
  envKeys: string[];
  env: Record<string, string | undefined>;
};

/** An agent turn that answers the customer. */
export const claudeMessage = (text: string): FakeClaudeTurn => ({
  kind: 'result',
  structured: { type: 'message', text },
});
/** An agent turn that calls tools, each `{ name, arguments }`. */
export const claudeToolCalls = (...calls: { name: string; arguments: unknown }[]) =>
  ({ kind: 'result', structured: { type: 'tool_calls', calls } }) satisfies FakeClaudeTurn;
/** A plain-text answer (no tools, no schema). */
export const claudeText = (text: string): FakeClaudeTurn => ({ kind: 'result', result: text });

export type FakeClaude = {
  bin: string;
  script: (...turns: FakeClaudeTurn[]) => void;
  /** Every call made since the last reset, oldest first. */
  calls: () => FakeClaudeCall[];
  /** The value of a flag in a recorded call's argv (`--model` → `haiku`). */
  flag: (call: FakeClaudeCall, name: string) => string | undefined;
  reset: () => void;
  close: () => void;
};

const source = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fake-claude.mjs');

/** Installs the fake and points CLAUDE_CLI_BIN at it; `close()` restores the environment. */
export function startFakeClaude(): FakeClaude {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'banana-fake-claude-'));
  const bin = path.join(dir, 'claude.mjs');
  const scriptPath = path.join(dir, 'script.json');
  const logPath = path.join(dir, 'calls.jsonl');
  fs.copyFileSync(source, bin);
  fs.chmodSync(bin, 0o755);
  const saved = process.env.CLAUDE_CLI_BIN;
  process.env.CLAUDE_CLI_BIN = bin;
  const read = (): FakeClaudeTurn[] =>
    fs.existsSync(scriptPath) ? JSON.parse(fs.readFileSync(scriptPath, 'utf8')) : [];
  const reset = () => {
    fs.rmSync(scriptPath, { force: true });
    fs.rmSync(logPath, { force: true });
  };
  return {
    bin,
    script: (...turns) => fs.writeFileSync(scriptPath, JSON.stringify([...read(), ...turns])),
    calls: () =>
      fs.existsSync(logPath)
        ? fs
            .readFileSync(logPath, 'utf8')
            .split('\n')
            .filter(Boolean)
            .map((line) => JSON.parse(line))
        : [],
    flag: (call, name) => {
      const index = call.args.indexOf(name);
      return index === -1 ? undefined : call.args[index + 1];
    },
    reset,
    close: () => {
      if (saved === undefined) delete process.env.CLAUDE_CLI_BIN;
      else process.env.CLAUDE_CLI_BIN = saved;
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}
