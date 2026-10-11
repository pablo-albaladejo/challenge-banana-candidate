# Part 1 evidence: before and after

Reproducible before/after evidence for the Part 1 headline fixes (409a1f3, 99659a1, 149bd39, 77ff01b, c58fe72). "Before" is the starter commit 726b592, "after" is main at dc39816. Everything below was observed; nothing is inferred.

## Method

- No model call. `OPENAI_API_KEY` was blank and `MODEL_PROVIDER=openai`. Transfers were driven over HTTP through `POST /api/actions` (`transfer_money`) and `POST /api/approvals/:id/confirm`. Both commits expose the same `/api/actions` path and executor, so the same request runs on each.
- Two isolated stacks, started with `node --import tsx scripts/dev.ts`: before (app 3400, bank 4401) and after (app 3300, bank 4301). Each had its own `DATA_DIR` and `BANK_DATA_DIR`, throwaway 32-character secrets and no `.env.local`. The before stack ran from a detached worktree of 726b592.
- Databases were seeded with `seedApp()` and `seedBank()` (not `npm run setup`, which copies `.env.example` to `.env.local`).
- Session cookie: `banana_actor=lucia.<hex HMAC-SHA256 of "lucia" with SESSION_SECRET>`, plus an `Origin` header equal to the app origin.
- Request body: `{"name":"transfer_money","arguments":{"fromAccountId":"acc-lucia","toAccountId":"acc-bruno","amountCents":1234,"concept":"<tag>"},"intentId":"<id>"}`.
- Bank operation counts and balances come from `GET <bank>/admin/snapshot` with the admin bearer secret.
- Scenario profile: `BANK_URL=http://127.0.0.1:<bank port> BANK_ADMIN_SECRET=<secret> npm run scenario -- lost-response`. `scripts/scenario.ts` targets `config.bankUrl`, so `BANK_URL` selects the bank.

## 1. Confirmation before execution (409a1f3)

Default bank profile: `intermittent`, seed 17, counter 0.

| Step                                 | Starter (726b592)                                                                                  | Main                                                                                                                                |
| ------------------------------------ | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/actions` `transfer_money` | 200 `{"status":"completed",...}`; executed at once. Bank operations 2 to 3; lucia 400750 to 399516 | 200 `{"status":"requires_confirmation","approval":{"id":...,"expiresAt":+10 min},"checks":[balance_after]}`; bank operations stay 2 |
| `POST /api/approvals/:id/confirm`    | not applicable                                                                                     | 200 `completed`; operations 2 to 3                                                                                                  |
| Second confirm of the same approval  | not applicable                                                                                     | 200 `completed`, `"replay":true`; operations stay 3                                                                                 |

## 2. Lost bank response (99659a1, 149bd39, c58fe72, 77ff01b)

### 2a. `npm run scenario -- lost-response`

The profile loses the response of the first new transfer after it is set; the bank has committed it.

| Step                                                  | Starter                                                                                                                                                                             | Main                                                                                                                            |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Transfer                                              | 200 `completed`. Attempt 1 committed, response lost; attempt 2 used a new reference and committed again. Operations 3 to 5 (two references), lucia 399516 to 397048 (debited twice) | `requires_confirmation`, then confirm returns 200 `completed` with `"replay":true`, one reference. Operations 3 to 4, one debit |
| Retry (same intent on starter, same approval on main) | 200 `completed` with a new reference: third payment, operations 5 to 6, lucia 395814                                                                                                | 200 `completed`, `"replay":true`, answered from the record; operations stay 4                                                   |

### 2b. Response lost on every attempt (ad hoc proxy)

With the stock profile the second attempt on main replays and succeeds, so `unknown` never appears. The proxy below forwards to the bank, then replaces the response of every `POST /v1/transfers` with a 504. The app's `BANK_URL` points at the proxy; snapshots read the bank directly. The proxy is an ad hoc script kept outside the repo.

| Step   | Starter                                                                                                                                  | Main                                                                                                                                                                                                                                                     |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Result | 200 `{"status":"failed","error":"Upstream request timed out"}`; intent stored `failed`. Operations 6 to 8, two references both committed | confirm returns 200 `{"status":"unknown","error":"The bank did not confirm this transfer. It will be checked with the bank before any retry."}`; intent `unknown`. One reference reused on both attempts (the proxy logged two drops). Operations 4 to 5 |
| Retry  | not run                                                                                                                                  | confirm returns 200 `completed`, `"replay":true`; intent goes `unknown` to `completed`, reconciled via `GET /v1/operations/:reference`, no new `POST` through the proxy. Operations stay 5                                                               |

### 2c. Seeded historic intent

`intent-historic-lucia` (the bank holds `ref-historic-lucia`, 8500, "Team dinner"):

| Starter        | Main                                                        |
| -------------- | ----------------------------------------------------------- |
| stays `failed` | `completed` after one `GET /api/dashboard` (reconciliation) |

## Proxy source

```js
// Forwards everything to the bank; POST /v1/transfers is committed upstream but the response is replaced by a 504 on EVERY attempt.
import http from 'node:http';
process.on('unhandledRejection', () => {});
const [listen, target] = process.argv.slice(2).map(Number);
http
  .createServer(async (req, res) => {
    let raw = '';
    for await (const c of req) raw += c;
    const up = await fetch(`http://127.0.0.1:${target}${req.url}`, {
      method: req.method,
      headers: Object.fromEntries(
        Object.entries(req.headers).filter(
          ([k]) => !['host', 'content-length', 'connection'].includes(k),
        ),
      ),
      body: req.method === 'GET' || req.method === 'HEAD' ? undefined : raw,
    });
    const text = await up.text();
    if (req.method === 'POST' && req.url === '/v1/transfers') {
      console.log('dropped response for', up.status, raw.slice(0, 60));
      res.writeHead(504, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Upstream request timed out' }));
      return;
    }
    res.writeHead(up.status, { 'Content-Type': 'application/json' });
    res.end(text);
  })
  .listen(listen, '127.0.0.1');
```

Run as `node lossy-proxy.mjs <listen port> <bank port>`, set `BANK_URL` of the app to the proxy, and set the profile to `normal` first so only the proxy loses responses.

## Caveats

- The model path was not exercised on either side. The assistant calling `transfer_money` was not run; the same tool executor was reached through `/api/actions`.
- The default bank profile is `intermittent` with seed 17. The first transfer in the confirmation scenario was not faulted.
- `lost-response` affects only the first new transfer after the profile is set (fault counter equals 1).
- Starter and main were run in separate stacks with separate databases, so absolute counts differ between columns; only the deltas within a column are comparable.
- Case 2b relies on the ad hoc proxy; it is not part of the repo.
