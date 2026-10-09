<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-10-09 | Updated: 2026-10-09 -->

# docs

## Purpose
Authoritative statement of the task (`challenge.md`) and of the observable behavior the app and the external bank must honor (`contracts.md`). Read both before changing agent, banking, or API behavior.

## Key Files
| File | Description |
|------|-------------|
| `challenge.md` | Candidate brief: situation, two required parts, deliverables, review weights, pre-submit checklist |
| `contracts.md` | Business rules, bank HTTP API, failure scenarios, app integration surface |
| `challenge.pdf` | PDF rendering of the brief (not summarized here; `challenge.md` is the text source) |

## Brief summary (`challenge.md`)
- **Part 1, Prepare for Monday:** explore the app, reproduce problems, fix the ones you choose, show before/after evidence. Scope is the web app, the agent, and the bank integration. Treat `simulator/` as an external bank; evaluation may point the app at a separate implementation of the same contract.
- **Part 2, Distinctive feature:** a creative, useful capability in the agent or its workflow (new tool, new UI, new component). The existing agent may stay as is.
- **Deliverable:** one ZIP with the full project (code for both parts, lockfile, config templates, `README.md` setup), `submission/` (see `submission/AGENTS.md`), complete original AI session exports, and a 5-10 minute video or a PDF alternative. Exclude `.env*` (except `.env.example`), `node_modules/`, `.next/`, `.git/`.
- **Weights:** Part 1 40%, Part 2 40%, working method/verification/handoff 20%. Depth on one or two well-evidenced problems can beat many shallow fixes; breadth also earns credit.
- **Before submitting:** unzip into a fresh folder and follow your own instructions; check no credentials; state what is finished, verified, and pending.

## Contract summary (`contracts.md`)
**Business rules:** only the account holder can transfer; operators cannot move customer money. Amounts are positive integer cents, no overdraft, max 10,000,000 cents (EUR 100,000), source and destination exist and differ. Sensitive operations need explicit review of amount, source, destination before execution. Retrying one intent must not multiply effects, yet two distinct intents may look identical. A timeout is not proof of rejection. Answers must rest on applicable documents with traceable evidence; never invent unrecorded history.

**Bank API** (default `http://127.0.0.1:4001`, server-to-server only):
| Endpoint | Purpose |
|----------|---------|
| `GET /health` | No credentials |
| `GET /v1/accounts`, `/v1/contacts`, `/v1/movements` | Actor's accounts (`balanceCents`), destinations, up to 100 movements |
| `POST /v1/transfers` | `{fromAccountId,toAccountId,amountCents,concept,reference}` |
| `GET /v1/operations/:reference` | Operation by reference; 404 if absent |
| `GET /v1/operator/customer?id=` | Operators only |

- **Headers on every `/v1/*`:** `x-bank-actor`, `x-bank-time` (Unix ms, 60 s window), `x-bank-signature` = hex HMAC-SHA256 of `[method, pathWithQuery, actor, timestamp, exactJsonBody].join('\n')` with `BANK_SERVICE_SECRET` (see `src/banking/client.ts`). Actor comes from the server session, never model arguments.
- **Idempotency:** key = actor + `reference` (1-120 chars). Same payload replays with `replay:true`; different payload returns 409. The app decides which requests are the same intent.
- **Errors:** 400 invalid input, 401 invalid context, 403 ownership/role, 404 absent, 409 conflict, 422 insufficient funds, 503 unavailable, 504 upstream timeout. 503/504 do not establish whether the transfer committed.
- **Scenarios** (`npm run scenario -- <profile> [seed]`): `normal`, `intermittent` (default, seed 17, third new op loses its response after commit), `reject-before`, `lost-response`, `slow-response`, `read-unavailable`. Admin API (`/admin/*`, Bearer `BANK_ADMIN_SECRET`) is for local testing only; the app must not use it to complete or inspect operations.
- **App surface:** `/api/session`, `/api/dashboard`, `/api/conversations[/:id[/messages]]`, `/api/actions` (`transfer_money`, `list_accounts`, `operation_status`, `search_documents`, `request_human`; `intentId` marks the same intent), `/api/approvals/:id/confirm`, `/api/incidents/:id`, `/api/documents[/:id[/chunks]]`, `/api/search`, operator-only `/api/ingestion` and `/api/preview-answer`. Refactoring this surface requires a documented equivalent adapter.

## For AI Agents

### Working In This Directory
- Treat these files as read-only requirements; they define the behavior, not a design.
- Do not satisfy the contract with constant or canned responses; effects must be real.
- Contract text says the starter may not comply. Compare code against it rather than assuming it does.

### Testing Requirements
- Reproduce each scenario profile against a running bank before claiming an idempotency or status fix.
- Verify contract claims against `src/banking/client.ts` and `simulator/` when editing docs.

### Common Patterns
- Refer to contract rules by section name (Business behavior, External bank boundary, Reproducible scenarios) in notes and commits.

## Dependencies

### Internal
- `src/banking/client.ts`, `src/types.ts` (`SearchResult`), `simulator/`, `app/` API routes, `submission/README.md`

### External
- None

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
