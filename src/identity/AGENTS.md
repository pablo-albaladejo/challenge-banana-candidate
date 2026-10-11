<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-10-10 | Updated: 2026-10-11 -->

# identity

## Purpose

Who is calling: the static roster of people, the signed session cookie, the request actor and the same-origin check, plus the public `people` and `session` endpoints.

Hexagonal vertical (plan §10, 7d.4): `application/` (ports, use cases; no services), `infrastructure/` (the roster and the HMAC signer), `entry-points/` (wiring, http, legacy). No `domain/`: the only rules are the signature check and the roster lookup, and the signature needs `crypto`, which the pure layers may not import, so it lives behind the `SessionTokens` port.

## Key Files

| File                                                 | Description                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `index.ts`                                           | The public surface, re-exported from `entry-points/` only: `identity()` (the lazy `IdentityApp` graph), the guard `actor`/`sameOrigin`, and the handlers `listPeople`, `selectPerson`, `currentSession`, and `personaSwitcherEnabled` (the `enabled` check `src/server/routes.ts` puts on `people` and POST `session`). Not `sessionToken` (no vertical may mint a session) and not the roster                   |
| `application/ports/people-directory.ts`              | `PeopleDirectory`: `all()` in roster order, `find(id)`                                                                                                                                                                                                                                                                                                                                                           |
| `application/ports/session-tokens.ts`                | `SessionTokens`: `issue(userId)`, `verify(token)` → the user id when the signature is valid, else `undefined`. The token carries the id only, never a role                                                                                                                                                                                                                                                       |
| `application/use-cases/verify-session.ts`            | `{ token }` → the roster `Person`, or `undefined` for a bad signature or an id outside the roster. The role always comes from the directory                                                                                                                                                                                                                                                                      |
| `application/use-cases/start-session.ts`             | `{ userId }` → `{ person, token }`; `BadRequestError('Unknown person.')` (400, same text) and no token for an id outside the roster                                                                                                                                                                                                                                                                              |
| `application/use-cases/{list-people,find-person}.ts` | `()` → the roster; `{ id }` → one person or `undefined` (what transfers' `CustomerDirectory` and support's `People` are wired to)                                                                                                                                                                                                                                                                                |
| `infrastructure/people-roster.ts`                    | Static roster: 8 customers (lucia, bruno, carla, diego, elena, hugo, ines, omar) and 2 operators (marta, pablo), each `{ id, name, role, initials, color }`; `people` is `readonly Person[]`, frozen with every entry (assignments throw), `person(id)` and the port object `peopleRoster`. The `src/people.ts` shim re-exports this file directly, so the simulator loads the roster only                       |
| `infrastructure/hmac-session-tokens.ts`              | `hmacSessionTokens`: `issue` → `id.hex(HMAC-SHA256(id, config.sessionSecret))` (secret read at call time; no expiry, no nonce); `verify` splits on `.`, takes the first two parts and compares the signature with `platform/crypto` `equal` (`timingSafeEqual`)                                                                                                                                                  |
| `entry-points/dependencies.ts`                       | `wireIdentity()` builds the four use cases; `identity()` is the per-process singleton. No overrides (no use case reads the clock or ids) and no `internals`                                                                                                                                                                                                                                                      |
| `entry-points/http/session-guard.ts`                 | `actor(request)`: reads the `banana_actor` cookie, `HttpError(401, 'Select a person to continue.')` when absent or empty, else `identity().verifySession`, `HttpError(401, 'Invalid session.')` when it resolves no one. `sameOrigin(request)`: `HttpError(403, 'Origin not allowed.')` on `Sec-Fetch-Site: cross-site` or an Origin unlike Host                                                                 |
| `entry-points/http/persona-switcher.ts`              | `personaSwitcherEnabled()` (P0-7: `featureFlags.demoPersonaSwitcher`, read per request; off, the route table drops `GET people` and `POST session`, so they answer like absent routes: 401 without a session, then 404, or 405 `Allow: GET, HEAD` for `POST session`) and `requirePersonaSwitcher()` (defence in depth in both handlers: `HttpError(404, 'Route not found.')` when off, before the body is read) |
| `entry-points/http/people.ts`                        | `listPeople` (`GET people`, public; `requirePersonaSwitcher()` first)                                                                                                                                                                                                                                                                                                                                            |
| `entry-points/http/session.ts`                       | `selectPerson` (`POST session`, public: `requirePersonaSwitcher()` first, then the body parsed, then `StartSession`; sets exactly `banana_actor=<token>; Path=/; HttpOnly; SameSite=Strict`) and `currentSession` (`GET session`, echoes the actor)                                                                                                                                                              |
| `entry-points/legacy.ts`                             | `sessionToken` (any id, known or not) for the `src/auth.ts` shim only; lint forbids the identity index from re-exporting it and other verticals from deep-importing it. The shim takes `sign`, `equal` and `HttpError` straight from `platform/` and `actor`/`sameOrigin` from `http/session-guard.ts`                                                                                                           |

## For AI Agents

### Working In This Directory

- Identity comes only from the signed cookie via `actor()`; never trust a user id from the body or headers. The role is looked up in the roster, never read from the cookie.
- The two 401s and the 403 are transport and stay `HttpError` in `session-guard.ts`; `StartSession` throws `BadRequestError`, which `platform/http/errors.ts` answers as the same 400.
- `server/handle.ts` (the composition root) calls `sameOrigin` and `actor`, after `platform/http/trusted-host.ts` has refused any `Host` outside the allowlist (P0-5: a rebound page sends a matching `Origin` and `Host`, which `sameOrigin` alone accepts); `platform/` never imports this vertical.
- Rank 0: value-imports no other vertical.
- Lint (`eslint.config.mjs`): identity is a layered vertical, so `index.ts` re-exports only `./entry-points/` (types allowed), and never `./entry-points/legacy` (`sessionToken`); `src/server/` reaches it only through the index. The seed does not need it.
- Things worth scrutinizing:
  - The token has no expiry and no nonce, and `verify` ignores any segment after the signature; `sameOrigin` passes when no `Origin` header is sent; default secrets in `../platform/config.ts` apply if env is unset.
  - Persona switching is unauthenticated by design: any visitor can become any person (including operators) via `session`. `DEMO_PERSONA_SWITCHER` (see `../platform/config.ts`) takes `people` and POST `session` out of the route table, so they answer like absent routes (401 without a session; with one, 404 for `people` and 405 for `POST session`, as for any GET-only path); it is on by default outside production, off by default in production, and production refuses to start with it on. Operators stay selectable while it is on: the demo reviews both roles. Real login (P0-7 effort L, with P2-13) is still open. Turning the switcher off does not revoke existing cookies: `actor()` still accepts them (API only: the page needs `people`, so it shows the switcher-off message).

### Testing Requirements

- `entry-points/http/session-guard.test.ts` (the actor and every rejection with its exact text, the roster role, `sameOrigin` incl. a non-web scheme on the same host), `infrastructure/hmac-session-tokens.test.ts` (format, determinism, secret at call time, the constant-time compare spied on `timingSafeEqual`), `infrastructure/people-roster.test.ts` (the exact roster, and that it cannot be mutated), `application/use-cases/{verify-session,start-session}.test.ts`, `entry-points/legacy.test.ts`, `entry-points/http/persona-switcher.test.ts` (the flag at call time, the 404 when off), `entry-points/http/{people,session}.test.ts` (each handler refuses with 404 when off, `selectPerson` before reading the body); the frozen shims in `../auth.test.ts` and `../people.test.ts`; the endpoints and the exact `Set-Cookie` through `app/api/[...path]/route.test.ts`, including, with the switcher off, every gated answer compared with a real route anonymously and with a session (status, body, `Allow`, `Set-Cookie`), no cookie, body never read, an existing session still resolving, and the production default reaching the route.

### Common Patterns

- Use cases take one object (`{ token }`, `{ userId }`, `{ id }`); ports are typed in `application/ports/`.

## Dependencies

### Internal

- `../platform` (`config`, `crypto`, `http/`), `../shared` (`BadRequestError`), `../types`.
- Consumed by `../server/handle.ts` (`actor`, `sameOrigin`), `../server/routes.ts` (the handlers), `../transfers` and `../support` (`identity().findPerson`), the `../auth.ts` shim (`http/session-guard.ts`, `legacy.ts`; tests take `sessionToken` from it) and the `../people.ts` shim (`infrastructure/people-roster.ts`).

### External

- `zod` (`node:crypto` only through `../platform/crypto.ts`).

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
