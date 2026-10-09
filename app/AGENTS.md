<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-10-09 | Updated: 2026-10-09 -->

# app

## Purpose
Next.js App Router root for the Banana Bank demo. Holds the root layout, the single-page client UI (customer and operator workspaces, switched via a "View as" persona picker), global styles, and the one backend entry point under `api/`.

## Key Files
| File | Description |
|------|-------------|
| `layout.tsx` | Server component. Root `<html lang="en"><body>`, imports `./globals.css`, exports `metadata` (title "Banana Bank", simulated-environment description). No providers. |
| `page.tsx` | ~1000-line `'use client'` component `Home`. All UI and state in one file; talks only to `/api/*` through the local `api(path, body?)` helper (GET without body, POST with JSON, `cache: 'no-store'`, throws `result.error`). |
| `globals.css` | ~1390 lines of plain CSS, no modules/Tailwind. Design tokens in `:root` (`--ink`, `--paper`, `--forest`, `--lime`, ...); class-name styling (`app-shell`, `sidebar`, `account-card`, `chat-panel`, `case-list`, ...). |

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| `api/[...path]/` | Catch-all route handler; every backend endpoint is dispatched from its `route.ts` (see its AGENTS.md) |

## For AI Agents

### Working In This Directory
- Next.js here is a newer version than most training data (16.3.x). `node_modules/` was not installed when these notes were written, so `node_modules/next/dist/docs/` could not be read; run `npm install` and read the route-handler / app-router guides there before changing conventions. Route `params` is a `Promise` (awaited in `route.ts`).
- `page.tsx` structure (all in `Home`):
  - Persona: on mount calls `people` then `session`; falls back to `selectPerson('lucia')`. `selectPerson` POSTs `session {userId}`, resets all state, then loads `dashboard` and (customers only) `conversations`. A `generation` ref discards stale async results after a persona switch; keep that guard on any new async handler.
  - Customer tabs (`nav`): Overview (account cards, last 7 movements, shortcuts), Assistant (conversation list/picker, message bubbles with `**bold**` parsing, suggestion chips, composer, `busy` thinking indicator), Transfers (from/recipient/amount/description form -> `POST actions` with `transfer_money`), Documents.
  - Proposals: if `dashboard.approvals` is non-empty, a "Proposals awaiting confirmation" panel renders on any tab with a button calling `POST approvals/{id}/confirm`. `submitTransfer` also handles a `requires_confirmation` status via a notice.
  - Operator tabs: Cases (inbox from `dashboard.incidents`, detail via `GET incidents/{id}` showing latest message, history, agent events, bank operations, `gaps`) and Documents (adds an "Update index" button -> `POST ingestion`).
  - Documents tab (both roles): `POST search` for retrieved excerpts with similarity scores, `GET documents` list, `GET documents/{id}` reader (`<pre>` text).
  - Amounts are integer cents; `money()` formats EUR with `en-IE`. The date chip "24 September 2026" is hard-coded.
- Keep UI text/English consistent with existing copy; do not add libraries for state or fetching.

### Testing Requirements
- `npm run typecheck` (`next typegen && tsc --noEmit`) and `npm run build` (`next build --webpack`) must pass.
- `npm test` runs `tests/invariants.test.ts` (backend invariants only; no UI tests exist).
- Manual: `npm run dev`, open http://127.0.0.1:3000, switch persona, send a chat message, submit a transfer, confirm a proposal, and (as Marta/Pablo) open a case and run "Update index". Chat and search need `OPENAI_API_KEY` (otherwise API returns 503 `missing_openai_api_key`).

### Common Patterns
- Data typed as `Record<string, any>` (`AnyRecord`); server shapes are not shared with the client beyond `Person` from `../src/types`.
- Errors surface in a dismissible `alert error` banner, successes in `alert notice`.
- Chat refresh pattern: after send, re-fetch the conversation, conversation list, and dashboard.

### Things worth scrutinizing
- `page.tsx` `confirm()` / approvals panel: UI trusts `a.payload` from the server and offers no re-validation or expiry display.
- `catch {}` in `send()` silently swallows refresh failures.
- Persona switching is unauthenticated by design: any visitor can become any person (including operators) via `session`.
- `selectedCase.history`, `events`, `bank` render fields the backend `caseDetail` currently returns empty/null, so the operator detail view is mostly blank.

## Dependencies

### Internal
- `../src/types` (`Person` type) only; all other logic is reached via HTTP at `api/[...path]/`.

### External
- `next` (Metadata type), `react` 19 (`useState`, `useEffect`, `useRef`). Browser `fetch` and `Intl`.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
