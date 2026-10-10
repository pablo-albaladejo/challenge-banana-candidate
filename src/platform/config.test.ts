import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { faker } from '@faker-js/faker';
import { assertProductionSecrets, loadConfig } from './config';

const strongSecret = () => faker.string.alphanumeric({ length: 40 });
const strongSecrets = () => ({
  BANK_SERVICE_SECRET: strongSecret(),
  BANK_ADMIN_SECRET: strongSecret(),
  SESSION_SECRET: strongSecret(),
});

describe('loadConfig', () => {
  it('should apply the local defaults when the environment is empty', () => {
    // Arrange
    const env = {};
    // Act
    const config = loadConfig(env);
    // Assert
    assert.deepEqual(config, {
      dataDir: path.resolve('.data'),
      bankDataDir: path.resolve('.data'),
      bankUrl: 'http://127.0.0.1:4001',
      bankPort: 4001,
      appPort: 3000,
      serviceSecret: 'banana-local-service',
      adminSecret: 'banana-local-admin',
      sessionSecret: 'banana-local-session',
      chatModel: 'gpt-6-luna',
      embeddingModel: 'text-embedding-3-small',
      bankTimeoutMs: 1400,
    });
  });
  it('should take every value from the environment when it is set', () => {
    // Arrange
    const secrets = strongSecrets();
    const env = {
      ...secrets,
      DATA_DIR: '/srv/app-data',
      BANK_DATA_DIR: '/srv/bank-data',
      BANK_URL: 'http://bank.internal:9000',
      BANK_PORT: '9000',
      APP_PORT: '8080',
      OPENAI_CHAT_MODEL: 'chat-model',
      OPENAI_EMBEDDING_MODEL: 'embedding-model',
      BANK_TIMEOUT_MS: '2500',
    };
    // Act
    const config = loadConfig(env);
    // Assert
    assert.deepEqual(config, {
      dataDir: '/srv/app-data',
      bankDataDir: '/srv/bank-data',
      bankUrl: 'http://bank.internal:9000',
      bankPort: 9000,
      appPort: 8080,
      serviceSecret: secrets.BANK_SERVICE_SECRET,
      adminSecret: secrets.BANK_ADMIN_SECRET,
      sessionSecret: secrets.SESSION_SECRET,
      chatModel: 'chat-model',
      embeddingModel: 'embedding-model',
      bankTimeoutMs: 2500,
    });
  });
  it('should keep the bank data in the app data directory when only DATA_DIR is set', () => {
    // Arrange
    const env = { DATA_DIR: '/srv/shared-data' };
    // Act
    const config = loadConfig(env);
    // Assert
    assert.equal(config.bankDataDir, '/srv/shared-data');
  });
  it('should parse ports and the bank timeout as numbers', () => {
    // Arrange
    const env = { BANK_PORT: '4555', APP_PORT: '3555', BANK_TIMEOUT_MS: '900' };
    // Act
    const config = loadConfig(env);
    // Assert
    assert.equal(config.bankPort, 4555);
    assert.equal(config.appPort, 3555);
    assert.equal(config.bankTimeoutMs, 900);
  });
  it('should resolve relative data directories to absolute paths', () => {
    // Arrange
    const env = { DATA_DIR: 'relative-data', BANK_DATA_DIR: 'relative-bank' };
    // Act
    const config = loadConfig(env);
    // Assert
    assert.equal(config.dataDir, path.resolve('relative-data'));
    assert.equal(config.bankDataDir, path.resolve('relative-bank'));
  });
  it('should load a configuration from an empty environment without throwing', () => {
    // Arrange
    const env = {};
    // Act & Assert
    assert.doesNotThrow(() => loadConfig(env));
  });
});

describe('assertProductionSecrets', () => {
  it('should accept the local default secrets outside production', () => {
    // Arrange
    const config = loadConfig({});
    // Act & Assert
    assert.doesNotThrow(() => assertProductionSecrets(config, 'development'));
  });
  it('should accept long secrets in production', () => {
    // Arrange
    const config = loadConfig(strongSecrets());
    // Act & Assert
    assert.doesNotThrow(() => assertProductionSecrets(config, 'production'));
  });
  it('should reject a missing secret in production', () => {
    // Arrange
    const config = { ...loadConfig(strongSecrets()), sessionSecret: '' };
    // Act & Assert
    assert.throws(() => assertProductionSecrets(config, 'production'), /SESSION_SECRET/);
  });
  it('should reject the short local default secrets in production', () => {
    // Arrange
    const config = loadConfig({});
    // Act & Assert
    assert.throws(
      () => assertProductionSecrets(config, 'production'),
      /BANK_SERVICE_SECRET, BANK_ADMIN_SECRET, SESSION_SECRET/,
    );
  });
});
