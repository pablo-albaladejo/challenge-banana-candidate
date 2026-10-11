import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { listPeople } from './people';
import { featureFlags } from '../../../platform/config';
import { HttpError } from '../../../platform/http/http-error';

// The route table already drops `people` with the switcher off; the handler refuses on its own too.
const saved = featureFlags.demoPersonaSwitcher;
const request = new Request('http://127.0.0.1/api/people');

describe('listPeople', () => {
  afterEach(() => {
    featureFlags.demoPersonaSwitcher = saved;
  });

  it('should reject with the unknown-route answer when the switcher is off', async () => {
    // Arrange
    featureFlags.demoPersonaSwitcher = false;
    // Act & Assert
    await assert.rejects(
      async () => listPeople({ request, params: {} }),
      (e: unknown) => e instanceof HttpError && e.status === 404,
    );
  });
});
