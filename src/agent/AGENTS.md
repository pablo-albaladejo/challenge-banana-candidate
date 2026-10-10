<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-10-09 | Updated: 2026-10-10 -->

# agent

## Purpose

The conversational assistant: retrieves documentation, calls the OpenAI Responses API with function tools, executes tool calls server-side, and persists messages/runs in the app DB.

## Key Files

| File              | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `run.ts`          | Frozen re-export shim (plan §2): `sendMessage` from `conversation.ts`, `answerWithEvidence` from `evidence.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `tools.ts`        | Frozen re-export shim (plan §2): `toolDefinitions`, `runTool` from `tools/registry.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `conversation.ts` | `sendMessage(userId, conversationId, content)`: ownership check (404) -> in-memory per-conversation lock (`Set`, 409 if busy) -> insert `runs` + user `messages` row -> `searchDocuments(content)` -> last 24 messages as input -> `runLoop` -> stores the assistant message, marks the run `completed` (or `incomplete` with the round-limit error). On error marks the run `failed`, stores an apology message, throws `HttpError(502)`                                                                                                                                     |
| `loop.ts`         | `runLoop(run, instructions, input)`: up to `maxRounds = 7` rounds of `createResponse` (`parallel_tool_calls:false`, `store:false`, `reasoning.effort:'low'`, `include: reasoning.encrypted_content`) running each `function_call` via `runTool` with `intentId = "<runId>:<call_id>"`; malformed JSON arguments become a failed output plus a `tool.failed` event. Returns `{ answer, finished }`. No SQL: persists only tool events through `telemetry.ts`. The `ToolContext` is built field by field, so `approvalId` / `overridePendingIntentId` never come from the model |
| `evidence.ts`     | `answerWithEvidence(question, sources)`: single-shot grounded answer through `createResponse`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `prompt.ts`       | `knowledgeInstructions(sources)`: system prompt with reference date and JSON-serialized retrieved excerpts                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

### `tools/`

| File                                                                                                      | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `registry.ts`                                                                                             | `Tool` type `{ name, description, input, execute }` (each tool file exports `<name>Tool`, e.g. `listAccountsTool`); `toolDefinitions` (strict function tools derived from each tool's `input`, in the order `list_accounts`, `search_documents`, `transfer_money`, `operation_status`, `request_human`) and `runTool(name, args, ctx)`. Never throws: failures (including `Unknown tool.`) return `{status:'failed', error}`; emits `tool.started/completed/failed` events                      |
| `strict-schema.ts`                                                                                        | `strictSchema(zodObject)`: key order `type, properties, required, additionalProperties`; every field required (throws on an optional one) and primitive (`string`/`number`/`integer`/`boolean`; throws on any other type or on `pattern`/`format`/`default`/`enum`…); strips `minLength`/`maxLength`/`minimum`/`maximum`/`exclusiveMinimum`/`exclusiveMaximum` so the definitions stay byte-identical to the pre-registry ones (each tool's parse enforces the bounds); refinements are ignored |
| `list-accounts.ts`, `search-documents.ts`, `transfer-money.ts`, `operation-status.ts`, `request-human.ts` | One tool each. `execute` parses its own arguments: `list_accounts` reads none, `request_human` checks `conversationId` before parsing, `transfer_money` passes the raw arguments to `banking/actions.ts:transferMoney` (whose `transferSchema` is also its `input`)                                                                                                                                                                                                                             |

## For AI Agents

### Working In This Directory

- Data flow: `conversation.ts` -> `retrieval/search.ts` (app DB chunks) -> `loop.ts` -> `model/gateway.ts` (OpenAI) and `tools/registry.ts` -> `banking/bank.ts` (bank API: accounts, contacts, operations), `banking/actions.ts` (transfers), `persistence/incidents.ts`.
- A new tool is one file in `tools/` exporting a `Tool`, added to the `tools` list in `registry.ts`. `tools/registry.test.ts` and `loop.test.ts` pin the serialized definitions byte for byte against `tests/fixtures/tool-definitions.ts`: a deliberate change to a definition updates that fixture.
- `ctx.userId` is server-set; tool args never carry a user id. `request_human` dedupes on an open incident per conversation.
- Tool argument validation: `search_documents`, `operation_status`, `request_human` use zod in their `execute`; `transfer_money` is validated in `banking/actions.ts` (`transferSchema`, strict, max 10,000,000 cents).
- Things worth scrutinizing:
  - `conversation.ts:sendMessage`: the per-conversation lock is process-local.
  - `prompt.ts` tells the model to "fill in the answer with common banking practices and offer a concrete estimate" and that references are optional, which invites unsupported claims; excerpts are interpolated into the system prompt (injection surface; `role` for search is always customer).
  - `conversation.ts`: after 7 rounds a canned message is stored (the run is marked `incomplete`); the user message is persisted before any work, and history is truncated to 24 items.
  - `tools/list-accounts.ts`: `list_accounts` fetches accounts and contacts sequentially without per-call failure shaping beyond the generic catch; tool events log only status (see `telemetry.ts`).
  - `operation_status` accepts any reference string; scoping relies on the bank enforcing the actor header.

### Testing Requirements

- Integration tests against the fake OpenAI (`tests/support/openai.ts`) and the real bank: `conversation.test.ts` (`sendMessage`), `evidence.test.ts` (incl. request settings), `loop.test.ts` (rounds, malformed arguments, intent ids, override in the arguments, golden tools and request settings), `prompt.test.ts`, and one `tools/<name>.test.ts` per tool plus `registry.test.ts` (golden definitions, unknown tool, events) and `strict-schema.test.ts` (unit). `npm run doctor` is the real-API smoke test (spends quota).

### Common Patterns

- Responses API items are appended to `input` (`toResponseInputItems`) and tool results returned as `function_call_output`.
- Errors from OpenAI are summarized as "The AI provider returned <status>"; `MissingOpenAIKeyError` comes from `model/gateway.ts` (re-exported by `retrieval/embeddings.ts`).

## Dependencies

### Internal

- `../model/gateway`, `../retrieval/search`, `../banking/{bank,actions}`, `../persistence/*`, `../config`, `../auth` (`HttpError`), `../telemetry`, `../types`.

### External

- `openai` (types and `toResponseInputItems` only; calls go through `../model/gateway`), `zod`.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
