import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import suite from './example.eval';
import { gatewayModel } from './model';
import { runSuite } from './runner';
import { baselineFromReports } from './thresholds';

describe('example suite', () => {
  it('should pass every case with its fake subject and no model call', async () => {
    // Arrange
    const model = gatewayModel();
    const runnable = { ...suite, subject: suite.subject(model) };
    const aa = [];
    for (let i = 0; i < 3; i++)
      aa.push(
        await runSuite(runnable, {
          aa: true,
          model: model.observed,
          now: () => Date.UTC(2026, 9, 11, 10, 0, i),
        }),
      );
    // Act
    const report = await runSuite(runnable, {
      baseline: baselineFromReports(aa),
      model: model.observed,
    });
    // Assert
    assert.equal(report.status, 'pass');
    assert.equal(report.passed, true);
    assert.equal(report.complete, true);
    assert.deepEqual(report.model, { providers: [], models: [] });
  });
});
