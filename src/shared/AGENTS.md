<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-10-10 | Updated: 2026-10-10 -->

# shared

## Purpose

The kernel every vertical builds on (plan §10, sub-phase 7a): the domain error model, the bank failure, the document reference date, and the three ports that every vertical's wiring fills (`Clock`, `Ids`, `UnitOfWork`). It holds no I/O and imports nothing outside `shared/` (enforced in `eslint.config.mjs`). In 7a nothing in the application throws these errors yet: 7b–7d move the throw sites onto them, with every status and message unchanged.

## Key Files

| File                       | Description                                                                                                                                                                                                                                                                                               |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `domain/errors.ts`         | `DomainError` (abstract; `kind`, `name` = class name, **no `status`**) and its five kinds: `NotFoundError` (`not_found`), `ConflictError` (`conflict`), `ForbiddenError` (`forbidden`), `BadRequestError` (`bad_request`), `UnavailableError` (`unavailable`). Statuses live in `platform/http/errors.ts` |
| `domain/bank-failure.ts`   | `BankFailure(reason, status, message)` (kind `bank`; keeps the bank's status and message as `BankError` did), `bankFailureKind(status)` (>= 500 `unreachable`, 404 `notFound`, else `rejected`), `bankFailureFrom(e)` for the bank adapters                                                               |
| `domain/reference-date.ts` | `referenceDate = '2026-09-24'`, the document reference date; `platform/config.ts` re-exports it, so the frozen `./config` export is unchanged                                                                                                                                                             |
| `ports/clock.ts`           | `Clock = { now(): Date }` (adapter `platform/runtime.ts:systemClock`; tests `fixedClock()`)                                                                                                                                                                                                               |
| `ports/ids.ts`             | `Ids = { uuid(): string }` (adapter `platform/runtime.ts:randomIds`; tests `sequentialIds()`)                                                                                                                                                                                                             |
| `ports/unit-of-work.ts`    | `UnitOfWork = { atomically<T>(step: () => T): T }` (adapter lands in 7b over `platform/db/statement.ts:atomically`)                                                                                                                                                                                       |

## For AI Agents

### Working In This Directory

- `shared/` imports nothing outside `shared/` (fixed-depth regex in `eslint.config.mjs`); `zod` is the only package a domain file may use. `shared/domain` follows the purity rules of every `domain/`: no `Date.now()`, no zero-argument `new Date()`, no `Math.random()`, no `crypto` global, and `node:crypto` only for `createHash`.
- `DomainError` must never get a `status` field: `sendMessage` treats any caught error with a `status` as a provider failure. Only `BankFailure` has one, as `BankError` did.
- No new kind without a throw site (plan §10.8). The 401s are transport and stay `HttpError`.
- Error messages are the exact text customers and the model see; `toErrorResponse` and the tool runner pass `e.message` through unchanged.

### Testing Requirements

- Unit tests: `domain/errors.test.ts` (message, name, kind, no status), `domain/bank-failure.test.ts` (classification and translation). `ports/*` are types only and `reference-date.ts` is a constant (covered by `public-surface.test.ts` through `./config`).

## Dependencies

### Internal

- None.

### External

- None (domain files may use `zod`).

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
