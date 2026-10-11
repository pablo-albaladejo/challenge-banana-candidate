<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-10-10 | Updated: 2026-10-11 -->

# server

## Purpose

The composition root: the only place that knows every feature at once. It puts each vertical's HTTP handlers (from its `index.ts`) into the route table, dispatches requests, and seeds the app DB through the feature repos. Nothing here holds business rules.

## Key Files

| File           | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `routes.ts`    | `publicRoutes` (GET `health`, GET `people`, POST `session`; the last two carry `enabled: personaSwitcherEnabled`, so with `DEMO_PERSONA_SWITCHER` off they are absent and `handle` answers them like any absent path: 401 without a session, then 404 for `people` and 405 `Allow: GET, HEAD` for `POST session`) and `routes`, in the order of the original if-chain, wiring each vertical's handlers, every one through its `index.ts` (`currentSession`, `listPeople`, `selectPerson` from `../identity`, `dashboard` from `../accounts`, `confirmApproval` from `../transfers`, `postMessage`, `runAction` and `previewAnswer` from `../assistant`, `listDocuments`, `documentDetail`, `documentChunks`, `search`, `runIngestion` from `../knowledge`, `createConversation`, `listConversations`, `conversationDetail` from `../conversations`, and `listIncidents`, `incidentDetail` from `../support`; lint enforces it). Every route has an explicit method: reads are GET, writes POST |
| `handle.ts`    | `handle(request, context)`: awaits `context.params`, `trustedHost` for every method (421 `Unknown host.` for a `Host` outside the allowlist, DNS rebinding, P0-5), `sameOrigin` for every POST, public routes (wrong method on a public-only path is 405), then `actor()` (401 without a session, even for an unknown or wrong-method path), then the route table: a known path with another method is 405 `Method not allowed.` + `Allow`, else 404 `Route not found.`; errors via `toErrorResponse`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `seed.ts`      | `seedApp()`: in one transaction wipes app tables, loads `fixtures/conversations.json` (conversations, messages, incidents from `case`) and one historic failed intent for lucia through the feature repos (`support/infrastructure/sqlite-incidents.repo` for `insertIncident`; `transfers/infrastructure/sqlite-intents.repo` for `insertIntent`; `conversations/infrastructure/sqlite-{conversations,messages}.repo` for `insertConversation`, `insertMessage`), sets `meta.seed`, then `restoreIndex` (`restoreIndex` and `documents` from the `knowledge` index) from `fixtures/embeddings/index.json.gz` if present. Frozen at `src/seed.ts` (shim)                                                                                                                                                                                                                                                                                                                                       |
| `seed.test.ts` | Seeding is repeatable and restores the portable index                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

## For AI Agents

### Working In This Directory

- `routes.ts` and `handle.ts` reach every vertical only through its `index.ts`; `seed.ts` may also import the `infrastructure/` of `transfers`, `conversations` and `support`, and nothing else deep (ESLint, fire-proofed in the lint close-out commit that ended Phase 7, after 7d.5).
- No feature imports `server/` outside tests; `platform/` never does. Callers: `app/api/[...path]/route.ts` (`handle`), `scripts/{setup,reset}.ts` and `app/api/[...path]/route.test.ts` (`seedApp`), feature tests that need seeded data (`seedApp`).
- A new table also goes in the `seed.ts` wipe list. `seed.ts` deletes everything (including `meta`): safe only for local reset.
- Add a route as a row in `routes.ts` plus a handler in `src/<vertical>/entry-points/http/<resource>.ts`, exported from that vertical's `index.ts`.

### Testing Requirements

- `seed.test.ts` is the sibling test. `routes.ts` and `handle.ts` have none: `app/api/[...path]/route.test.ts` covers them through `api()`.

## Dependencies

### Internal

- Every vertical (its `index.ts` in `routes.ts`, `handle.ts` and `seed.ts`; three verticals' `infrastructure/` in `seed.ts`), `../platform/`, `fixtures/`.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
