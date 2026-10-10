<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-10-09 | Updated: 2026-10-10 -->

# app

## Purpose

Next.js App Router root for the Banana Bank demo. Holds the root layout, the single-page client UI (customer and operator workspaces, switched via a "View as" persona picker), global styles, and the one backend entry point under `api/`.

## Key Files

| File          | Description                                                                                                                                                                                                           |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `layout.tsx`  | Server component. Root `<html lang="en"><body>`, imports `./globals.css`, exports `metadata` (title "Banana Bank", simulated-environment description). No providers.                                                  |
| `page.tsx`    | ~400-line `'use client'` component `Home`: state, effects, handlers and composition only. Markup lives in `_ui/` panels; it talks to `/api/*` only through `_ui/api.ts`.                                              |
| `globals.css` | ~1390 lines of plain CSS, no modules/Tailwind. Design tokens in `:root` (`--ink`, `--paper`, `--forest`, `--lime`, ...); class-name styling (`app-shell`, `sidebar`, `account-card`, `chat-panel`, `case-list`, ...). |

## Subdirectories

| Directory        | Purpose                                                                                                               |
| ---------------- | --------------------------------------------------------------------------------------------------------------------- |
| `api/[...path]/` | Catch-all route handler; its `route.ts` only re-exports `handle` from `src/http/` as `GET`/`POST` (see its AGENTS.md) |
| `_ui/`           | Private folder (not routed): presentational panels of `page.tsx`, the `api()` helper and the formatters               |

### `_ui/`

Presentational components: props in, callbacks out. No hooks, no fetching, no state. They carry no `'use client'` of their own: `page.tsx` is the one client boundary and they run in its module graph, so import them only from client code. Class names, text and DOM order are the ones `page.tsx` rendered before the split (`globals.css` styles them by class).

| File                      | Description                                                                                                                         |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `api.ts`                  | `api(path, body?)`: GET without body, POST with JSON, `cache: 'no-store'`, throws `result.error`; the `AnyRecord` type              |
| `format.ts`               | `money(cents)` (EUR, `en-IE`) and `date(iso)` (day, short month, 24-hour time); unit-tested by `format.test.ts`                     |
| `Icon.tsx`                | Inline SVG icon set (`overview`, `chat`, `transfer`, `document`, `arrow`, `help`, `clock`)                                          |
| `Sidebar.tsx`             | Brand, the role's nav (`onNavigate`), customer conversation list and "New conversation"                                             |
| `Topbar.tsx`              | Breadcrumb and the "Switch person" persona picker (`onSelectPerson`)                                                                |
| `Alerts.tsx`              | Error banner (`role=alert`) and notice (`role=status`) with "Send anyway" for a held transfer and "Dismiss notice"                  |
| `CustomerOverview.tsx`    | Customer Overview tab: greeting, account cards, last 7 movements, shortcuts (`onTab`)                                               |
| `ChatPanel.tsx`           | Assistant tab: conversation picker, bubbles with `**bold**`, suggestions, composer; `endRef` is the scroll anchor `Home` scrolls to |
| `TransferForm.tsx`        | Transfers tab: controlled from/recipient/amount/description form (`onSubmit`) and the side note                                     |
| `ApprovalsPanel.tsx`      | "Proposals awaiting confirmation" (`onConfirm`)                                                                                     |
| `TransferChecksPanel.tsx` | "Recent transfer checks" (`role=status`, `aria-live=polite`)                                                                        |
| `OperatorCases.tsx`       | Operator Cases tab: open-case count, inbox (`onOpenCase`) and case detail                                                           |
| `DocumentsView.tsx`       | Documents tab: "Update index" (operators), search form and excerpts, document list and reader                                       |

## For AI Agents

### Working In This Directory

- Next.js here is a newer version than most training data (16.3.x). Read the route-handler / app-router guides in `node_modules/next/dist/docs/` before changing conventions. Route `params` is a `Promise` (awaited in `route.ts`).
- `page.tsx` structure (state and handlers in `Home`, markup in `_ui/`):
  - Persona: on mount calls `people` then `session`; falls back to `selectPerson('lucia')`. `selectPerson` POSTs `session {userId}`, resets all state, then loads `dashboard` and (customers only) `conversations`. A `generation` ref discards stale async results after a persona switch; keep that guard on any new async handler. Every async handler is a named `Home` function (`refresh`, `selectPerson`, `openConversation`, `newConversation`, `send`, `openLibrary`, `submitTransfer`, `confirm`, `openCase`, `updateIndex`, `search`, `openDocument`); panels only call the callbacks they receive.
  - Customer tabs (`nav`): Overview (account cards, last 7 movements, shortcuts), Assistant (conversation list/picker, message bubbles with `**bold**` parsing, suggestion chips, composer, `busy` thinking indicator), Transfers (from/recipient/amount/description form -> `POST actions` with `transfer_money`), Documents.
  - Proposals: if `dashboard.approvals` is non-empty, a "Proposals awaiting confirmation" panel renders on any tab with a button calling `POST approvals/{id}/confirm`. `submitTransfer` also handles a `requires_confirmation` status via a notice. On `requires_review` (a matching transfer is still being verified with the bank) the notice carries a "Send anyway" button that resubmits the same arguments with the held `intentId` and `overridePendingIntentId`; on a held confirmation it re-confirms the same approval with `overridePendingIntentId`.
  - Pending transfers: if `dashboard.pendingTransfers` is non-empty, a "Recent transfer checks" panel (`role=status`, `aria-live=polite`) renders next to the proposals: `unknown`/`processing` -> "Checking with the bank", `completed` -> "Completed", `failed` -> "Not executed". The dashboard reconciles them on every load.
  - Operator tabs: Cases (inbox from `dashboard.incidents`, detail via `GET incidents/{id}` showing latest message, history, agent events, bank operations, `gaps`) and Documents (adds an "Update index" button -> `POST ingestion`).
  - Documents tab (both roles): `POST search` for retrieved excerpts with similarity scores, `GET documents` list, `GET documents/{id}` reader (`<pre>` text).
  - Amounts are integer cents; `money()` formats EUR with `en-IE`. The date chip "24 September 2026" is hard-coded.
- Keep UI text/English consistent with existing copy; do not add libraries for state or fetching.

### Testing Requirements

- `npm run typecheck` (`next typegen && tsc --noEmit`) and `npm run build` (`next build --webpack`) must pass.
- `npm test` runs colocated `*.test.ts` (see `TESTING.md`): `api/[...path]/route.test.ts` and the unit `_ui/format.test.ts`. Components have no unit tests; `page.e2e.ts` (11 journeys, `npm run test:e2e`) covers them, including a forced generation-guard race on persona switch.
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

- `../src/types` (`Person` type) only, from `page.tsx` and `_ui/`; all other logic is reached via HTTP at `api/[...path]/`.

### External

- `next` (Metadata type), `react` 19 (`useState`, `useEffect`, `useRef`). Browser `fetch` and `Intl`.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
