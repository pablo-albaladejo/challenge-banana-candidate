// The claude-cli provider: answers a Responses API request by running `claude -p` (a Claude
// subscription instead of OpenAI credit). Opt-in through MODEL_PROVIDER, or the `auto` fallback
// decided in ./provider.ts. Only the gateway calls it.
import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {
  FunctionTool,
  Response,
  ResponseCreateParamsNonStreaming,
  ResponseOutputItem,
} from 'openai/resources/responses/responses';

/** A failed claude-cli call. `status` 502 makes callers report "The AI provider returned 502". */
export class ClaudeCliError extends Error {
  readonly status = 502;
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'ClaudeCliError';
  }
}

export const claudeCliBin = () => process.env.CLAUDE_CLI_BIN?.trim() || 'claude';
export const claudeCliModel = () => process.env.CLAUDE_CLI_MODEL?.trim() || 'haiku';
export const claudeCliTimeoutMs = 120_000;
/** Belt and braces on top of --safe-mode: oh-my-claudecode reads these before running a hook. */
const skippedHooks =
  'keyword-detector,persistent-mode,session-start,pre-tool-use,post-tool-use,stop,subagent-start';

/** The answer an agent turn must match: a reply to the customer, or tool calls for the server. */
export const agentTurnSchema = {
  type: 'object',
  properties: {
    type: { type: 'string', enum: ['message', 'tool_calls'] },
    text: { type: 'string' },
    calls: {
      type: 'array',
      items: {
        type: 'object',
        properties: { name: { type: 'string' }, arguments: { type: 'object' } },
        required: ['name', 'arguments'],
      },
    },
  },
  required: ['type'],
};

export type ClaudeRequest = {
  /** `agent`: tools offered; `structured`: a caller-given json_schema; `text`: plain answer. */
  mode: 'agent' | 'structured' | 'text';
  systemPrompt: string;
  prompt: string;
  jsonSchema?: Record<string, unknown>;
};

type ContentPart = { type?: string; text?: string; refusal?: string };
function contentText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return (content as ContentPart[])
    .map((part) => part.text ?? part.refusal ?? `[${part.type ?? 'content'} omitted]`)
    .join('\n');
}
const roleLabel: Record<string, string> = {
  user: 'User',
  assistant: 'Assistant',
  system: 'System',
  developer: 'Developer',
};

/** The Responses `input` as a transcript the CLI reads on stdin. Reasoning items are dropped. */
function transcript(input: ResponseCreateParamsNonStreaming['input']): string {
  if (typeof input === 'string') return input;
  const lines: string[] = [];
  // Read loosely: the input union has dozens of item types and only four matter here.
  for (const entry of (input ?? []) as unknown as Record<string, unknown>[]) {
    if (entry.type === 'function_call')
      lines.push(
        `Assistant called tool ${entry.name} (call ${entry.call_id}) with arguments: ${entry.arguments}`,
      );
    else if (entry.type === 'function_call_output')
      lines.push(
        `Tool result (call ${entry.call_id}): ${
          typeof entry.output === 'string' ? entry.output : contentText(entry.output)
        }`,
      );
    else if ('role' in entry && (entry.type === undefined || entry.type === 'message'))
      lines.push(`${roleLabel[entry.role as string] ?? 'User'}: ${contentText(entry.content)}`);
  }
  return lines.join('\n\n');
}

/** Pure: the Responses request as a system prompt, a stdin prompt and an output schema. */
export function toClaudeRequest(body: ResponseCreateParamsNonStreaming): ClaudeRequest {
  const instructions = typeof body.instructions === 'string' ? body.instructions : '';
  const tools = (body.tools ?? []).filter((t): t is FunctionTool => t.type === 'function');
  const format = body.text?.format;
  const prompt = transcript(body.input);
  if (format?.type === 'json_schema')
    return { mode: 'structured', systemPrompt: instructions, prompt, jsonSchema: format.schema };
  if (!tools.length) return { mode: 'text', systemPrompt: instructions, prompt };
  const toolList = tools
    .map(
      (t) =>
        `- ${t.name}: ${t.description ?? ''}\n  parameters (JSON schema): ${JSON.stringify(t.parameters)}`,
    )
    .join('\n');
  const protocol = [
    '# Tools',
    'The server runs these tools for you and gives you their results in the next turn.',
    toolList,
    '',
    '# How to answer',
    'Answer with a JSON object that matches the output schema:',
    '- {"type":"tool_calls","calls":[{"name":"<tool>","arguments":{...}}]} to call tools, with arguments that match the tool parameters exactly;',
    '- {"type":"message","text":"<your reply to the customer>"} to answer the customer.',
    body.parallel_tool_calls === false ? 'Call at most one tool per turn.' : '',
    'The conversation so far is on stdin; write only the next assistant turn.',
  ]
    .filter((line, i, all) => line || all[i - 1])
    .join('\n');
  return {
    mode: 'agent',
    systemPrompt: [instructions, protocol].filter(Boolean).join('\n\n'),
    prompt,
    jsonSchema: agentTurnSchema,
  };
}

/** Pure: the argv for one isolated, tool-less, non-persistent `claude -p` call. */
export function claudeCliArgs(request: ClaudeRequest, model: string): string[] {
  return [
    '-p',
    '--safe-mode',
    '--model',
    model,
    '--output-format',
    'json',
    '--system-prompt',
    request.systemPrompt,
    '--tools',
    '',
    '--setting-sources',
    '',
    '--strict-mcp-config',
    '--mcp-config',
    '{"mcpServers":{}}',
    '--settings',
    '{"disableAllHooks":true}',
    '--no-session-persistence',
    '--disable-slash-commands',
    ...(request.jsonSchema ? ['--json-schema', JSON.stringify(request.jsonSchema)] : []),
  ];
}

const badOutput = (detail: string) =>
  new ClaudeCliError(`claude-cli returned unreadable output (${detail}).`, 'claude_cli_bad_output');

/** JSON from a string that may be wrapped in a ```json fence; `undefined` when it is not JSON. */
function parseJson(text: string): unknown {
  const unfenced = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  try {
    return JSON.parse(unfenced);
  } catch {
    return undefined;
  }
}

type CliResult = {
  is_error?: boolean;
  subtype?: string;
  result?: unknown;
  structured_output?: unknown;
  modelUsage?: Record<string, unknown>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
};
type AgentTurn = { type?: unknown; text?: unknown; calls?: unknown };
type AgentCall = { name?: unknown; arguments?: unknown };

const message = (text: string): ResponseOutputItem => ({
  type: 'message',
  id: `msg_cli_${randomUUID()}`,
  role: 'assistant',
  status: 'completed',
  content: [{ type: 'output_text', text, annotations: [] }],
});

/** The output items of an agent turn, or a bad-output error when it matches neither shape. */
function agentOutput(turn: AgentTurn, oneCall: boolean): ResponseOutputItem[] {
  if (turn.type === 'message' && typeof turn.text === 'string') return [message(turn.text)];
  const calls = Array.isArray(turn.calls) ? (turn.calls as AgentCall[]) : [];
  if (turn.type !== 'tool_calls' || !calls.length || calls.some((c) => typeof c.name !== 'string'))
    throw badOutput('neither a message nor tool calls');
  return (oneCall ? calls.slice(0, 1) : calls).map((call) => ({
    type: 'function_call',
    id: `fc_cli_${randomUUID()}`,
    call_id: `call_cli_${randomUUID()}`,
    name: call.name as string,
    arguments:
      typeof call.arguments === 'string' ? call.arguments : JSON.stringify(call.arguments ?? {}),
    status: 'completed',
  }));
}

/** Pure but for ids and the clock: the CLI's JSON result as the Responses object callers read. */
export function fromClaudeResult(
  stdout: string,
  request: ClaudeRequest,
  body: ResponseCreateParamsNonStreaming,
): Response {
  const parsed = parseJson(stdout);
  if (!parsed || typeof parsed !== 'object') throw badOutput('not the CLI JSON result');
  const cli = parsed as CliResult;
  if (cli.is_error || (cli.subtype && cli.subtype !== 'success'))
    throw new ClaudeCliError(
      `claude-cli reported an error (${cli.subtype ?? 'is_error'}).`,
      'claude_cli_error',
    );
  const resultText = typeof cli.result === 'string' ? cli.result : '';
  let output: ResponseOutputItem[];
  if (request.mode === 'text') output = [message(resultText)];
  else {
    const data = cli.structured_output ?? parseJson(resultText);
    if (data === undefined || data === null) throw badOutput('no structured output');
    output =
      request.mode === 'structured'
        ? [message(JSON.stringify(data))]
        : agentOutput(data as AgentTurn, body.parallel_tool_calls === false);
  }
  const outputText = output
    .flatMap((item) => (item.type === 'message' ? item.content : []))
    .map((part) => (part.type === 'output_text' ? part.text : ''))
    .join('');
  // As at OpenAI, input_tokens counts the cached ones too (the CLI reports them apart).
  const cached = cli.usage?.cache_read_input_tokens ?? 0,
    written = cli.usage?.cache_creation_input_tokens ?? 0,
    input = (cli.usage?.input_tokens ?? 0) + cached + written,
    outputTokens = cli.usage?.output_tokens ?? 0;
  return {
    id: `resp_cli_${randomUUID()}`,
    object: 'response',
    created_at: Math.floor(Date.now() / 1000),
    status: 'completed',
    model: Object.keys(cli.modelUsage ?? {})[0] ?? claudeCliModel(),
    output,
    output_text: outputText,
    error: null,
    incomplete_details: null,
    instructions: body.instructions ?? null,
    metadata: { provider: 'claude-cli' },
    parallel_tool_calls: body.parallel_tool_calls ?? true,
    temperature: null,
    top_p: null,
    tool_choice: 'auto',
    tools: body.tools ?? [],
    usage: {
      input_tokens: input,
      input_tokens_details: {
        cached_tokens: cached,
        cache_write_tokens: written,
      },
      output_tokens: outputTokens,
      output_tokens_details: { reasoning_tokens: 0 },
      total_tokens: input + outputTokens,
    },
  };
}

type RunOptions = { bin?: string; timeoutMs?: number };

/**
 * Runs the binary with an argv array (never a shell) from a fresh temp dir, the prompt on stdin,
 * and OMC hooks switched off. Resolves its stdout; rejects with a `ClaudeCliError` when it cannot
 * start, exits non-zero or outlives `timeoutMs` (its whole process group is killed).
 */
function runClaudeCli(args: string[], stdin: string, options: RunOptions = {}): Promise<string> {
  const bin = options.bin ?? claudeCliBin();
  const timeoutMs = options.timeoutMs ?? claudeCliTimeoutMs;
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'banana-claude-'));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DISABLE_OMC: '1',
    OMC_SKIP_HOOKS: skippedHooks,
  };
  // Nothing the CLI needs: keep the OpenAI key out of it, and do not look nested in Claude Code.
  delete env.OPENAI_API_KEY;
  delete env.CLAUDECODE;
  return new Promise((resolve, reject) => {
    let stdout = '',
      stderr = '',
      timedOut = false;
    const child = spawn(bin, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], detached: true });
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        process.kill(-child.pid!, 'SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
    }, timeoutMs);
    const done = (error?: ClaudeCliError) => {
      clearTimeout(timer);
      fs.rmSync(cwd, { recursive: true, force: true });
      if (error) reject(error);
      else resolve(stdout);
    };
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.stdin.on('error', () => {});
    child.on('error', (e: NodeJS.ErrnoException) =>
      done(
        new ClaudeCliError(
          `claude-cli could not start ${bin} (${e.code ?? e.message}).`,
          'claude_cli_unavailable',
        ),
      ),
    );
    child.on('close', (code) => {
      if (timedOut)
        done(
          new ClaudeCliError(`claude-cli timed out after ${timeoutMs} ms.`, 'claude_cli_timeout'),
        );
      else if (code !== 0)
        done(
          new ClaudeCliError(
            `claude-cli exited with code ${code}${stderr.trim() ? `: ${stderr.trim().slice(0, 200)}` : ''}.`,
            'claude_cli_exit',
          ),
        );
      else done();
    });
    child.stdin.end(stdin);
  });
}

/** A Responses API call answered by `claude -p`. */
export async function createClaudeResponse(
  body: ResponseCreateParamsNonStreaming,
  options: RunOptions = {},
): Promise<Response> {
  const request = toClaudeRequest(body);
  const stdout = await runClaudeCli(
    claudeCliArgs(request, claudeCliModel()),
    request.prompt,
    options,
  );
  return fromClaudeResult(stdout, request, body);
}

const availability = new Map<string, Promise<boolean>>();
/** Whether `<bin> --version` succeeds; checked once per binary path and cached. */
export function claudeCliAvailable(bin = claudeCliBin()): Promise<boolean> {
  let check = availability.get(bin);
  if (!check) {
    check = new Promise((resolve) =>
      execFile(bin, ['--version'], { timeout: 10_000 }, (error) => resolve(!error)),
    );
    availability.set(bin, check);
  }
  return check;
}
