<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-10-10 | Updated: 2026-10-10 -->

# server

## Purpose

The composition root: the only place that knows every feature at once. It wires each feature's `http/` handlers into the route table, dispatches requests, and seeds the app DB through the feature repos. Nothing here holds business rules.

## Key Files

| File           | Description                                                                                                                                                                                                                                                                                                                                                                                          |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `routes.ts`    | `publicRoutes` (GET `health`, GET `people`, POST `session`) and `routes`, in the order of the original if-chain, wiring each feature's `http/` handlers (imported directly, not through the feature's `index.ts`). Every route has an explicit method: reads are GET, writes POST                                                                                                                    |
| `handle.ts`    | `handle(request, context)`: awaits `context.params`, `sameOrigin` for every POST, public routes (wrong method on a public-only path is 405), then `actor()` (401 without a session, even for an unknown or wrong-method path), then the route table: a known path with another method is 405 `Method not allowed.` + `Allow`, else 404 `Route not found.`; errors via `toErrorResponse`              |
| `seed.ts`      | `seedApp()`: in one transaction wipes app tables, loads `fixtures/conversations.json` (conversations, messages, incidents from `case`) and one historic failed intent for lucia through the feature repos (`conversations`, `support`, `transfers` indexes), sets `meta.seed`, then `restoreIndex` (`knowledge`) from `fixtures/embeddings/index.json.gz` if present. Frozen at `src/seed.ts` (shim) |
| `seed.test.ts` | Seeding is repeatable and restores the portable index                                                                                                                                                                                                                                                                                                                                                |

## For AI Agents

### Working In This Directory

- Only this folder may deep-import a feature's `http/` (ESLint). Everything else reaches a feature through its `index.ts`.
- No feature imports `server/` outside tests; `platform/` never does. Callers: `app/api/[...path]/route.ts` (`handle`), `scripts/{setup,reset}.ts` and `app/api/[...path]/route.test.ts` (`seedApp`), feature tests that need seeded data (`seedApp`).
- A new table also goes in the `seed.ts` wipe list. `seed.ts` deletes everything (including `meta`): safe only for local reset.
- Add a route as a row in `routes.ts` plus a handler in `src/<feature>/http/<resource>.ts`.

### Testing Requirements

- `seed.test.ts` is the sibling test. `routes.ts` and `handle.ts` have none: `app/api/[...path]/route.test.ts` covers them through `api()`.

## Dependencies

### Internal

- Every feature (`http/` handlers in `routes.ts`, `index.ts` in `seed.ts` and `handle.ts`), `../platform/`, `fixtures/`.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
