// The frozen `src/people` surface: the simulator seeds and authorizes from this roster.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as roster from './people';
import { counts, customers, unknown } from '../tests/fixtures/world';

describe('frozen src/people', () => {
  it('should list the roster and find a person by id', () => {
    // Arrange
    // Act
    const found = roster.person(customers.lucia);
    // Assert
    assert.equal(roster.people.length, counts.people);
    assert.equal(found, roster.people[0]);
    assert.equal(roster.person(unknown.person), undefined);
  });
});
