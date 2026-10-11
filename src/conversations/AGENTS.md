<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-10-10 | Updated: 2026-10-11 -->

# conversations

## Purpose

A customer's chat threads and their messages: the `conversations` and `messages` tables and the `conversations` endpoints. Sending a message is served by `../assistant` (`POST conversations/:id/messages` lives in `../assistant/entry-points/http/post-message.ts` since 7c; the URL did not change).

Hexagonal vertical (plan §10, 7d.2): `domain/` (pure rules), `application/` (ports, use cases; no services), `infrastructure/` (SQLite adapters), `entry-points/` (wiring, http). No `legacy.ts`: no frozen path reaches this feature. Nothing else lives at the root but `index.ts` and this file.

## Key Files

| File                                                                | Description                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `index.ts`                                                          | The public surface, re-exported from `entry-points/` only: `conversations()` (the lazy `ConversationsApp` graph) and the handlers `createConversation`, `listConversations`, `conversationDetail`                                                                                                                                      |
| `domain/conversation.ts`                                            | Row types `ConversationRow`, `NewConversation`, `MessageRow`, `NewMessage`; `NEW_CONVERSATION_TITLE` (`New conversation`); `titleFor(conversation, content)` (first 50 characters while untitled, else `undefined`); `requireOwned(row)` (`NotFoundError` `Conversation not found.` when the lookup found nothing)                     |
| `application/ports/{conversation-repository,message-repository}.ts` | `ConversationRepository` (`insert`, `ownedBy(id, userId)`: ownership is part of the lookup, `ofUser(userId)` newest first, `rename(id, userId, title)`: owner-scoped too); `MessageRepository` (`insert`, `in(conversationId)` in time order, ties in insertion order)                                                                 |
| `application/use-cases/start-conversation.ts`                       | `{ userId }` → `{ id }`: an untitled conversation with `ids.uuid()` and `clock.now()`                                                                                                                                                                                                                                                  |
| `application/use-cases/list-conversations.ts`                       | `{ userId }` → the user's own rows, newest first                                                                                                                                                                                                                                                                                       |
| `application/use-cases/get-owned-conversation.ts`                   | `{ conversationId, userId }` → the row, or `NotFoundError` for another's, an operator (who owns none) or an unknown id                                                                                                                                                                                                                 |
| `application/use-cases/get-conversation-detail.ts`                  | `{ conversationId, userId }` → `{ conversation, messages }`; ownership before the messages are read                                                                                                                                                                                                                                    |
| `application/use-cases/title-conversation.ts`                       | `{ conversation, userId, content }`: renames an untitled conversation (`titleFor`). Decides from the row `getOwnedConversation` returned (the title read before the body was parsed, as before the move); the rename is owner-scoped (`WHERE id=? AND user_id=?`), so a row of someone else's conversation renames nothing             |
| `application/use-cases/{append-message,list-messages}.ts`           | `appendMessage(NewMessage)` stores a message as given; `listMessages({ conversationId })` in time order. Neither checks ownership: the callers (`sendMessage`, the operator case view) check it first                                                                                                                                  |
| `infrastructure/sqlite-{conversations,messages}.repo.ts`            | The only owners of that SQL: `insertConversation`, `conversationOf` (`WHERE id=? AND user_id=?`), `conversationsOf`, `renameConversation(id, userId, title)` (`WHERE id=? AND user_id=?`); `insertMessage`, `messagesIn`; the port objects `sqliteConversations`, `sqliteMessages`. `server/seed.ts` imports the two inserts from here |
| `entry-points/dependencies.ts`                                      | `wireConversations({ clock?, ids? })` builds the seven use cases over the SQLite adapters; `conversations()` is the per-process singleton. Only the clock and ids may be overridden (`startConversation` reads both); no `internals`: there is no service or registry                                                                  |
| `entry-points/http/conversations.ts`                                | `createConversation` (201 `{ id }`) and `listConversations`, both customers only (`HttpError(403, 'Select a customer to open a chat.')` before any use case, C2), and `conversationDetail` (any role; an operator owns nothing, so it reads as 404)                                                                                    |

## For AI Agents

### Working In This Directory

- Ownership is checked with `getOwnedConversation` (or inside `getConversationDetail`); never trust a user id from the body. The rule is the `user_id=?` of `conversationOf` and `renameConversation` plus `requireOwned`; all three are pinned by mutation (dropping either fails the route and use-case pins).
- `postMessage` (in `../assistant/entry-points/http/post-message.ts`) runs `getOwnedConversation` → body → `titleConversation` → `sendMessage`: the title is set before the agent runs (intended when the model fails, since the message is already stored; a 409 on the conversation lock still renames it without storing the message: a known gap, not pinned).
- Rank 0: this feature never value-imports another vertical, so `../assistant` may import its index without a cycle (see "No runtime import cycles" in `../AGENTS.md`).
- Lint (`eslint.config.mjs`): conversations is a layered vertical, so `index.ts` re-exports only `./entry-points/` (types allowed) and `src/server/` reaches it only through the index; `seed.ts` may also import its `infrastructure/`.

### Testing Requirements

- `domain/conversation.test.ts` (unit: `titleFor`, `requireOwned`), `application/use-cases/{start-conversation,list-conversations,get-owned-conversation,get-conversation-detail,title-conversation,list-messages}.test.ts` (real SQLite; `startConversation with a fixed clock` wires `wireConversations({ clock, ids })`; another customer and an operator read as `NotFoundError`; another customer's row passed to `titleConversation` renames nothing), `infrastructure/sqlite-{conversations,messages}.repo.test.ts` (round-trips). The handlers through `app/api/[...path]/route.test.ts` (newest first, the new conversation listed first, exact body shapes, the operator and another customer as 404, a rejected message leaves another's title and messages untouched, a titled conversation keeps its title).

### Common Patterns

- Named-column inserts through `../platform/db/statement.ts`; ISO timestamps; rows answered in snake_case as stored.

## Dependencies

### Internal

- `../platform` (`db/statement`, `http/`, `runtime`), `../shared` (`NotFoundError`, `Clock`, `Ids`).
- Consumed by `../assistant/entry-points/` (`dependencies.ts`: the `ConversationLog` = `getOwnedConversation`, `appendMessage`, `listMessages`; `http/run-action.ts` and `http/post-message.ts`: `getOwnedConversation`, `titleConversation`), `../support/operator-view.ts` (`listMessages`), `../server/routes.ts` (the handlers) and `../server/seed.ts` (the two inserts, from `infrastructure/`).

### External

- none (ids come from the `Ids` port).

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
