<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-10-09 | Updated: 2026-10-09 -->

# operator

## Purpose
Read model for human support operators: the detail of a support case (incident) opened by customers or by the agent's `request_human` tool.

## Key Files
| File | Description |
|------|-------------|
| `view.ts` | `caseDetail(operatorId, id)`: requires `person(operatorId).role === 'operator'` (else `HttpError(403)`), loads the `incidents` row (404 if missing) and the latest `messages` row of its conversation; returns `{incident, customer, lastMessage, history, events, intents, bank}` |

## For AI Agents

### Working In This Directory
- Reads the app DB only; it does not call the bank. `operatorId` must come from `actor()`.
- Things worth scrutinizing:
  - `history`, `events`, `intents` are hard-coded `[]` and `bank` is `null`; the tables `messages`, `events`, `intents` (and the bank API via `banking/client.ts`) already hold the data an operator would need to understand a case, including failed or ambiguous transfers.
  - `incident` is `SELECT *` with an `any` cast and is returned whole; no scoping beyond the role check.
  - Only `lastMessage` is fetched, so the operator sees one message of context.

### Testing Requirements
- No invariant covers it. Run `npm run typecheck`; verify manually via the operator UI after `npm run dev` with an operator persona (marta, pablo).

### Common Patterns
- Role gates use `person(id)?.role`; errors are `HttpError`.

## Dependencies
### Internal
- `../db`, `../people`, `../auth` (`HttpError`); called from `app/api/[...path]/route.ts`.

### External
- None beyond `better-sqlite3` through `../db`.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
