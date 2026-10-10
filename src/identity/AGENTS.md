<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-10-10 | Updated: 2026-10-10 -->

# identity

## Purpose

Who is calling: the static roster of people, the signed session cookie, the request actor and the same-origin check, plus the public `people` and `session` endpoints.

## Key Files

| File              | Description                                                                                                                                                                                                                                                                                                                                                |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `index.ts`        | Public surface: `actor`, `sameOrigin`, `person`, and the re-exported `HttpError`, `sign`, `equal`                                                                                                                                                                                                                                                          |
| `auth.ts`         | Re-exports `sign`, `equal` (`../platform/crypto.ts`) and `HttpError` (`../platform/http/http-error.ts`) for the frozen surface; `sessionToken(userId)` -> `id.sig`, `actor(request)` parses the `banana_actor` cookie into a `Person` or throws `HttpError(401)`, `sameOrigin(request)` (Origin vs Host, `Sec-Fetch-Site`). Frozen at `src/auth.ts` (shim) |
| `people.ts`       | Static roster: 8 customers (lucia, bruno, carla, diego, elena, hugo, ines, omar) and 2 operators (marta, pablo); `person(id)`. Frozen at `src/people.ts` (shim)                                                                                                                                                                                            |
| `http/people.ts`  | `listPeople` (`GET people`, public)                                                                                                                                                                                                                                                                                                                        |
| `http/session.ts` | `selectPerson` (`POST session`, public: sets the signed `banana_actor` cookie, `HttpOnly; SameSite=Strict`) and `currentSession` (`GET session`)                                                                                                                                                                                                           |

## For AI Agents

### Working In This Directory

- Identity comes only from the signed cookie via `actor()`; never trust a user id from the body or headers.
- `people` and `session` live here, not in `platform/http/`, because they are the identity feature's own endpoints (the roster and the cookie); `health` is the only platform endpoint.
- Things worth scrutinizing:
  - `auth.ts`: token has no expiry; `sameOrigin` passes when no `Origin` header is sent; default secrets in `../platform/config.ts` apply if env is unset.
  - Persona switching is unauthenticated by design: any visitor can become any person (including operators) via `session`.
- `sign`, `equal` and `HttpError` live in `../platform/` (`crypto.ts`, `http/http-error.ts`); this feature only re-exports them, so `src/auth`, `identity` and `platform` hand out the same class and functions. Features that only need `HttpError` import it from platform.

### Testing Requirements

- `auth.test.ts` (signed session, `sameOrigin`), `people.test.ts`; the endpoints through `app/api/[...path]/route.test.ts`.

### Common Patterns

- Errors surface as `HttpError(status, message)`; `../platform/http/errors.ts` maps them to JSON.

## Dependencies

### Internal

- `../platform` (`config`, `crypto`, `http/`), `../types`.

### External

- `node:crypto`, `zod`.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
