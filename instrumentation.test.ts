import { afterEach, beforeEach, describe, it, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { faker } from '@faker-js/faker';
import { config, featureFlags, localDefaultSecrets } from './src/platform/config';
import { register } from './instrumentation';

// Under tsx the hook reads NODE_ENV and NEXT_RUNTIME from process.env when it runs, so each case sets
// them here (NODE_ENV is typed read-only). The built server differs: webpack inlines both, so a
// production build always runs the check in its Node.js runtime.
const env = process.env as Record<string, string | undefined>;
const strongSecret = () => faker.string.alphanumeric({ length: 40 });
const secretNames = ['BANK_SERVICE_SECRET', 'BANK_ADMIN_SECRET', 'SESSION_SECRET'];
// The hook ends the process on a refusal; the cases record the exit and the log instead.
const watchStartup = (t: TestContext) => ({
  exit: t.mock.method(process, 'exit', () => undefined as never),
  error: t.mock.method(console, 'error', () => {}),
});

describe('register', () => {
  const saved = { NODE_ENV: env.NODE_ENV, NEXT_RUNTIME: env.NEXT_RUNTIME };
  const savedSecrets = {
    serviceSecret: config.serviceSecret,
    adminSecret: config.adminSecret,
    sessionSecret: config.sessionSecret,
  };
  const savedSwitcher = featureFlags.demoPersonaSwitcher;
  beforeEach(() => {
    env.NEXT_RUNTIME = 'nodejs';
    Object.assign(config, localDefaultSecrets);
  });
  afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete env[key];
      else env[key] = value;
    }
    Object.assign(config, savedSecrets);
    featureFlags.demoPersonaSwitcher = savedSwitcher;
  });

  it('should exit with status 1 in production with the local default secrets', async (t) => {
    // Arrange
    env.NODE_ENV = 'production';
    const { exit } = watchStartup(t);
    // Act
    await register();
    // Assert
    assert.deepEqual(
      exit.mock.calls.map((call) => call.arguments),
      [[1]],
    );
  });
  it('should log every refused variable name and no secret value', async (t) => {
    // Arrange
    env.NODE_ENV = 'production';
    const { error } = watchStartup(t);
    // Act
    await register();
    // Assert
    const logged = error.mock.calls.map((call) => call.arguments.join(' ')).join('\n');
    for (const name of secretNames) assert.match(logged, new RegExp(name));
    for (const value of Object.values(localDefaultSecrets))
      assert.equal(logged.includes(value), false);
  });
  it('should log one plain line with a fixed prefix and no stack when it refuses', async (t) => {
    // Arrange
    env.NODE_ENV = 'production';
    const { error } = watchStartup(t);
    // Act
    await register();
    // Assert
    const [args] = error.mock.calls.map((call) => call.arguments);
    assert.equal(error.mock.callCount(), 1);
    assert.equal(args.length, 1);
    assert.equal(typeof args[0], 'string');
    assert.match(args[0] as string, /^Refusing to start in production: Set [^\n]+$/);
  });
  it('should start in production with real secrets', async (t) => {
    // Arrange
    env.NODE_ENV = 'production';
    Object.assign(config, {
      serviceSecret: strongSecret(),
      adminSecret: strongSecret(),
      sessionSecret: strongSecret(),
    });
    featureFlags.demoPersonaSwitcher = false;
    const { exit, error } = watchStartup(t);
    // Act
    await register();
    // Assert
    assert.equal(exit.mock.callCount() + error.mock.callCount(), 0);
  });
  it('should exit with status 1 and name the variable in production with the persona switcher on', async (t) => {
    // Arrange
    env.NODE_ENV = 'production';
    Object.assign(config, {
      serviceSecret: strongSecret(),
      adminSecret: strongSecret(),
      sessionSecret: strongSecret(),
    });
    featureFlags.demoPersonaSwitcher = true;
    const { exit, error } = watchStartup(t);
    // Act
    await register();
    // Assert
    assert.deepEqual(
      exit.mock.calls.map((call) => call.arguments),
      [[1]],
    );
    assert.equal(error.mock.callCount(), 1);
    assert.match(
      error.mock.calls[0].arguments[0] as string,
      /^Refusing to start in production: [^\n]*DEMO_PERSONA_SWITCHER[^\n]*$/,
    );
  });
  it('should report the weak secrets and the persona switcher together on one line', async (t) => {
    // Arrange
    env.NODE_ENV = 'production';
    featureFlags.demoPersonaSwitcher = true;
    const { exit, error } = watchStartup(t);
    // Act
    await register();
    // Assert
    assert.deepEqual(
      exit.mock.calls.map((call) => call.arguments),
      [[1]],
    );
    assert.equal(error.mock.callCount(), 1);
    const [line] = error.mock.calls[0].arguments as string[];
    assert.match(line, /^Refusing to start in production: Set [^\n]*DEMO_PERSONA_SWITCHER[^\n]*$/);
    for (const name of secretNames) assert.match(line, new RegExp(name));
  });
  it('should start outside production with the persona switcher on', async (t) => {
    // Arrange
    env.NODE_ENV = 'development';
    featureFlags.demoPersonaSwitcher = true;
    const { exit, error } = watchStartup(t);
    // Act
    await register();
    // Assert
    assert.equal(exit.mock.callCount() + error.mock.callCount(), 0);
  });
  it('should leave the edge runtime alone in production with the local default secrets', async (t) => {
    // Arrange
    env.NODE_ENV = 'production';
    env.NEXT_RUNTIME = 'edge';
    const { exit, error } = watchStartup(t);
    // Act
    await register();
    // Assert
    assert.equal(exit.mock.callCount() + error.mock.callCount(), 0);
  });
  it('should start outside production with the local default secrets', async (t) => {
    // Arrange
    env.NODE_ENV = 'development';
    const { exit, error } = watchStartup(t);
    // Act
    await register();
    // Assert
    assert.equal(exit.mock.callCount() + error.mock.callCount(), 0);
  });
});
