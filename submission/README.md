# Submission

Evaluator entry point for the Banana Bank challenge ([`../docs/challenge.md`](../docs/challenge.md)). Project setup and troubleshooting: [`../README.md`](../README.md).

**Status line.** Written against `main` at `ed1284b`. On `main`: every Part 1 fix in the table below (readiness P0-5 and P0-6 included), the architecture refactor, Part 2 commits 1–3 (piece B, transfer pre-flight checks) and the eval harness (base and per-metric gating). **Landing** (being integrated, finalised by Pablo after integration): Part 2 commits 4–7 (piece A, the verified case brief, and its real-model eval). Rows marked _landing_ get their SHA when they reach `main`; nothing below reports a result that was not produced.

## Part 1 - Prepare for Monday

### What I chose and why

**The headline problem: a customer could be charged twice.** In the starter, when the bank committed a transfer but its response was lost, the app retried with a new bank reference and the bank executed it again. The customer paid twice and was told `completed`, or, when every response was lost, `failed`, which invites yet another try. [`part1-evidence.md`](part1-evidence.md) reproduces both: two debits for one request and a third on retry (2a), and `failed` with two committed references (2b).

**The root cause** ([`production-readiness.md`](production-readiness.md), "Root cause shared by most money-path findings"): an intent only advanced inside the synchronous request that created it. Nothing re-checked unverified intents, nothing noticed an identical open intent, and the transport did not treat every unreadable bank answer as "unverified". Findings P0-1 to P0-4 are symptoms of that one cause, so they were fixed as one block in `149bd39`: anything ambiguous lands in `unknown`, and `unknown` is always reconciled with the bank.

The supporting fixes around it close the same path from both ends: nothing moves money without explicit confirmation, one bank reference per intent, retries answered from the record. Beyond money, I fixed the production-launch blockers that were cheap and certain (default secrets, the persona switcher in production) and the problems that made the operator and the agent untrustworthy (grounding, case evidence). The full review, with what was checked and found correct and what stays open, is [`production-readiness.md`](production-readiness.md).

### Fixes (all on `main`)

| Area             | Problem                                                                                                       | Fix                                                                                                                      | Commit               |
| ---------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | -------------------- |
| Money path       | P0-1 to P0-4: unreadable bank bodies recorded as `failed`, stuck `processing`, `unknown` never reconciled, identical retry pays twice | Anything ambiguous becomes `unknown`; stale `processing` and `unknown` reconciled (also on the dashboard); identical transfer held while its twin is unresolved; strict transitions | `149bd39`            |
| Money path       | A transfer executed with no customer confirmation                                                             | `transfer_money` only creates a 10-minute proposal; money moves on confirm                                               | `409a1f3`            |
| Money path       | A new bank reference per retry risked a double payment                                                        | One bank reference per intent                                                                                            | `c58fe72`            |
| Money path       | Retrying a completed intent called the bank again and could flip it to `failed`                               | Retry answered from the record                                                                                           | `77ff01b`            |
| Bank integration | A lost response was recorded as `failed` although the bank had committed it                                   | Unconfirmed outcomes become `unknown` and are reconciled with the bank                                                   | `99659a1`            |
| Production start | P1-5: production silently used public default secrets                                                         | `npm start` exits 1 with default, short, default-based or reused secrets                                                 | `f13e833`            |
| Identity         | P0-7: any visitor could pick any person, operators included                                                   | Persona switcher off by default in production; production refuses to start with it on (real login stays open)          | `fd8f221`            |
| HTTP             | P0-5: DNS rebinding: a page whose name re-resolves to 127.0.0.1 passed the same-origin check                   | Host allowlist (`127.0.0.1`/`localhost` on `APP_PORT` plus `ALLOWED_HOSTS`); any other Host gets 421 on every page, asset and API request. Verified by unit tests, the "Host allowlist" e2e journey (`evil.test` gets 421) and mutations, each red then restored | `ed1284b`            |
| Money path       | P0-6: the proposal card showed raw ids (`acc-lucia → acc-bruno`), so a transfer to another person looked like any other | The card names the source account and the recipient, with a masked IBAN and "another person"; never a raw id. Verified by unit tests, the e2e journey "should name the source account and the recipient on the proposal card" and mutations, each red then restored | `93b1763`            |
| Model provider   | No OpenAI credit blocked every chat path                                                                      | Opt-in `claude-cli` provider with lexical search fallback; developer items get system authority, strict schema, run metadata | `966f5e0`, `55b0e8a`, `502fa3e`, `d2f0a5a` |
| Persistence      | P2-2: no schema migrations, positional inserts                                                                | `loadConfig`, versioned migrations and table repositories                                                                | `db48b4b`            |
| HTTP             | P2-7: `route.ts` god handler; wrong methods, trailing segments, role checked after body                       | Router and handlers; 405 with `Allow`, exact paths, role before body                                                     | `6e348db`, `420cbed` |

Other fixes from the review, each with its own test: same-account and unknown-destination transfers rejected (`f8738fc`); cited, version-valid answers (`1ad39d8`); malformed tool arguments and round-limit exhaustion reported (`28b4d55`, `81d766a`); conversation ownership in `sendMessage` (`0a9f7fe`); every chunk labelled and only valid versions searched (`345799d`); embeddings-batch failure pinned (`ff97cbf`); full operator case evidence (`bc3cc62`); cross-site POST without `Origin` rejected (`efe364c`); telemetry keeps arguments, output, error and duration (`d93fae5`).

### How each was verified

- **Tests first.** Each fix starts with a failing test, confirmed to fail for the right reason ([`../TESTING.md`](../TESTING.md)). `npm test` runs `node:test` against the real simulator over HTTP and a scripted fake model; lost responses are reproduced with the lossy network proxy in `tests/support/network.ts` (faults `html-502`, `empty`, `truncated`, `hang` added in `149bd39`).
- **End to end.** `npm run test:e2e` runs the Playwright journeys in `app/page.e2e.ts` on an isolated stack.
- **Fire-proof mutations.** For safety claims the code was broken on purpose and a test had to go red: for example every gate of P0-7 (listed in `production-readiness.md` P0-7), 13 mutations of the accounts vertical (`be80fc4`) and the lint-rule probes of `1e6c507`.
- **Before/after.** [`part1-evidence.md`](part1-evidence.md) runs the same HTTP requests on the starter (`726b592`) and on `main` at `dc39816`, with the exact commands, the bank operation counts and the balances: one debit instead of two or three, `unknown` instead of `failed`, and reconciliation to `completed`.

### Architecture refactor (supporting work)

Phases 1 to 7 split the starter into seven hexagonal verticals (`identity`, `knowledge`, `conversations`, `transfers`, `support`, `accounts`, `assistant`) with ESLint-enforced layers, behaviour pinned by characterisation tests written green on the old code first. Plan and record: [`architecture-decoupling.md`](architecture-decoupling.md).

## Part 2 - "The agent never states a fact it cannot prove"

### The idea and why it is useful

The double payment of Part 1 was, at heart, the agent asserting something the bank had not confirmed ("I could not complete the transfer, you can try again"). Part 2 turns that into a product rule: **facts come from code that checks the bank, never from the model; the model writes the words.** It applies at the two moments where a wrong statement costs money or trust:

- **Piece B, the customer's transfer: pre-flight checks.** Every proposal carries code-computed checks: balance after the transfer (a blocker when short), first-time recipient, unusual amount, and a pending twin. Each names its source. The approval card shows them, blockers first, and the agent relays them; it cannot compute, soften or drop them.
- **Piece A, the operator's reply: a verified case brief.** A fixed workflow turns a support case into a timeline, a verdict on each claim the assistant made (verified, contradicted by the bank, or could not be verified), findings with the cited internal procedures, and an editable reply. On **Send and close** the draft is checked again against fresh facts; an unbacked amount or promise is flagged, the operator must take responsibility to send it anyway, and the reply closes the case and reaches the customer signed "Banana Bank support · Marta".

For the operator this turns a case from "read everything and hope" into a checked brief in one click; for the customer it means no reply, from the agent or from a person, states a balance, a status or a promise the bank does not back. Design, decisions log and test plan: [`part2-design.md`](part2-design.md).

### How to try it

1. `npm ci`, `npm run setup`, then in `.env.local` set `MODEL_PROVIDER=auto` (without OpenAI credit, chat and the brief run on Claude Haiku via `claude -p`; needs the Claude Code CLI logged in).
2. `npm run dev` and open `http://127.0.0.1:3000`.
3. **Pre-flight checks.** Top right, in **VIEW AS**, pick **Lucía Martín**. Open **Assistant**, start a conversation and write `Send 200 EUR to Bruno Vidal for rent`. Under **Proposals awaiting confirmation** the card shows **Pre-flight checks** (balance after, unusual amount). Then write `Actually, send 5000 EUR to Bruno Vidal for rent`: a blocker and the button **Confirm these details anyway**. Do not confirm.
4. **Verified brief** _(landing: commits 4–6)_. In **VIEW AS**, pick **Marta Sanz · Operator**, open **Cases** and the case "Could someone check the dinner payment with Bruno when available?". Press **Generate brief**: the assistant's "I could not complete the transfer" is **Contradicted**, and a blocker finding _Retry advice on a completed payment_ cites `[procedure-3 v2]`.
5. **Send and close.** In **Reply to send**, add `We will refund EUR 90 today.` and press **Send and close**: the send stops and flags EUR 90. Tick the responsibility checkbox and send again; the case becomes **Resolved**. Switch back to Lucía: her **Dinner payment** conversation ends with a message from **Banana Bank support · Marta**.

The full click path, including the degraded brief without a model, is in [`video-script.md`](video-script.md).

### Status per commit

| #   | Commit                                                                 | State                                     |
| --- | ---------------------------------------------------------------------- | ----------------------------------------- |
| 1   | `a8c5d8d` policy rules table, drift guard, prompt fence                | On `main`                                 |
| 2   | `df4cc7a` pre-flight checks on proposals (hardened in `8b5769e`)       | On `main`                                 |
| 3   | `72409f1` pre-flight checks on the approval card                       | On `main`; e2e journey B                  |
| 4   | Deterministic case brief: timeline, claim oracle, findings, procedures | _Landing_                                 |
| 5   | Operator reply closes the case and reaches the customer                | _Landing_                                 |
| 6   | Model-written brief: claim extraction, writing call, post-check        | _Landing_                                 |
| 7   | Real-model case-brief eval (L5)                                        | Harness on `main` (`dc39816`, `885ddf8`); suite and report _landing_ |

## Verified / not verified

Verified:

- The Part 1 fixes: tests, e2e journeys and fire-proof mutations as above, and the before/after runs in [`part1-evidence.md`](part1-evidence.md) (starter `726b592` against `main` at `dc39816`).
- Part 2 piece B: unit, contract and adversarial tests, and e2e journey B.
- Every commit passed the hooks: `pre-commit` (lint, `format:check`, `typecheck`) and `pre-push` (`npm test`, `npm run test:e2e`).

Not verified:

- **`gpt-6-luna`, the production model, was never exercised.** There was no OpenAI credit; every real-model run used Claude Haiku via `claude-cli`. The `developer`-item gate before Part 2 commit 5 therefore stays open, and commit 5 ships the `user`-role fallback (`part2-design.md` §9).
- The model path in [`part1-evidence.md`](part1-evidence.md) was not exercised: transfers went through `POST /api/actions` with the same tool executor, not through the assistant.
- Case 2b of the evidence relies on an ad hoc proxy outside the repo (its source is in the document).
- Real-model eval numbers: none are claimed until the suite and its report land.
- A fresh-unzip run of this README on the final ZIP: done at packaging.

## Run, test and verify

Requirements: Node 24 or newer, npm, and for `claude-cli` the Claude Code CLI logged in. Details: [`../README.md`](../README.md).

| Check              | Command                                 | Notes                                                                                   |
| ------------------ | --------------------------------------- | --------------------------------------------------------------------------------------- |
| Types              | `npm run typecheck`                     |                                                                                         |
| Lint and format    | `npm run lint` / `npm run format:check` | ESLint also enforces the layer rules                                                    |
| Unit + integration | `npm test`                              | Real bank over HTTP, scripted fake model; never uses a real key                         |
| Browser journeys   | `npm run test:e2e`                      | Isolated stack: ports 3100/4101, fake model on 4102, `.e2e/data`                        |
| Git hooks          | automatic                               | `pre-commit`: lint, format:check, typecheck. `pre-push`: `npm test`, `npm run test:e2e` |

`npm run reset` (services stopped) wipes local activity; run `npm run ingest` afterwards. `npm run scenario -- normal | intermittent 17 | lost-response` switches the running bank's failure profile.

**Production mode cannot be used for the demo.** `npm start` (after `npm run build`) has no persona selector: the switcher is off in production and the app refuses to start with it on (P0-7), and it exits 1 unless `SESSION_SECRET`, `BANK_SERVICE_SECRET` and `BANK_ADMIN_SECRET` are three different random values of at least 32 characters (P1-5). Use `npm run dev` to try the work.

## Contents of this folder

| Path                                                                                           | What it is                                                                                     |
| ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `README.md`                                                                                    | This file                                                                                      |
| `AGENTS.md`                                                                                    | Folder guide for AI agents                                                                     |
| [`production-readiness.md`](production-readiness.md)                                           | Part 1 review: what was checked, prioritised findings, what is fixed                           |
| [`part1-evidence.md`](part1-evidence.md)                                                       | Part 1 before/after evidence with the exact commands                                           |
| [`architecture-decoupling.md`](architecture-decoupling.md)                                     | Plan and record of the architecture refactor (Phases 1 to 7)                                   |
| [`part2-design.md`](part2-design.md)                                                           | Part 2 design, decisions log, test plan and implementation plan                                |
| [`video-script.md`](video-script.md)                                                           | Video script with exact screens, URLs and clicks (Spanish)                                     |
| [`ai-sessions.md`](ai-sessions.md)                                                             | How AI was used, and a guide to the session files                                              |
| `ai-sessions/e72ad6d8-ffa0-4812-8d4f-841becac3b3e.jsonl`                                       | Main Claude Code session (2026-10-09 to 2026-10-11): the whole project; re-exported at the end |
| `ai-sessions/35663121-c5c3-4670-b08e-f541bb74e9ed.jsonl`                                       | `claude -p` probe on Haiku, 2026-10-10 (first prompt "hola"), five seconds long              |
| `ai-sessions/7ca132fc-07c4-4d26-bc93-278238e5f185.jsonl`                                       | `claude -p` probe on Haiku, 2026-10-10 ("que version de haiju eres"), checking the CLI model                        |
| `ai-sessions.zip`                                                                              | Subagent transcripts of the main session; added at packaging                                   |
| `demo.mp4`                                                                                     | Demo video recorded from `video-script.md`; added at packaging                                 |
| Case-brief eval report                                                                         | _Landing_ with Part 2 commit 7                                                                 |

## Packaging

Build the ZIP from Git, never with `zip -r` over the working tree:

```sh
git archive --format=zip --prefix=banana-bank/ -o banana-bank.zip HEAD
mkdir -p banana-bank/submission
cp submission/demo.mp4 submission/ai-sessions.zip banana-bank/submission/
zip banana-bank.zip banana-bank/submission/demo.mp4 banana-bank/submission/ai-sessions.zip
unzip -l banana-bank.zip | grep -E '\.env' # only .env.example may appear
```

`git archive` only takes tracked files, so these never enter the ZIP: `.claude/`, `.omc/`, `.data/`, `.e2e/`, `.next-e2e/`, `test-results/`, `.eval-results/`, `node_modules/`, `.next/`, `.git/` and `.env.local`. Then unzip into a fresh folder, follow this README and check that every path in the table above exists and opens.
