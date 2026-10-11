// What an eval case is (design §7.5): an input builder, `must` assertions for quality and
// `mustNot` assertions for safety, each a predicate over the parsed output with a human label.
import type { ModelAccess } from './model';

/**
 * A predicate over the parsed output. For `must` it states what the output should do; for
 * `mustNot` it states the forbidden thing, so a run keeps a `mustNot` assertion when it is false.
 */
export type Assertion<O> = { label: string; check: (output: O) => boolean };
export type AssertionKind = 'must' | 'mustNot';
export type EvalCase<I, O> = {
  id: string;
  /** Built afresh for every run. A throw makes that run unmeasured (the case could not be seeded). */
  input: () => I | Promise<I>;
  must: Assertion<O>[];
  mustNot: Assertion<O>[];
  /** Runs for this case; the runner's default (3) otherwise. */
  n?: number;
};
/**
 * The system under test. It must honour `signal`, which aborts when the run times out: the runner
 * moves on, so a subject that ignores it keeps working (and calling the model) in the background.
 */
export type Subject<I> = (input: I, signal: AbortSignal) => Promise<unknown>;
/** What `npm run eval -- <file>` loads: the default export of a suite module. */
export type EvalSuite<I, O> = {
  name: string;
  cases: EvalCase<I, O>[];
  /** Builds the subject; `model` is the gateway, so a real subject respects MODEL_PROVIDER. */
  subject: (model: ModelAccess) => Subject<I>;
  /** Turns the raw output into the asserted shape; a throw makes the run unmeasured. */
  parse: (raw: unknown) => O;
};

/** A fault of the harness, the golden file or a baseline, never of the model: the eval exits 2. */
export class HarnessFault extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HarnessFault';
  }
}

/** Rejects a malformed golden set before any run, so it is never scored as a model failure. */
export function validateCases<I, O>(cases: EvalCase<I, O>[]) {
  if (!Array.isArray(cases)) throw new HarnessFault('The suite cases must be an array.');
  if (cases.length === 0) throw new HarnessFault('The suite has no case.');
  const ids = new Set<string>();
  for (const c of cases) {
    if (!c.id?.trim()) throw new HarnessFault('A case has no id.');
    if (ids.has(c.id)) throw new HarnessFault(`Duplicate case id "${c.id}".`);
    ids.add(c.id);
    if (typeof c.input !== 'function')
      throw new HarnessFault(`Case "${c.id}": input must be a function.`);
    if (c.n !== undefined && (!Number.isInteger(c.n) || c.n < 1))
      throw new HarnessFault(`Case "${c.id}": n must be a positive integer.`);
    if (!Array.isArray(c.must) || !Array.isArray(c.mustNot))
      throw new HarnessFault(`Case "${c.id}": must and mustNot must be arrays.`);
    const all = [...c.must, ...c.mustNot];
    if (all.length === 0) throw new HarnessFault(`Case "${c.id}" has no assertion.`);
    const labels = new Set<string>();
    for (const a of all) {
      if (!a.label?.trim()) throw new HarnessFault(`Case "${c.id}" has an unlabelled assertion.`);
      if (labels.has(a.label))
        throw new HarnessFault(`Case "${c.id}" repeats the assertion label "${a.label}".`);
      labels.add(a.label);
      if (typeof a.check !== 'function')
        throw new HarnessFault(`Case "${c.id}", "${a.label}": check must be a function.`);
    }
  }
}
