# Banana Bank Technical Challenge

Banana Bank is a fictional bank with an AI assistant. You receive a working application with customer history and room for improvement. The challenge has two parts: assess and improve readiness for a Monday launch, then design and implement a useful, differentiating improvement to the agent or its agentic workflow. Read the [challenge brief](docs/challenge.md) ([PDF](docs/challenge.pdf)), investigate the product, and submit demonstrable improvements in a ZIP containing the complete project.

## Before you start

Read the challenge brief and **preserve your AI sessions from your first interaction**. Verify that you can export or retain the complete conversation in your chosen tool before starting work; see [AI session exports](#ai-session-exports). Download or clone the starter using the access arrangements in your invitation. A fork is optional; the deliverable is a ZIP.

## Quick start

Requirements: **Node.js 24 or newer** (Node 24 LTS recommended), npm, and one OpenAI project key with access to `gpt-6-luna` and `text-embedding-3-small`. The `.nvmrc` selects the recommended Node 24 major; it is not an upper version limit. No Docker, GPU, or database service is required. SQLite stores data locally. Node 24.4.1 and 26.10.0 have been tested on macOS arm64; Windows and Linux use the same commands but have not been validated on those platforms.

```sh
npm ci
npm run setup
```

`setup` creates `.env.local` from the example and initializes empty databases. Edit it:

```dotenv
OPENAI_API_KEY=your_project_key
OPENAI_CHAT_MODEL=gpt-6-luna
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
```

No OpenAI key or no credit? `.env.example` pins `MODEL_PROVIDER=openai`, the target configuration. For local development, set `MODEL_PROVIDER=auto` in `.env.local` (also the code default when the variable is unset). With the [Claude Code](https://claude.com/claude-code) CLI installed and logged in, `auto` answers chat with `claude -p --model haiku` when `OPENAI_API_KEY` is blank (logged once as `model_provider_auto`), and retries a call with it when OpenAI answers `429 insufficient_quota`, then skips OpenAI for 5 minutes (logged as `model_provider_fallback`). `MODEL_PROVIDER=claude-cli` forces it and `MODEL_PROVIDER=openai` disables it. `CLAUDE_CLI_BIN` and `CLAUDE_CLI_MODEL` pick the binary and model. A failed CLI call answers "claude-cli failed: is `claude` installed and logged in?" (or the cause it found). Claude has no embeddings, so under claude-cli document search is lexical (SQLite FTS5, BM25; the UI shows a "Score", not a "Similarity"); `/api/health` reports `modelProvider`, `searchMode` and `lastFallbackAt`.

You can also supply `OPENAI_API_KEY` as an environment variable. Environment variables take priority over `.env.local`, which takes priority over `.env`. One key serves both APIs. It is used only on the server; never commit it or place it in a parent-directory file.

```sh
npm run doctor
npm run dev
```

Open **http://127.0.0.1:3000**. This starts both the web application and bank API (port 4001); Ctrl+C stops both. `doctor` makes a small real model request and embedding request, consuming API quota. Accounts, manual transfers, documents, and support cases can be explored without a key; chat and semantic search require one. The supplied index contains real embeddings, so startup does not regenerate them.

## First-run check

This short walkthrough confirms that the environment is usable; it does not certify that the application meets the business requirements.

1. Run `npm run doctor` with your key configured. It should print a model reply and an embedding dimension count of 1536. A failure here concerns configuration, permissions, quota or connectivity; use the troubleshooting section below.
2. Run `npm run dev`, wait for the web service to be ready, then open http://127.0.0.1:3000. The first page may take longer to compile in development.
3. Select Lucía. Her overview should show two accounts. Open the document library and verify that documents load.
4. Open a new chat and ask `What accounts do I have?`. The assistant should respond. A turn can take tens of seconds and may make several model calls; the `Checking…` indicator does not by itself mean the request is stuck. Inspect a reported error or the terminal if it does not finish. Assess the correctness of its behavior as part of the challenge.
5. Select Marta. With fresh seed data, the operator view should list 17 support cases, including nine open and eight resolved cases.

If a service cannot start, or the model connection fails, report the command, error and Node/npm versions to the organizers without including credentials. Account, transfer or assistant behavior discovered after successful setup is part of your investigation; passing this walkthrough does not resolve it.

## Explore

Switch between eight fictional customers and two operators using the selector. Lucía has two accounts, Bruno can receive a transfer and see it in his activity, and Diego has a small balance. Marta and Pablo handle support cases. The selector is a test convenience, not production authentication: it is on in development (`npm run dev`) and off in production mode (`npm start`), see `DEMO_PERSONA_SWITCHER` below. Customer data and conversations remain separated by the selected context.

The seed contains 12 accounts, 47 conversations, and 17 support cases. The bank is authoritative for balances, movements, and operations. A separate application database stores conversations, runs, proposals, support cases, and the document index. Initial conversations are narrative fixtures; new operations traverse the actual application code and simulator.

**Work on the web application, agent and their integration with the bank.** The service in `simulator/` represents an external bank, not another application you are asked to improve. Its supported failure scenarios are part of the environment the application must handle. Disabling those scenarios or changing the bank's behavior does not demonstrate an application fix. Evaluation can replace it with an independent bank implementing the same [contract](docs/contracts.md).

Fresh setup and reset select the reproducible `intermittent` profile with seed `17`. While the bank is running, `npm run scenario -- normal` lets you establish a normal-response baseline; `npm run scenario -- intermittent 17` restores the initial profile. Switching profiles resets the scenario counter, not balances. Use the supported scenarios to investigate the application's behavior.

The document library contains **80 synthetic Markdown, HTML, and CSV documents**: policies, fees, FAQs, procedures, and historical versions. The exercise's document reference date is **24 September 2026**, independent of the date you run it. The entire ingestion pipeline is editable in this repository.

Existing installations: stop the services and run `npm run reset` to load the updated history. This deletes local activity and restores the supplied index; `setup` preserves an existing database. Save any evidence you need first.

## Commands

| Command | Effect |
|---|---|
| `npm run setup` | Creates missing configuration; seeds empty databases only |
| `npm run dev` | Starts both services in development mode |
| `npm run reset` | With services stopped, restores both databases and the supplied index; deletes local activity |
| `npm run ingest` | Reprocesses documents and replaces the index, reusing identical cached embeddings |
| `npm run ingest -- --export` | Also updates the portable index included in the repository |
| `npm run scenario -- normal` | Configures the running bank with normal responses |
| `npm run scenario -- intermittent 17` | Activates a reproducible sequence of transport incidents |
| `npm run scenario -- lost-response` | The next new operation receives an error after its effects are committed |
| `npm run typecheck` / `npm test` | Checks types and public invariants |
| `npm run build` | Creates the production build; run this before `npm start` |
| `npm start` | Starts both services using an existing production build |

For production mode, stop development services, run `npm run build`, then run `npm start`. Rebuild after changing application code. Development mode does not require a production build.

Production mode needs real secrets. The `.env.example` values are public development defaults, and with them `npm start` exits with status 1 before serving anything. Set `SESSION_SECRET`, `BANK_SERVICE_SECRET` and `BANK_ADMIN_SECRET` (in `.env.local` or the environment) to three different random values of at least 32 characters, for example the output of `openssl rand -hex 32` run once per variable. The bank must use the same `BANK_SERVICE_SECRET` as the app: `npm start` passes its environment to both, so set it once. `npm run build` does not need them.

Production mode has no persona selector. `DEMO_PERSONA_SWITCHER` controls it: unset, it is on outside production and off in production; `1` or `true` turns it on, any other value turns it off. With it off, `GET /api/people` and `POST /api/session` are taken out of the route table, so they answer like any absent route: without a session `401 {"error":"Select a person to continue."}`, as an unknown route does; with one, `404 {"error":"Route not found."}` for `people` and `405` with `Allow: GET, HEAD` for `POST session`, as for any path that only accepts `GET`. The page says "Choosing a person is turned off on this production server. Run `npm run dev` to try the demo." instead of showing the selector. A session cookie issued before the switch keeps working against the API (API only: the page needs `people` and shows the message). Setting it on with `npm start` makes the server refuse to start, because the selector lets anyone become anyone, operators included. There is no login yet, so production mode is for checking the build and the startup checks, not for the demo: use `npm run dev` to review the app.

Additional scenarios and contracts are in [contracts.md](docs/contracts.md). After changing ingestion code, run `npm run ingest`. After a reset, ingest again to restore your modified index. Changing embedding models requires regenerating the index.

## Project map

```text
app/                   Next.js web interface and API
src/transfers/         Transfer workflow: intents, approvals, authorization, dispatch, reconcile
src/accounts/          Customer dashboard and the accounts tool
src/assistant/         Responses loop, instructions, and the tool registry
src/conversations/     Conversations and messages
src/knowledge/         Corpus ingestion, embeddings, SQLite index, and search
src/support/           Support cases and the operator case view
src/identity/          People, signed session, and actor
src/platform/          Config, crypto, app DB, bank client, model gateway, HTTP, telemetry
src/server/            Composition root: route table, request handler, app seed
simulator/             External-bank simulator and ledger (test dependency)
fixtures/              Documents and initial index
scripts/               Startup, seed, reset, and utilities
submission/            Your supporting submission materials
```

You may change the application and its organization. Preserve the observable contract or supply an equivalent adapter: evaluation can connect your application to another bank instance. MCP is not required; tools are server functions calling the bank API.

## AI session exports

Save the complete challenge conversations from your chosen tools and put the original exports in `submission/ai-sessions/` or an optional `submission/ai-sessions.zip`. Include those files in the single delivery ZIP together with the complete project code for both parts and your video or alternative explanation. Use a native export or the relevant saved session files; you can ask your assistant to help collect and package them. Check that the exported files contain the full conversations, not a summary. Choose the format that works for you.

## Configuration and troubleshooting

`Refusing to start in production: Set … to random values …` (or `… Give … different values …`) means production mode (`npm start` or `next start`) found one of `SESSION_SECRET`, `BANK_SERVICE_SECRET` or `BANK_ADMIN_SECRET` unset, shorter than 32 characters, based on a development default (case and `-`, `_`, `.`, space ignored), or equal to another of the three. The line names the variables, never their values. Set each listed variable to its own random value, for example `openssl rand -hex 32`, and start again. Development mode (`npm run dev`) keeps the defaults.

`Refusing to start in production: Turn DEMO_PERSONA_SWITCHER off …` means production mode found `DEMO_PERSONA_SWITCHER` set to `1` or `true`. Unset it (or set it to `0`) and start again. When secrets are refused too, both problems are on the same line, secrets first. It also appears with `DEMO_PERSONA_SWITCHER` unset when `NODE_ENV` is set to anything other than `production` (for example `development` exported in your shell) while starting the built server: the build checks as production, but the switcher default follows the runtime `NODE_ENV`, so it turns on. Unset `NODE_ENV` (or set it to `production`) and start again.

`421` with `{"error":"Unknown host."}` means the request's `Host` header is not on the allowlist that blocks DNS rebinding: `127.0.0.1:<APP_PORT>`, `localhost:<APP_PORT>` and the comma-separated `ALLOWED_HOSTS` (see `.env.example`). Open the app at http://127.0.0.1:3000 or http://localhost:3000; if you serve it on another port, set `APP_PORT` to that port (the separate `npx next dev … --port` below included); behind a reverse proxy or a public name, add that name to `ALLOWED_HOSTS`. Production starts without `ALLOWED_HOSTS` and answers 421 to any other host, so a deployment under a domain must set it.

Optional settings are in `.env.example`. To move the bank port, update both `BANK_PORT` and `BANK_URL`. `DATA_DIR` and `BANK_DATA_DIR` can separate storage; both default to `.data/`. For separate startup, use `npm run bank` in one terminal and `npx next dev --webpack --hostname 127.0.0.1 --port 3000` in another; both must share `BANK_SERVICE_SECRET`.

OpenAI 401 usually means an invalid key; 403/model errors can mean missing project access; 429 indicates quota or rate limits. `doctor` isolates these checks from the UI and prints the provider that answered (`openai` or `claude-cli`). Search also needs a key: a missing key returns an explicit `OPENAI_API_KEY` configuration message, unless the claude-cli provider is active (then search is lexical). After changing `.env.local`, restart the services. Ensure ports 3000/4001 are free. `reset` refuses to clear data if it detects running challenge services. Services bind to localhost and never move real money.

On Windows, `better-sqlite3` 13.0.3 has a [reported installation issue](https://github.com/WiseLibs/better-sqlite3/issues/1516): `npm ci` may invoke `node-gyp` and fail when Python or C++ build tools are unavailable, including on Node 24. If this blocks setup, send the organizers the error and your Node/npm versions; an installation blocker is not part of the challenge.

`next-env.d.ts` and `.next/` are generated by Next.js and ignored by Git. `npm run typecheck` generates the required declarations before checking types, so it also works before your first development run.

The starter contains behavior worth investigating. Passing public tests does not mean it is ready for customers. Add checks that support your improvements. The invitation specifies the deadline, time budget, access arrangements, and submission channel.
