import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import type { ResponseCreateParamsNonStreaming } from 'openai/resources/responses/responses';
import {
  agentTurnSchema,
  ClaudeCliError,
  claudeCliArgs,
  claudeCliAvailable,
  createClaudeResponse,
  fromClaudeResult,
  toClaudeRequest,
} from './claude-cli';
import {
  claudeMessage,
  claudeText,
  claudeToolCalls,
  startFakeClaude,
  type FakeClaude,
} from '../../../tests/support/claude-cli';
import { goldenToolDefinitions } from '../../../tests/fixtures/tool-definitions';

const agentBody = (
  overrides: Partial<ResponseCreateParamsNonStreaming> = {},
): ResponseCreateParamsNonStreaming => ({
  model: 'gpt-test',
  instructions: 'You are Banana Bank.',
  input: [{ role: 'user', content: 'What do I have?' }],
  tools: goldenToolDefinitions as ResponseCreateParamsNonStreaming['tools'],
  parallel_tool_calls: false,
  reasoning: { effort: 'low' },
  max_output_tokens: 2000,
  store: false,
  ...overrides,
});
const cliOutput = (fields: Record<string, unknown>) =>
  JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: '', ...fields });

describe('toClaudeRequest', () => {
  it('should put the instructions and every function tool with its schema in the system prompt', () => {
    // Arrange
    const body = agentBody();
    // Act
    const request = toClaudeRequest(body);
    // Assert
    assert.equal(request.mode, 'agent');
    assert.ok(request.systemPrompt.startsWith('You are Banana Bank.'));
    for (const tool of goldenToolDefinitions) {
      assert.ok(request.systemPrompt.includes(`- ${tool.name}: ${tool.description}`));
      assert.ok(request.systemPrompt.includes(JSON.stringify(tool.parameters)));
    }
    assert.match(request.systemPrompt, /at most one tool/i);
    assert.deepEqual(request.jsonSchema, agentTurnSchema);
  });

  it('should render messages, tool calls and tool results as a readable transcript', () => {
    // Arrange
    const body = agentBody({
      input: [
        { role: 'user', content: 'Send 5 euros to Bruno' },
        {
          type: 'message',
          id: 'msg_1',
          role: 'assistant',
          status: 'completed',
          content: [{ type: 'output_text', text: 'Checking.', annotations: [] }],
        },
        { type: 'reasoning', id: 'rs_1', summary: [] },
        {
          type: 'function_call',
          call_id: 'call_1',
          name: 'list_accounts',
          arguments: '{}',
        },
        { type: 'function_call_output', call_id: 'call_1', output: '{"accounts":[]}' },
      ],
    });
    // Act
    const { prompt } = toClaudeRequest(body);
    // Assert
    assert.ok(prompt.includes('User: Send 5 euros to Bruno'));
    assert.ok(prompt.includes('Assistant: Checking.'));
    assert.ok(
      prompt.includes('Assistant called tool list_accounts (call call_1) with arguments: {}'),
    );
    assert.ok(prompt.includes('Tool result (call call_1): {"accounts":[]}'));
    assert.ok(!prompt.includes('rs_1'));
  });

  it('should pass a json_schema text format through as the output schema', () => {
    // Arrange
    const schema = { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] };
    const body: ResponseCreateParamsNonStreaming = {
      model: 'gpt-test',
      input: 'Is it ok?',
      text: { format: { type: 'json_schema', name: 'verdict', schema, strict: true } },
    };
    // Act
    const request = toClaudeRequest(body);
    // Assert
    assert.equal(request.mode, 'structured');
    assert.deepEqual(request.jsonSchema, schema);
  });

  it('should send a plain string input as the prompt with no schema when there are no tools', () => {
    // Arrange
    const body: ResponseCreateParamsNonStreaming = { model: 'gpt-test', input: 'Say hi' };
    // Act
    const request = toClaudeRequest(body);
    // Assert
    assert.deepEqual(request, { mode: 'text', systemPrompt: '', prompt: 'Say hi' });
  });
});

describe('claudeCliArgs', () => {
  it('should isolate the call from tools, MCP, settings, hooks and session persistence', () => {
    // Arrange
    const request = toClaudeRequest(agentBody());
    // Act
    const args = claudeCliArgs(request, 'haiku');
    // Assert
    const value = (flag: string) => args[args.indexOf(flag) + 1];
    assert.equal(args[0], '-p');
    assert.equal(value('--model'), 'haiku');
    assert.equal(value('--output-format'), 'json');
    assert.equal(value('--tools'), '');
    assert.equal(value('--setting-sources'), '');
    assert.equal(value('--mcp-config'), '{"mcpServers":{}}');
    assert.equal(value('--settings'), '{"disableAllHooks":true}');
    assert.equal(value('--system-prompt'), request.systemPrompt);
    assert.deepEqual(JSON.parse(value('--json-schema')), agentTurnSchema);
    for (const flag of [
      '--safe-mode',
      '--strict-mcp-config',
      '--no-session-persistence',
      '--disable-slash-commands',
    ])
      assert.ok(args.includes(flag), flag);
  });

  it('should leave out the schema flag for a plain-text call', () => {
    // Arrange
    const request = toClaudeRequest({ model: 'gpt-test', input: 'Say hi' });
    // Act
    const args = claudeCliArgs(request, 'haiku');
    // Assert
    assert.ok(!args.includes('--json-schema'));
  });
});

describe('fromClaudeResult', () => {
  it('should translate tool calls into function_call items with JSON string arguments', () => {
    // Arrange
    const body = agentBody({ parallel_tool_calls: true });
    const stdout = cliOutput({
      structured_output: {
        type: 'tool_calls',
        calls: [
          { name: 'list_accounts', arguments: {} },
          { name: 'search_documents', arguments: { query: 'fees' } },
        ],
      },
    });
    // Act
    const response = fromClaudeResult(stdout, toClaudeRequest(body), body);
    // Assert
    const calls = response.output.filter((x) => x.type === 'function_call');
    assert.deepEqual(
      calls.map((c) => [c.name, c.arguments]),
      [
        ['list_accounts', '{}'],
        ['search_documents', '{"query":"fees"}'],
      ],
    );
    assert.ok(calls.every((c) => c.call_id && c.status === 'completed'));
    assert.notEqual(calls[0].call_id, calls[1].call_id);
    assert.equal(response.output_text, '');
  });

  it('should keep only the first call when parallel tool calls are off', () => {
    // Arrange
    const body = agentBody();
    const stdout = cliOutput({
      structured_output: {
        type: 'tool_calls',
        calls: [
          { name: 'list_accounts', arguments: {} },
          { name: 'list_accounts', arguments: {} },
        ],
      },
    });
    // Act
    const response = fromClaudeResult(stdout, toClaudeRequest(body), body);
    // Assert
    assert.equal(response.output.length, 1);
  });

  it('should translate a message turn into an assistant message and output_text', () => {
    // Arrange
    const body = agentBody();
    const stdout = cliOutput({
      structured_output: { type: 'message', text: 'You have two accounts.' },
      modelUsage: { 'claude-haiku-x': {} },
      usage: {
        input_tokens: 4,
        cache_read_input_tokens: 20,
        cache_creation_input_tokens: 6,
        output_tokens: 5,
      },
    });
    // Act
    const response = fromClaudeResult(stdout, toClaudeRequest(body), body);
    // Assert
    assert.equal(response.output_text, 'You have two accounts.');
    assert.deepEqual(response.output[0], {
      type: 'message',
      id: response.output[0].id,
      role: 'assistant',
      status: 'completed',
      content: [{ type: 'output_text', text: 'You have two accounts.', annotations: [] }],
    });
    assert.equal(response.model, 'claude-haiku-x');
    assert.equal(response.status, 'completed');
    assert.deepEqual(response.metadata, { provider: 'claude-cli' });
    assert.equal(response.usage?.input_tokens, 30);
    assert.equal(response.usage?.input_tokens_details.cached_tokens, 20);
    assert.equal(response.usage?.total_tokens, 35);
  });

  it('should read an agent turn the CLI left as JSON text in result', () => {
    // Arrange
    const body = agentBody();
    const stdout = cliOutput({ result: '```json\n{"type":"message","text":"Hi."}\n```' });
    // Act
    const response = fromClaudeResult(stdout, toClaudeRequest(body), body);
    // Assert
    assert.equal(response.output_text, 'Hi.');
  });

  it('should return a structured answer as JSON output_text', () => {
    // Arrange
    const body: ResponseCreateParamsNonStreaming = {
      model: 'gpt-test',
      input: 'Is it ok?',
      text: { format: { type: 'json_schema', name: 'v', schema: { type: 'object' } } },
    };
    const stdout = cliOutput({ structured_output: { ok: true } });
    // Act
    const response = fromClaudeResult(stdout, toClaudeRequest(body), body);
    // Assert
    assert.deepEqual(JSON.parse(response.output_text), { ok: true });
  });

  it('should reject unreadable output with a 502 ClaudeCliError', () => {
    // Arrange
    const body = agentBody();
    // Act & Assert
    assert.throws(() => fromClaudeResult('Hook output: hello\n{', toClaudeRequest(body), body), {
      name: 'ClaudeCliError',
      status: 502,
      code: 'claude_cli_bad_output',
    });
  });

  it('should reject an error the CLI reports with a 502 ClaudeCliError', () => {
    // Arrange
    const body = agentBody();
    const stdout = cliOutput({ is_error: true, subtype: 'error_during_execution', result: 'x' });
    // Act & Assert
    assert.throws(() => fromClaudeResult(stdout, toClaudeRequest(body), body), {
      status: 502,
      code: 'claude_cli_error',
    });
  });

  it('should reject an agent turn that is neither a message nor tool calls', () => {
    // Arrange
    const body = agentBody();
    const stdout = cliOutput({ structured_output: { type: 'tool_calls', calls: [] } });
    // Act & Assert
    assert.throws(() => fromClaudeResult(stdout, toClaudeRequest(body), body), {
      status: 502,
      code: 'claude_cli_bad_output',
    });
  });
});

describe('createClaudeResponse', () => {
  let fake: FakeClaude;
  before(() => {
    fake = startFakeClaude();
  });
  after(() => fake.close());
  beforeEach(() => fake.reset());

  it('should send the transcript on stdin from a fresh temp dir with OMC disabled and no OpenAI key', async () => {
    // Arrange
    fake.script(claudeMessage('Hello.'));
    const original = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'sk-secret';
    // Act
    let response;
    try {
      response = await createClaudeResponse(agentBody());
    } finally {
      process.env.OPENAI_API_KEY = original;
    }
    // Assert
    const [call] = fake.calls();
    assert.equal(response.output_text, 'Hello.');
    assert.ok(call.stdin.includes('User: What do I have?'));
    assert.ok(!call.args.some((a) => a.includes('What do I have?')));
    assert.match(path.basename(call.cwd), /^banana-claude-/);
    assert.equal(call.env.DISABLE_OMC, '1');
    assert.match(call.env.OMC_SKIP_HOOKS!, /keyword-detector/);
    assert.equal(call.env.OPENAI_API_KEY, undefined);
    assert.equal(fake.flag(call, '--model'), 'haiku');
  });

  it('should use the model named by CLAUDE_CLI_MODEL', async () => {
    // Arrange
    fake.script(claudeText('ok'));
    process.env.CLAUDE_CLI_MODEL = 'sonnet';
    // Act
    try {
      await createClaudeResponse({ model: 'gpt-test', input: 'Say ok' });
    } finally {
      delete process.env.CLAUDE_CLI_MODEL;
    }
    // Assert
    assert.equal(fake.flag(fake.calls()[0], '--model'), 'sonnet');
  });

  it('should answer a tool round through the binary', async () => {
    // Arrange
    fake.script(claudeToolCalls({ name: 'list_accounts', arguments: {} }));
    // Act
    const response = await createClaudeResponse(agentBody());
    // Assert
    assert.deepEqual(
      response.output.map((x) => x.type === 'function_call' && [x.name, x.arguments]),
      [['list_accounts', '{}']],
    );
  });

  it('should reject a non-zero exit with a 502 ClaudeCliError', async () => {
    // Arrange
    fake.script({ kind: 'exit', code: 3, stderr: 'not logged in' });
    // Act & Assert
    await assert.rejects(createClaudeResponse(agentBody()), {
      name: 'ClaudeCliError',
      status: 502,
      code: 'claude_cli_exit',
    });
  });

  it('should reject output that is not the CLI JSON with a 502 ClaudeCliError', async () => {
    // Arrange
    fake.script({ kind: 'raw', stdout: 'SessionStart hook says hi' });
    // Act & Assert
    await assert.rejects(createClaudeResponse(agentBody()), {
      status: 502,
      code: 'claude_cli_bad_output',
    });
  });

  it('should kill a call that exceeds the timeout and reject with a 502 ClaudeCliError', async () => {
    // Arrange
    fake.script({ kind: 'hang' });
    const started = Date.now();
    // Act & Assert
    await assert.rejects(createClaudeResponse(agentBody(), { timeoutMs: 300 }), {
      status: 502,
      code: 'claude_cli_timeout',
    });
    assert.ok(Date.now() - started < 5000);
  });

  it('should reject with a 502 ClaudeCliError when the binary cannot be started', async () => {
    // Arrange
    const bin = path.join(os.tmpdir(), 'no-such-claude-binary');
    // Act & Assert
    await assert.rejects(createClaudeResponse(agentBody(), { bin }), (e) => {
      assert.ok(e instanceof ClaudeCliError);
      assert.equal(e.status, 502);
      assert.equal(e.code, 'claude_cli_unavailable');
      return true;
    });
  });
});

describe('claudeCliAvailable', () => {
  let fake: FakeClaude;
  before(() => {
    fake = startFakeClaude();
  });
  after(() => fake.close());

  it('should report a binary that answers --version as available', async () => {
    // Arrange
    // Act
    const available = await claudeCliAvailable(fake.bin);
    // Assert
    assert.equal(available, true);
  });

  it('should report a missing binary as unavailable', async () => {
    // Arrange
    const bin = path.join(os.tmpdir(), 'no-such-claude-binary');
    // Act
    const available = await claudeCliAvailable(bin);
    // Assert
    assert.equal(available, false);
  });
});
