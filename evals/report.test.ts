import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { HarnessFault } from './case';
import {
  defaultReportPath,
  formatReport,
  readReport,
  reportStatus,
  writeReport,
  type EvalReport,
  type MetricResult,
} from './report';
import { runSuite } from './runner';

const asText = (raw: unknown) => {
  if (typeof raw !== 'string') throw new Error('expected text');
  return raw;
};
/** One case whose second run errors: a report with a gated, an ungated and an unmeasured row. */
/** A complete one-case report from a subject that always answers `reply`. */
const completeReport = (reply: string, options: Parameters<typeof runSuite>[1] = {}) =>
  runSuite(
    {
      name: 'demo',
      subject: async () => reply,
      parse: asText,
      cases: [
        {
          id: 'case-refund',
          input: () => 'Lucía',
          must: [{ label: 'names the customer', check: (out) => out.includes('Lucía') }],
          mustNot: [{ label: 'promises a refund', check: (out) => /we will refund/i.test(out) }],
        },
      ],
    },
    options,
  );
/** One `recall` metric result with the given rate and verdict, as the runner reports it. */
const metric = (verdict: MetricResult['verdict'], rate = 1): MetricResult => ({
  name: 'recall',
  n: 3,
  cases: 2,
  caseIds: ['case-a', 'case-b'],
  samples: [rate, rate, rate],
  rate,
  threshold: verdict === 'ungated' ? null : 0.5,
  verdict,
  ...(verdict === 'ungated' ? { reason: 'no A/A baseline for this metric' } : {}),
});
/** A complete report of a suite with metrics: its must assertions are diagnostics. */
const metricReport = async (verdict: MetricResult['verdict'], rate = 1): Promise<EvalReport> => {
  const report = await completeReport('Hello Lucía');
  report.cases[0].assertions[0] = {
    ...report.cases[0].assertions[0],
    gate: 'diagnostic',
    verdict: 'diagnostic',
  };
  delete report.cases[0].assertions[0].reason;
  return { ...report, metrics: [metric(verdict, rate)] };
};
const tempFile = (name: string) =>
  path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'eval-report-')), name);
const sampleReport = () => {
  let call = 0;
  const subject = async () => {
    if (++call === 2) throw new Error('rate limited');
    return 'Hello Lucía';
  };
  return runSuite({
    name: 'demo suite',
    subject,
    parse: asText,
    cases: [
      {
        id: 'case-refund',
        input: () => 'Lucía',
        must: [{ label: 'names the customer', check: (out) => out.includes('Lucía') }],
        mustNot: [{ label: 'promises a refund', check: (out) => /we will refund/i.test(out) }],
      },
    ],
  });
};

describe('formatReport', () => {
  it('should list every assertion with its passes, rate, threshold and verdict', async () => {
    // Arrange
    const report = await sampleReport();
    // Act
    const table = formatReport(report);
    // Assert
    const rows = table.split('\n');
    assert.ok(
      rows.some((r) =>
        /case-refund\s+must\s+names the customer\s+2\/3\s+67%\s+—\s+ungated/.test(r),
      ),
    );
    assert.ok(
      rows.some((r) =>
        /case-refund\s+mustNot\s+promises a refund\s+2\/3\s+67%\s+100%\s+FAIL/.test(r),
      ),
    );
  });

  it('should state the unmeasured runs, their reasons and the incomplete status', async () => {
    // Arrange
    const report = await sampleReport();
    // Act
    const table = formatReport(report);
    // Assert
    assert.match(table, /case-refund run 2 unmeasured \(error\): rate limited/);
    assert.match(table, /INCOMPLETE: 1 unmeasured run/);
  });

  it('should state the model the numbers came from, or that none was called', async () => {
    // Arrange
    const report = await sampleReport();
    // Act
    const table = formatReport(report);
    // Assert
    assert.match(table, /model: none called/);
  });

  it('should state an ungated status, never a pass, when quality is not gated', async () => {
    // Arrange
    const report = await completeReport('Hello Lucía');
    // Act
    const table = formatReport(report);
    // Assert
    assert.match(table, /^UNGATED: .*not a pass/m);
    assert.doesNotMatch(table, /^PASS$/m);
    assert.match(table, /case-refund · names the customer: no A\/A baseline for this assertion/);
  });

  it('should state a complete A/A run as a baseline candidate, not a pass', async () => {
    // Arrange
    const report = await completeReport('Hello Lucía', { aa: true });
    // Act
    const table = formatReport(report);
    // Assert
    assert.match(table, /^A\/A: complete, no safety violation/m);
    assert.doesNotMatch(table, /^PASS$/m);
  });

  it('should list every metric with its rate, threshold, verdict and per-run samples', async () => {
    // Arrange
    const report = await metricReport('fail', 0.25);
    // Act
    const table = formatReport(report);
    // Assert
    assert.match(table, /^metric\s+cases\s+runs\s+rate\s+threshold\s+verdict\s+samples$/m);
    assert.match(table, /^recall\s+2\s+3\s+25%\s+50%\s+FAIL\s+25% 25% 25%$/m);
    assert.match(table, /case-refund\s+must\s+names the customer\s+3\/3\s+100%\s+—\s+diagnostic/);
  });

  it('should count an ungated metric in the ungated status line with its reason', async () => {
    // Arrange
    const report = await metricReport('ungated');
    // Act
    const table = formatReport(report);
    // Assert
    assert.match(table, /^metric recall: no A\/A baseline for this metric$/m);
    assert.match(table, /^UNGATED: no failure, but 1 quality gate is not gated/m);
  });
});

describe('reportStatus', () => {
  it('should rate a report with an unmeasured run as incomplete', async () => {
    // Arrange
    const report = await sampleReport();
    // Act
    const status = reportStatus(report);
    // Assert
    assert.equal(status, 'incomplete');
  });

  it('should rate a complete report with a failed assertion as failed', async () => {
    // Arrange
    const report = await completeReport('Lucía, we will refund you');
    // Act
    const status = reportStatus(report);
    // Assert
    assert.equal(status, 'fail');
  });

  it('should rate a complete report with an ungated assertion as ungated', async () => {
    // Arrange
    const report = await completeReport('Hello Lucía');
    // Act
    const status = reportStatus(report);
    // Assert
    assert.equal(status, 'ungated');
  });

  it('should rate a complete A/A report that keeps every mustNot as a baseline candidate', async () => {
    // Arrange
    const report = await completeReport('Hello Lucía', { aa: true });
    // Act
    const status = reportStatus(report);
    // Assert
    assert.equal(status, 'aa');
  });

  it('should rate a complete report whose every gate passed as passed', async () => {
    // Arrange
    const key = 'case-refund :: must :: names the customer';
    const baseline = {
      suite: 'demo',
      model: { providers: [], models: [] },
      rates: { [key]: [1, 1, 1] },
      ns: { [key]: 3 },
    };
    const report = await completeReport('Hello Lucía', { baseline });
    // Act
    const status = reportStatus(report);
    // Assert
    assert.equal(status, 'pass');
  });

  it('should rate a complete report whose every metric passed and only diagnostics remain as passed', async () => {
    // Arrange
    const report = await metricReport('pass');
    // Act
    const status = reportStatus(report);
    // Assert
    assert.equal(status, 'pass');
  });

  it('should rate a complete report with a failed metric as failed', async () => {
    // Arrange
    const report = await metricReport('fail', 0.25);
    // Act
    const status = reportStatus(report);
    // Assert
    assert.equal(status, 'fail');
  });

  it('should rate a complete report with a too-noisy metric as ungated', async () => {
    // Arrange
    const report = await metricReport('too-noisy');
    // Act
    const status = reportStatus(report);
    // Assert
    assert.equal(status, 'ungated');
  });
});

describe('writeReport', () => {
  it('should write the report as JSON with per-case and per-assertion rates', async () => {
    // Arrange
    const report = await sampleReport();
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'eval-report-')), 'a', 'r.json');
    // Act
    writeReport(report, file);
    // Assert
    const written = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.deepEqual(Object.keys(written).sort(), [
      'aa',
      'cases',
      'complete',
      'finishedAt',
      'model',
      'passed',
      'policy',
      'startedAt',
      'status',
      'suite',
      'unmeasured',
    ]);
    assert.deepEqual(Object.keys(written.cases[0]).sort(), [
      'assertions',
      'id',
      'latencyMs',
      'measured',
      'n',
      'passed',
      'runs',
      'unmeasured',
    ]);
    assert.deepEqual(written.cases[0].assertions[1], {
      kind: 'mustNot',
      label: 'promises a refund',
      gate: 'safety',
      passes: 2,
      n: 3,
      rate: 2 / 3,
      threshold: 1,
      verdict: 'fail',
    });
    assert.equal(written.unmeasured, 1);
  });
});

describe('defaultReportPath', () => {
  it('should place the report under .eval-results named by suite and start time', async () => {
    // Arrange
    const report = await sampleReport();
    // Act
    const file = defaultReportPath(report, '/repo');
    // Assert
    const stamp = report.startedAt.replaceAll(':', '-');
    assert.equal(file, path.join('/repo', '.eval-results', `demo-suite-${stamp}.json`));
  });
});

describe('readReport', () => {
  it('should read back a report written by writeReport', async () => {
    // Arrange
    const report = await sampleReport();
    const file = tempFile('r.json');
    writeReport(report, file);
    // Act
    const read = readReport(file);
    // Assert
    assert.deepEqual(read, JSON.parse(JSON.stringify(report)));
  });

  it('should reject a baseline file that cannot be read as a harness fault', () => {
    // Arrange
    const file = tempFile('missing.json');
    // Act & Assert
    assert.throws(() => readReport(file), HarnessFault);
  });

  it('should reject a baseline file that is not JSON as a harness fault', () => {
    // Arrange
    const file = tempFile('broken.json');
    fs.writeFileSync(file, '{ not json');
    // Act & Assert
    assert.throws(() => readReport(file), HarnessFault);
  });
});
