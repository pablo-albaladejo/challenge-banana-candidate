import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sessionToken } from './legacy';
import { sign } from '../../platform/crypto';
import { config } from '../../platform/config';
import { unknown } from '../../../tests/fixtures/world';

describe('identity legacy', () => {
  it('should sign a session token for any id, known or not', () => {
    // Arrange
    // Act
    const token = sessionToken(unknown.person);
    // Assert
    assert.equal(token, `${unknown.person}.${sign(unknown.person, config.sessionSecret)}`);
  });
});
