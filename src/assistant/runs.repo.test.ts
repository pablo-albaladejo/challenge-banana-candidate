import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { faker } from '@faker-js/faker';
import { insertRun, setRunStatus } from './runs.repo';
import { runFactory } from '../../tests/fixtures/factories';
import { runOf } from '../../tests/support/db';

describe('runs repository', () => {
  it('should read back a stored run', () => {
    // Arrange
    const run = runFactory.build();
    // Act
    insertRun(run);
    // Assert
    assert.deepEqual(runOf(run.id), {
      user_id: run.userId,
      conversation_id: run.conversationId,
      status: run.status,
      error: run.error,
    });
  });
  it('should record the final status of a run', () => {
    // Arrange
    const run = runFactory.build();
    insertRun(run);
    // Act
    setRunStatus(run.id, 'completed');
    // Assert
    assert.equal(runOf(run.id).status, 'completed');
    assert.equal(runOf(run.id).error, null);
  });
  it('should record the status and the error of a run that did not finish', () => {
    // Arrange
    const run = runFactory.build();
    insertRun(run);
    const error = faker.lorem.sentence();
    // Act
    setRunStatus(run.id, 'failed', error);
    // Assert
    assert.equal(runOf(run.id).status, 'failed');
    assert.equal(runOf(run.id).error, error);
  });
});
