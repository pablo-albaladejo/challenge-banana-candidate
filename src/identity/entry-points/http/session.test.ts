import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { selectPerson } from './session';
import { featureFlags } from '../../../platform/config';
import { HttpError } from '../../../platform/http/http-error';

// The route table already drops POST `session` with the switcher off; the handler refuses on its own
// too, before the body is read.
const saved = featureFlags.demoPersonaSwitcher;

describe('selectPerson', () => {
  afterEach(() => {
    featureFlags.demoPersonaSwitcher = saved;
  });

  it('should reject with the unknown-route answer before reading the body when the switcher is off', async () => {
    // Arrange
    featureFlags.demoPersonaSwitcher = false;
    const request = new Request('http://127.0.0.1/api/session', {
      method: 'POST',
      body: '{"userId":',
    });
    // Act & Assert
    await assert.rejects(
      async () => selectPerson({ request, params: {} }),
      (e: unknown) => e instanceof HttpError && e.status === 404,
    );
  });
});
