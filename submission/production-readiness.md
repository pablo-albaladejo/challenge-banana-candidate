# Production readiness review

Date: 2026-10-09. Scope: the application side (`app/`, `src/`, `scripts/`, `next.config.ts`, `.env.example`), reviewed against `docs/challenge.md` and `docs/contracts.md`, after the Part 1 bug fixes were merged. `simulator/` is an external dependency and was only read, never changed.

This document merges two independent reviews: an architecture review and a security review (OWASP Top 10 plus LLM-specific risks). Duplicates were merged. **Status: documented, not yet fixed.** The current priority is decoupling the architecture first; these findings are tackled afterwards, one by one, with TDD.

Legend: **Effort** S (< 1 h), M (half a day). **Testable** means it can be pinned with a deterministic test using the existing harness: the real bank over HTTP, the `startLossyBank` proxy in `tests/support/network.ts`, and the fake OpenAI server in `tests/support/openai.ts`.

## What was checked and is correct

- **The model cannot move money.** Its only money tool is `transfer_money`, which never sets `approvalId`, so it can only create a proposal (`src/banking/authorization.ts`). Execution is reachable only through `POST /api/approvals/:id/confirm`, which the model cannot call. The approval is consumed with one atomic `UPDATE … WHERE consumed_at IS NULL AND expires_at > ?`, so two concurrent confirms produce one transfer.
- **One bank reference per intent.** `intentReference` reuses `intents.bank_reference`, so retries are idempotent at the bank. A completed intent is replayed from the record without calling the bank.
- **Lost responses** become `unknown` and are reconciled through `GET /v1/operations/:reference` (`src/banking/reconcile.ts`).
- **Actor binding.** Every bank call takes the actor from the server session. In `operation_status`, `encodeURIComponent` prevents path tricks: a normalised `..` changes the signed path and the bank answers 401, so it fails closed.
- **No XSS sinks.** React escapes every user- or model-authored string; there is no `dangerouslySetInnerHTML` and no markdown links or images, so no stored XSS and no image-based exfiltration.
- **Secrets stay server-side.** The OpenAI key never reaches the client, `scripts/dev.ts` strips it from the bank's environment, and model calls use `store: false`.
- **Audience filtering.** Internal procedures are filtered out for customers in `/documents`, `/documents/:id/chunks`, `/search` and the agent's retrieval (whose role defaults to `customer`). The corpus was grepped for injection payloads; none were found.
- **SQL** is parameterised everywhere; there is no command execution; document path traversal is guarded (`src/ingestion/pipeline.ts`).
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

- **Category:** defect.
- **Evidence:** `actions.ts` sets `processing` after consuming the approval; `reconcile.ts:15` only handles `unknown` / `failed`; a retry hits the consumed approval in `authorization.ts` and gets 409.
- **Failure:** the process restarts or crashes, or the request is killed mid-dispatch (Next dev reload, deploy). The bank reference is persisted and the bank may have committed, but the intent stays `processing` forever. The operator view shows a wrong state.
- **Fix:** in `reconcileIntent`, also treat `processing` as unverified when a `bank_reference` exists and `created_at` is older than about 2 × (bank timeout × attempts), roughly 10 s.
- **Effort:** S. **Testable:** yes. Do a real transfer first, insert a `processing` intent with an old `created_at` and that reference, and expect `completed`. With a reference unknown to the bank, expect `failed`.

### P0-3. `unknown` intents are never reconciled on the customer's side

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

- **Category:** A01 / A05. HIGH if the threat model includes the browser of the person running the app; MEDIUM otherwise.
- **Evidence:** `src/auth.ts` `sameOrigin` compares `Origin` with `Host`; `scripts/dev.ts` binds `127.0.0.1`; there is no `Host` allowlist.
- **Exploit:** a page on `evil.test:3000` re-resolves its name to `127.0.0.1`. The browser sends `Origin: http://evil.test:3000`, `Host: evil.test:3000`, `Sec-Fetch-Site: same-origin`, so `sameOrigin` passes. The attacker's script can then:
  1. `POST /api/session {userId: "lucia"}` and get its own cookie for `evil.test`.
  2. `POST /api/actions transfer_money` followed by `POST /api/approvals/:id/confirm`: money moves with no user action.
  3. Switch to an operator and read every case, conversation and event.
  4. Loop on messages to burn the OpenAI quota.
- **Why it is in scope:** the open user selector is out of scope by design ("anyone who can reach the port can be anyone"). Rebinding extends "anyone on this machine" to "any website you open", which is not by design.
- **Fix:**
  ```ts
  // src/auth.ts
  const allowedHosts = new Set(
    (process.env.APP_HOSTS || `127.0.0.1:${config.appPort},localhost:${config.appPort}`).split(','),
  );
  export function trustedHost(request: Request) {
    if (!allowedHosts.has(request.headers.get('host') || ''))
      throw new HttpError(421, 'Unknown host.');
  }
  // route.ts: first line of the handler, for every method (GET too: rebinding can read).
  ```
- **Effort:** S. **Testable:** yes (route test with a foreign `Host` header gives 421).

### P0-6. The proposal card shows raw account ids, so an injected transfer is hard to spot

- **Category:** A04 / LLM excessive agency; contract compliance. Found by both reviews.
- **Evidence:** `app/page.tsx:724-733` renders `acc-lucia → acc-bruno` and the model-written concept. The contract requires amount, source and destination "for explicit review". `confirm()` (`page.tsx:272-286`) has no busy guard, so a double click returns a confusing 409 (the server stays safe through the atomic consume).
- **Scenario:** text injected through a third-party document, a pasted message or a future corpus source makes the model propose a transfer to a valid contact, with a reassuring concept such as "Move to your savings (refund)". Nothing on the card says the destination belongs to another person, or which conversation created the proposal. This is the main way prompt injection could become money movement. Today's corpus contains no payload, so exploitability is moderate.
- **Fix:**
  - Resolve ids against `dashboard.accounts` (label + masked IBAN) and `dashboard.contacts` (name); mark "(another person)" when the destination is not an own account.
  - Label the concept "Description written by the assistant".
  - Show the expiry and the originating conversation.
  - Add a busy/disabled state to the confirm button.
- **Effort:** S. **Testable:** yes (Playwright: the contact name is visible on the card).

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

- **Category:** A02 / A05. Found by both reviews.
- **Evidence:** `src/config.ts:11-13` falls back to the public `banana-local-*` values. The session token is `userId.HMAC(userId)` with no expiry, and the cookie has no `Secure` flag (`route.ts:46`).
- **Failure:**
  - Without `SESSION_SECRET`, anyone can forge `pablo.<hmac>` and become an operator (moot today because `/api/session` is open by design).
  - Without `BANK_SERVICE_SECRET` on both sides, any local process can sign bank requests as any actor, including the operator endpoint, and skip the approval flow.
  - If only the bank has a real secret, the app returns 401 on everything with no explanation.
- **Fix:**
  ```ts
  function secret(name: string, dev: string) {
    const v = process.env[name];
    if (!v && process.env.NODE_ENV === 'production') throw new Error(`${name} must be set`);
    if (v && v.length < 32 && process.env.NODE_ENV === 'production')
      throw new Error(`${name} too short`);
    return v || dev;
  }
  ```
  Add `Secure` when served over HTTPS. Move `adminSecret` out of the app's runtime config: only `scripts/scenario.ts` uses it.
- **Effort:** S. **Testable:** yes, after exposing a `loadConfig(env)` factory (see P2-4).

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

`src/config.ts` runs dotenv relative to the cwd at import, and tests mutate `config.bankUrl` (`tests/support/network.ts`). Fix: export a `loadConfig(env)` factory; this also enables the P1-5 test. Effort S.

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

### P2-13. Session tokens never expire or rotate (out of scope by design)

`src/auth.ts`: the token is deterministic (`userId.HMAC(userId)`), with no `Max-Age` and no `Secure`. Out of scope while the selector has no authentication, but critical the moment real login exists. Sketch: `userId.iat.nonce.hmac(userId|iat|nonce)`, TTL check, a server-side session table for revocation, `Secure` over HTTPS.

---

## Suggested order

1. P0-1 (unreadable response becomes `unknown`), P0-2 (`processing` in reconcile), P0-3 (customer-side reconcile + UI), P0-4 (pending-intent guard): one block, same root cause.
2. P0-5 (Host allowlist), P0-6 (readable proposal card).
3. P1-4, P1-2, P1-7, P1-8, P1-5 (all S), then P1-1 and P1-3 (agent awareness; P1-3 overlaps a Part 2 "transfer tracker").
4. P2 as time allows; P2-2, P2-4 and P2-7 belong to the architecture decoupling.
