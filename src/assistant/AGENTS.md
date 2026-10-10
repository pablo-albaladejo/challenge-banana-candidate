<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-10-09 | Updated: 2026-10-10 -->

# assistant

## Purpose

The conversational assistant: retrieves documentation, calls the OpenAI Responses API (through `../platform/model/gateway.ts`) with function tools, executes tool calls server-side through the tool registry, and persists messages and runs in the app DB. Each tool is owned by its feature; the registry only assembles them.

## Key Files

| File                     | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `index.ts`               | Public surface for other features: `sendMessage`, `runTool` and the `Tool` type. The frozen shims `src/agent/run.ts` and `src/agent/tools.ts` re-export `sendMessage`/`answerWithEvidence` and `toolDefinitions`/`runTool` straight from `conversation.ts`, `evidence.ts` and `tool-registry.ts`                                                                                                                                                                                                                                                                            |
| `conversation.ts`        | `sendMessage(userId, conversationId, content)`: ownership check (404) -> in-memory per-conversation lock (`Set`, 409 if busy) -> insert `runs` + user `messages` row -> `searchDocuments(content)` -> last 24 messages as input -> `runLoop` -> stores the assistant message, marks the run `completed` (or `incomplete` with the round-limit error). On error marks the run `failed`, stores an apology message, throws `HttpError(502)`                                                                                                                                   |
| `loop.ts`                | `runLoop(run, instructions, input)`: up to `maxRounds = 7` rounds of `createResponse` (`parallel_tool_calls:false`, `store:false`, `reasoning.effort:'low'`, `include: reasoning.encrypted_content`) running each `function_call` via `runTool` with `intentId = "<runId>:<call_id>"`; malformed JSON arguments become a failed output plus a `tool.failed` event. Returns `{ answer, finished }`. No SQL: persists only tool events through telemetry. The `ToolContext` is built field by field, so `approvalId` / `overridePendingIntentId` never come from the model    |
| `evidence.ts`            | `answerWithEvidence(question, sources)`: single-shot grounded answer through `createResponse`                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `prompt.ts`              | `knowledgeInstructions(sources)`: system prompt with reference date and JSON-serialized retrieved excerpts                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `tool-registry.ts`       | `Tool` type `{ name, description, input, execute }` (each feature's tool file exports `<name>Tool`, e.g. `listAccountsTool`); `toolDefinitions` (strict function tools derived from each tool's `input`, in the order `list_accounts`, `search_documents`, `transfer_money`, `operation_status`, `request_human`) and `runTool(name, args, ctx)`. Never throws: failures (including `Unknown tool.`) return `{status:'failed', error}`; emits `tool.started/completed/failed` events. Imports the tools from `../accounts`, `../knowledge`, `../transfers` and `../support` |
| `strict-schema.ts`       | `strictSchema(zodObject)`: key order `type, properties, required, additionalProperties`; every field required (throws on an optional one) and primitive (`string`/`number`/`integer`/`boolean`; throws on any other type or on `pattern`/`format`/`default`/`enum`…); strips `minLength`/`maxLength`/`minimum`/`maximum`/`exclusiveMinimum`/`exclusiveMaximum` so the definitions stay byte-identical to the pre-registry ones (each tool's parse enforces the bounds); refinements are ignored                                                                             |
| `runs.repo.ts`           | The `runs` table: `insertRun`, `setRunStatus`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `http/preview-answer.ts` | `previewAnswer` (`POST preview-answer`, operators): role before body, then `answerWithEvidence`                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

## For AI Agents

### Working In This Directory

- Data flow: `conversation.ts` -> `searchDocuments` (`../knowledge`) -> `loop.ts` -> `../platform/model/gateway.ts` (OpenAI) and `tool-registry.ts` -> the tools of `../accounts`, `../knowledge`, `../transfers` and `../support`.
- A new tool is one `tools/<name>.tool.ts` file in the feature that owns it, exporting a `Tool` (`import type` from `../assistant`; ESLint rejects a value import, which would form a runtime cycle) through that feature's `index.ts`, and added to the `tools` list in `tool-registry.ts`. `tool-registry.test.ts` and `loop.test.ts` pin the serialized definitions byte for byte against `tests/fixtures/tool-definitions.ts`: a deliberate change to a definition updates that fixture.
- `ctx.userId` is server-set; tool args never carry a user id. `request_human` dedupes on an open incident per conversation.
- Tool argument validation: `search_documents`, `operation_status`, `request_human` use zod in their `execute`; `transfer_money` is validated in `../transfers/transfer-money.ts` (`transferSchema`, strict, max 10,000,000 cents).
- Things worth scrutinizing:
  - `conversation.ts:sendMessage`: the per-conversation lock is process-local.
  - `prompt.ts` tells the model to "fill in the answer with common banking practices and offer a concrete estimate" and that references are optional, which invites unsupported claims; excerpts are interpolated into the system prompt (injection surface; `role` for search is always customer).
  - `conversation.ts`: after 7 rounds a canned message is stored (the run is marked `incomplete`); the user message is persisted before any work, and history is truncated to 24 items.

### Testing Requirements

- Integration tests against the fake OpenAI (`tests/support/openai.ts`) and the real bank: `conversation.test.ts` (`sendMessage`), `evidence.test.ts` (incl. request settings), `loop.test.ts` (rounds, malformed arguments, intent ids, override in the arguments, golden tools and request settings), `prompt.test.ts`, `tool-registry.test.ts` (golden definitions, unknown tool, events), `strict-schema.test.ts` (unit) and `runs.repo.test.ts`. Each tool's own test lives next to it in its feature. `npm run doctor` is the real-API smoke test (spends quota).

### Common Patterns

- Responses API items are appended to `input` (`toResponseInputItems`) and tool results returned as `function_call_output`.
- Errors from OpenAI are summarized as "The AI provider returned <status>"; `MissingOpenAIKeyError` comes from `../platform/model/gateway.ts`.

## Dependencies

### Internal

- `../platform` (`model/gateway`, `telemetry/`, `db/statement`, `config`, `http/`), `../knowledge` (`searchDocuments`, tool), `../conversations` (conversation and message repos), `../accounts`, `../transfers`, `../support` (tools), `../types`.

### External

- `openai` (types and `toResponseInputItems` only; calls go through the gateway), `zod`.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
