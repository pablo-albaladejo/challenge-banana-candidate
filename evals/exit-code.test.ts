import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { HarnessFault, type EvalCase } from './case';
import { exitCodeFor } from './exit-code';
import { runSuite, type RunOptions } from './runner';
import { assertionKey } from './thresholds';

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
/** Answers the replies in order, one per call; a reply that is an Error is thrown instead. */
const report = (replies: (string | Error)[], options: RunOptions = {}, overrides = {}) => {
  let call = 0;
  const subject = async () => {
    const reply = replies[call++ % replies.length];
    if (reply instanceof Error) throw reply;
    return reply;
  };
  return runSuite(
    { name: 'demo', cases: [refundCase(overrides)], subject, parse: asText },
    options,
  );
};
const armed = {
  baseline: {
    suite: 'demo',
    model: { providers: [], models: [] },
    rates: { [assertionKey('case-refund', 'must', 'names the customer')]: [1, 1, 1] },
    ns: { [assertionKey('case-refund', 'must', 'names the customer')]: 3 },
  },
};

describe('exitCodeFor', () => {
  it('should exit 0 when the report is complete and every gate passes', async () => {
    // Arrange
    const outcome = await report(['Hello Lucía'], armed);
    // Act
    const code = exitCodeFor(outcome);
    // Assert
    assert.equal(code, 0);
  });

  it('should exit 0 for a complete A/A run that keeps every mustNot', async () => {
    // Arrange
    const outcome = await report(['Hello there'], { aa: true });
    // Act
    const code = exitCodeFor(outcome);
    // Assert
    assert.equal(code, 0);
  });

  it('should exit 1 when a mustNot assertion fails', async () => {
    // Arrange
    const outcome = await report(['Hello Lucía', 'Lucía, we will refund you'], armed);
    // Act
    const code = exitCodeFor(outcome);
    // Assert
    assert.equal(code, 1);
  });

  it('should exit 1 when a quality gate fails', async () => {
    // Arrange
    const outcome = await report(['Hello there'], armed);
    // Act
    const code = exitCodeFor(outcome);
    // Assert
    assert.equal(code, 1);
  });

  it('should exit 1 when a run is unmeasured even if every gate still clears', async () => {
    // Arrange
    const outcome = await report([new Error('rate limited'), 'Hello Lucía', 'Hello Lucía'], armed, {
      mustNot: [],
    });
    // Act
    const code = exitCodeFor(outcome);
    // Assert
    assert.equal(outcome.cases[0].assertions[0].verdict, 'pass');
    assert.equal(code, 1);
  });

  it('should exit 1 when an ungated run is incomplete', async () => {
    // Arrange
    const outcome = await report([new Error('rate limited'), 'Hello Lucía'], {}, { mustNot: [] });
    // Act
    const code = exitCodeFor(outcome);
    // Assert
    assert.equal(code, 1);
  });

  it('should exit 1 for an incomplete A/A run', async () => {
    // Arrange
    const outcome = await report(
      [new Error('rate limited'), 'Hello Lucía'],
      { aa: true },
      {
        mustNot: [],
      },
    );
    // Act
    const code = exitCodeFor(outcome);
    // Assert
    assert.equal(code, 1);
  });

  it('should exit 2 on a harness fault', () => {
    // Arrange
    const fault = new HarnessFault('Duplicate case id "a".');
    // Act
    const code = exitCodeFor(fault);
    // Assert
    assert.equal(code, 2);
  });

  it('should exit 2 on any unexpected error, never as a model failure', () => {
    // Arrange
    const error = new TypeError('suite.cases is not iterable');
    // Act
    const code = exitCodeFor(error);
    // Assert
    assert.equal(code, 2);
  });

  it('should exit 3 when the report is complete but its quality is not gated', async () => {
    // Arrange
    const outcome = await report(['Hello Lucía']);
    // Act
    const code = exitCodeFor(outcome);
    // Assert
    assert.equal(code, 3);
  });

  it('should exit 3 when an assertion is too noisy to gate', async () => {
    // Arrange
    const key = assertionKey('case-refund', 'must', 'names the customer');
    const baseline = { ...armed.baseline, ns: { [key]: 2 } };
    const outcome = await report(['Hello Lucía'], { baseline }, { n: 2 });
    // Act
    const code = exitCodeFor(outcome);
    // Assert
    assert.equal(outcome.cases[0].assertions[0].verdict, 'too-noisy');
    assert.equal(code, 3);
  });
});
