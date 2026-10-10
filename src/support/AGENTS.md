<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-10-09 | Updated: 2026-10-10 -->

# support

## Purpose

Human support: the support cases (incidents) opened by customers or by the agent's `request_human` tool, and the operator's case view that explains a case with its conversation, agent events, transfers and the bank's record.

## Key Files

| File                          | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `index.ts`                    | Public surface: `requestHumanTool`, `allIncidents`, `insertIncident`                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `operator-view.ts`            | `caseDetail(operatorId, id)`: requires `person(operatorId).role === 'operator'` (else `HttpError(403)`), loads the `incidents` row (404 if missing) and returns `{incident, customer, lastMessage, history, events, intents, bank, gaps}`: the conversation's messages and agent events, its intents (unsettled ones reconciled first through `reconcileIntent` from `../transfers`), the bank operations matching their references (`operatorCustomer`), and `gaps` naming evidence that was never recorded or could not be fetched |
| `incidents.repo.ts`           | The `incidents` table: `insertIncident`, `allIncidents`, `incidentById`, `openIncidentIn(conversationId)`                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `tools/request-human.tool.ts` | `requestHumanTool` (`request_human`): checks `conversationId` before parsing; dedupes on an open incident per conversation                                                                                                                                                                                                                                                                                                                                                                                                           |
| `http/incidents.ts`           | `listIncidents`, `incidentDetail` (operators only)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

## For AI Agents

### Working In This Directory

- `operatorId` must come from `actor()`; role gates use `person(id)?.role`; errors are `HttpError`.
- Other features import this one only through `index.ts`; it reaches `../transfers`, `../conversations` and `../identity` only through theirs.
- Things worth scrutinizing:
  - `operator-view.ts` calls `reconcileIntent(incident.user_id, …)`, signing the bank call as the customer.
  - `incident` is returned whole; no scoping beyond the role check.

### Testing Requirements

- `operator-view.test.ts` (seeded app, real bank), `incidents.repo.test.ts`, `tools/request-human.tool.test.ts`; the handlers through `app/api/[...path]/route.test.ts`; E2E "Operator inbox" journeys.

### Common Patterns

- Named-column inserts through `../platform/db/statement.ts`.

## Dependencies

### Internal

- `../platform` (`db/statement`, `bank/bank`, `telemetry/events.repo`, `http/`), `../transfers`, `../conversations` (`messagesIn`), `../identity` (`person`), `../assistant` (`Tool` type only).

### External

- `zod`, `node:crypto`.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
