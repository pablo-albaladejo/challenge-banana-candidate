import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { personaSwitcherEnabled, requirePersonaSwitcher } from './persona-switcher';
import { featureFlags } from '../../../platform/config';
import { HttpError } from '../../../platform/http/http-error';

const saved = featureFlags.demoPersonaSwitcher;
const routeNotFound = (e: unknown) =>
  e instanceof HttpError && e.status === 404 && e.message === 'Route not found.';

describe('personaSwitcherEnabled', () => {
  afterEach(() => {
    featureFlags.demoPersonaSwitcher = saved;
  });

  it('should follow the feature flag at call time', () => {
    // Arrange
    featureFlags.demoPersonaSwitcher = true;
    const before = personaSwitcherEnabled();
    featureFlags.demoPersonaSwitcher = false;
    // Act
    const after = personaSwitcherEnabled();
    // Assert
    assert.deepEqual([before, after], [true, false]);
  });
});

describe('requirePersonaSwitcher', () => {
  afterEach(() => {
    featureFlags.demoPersonaSwitcher = saved;
  });

  it('should reject with the unknown-route answer when the switcher is off', () => {
    // Arrange
    featureFlags.demoPersonaSwitcher = false;
    // Act & Assert
    assert.throws(() => requirePersonaSwitcher(), routeNotFound);
  });

  it('should let the request through when the switcher is on', () => {
    // Arrange
    featureFlags.demoPersonaSwitcher = true;
    // Act & Assert
    assert.doesNotThrow(() => requirePersonaSwitcher());
  });
});
