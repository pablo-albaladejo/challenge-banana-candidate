# Production readiness review

> File paths in this review predate the Phase 6 folder move; the old → new mapping is in [`architecture-decoupling.md` §9](architecture-decoupling.md#9-phase-6--screaming-folders-2026-10-10). Findings added or revised after Phase 7d.4 (P0-5, P0-7, P1-5, P2-4, P2-13 to P2-15) cite the current paths under `src/identity/`, `src/platform/` and `src/server/`. Where a path is still `src/banking/*`, `src/agent/*` or `src/retrieval/*`, it is the starter-era location of the evidence, kept as history.

Date: 2026-10-09. Scope: the application side (`app/`, `src/`, `scripts/`, `next.config.ts`, `.env.example`), reviewed against `docs/challenge.md` and `docs/contracts.md`, after the Part 1 bug fixes were merged. `simulator/` is an external dependency and was only read, never changed.

This document merges two independent reviews: an architecture review and a security review (OWASP Top 10 plus LLM-specific risks). Duplicates were merged. **Status: P1-5 and P0-5 are fixed; P0-6 is fixed except its busy guard and originating conversation; P0-7 is mitigated for production by its effort-S path (real authentication, its effort-L path, stays open); every other finding is documented and not yet fixed.** The current priority is decoupling the architecture first; these findings are tackled afterwards, one by one, with TDD.

Legend: **Effort** S (< 1 h), M (half a day). **Testable** means it can be pinned with a deterministic test using the existing harness: the real bank over HTTP, the `startLossyBank` proxy in `tests/support/network.ts`, and the fake OpenAI server in `tests/support/openai.ts`.

## What was checked and is correct

- **The model cannot move money.** Its only money tool is `transfer_money`, which never sets `approvalId`, so it can only create a proposal (`src/banking/authorization.ts`). Execution is reachable only through `POST /api/approvals/:id/confirm`, which the model cannot call. The approval is consumed with one atomic `UPDATE … WHERE consumed_at IS NULL AND expires_at > ?`, so two concurrent confirms produce one transfer.
- **One bank reference per intent.** `intentReference` reuses `intents.bank_reference`, so retries are idempotent at the bank. A completed intent is replayed from the record without calling the bank.
- **Lost responses** become `unknown` and are reconciled through `GET /v1/operations/:reference` (`src/banking/reconcile.ts`).
- **Actor binding.** Every bank call takes the actor from the server session. In `operation_status`, `encodeURIComponent` prevents path tricks: a normalised `..` changes the signed path and the bank answers 401, so it fails closed.
- **No XSS sinks.** React escapes every user- or model-authored string; there is no `dangerouslySetInnerHTML` and no markdown links or images, so no stored XSS and no image-based exfiltration.
- **Secrets stay server-side.** The OpenAI key never reaches the client, `scripts/dev.ts` strips it from the bank's environment, and model calls use `store: false`.
- **Audience filtering.** Internal procedures are filtered out for customers in `/documents`, `/documents/:id/chunks`, `/search` and the agent's retrieval (whose role defaults to `customer`). The corpus was grepped for injection payloads; none were found.
- **SQL** is parameterised everywhere; there is no command execution; document path traversal is guarded (`src/knowledge/infrastructure/fixture-document-catalog.ts`).
- **Bank request signing.** The HMAC covers method, path and query, actor, timestamp and the exact body, within a 60-second window. A replay is only possible on loopback within 60 s, and replayed transfers return `replay: true` because the reference makes them idempotent. If `BANK_URL` ever points off-host, require `https:`.

## Root cause shared by most money-path findings

An intent's lifecycle (`created → requires_confirmation → processing → completed | unknown | failed`) only advances inside synchronous request paths, and only for **the same intentId**:

- Nothing re-checks unverified intents for the customer (dashboard or startup).
- Nothing surfaces open intents when a new, identical one is created.
- The transport layer does not treat every unreadable response as "unverified".

Findings P0-1 to P0-4 are all symptoms of this. They should be solved as one block: anything ambiguous lands in `unknown`, and `unknown` is always reconciled.

A secondary cause: configuration, health and logging were built for local development, not for an on-call engineer.

---

## P0: must fix before launch

### P0-1. A non-JSON or aborted bank body is reported as a definitive `failed`

- **Status: fixed.** Fixed: `bankRequest` turns an unreadable body (non-JSON, empty, cut off while streaming) into `BankError(ok ? 502 : max(status, 502), 'Unreadable bank response.')`, so dispatch retries it, the intent is `unknown` and reconcile settles it; `startLossyBank` gained `html-502`, `empty` and `truncated` faults to prove it.
- **Category:** defect, integrity of a money outcome. Found by both reviews.
- **Evidence:**
  - `src/banking/client.ts:37`: `await response.json()` sits outside the try block. An HTML 502 from a gateway, an empty body, or a timeout abort while the body streams throws `SyntaxError` / `DOMException`, not `BankError`.
  - `src/banking/dispatch.ts`: retries only on `BankError` ≥ 500, so it does not retry.
  - `src/banking/actions.ts`: maps it to `failed`, with the raw parser message ("Unexpected token <").
  - `app/api/[...path]/route.ts:223`: maps `SyntaxError` to 400 "Invalid request data.".
- **Failure:** a proxy in front of an independent bank returns `502 text/html` after the bank committed. The customer is told the transfer failed while the money moved, and may retry under a new intent (see P0-4). Reconcile only fixes it later, if anyone triggers it.
- **Fix:**
  ```ts
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new BankError(
      response.ok ? 502 : Math.max(response.status, 502),
      'Unreadable bank response.',
    );
  }
  ```
  Any 5xx or unreadable response then becomes `unknown`, never `failed`.
- **Effort:** S. **Testable:** yes. Extend `tests/support/network.ts` with a mode that forwards the request to the real bank and then replies `502` with an HTML body. Expect the intent to be `unknown`, and to reconcile to `completed` with the bank's operation id.

### P0-2. Intents stuck in `processing` can never be recovered

- **Status: fixed.** Fixed: `reconcileIntent` settles a `processing` intent with a bank reference once its dispatch is stale: `dispatched_at` (migration 2, set with `processing`; `created_at` on older rows) older than `staleProcessingMs()` = 2 × `bankTimeoutMs` × `DISPATCH_ATTEMPTS`. Found → `completed`; a bank 404 → `failed` only once stale; unreachable → unchanged. Dispatches in flight are skipped through a per-process registry (`isDispatching`); single instance assumed, with `dispatched_at` covering restarts and HMR. Re-proposing a `processing` intent answers 409, and a transition lost to a concurrent writer answers with the stored outcome.
- **Category:** defect.
- **Evidence:** `actions.ts` sets `processing` after consuming the approval; `reconcile.ts:15` only handles `unknown` / `failed`; a retry hits the consumed approval in `authorization.ts` and gets 409.
- **Failure:** the process restarts or crashes, or the request is killed mid-dispatch (Next dev reload, deploy). The bank reference is persisted and the bank may have committed, but the intent stays `processing` forever. The operator view shows a wrong state.
- **Fix:** in `reconcileIntent`, also treat `processing` as unverified when a `bank_reference` exists and `created_at` is older than about 2 × (bank timeout × attempts), roughly 10 s.
- **Effort:** S. **Testable:** yes. Do a real transfer first, insert a `processing` intent with an old `created_at` and that reference, and expect `completed`. With a reference unknown to the bank, expect `failed`.

### P0-3. `unknown` intents are never reconciled on the customer's side

- **Status: fixed.** Fixed: `GET /api/dashboard` reconciles the customer's 10 newest `unknown`/`processing` intents, plus `failed` ones with a bank reference from the last 24 h, with `Promise.allSettled`, and returns them as `pendingTransfers`. The UI lists them under "Recent transfer checks" as "Checking with the bank", "Completed" or "Not executed".
- **Category:** defect.
- **Evidence:**
  - `actions.ts` tells the customer "It will be checked with the bank before any retry".
  - `reconcileIntent` is only called from `transferMoney` (same intentId) and from the operator's `caseDetail` (`src/operator/view.ts`).
  - The dashboard route (`route.ts:52-70`) returns approvals only: no non-final intents, no reconcile.
  - The approval is already consumed, so it drops off `dashboard.approvals` and the UI offers nothing.
- **Failure:** the bank commits, both POST attempts lose their response, and the customer sees "did not confirm". Nothing checks again unless an operator opens a case, so the customer-facing status never matches the bank.
- **Fix:**
  - In the dashboard handler, select `intents WHERE user_id=? AND status IN ('unknown','processing')`, reconcile each one (bounded, for example the last 10, with `Promise.allSettled`), and return them as `pendingTransfers`.
  - Render them in `app/page.tsx` next to the approvals panel: "Checking with the bank", "Completed", "Not executed".
  - Optionally expose the same thing to the agent (see P1-3). This overlaps with a possible Part 2 "transfer tracker".
- **Trade-off:** reconcile on dashboard load needs no background worker, fits Next + SQLite and is deterministic to test, but adds bank calls to dashboard latency (bound them). A background reconciler resolves even when nobody looks, but needs a process lifecycle inside Next and is hard to test deterministically; overkill for launch.
- **Effort:** S-M. **Testable:** yes. `startLossyBank((m, p) => m === 'POST' && p === '/v1/transfers')`, confirm returns `unknown`; close the proxy; `GET /api/dashboard` shows the intent `completed` with an operation id matching the bank's admin snapshot.

### P0-4. Retrying after `unknown` creates a new intent, so the bank may execute the transfer twice

- **Status: fixed.** Fixed: on every proposal and every confirmation, `authorizeTransfer` reconciles the customer's other `unknown`/`processing` intents with the identical payload. If one is still unresolved, it returns `requires_review` with its `pendingIntentId`, and creates or consumes no approval. The UI's "Send anyway" resends the proposal or re-confirms with `overridePendingIntentId`, which goes through `POST /api/actions` or `POST /api/approvals/:id/confirm` only (a `ToolContext` field the model cannot set). The override is honoured only for the newest unresolved twin; `completed` and `failed` twins never hold. On a confirmation, the final twin check, the approval consume and the move to `processing` run as one `BEGIN IMMEDIATE` transaction with no await in between, so two identical proposals confirmed at the same time dispatch once and the other is held naming the first. A re-proposal overtaken by a confirmation answers the stored outcome and writes no orphan approval. Known friction: after "Send anyway" on a proposal, confirming it while the twin is still unresolved asks a second time.
- **Category:** defect, duplicate money movement.
- **Evidence:**
  - The Transfers form never sends `intentId` (`app/page.tsx:247-256`), so the route mints a fresh one every time (`route.ts:131`).
  - The agent derives its intent from `${runId}:${call.call_id}` (`src/agent/run.ts:88`), so "please try again" in a new message is a new intent with a new bank reference.
- **Failure:** the first transfer committed but its response was lost, so it shows `unknown`. The customer resubmits, gets a new proposal, confirms it, and the bank executes it a second time.
- **Constraint:** the contract forbids deduplicating by payload alone ("two distinct legitimate intentions may have identical amounts"). The app must surface the open intent instead of silently merging.
- **Fix:** in `authorizeTransfer`, before creating a proposal, reconcile any `unknown` / `processing` intents of the same user with an identical payload. If one is still unresolved, return `{ status: 'requires_review', pendingIntentId }` (or attach a warning to the approval) instead of a silent new proposal. UI and agent show "A matching transfer is still being verified". A second identical transfer after the first is _completed_ remains allowed.
- **Trade-off:** blocking prevents double charges but can delay a legitimate identical transfer while the bank is down (mitigate with an explicit "send anyway"). Warning only never blocks but relies on the customer reading it.
- **Effort:** M. **Testable:** yes. Lossy proxy on POST gives `unknown`; a second `/api/actions` transfer with the same payload creates no new approval and references the pending intent; the bank holds exactly one operation.

### P0-5. DNS rebinding turns any website the user visits into a full app client

- **Status: fixed.** Shipped in `fix(http): allow only known Host headers against DNS rebinding (readiness P0-5)`:
  - **The allowlist.** `src/platform/http/trusted-host.ts`: `allowedHosts(env, appPort)` is `127.0.0.1:<APP_PORT>`, `localhost:<APP_PORT>` and every comma-separated `ALLOWED_HOSTS` entry (trimmed, lower-cased). `trustedHost(request)` throws `HttpError(421, 'Unknown host.')` when the lower-cased `Host` header is missing or outside that set. It reads `process.env.ALLOWED_HOSTS` per request; the port comes from `config.appPort`, which `APP_PORT` sets when the config loads. **Deviation from the sketch above:** the variable is `ALLOWED_HOSTS`, and it _adds_ to the loopback defaults instead of replacing them, so setting a public name never locks out `npm run dev` on the same machine (a rebinding attacker cannot send `Host: 127.0.0.1:<port>`, so keeping loopback costs nothing).
  - **API.** `handle` (`src/server/handle.ts`) calls `trustedHost` first, for every method (GET too: rebinding can read), before `sameOrigin`, the public routes and `actor()`. So a rebound `POST session` gets 421 and no cookie.
  - **Pages and assets.** The root `proxy.ts` is a Next 16 Proxy (the renamed Middleware, Node.js runtime by default; `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md`) with no `matcher`, so it runs before every request (`/`, `/_next/*`, `/api/*`) and answers an unknown `Host` with the same 421 JSON (`Cache-Control: no-store`). A rebound page cannot read the HTML or the client bundle either.
  - **Startup.** `npm run dev` binds `127.0.0.1:APP_PORT`, and the browser sends `127.0.0.1:3000` or `localhost:3000`, both allowed. The E2E stack runs with `APP_PORT=3100`, so `127.0.0.1:3100` is allowed. Production does **not** refuse to start without `ALLOWED_HOSTS`: it fails closed per request, so a deployment behind a reverse proxy or a public name answers 421 to everything until that name is listed (documented in `.env.example` and the README). To make that visible, `register()` (`instrumentation.ts`) logs one `Warning: ALLOWED_HOSTS …` line in production when `allowedHostsWarning` finds it empty or with an entry no `Host` header can carry (a `/`, or a `:` not followed by a port); it never stops startup. With `APP_PORT` 80 or 443 browsers omit the port, so `localhost` must be listed in `ALLOWED_HOSTS` (`.env.example`). Serving on a port other than `APP_PORT` (for example `next dev --port 4000` with `APP_PORT` unset) also answers 421; set `APP_PORT` to the real port. Checked by hand on the production build (`next start` of `NEXT_DIST_DIR=.next-e2e` on port 3199 with `APP_PORT=3199`, `ALLOWED_HOSTS=bank.example` and strong secrets): `/` answers 200 to `127.0.0.1:3199`, `localhost:3199` and `bank.example`, and `/` and `/api/health` answer 421 to `evil.test:3199`; the build lists `ƒ Proxy (Middleware)`.
  - **Tests.** `src/platform/http/trusted-host.test.ts` (15: the defaults, `ALLOWED_HOSTS` parsing, `127.0.0.1`, `localhost` and `LOCALHOST` accepted, a rebinding host, another port and a missing `Host` refused, a listed host read at request time; the warning for an unset, empty or blank value, for entries with a scheme or path and for a `:` not followed by a port, and none for host names with or without a port). `instrumentation.test.ts` (3: in production an empty `ALLOWED_HOSTS` logs one warning and still starts, listed host names log nothing, outside production it is not checked). `app/api/[...path]/route.test.ts` (4: a signed-in `GET dashboard`, a rebinding same-origin `POST session` without a cookie, and a public `GET health` from an unknown host are 421; a host in `ALLOWED_HOSTS` is answered). `proxy.test.ts` (2, at the root and listed by name in `npm test`: allowed passes through, unknown gets the 421 JSON). `app/page.e2e.ts` (1 journey through the real Next server with `node:http`: `/` with `localhost:3100` is 200, `/` and `/api/health` with `evil.test:3100` are 421). `tests/setup.ts` pins `APP_PORT=3000` and `ALLOWED_HOSTS=''`, and `api()` sends `Host: 127.0.0.1:3000`, as do the 5 route tests that build their own `Request`. Mutations (each turned a test red, then restored byte-identical): the `trustedHost` call removed from `handle`, the `Host` no longer lower-cased, `ALLOWED_HOSTS` ignored, a missing `Host` let through, the proxy letting an unknown host through, and `proxy.ts` removed (E2E: `/` answered 200); for the warning: the empty check, the `/` check and the bad-port check each disabled, the production guard removed, and the `console.warn` call skipped.

- **Category:** A01 / A05. HIGH if the threat model includes the browser of the person running the app; MEDIUM otherwise.
- **Evidence:** `sameOrigin` (`src/identity/entry-points/http/session-guard.ts:24-36`) compares `Origin` with `Host`; `scripts/dev.ts` binds `127.0.0.1`; there is no `Host` allowlist.
- **Exploit:** a page on `evil.test:3000` re-resolves its name to `127.0.0.1`. The browser sends `Origin: http://evil.test:3000`, `Host: evil.test:3000`, `Sec-Fetch-Site: same-origin`, so `sameOrigin` passes. The attacker's script can then:
  1. `POST /api/session {userId: "lucia"}` and get its own cookie for `evil.test`.
  2. `POST /api/actions transfer_money` followed by `POST /api/approvals/:id/confirm`: money moves with no user action.
  3. Switch to an operator and read every case, conversation and event.
  4. Loop on messages to burn the OpenAI quota.
- **Why it is in scope:** the open user selector is out of scope for the demo by design ("anyone who can reach the port can be anyone", see P0-7 for what a real launch needs). Rebinding extends "anyone on this machine" to "any website you open", which is not by design.
- **Fix:**
  ```ts
  // src/identity/entry-points/http/session-guard.ts (or src/platform/http/)
  const allowedHosts = new Set(
    (process.env.APP_HOSTS || `127.0.0.1:${config.appPort},localhost:${config.appPort}`).split(','),
  );
  export function trustedHost(request: Request) {
    if (!allowedHosts.has(request.headers.get('host') || ''))
      throw new HttpError(421, 'Unknown host.');
  }
  // src/server/handle.ts: first line of `handle`, for every method (GET too: rebinding can read).
  ```
- **Effort:** S. **Testable:** yes (route test with a foreign `Host` header gives 421).

### P0-6. The proposal card shows raw account ids, so an injected transfer is hard to spot

- **Status: fixed (names on the proposal card and the transfer checks panel, "another person" / "account not found", description label, expiry); the busy guard and the originating conversation are still open.** Shipped in `fix(transfers): show account names, not raw ids, on the proposal card (readiness P0-6)`:
  - **Server-side names, presentation only.** `GetCustomerOverview` (`src/accounts/application/use-cases/get-customer-overview.ts`) adds `parties: { from, to }` to every live proposal and every pending transfer of `GET dashboard`, resolved from the same accounts and contacts the dashboard already reads: an own account gives its `label` and masked IBAN (`ES91 ···· 0001`) with `own: true`; a contact adds the holder's `name` as `holder`, with `own: false`; an account the bank does not list is `Unknown account`, no IBAN, `own: null`. An IBAN that is missing or not longer than 8 characters gives `iban: null` instead of throwing (which would have turned the dashboard into a 500). The internal id never appears in `parties`. The stored approval, its `payload` (passed through unchanged, still with the ids), the `approvals/:id/confirm` endpoint and the bank contract are untouched. Resolving on the server rather than in the card keeps the rule testable without a browser and gives every client the same names.
  - **Card.** `app/_ui/transfers/ApprovalsPanel.tsx` reads `€5.00 · From Aurora account (ES91 ···· 0001) → To Bruno Vidal · Horizon account (ES91 ···· 0002) · another person`, then `Description (free text, not checked by the bank): …` and `Valid until HH:mm`; a destination the bank does not list reads ` · account not found` instead. `app/_ui/transfers/TransferChecksPanel.tsx` ("Recent transfer checks") names each transfer the same way through `app/_ui/lib/parties.ts`. **Deviation:** the label is not "Description written by the assistant", because a proposal from the Transfers form carries the customer's own text and the approval does not record which one wrote it; the chosen label is true for both.
  - **What the model relays.** `agentInstructions` (`src/assistant/domain/prompt.ts`) gains one line: name an account by its label and a recipient by their name, as `list_accounts` returns them, and never show the customer an internal account id. The `transfer_money` tool description is frozen by the golden definitions, so the rule lives in the system prompt.
  - **Not done:** the confirm busy guard (a double click still answers 409; the atomic consume keeps the server safe) and the originating conversation on the card (the approval row has no conversation; it needs a join through the intent). The Transfers form's recipient options still end in the account id.
  - **Tests:** `get-customer-overview.test.ts` (7: both parties named with literal masked IBANs, no full IBAN in the parties, an own destination marked own, an unlisted account `Unknown account` with `own: null` and without its id, a missing or too-short IBAN gives `iban: null`, the payload unchanged, both parties of each pending transfer), `app/_ui/lib/parties.test.ts` (6: the party text with and without holder and IBAN, the destination note for a contact, an unlisted account and an own account), `route.test.ts` (1: through the real bank, both parties named from the dashboard's own accounts and contacts and no `acc-` in `parties`), `prompt.test.ts` (1 new, and the exact-text pin extended), `page.e2e.ts` (1 journey: the card shows "From Aurora account", "To Bruno Vidal ·", "another person" and "Valid until HH:mm", and no `acc-`; and the rejected-transfer journey now checks that "Recent transfer checks" shows "To Lucía Martín ·" and no `acc-`). Mutations (each turned a test red, then restored byte-identical): the contact label replaced by its id, an own account marked not own, the unknown label replaced by the id, the prompt line removed, and the card's "another person" mark removed (E2E); for the review fixes: the IBAN length guard removed, the unlisted account marked `own: false`, the pending transfers returned without `parties`, each `destinationNote` branch and the `describeParty` IBAN removed, the expiry time dropped from the card (E2E) and the transfer checks panel back on raw ids (E2E).

- **Category:** A04 / LLM excessive agency; contract compliance. Found by both reviews.
- **Evidence:** `app/page.tsx:724-733` renders `acc-lucia → acc-bruno` and the model-written concept. The contract requires amount, source and destination "for explicit review". `confirm()` (`page.tsx:272-286`) has no busy guard, so a double click returns a confusing 409 (the server stays safe through the atomic consume).
- **Scenario:** text injected through a third-party document, a pasted message or a future corpus source makes the model propose a transfer to a valid contact, with a reassuring concept such as "Move to your savings (refund)". Nothing on the card says the destination belongs to another person, or which conversation created the proposal. This is the main way prompt injection could become money movement. Today's corpus contains no payload, so exploitability is moderate.
- **Fix:**
  - Resolve ids against `dashboard.accounts` (label + masked IBAN) and `dashboard.contacts` (name); mark "(another person)" when the destination is not an own account.
  - Label the concept "Description written by the assistant".
  - Show the expiry and the originating conversation.
  - Add a busy/disabled state to the confirm button.
- **Effort:** S. **Testable:** yes (Playwright: the contact name is visible on the card).

### P0-7. Anyone who can reach the port can become any person, operators included

- **Status: mitigated for production (option 2, effort S); option 1 (real authentication, effort L) still open.** Shipped in `fix(identity): gate the demo persona switcher out of production (P0-7)`:
  - **The flag.** `DEMO_PERSONA_SWITCHER` (`loadFeatureFlags` and the mutable `featureFlags` in `src/platform/config.ts`, key `demoPersonaSwitcher`; not a `config` key, because `src/public-surface.test.ts` freezes that list). When it is unset or empty, it is **on outside production and off in production**. `1` or `true` (trimmed, any case) turns it on. Any other value turns it off, so a typo fails closed. **Deviation from option 2's "default off":** a default that is off everywhere would make `npm run dev`, the tests and the E2E stack need an env edit, and `docs/challenge.md` wants the selector usable with no setup. Production is where the default matters, and there it is off.
  - **Startup refusal.** `assertNoPersonaSwitcherInProduction(featureFlags, nodeEnv)` throws in production while the flag is on. The error names `DEMO_PERSONA_SWITCHER` and never a value. The root `instrumentation.ts` `register()` runs it next to `assertProductionSecrets`, inside the same `try`. Both checks always run and their refusals are joined, secrets first. So there is one exit path and one log line with the same `Refusing to start in production:` prefix as P1-5, naming every problem at once. The built server inlines `NODE_ENV=production` into that check, but the flag's default reads the runtime `NODE_ENV`: starting the build with `NODE_ENV=development` (or any value other than `production`) turns the default on and so trips this refusal. Unset `NODE_ENV` for `npm start`.
  - **Flag off.** `GET people` and `POST session` leave the route table: each carries `enabled: personaSwitcherEnabled` (`src/server/routes.ts`), and the router (`src/platform/http/router.ts`) skips a disabled route both when matching and when building `Allow`. So `handle` gives the answers of any absent path, in its usual order: without a session, 401 `Select a person to continue.` (like an unknown route); with one, 404 `Route not found.` for `people` (and `POST people`) and 405 `Allow: GET, HEAD` for `POST session`, like any path that only accepts `GET`. The body is never read and no cookie is set. `requirePersonaSwitcher` (`src/identity/entry-points/http/persona-switcher.ts`) stays in both handlers as defence in depth, answering 404 before the body is read should a handler be reached anyway. **Why not 403:** a 403 confirms that the endpoint exists and is only switched off, and so advertises a toggle worth hunting for. An absent route says nothing more than an unknown path does. The flag is read per request from the mutable `featureFlags`, so tests can flip it. `actor()` is unchanged, so a session that already exists keeps working against the API (see the limits below).
  - **UI.** If `GET people` answers 401 or 404 (the switcher is off: no session, or a stale one), `app/page.tsx` does not request a session. The top bar shows "Persona switching is off" instead of the picker, and the main area shows "Choosing a person is turned off on this production server. Run `npm run dev` to try the demo." instead of the spinner. Any other failure (`api()` now carries the response `status`) goes to the error banner. Nothing crashes.
  - **Operators stay selectable while the flag is on.** This deviates from option 2's "operators should not be selectable from an unauthenticated page": the challenge demo exists to review both roles, the flag can only be on outside production, and a separate `DEMO_OPERATOR_KEY` would be a second weak credential with no real identity behind it. A public staging host that must keep the picker is the case for that key, and it is not done.
  - **Tests:** `src/platform/config.test.ts` (the default for `NODE_ENV` unset, `development`, `test` and `production`, the on and off values, the check in and out of production and the name in its message). `instrumentation.test.ts` (production with real secrets and the flag on exits 1 with one prefixed line naming the variable; weak secrets and the flag on give one line naming all four variables; the flag on outside production starts). `src/platform/http/router.test.ts` (a disabled route neither matches nor adds to `Allow`). `src/identity/entry-points/http/{persona-switcher,people,session}.test.ts` (the check and both handlers refuse with 404 when off, `selectPerson` before reading the body). `app/api/[...path]/route.test.ts` (with the flag off, each gated answer compared with a real route, anonymously and with a session: status, body, `Allow` and `Set-Cookie` equal to an unknown route's, or to `POST dashboard`'s 405 for `POST session` with a session; no cookie for an operator id or a malformed body; an existing session still resolves; and the production default from `loadFeatureFlags({ NODE_ENV: 'production' })` reaching the route). `app/_ui/lib/api.test.ts` (the thrown error carries `status`). `app/page.e2e.ts` (the page with `people` answering 401 or 404: the message, no picker, no spinner, no `POST session`; a 500 shows the error banner instead). The behaviour with the flag on is the existing `GET /api/people` and `POST /api/session` suites. Each gate was mutated (the router's `enabled` check in `match` and in `allowedMethods`, the `enabled` of either route, the check in either handler, the startup call and the joined refusals, the production condition and each non-production `NODE_ENV`, both defaults, the fail-closed parse, the `status` on `api()` errors, the UI fallback) and each mutation turned a test red.
  - **Limits of option 2:** the flag gates _choosing_ a person, not _being_ one. A cookie issued before the flag was turned off still works, because tokens never expire (P2-13). With a default `SESSION_SECRET` a token can be forged offline, but production refuses that secret (P1-5). Production now has no way to sign in at all. That is safe, but the production build cannot be used for the demo: `npm run dev` is the demo, and option 1 is the launch gate. With a session, `POST session` answers 405 `Allow: GET, HEAD` because `GET session` exists, exactly like `POST dashboard`; nothing tells it apart from a path that never had a `POST`.
- **Category:** A01 broken access control / A07 identification and authentication failures. Found by the Phase 7d.4 security review. **Not introduced by the refactor:** the starter shipped it. P0 for any launch with real customers; accepted for the challenge demo, where `docs/challenge.md` says "the user selector lets you switch between customers and operators without setting up authentication".
- **Evidence:**
  - `src/server/routes.ts:17`: `POST session` sits in `publicRoutes`, so `handle` answers it before `actor()` runs (`src/server/handle.ts:21-22`).
  - `src/identity/entry-points/http/session.ts:8-12`: the body is `{userId}` and nothing else. `StartSession` (`src/identity/application/use-cases/start-session.ts:11-14`) only checks that the id is in the roster and issues a token for it. No password, no one-time code, no proof of who is asking.
  - `src/identity/infrastructure/people-roster.ts:15-16`: `marta` and `pablo` are `operator`s. The role comes from the roster, not from the request, so a client cannot invent a role, but it can pick an operator's id.
  - `GET /api/people` (`src/server/routes.ts:16`) is public too and lists every id, so nothing needs guessing.
  - The only gate is `sameOrigin` (see P0-5 and P2-14), which stops other websites, not a direct client.
- **Failure:** `curl -X POST /api/session -d '{"userId":"pablo"}'` returns a valid operator cookie. That cookie reads every case, conversation and event, and any customer id gives the same access to that customer's accounts and transfers (the approval step still applies, but the attacker is the one approving). In a real launch this is full account takeover for every customer, with no log of who actually did it.
- **Why it is acceptable for the challenge, and only there:** the app is a demo whose selector is the intended way to review both roles. The bank is simulated and every person is fictional. None of that holds once real people or real money are behind it.
- **What makes it launch-safe (pick one):**
  1. **Real authentication (the actual fix).** Replace `POST session` with a login that proves identity (password plus second factor, or an OIDC/SSO provider; operators through the bank's staff IdP with role claims). `StartSession` takes the verified subject instead of a client-supplied id. Pair it with the token redesign in P2-13 (expiry, nonce, server-side revocation, `Secure`). Delete the public `people` listing or restrict it to the signed-in role.
  2. **Lock the selector down per environment (minimum for a staging or demo host that stays public).** Gate `POST session` and `GET people` behind `DEMO_PERSONA_SWITCHER=1`, default off, and refuse to start with it on when `NODE_ENV=production` (`assertProductionSecrets` in `src/platform/config.ts:30` is the natural place). With it off, `POST session` answers 404 and `actor()` still verifies cookies as today. Even with it on, operators should not be selectable from an unauthenticated page: require a separate `DEMO_OPERATOR_KEY` or leave operator personas out of the public build.
- **Effort:** option 2 is S (done, see Status); option 1 is L (an identity provider and the account lifecycle around it, not a code tweak) and remains the real launch gate. **Testable:** yes. Option 2: with the flag off, `POST /api/session` returns 404 and `GET /api/people` returns 404; with `NODE_ENV=production` and the flag on, startup throws. Option 1: a request with a valid id and no credential gets 401, and a stolen operator cookie stops working after revocation.

---

## P1: should fix

### P1-1. The agent can stack duplicate pending proposals

- **Evidence:** every `transfer_money` call is a new intent and a new approval (`run.ts:88`, `authorization.ts`): up to 7 per message, more across messages. The approvals panel lists them all.
- **Failure:** the model re-proposes after a validation error or a rephrase, and the customer confirms both, so the money moves twice.
- **Fix:** when creating a proposal, supersede earlier unconsumed approvals with the same payload in the same conversation, or allow one pending proposal per conversation.
- **Effort:** S. **Testable:** yes (fake OpenAI scripts two identical `transfer_money` calls; expect one live approval).

### P1-2. A retrieval failure fails the whole message

- **Evidence:** `run.ts:53` calls `searchDocuments(content)` unconditionally. An embeddings outage, a missing index (`search.ts:13`) or a model mismatch (`search.ts:14-15`) throws, giving a 502 and "I could not complete the request: …".
- **Failure:** "show my balance" becomes impossible during an embeddings outage.
- **Fix:** catch the error, continue with `sources = []`, tell the model that documentation is unavailable, and record a `retrieval.failed` event.
- **Effort:** S. **Testable:** yes (fake embeddings return 500 while chat succeeds; `list_accounts` still answers).

### P1-3. The agent loses tool results and transfer outcomes across turns

- **Evidence:** history is rebuilt from `messages` text only (`run.ts:54-61`), so approval id, intent id and status are gone. Confirmation happens outside the chat (`route.ts:135-156`) and nothing is written back. `operation_status` needs a bank reference the agent never sees.
- **Failure:** "Did my transfer go through?" produces a guess or a failed lookup.
- **Fix:** a `recent_transfers` tool listing the user's intents with their status after reconcile (reuses P0-3); optionally append a system-visible note to the conversation on confirm/complete.
- **Effort:** M. **Testable:** yes (fake OpenAI scripts `toolCall('recent_transfers')`; output contains the reconciled status).

### P1-4. No overall deadline for an agent run

- **Evidence:** `src/retrieval/embeddings.ts:29` (`maxRetries: 2, timeout: 45000`) and 7 rounds in `run.ts`. The in-memory lock blocks the conversation with 409 for the whole duration; the browser fetch has no timeout.
- **Failure:** worst case is several minutes per message.
- **Fix:** one `AbortController` per run (for example 60 s) passed as `signal` to `responses.create` and embeddings, with `maxRetries: 1`. On abort, mark the run `incomplete` and answer honestly.
- **Effort:** S. **Testable:** yes (fake OpenAI with a delayed response; the run is `incomplete` within the deadline).

### P1-5. Default secrets silently used in production

- **Category:** A02 / A05. Found by both reviews, then re-checked by the Phase 7d.4 review.
- **Status: done** (`fix(platform): refuse to start in production with default secrets`). Before it, `assertProductionSecrets` existed and was tested but nothing called it, so it protected nothing at startup; not introduced by the refactor. Now:
  - `localDefaultSecrets` (`src/platform/config.ts`) holds the three public values once; `loadConfig` falls back to them and `assertProductionSecrets` refuses them, so the two cannot drift apart. In production it rejects each of `BANK_SERVICE_SECRET`, `BANK_ADMIN_SECRET` and `SESSION_SECRET` when it is unset, shorter than 32 characters, or contains any of the three defaults, compared case-insensitively with `-`, `_`, `.` and spaces stripped (so a padded, upper-cased or re-separated default is caught), and it rejects one value reused across two or three of them (compared the same way), naming the variables that collide. The error names the variables, never the values. **Limit:** it does not measure entropy; a long low-entropy value such as `aaaa…` or `changeme…` passes.
  - The root `instrumentation.ts` calls it from `register()`, the hook Next 16 runs once per server instance before it serves a request (`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/instrumentation.md`; `guides/self-hosting.md` points to it for startup code). A throw alone is not enough: `next start` logs "Failed to prepare server", keeps listening and answers 500 to every request. So the hook logs one line, a fixed `Refusing to start in production:` prefix plus the error message (never the Error object or its stack), and exits 1; `scripts/dev.ts --production` (`npm start`) then stops the bank too. The import of the config sits inside the same `try`, so a config that fails to load also exits 1. In the built server webpack inlines `NODE_ENV` and `NEXT_RUNTIME` (checked in `.next*/server/instrumentation.js`), so a production build always runs the check in its Node.js runtime, whatever `NODE_ENV` `next start` sees; `next dev` builds with `development`, so `npm run dev` and the E2E stack (dev mode) keep the defaults. `next build` does not run `register`, so it needs no secrets. Only the tsx test run reads both variables from `process.env` when `register` runs.
  - Tests: `src/platform/config.test.ts` (padded default in each secret, a default reused in another secret, an upper-cased and a re-separated default, one value reused across two secrets naming only those two, the 31/32-character boundary, the shared defaults, no value in the error) and `instrumentation.test.ts` (exit 1 and the names logged in production with defaults, as one plain prefixed line; no exit with real secrets, outside production or in the edge runtime). `.env.example` and `README.md` (production mode and Troubleshooting) say how to set the three secrets.
  - Not covered here, still open: the bank simulator keeps its own fallback secrets (`simulator/` is out of scope, see `AGENTS.md`); the cookie `Secure` flag and token lifetime (P2-13); moving `adminSecret` out of the app's runtime config.
- **Evidence:**
  - `src/platform/config.ts:14-16`: all three secrets fall back to the public values `banana-local-service`, `banana-local-admin` and `banana-local-session` when the variable is unset or empty. `.env.example:20-22` ships the same three values.
  - `config` is built at import (`src/platform/config.ts:27`) and never validated, so a production process with no environment starts, signs bank calls and issues sessions with the public values.
  - The session cookie has no `Secure` flag (`src/identity/entry-points/http/session.ts:11`; pinned as intended by `app/api/[...path]/route.test.ts:285`). The token weaknesses are in P2-13.
- **Failure:**
  - Without `SESSION_SECRET`, anyone can compute `pablo.<hmac>` with the public secret and become an operator, without even calling `POST session`. P0-7 is the cheaper way in today, but fixing P0-7 leaves this forgery open.
  - Without `BANK_SERVICE_SECRET` on both sides, any local process can sign bank requests as any actor, including the operator endpoint, and skip the approval flow.
  - Without `BANK_ADMIN_SECRET`, the public value is the bearer token for the bank's admin endpoints (`scripts/scenario.ts:11` sends it as `Authorization: Bearer`).
  - If only the bank has a real secret, the app returns 401 on everything with no explanation.
- **Fix:**
  - Call `assertProductionSecrets(config, process.env.NODE_ENV)` once at server start (`next.config.ts` or an `instrumentation.ts` register hook, and `scripts/dev.ts` for the bank), so the process refuses to boot with a default or short secret. Also reject the three known default strings, not only short values: `banana-local-service` is 20 characters, but a padded copy would pass the length check.
  - Add `Secure` to the cookie when the request is served over HTTPS, or always in production.
  - Move `adminSecret` out of the app's runtime config: only `scripts/scenario.ts` and the tests use it.
- **Effort:** S. **Testable:** yes. `assertProductionSecrets` is already pure; add a test that the startup path calls it, and one for the default-string rejection.

### P1-6. No rate or cost limits

- **Category:** A04 / LLM10 unbounded consumption.
- **Evidence:** 8,000 characters per message and unlimited conversations (`route.ts:93-101`); 24 history items of up to 8,000 characters each and up to 7 rounds at `max_output_tokens: 2000` (`run.ts:59-80`); one embedding call per unique `/search` query (`route.ts:207-212`). The per-conversation lock does not limit across conversations. `request_human` creates incidents without limit.
- **Failure:** one session opens N conversations and posts in parallel; each message can cost about 48k input tokens × 7 rounds. A script drains the OpenAI budget in minutes and floods the operator queue.
- **Fix:** a per-user token bucket in front of messages, search and actions; a per-user cap on concurrent runs; history trimmed by token budget rather than count; conversations per user per hour capped.
- **Effort:** S-M. **Testable:** yes (N+1th request returns 429).

### P1-7. Observability: an on-call engineer cannot debug a 500

- **Evidence:** `route.ts:225` logs only `e.name`: no message, stack, route, user or request id. `runs` has no `finished_at`, model, token usage or latency (`src/db.ts`). No `model.round` events; `response.usage` is never recorded.
- **Fix:** a `requestId` per request; a JSON log line `{requestId, route, userId, status, ms, message, stack}`; `requestId` in error bodies; `finished_at` and `usage` on runs; a `model.round` event with `usage` and `durationMs`.
- **Effort:** S-M. **Testable:** yes (an error body carries `requestId`; `recordEvent` persists usage).

### P1-8. Health is not readiness

- **Evidence:** `route.ts:33-40` reports static config and `keyConfigured`; no bank `/health` probe, no DB check, no index metadata.
- **Fix:** return `{bank: ok|down, db: ok, index: {model, chunks, matchesConfig}}` and 503 when not ready.
- **Effort:** S. **Testable:** yes (stop the bank; health returns 503).

### P1-9. `/api/actions` returns 200 for authorization and validation failures

- **Evidence:** `runTool` catches everything (`src/agent/tools.ts:114-124`), so a 403 "account does not belong" and a `ZodError` become `200 {status: 'failed', error: <zod JSON>}`. The intent row is inserted before authorization (`actions.ts`) and stays `created` forever when authorization throws.
- **Assessment:** the contract only says "Results contain status and … error fields", so 200 is defensible for the agent. Still: separate `rejected` (4xx, definitive, nothing sent) from `failed` / `unknown`, carry `httpStatus`, sanitise Zod messages for model and UI, and mark the intent `rejected`.
- **Effort:** S. **Testable:** yes.

### P1-10. Next.js advisories and missing security headers

- **Evidence:** `npm audit --omit=dev` reports 3 high: `next` 16.0.0–16.3.7 (including dev-server MCP-endpoint information disclosure, GHSA-39w2-rjm5-chcv, relevant because the app runs `next dev`), `sharp`, `source-map-js`. `next.config.ts` sets no security headers. Clickjacking of "Confirm" is already blocked by `SameSite=Strict`, but defence in depth is cheap.
- **Fix:** upgrade to `next@16.4.0` and `sharp >= 0.35.5`, and add:
  ```ts
  async headers() {
    return [{ source: '/(.*)', headers: [
      { key: 'Content-Security-Policy', value: "default-src 'self'; frame-ancestors 'none'; object-src 'none'" },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'no-referrer' },
    ] }];
  }
  ```
- **Effort:** S. **Testable:** partially (headers via route test; the upgrade via the full suite + e2e).

---

## P2: later

### P2-1. The concurrency lock lives in process memory

`run.ts:13`. Correct only for a single Node process; SQLite already implies single-node, so acceptable for launch. After a crash, `runs` rows stay `running` forever and no sweeper exists. Fix: a DB-backed lock (`UPDATE conversations SET busy_run=? WHERE id=? AND busy_run IS NULL`) and a startup sweep that marks stale runs `interrupted`; document "single instance" in the README. Effort S.

### P2-2. No schema migrations; positional inserts

`src/db.ts` uses `CREATE TABLE IF NOT EXISTS` only, and every insert is positional (`run.ts`, `actions.ts`, `authorization.ts`, `telemetry.ts`, `tools.ts`, `route.ts`). Adding a column works on a fresh DB but throws "N values for M columns" on any existing `.data`. Fix: `PRAGMA user_version` with an ordered migrations array, and named-column inserts. Effort S-M. Relevant before Part 2 adds columns.

### P2-3. Missing indexes; telemetry retention

Missing: `intents(user_id, status)`, `intents(conversation_id)`, `approvals(intent_id)`, `events(run_id)`. Events keep full tool arguments and outputs indefinitely (balances, contact names, IBANs, free text). That was a deliberate fix so operators can investigate; keep it, but add a retention/redaction policy, mask IBANs, and store an allowlist of fields per tool except for transfer events. Effort S.

### P2-4. Configuration is read at import time

`src/platform/config.ts` runs dotenv relative to the cwd at import (lines 3-4), and tests mutate `config.bankUrl` (`tests/support/network.ts`). **Partly done:** the pure `loadConfig(env)` factory and `assertProductionSecrets` exist, and the P1-5 startup call is done (root `instrumentation.ts`). Still open: dotenv still resolves `.env.local`/`.env` against the cwd at import; `config` stays a mutable import-time singleton by design. Effort S.

### P2-5. Retrieval cost

`allChunks()` (`src/retrieval/store.ts`) reads and decodes 356 × 1536 floats on every query, plus one embeddings call per message (cached only on exact text). Fine at this size (tens of ms). Fix: cache decoded `Float32Array`s in memory keyed by index model + ingest timestamp, invalidated by `replaceChunks`. Effort S.

### P2-6. The embedding cache stores a fingerprint of every user message

`src/retrieval/embeddings.ts:31-61` persists every unique chat message and search query (about 6 KB per row, keyed by sha256 of model + text). It grows without bound and lets anyone with the DB confirm a guessed message. Fix: persist only corpus chunks; embed queries without persisting (or use an in-memory LRU). Effort S.

### P2-7. `route.ts` is a god handler

233 lines of string-matched routing with inline SQL and `as any`. Extract handlers into `src/http/{dashboard,conversations,actions,approvals,…}.ts` and keep the catch-all as a thin dispatcher plus the error mapper. Adding P0-3 inline would make it worse. Effort M. **This is part of the architecture decoupling now under way.**

### P2-8. The dashboard is all-or-nothing

`route.ts:57-61` uses `Promise.all`, so one 503 on movements blanks the whole overview. Fix: `Promise.allSettled` with per-section errors. Effort S. Testable with a lossy proxy that drops only `/v1/movements`.

### P2-9. Raw internal errors reach the customer

`run.ts:126-140` and `tools.ts:115` return non-API errors verbatim (SQLite errors, "No document index. Run npm run setup…", `ZodError` dumps), store them as assistant messages and replay them into the model's history. Fix: log the detail with the `runId` and return a generic message. Effort S.

### P2-10. Prompt injection and tool output size (residual, mitigated)

Excerpts and concepts are labelled as data and the approval gate stops money movement. Remaining surface: HTML ingestion keeps `<style>` text and hidden content (`pipeline.ts`); bank contact names flow into `list_accounts` untruncated; history has no token budget. Fix: cap each tool output (for example 8 KB) and total history tokens. Effort S.

### P2-11. Tool argument limits are inconsistent

`operation_status.reference` has no max (the contract says 1–120); `concept` has no minimum, so an empty description reaches the approval card. Fix: `z.string().min(1).max(120).regex(/^[\w-]+$/)` and `.trim().min(1).max(200)`. Effort S.

### P2-12. The operator view reconciles signed as the customer

`src/operator/view.ts` calls `reconcileIntent(incident.user_id, …)`, signing `GET /v1/operations` as the customer, which sidesteps "the actor comes from the selected server session". Read-only, low impact. Fix: reconcile through `/v1/operator/customer` as the operator, or report "pending verification". Effort S.

### P2-13. Session tokens never expire, never rotate and cannot be revoked (out of scope while the selector is open)

Found by the Phase 7d.4 security review; all of it already existed in the starter. Out of scope while the selector has no authentication (P0-7), but it becomes critical together with P0-7 the moment real login exists, so the two ship as one change.

- **Evidence:**
  - **No expiry.** `src/identity/entry-points/http/session.ts:11` sets `banana_actor=<token>; Path=/; HttpOnly; SameSite=Strict`: no `Max-Age` or `Expires`, so it is a browser-session cookie. The token itself carries no expiry either, and `verify` (`src/identity/infrastructure/hmac-session-tokens.ts:12-15`) checks only the signature. There is no server-side session table, so there is nothing to revoke. Rotating `SESSION_SECRET` is the only way to end sessions, and it ends all of them.
  - **Deterministic token.** `issue` returns `id.hex(HMAC-SHA256(id, secret))` (`hmac-session-tokens.ts:11`) with no nonce or issue time. The same person always gets the same token, so a leaked cookie (a log line, a proxy, shared screenshot, malware) is valid forever and cannot be told apart from a fresh one. A logout cannot invalidate it.
  - **No `Secure` flag** (`session.ts:11`). Over plain HTTP the cookie travels in the clear. `HttpOnly`, `SameSite=Strict` and `Path=/` are set correctly.
- **Failure:** a stolen cookie is a permanent credential for that person, and for an operator it is permanent access to every case. Combined with P1-5, a default `SESSION_SECRET` makes the token forgeable offline.
- **Fix:** `id.iat.nonce.hmac(id|iat|nonce)`, a TTL check in `verify` (for example 8 h for customers, 1 h for operators), a server-side `sessions` table keyed by the nonce so logout and "revoke all" work, `Max-Age` on the cookie, and `Secure` over HTTPS. Keep the token a port (`SessionTokens`, `src/identity/application/ports/session-tokens.ts`) so only the adapter changes.
- **Effort:** M. **Testable:** yes. An expired token gives 401; a revoked nonce gives 401; two logins give different tokens; the cookie string carries `Max-Age` and, over HTTPS, `Secure` (update the exact-cookie pin at `app/api/[...path]/route.test.ts:285`).

### P2-14. `sameOrigin` lets a request with no `Origin` header through

Found by the Phase 7d.4 security review; already in the starter. `sameOrigin` (`src/identity/entry-points/http/session-guard.ts:24-36`) rejects `Sec-Fetch-Site: cross-site`, and rejects an `Origin` whose host differs from `Host`, but a request with **no** `Origin` passes (the `if (origin)` branch is skipped). `handle` applies it to `POST` only (`src/server/handle.ts:20`). The comment in the guard names this as intended, for curl and scripts. The remaining protection against cross-site requests that omit `Origin` is the `SameSite=Strict` cookie: without the cookie, private routes answer 401, and `POST session` is public anyway (P0-7). Browsers send `Origin` on cross-origin POSTs and `Sec-Fetch-Site` on all requests, so a browser attacker cannot omit both today; the exposure is an older or unusual client, or a future change that weakens the cookie to `SameSite=Lax`. **Launch impact:** low while `SameSite=Strict` holds. **Fix:** in production, treat a POST with neither `Origin` nor `Sec-Fetch-Site` as same-origin only if it carries a custom header a cross-site form cannot send (for example `X-Requested-With`), or require `Origin`; keep the exemption behind a dev flag for curl. Pair it with the Host allowlist in P0-5. Effort S. Testable: yes (POST with neither header and a valid cookie gets 403 when the flag is off).

### P2-15. Token parsing accepts trailing segments; length check returns early (informational)

Found by the Phase 7d.4 security review; already in the starter. Neither is a forgery path.

- **Malleable token.** `verify` does `token.split('.')` and reads only the first two parts (`hmac-session-tokens.ts:13`), so `id.sig.anything` verifies as `id`. One person can therefore hold many distinct valid cookie strings, which defeats an equality-based denylist for revocation. The signature still covers the id, so nobody can change the identity. **Fix:** reject any token that does not split into exactly two parts (three or more fail), and match `^[a-z0-9_-]+\.[0-9a-f]{64}$` before comparing. Effort S.
- **Early return in `equal`.** `equal` (`src/platform/crypto.ts:5-9`) returns `false` before `timingSafeEqual` when the lengths differ, which leaks the length. It is harmless here because the compared value is always a 64-character hex HMAC-SHA256, so the attacker already knows the length. Nothing to fix; keep in mind if `equal` is reused for secrets of variable length (compare hashes of both sides instead). Effort: none.

---

## Suggested order

1. P0-1 (unreadable response becomes `unknown`), P0-2 (`processing` in reconcile), P0-3 (customer-side reconcile + UI), P0-4 (pending-intent guard): one block, same root cause.
2. P0-5 (done: Host allowlist for the API and the pages), P0-6 (done except the busy guard and the originating conversation), P0-7 (done for the effort-S path: the persona selector is locked per environment; real authentication plus P2-13 is the real launch gate, and P2-14 and P2-15 ride with it).
3. P1-5 (done: `assertProductionSecrets` runs at startup; P0-7's startup check now runs next to it), then P1-4, P1-2, P1-7, P1-8 (all S), then P1-1 and P1-3 (agent awareness; P1-3 overlaps a Part 2 "transfer tracker").
4. P2 as time allows; P2-2, P2-4 and P2-7 belong to the architecture decoupling.
