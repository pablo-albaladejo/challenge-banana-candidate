// Runs once in the node:test parent process (--test-global-setup), before any test file starts.
// Test files run in child processes that inherit this environment, so one TEST_SEED reaches every
// file of the run. A new seed each run widens what the factories explore; TEST_SEED=n replays one.
// Plain TypeScript only: the parent process strips types natively, without tsx.
const banner = () =>
  console.log(
    `Test seed ${process.env.TEST_SEED} · reproduce with TEST_SEED=${process.env.TEST_SEED} npm test`,
  );

export function globalSetup() {
  // An empty or non-numeric TEST_SEED would let every file pick its own seed: replace it.
  if (!/^\d+$/.test(process.env.TEST_SEED ?? ''))
    process.env.TEST_SEED = String(Math.floor(Math.random() * 2 ** 31));
  banner();
}

export function globalTeardown() {
  banner();
}
