<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-10-09 | Updated: 2026-10-10 -->

# banking

## Purpose

Server-side integration with the external bank simulator (HTTP, signed requests) and the app-side transfer workflow that records each attempt as an `intents` row in the app DB.

## Key Files

| File               | Description                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `client.ts`        | `bankRequest<T>(userId, path, method='GET', body?)`: HMAC-signs `method\npath\nuserId\ntimestamp\nbody` with `BANK_SERVICE_SECRET`; sends `x-bank-actor`, `x-bank-time`, `x-bank-signature`; aborts after `BANK_TIMEOUT_MS` (default 1400) -> `BankError(504)`; non-2xx -> `BankError(status, data.error)`. `BankError`                                                                        |
| `bank.ts`          | The bank port, one function per endpoint the app uses: `accounts`, `contacts`, `movements` (GET `/v1/...`), `transfer(userId, input, reference)` (POST `/v1/transfers`), `operation(userId, reference)` (GET `/v1/operations/:reference`, `encodeURIComponent`), `operatorCustomer(operatorId, customerId)` (GET `/v1/operator/customer?id=`). The only callers of `bankRequest` besides tests |
| `intents.ts`       | Intent lifecycle: `TRANSITIONS` (the status edges observed today, documentation only) and `transition(id, to, fields)`: one unconditional `UPDATE` of status + fields through `persistence/intents.ts`, returns `{ changed, legal }`; `legal` is reported, not enforced (no throw, event or log)                                                                                               |
| `actions.ts`       | `transferSchema` (zod strict) and `transferMoney(ctx, args)`: customer-role check -> validate -> look up intent by `ctx.intentId` -> `INSERT OR IGNORE` intent (`created`) -> `authorizeTransfer` -> `transition` to `processing` -> `dispatchTransfer` -> `completed` / `unknown` / `failed`; emits `transfer.*` events; returns `ActionResult`                                               |
| `authorization.ts` | `authorizeTransfer(ctx, input)`: fetches the actor's accounts through `bank.ts` and requires `fromAccountId` to be among them (403) and `toAccountId` among them or the contacts (400); with `ctx.approvalId` consumes the approval once (409 if expired or used) and returns `null`, otherwise creates or reuses a live approval and moves the intent to `requires_confirmation`              |
| `dispatch.ts`      | `dispatchTransfer(ctx, input)`: up to 2 attempts of `bank.transfer` under one `bank_reference` per intent (created once and stored before the first call, so a retry replays the same operation); retries on `BankError` status >= 500                                                                                                                                                         |
| `reconcile.ts`     | `reconcileIntent(userId, intentId)`: an `unknown` or `failed` intent with a `bank_reference` is settled from `bank.operation`: found -> `completed`; bank 404 on `unknown` -> `failed`; unreachable bank -> unchanged                                                                                                                                                                          |

## For AI Agents

### Working In This Directory

- Intent and approval rows are read and written only through `src/persistence/intents.ts` and `src/persistence/approvals.ts`; no SQL in this directory. Intent status changes go through `intents.ts:transition`; a field-only write (`bank_reference` in `dispatch.ts`) calls the repo directly.
- Money state is owned by the bank (`simulator/`), not the app DB. `intents` in the app DB is only the app's record of attempts (statuses: `IntentStatus` in `intents.ts`).
- Bank contract (idempotency by actor + reference, error codes) is in `docs/contracts.md`; do not change `simulator/` to make this code pass.
- Things worth scrutinizing:
  - `actions.ts`: `previous.payload` comparison is on `JSON.stringify` key order.
  - `actions.ts`: role check throws `HttpError` while later failures return `{status:'failed'}`; `runTool` converts both into tool errors.
  - `intents.ts`: `transition` reports illegal edges but still writes them (enforcement is the planned P0 block; see `submission/production-readiness.md`).
  - `client.ts`: `response.json()` is not guarded (non-JSON error bodies throw a generic error); only abort/network errors map to 504, and the abort message tells the caller nothing about whether the operation committed.

### Testing Requirements

- Every module has a sibling `*.test.ts`; the bank-touching ones run against the real bank over HTTP (`tests/support/bank.ts`, `startLossyBank` for lost responses); never mock `bankRequest`. Run `npm run scenario` (failure scenarios) for end-to-end checks and `npm run typecheck`.

### Common Patterns

- `bank.ts` is the only way to call the bank (it wraps `bankRequest`); always pass the server-known `ctx.userId`.
- Intent ids are `<runId>:<tool call_id>`, giving one intent per model tool call.

## Dependencies

### Internal

- `../config`, `../auth` (`sign`, `HttpError`), `../persistence/{intents,approvals}`, `../people`, `../telemetry`, `../types`; called from `../agent/tools.ts`, `../operator/view.ts` and `../http/handlers/*` (`dashboard`, `approvals`).

### External

- `zod`, global `fetch`, `node:crypto`.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
