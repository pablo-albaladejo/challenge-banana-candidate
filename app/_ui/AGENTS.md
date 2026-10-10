<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-10-10 | Updated: 2026-10-10 -->

# \_ui

## Purpose

Private folder (not routed: the leading underscore opts it and every subfolder out of the App Router) holding the presentational panels of `page.tsx`, grouped by the same features as `src/`, plus the shell and the client helpers.

## Subdirectories

| Directory    | Files                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shell/`     | `Topbar.tsx` (breadcrumb and the "Switch person" persona picker, `onSelectPerson`), `Sidebar.tsx` (brand, the role's nav `onNavigate`, customer conversation list and "New conversation"), `Alerts.tsx` (error banner `role=alert` and notice `role=status` with "Send anyway" for a held transfer and "Dismiss notice"), `Icon.tsx` (inline SVG icon set: `overview`, `chat`, `transfer`, `document`, `arrow`, `help`, `clock`) |
| `transfers/` | `TransferForm.tsx` (Transfers tab: controlled from/recipient/amount/description form `onSubmit` and the side note), `ApprovalsPanel.tsx` ("Proposals awaiting confirmation", `onConfirm`), `TransferChecksPanel.tsx` ("Recent transfer checks", `role=status`, `aria-live=polite`)                                                                                                                                               |
| `accounts/`  | `CustomerOverview.tsx` (Overview tab: greeting, account cards, last 7 movements, shortcuts `onTab`)                                                                                                                                                                                                                                                                                                                              |
| `assistant/` | `ChatPanel.tsx` (Assistant tab: conversation picker, bubbles with `**bold**`, suggestions, composer; `endRef` is the scroll anchor `Home` scrolls to)                                                                                                                                                                                                                                                                            |
| `knowledge/` | `DocumentsView.tsx` (Documents tab: "Update index" for operators, search form and excerpts, document list and reader)                                                                                                                                                                                                                                                                                                            |
| `support/`   | `OperatorCases.tsx` (operator Cases tab: open-case count, inbox `onOpenCase` and case detail)                                                                                                                                                                                                                                                                                                                                    |
| `lib/`       | `api.ts` (`api(path, body?)`: GET without body, POST with JSON, `cache: 'no-store'`, throws `result.error`; the `AnyRecord` type), `format.ts` (`money(cents)` EUR `en-IE`, `date(iso)` day, short month, 24-hour time) and its unit test `format.test.ts`                                                                                                                                                                       |

## For AI Agents

### Working In This Directory

- Presentational components: props in, callbacks out. No hooks, no fetching, no state. They carry no `'use client'` of their own: `page.tsx` is the one client boundary and they run in its module graph, so import them only from client code.
- Class names, text and DOM order are the ones `page.tsx` rendered before the split (`globals.css` styles them by class).
- A panel goes in the folder of the feature whose data it shows; cross-feature chrome goes in `shell/`, non-visual helpers in `lib/`.

### Testing Requirements

- `lib/format.test.ts` (unit). The panels have no unit tests; `app/page.e2e.ts` covers them.

### Common Patterns

- Data typed as `AnyRecord`; `Person` is the only server type shared (`src/types.ts`).

## Dependencies

### Internal

- `../../../src/types` (`Person`); the panels use `lib/` and `shell/Icon.tsx`.

### External

- `react` 19.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
