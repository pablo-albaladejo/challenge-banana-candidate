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
| `npm run test:e2e`     | Playwright browser journeys (`*.e2e.ts`) against an isolated stack    |

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
the same change that fixes it (red → green), not a skipped placeholder. Never write a test that
asserts a known-wrong behavior just to be green.

## Test types

| Type            | Scope                                                      | Real                               | Replaced            | File              |
| --------------- | ---------------------------------------------------------- | ---------------------------------- | ------------------- | ----------------- |
| **Unit**        | Pure functions only (`chunker`, `prompt`, vector helpers)  | Everything                         | Nothing             | `x.test.ts`       |
| **Integration** | A module or route in-process, against real infrastructure  | Bank over HTTP, SQLite, `fixtures` | OpenAI (local fake) | `x.test.ts`       |
| **E2E**         | User journeys in a browser against the whole running stack | Next, bank, SQLite                 | OpenAI (local fake) | `app/page.e2e.ts` |

Integration is the bulk. Unit tests are for logic with no I/O; E2E covers a few journeys only.

### The bank is a black box

Evaluation may replace `simulator/` with another implementation of `docs/contracts.md`. So
application tests (`app/`, `src/`) **never import `simulator/*`** and never mock `bankRequest`:
they start the real simulator over HTTP with `tests/support/bank.ts` and assert on the ledger
through its admin snapshot. Only `simulator/*.test.ts` import the simulator directly.

### The model is a scripted fake

Tests never reach OpenAI. `tests/support/openai.ts` starts a local server for `/v1/responses` and
`/v1/embeddings` and points the SDK at it (`OPENAI_BASE_URL`). Script the model's turns, then
inspect what the app sent it.

Retrieval shortcut: `seedApp()` restores the index and caches the vector of every chunk text,
so `searchDocuments(<exact chunk text>)` ranks that chunk first **without any model call**.

## Harness (`tests/support/`)

| Helper       | Use                                                                                                                                                                                                                                                                     |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bank.ts`    | `startBank()`/`stopBank()` in `before`/`after`; `resetBank(profile?, seed?)` in `beforeEach`; `bankSnapshot()`, `operationsFor(user)`, `balanceOf(account)` to assert ledger effects                                                                                    |
| `network.ts` | `startLossyBank((method, path) => boolean, fault?)`: real network fault injection between app and bank after the bank processed the request: `drop` (lost response, default), `html-502`, `empty`, `truncated`, `hang` (held until `release()`). Close it in `finally`. |
| `openai.ts`  | `startFakeOpenAI()` → `fake.script(toolCall(name, args), reply(text))`, `fake.requests`, `fake.embed(text, vector)`, `fake.reset()`, `fake.close()`                                                                                                                     |
| `api.ts`     | `api('POST', 'actions', { as: 'lucia', body })` → `{ status, body }`, calling `route.ts` in-process with a signed session                                                                                                                                               |
| `db.ts`      | `intentRow(id)`, `approvalsFor(intentId)`, `runOf(runId)`, `latestRun()`, `messagesOf(runId)`, `events()`, `eventsFor(runId)`: read what the app stored                                                                                                                 |

```ts
describe('transferMoney', () => {
  before(startBank);
  after(stopBank);
  beforeEach(() => resetBank());
  it('should move the amount at the bank once when the transfer completes', async () => {
    // Arrange
    const before = await balanceOf('acc-lucia');
    // Act
    const result = await api('POST', 'actions', {
      as: 'lucia',
      body: { name: 'transfer_money', arguments: input },
    });
    // Assert
    assert.equal(result.body.status, 'completed');
    assert.equal(await balanceOf('acc-lucia'), before - input.amountCents);
    assert.equal((await operationsFor('lucia')).length, 2); // seed history + this one
  });
});
```

`tests/setup.ts` reserves a free bank port per test file before `src/config.ts` loads, so files run
in parallel without colliding.

## Test data: world, factories, db readers

Test data comes from three places, each with one job. Do not write per-file builders
(`context()`, `input`, `chunk()`, `fixture()`, `intentRow()`…): use these.

| Where                         | What                                                                                                                                                                                                                                                                                                                                                                                                                   | Use for                                                     |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `tests/fixtures/world.ts`     | Typed constants of the seeded world: `customers`, `operators`, `accounts`, `conversations`, `cases`, `historicTransfer`, `unknown` ids, `counts`, `money` limits                                                                                                                                                                                                                                                       | Every id the bank or the app seed knows                     |
| `tests/fixtures/factories.ts` | Rosie + Faker: `toolContextFactory`, `transferInputFactory` (valid: lucia `acc-lucia` → `acc-bruno`), `intentFactory` + `persistIntent()`, `storedIntent` (repo input) and `intentRowOf` (expected row), `searchResultFactory`, `chunkFactory`, `documentRecordFactory`, `eventDataFactory`, repo inputs (`conversationFactory`, `messageFactory`, `runFactory`, `approvalFactory`, `incidentFactory`, `eventFactory`) | Objects a test builds; override only what the case is about |
| `tests/support/db.ts`         | Readers of the app database: `intentRow`, `approvalsFor`, `runOf`, `latestRun`, `messagesOf`, `events`, `eventsFor`                                                                                                                                                                                                                                                                                                    | Asserting what the application stored                       |

```ts
it('should move the amount between both accounts exactly once', async () => {
  // Arrange
  const input = transferInputFactory.build();
  const ctx = toolContextFactory.build();
  const fromBefore = await balanceOf(input.fromAccountId);
  // Act
  await confirmed(ctx, input);
  // Assert
  assert.equal(await balanceOf(input.fromAccountId), fromBefore - input.amountCents);
});
```

- **Never fake bank ids.** The real bank validates customers, accounts and references, so Faker never
  invents them: they come from `world.ts`. A made-up id tests a not-found path, and then it is
  `unknown.account`, `unknown.person`, … on purpose.
- Faker fills only free values: amounts, concepts, texts, generated run/intent ids. Default amounts
  stay well below `money.lowestBalanceCents`, so a default transfer never fails for funds. A case
  about limits names them explicitly (`money.maxTransferCents`, `input.amountCents + 1`).
- **Assert against the built object, never a literal Faker could change**:
  `assert.equal(op.amountCents, input.amountCents)`, not `assert.equal(op.amountCents, 1234)`.
- Build in `// Arrange`, one object per case. Shared module-level fixtures hide what a case uses.
- A thin local wrapper is fine when a whole file repeats the same override (for example a
  `toolContextFactory.build({ conversationId })` used by every case): it only combines shared
  factories and world ids, and never builds data of its own.

### Random seed

Every `npm test` run uses a **new random Faker seed**, printed at the start and end of the run:

```
Test seed 1424114291 · reproduce with TEST_SEED=1424114291 npm test
```

`TEST_SEED=<n> npm test` replays a run exactly. `tests/global-setup.ts` (`--test-global-setup`) runs
once in the node:test parent and sets `TEST_SEED`; every test file runs in a child process that
inherits it, and `tests/setup.ts` seeds Faker with it. A single-file run without `TEST_SEED` picks
and prints its own seed. A failure that only appears under some seed is a factory bug (a range
that can break a valid case): fix the factory, not the test.

## E2E (Playwright)

- Runner: `@playwright/test`, run with `npm run test:e2e`. It is the one exception to node:test.
- Location: next to the page they drive: `app/page.e2e.ts`. The `.e2e.ts` suffix keeps them out of
  `npm test`.
- Same conventions: import `describe`, `it` and `expect` from `tests/support/e2e.ts` (thin aliases
  of `test.describe` / `test`), so every case is still `it('should …')` with AAA comments.
- Playwright starts its own isolated stack (other ports, temp data dir, fake OpenAI), so it never
  touches a running `npm run dev` or `.data/`.
- Select by role and visible text first; add a `data-testid` only where no accessible handle exists.

## TDD loop

1. Write the `it('should …')` for the expected behavior next to the code.
2. Run it and confirm it fails **for the right reason** (the bug, not a typo or setup error).
3. Make the minimal change that turns it green.
4. Run `npm test`, `npm run typecheck`, `npm run format:check`.

## Current map

| Layer       | Source                                                                             | Test                                                                                  | Harness                       |
| ----------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ----------------------------- |
| E2E         | `app/page.tsx` (whole stack)                                                       | `app/page.e2e.ts` (7 journeys)                                                        | Playwright, fake model, bank  |
| Integration | `app/api/[...path]/route.ts`, `src/http/{handle,routes}.ts`, `src/http/handlers/*` | `route.test.ts` (100): the HTTP suite through `api()`; handlers have no sibling tests | `api.ts`, `bank.ts`, `openai` |
| Unit        | `src/http/{router,errors,respond}.ts`                                              | sibling tests (25)                                                                    | —                             |
| Integration | `src/banking/*`                                                                    | `client`, `bank`, `intents`, `dispatch`, `authorization`, `reconcile`, `actions` (78) | `bank.ts`                     |
| Integration | `src/agent/*`                                                                      | `prompt`, `tools`, `run` (41)                                                         | `openai.ts`, `bank.ts`        |
| Integration | `src/retrieval/*`                                                                  | `embeddings`, `store`, `search` (34)                                                  | `openai.ts`, `seedApp`        |
| Integration | `src/ingestion/*`                                                                  | `chunker` (8), `pipeline` (11)                                                        | `openai.ts`                   |
| Integration | `src/operator/view.ts`                                                             | `view.test.ts` (5)                                                                    | `seedApp`                     |
| Integration | `src/{db,telemetry,people}.ts`                                                     | sibling tests (11)                                                                    | real SQLite                   |
| Integration | `src/migrations.ts`                                                                | `migrations.test.ts` (7)                                                              | real SQLite files             |
| Integration | `src/persistence/*`                                                                | one sibling test per repo (35)                                                        | real SQLite, `db.ts` readers  |
| Unit        | `src/config.ts`                                                                    | `config.test.ts` (10): `loadConfig`, secrets check                                    | —                             |
| Contract    | frozen import paths (plan §2)                                                      | `src/public-surface.test.ts` (15)                                                     | —                             |
| Integration | `src/{auth,seed}.ts`                                                               | sibling tests                                                                         | —                             |
| Contract    | `simulator/{bank,seed}.ts`                                                         | sibling tests                                                                         | —                             |

Not tested on purpose: `src/types.ts` (types only; its import is checked by `public-surface.test.ts`), `scripts/*` (CLI
wrappers, exercised by the E2E stack boot), `app/layout.tsx` (covered by E2E), `simulator/server.ts`
(external bank; replaced at evaluation).

Known bugs are **not** encoded as tests, green or red. Each one gets its red test in the same change
that fixes it (TDD). The simulator tests document the bank contract; they do not protect the
application, which may be evaluated against another bank.
