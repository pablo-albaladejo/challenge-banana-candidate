<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-10-10 | Updated: 2026-10-10 -->

# conversations

## Purpose

A customer's chat threads and their messages: the `conversations` and `messages` tables and the `conversations` endpoints. Sending a message hands over to `../assistant` (`sendMessage`).

## Key Files

| File                    | Description                                                                                                                                                                                                                                                   |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `index.ts`              | Public surface: `conversationOf`, `insertConversation`, `insertMessage`, `messagesIn`, `conversationFor`                                                                                                                                                      |
| `conversations.repo.ts` | The `conversations` table: `insertConversation`, `conversationOf(id, userId)`, `conversationsOf(userId)`, `renameConversation`                                                                                                                                |
| `ownership.ts`          | `conversationFor(id, userId)`: the owned conversation, else `HttpError(404)` (someone else's reads as not found)                                                                                                                                              |
| `messages.repo.ts`      | The `messages` table: `insertMessage`, `messagesIn(conversationId)`                                                                                                                                                                                           |
| `http/conversations.ts` | `createConversation`, `listConversations` (customers only) and `conversationDetail`. `POST conversations/:id/messages` (`postMessage`) moved to `../assistant/entry-points/http/post-message.ts` in 7c (same URL); this file no longer imports `../assistant` |

## For AI Agents

### Working In This Directory

- Ownership is checked with `conversationFor`; never trust a user id from the body.
- `postMessage` (now in `../assistant/entry-points/http/post-message.ts`) renames the conversation before `sendMessage` runs (intended when the model fails, since the message is already stored; a 409 on the conversation lock still renames it without storing the message: a known gap, not pinned).
- `index.ts` loads only the repos and `ownership.ts`, never `http/`: `../assistant` imports this feature (incl. `renameConversation` for `postMessage`), so this feature never value-imports `../assistant`, which would bring back a runtime cycle (see "No runtime import cycles" in `../AGENTS.md`).

### Testing Requirements

- `conversations.repo.test.ts`, `messages.repo.test.ts` (round-trips on real SQLite); the handlers through `app/api/[...path]/route.test.ts`.

### Common Patterns

- Named-column inserts through `../platform/db/statement.ts`; ISO timestamps.

## Dependencies

### Internal

- `../platform` (`db/statement`, `http/`).
- Consumed by `../assistant/entry-points/` (`dependencies.ts`: `conversationOf`, `insertMessage`, `messagesIn`; `http/run-action.ts` and `http/post-message.ts`: `conversationFor`, `renameConversation`), `../support/operator-view.ts` and `../server/seed.ts`.

### External

- `zod`, `node:crypto`.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
