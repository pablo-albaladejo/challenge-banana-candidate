import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { HarnessFault, type EvalCase, type Subject } from './case';
import { runSuite } from './runner';
import type { ModelInfo } from './report';
import { assertionKey, type Baseline } from './thresholds';

/** Answers with the scripted outputs in order, one per call: a deterministic stand-in for noise. */
const scripted = (...outputs: unknown[]) => {
  const calls: string[] = [];
  const subject = async (input: string) => {
    calls.push(input);
    return outputs[(calls.length - 1) % outputs.length];
  };
  return { subject, calls };
};
const asText = (raw: unknown) => {
  if (typeof raw !== 'string') throw new Error('expected text');
  return raw;
};
const refundCase = (overrides: Partial<EvalCase<string, string>> = {}) => ({
  id: 'case-refund',
  input: () => 'Lucía',
  must: [{ label: 'names the customer', check: (out: string) => out.includes('Lucía') }],
  mustNot: [{ label: 'promises a refund', check: (out: string) => /we will refund/i.test(out) }],
  ...overrides,
});
/** A baseline arming `names the customer` of `case-refund` with the given A/A rates. */
const gated = (
  rates: number[],
  model: ModelInfo = { providers: [], models: [] },
  n = 3,
  suite = 'demo',
): Baseline => {
  const key = assertionKey('case-refund', 'must', 'names the customer');
  return { suite, model, rates: { [key]: rates }, ns: { [key]: n } };
};
const run = (cases: EvalCase<string, string>[], subject: Subject<string>) =>
  runSuite({ name: 'demo', cases, subject, parse: asText }, { timeoutMs: 50 });

describe('runSuite', () => {
  it('should run every case three times by default', async () => {
    // Arrange
    const fake = scripted('Hello Lucía');
    // Act
    const report = await run([refundCase()], fake.subject);
    // Assert
    assert.equal(fake.calls.length, 3);
    assert.equal(report.cases[0].n, 3);
    assert.equal(report.cases[0].runs.length, 3);
  });

  it('should run a case its own N times when the case sets one', async () => {
    // Arrange
    const fake = scripted('Hello Lucía');
    // Act
    const report = await run([refundCase({ n: 5 }), refundCase({ id: 'case-b' })], fake.subject);
    // Assert
    assert.equal(fake.calls.length, 8);
    assert.deepEqual(
      report.cases.map((c) => c.n),
      [5, 3],
    );
  });

  it('should build the input afresh for every run', async () => {
    // Arrange
    const fake = scripted('Hello Lucía');
    let built = 0;
    const counting = refundCase({ input: () => `Lucía #${++built}` });
    // Act
    await run([counting], fake.subject);
    // Assert
    assert.deepEqual(fake.calls, ['Lucía #1', 'Lucía #2', 'Lucía #3']);
  });

  it('should count the passing runs of each assertion from a noisy subject', async () => {
    // Arrange
    const fake = scripted('Hello Lucía', 'Hello there', 'Hello Lucía, we will refund you');
    // Act
    const report = await run([refundCase()], fake.subject);
    // Assert
    const [must, mustNot] = report.cases[0].assertions;
    assert.deepEqual(
      { passes: must.passes, n: must.n, rate: must.rate },
      { passes: 2, n: 3, rate: 2 / 3 },
    );
    assert.deepEqual(
      { passes: mustNot.passes, n: mustNot.n, rate: mustNot.rate },
      { passes: 2, n: 3, rate: 2 / 3 },
    );
  });

  it('should fail the case and the suite when one run breaks a mustNot assertion', async () => {
    // Arrange
    const fake = scripted('Hello Lucía', 'Hello Lucía', 'Lucía, we will refund you');
    // Act
    const report = await run([refundCase()], fake.subject);
    // Assert
    assert.equal(report.cases[0].assertions[1].verdict, 'fail');
    assert.equal(report.cases[0].passed, false);
    assert.equal(report.passed, false);
  });

  it('should record which assertions each measured run failed', async () => {
    // Arrange
    const fake = scripted('Hello Lucía', 'we will refund you');
    // Act
    const report = await run([refundCase({ n: 2 })], fake.subject);
    // Assert
    assert.deepEqual(
      report.cases[0].runs.map((r) => r.failed),
      [[], ['must: names the customer', 'mustNot: promises a refund']],
    );
  });

  it('should report the suite as ungated, not passed, without a baseline', async () => {
    // Arrange
    const fake = scripted('Hello there');
    // Act
    const report = await run([refundCase()], fake.subject);
    // Assert
    assert.equal(report.cases[0].assertions[0].verdict, 'ungated');
    assert.equal(report.cases[0].assertions[0].threshold, null);
    assert.equal(report.cases[0].passed, false);
    assert.equal(report.status, 'ungated');
    assert.equal(report.passed, false);
  });

  it('should report a complete A/A run that keeps every mustNot as a baseline candidate', async () => {
    // Arrange
    const fake = scripted('Hello there');
    // Act
    const report = await runSuite(
      { name: 'demo', cases: [refundCase()], subject: fake.subject, parse: asText },
      { aa: true },
    );
    // Assert
    assert.deepEqual(
      { aa: report.aa, status: report.status, passed: report.passed },
      { aa: true, status: 'aa', passed: false },
    );
  });

  it('should reject an A/A run given a baseline as a harness fault', async () => {
    // Arrange
    const fake = scripted('Hello Lucía');
    const baseline = gated([1, 1, 1]);
    // Act & Assert
    await assert.rejects(
      runSuite(
        { name: 'demo', cases: [refundCase()], subject: fake.subject, parse: asText },
        { aa: true, baseline },
      ),
      HarnessFault,
    );
    assert.equal(fake.calls.length, 0);
  });

  it('should pass the suite when every gated assertion clears its threshold', async () => {
    // Arrange
    const fake = scripted('Hello Lucía');
    // Act
    const report = await runSuite(
      { name: 'demo', cases: [refundCase()], subject: fake.subject, parse: asText },
      { baseline: gated([1, 1, 1]) },
    );
    // Assert
    assert.deepEqual(
      { status: report.status, passed: report.passed, casePassed: report.cases[0].passed },
      { status: 'pass', passed: true, casePassed: true },
    );
  });

  it('should report a vacuous threshold as too noisy and the suite as ungated', async () => {
    // Arrange
    const fake = scripted('Hello there');
    // Act
    const report = await runSuite(
      { name: 'demo', cases: [refundCase()], subject: fake.subject, parse: asText },
      { baseline: gated([1, 0.5, 0]) },
    );
    // Assert
    const must = report.cases[0].assertions[0];
    assert.equal(must.verdict, 'too-noisy');
    assert.match(must.reason!, /raise N or add A\/A runs/);
    assert.equal(report.status, 'ungated');
  });

  it('should report an assertion run fewer than three times as too noisy to gate', async () => {
    // Arrange
    const fake = scripted('Hello Lucía');
    // Act
    const report = await runSuite(
      { name: 'demo', cases: [refundCase({ n: 2 })], subject: fake.subject, parse: asText },
      { baseline: gated([1, 1, 1], undefined, 2) },
    );
    // Assert
    assert.equal(report.cases[0].assertions[0].verdict, 'too-noisy');
    assert.equal(report.status, 'ungated');
  });

  it('should leave an assertion missing from the baseline ungated', async () => {
    // Arrange
    const fake = scripted('Hello Lucía');
    const extra = { label: 'says hello', check: (out: string) => out.startsWith('Hello') };
    const both = refundCase({ must: [...refundCase().must, extra] });
    // Act
    const report = await runSuite(
      { name: 'demo', cases: [both], subject: fake.subject, parse: asText },
      { baseline: gated([1, 1, 1]) },
    );
    // Assert
    assert.deepEqual(
      report.cases[0].assertions.map((a) => a.verdict),
      ['pass', 'ungated', 'pass'],
    );
    assert.equal(report.status, 'ungated');
  });

  it('should ungate the quality gates when the run model differs from the baseline model', async () => {
    // Arrange
    const fake = scripted('Hello there');
    const model = () => ({ providers: ['claude-cli'], models: ['claude-haiku'] });
    // Act
    const report = await runSuite(
      { name: 'demo', cases: [refundCase()], subject: fake.subject, parse: asText },
      { baseline: gated([1, 1, 1], { providers: ['openai'], models: ['gpt-6-luna'] }), model },
    );
    // Assert
    const [must, mustNot] = report.cases[0].assertions;
    assert.equal(must.verdict, 'ungated');
    assert.match(must.reason!, /model mismatch/);
    assert.equal(mustNot.verdict, 'pass');
    assert.equal(report.status, 'ungated');
  });

  it('should ungate a quality gate whose baseline ran another number of times', async () => {
    // Arrange
    const fake = scripted('Hello Lucía');
    // Act
    const report = await runSuite(
      { name: 'demo', cases: [refundCase()], subject: fake.subject, parse: asText },
      { baseline: gated([1, 1, 1], undefined, 5) },
    );
    // Assert
    const [must] = report.cases[0].assertions;
    assert.equal(must.verdict, 'ungated');
    assert.match(must.reason!, /n mismatch/);
    assert.equal(report.status, 'ungated');
  });

  it('should reject a baseline of another suite as a harness fault', async () => {
    // Arrange
    const fake = scripted('Hello Lucía');
    // Act & Assert
    await assert.rejects(
      runSuite(
        { name: 'demo', cases: [refundCase()], subject: fake.subject, parse: asText },
        { baseline: gated([1, 1, 1], undefined, 3, 'other') },
      ),
      /suite "other".*suite "demo"/,
    );
  });

  it('should gate with a baseline whose providers answered in another order', async () => {
    // Arrange
    const fake = scripted('Hello Lucía');
    const model = () => ({ providers: ['a', 'b'], models: ['x', 'y'] });
    const baselineModel = { providers: ['b', 'a'], models: ['y', 'x'] };
    // Act
    const report = await runSuite(
      { name: 'demo', cases: [refundCase()], subject: fake.subject, parse: asText },
      { baseline: gated([1, 1, 1], baselineModel), model },
    );
    // Assert
    assert.equal(report.cases[0].assertions[0].verdict, 'pass');
  });

  it('should stop with a harness fault when a predicate returns something other than a boolean', async () => {
    // Arrange
    const fake = scripted('Hello Lucía');
    const sloppy = refundCase({
      must: [{ label: 'finds the name', check: (out: string) => out.match(/Lucía/) as never }],
    });
    // Act & Assert
    await assert.rejects(run([sloppy], fake.subject), /returned object, not a boolean/);
  });

  it('should reject a default N below one as a harness fault', async () => {
    // Arrange
    const fake = scripted('Hello Lucía');
    // Act & Assert
    await assert.rejects(
      runSuite(
        { name: 'demo', cases: [refundCase()], subject: fake.subject, parse: asText },
        { defaultN: 0 },
      ),
      HarnessFault,
    );
  });

  it('should reject a timeout that is not positive as a harness fault', async () => {
    // Arrange
    const fake = scripted('Hello Lucía');
    // Act & Assert
    await assert.rejects(
      runSuite(
        { name: 'demo', cases: [refundCase()], subject: fake.subject, parse: asText },
        { timeoutMs: 0 },
      ),
      HarnessFault,
    );
  });

  it('should reject a suite whose parser is not a function as a harness fault', async () => {
    // Arrange
    const fake = scripted('Hello Lucía');
    const parse = 'text' as unknown as (raw: unknown) => string;
    // Act & Assert
    await assert.rejects(
      runSuite({ name: 'demo', cases: [refundCase()], subject: fake.subject, parse }),
      /parse must be a function/,
    );
    assert.equal(fake.calls.length, 0);
  });

  it('should gate a quality assertion on the threshold derived from its A/A baseline', async () => {
    // Arrange
    const fake = scripted('Hello there', 'Hello there', 'Hello Lucía');
    // Act
    const report = await runSuite(
      { name: 'demo', cases: [refundCase()], subject: fake.subject, parse: asText },
      { baseline: gated([1, 1, 1]) },
    );
    // Assert
    const must = report.cases[0].assertions[0];
    assert.ok(Math.abs(must.threshold! - 2 / 3) < 1e-9);
    assert.equal(must.verdict, 'fail');
    assert.equal(report.passed, false);
  });

  it('should mark a run whose subject throws as unmeasured and never as a pass', async () => {
    // Arrange
    const subject = async () => {
      throw new Error('provider exploded');
    };
    // Act
    const report = await run([refundCase({ n: 1 })], subject);
    // Assert
    const result = report.cases[0];
    assert.deepEqual(result.runs[0].unmeasured, { reason: 'error', message: 'provider exploded' });
    assert.deepEqual(
      result.assertions.map((a) => a.passes),
      [0, 0],
    );
    assert.equal(result.assertions[1].verdict, 'fail');
  });

  it('should mark a run that exceeds the timeout as unmeasured and abort the subject', async () => {
    // Arrange
    let aborted = false;
    const subject = (_input: string, signal: AbortSignal) =>
      new Promise<unknown>(() => signal.addEventListener('abort', () => (aborted = true)));
    // Act
    const report = await run([refundCase({ n: 1 })], subject);
    // Assert
    assert.equal(report.cases[0].runs[0].unmeasured?.reason, 'timeout');
    assert.equal(report.cases[0].assertions[0].passes, 0);
    assert.equal(aborted, true);
  });

  it('should mark a run whose output does not parse as unmeasured', async () => {
    // Arrange
    const fake = scripted({ not: 'text' });
    // Act
    const report = await run([refundCase({ n: 1 })], fake.subject);
    // Assert
    assert.deepEqual(report.cases[0].runs[0].unmeasured, {
      reason: 'unparseable',
      message: 'expected text',
    });
    assert.equal(report.cases[0].assertions[1].passes, 0);
  });

  it('should mark a run whose input cannot be built as unmeasured', async () => {
    // Arrange
    const fake = scripted('Hello Lucía');
    const unseeded = refundCase({
      n: 1,
      input: () => {
        throw new Error('seed failed');
      },
    });
    // Act
    const report = await run([unseeded], fake.subject);
    // Assert
    assert.equal(report.cases[0].runs[0].unmeasured?.reason, 'input');
    assert.equal(fake.calls.length, 0);
  });

  it('should mark the report incomplete and failed when any run is unmeasured', async () => {
    // Arrange
    let call = 0;
    const subject = async () => {
      if (++call === 2) throw new Error('rate limited');
      return 'Hello Lucía';
    };
    const qualityOnly = refundCase({ mustNot: [] });
    // Act
    const report = await run([qualityOnly], subject);
    // Assert
    assert.deepEqual(
      {
        complete: report.complete,
        passed: report.passed,
        unmeasured: report.unmeasured,
        measured: report.cases[0].measured,
        caseUnmeasured: report.cases[0].unmeasured,
        casePassed: report.cases[0].passed,
      },
      {
        complete: false,
        passed: false,
        unmeasured: 1,
        measured: 2,
        caseUnmeasured: 1,
        casePassed: false,
      },
    );
  });

  it('should stop with a harness fault when an assertion predicate throws', async () => {
    // Arrange
    const fake = scripted('Hello Lucía');
    const broken = refundCase({
      must: [
        {
          label: 'reads a missing field',
          check: () => {
            throw new Error('bad label');
          },
        },
      ],
    });
    // Act & Assert
    await assert.rejects(run([broken], fake.subject), HarnessFault);
  });

  it('should stop with a harness fault before any call when the cases are malformed', async () => {
    // Arrange
    const fake = scripted('Hello Lucía');
    // Act & Assert
    await assert.rejects(run([refundCase(), refundCase()], fake.subject), HarnessFault);
    assert.equal(fake.calls.length, 0);
  });

  it('should time every run and the whole suite with the injected clock', async () => {
    // Arrange
    const fake = scripted('Hello Lucía');
    let tick = Date.parse('2026-10-11T10:00:00.000Z');
    const now = () => (tick += 10);
    // Act
    const report = await runSuite(
      { name: 'demo', cases: [refundCase()], subject: fake.subject, parse: asText },
      { now },
    );
    // Assert
    assert.deepEqual(
      report.cases[0].runs.map((r) => r.latencyMs),
      [10, 10, 10],
    );
    assert.deepEqual(report.cases[0].latencyMs, { mean: 10, max: 10 });
    assert.equal(report.startedAt, '2026-10-11T10:00:00.010Z');
    assert.equal(report.finishedAt, '2026-10-11T10:00:00.080Z');
  });

  it('should state the model the numbers came from', async () => {
    // Arrange
    const fake = scripted('Hello Lucía');
    const model = () => ({ providers: ['openai'], models: ['gpt-6-luna'] });
    // Act
    const report = await runSuite(
      { name: 'demo', cases: [refundCase()], subject: fake.subject, parse: asText },
      { model },
    );
    // Assert
    assert.deepEqual(report.model, { providers: ['openai'], models: ['gpt-6-luna'] });
  });
});
