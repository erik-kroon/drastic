# Bank reconciliation signoff (3500)

## Current ownership

Application operations live in [application/banking/signoffs.ts](../src/application/banking/signoffs.ts), with shared dispatch in [capabilities](../src/application/capabilities/). The maintained DDL is [0001-schema.sql](../migrations/0001-schema.sql), [0002-integrity.sql](../migrations/0002-integrity.sql) and [0003-roles.sql](../migrations/0003-roles.sql).

## Historical implementation notes

The notes below record the superseded SQL implementation and its original validation. Migration filenames and statement-map instructions here are historical references, not installation steps or current ownership. Use the [API layout and replacement status](../README.md) and [local setup](../../../docs/local-development.md) for the current application.

### Scope and failure cases before implementation

This adds an operator attestation to one selected bank account's existing capacity reconciliation
and an existing source-coverage report. It does not create another reconciliation engine,
establish complete company/import coverage, waive unknowns, or change closing gates.

- Authorization precedes lookups; all references and evidence belong to the same book.
- Preparation must use current2000 coverage and1300 capacity reports for identical whole-period
  dates, currency, account, source revision and committed ledger cutoff. A nonzero residual,
  missing independent balance, declared-source gap, unknown bank family or stale snapshot blocks.
- The selected account must be explicitly declared by the latest evidenced closing inventory.
  Other source families remain outside the signoff; their unknowns cannot be cleared by it.
- Pin retained statement/evidence, active matches/allocation legs, inventory and report digests.
  Do not infer equal rows are identical or turn an empty inventory into a complete source family.
- Sign only the exact immutable preparation digest, with retained review evidence and rationale.
  Only an operator may sign. Preparation and reads remain available to scoped automation.
- Later inventory, source/match/unmatch, ledger, account, currency/profile or period changes make
  the saved signoff stale without editing it. Oversized live scope must leave old artifacts readable.
- Book locks serialize prepare/sign with source and ledger writers. Signoff, exact artifact bytes
  and idempotency receipt commit together. Same-key retries return historical receipts after current
  authorization; a new key cannot replace an existing signoff.
- Bound preparation history to200/book. Reuse existing coverage and reconciliation size bounds;
  refuse oversized artifact output without truncation. No posting, match or period write occurs.

### Implemented source

The selected flow is:

```text
operator inventory → saved source coverage ─┐
                                           ├→ exact preparation digest → operator signoff
saved capacity reconciliation ─────────────┘                               + evidence
                                                                           + exact JSON
later source / ledger / inventory change → historical signoff remains; currentness=false
```

1. Prepare with `{coverageReportId, reconciliationId}`. Both reports must describe the same
   account and whole accounting-period interval at the same current committed ledger cutoff.
   Preparation rejects stale dependencies, unresolved selected-account source controls, residuals,
   differences, missing boundaries and missing/unknown bank-family applicability. It does not
   recompute or mutate either report. Normal scoped actors can prepare through REST or MCP.
2. Read the immutable preparation and referenced reports. The plan pins the inventory, coverage,
   reconciliation, statement/evidence and active match/allocation digests, plus ledger/source
   revisions and the check version. Its digest binds the entire preparation including its limits.
3. An operator signs `{digest, version:1, evidenceId, rationale}`. The evidence must already exist
   in the same book. The SQL command rechecks live dependency currentness under the book lock.
   No ordinary MCP signing capability exists. There is no posting or technical-close effect.
4. Read saved preparation/signoff and download the exact canonical UTF-8 JSON `{plan,signoff}`.
   The saved artifact includes SHA-256 and byte length. `dependenciesCurrent` is separate from
   those immutable bytes. Discovery lists signed and unsigned preparations for reload recovery.

The latest0930 inventory must explicitly classify `bank_sources` as `required` with evidence;
old bank-only declarations without that family decision are not enough. The selected account
must be active, declared and free of2000 source-control gaps. Other accounts may still have
unresolved controls and other families may remain unknown: this signs **only the selected bank
account**, not the inventory as a whole. No unknown or unsupported family decision is changed.
The plan always says `reviewScope:selected_declared_bank_account`, `coverage:not_established`
and `financialCloseReady:false`. Existing source coverage, allocation, reconciliation and closing
functions/gates are unchanged. An operator's evidence is an attestation, not external certification.

Preparation uses the existing2000 dependency digest, which pins latest inventory, relevant
accounts/mappings/source revisions, statement/evidence identities, period/configuration and the
whole-book committed ledger sequence. Matching/unmatching advances source revision. This
conservative policy also marks signoffs stale after unrelated ledger posts. Account active status
is checked separately. A fresh preparation requires the current reports, not merely a previously
signed result. Read currentness returns false when the existing bounded dependency helper can
no longer capture the live scope; historical bytes remain readable.

At most200 preparations are retained per book, with no deletion/pruning route. This reuses the
existing coverage limits (100 known/declared accounts,200 statements,10000 retained rows) and
capacity-report limits (100 statements,1000 combined source/ledger rows,1000 allocation legs).
Signing refuses artifacts over1 MiB without truncation. The signed artifact contains digest-linked
basis and attestation, not copied full bank rows; the referenced immutable reports retain the
underlying rows, evidence links, controls and allocations.

Same-key replay returns the original result after current authority, even when it has become
historical. A new key with identical signoff input by the same actor returns the existing signoff;
changed rationale/evidence/actor conflicts. One preparation cannot acquire two signoffs. This
is receipt recovery, not a promise of currentness. Reads must inspect `dependenciesCurrent`.

### Root integration

New owned modules:

- `packages/contracts/src/bank-signoffs.ts`
- `apps/api/src/db/statements/bank-signoffs.ts`
- `apps/api/src/transport/http/routes/bank-signoffs.ts`
- `apps/api/migrations/3500-bank-reconciliation-signoffs.sql`

Root-owned changes:

1. Export `"./bank-signoffs": "./src/bank-signoffs.ts"` from the contracts package.
2. Import/add `BankSignoffApi` in shared `Api` and spread `BankSignoffCapabilities` in the
   shared capability catalog.
3. Import/spread `bankSignoffStatements` in `apps/api/src/db/query.ts`.
4. Import/compose `BankSignoffHandlers` in `apps/api/src/index.ts`.
5. Bind the three ordinary capabilities below. Signing is operator-only REST and intentionally
   absent from the MCP catalog. No adapter, service, UI or direct runtime table-write path is added.

```ts
bank_prepare_signoff: bindCapability(Capabilities.bank_prepare_signoff, "prepareBankSignoff", (input) => [
  scopeParameter(input.scope), input.idempotencyKey, JSON.stringify(input.input),
]),
bank_get_signoff: bindCapability(Capabilities.bank_get_signoff, "getBankSignoff", (input) => [
  scopeParameter(input.scope), input.id,
]),
bank_list_signoffs: bindCapability(Capabilities.bank_list_signoffs, "listBankSignoffs", (input) => [
  scopeParameter(input.scope),
]),
```

All routes use `/api/v1/entities/:entityId/books/:bookId`:

| Method/path                         | Handler                  | Result                      |
| ----------------------------------- | ------------------------ | --------------------------- |
| POST `/bank-signoff-plans`          | `prepareBankSignoff`     | `BankSignoffPlan`           |
| GET `/bank-signoff-plans`           | `listBankSignoffs`       | `BankSignoffList`           |
| GET `/bank-signoff-plans/:id`       | `getBankSignoff`         | `BankSignoffView`           |
| POST `/bank-signoff-plans/:id/sign` | `signBankReconciliation` | `BankReconciliationSignoff` |

POST commands use `Idempotency-Key`. SQL statements bind token then scope, key/input or ID as
shown in the contracts/statement modules. The new private tables are `bank_signoff_plans` and
`bank_reconciliation_signoffs`; runtime may execute only the four authenticated commands and
cannot write either table or call the currentness helper directly. Root owns optional Drizzle
maintenance mappings. No historical migration was changed;3500 was not applied.

### Verification boundary

Source review traced scoped authorization, book-lock serialization, matching report identities,
exact monetary controls, the current active-allocation report owner, immutable receipts/artifacts,
and selected-account-only limits. This is source reasoning, not observed runtime acceptance.

Pending authorized observations: cross-book report/evidence refusal; non-operator sign refusal;
missing/unknown bank-family declaration; different cutoffs/intervals/statements; nonzero residuals
or independent balance differences; stale preparation after import, allocation/unmatch, inventory
revision or posting; concurrent sign/sign and sign/post; same-key response-loss recovery; unchanged
historical bytes/hash;200-preparation bound; and stale-but-readable history after live bounds grow.
No tests, fixtures, migrations, database operations, browser work or external actions were run.
Owned-file `oxfmt --write` passed on the three new TypeScript modules and three touched domain documents. `oxlint` passed on the three new TypeScript modules with zero warnings/errors. Historical migration hashes remained unchanged. Root owns integrated typechecks and future runtime evidence.
