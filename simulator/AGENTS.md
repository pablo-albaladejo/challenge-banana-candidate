<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-10-09 | Updated: 2026-10-09 -->

# simulator

## Purpose

Stand-in for an **EXTERNAL bank** (Banana Bank core). It owns the ledger in its own SQLite file (`bank.sqlite` under `BANK_DATA_DIR`) and exposes the HTTP API described in `docs/contracts.md`. It is a test dependency, not part of the product.

> **DO NOT change this directory's behavior to fix application bugs.** Do not disable, soften, or special-case failure scenarios, loosen signature checks, or make the app read `bank.sqlite` directly. Evaluation may replace this service with an independent implementation of `docs/contracts.md`; the app must cope with the failures here (lost responses, 503s, slow replies, flaky status lookups). Fix the app, not the bank.

## Key Files

| File        | Description                                                                                                                                                                                                            |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `server.ts` | `node:http` server on `127.0.0.1:BANK_PORT` (default 4001). Routing, HMAC verification, zod body validation, error mapping. Seeds the DB on boot if `accounts` is empty. Started by `npm run bank` or `scripts/dev.ts` |
| `bank.ts`   | Ledger logic: `transfer`, `operationByReference`, `listAccounts`, scenario profiles (`profiles`, `setScenario`, `scenario`)                                                                                            |
| `db.ts`     | `bankDb()` / `closeBankDb()`: opens `bank.sqlite` (WAL, FK on, busy_timeout 5000), creates tables `accounts`, `operations`, `movements`, `scenario`                                                                    |
| `seed.ts`   | `seedBank()`: deterministic wipe and reseed in one transaction; also resets scenario to `intermittent`/17                                                                                                              |

## For AI Agents

### Working In This Directory

- Treat as read-only unless the task is explicitly about the simulator. If a test or scenario seems to need a change here, change the app instead.
- Auth on `/v1/*` (see `src/auth.ts`, `src/banking/client.ts`): headers `x-bank-actor`, `x-bank-time` (Unix ms, +-60 s), `x-bank-signature` = hex HMAC-SHA256 of `[method, req.url (path+query), actor, timestamp, rawBody].join('\n')` keyed with `BANK_SERVICE_SECRET` (default `banana-local-service`). Failure: 401 `Invalid actor context.`. Actor must be a known person.
- Auth on `/admin/*`: `Authorization: Bearer <BANK_ADMIN_SECRET>` (default `banana-local-admin`), else 403. Local test utility only; the customer app must not use it to complete or inspect operations.
- Body limit 32768 chars (413); malformed JSON or zod failure gives 400 `Invalid request data.`; unexpected errors give 500.

**Endpoints**

| Route                                    | Notes                                                                                                                                   |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /health`                            | No auth; `{ok,service:'banana-bank',version:1}`                                                                                         |
| `GET /v1/accounts`                       | Actor's accounts                                                                                                                        |
| `GET /v1/contacts`                       | Other users' accounts (`id,userId,label,iban,name`)                                                                                     |
| `GET /v1/movements`                      | Up to 100 actor movements, newest first                                                                                                 |
| `POST /v1/transfers`                     | Body `{fromAccountId,toAccountId,amountCents,concept<=200,reference 1-120}`, strict (extra keys rejected). Returns operation + `replay` |
| `GET /v1/operations/:reference`          | Actor-scoped; 404 if absent                                                                                                             |
| `GET /v1/operator/customer?id=`          | Operator role only (403 otherwise); 404 for unknown customer                                                                            |
| `POST /admin/scenario` `{profile,seed?}` | Sets profile; resets `counter` and `read_failures` to 0; seed defaults 17. Balances untouched                                           |
| `POST /admin/reset`                      | Runs `seedBank()`                                                                                                                       |
| `GET /admin/snapshot`                    | Dumps accounts, operations, movements, scenario                                                                                         |

**Ledger semantics (`bank.ts#transfer`)**

- Only `customer` role may transfer (403 for operators). Idempotency key is `(userId, reference)` (`UNIQUE` in schema).
- Same key + identical `from/to/amount/concept` returns the stored operation with `replay:true`, **no counter increment, no fault**. Same key + different payload gives 409.
- Validation order for new keys: source owned by actor (else 403), destination exists and differs (400), amount safe integer in 1..10,000,000 (400), funds sufficient (422). Rejections do not advance the scenario counter.
- A valid new transfer increments `scenario.counter`, then writes both balance updates, the operation, and two movements (`Transfer · <concept>`) in one SQLite transaction. `balanceCents >= 0` is a CHECK constraint.

**Scenario profiles** (counter counts only valid new transfers; queries never count)

| Profile            | Behavior                                                                                                                                                     |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `normal`           | No faults                                                                                                                                                    |
| `intermittent`     | Fault when `(counter + seed) % 4 === 0`: commits, then returns 504 `upstream_timeout`. Seed 17 hits the 3rd new op, then every 4th. Default after seed/reset |
| `reject-before`    | 1st new op: nothing committed, 503 `temporarily_unavailable`                                                                                                 |
| `lost-response`    | 1st new op: committed, 504 `upstream_timeout`                                                                                                                |
| `slow-response`    | 1st new op: committed, response delayed 2600 ms, then 200                                                                                                    |
| `read-unavailable` | 1st new op: committed + 504; sets `read_failures=1`, so the next `GET /v1/operations/:ref` returns 503 once, later lookups succeed                           |

**Seed data**: customers lucia, bruno, carla, diego, elena, hugo, ines, omar (ids from `src/people.ts`; operators marta, pablo). Accounts `acc-<id>`, plus `acc-<id>-savings` for even-indexed customers. Diego is pinned to 7500 cents. Two historic completed ops exist: `ref-historic-lucia` (8500, to bruno) and `ref-historic-elena` (2500, to hugo), both 2026-09-23.

### Testing Requirements

- `npm test` imports `seedBank`, `transfer`, `setScenario` etc. directly against a temp dir. Any change here can break `tests/invariants.test.ts` (reset determinism, no-money-creation, idempotency, fault scenarios).
- Manual: `npm run bank`, then `npm run scenario -- <profile> [seed]`.

### Common Patterns

- Faults are returned from `transfer()` as `fault` and translated into HTTP responses in `server.ts`; money has already moved for every fault except `reject-before`.
- `seedBank()` is idempotent and deterministic; `npm run reset` and `/admin/reset` both use it.

## Dependencies

### Internal

- `../src/config` (ports, secrets, `bankDataDir`), `../src/auth` (`sign`, `equal`, `HttpError`), `../src/people`, `../src/types`

### External

- `better-sqlite3`, `zod`, Node `http`/`crypto`

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
