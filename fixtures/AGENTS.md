<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-10-09 | Updated: 2026-10-09 -->

# fixtures

## Purpose
Seed data for the fictional Banana Bank: bank documents to ingest, pre-existing customer conversations, and a portable pre-computed embedding index.

## Key Files
| File | Description |
|------|-------------|
| `conversations.json` | 47 seed conversations (JSON array) seeded into the app database by `src/seed.ts` |
| `embeddings/index.json.gz` | Portable embedding index (about 1.5 MB gzipped), see below |

### `conversations.json` shape
- Each item: `{ id, userId, title, createdAt (ISO), messages: [{ role: "user"|"assistant", content }] }`. No tool calls, citations, or timestamps per message.
- All 47 have exactly 3 messages (user, assistant, user). Users: bruno, omar, carla, diego, elena, ines, lucia have 6 each, hugo has 5.
- Id patterns: `conv-<user>-welcome`, `-archive` (bruno, omar), `-activity-1..4`, and `-support` (carla, diego, elena, ines, lucia).
- The `-support` conversations end with a user asking for human review. Several preceding assistant turns are flawed (see Observations).

### `embeddings/index.json.gz`
- Gzipped JSON: `{ "format": 1, "model": "text-embedding-3-small", "dimensions": 1536, "chunks": [{ "id", "documentId", "text", ... }] }`. Check its shape with `gunzip -c fixtures/embeddings/index.json.gz | head -c 500`.
- Lets a fresh checkout search without calling the OpenAI embeddings API. Restored by `npm run reset`; updated by `npm run ingest -- --export`. After changing documents or chunking, re-ingest and export, or the index will be stale.
- Model and dimensions must match the app config (`text-embedding-3-small`, 1536).

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| `documents/` | 80 source documents plus `manifest.json` (see `documents/AGENTS.md`) |
| `embeddings/` | Holds only `index.json.gz`; no separate AGENTS.md |

## Observations (seed conversations)
- `conv-ines-support`: assistant asserts "common to receive EUR 30 for a referral"; the corpus says referral rewards are not specified.
- `conv-elena-support`: assistant says "Transfer completed." while the user was only deciding whether to send EUR 25.
- `conv-lucia-support`: assistant says it could not complete a EUR 85 transfer and suggests "try again", a duplicate-payment risk if the transfer actually committed.
- `conv-carla-support`: assistant quotes the EUR 6 Aurora fee without the salary waiver.
- `conv-diego-support`: opaque "could not be completed" with no cause.
- Seed messages carry no recorded tool calls, so operators have no evidence of steps; do not invent any.

## For AI Agents

### Working In This Directory
- Do not edit fixtures to make behavior look better; they simulate the real corpus and history. Changes are a deliberate ingestion/data decision.
- `npm run reset` refuses to run while services are up and overwrites local activity from these files.
- Check `src/seed.ts`, `scripts/reset.ts`, and `scripts/ingest.ts` before assuming restore/export behavior.

### Testing Requirements
- After touching documents or the index: `npm run ingest`, then `npm test`; `ingest` and semantic search spend OpenAI quota.
- Validate JSON: `node -e 'JSON.parse(require("fs").readFileSync("fixtures/conversations.json"))'`.

### Common Patterns
- Document ids in the index (`documentId`) match `documents/manifest.json` ids.

## Dependencies

### Internal
- `src/seed.ts`, `scripts/reset.ts`, `scripts/ingest.ts`, `src/` ingestion and retrieval, `docs/contracts.md` (`/api/documents`, `/api/search`)

### External
- OpenAI `text-embedding-3-small` (only when re-embedding)

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
