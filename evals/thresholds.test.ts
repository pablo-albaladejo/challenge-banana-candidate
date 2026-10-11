import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { HarnessFault } from './case';
import type { EvalReport } from './report';
import {
  assertionKey,
  baselineFromReports,
  decide,
  deriveThreshold,
  gateQuality,
  passRate,
  sameModel,
} from './thresholds';

let sequence = 0;
/** A complete one-case A/A report (a distinct run) whose single `must` passed `passes` of 3 runs. */
const aaReport = (passes: number, overrides: Partial<EvalReport> = {}): EvalReport => ({
  suite: 'demo',
  startedAt: new Date(Date.UTC(2026, 9, 11, 10, 0, sequence++)).toISOString(),
  finishedAt: '2026-10-11T10:00:01.000Z',
  model: { providers: ['openai'], models: ['gpt-6-luna'] },
  policy: { defaultN: 3, timeoutMs: 1000, safety: 'zero-tolerance', quality: 'k-of-n' },
  complete: true,
  aa: true,
  status: 'aa',
  passed: false,
  unmeasured: 0,
  cases: [
    {
      id: 'case-a',
      n: 3,
      measured: 3,
      unmeasured: 0,
      passed: true,
      latencyMs: { mean: 1, max: 1 },
      runs: [],
      assertions: [
        {
          kind: 'must',
          label: 'names the payee',
          gate: 'quality',
          passes,
          n: 3,
          rate: passes / 3,
          threshold: null,
          verdict: 'ungated',
        },
      ],
    },
  ],
  ...overrides,
});

describe('passRate', () => {
  it('should divide the passing runs by every run, unmeasured ones included', () => {
    // Arrange
    const passes = 2;
    const runs = 3;
    // Act
    const rate = passRate(passes, runs);
    // Assert
    assert.equal(rate, 2 / 3);
  });

  it('should rate a case with no passing run at zero', () => {
    // Arrange
    const runs = 3;
    // Act
    const rate = passRate(0, runs);
    // Assert
    assert.equal(rate, 0);
  });
});

describe('deriveThreshold', () => {
  it('should leave a quality gate unarmed with fewer than three A/A runs', () => {
    // Arrange
    const aa = [1, 1];
    // Act
    const threshold = deriveThreshold(aa, 3);
    // Assert
    assert.equal(threshold, null);
  });

  it('should subtract at least one run from the mean when the A/A runs agree', () => {
    // Arrange
    const aa = [1, 1, 1];
    // Act
    const threshold = deriveThreshold(aa, 3);
    // Assert
    assert.ok(Math.abs(threshold! - 2 / 3) < 1e-9);
  });

  it('should subtract two sample standard deviations when that exceeds one run', () => {
    // Arrange
    const aa = [1, 0.5, 0];
    // Act
    const threshold = deriveThreshold(aa, 10);
    // Assert
    assert.equal(threshold, 0);
  });

  it('should take the two-deviation margin from the mean of a noisy A/A', () => {
    // Arrange
    const aa = [0.9, 1, 1, 0.9]; // mean 0.95, sample sd ≈ 0.0577, margin ≈ 0.1155 > 1/20
    // Act
    const threshold = deriveThreshold(aa, 20);
    // Assert
    assert.ok(Math.abs(threshold! - (0.95 - 2 * Math.sqrt(0.01 / 3))) < 1e-9);
  });
});

describe('decide', () => {
  it('should pass a mustNot assertion only when every run kept it', () => {
    // Arrange
    const rate = 1;
    // Act
    const verdict = decide('mustNot', rate, null);
    // Assert
    assert.equal(verdict, 'pass');
  });

  it('should fail a mustNot assertion on a single violating run whatever the baseline says', () => {
    // Arrange
    const rate = 2 / 3;
    // Act
    const verdict = decide('mustNot', rate, 0);
    // Assert
    assert.equal(verdict, 'fail');
  });

  it('should report a must assertion as ungated when no A/A threshold exists', () => {
    // Arrange
    const rate = 0;
    // Act
    const verdict = decide('must', rate, null);
    // Assert
    assert.equal(verdict, 'ungated');
  });

  it('should pass a must assertion at exactly its threshold', () => {
    // Arrange
    const threshold = deriveThreshold([1, 1, 1], 3);
    // Act
    const verdict = decide('must', 2 / 3, threshold);
    // Assert
    assert.equal(verdict, 'pass');
  });

  it('should fail a must assertion below its threshold', () => {
    // Arrange
    const threshold = deriveThreshold([1, 1, 1], 3);
    // Act
    const verdict = decide('must', 1 / 3, threshold);
    // Assert
    assert.equal(verdict, 'fail');
  });
});

describe('gateQuality', () => {
  it('should gate a must assertion at the A/A mean minus the margin', () => {
    // Arrange
    const aa = [1, 1, 1];
    // Act
    const gate = gateQuality(1 / 3, aa, 3);
    // Assert
    assert.equal(gate.verdict, 'fail');
    assert.ok(Math.abs(gate.threshold! - 2 / 3) < 1e-9);
  });

  it('should leave a must assertion without A/A rates ungated with the reason', () => {
    // Arrange
    const aa = undefined;
    // Act
    const gate = gateQuality(0, aa, 3);
    // Assert
    assert.deepEqual(gate, {
      threshold: null,
      verdict: 'ungated',
      reason: 'no A/A baseline for this assertion',
    });
  });

  it('should report a vacuous threshold as too noisy and advise more runs', () => {
    // Arrange
    const aa = [1, 0.5, 0]; // mean 0.5, 2 SD = 1: the margin swallows the mean
    // Act
    const gate = gateQuality(0, aa, 10);
    // Assert
    assert.equal(gate.verdict, 'too-noisy');
    assert.equal(gate.threshold, 0);
    assert.match(gate.reason!, /raise N or add A\/A runs/);
  });

  it('should report a margin of one run that reaches the mean as too noisy', () => {
    // Arrange
    const aa = [1 / 3, 1 / 3, 1 / 3]; // mean 1/3, margin 1/3 at n = 3
    // Act
    const gate = gateQuality(0, aa, 3);
    // Assert
    assert.equal(gate.verdict, 'too-noisy');
  });

  it('should report an assertion run fewer than three times as too noisy to gate', () => {
    // Arrange
    const aa = [1, 1, 1];
    // Act
    const gate = gateQuality(0, aa, 2);
    // Assert
    assert.equal(gate.verdict, 'too-noisy');
    assert.equal(gate.threshold, null);
    assert.match(gate.reason!, /n = 2.*raise N/);
  });
});

describe('sameModel', () => {
  it('should equate the same providers and models in any order', () => {
    // Arrange
    const a = { providers: ['openai', 'claude-cli'], models: ['gpt-6-luna', 'haiku'] };
    const b = { providers: ['claude-cli', 'openai'], models: ['haiku', 'gpt-6-luna'] };
    // Act & Assert
    assert.equal(sameModel(a, b), true);
  });

  it('should tell apart different models', () => {
    // Arrange
    const a = { providers: ['openai'], models: ['gpt-6-luna'] };
    const b = { providers: ['openai'], models: ['gpt-6-sol'] };
    // Act & Assert
    assert.equal(sameModel(a, b), false);
  });
});

describe('baselineFromReports', () => {
  it('should collect the A/A pass rate of every must assertion', () => {
    // Arrange
    const reports = [aaReport(3), aaReport(2), aaReport(3)];
    // Act
    const baseline = baselineFromReports(reports);
    // Assert
    const key = assertionKey('case-a', 'must', 'names the payee');
    assert.deepEqual(baseline, {
      suite: 'demo',
      model: { providers: ['openai'], models: ['gpt-6-luna'] },
      rates: { [key]: [1, 2 / 3, 1] },
      ns: { [key]: 3 },
    });
  });

  it('should reject a baseline of fewer than three A/A runs as a harness fault', () => {
    // Arrange
    const reports = [aaReport(3), aaReport(3)];
    // Act & Assert
    assert.throws(() => baselineFromReports(reports), HarnessFault);
  });

  it('should reject an incomplete A/A run as a harness fault', () => {
    // Arrange
    const reports = [aaReport(3), aaReport(3), aaReport(3, { complete: false, unmeasured: 1 })];
    // Act & Assert
    assert.throws(() => baselineFromReports(reports), /incomplete/);
  });

  it('should reject A/A runs taken from different models as a harness fault', () => {
    // Arrange
    const other = { providers: ['claude-cli'], models: ['haiku'] };
    const reports = [aaReport(3), aaReport(3), aaReport(3, { model: other })];
    // Act & Assert
    assert.throws(() => baselineFromReports(reports), /model/);
  });
  it('should accept A/A reports whose providers answered in a different order', () => {
    // Arrange
    const both = { providers: ['openai', 'claude-cli'], models: ['gpt-6-luna', 'haiku'] };
    const reversed = { providers: ['claude-cli', 'openai'], models: ['haiku', 'gpt-6-luna'] };
    const reports = [aaReport(3, { model: both }), aaReport(3, { model: reversed }), aaReport(3)];
    reports[2].model = both;
    // Act
    const baseline = baselineFromReports(reports);
    // Assert
    assert.deepEqual(baseline.model, both);
  });

  it('should reject the same A/A run given three times as a harness fault', () => {
    // Arrange
    const once = aaReport(3);
    const reports = [once, once, once];
    // Act & Assert
    assert.throws(() => baselineFromReports(reports), /same run/);
  });

  it('should reject a report that is not an A/A run as a harness fault', () => {
    // Arrange
    const gatedRun = aaReport(3, { aa: false, status: 'pass' });
    const reports = [aaReport(3), aaReport(3), gatedRun];
    // Act & Assert
    assert.throws(() => baselineFromReports(reports), HarnessFault);
  });

  it('should reject A/A reports whose assertion keys differ as a harness fault', () => {
    // Arrange
    const renamed = aaReport(3);
    renamed.cases[0].assertions[0].label = 'names the bank';
    const reports = [aaReport(3), aaReport(3), renamed];
    // Act & Assert
    assert.throws(() => baselineFromReports(reports), /assertions or run counts/);
  });

  it('should reject A/A reports whose run counts differ as a harness fault', () => {
    // Arrange
    const longer = aaReport(3);
    longer.cases[0].assertions[0].n = 5;
    const reports = [aaReport(3), aaReport(3), longer];
    // Act & Assert
    assert.throws(() => baselineFromReports(reports), /assertions or run counts/);
  });

  it('should reject an A/A pass rate outside zero to one as a harness fault', () => {
    // Arrange
    const corrupt = aaReport(3);
    corrupt.cases[0].assertions[0].rate = 1.5;
    const reports = [aaReport(3), aaReport(3), corrupt];
    // Act & Assert
    assert.throws(() => baselineFromReports(reports), HarnessFault);
  });

  it('should reject an A/A report that is not shaped like a report as a harness fault', () => {
    // Arrange
    const reports = [aaReport(3), aaReport(3), { suite: 'demo' } as EvalReport];
    // Act & Assert
    assert.throws(() => baselineFromReports(reports), HarnessFault);
  });
});
