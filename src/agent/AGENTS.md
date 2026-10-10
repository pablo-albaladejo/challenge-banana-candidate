<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-10-09 | Updated: 2026-10-09 -->

# agent

## Purpose

The conversational assistant: retrieves documentation, calls the OpenAI Responses API with function tools, executes tool calls server-side, and persists messages/runs in the app DB.

## Key Files

| File        | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `run.ts`    | `sendMessage(userId, conversationId, content)`: in-memory per-conversation lock (`Set`, 409 if busy) -> insert `runs` + user `messages` row -> `searchDocuments(content)` -> last 24 messages as input -> up to 7 rounds of `responses.create` (`parallel_tool_calls:false`, `store:false`, `reasoning.effort:'low'`) running each `function_call` via `runTool` with `intentId = "<runId>:<call_id>"` -> stores assistant message, marks run `completed`. On error marks run `failed`, stores an apology message, throws `HttpError(502)`. Also `answerWithEvidence(question, sources)`: single-shot grounded answer |
| `tools.ts`  | `toolDefinitions` (strict function tools: `list_accounts`, `search_documents`, `transfer_money`, `operation_status`, `request_human`) and `runTool(name, args, ctx)` dispatcher. Never throws: failures return `{status:'failed', error}`; emits `tool.started/completed/failed` events                                                                                                                                                                                                                                                                                                                               |
| `prompt.ts` | `knowledgeInstructions(sources)`: system prompt with reference date and JSON-serialized retrieved excerpts                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

## For AI Agents

### Working In This Directory

- Data flow: `run.ts` -> `retrieval/search.ts` (app DB chunks); `tools.ts` -> `banking/bank.ts` (bank API: accounts, contacts, operations), `banking/actions.ts` (transfers), app DB (`incidents`).
- `ctx.userId` is server-set; tool args never carry a user id. `request_human` dedupes on an open incident per conversation.
- Tool argument validation: `search_documents`, `operation_status`, `request_human` use zod in `runTool`; `transfer_money` is validated in `banking/actions.ts` (`transferSchema`, strict, max 10,000,000 cents).
- Things worth scrutinizing:
  - `run.ts:sendMessage` does not check that `conversationId` belongs to `userId`, and the lock is process-local.
  - `prompt.ts` tells the model to "fill in the answer with common banking practices and offer a concrete estimate" and that references are optional, which invites unsupported claims; excerpts are interpolated into the system prompt (injection surface; `role` for search is always customer).
  - Transfer execution has no confirmation step in the loop: the model's `transfer_money` call runs immediately.
  - `run.ts`: malformed tool-call JSON becomes `{}`; after 7 rounds a canned message is stored as if answered; the user message is persisted before any work, and history is truncated to 24 items.
  - `tools.ts`: `list_accounts` fetches accounts and contacts sequentially without per-call failure shaping beyond the generic catch; tool events log only status (see `telemetry.ts`).
  - `operation_status` accepts any reference string; scoping relies on the bank enforcing the actor header.

### Testing Requirements

- No invariant covers this directory directly (needs OpenAI). Run `npm run typecheck`; use `npm run scenario` against the simulator for manual checks. `npm test` still imports it transitively via the API route.

### Common Patterns

- Responses API items are appended to `input` (`toResponseInputItems`) and tool results returned as `function_call_output`.
- Errors from OpenAI are summarized as "The AI provider returned <status>"; `MissingOpenAIKeyError` comes from `retrieval/embeddings.ts`.

## Dependencies

### Internal

- `../retrieval/{embeddings,search}`, `../banking/{client,actions}`, `../db`, `../config`, `../auth` (`HttpError`), `../telemetry`, `../types`.

### External

- `openai` (Responses API), `zod`.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
