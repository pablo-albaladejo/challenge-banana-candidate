<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-10-10 | Updated: 2026-10-10 -->

# shared

## Purpose

The kernel every vertical builds on (plan §10, sub-phase 7a): the domain error model, the bank failure, the document reference date, the policy rules table, the prompt fence, and the three ports that every vertical's wiring fills (`Clock`, `Ids`, `UnitOfWork`). It holds no I/O and imports nothing outside `shared/` (enforced in `eslint.config.mjs`). In 7a nothing in the application throws these errors yet: 7b–7d move the throw sites onto them, with every status and message unchanged.

## Key Files

| File                       | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `domain/errors.ts`         | `DomainError` (abstract; `kind`, `name` = class name, **no `status`**) and its five kinds: `NotFoundError` (`not_found`), `ConflictError` (`conflict`), `ForbiddenError` (`forbidden`), `BadRequestError` (`bad_request`), `UnavailableError` (`unavailable`). Statuses live in `platform/http/errors.ts`                                                                                                                                                                                                                                                       |
| `domain/bank-failure.ts`   | `BankFailure(reason, status, message)` (kind `bank`; keeps the bank's status and message as `BankError` did), `bankFailureKind(status)` (>= 500 `unreachable`, 404 `notFound`, else `rejected`), `bankFailureFrom(e)` for the bank adapters                                                                                                                                                                                                                                                                                                                     |
| `domain/reference-date.ts` | `referenceDate = '2026-09-24'`, the document reference date; `platform/config.ts` re-exports it, so the frozen `./config` export is unchanged                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `domain/policy-rules.ts`   | `POLICY_RULES`: every policy value in force (monthly fee per product, with the Aurora waiver; internal-transfer fee; per-transfer limit; the unpublished topics), each with `documentId`, `version`, `validFrom`/`validTo` and the verbatim `quote` of its source in `fixtures/documents/`. `policyFor(kind, product, onDate = referenceDate)` (in-force entry; a product entry beats a product-null one), `productOfAccount(label)` (trimmed, case-insensitive: `'Aurora account'` → `aurora`; savings → `null`). Pure data: the drift guard lives in the test |
| `domain/fence.ts`          | `fence(label, text)` wraps externally authored text as `<<<label>>>…<<<end label>>>`: it throws on a label outside `/^[\w .=-]+$/`, NFKC-normalises the text, strips zero-width and bidi controls, then turns every `<<<` into `[fence]`; it refuses `Fenced` input at compile time; `Fenced` is the branded result, so prompt builders that take `Fenced` reject raw strings at compile time                                                                                                                                                                   |
| `ports/clock.ts`           | `Clock = { now(): Date }` (adapter `platform/runtime.ts:systemClock`; tests `fixedClock()`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `ports/ids.ts`             | `Ids = { uuid(): string }` (adapter `platform/runtime.ts:randomIds`; tests `sequentialIds()`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `ports/unit-of-work.ts`    | `UnitOfWork = { atomically<T>(step: () => T): T }` (adapter lands in 7b over `platform/db/statement.ts:atomically`)                                                                                                                                                                                                                                                                                                                                                                                                                                             |

## For AI Agents

### Working In This Directory

- `shared/` imports nothing outside `shared/` (fixed-depth regex in `eslint.config.mjs`); `zod` is the only package a domain file may use. `shared/domain` follows the purity rules of every `domain/`: no `Date.now()`, no zero-argument `new Date()`, no `Math.random()`, no `crypto` global, and `node:crypto` only for `createHash`.
- `DomainError` must never get a `status` field: `sendMessage` treats any caught error with a `status` as a provider failure. Only `BankFailure` has one, as `BankError` did.
- No new kind without a throw site (plan §10.8). The 401s are transport and stay `HttpError`.
- Error messages are the exact text customers and the model see; `toErrorResponse` and the tool runner pass `e.message` through unchanged.
- `POLICY_RULES` never reads the documents: when a policy document changes, update the entry (value and quote) until `policy-rules.test.ts` is green again. Archived versions stay out of the table.

### Testing Requirements

- Unit tests: `domain/errors.test.ts` (message, name, kind, no status), `domain/bank-failure.test.ts` (classification and translation), `domain/policy-rules.test.ts` (drift guard over `fixtures/documents/`: each quote appears exactly once in its document's `## Terms and exceptions`, line 3 states its version and dates, every value of the rule is stated at its position in the quote (`monthly fee … is EUR x`, `limit per transfer is EUR x`); one entry per product and kind, 29 entries, no overlapping validity; the Aurora notice and FAQ still agree but stay out of the table; plus `policyFor` and `productOfAccount`), `domain/fence.test.ts` (wrapping, neutralisation after NFKC and zero-width/bidi stripping, an unforgeable closing tag, the label check, the `Fenced` brand, no double fencing). `ports/*` are types only and `reference-date.ts` is a constant (covered by `public-surface.test.ts` through `./config`).

## Dependencies

### Internal

- None.

### External

- None (domain files may use `zod`).

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
