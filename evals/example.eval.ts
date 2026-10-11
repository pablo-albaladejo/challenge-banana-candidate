// The shape of a suite module for `npm run eval -- evals/example.eval.ts`. Its subject is a
// trivial fake that never calls the model; a real suite builds its subject from `model`.
import type { EvalSuite } from './case';

const suite: EvalSuite<{ name: string }, string> = {
  name: 'example',
  subject: () => async (input) => `Hello ${input.name}, your transfer is being checked.`,
  parse: (raw) => {
    if (typeof raw !== 'string' || !raw.trim()) throw new Error('expected a non-empty reply');
    return raw;
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
      n: 4,
      must: [{ label: 'greets the customer by name', check: (out) => out.includes('Diego') }],
      mustNot: [{ label: 'states a completion', check: (out) => /was completed/i.test(out) }],
    },
  ],
};
export default suite;
