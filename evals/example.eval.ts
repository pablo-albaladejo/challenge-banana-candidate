// The shape of a suite module for `npm run eval -- evals/example.eval.ts`. Its subject is a
// trivial fake that never calls the model; a real suite builds its subject from `model`. It
// declares a metric, so quality is gated per metric and its `must` rates are diagnostics.
import type { EvalSuite } from './case';

const suite: EvalSuite<{ name: string }, string> = {
  name: 'example',
  subject: () => async (input) => `Hello ${input.name}, your transfer is being checked.`,
  parse: (raw) => {
    if (typeof raw !== 'string' || !raw.trim()) throw new Error('expected a non-empty reply');
    return raw;
  },
  metrics: {
    // Per run, over every case: the share of the golden set greeted by name.
    'greets by name': (run) =>
      run.filter((o) => o.kept('must: greets the customer by name')).length / run.length,
  },
  cases: [
    {
      id: 'greets-lucia',
      input: () => ({ name: 'Lucía' }),
      must: [{ label: 'greets the customer by name', check: (out) => out.includes('Lucía') }],
      mustNot: [
        { label: 'promises a refund', check: (out) => /we will refund/i.test(out) },
        { label: 'invites a retry', check: (out) => /(you can|please) try again/i.test(out) },
      ],
    },
    {
      id: 'greets-diego',
      input: () => ({ name: 'Diego' }),
      must: [{ label: 'greets the customer by name', check: (out) => out.includes('Diego') }],
      mustNot: [{ label: 'states a completion', check: (out) => /was completed/i.test(out) }],
    },
  ],
};
export default suite;
