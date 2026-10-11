<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-10-10 | Updated: 2026-10-11 -->

# accounts

## Purpose

What a customer owns at the bank, as the app shows it: the dashboard (`GET dashboard`: the customer overview, or the support workspace for an operator) and the `list_accounts` agent tool.

Hexagonal vertical (plan §10, 7d.5): `application/` (ports, use cases; no services), `infrastructure/` (the bank adapter), `entry-points/` (wiring, http, tools). No `domain/`: there is no rule of its own, only reads (the pending-transfer rules live in `../transfers`). No `legacy.ts`: no frozen path reaches this vertical.

## Key Files

| File                                             | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `index.ts`                                       | The public surface, re-exported from `entry-points/` only: `accounts()` (the lazy `AccountsApp` graph), `listAccountsTool` and the `dashboard` handler                                                                                                                                                                                                                                                                                                                                                     |
| `application/ports/accounts-bank.ts`             | `AccountsBank`: `accounts`, `contacts`, `movements`, each for one `userId` (the bank signs the call as that customer); rejects with a `BankFailure`. `Contact` and `Movement` are declared structurally here                                                                                                                                                                                                                                                                                               |
| `application/ports/pending-transfers-query.ts`   | `PendingTransfersQuery`: `pendingTransfers(userId)` (async) and `liveProposals(userId)` (sync); wired to `transfers().listPendingTransfers` / `.listLiveProposals`                                                                                                                                                                                                                                                                                                                                         |
| `application/use-cases/get-customer-overview.ts` | `{ userId }` → `{ accounts, movements, contacts, approvals, pendingTransfers }`: `Promise.all` of accounts, movements, contacts and the pending transfers (up to 10 of the customer's intents, the newest `unknown`/`processing` ones first, then `failed` ones with a bank reference from the last 24 h, each reconciled with the bank first; a failed check leaves its intent unchanged), then the proposals live at that moment. One bank rejection fails the whole load, before the proposals are read |
| `application/use-cases/list-accounts.ts`         | `{ userId }` → `{ accounts, contacts }`: two sequential bank calls, accounts first                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `infrastructure/http-accounts-bank.adapter.ts`   | `httpAccountsBank` over `../platform/bank/bank.ts`; through `platform/bank/with-bank-failure.ts` a `BankError` becomes a `BankFailure` with the same status and message (so `GET dashboard` with the bank down is still a 504 `No response received from the bank.`)                                                                                                                                                                                                                                       |
| `entry-points/dependencies.ts`                   | `wireAccounts()` builds the two use cases; `accounts()` is the per-process singleton. No overrides (no use case reads the clock or ids) and no `internals`. The `PendingTransfersQuery` arrows call `transfers()` lazily                                                                                                                                                                                                                                                                                   |
| `entry-points/http/dashboard.ts`                 | `dashboard` (`GET dashboard`): `actor.role === 'operator'` → `support().getOperatorWorkspace()` (`{ incidents }`, the bank is never asked); otherwise `accounts().getCustomerOverview({ userId: actor.id })`. The customer is always the session actor, never the request                                                                                                                                                                                                                                  |
| `entry-points/tools/list-accounts.tool.ts`       | `listAccountsTool` (`list_accounts`): takes no arguments; `accounts().listAccounts({ userId: ctx.userId })`                                                                                                                                                                                                                                                                                                                                                                                                |

## For AI Agents

### Working In This Directory

- Rank 3: value-imports `transfers` (rank 1) and `support` (rank 2), only through their indexes and only from `entry-points/`; takes the `Tool` type from `../assistant` (erased).
- `application/` never sees another vertical: transfers arrives through `PendingTransfersQuery`, the bank through `AccountsBank`.
- Lint (`eslint.config.mjs`): `index.ts` re-exports only `./entry-points/` (types allowed); `src/server/` reaches this vertical only through its index; the seed does not need it.
- Always pass the server-known actor id (`actor.id`, `ctx.userId`) to a use case; no use case takes a user id from a body, a query or tool arguments.
- Things worth scrutinizing:
  - `list_accounts` fetches accounts and contacts sequentially without per-call failure shaping beyond the generic catch in `runTool`; tool events log only status (see `../platform/telemetry/telemetry.ts`).
  - The dashboard reconciles on every load: each load can make up to 10 bank calls.

### Testing Requirements

- `application/use-cases/get-customer-overview.test.ts` (stub ports: every section read for lucia and for bruno only, the movements, contacts and pending transfers reads started while the accounts are still unanswered, the five sections in order, one rejection fails the load before the proposals); `application/use-cases/list-accounts.test.ts` (stub port: the customer's accounts, then their contacts once the accounts answered); `infrastructure/http-accounts-bank.adapter.test.ts` (real bank: the actor's data, the unreachable `BankFailure`); `entry-points/tools/list-accounts.tool.test.ts` (real bank: the context user, never the arguments). The dashboard through `app/api/[...path]/route.test.ts` (customer sections and order, own movements and approvals only, a query naming another customer ignored, the operator workspace without the bank, the bank-stopped 504) and the E2E journeys.

### Common Patterns

- Use cases take one object (`{ userId }`); ports are typed in `application/ports/`.

## Dependencies

### Internal

- `../platform` (`bank/bank`, `bank/client`, `http/respond`, `http/context`), `../shared` (`BankFailure`), `../transfers` and `../support` (indexes, from `entry-points/`), `../assistant` (`Tool` type only), `../types`.
- Consumed by `../server/routes.ts` (`dashboard`) and `../assistant/entry-points/tools/catalog.ts` (`listAccountsTool`).

### External

- `zod`.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
