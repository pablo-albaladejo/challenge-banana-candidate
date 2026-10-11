import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { faker } from '@faker-js/faker';
import {
  assertProductionSecrets,
  assertNoPersonaSwitcherInProduction,
  loadConfig,
  loadFeatureFlags,
  localDefaultSecrets,
} from './config';

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
  it('should fall back to the same local defaults the production check refuses', () => {
    // Arrange
    const env = {};
    // Act
    const config = loadConfig(env);
    // Assert
    assert.deepEqual(
      {
        serviceSecret: config.serviceSecret,
        adminSecret: config.adminSecret,
        sessionSecret: config.sessionSecret,
      },
      localDefaultSecrets,
    );
  });
  for (const [key, name] of [
    ['serviceSecret', 'BANK_SERVICE_SECRET'],
    ['adminSecret', 'BANK_ADMIN_SECRET'],
    ['sessionSecret', 'SESSION_SECRET'],
  ] as const) {
    it(`should reject a long ${name} built on its local default in production`, () => {
      // Arrange
      const padded = localDefaultSecrets[key] + strongSecret();
      const config = { ...loadConfig(strongSecrets()), [key]: padded };
      // Act & Assert
      assert.throws(
        () => assertProductionSecrets(config, 'production'),
        (e: Error) => e.message.includes(name) && !e.message.includes(padded),
      );
    });
  }
  it('should reject a long secret built on another secret’s local default in production', () => {
    // Arrange
    const config = {
      ...loadConfig(strongSecrets()),
      sessionSecret: strongSecret() + localDefaultSecrets.serviceSecret,
    };
    // Act & Assert
    assert.throws(() => assertProductionSecrets(config, 'production'), /SESSION_SECRET/);
  });
  it('should name the refused variables without revealing any secret value', () => {
    // Arrange
    const config = {
      ...loadConfig({}),
      sessionSecret: localDefaultSecrets.sessionSecret + strongSecret(),
    };
    const values = [config.serviceSecret, config.adminSecret, config.sessionSecret];
    // Act & Assert
    assert.throws(
      () => assertProductionSecrets(config, 'production'),
      (e: Error) =>
        e.message.includes('BANK_SERVICE_SECRET, BANK_ADMIN_SECRET, SESSION_SECRET') &&
        values.every((value) => !e.message.includes(value)),
    );
  });
  it('should reject a 31-character secret in production', () => {
    // Arrange
    const config = {
      ...loadConfig(strongSecrets()),
      adminSecret: faker.string.alphanumeric({ length: 31 }),
    };
    // Act & Assert
    assert.throws(() => assertProductionSecrets(config, 'production'), /BANK_ADMIN_SECRET/);
  });
  it('should accept 32-character secrets in production', () => {
    // Arrange
    const config = {
      ...loadConfig({}),
      serviceSecret: faker.string.alphanumeric({ length: 32 }),
      adminSecret: faker.string.alphanumeric({ length: 32 }),
      sessionSecret: faker.string.alphanumeric({ length: 32 }),
    };
    // Act & Assert
    assert.doesNotThrow(() => assertProductionSecrets(config, 'production'));
  });
  it('should reject a local default written in another case in production', () => {
    // Arrange
    const shouted = localDefaultSecrets.adminSecret.toUpperCase() + strongSecret();
    const config = { ...loadConfig(strongSecrets()), adminSecret: shouted };
    // Act & Assert
    assert.throws(
      () => assertProductionSecrets(config, 'production'),
      (e: Error) => e.message.includes('BANK_ADMIN_SECRET') && !e.message.includes(shouted),
    );
  });
  it('should reject a local default written with other separators in production', () => {
    // Arrange
    const respelled = strongSecret() + localDefaultSecrets.serviceSecret.replaceAll('-', '_');
    const config = { ...loadConfig(strongSecrets()), serviceSecret: respelled };
    // Act & Assert
    assert.throws(
      () => assertProductionSecrets(config, 'production'),
      (e: Error) => e.message.includes('BANK_SERVICE_SECRET') && !e.message.includes(respelled),
    );
  });
  it('should name only the colliding variables when one value is reused in production', () => {
    // Arrange
    const shared = strongSecret();
    const config = {
      ...loadConfig(strongSecrets()),
      serviceSecret: shared,
      sessionSecret: shared,
    };
    // Act & Assert
    assert.throws(
      () => assertProductionSecrets(config, 'production'),
      (e: Error) =>
        e.message.includes('BANK_SERVICE_SECRET, SESSION_SECRET') &&
        !e.message.includes('BANK_ADMIN_SECRET') &&
        !e.message.includes(shared),
    );
  });
});

describe('loadFeatureFlags', () => {
  for (const nodeEnv of [undefined, 'development', 'test']) {
    it(`should turn the persona switcher on by default when NODE_ENV is ${nodeEnv}`, () => {
      // Arrange
      const env = { NODE_ENV: nodeEnv };
      // Act
      const flags = loadFeatureFlags(env);
      // Assert
      assert.equal(flags.demoPersonaSwitcher, true);
    });
  }
  it('should turn the persona switcher off by default in production', () => {
    // Arrange
    const env = { NODE_ENV: 'production', DEMO_PERSONA_SWITCHER: '' };
    // Act
    const flags = loadFeatureFlags(env);
    // Assert
    assert.equal(flags.demoPersonaSwitcher, false);
  });
  for (const value of ['1', 'true', ' TRUE ']) {
    it(`should turn the persona switcher on in production when it is set to '${value}'`, () => {
      // Arrange
      const env = { NODE_ENV: 'production', DEMO_PERSONA_SWITCHER: value };
      // Act
      const flags = loadFeatureFlags(env);
      // Assert
      assert.equal(flags.demoPersonaSwitcher, true);
    });
  }
  for (const value of ['0', 'false', 'off', 'yes']) {
    it(`should turn the persona switcher off outside production when it is set to '${value}'`, () => {
      // Arrange
      const env = { NODE_ENV: 'development', DEMO_PERSONA_SWITCHER: value };
      // Act
      const flags = loadFeatureFlags(env);
      // Assert
      assert.equal(flags.demoPersonaSwitcher, false);
    });
  }
});

describe('assertNoPersonaSwitcherInProduction', () => {
  it('should refuse the persona switcher in production, naming the variable', () => {
    // Arrange
    const flags = { demoPersonaSwitcher: true };
    // Act & Assert
    assert.throws(
      () => assertNoPersonaSwitcherInProduction(flags, 'production'),
      (e: Error) => /DEMO_PERSONA_SWITCHER/.test(e.message) && !e.message.includes('\n'),
    );
  });
  it('should accept production with the persona switcher off', () => {
    // Arrange
    const flags = { demoPersonaSwitcher: false };
    // Act & Assert
    assert.doesNotThrow(() => assertNoPersonaSwitcherInProduction(flags, 'production'));
  });
  for (const nodeEnv of [undefined, 'development', 'test']) {
    it(`should accept the persona switcher outside production when NODE_ENV is ${nodeEnv}`, () => {
      // Arrange
      const flags = { demoPersonaSwitcher: true };
      // Act & Assert
      assert.doesNotThrow(() => assertNoPersonaSwitcherInProduction(flags, nodeEnv));
    });
  }
});
