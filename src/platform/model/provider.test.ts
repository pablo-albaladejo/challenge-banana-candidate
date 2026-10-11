import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isQuotaError, providerSetting, selectProvider } from './provider';

const quota = (code: string) => Object.assign(new Error('quota'), { status: 429, code });

describe('providerSetting', () => {
  it('should default to auto when MODEL_PROVIDER is unset', () => {
    // Arrange
    const env = {};
    // Act
    const setting = providerSetting(env);
    // Assert
    assert.equal(setting, 'auto');
  });

  it('should read a forced provider case-insensitively', () => {
    // Arrange
    const env = { MODEL_PROVIDER: ' Claude-CLI ' };
    // Act
    const setting = providerSetting(env);
    // Assert
    assert.equal(setting, 'claude-cli');
  });

  it('should treat an unknown value as auto', () => {
    // Arrange
    const env = { MODEL_PROVIDER: 'gemini' };
    // Act
    const setting = providerSetting(env);
    // Assert
    assert.equal(setting, 'auto');
  });
});

describe('isQuotaError', () => {
  it('should recognise a 429 with insufficient_quota', () => {
    // Arrange
    const error = quota('insufficient_quota');
    // Act
    const result = isQuotaError(error);
    // Assert
    assert.equal(result, true);
  });

  it('should recognise a 429 with credit_balance_exhausted in the error body', () => {
    // Arrange
    const error = { status: 429, error: { code: 'credit_balance_exhausted' } };
    // Act
    const result = isQuotaError(error);
    // Assert
    assert.equal(result, true);
  });

  it('should leave a plain rate limit and other failures to the caller', () => {
    // Arrange
    const errors = [
      quota('rate_limit_exceeded'),
      { status: 500, code: 'insufficient_quota' },
      new Error('boom'),
      undefined,
    ];
    // Act
    const results = errors.map(isQuotaError);
    // Assert
    assert.deepEqual(results, [false, false, false, false]);
  });
});

describe('selectProvider', () => {
  it('should use OpenAI in auto mode when a key is configured', () => {
    // Arrange
    const env = { OPENAI_API_KEY: 'sk-test' };
    // Act
    const provider = selectProvider(env, true);
    // Assert
    assert.equal(provider, 'openai');
  });

  it('should use claude-cli in auto mode when the key is blank and the binary is available', () => {
    // Arrange
    const env = { OPENAI_API_KEY: '  ' };
    // Act
    const provider = selectProvider(env, true);
    // Assert
    assert.equal(provider, 'claude-cli');
  });

  it('should keep OpenAI (and its missing-key error) in auto mode when there is no key and no binary', () => {
    // Arrange
    const env = {};
    // Act
    const provider = selectProvider(env, false);
    // Assert
    assert.equal(provider, 'openai');
  });

  it('should honour a forced provider whatever the key and binary', () => {
    // Arrange
    const forcedOpenai = { MODEL_PROVIDER: 'openai' };
    const forcedCli = { MODEL_PROVIDER: 'claude-cli', OPENAI_API_KEY: 'sk-test' };
    // Act
    const results = [selectProvider(forcedOpenai, true), selectProvider(forcedCli, false)];
    // Assert
    assert.deepEqual(results, ['openai', 'claude-cli']);
  });

  it('should retry a quota failure with claude-cli in auto mode when the binary is available', () => {
    // Arrange
    const env = { OPENAI_API_KEY: 'sk-test' };
    // Act
    const provider = selectProvider(env, true, quota('insufficient_quota'));
    // Assert
    assert.equal(provider, 'claude-cli');
  });

  it('should rethrow a quota failure when the binary is unavailable or the provider is forced', () => {
    // Arrange
    const auto = { OPENAI_API_KEY: 'sk-test' };
    const forced = { OPENAI_API_KEY: 'sk-test', MODEL_PROVIDER: 'openai' };
    const error = quota('credit_balance_exhausted');
    // Act
    const results = [selectProvider(auto, false, error), selectProvider(forced, true, error)];
    // Assert
    assert.deepEqual(results, [undefined, undefined]);
  });

  it('should rethrow any failure that is not a quota error', () => {
    // Arrange
    const env = { OPENAI_API_KEY: 'sk-test' };
    const error = Object.assign(new Error('server'), { status: 500 });
    // Act
    const provider = selectProvider(env, true, error);
    // Assert
    assert.equal(provider, undefined);
  });
});
