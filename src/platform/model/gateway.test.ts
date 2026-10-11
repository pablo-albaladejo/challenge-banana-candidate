import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {
  activeProvider,
  createEmbeddings,
  createResponse,
  fallbackProvider,
  lastModelFallbackAt,
  MissingOpenAIKeyError,
  openai,
  quotaMemoMs,
  setGatewayClock,
} from './gateway';
import { reply, startFakeOpenAI, type FakeOpenAI } from '../../../tests/support/openai';
import { claudeText, startFakeClaude, type FakeClaude } from '../../../tests/support/claude-cli';

/** Runs `act` with some variables set (`undefined` deletes one), then restores them. */
async function withEnv<T>(vars: Record<string, string | undefined>, act: () => Promise<T>) {
  const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  const apply = (values: Record<string, string | undefined>) => {
    for (const [key, value] of Object.entries(values))
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
  };
  apply(vars);
  try {
    return await act();
  } finally {
    apply(saved);
  }
}
const missingBin = path.join(os.tmpdir(), 'no-such-claude-binary');
const quota = {
  status: 429,
  error: 'You exceeded your current quota.',
  code: 'insufficient_quota',
};
describe('openai', () => {
  it('should reject a blank API key with MissingOpenAIKeyError', () => {
    // Arrange
    const original = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = '   ';
    // Act & Assert
    try {
      assert.throws(() => openai(), MissingOpenAIKeyError);
    } finally {
      process.env.OPENAI_API_KEY = original;
    }
  });
  it('should build a fresh client per call with 2 retries and a 45 s timeout', () => {
    // Arrange
    const original = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'test-key';
    // Act
    try {
      const first = openai();
      const second = openai();
      // Assert
      assert.notEqual(first, second);
      assert.equal(first.maxRetries, 2);
      assert.equal(first.timeout, 45000);
    } finally {
      process.env.OPENAI_API_KEY = original;
    }
  });
});
describe('createResponse', () => {
  let fake: FakeOpenAI;
  before(async () => {
    fake = await startFakeOpenAI();
  });
  after(() => fake.close());
  beforeEach(() => fake.reset());
  it('should send the request body to the Responses API and return its answer', async () => {
    // Arrange
    fake.script(reply('Hello.'));
    const body = { model: 'test-model', input: 'Hi', store: false };
    // Act
    const response = await createResponse(body);
    // Assert
    assert.equal(response.output_text, 'Hello.');
    assert.deepEqual(
      fake.requests.map((r) => [r.path, r.body]),
      [['/v1/responses', body]],
    );
  });
});
describe('createEmbeddings', () => {
  let fake: FakeOpenAI;
  before(async () => {
    fake = await startFakeOpenAI();
  });
  after(() => fake.close());
  beforeEach(() => fake.reset());
  it('should send the request body to the Embeddings API and return its vectors', async () => {
    // Arrange
    const vector = [0.6, 0.8];
    fake.embed('a text', vector);
    const body = {
      model: 'test-embedding',
      input: ['a text'],
      dimensions: 2,
      encoding_format: 'float' as const,
    };
    // Act
    const response = await createEmbeddings(body);
    // Assert
    assert.deepEqual(
      response.data.map((d) => d.embedding),
      [vector],
    );
    assert.deepEqual(
      fake.requests.map((r) => [r.path, r.body]),
      [['/v1/embeddings', body]],
    );
  });
});

describe('createResponse provider selection', () => {
  let fake: FakeOpenAI;
  let claude: FakeClaude;
  before(async () => {
    fake = await startFakeOpenAI();
    claude = startFakeClaude();
  });
  after(async () => {
    await fake.close();
    claude.close();
  });
  beforeEach(() => {
    fake.reset();
    claude.reset();
    setGatewayClock();
  });

  it('should reject a cleared key with MissingOpenAIKeyError under forced openai even when claude is available', async () => {
    // Arrange
    const vars = { MODEL_PROVIDER: 'openai', OPENAI_API_KEY: '' };
    // Act & Assert
    await withEnv(vars, () =>
      assert.rejects(createResponse({ model: 'm', input: 'Hi' }), MissingOpenAIKeyError),
    );
    assert.equal(claude.calls().length, 0);
  });

  it('should answer through claude-cli in auto mode when no key is configured', async (t) => {
    // Arrange
    t.mock.method(console, 'info', () => {});
    claude.script(claudeText('Hello from Claude.'));
    const vars = { MODEL_PROVIDER: 'auto', OPENAI_API_KEY: '' };
    // Act
    const response = await withEnv(vars, () => createResponse({ model: 'm', input: 'Hi' }));
    // Assert
    assert.equal(response.output_text, 'Hello from Claude.');
    assert.equal(fake.requests.length, 0);
    assert.equal(claude.calls().length, 1);
  });

  it('should keep the missing-key error in auto mode when the claude binary is unavailable', async () => {
    // Arrange
    const vars = { MODEL_PROVIDER: undefined, OPENAI_API_KEY: '', CLAUDE_CLI_BIN: missingBin };
    // Act & Assert
    await withEnv(vars, () =>
      assert.rejects(createResponse({ model: 'm', input: 'Hi' }), MissingOpenAIKeyError),
    );
  });

  it('should retry a quota failure with claude-cli in auto mode and log the fallback', async (t) => {
    // Arrange
    const warn = t.mock.method(console, 'warn', () => {});
    fake.script(quota);
    claude.script(claudeText('Answered by Claude.'));
    // Act
    const response = await withEnv({ MODEL_PROVIDER: 'auto' }, () =>
      createResponse({ model: 'm', input: 'Hi' }),
    );
    // Assert
    assert.equal(response.output_text, 'Answered by Claude.');
    assert.equal(fake.requests.length, 1);
    assert.deepEqual(JSON.parse(warn.mock.calls[0].arguments[0] as string), {
      event: 'model_provider_fallback',
      operation: 'responses',
      from: 'openai',
      to: 'claude-cli',
      code: 'insufficient_quota',
    });
  });

  it('should fall back after the SDK has retried a quota failure that does not forbid retries', async (t) => {
    // Arrange
    t.mock.method(console, 'warn', () => {});
    const retryable = { ...quota, retryable: true };
    fake.script(retryable, retryable, retryable);
    claude.script(claudeText('Answered by Claude.'));
    // Act
    const response = await withEnv({ MODEL_PROVIDER: 'auto' }, () =>
      createResponse({ model: 'm', input: 'Hi' }),
    );
    // Assert
    assert.equal(response.output_text, 'Answered by Claude.');
    assert.equal(fake.requests.length, 3);
  });

  it('should go straight to claude-cli for five minutes after a quota fallback', async (t) => {
    // Arrange
    t.mock.method(console, 'warn', () => {});
    let clock = Date.parse('2026-09-24T10:00:00Z');
    setGatewayClock(() => clock);
    fake.script(quota, reply('OpenAI is back.'));
    claude.script(claudeText('First.'), claudeText('Second.'));
    const ask = () =>
      withEnv({ MODEL_PROVIDER: 'auto' }, () => createResponse({ model: 'm', input: 'Hi' }));
    // Act
    await ask();
    clock += quotaMemoMs - 1;
    const remembered = await ask();
    clock += 2;
    const expired = await ask();
    // Assert
    assert.equal(remembered.output_text, 'Second.');
    assert.equal(expired.output_text, 'OpenAI is back.');
    assert.equal(fake.requests.length, 2);
    assert.equal(lastModelFallbackAt(), '2026-09-24T10:00:00.000Z');
  });

  it('should log an embeddings quota fallback as a fallback to lexical search', async (t) => {
    // Arrange
    const warn = t.mock.method(console, 'warn', () => {});
    const error = Object.assign(new Error('quota'), { status: 429, code: 'insufficient_quota' });
    // Act
    const provider = await withEnv({ MODEL_PROVIDER: 'auto' }, () =>
      fallbackProvider(error, 'embeddings'),
    );
    // Assert
    assert.equal(provider, 'claude-cli');
    assert.equal(JSON.parse(warn.mock.calls[0].arguments[0] as string).to, 'lexical');
  });

  it('should rethrow a quota failure under forced openai', async () => {
    // Arrange
    fake.script(quota);
    // Act & Assert
    await withEnv({ MODEL_PROVIDER: 'openai' }, () =>
      assert.rejects(createResponse({ model: 'm', input: 'Hi' }), { status: 429 }),
    );
    assert.equal(claude.calls().length, 0);
  });

  it('should rethrow a transient rate limit in auto mode', async () => {
    // Arrange
    fake.script({ status: 429, error: 'Slow down.', code: 'rate_limit_exceeded' });
    // Act & Assert
    await withEnv({ MODEL_PROVIDER: 'auto' }, () =>
      assert.rejects(createResponse({ model: 'm', input: 'Hi' }), { status: 429 }),
    );
    assert.equal(claude.calls().length, 0);
  });
});

describe('activeProvider', () => {
  let claude: FakeClaude;
  before(() => {
    claude = startFakeClaude();
  });
  after(() => claude.close());
  beforeEach(() => setGatewayClock());

  it('should log once that auto mode resolved to claude-cli', async (t) => {
    // Arrange
    const info = t.mock.method(console, 'info', () => {});
    const vars = { MODEL_PROVIDER: 'auto', OPENAI_API_KEY: '' };
    // Act
    const providers = await withEnv(vars, async () => [
      await activeProvider(),
      await activeProvider(),
    ]);
    // Assert
    assert.deepEqual(providers, ['claude-cli', 'claude-cli']);
    assert.equal(info.mock.callCount(), 1);
    assert.deepEqual(JSON.parse(info.mock.calls[0].arguments[0] as string), {
      event: 'model_provider_auto',
      provider: 'claude-cli',
      reason: 'no OPENAI_API_KEY',
    });
  });

  it('should resolve forced claude-cli without probing for a key', async () => {
    // Arrange
    const vars = { MODEL_PROVIDER: 'claude-cli', OPENAI_API_KEY: 'sk-test' };
    // Act
    const provider = await withEnv(vars, () => activeProvider());
    // Assert
    assert.equal(provider, 'claude-cli');
  });

  it('should resolve openai in auto mode when the binary is unavailable and no key is set', async () => {
    // Arrange
    const vars = { MODEL_PROVIDER: 'auto', OPENAI_API_KEY: '', CLAUDE_CLI_BIN: missingBin };
    // Act
    const provider = await withEnv(vars, () => activeProvider());
    // Assert
    assert.equal(provider, 'openai');
  });
});
