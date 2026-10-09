# Testing

Living guide for how tests are written in this project. It evolves with the work (TDD): when a
convention changes, change it here first.

## Run

| Command                | Effect                                                                |
| ---------------------- | --------------------------------------------------------------------- |
| `npm test`             | Runs every `*.test.ts` under `app/`, `src/` and `simulator/`          |
| `npm run typecheck`    | Type-checks application and test files                                |
| `npm run format:check` | Prettier check (`npm run format` to apply)                            |
| Single file            | `node --import tsx --import ./tests/setup.ts --test src/auth.test.ts` |

Runner: `node:test` with `node:assert/strict`. No Jest or Vitest.

## Rules

### 1. Colocation: the test lives next to the file it tests

`src/auth.ts` → `src/auth.test.ts`. `app/api/[...path]/route.ts` → `app/api/[...path]/route.test.ts`.
A source file without a sibling `.test.ts` is visibly untested. Next.js only routes `route.ts` and
`page.tsx`, so test files inside `app/` are safe.

### 2. `describe` per module or function, `it` per case

```ts
describe('transfer', () => {
  it('should replay the original operation when the same actor reuses a reference', () => {
    // ...
  });
});
```

- `describe` names the unit under test: a function (`transfer`, `seedApp`), a module, or an HTTP
  endpoint (`POST /api/search`).
- One `it` per behavior. Split rather than piling unrelated assertions into one case.

### 3. Titles: `it('should …')`, functional and positive

Every case starts with `it('should` and states the expected business outcome, not the mechanics.

| ✅                                                                        | ❌                                      |
| ------------------------------------------------------------------------- | --------------------------------------- |
| `should keep the ledger unchanged when the failure happens before commit` | `should not move money` (negated)       |
| `should reject transfers with insufficient funds`                         | `test insufficient funds` (no `should`) |
| `should resolve the actor from the signed session`                        | `should call sign() with the secret`    |

Rejections are positive expectations: `should reject …` is valid.

### 4. Body: Arrange / Act / Assert

Each `it` body is split by the comments `// Arrange`, `// Act`, `// Assert`, in that order.

- When the action is the assertion (`assert.throws`, `assert.rejects`, `assert.doesNotThrow`), use
  a single `// Act & Assert`.
- Keep `// Arrange` even when empty, so the structure stays scannable.
- State shared by every case in a `describe` (for example `seedBank()`) may go in `beforeEach`;
  case-specific setup stays in `// Arrange`.

```ts
it('should keep the ledger unchanged when the failure happens before commit', () => {
  // Arrange
  setScenario('reject-before');
  const before = snapshot();
  // Act
  const result = transfer('lucia', 'reject', input);
  // Assert
  assert.equal(result.fault, 'reject-before');
  assert.deepEqual(snapshot(), before);
});
```

### 5. Isolation and environment

`tests/setup.ts` is preloaded (`--import`) into every test file. node:test runs each file in its own
process, so each file gets:

- a fresh temp `DATA_DIR` / `BANK_DATA_DIR`, removed on exit (local `.data/` is never touched);
- `OPENAI_API_KEY=''`, so a real key in `.env.local` can never reach a test. Tests must not spend
  quota or depend on model output.

Because the environment is set before any module loads, tests use plain static imports.

### 6. Banned in committed tests

`it.skip`, `it.only`, `it.todo`, and tests without assertions. A known bug gets a failing test in
the same change that fixes it (red → green), not a skipped placeholder.

## TDD loop

1. Write the `it('should …')` for the expected behavior next to the code.
2. Run it and confirm it fails **for the right reason** (the bug, not a typo or setup error).
3. Make the minimal change that turns it green.
4. Run `npm test`, `npm run typecheck`, `npm run format:check`.

## Current map

| Source                       | Test               | Covers                                                  |
| ---------------------------- | ------------------ | ------------------------------------------------------- |
| `app/api/[...path]/route.ts` | `route.test.ts`    | `POST /api/search` without an API key                   |
| `src/auth.ts`                | `auth.test.ts`     | `actor` (signed session), `sameOrigin`                  |
| `src/seed.ts`                | `seed.test.ts`     | `seedApp`: conversations, cases, index, reproducibility |
| `src/ingestion/pipeline.ts`  | `pipeline.test.ts` | `documents`, `readDocument`                             |
| `simulator/bank.ts`          | `bank.test.ts`     | `transfer` ledger rules and faults, `setScenario`       |
| `simulator/seed.ts`          | `seed.test.ts`     | `seedBank` reproducibility                              |

Known gaps (no sibling test yet): `src/banking/*`, `src/agent/*`, `src/operator/view.ts`,
`src/retrieval/search.ts`, and most routes in `route.ts`. The simulator tests document the bank
contract; they do not protect the application, which may be evaluated against another bank.
