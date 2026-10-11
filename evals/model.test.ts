import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { setGatewayClock } from '../src/platform/model/gateway';
import { claudeText, startFakeClaude, type FakeClaude } from '../tests/support/claude-cli';
import { reply, startFakeOpenAI, type FakeOpenAI } from '../tests/support/openai';
import { gatewayModel } from './model';

describe('gatewayModel', () => {
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

  it('should send the request through the model gateway', async () => {
    // Arrange
    fake.script(reply('Hello Lucía'));
    const model = gatewayModel();
    // Act
    const response = await model.createResponse({ model: 'gpt-6-luna', input: 'Say hello' });
    // Assert
    assert.equal(response.output_text, 'Hello Lucía');
    assert.equal(fake.requests[0].body.input, 'Say hello');
  });

  it('should record the provider and the model that answered', async () => {
    // Arrange
    fake.script(reply('one'), reply('two'));
    const model = gatewayModel();
    // Act
    await model.createResponse({ model: 'gpt-6-luna', input: 'a' });
    await model.createResponse({ model: 'gpt-6-luna', input: 'b' });
    // Assert
    assert.deepEqual(model.observed(), { providers: ['openai'], models: ['gpt-6-luna'] });
  });

  it('should report no provider when the subject never called the model', () => {
    // Arrange
    const model = gatewayModel();
    // Act
    const observed = model.observed();
    // Assert
    assert.deepEqual(observed, { providers: [], models: [] });
  });
  it('should attribute an answer to claude-cli when an OpenAI quota error falls back to it', async (t) => {
    // Arrange
    t.mock.method(console, 'warn', () => {});
    fake.script({
      status: 429,
      error: 'You exceeded your current quota.',
      code: 'insufficient_quota',
    });
    claude.script(claudeText('Answered by Claude.'));
    const model = gatewayModel();
    const saved = process.env.MODEL_PROVIDER;
    process.env.MODEL_PROVIDER = 'auto';
    // Act
    try {
      await model.createResponse({ model: 'gpt-6-luna', input: 'a' });
    } finally {
      process.env.MODEL_PROVIDER = saved;
    }
    // Assert
    assert.deepEqual(model.observed(), {
      providers: ['claude-cli'],
      models: ['claude-fake-haiku'],
    });
  });
});
