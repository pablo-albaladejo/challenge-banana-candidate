<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-10-10 | Updated: 2026-10-10 -->

# accounts

## Purpose

What a customer owns at the bank, as the app shows it: the customer dashboard (accounts, movements, contacts, live approvals and the transfers still being checked) and the `list_accounts` agent tool. Bank data comes from the port in `../platform/bank/`; transfer state comes from `../transfers`.

## Key Files

| File                          | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `index.ts`                    | Public surface for other features: `listAccountsTool`                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `http/dashboard.ts`           | `dashboard` (`GET dashboard`): an operator gets `{ incidents }` (`allIncidents` from `../support`); a customer gets `accounts`, `movements`, `contacts` (bank port), live `approvals` and `pendingTransfers`: up to 10 of the customer's intents (the newest `unknown`/`processing` ones first, then `failed` ones with a bank reference from the last 24 h), each reconciled with the bank (`reconcileIntent` from `../transfers`) before it is returned. A failed check leaves its intent unchanged; the dashboard still loads |
| `tools/list-accounts.tool.ts` | `listAccountsTool` (`list_accounts`): takes no arguments; returns the actor's accounts and contacts from the bank port                                                                                                                                                                                                                                                                                                                                                                                                           |

## For AI Agents

### Working In This Directory

- Other features import this one only through `index.ts`; it imports `../transfers` and `../support` only through theirs.
- `http/dashboard.ts` is an HTTP handler wired by `../server/routes.ts`; it is not exported from `index.ts`.
- Things worth scrutinizing:
  - `list_accounts` fetches accounts and contacts sequentially without per-call failure shaping beyond the generic catch in `runTool`; tool events log only status (see `../platform/telemetry/telemetry.ts`).
  - The dashboard reconciles on every load: each load can make up to 10 bank calls.

### Testing Requirements

- `tools/list-accounts.tool.test.ts` (real bank). The dashboard is covered by `app/api/[...path]/route.test.ts` and the E2E journeys.

### Common Patterns

- Always pass the server-known actor id to the bank port.

## Dependencies

### Internal

- `../platform` (`bank/bank`, `http/respond`, `http/context`), `../transfers`, `../support`, `../assistant` (`Tool` type only).

### External

- None.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
