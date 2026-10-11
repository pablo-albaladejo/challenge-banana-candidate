# Demo video script

Draft written 2026-10-11. Target length **7 to 8 minutes** (the brief recommends 5 to 10; camera optional). Output file: `submission/demo.mp4`. The click paths come from the e2e journeys in [`../app/page.e2e.ts`](../app/page.e2e.ts); scenes marked **IN PROGRESS** depend on Part 2 commits 4 to 7, which are not on `main` at `f13e833`. Re-check every step against the final build before recording. Figures quoted from a document rather than observed are marked.

## Before recording

```sh
npm run reset       # services stopped
npm run ingest
npm run dev         # app http://127.0.0.1:3000, bank :4001
```

- Use `MODEL_PROVIDER=auto` or `openai` (see [`README.md`](README.md)). Chat turns can take tens of seconds; cut or speed those in editing, and say so on screen.
- Reference date for the exercise is 24 September 2026.
- Persona selector: the "Switch person" dropdown. Names used: `Lucía Martín`, `Diego Salas`, `Bruno Vidal`, `Marta Sanz · Operator`.
- Close other windows; no `.env.local` or key on screen.

## Scene map

| #   | Scene                          | Time      | Status      |
| --- | ------------------------------ | --------- | ----------- |
| 1   | The problem                    | 0:00-0:45 | Ready       |
| 2   | Part 1 readiness highlights    | 0:45-3:15 | Ready       |
| 3   | Part 2 piece B: pre-flight     | 3:15-4:45 | Ready       |
| 4   | Part 2 piece A: verified brief | 4:45-6:30 | IN PROGRESS |
| 5   | Architecture in one slide      | 6:30-7:15 | Ready       |
| 6   | How quality was enforced       | 7:15-8:00 | Ready       |

## Scene 1 - The problem (0:45)

**On screen:** the app on Lucía's overview ("Hello, Lucía.", Aurora account, Personal savings).

**Say:**

- Banana Bank launches an AI assistant on Monday. Customers consult information and make simulated transfers; operators handle cases.
- Passing the starter's tests did not mean it was safe. Three risks mattered most: money moving without a confirmation, a lost bank response treated as a failure, and answers not grounded in the documents.
- Part 2 builds on one rule: the agent never states a fact it cannot prove. Facts come from code that checks the bank, not from the model.

## Scene 2 - Part 1 readiness highlights (2:30)

Pick two or three; depth beats breadth. Suggested order, each tied to a commit in [`README.md`](README.md).

### 2a. Confirmation before money moves (`409a1f3`)

1. Select `Lucía Martín`. Open **Transfers** in the navigation.
2. Recipient `acc-bruno` (Bruno's account in the list), amount `12.34`, concept anything, press **Send transfer**.
3. A status says "Review the proposal". Show the proposal card: no money has moved yet.
4. Press **Confirm these details**. Status: "Transfer confirmed and completed".

**Say:** the model can only create a proposal; execution is a separate server route that the model cannot call. (Journey: "Transfers", `app/page.e2e.ts`.)

### 2b. Lost response treated as unknown, then reconciled (`99659a1`, `149bd39`)

1. In a terminal: `npm run scenario -- lost-response`.
2. As Lucía, make and confirm a transfer. The bank commits it and the response is lost.
3. Show that the outcome is reported as unknown, not as a failed transfer, and that nothing is sent twice.
4. Restore: `npm run scenario -- normal`.

**TODO (Pablo):** run this once on the final build and note the exact on-screen wording; the exact UI text for `unknown` was not verified in this draft. For a before/after, show the same steps on starter commit `726b592`.

### 2c. Grounded, cited answers (`1ad39d8`, `345799d`)

1. As Lucía, open **Assistant** and ask: `When is the Aurora account fee waived?`
2. Show the `[documentId vversion]` citations and that only the version valid on 24 September 2026 is used.
3. Optionally open **Documents** and show "68 sources" for a customer versus "80 sources" for operator Marta (journeys "Document library").

### 2d. Operator evidence (`bc3cc62`)

1. Select `Marta Sanz · Operator`. Heading "Every case, a person."; 17 cases, 9 open.
2. Open a case: conversation, activity, intents and bank operations are listed; missing evidence is named under gaps.

**Say:** the findings still open, including the unauthenticated persona selector, are documented in `production-readiness.md`. The selector is accepted for the demo and is a launch blocker.

## Scene 3 - Part 2 piece B: pre-flight checks on the approval card (1:30)

Backed by e2e journey B, "Pre-flight checks" (`72409f1`, `df4cc7a`, `8b5769e`).

1. Select `Lucía Martín`, **Transfers**.
2. Recipient Bruno, amount `200`, concept "Big dinner", press **Send transfer**.
3. On the approval card show, in order:
   - "will have EUR <balance after>": the design document cites EUR 3,807.50 for the seeded data (**unverified here**; read the figure off the screen).
   - The unusual-amount line: "larger than any payment from your accounts".
   - There is no "has no record of a completed transfer" line for Bruno, because the historic EUR 85 payment is reconciled with the bank first.
   - The caption on each check says where it came from (as-of time, sample size or safeguard).
4. **Confirm these details** stays enabled.
5. Switch to `Diego Salas` (small balance). **Transfers**, recipient Lucía, an amount above his balance, **Send transfer**.
6. Show "so the bank is likely to decline it" and "Blocker:". The button now reads **Confirm these details anyway** and is still enabled.

**Say:**

- Checks are computed in code from the bank and the customer's history, stored with the approval, and relayed verbatim by the model. The model does not compute them.
- The blocker does not disable confirmation: the bank is the authority on funds, and duplicating its decision risks disagreeing with it (user decision, `part2-design.md` section 10).
- Optional: ask the assistant in chat `Send EUR 200 to Bruno for the trip`; the same checks appear and the model repeats them.

## Scene 4 - Part 2 piece A: the operator's verified case brief (1:45) - IN PROGRESS

**TODO:** none of this is built at `f13e833`. Re-write the steps from the final UI. The intended flow is design section 8 (`part2-design.md`); the values below come from that document and must be re-observed.

Intended steps:

1. Select `Marta Sanz · Operator`, open `case-lucia`, press **Generate brief** (**TODO** confirm the control name).
2. Show the timeline and the claim verdicts: the assistant told Lucía "You can try again", but the bank shows a completed EUR 85.00 operation to Bruno Vidal. The brief marks that claim false and raises a "Retry advice on a completed payment" finding with cited procedures. Following the advice would have paid Bruno twice.
3. Show an honest "unverifiable" verdict (the design names `case-diego` and `case-carla`).
4. Edit the draft reply, type an unverified amount, press **Send and close**; the send-time recheck flags it and the operator must acknowledge.
5. Switch to `Lucía Martín`: the conversation shows the support message from Marta.
6. Degraded mode: blank the model key, regenerate; the deterministic brief still appears.

**If not finished by recording time:** replace this scene with a 20-second slide stating the design and status, and say plainly that it is unfinished. Do not show mock-ups as working software.

## Scene 5 - Architecture in one slide (45 s)

**Slide content:** seven verticals as boxes ranked by dependency, with the layers of one vertical beside them.

- Verticals and ranks: `identity`, `knowledge`, `conversations` (0); `transfers` (1); `support` (2); `accounts` (3); `assistant` (4). A vertical imports only lower ranks, only through its `index.ts`.
- Inside a vertical: `entry-points` (HTTP, tools, wiring), `application` (use cases, ports), `domain` (pure rules), `infrastructure` (SQLite, bank, model adapters).
- Outside: `src/platform` (config, DB, bank client, model gateway), `src/server` (route table), `simulator/` untouched.
- Rule enforced by ESLint and an import-graph test (`1e6c507`), not by convention.

**Say:** the bank is a black box reached through ports, so the app works against any implementation of the same contract. Source: [`architecture-decoupling.md`](architecture-decoupling.md), [`../src/AGENTS.md`](../src/AGENTS.md).

## Scene 6 - How quality was enforced (45 s)

**On screen:** a terminal and the commit log, then `TESTING.md` rules.

Show, with a real run (**TODO** record the counts from the final build, do not quote these from the draft):

```sh
npm test
npm run test:e2e
npm run lint
```

**Say:**

- Failing test first, then the fix; no `skip`, `only` or `todo`.
- Characterisation tests before every refactor, green on the old code first.
- Safety claims proved by mutation: break the code, watch a test go red (for example `be80fc4` lists 13 mutations).
- Tests never touch OpenAI or the real Claude; they use a scripted fake and the real bank over HTTP.
- Husky hooks gate every commit and push; `--no-verify` is not used.
- AI use: executor, independent review, fixes, human approval before each push. Details in [`ai-sessions.md`](ai-sessions.md); the original sessions are in `ai-sessions/`.

**Close (10 s):** state what is finished, what is pending (Part 2 piece A, listed in `README.md`) and where to find the evidence.

## After recording

- [ ] Save as `submission/demo.mp4`; optional `submission/transcript.vtt`.
- [ ] Confirm no secrets or `.env.local` content is visible.
- [ ] Update the status table in `README.md`.
- [ ] Re-run `npm run reset` and `npm run ingest` if the demo changed local data.
