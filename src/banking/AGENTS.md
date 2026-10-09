<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-10-09 | Updated: 2026-10-09 -->

# banking

## Purpose

Server-side integration with the external bank simulator (HTTP, signed requests) and the app-side transfer workflow that records each attempt as an `intents` row in the app DB.

## Key Files

| File               | Description                                                                                                                                                                                                                                                                                                                 |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `client.ts`        | `bankRequest<T>(userId, path, method='GET', body?)`: HMAC-signs `method\npath\nuserId\ntimestamp\nbody` with `BANK_SERVICE_SECRET`; sends `x-bank-actor`, `x-bank-time`, `x-bank-signature`; aborts after `BANK_TIMEOUT_MS` (default 1400) -> `BankError(504)`; non-2xx -> `BankError(status, data.error)`. `BankError`     |
| `actions.ts`       | `transferSchema` (zod strict) and `transferMoney(ctx, args)`: customer-role check -> validate -> look up intent by `ctx.intentId` -> `INSERT OR IGNORE` intent (`created`) -> `authorizeTransfer` -> status `processing` -> `dispatchTransfer` -> `completed` / `failed`; emits `transfer.*` events; returns `ActionResult` |
| `authorization.ts` | `authorizeTransfer(ctx, input)`: fetches the actor's accounts from the bank and requires `fromAccountId` to be among them; returns `null` (allowed) or throws `HttpError(403)`                                                                                                                                              |
| `dispatch.ts`      | `dispatchTransfer(ctx, input)`: up to 2 attempts of `POST /v1/transfers`; each attempt generates a fresh `reference` (uuid), stored in `intents.bank_reference`; retries on `BankError` status >= 500                                                                                                                       |

## For AI Agents

### Working In This Directory

- Money state is owned by the bank (`simulator/`), not the app DB. `intents` in the app DB is only the app's record of attempts (`created|processing|completed|failed`).
- Bank contract (idempotency by actor + reference, error codes) is in `docs/contracts.md`; do not change `simulator/` to make this code pass.
- Things worth scrutinizing:
  - `dispatch.ts`: each retry uses a new `reference`, so a timed-out or 5xx response that actually committed at the bank (the `lost-response` scenario) can be followed by a second transfer; the failed intent then stores only the last reference.
  - `actions.ts`: an existing intent with the same payload is not short-circuited by its status, so re-invoking the same `intentId` re-dispatches; `previous.payload` comparison is on `JSON.stringify` key order.
  - `authorization.ts` checks ownership of the source only: nothing validates the destination, a per-user limit, user confirmation, or the unused `approvals` table; the `permission` return in `actions.ts` is always `null` today.
  - `actions.ts`: role check throws `HttpError` while later failures return `{status:'failed'}`; `runTool` converts both into tool errors.
  - `transferSchema` does not reject `fromAccountId === toAccountId`.
  - `client.ts`: `response.json()` is not guarded (non-JSON error bodies throw a generic error); only abort/network errors map to 504, and the abort message tells the caller nothing about whether the operation committed.

### Testing Requirements

- No sibling tests here yet. Ledger-side invariants in `simulator/bank.test.ts` (transfer atomicity, idempotency by actor+reference, lost response, intermittent scenarios) exercise the simulator, not this code. Run `npm run scenario` (failure scenarios) for end-to-end checks and `npm run typecheck`.

### Common Patterns

- `bankRequest` is the only way to call the bank; always pass the server-known `ctx.userId`.
- Intent ids are `<runId>:<tool call_id>`, giving one intent per model tool call.

## Dependencies

### Internal

- `../config`, `../auth` (`sign`, `HttpError`), `../db`, `../people`, `../telemetry`, `../types`; called from `../agent/tools.ts` and the API route.

### External

- `zod`, global `fetch`, `node:crypto`.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
