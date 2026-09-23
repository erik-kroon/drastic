# Synthetic tax-account register and GL controls — VAT-03 subset

This document records the3800 baseline. For the additive4100 exact matching/unmatch and v2
control consumer, see [TAX-ACCOUNT-MATCHING.md](TAX-ACCOUNT-MATCHING.md).3950 owns the shared
closing dependency integration; neither later packet rewrites3800 migration or artifact bytes.

Status: implemented source; forward3800 remains unapplied. Database, HTTP, concurrency and
independent arithmetic behavior have not been exercised.

## Selected bounded path

This slice takes the authorized statement/register plus complete selected-account GL-control
path. It does **not** add row-to-posted-line links. Such links need an owning correction,
unlink and effective-capacity protocol across existing register consumers. A guessed link
or a reversed line marked reconciled would be less safe than an explicit unmatched result.

```text
operator + source/review evidence + exact statement
  stable source account → statement identity → stable event identities
  exact opening + signed rows = closing

selected account + whole statement interval
  all retained statements/events + every GL line through interval end
  exact source/GL rollforwards + missing/unknown/unmatched diagnostics
  immutable control JSON bytes + separate live dependency status
```

No source event creates a voucher, payment, bank match, taxable-activity fact, VAT return
settlement or tax-filing state. Classification does not assert legal tax treatment.

## Source capture and identity

`recordTaxAccountStatement` requires current operator authority, a native synthetic book,
explicit `recordClass: "synthetic"`, exact book currency/scale and
`balanceConvention: "debit_minus_credit"`. The convention is a caller-reviewed synthetic
source assertion. No sign inversion, exchange rate, account role or actual-company tax rule
is inferred.

The input retains selected account ID, stable `sourceAccountKey` and `statementKey`, source
evidence/locator, review evidence/rationale, inclusive interval, signed opening/closing and
all rows. Each row has its stable `eventKey`, date, exact signed minor units, description and
explicit classification: unknown, tax charge, tax credit, interest, payment, transfer or other.
Classification does not silently determine the sign or imply a taxable sale or purchase.

Capture validates `opening + sum(all rows) = closing` exactly. A mismatch is refused; no
balancing or missing event is invented. Empty rows are allowed only when opening equals
closing. Every event date must be within its source interval.

The immutable source mapping binds one source identity to one selected account in the book.
Statement keys are unique per source account. Event keys are unique across that account's
statements. The same source evidence hash/locator cannot be recaptured under another statement
key on that account. Stable generated statement/event IDs survive retries and reads.

The book barrier serializes concurrent capture. Exact original-key replay returns before
new-state admission checks. A new key with the same statement identity and identical input
returns the existing body and original review identity; changed content conflicts. Duplicate
event/source-component identities conflict rather than creating another observation.
Statements, mappings, event identities and controls have immutable triggers and private tables.
Scoped foreign keys bind statement evidence and event parent/account relationships.

Bounds:20 source accounts,200 statements,10000 retained events per book,1000 rows per statement,
200 controls,5000 complete selected-account GL lines through the report end,366-day source
and control intervals,38-digit signed source amounts and8MiB retained control artifacts.
No list or capture silently truncates these inventories.

## Actual control consumer

`createTaxAccountControl` captures the exact account and date interval under the book lock.
It includes every intersecting retained statement and refuses intervals that cut through a
statement. Unknown classifications remain visible and do not remove their amounts.

Every selected-account posted GL line through the selected end date and current committed
book sequence is retained, including all pre-start lines needed to reconstruct opening.
Lines retain voucher/line IDs, ordinal, sequence, posting date, signed/debit/credit amounts,
description, posting purpose, corrected-voucher identity and known reversal IDs at capture.
Original and reversing journal lines stay separate actual ledger contributions. Neither is
marked reconciled or removed from the ledger rollforward.

Controls retain exact GL opening, movement and closing; statement/event rows; source interval
gaps, overlap pairs and consecutive-balance breaks. Source opening/movement/closing and their
GL differences are null when source continuity is unavailable. Missing sources are never
reported as known-zero sources. When an unbroken non-overlapping chain exists, the source
rollforward uses its retained exact amounts, independently of the GL sums.

Every retained source event and every selected-account GL line remains explicitly unmatched.
Unknown classifications have a separate ID list. Equal aggregate balances cannot hide
unmatched or offsetting rows. Output always says `reconciled: false`,
`coverage: "not_established"`, `financialCloseReady: false` and `taxReturnEffect: "none"`.
`row_matching_unavailable` and `coverage_unestablished` remain explicit diagnostics even if
all differences happen to be zero. Inactive accounts remain readable and produce a diagnostic.

Control JSON is canonicalized and stored with SHA-256 and byte length. Physical constraints
require the retained UTF-8 bytes to match both stored byte length and hash. Historical reads return
those exact bytes without recalculating the snapshot. Live currentness compares selected
source identities/digests, account metadata, source mapping and book profile/currency/writer
metadata. Whole-book committed sequence conservatively stales the control after any new
posting or correction. New overlapping/intersecting sources also stale it. Original-key
control replay still returns the historical body.

## Limits and dependency integration

This is not full VAT-03, source completeness, legal tax-account registration, tax-return
settlement, payment initiation, provider ingestion, row matching or financial-close readiness.
No source reclassification, replacement, withdrawal or row-unlink workflow is supplied in
this slice. Erroneous statements remain retained and unresolved rather than silently edited.

Root assigned forward3950 integration to the shared dependency owner. It must include
statement/control identities in VAT dependency digests and represented tax-family blockers,
without counting tax-account statements as VAT facts. Existing `sourceCount` semantics stay
unchanged. No shared closing helper is changed by3800. This integration and its shared
contracts remain a separate owner gate, not a claimed property of the domain-local migration.

## Files and shared composition

- `migrations/3800-tax-account-register.sql`
- `src/db/statements/tax-account.ts` — `taxAccountStatements`
- `src/transport/http/routes/tax-account.ts` — `TaxAccountHandlers`
- `../../packages/contracts/src/tax-account.ts` — `TaxAccountApi`, `TaxAccountCapabilities`

Root reports shared API composition wired in source. The required bindings are:

1. Export `./tax-account: ./src/tax-account.ts` from the contracts package.
2. Add `TaxAccountApi` to the shared API and `TaxAccountHandlers` to API layer composition.
3. Import/spread `taxAccountStatements` in `src/db/query.ts`.
4. Import/spread `TaxAccountCapabilities` in shared capability definitions and bind:

| Capability                    | Query                      | Parameters after token                                                           |
| ----------------------------- | -------------------------- | -------------------------------------------------------------------------------- |
| `tax_account_get_statement`   | `getTaxAccountStatement`   | `scopeParameter(input.scope), input.id`                                          |
| `tax_account_list_statements` | `listTaxAccountStatements` | `scopeParameter(input.scope)`                                                    |
| `tax_account_create_control`  | `createTaxAccountControl`  | `scopeParameter(input.scope), input.idempotencyKey, JSON.stringify(input.input)` |
| `tax_account_get_control`     | `getTaxAccountControl`     | `scopeParameter(input.scope), input.id`                                          |
| `tax_account_list_controls`   | `listTaxAccountControls`   | `scopeParameter(input.scope)`                                                    |

Statement capture/classification is operator-only REST and intentionally absent from ordinary
MCP. Routes live under `/v1/entities/:entityId/books/:bookId/tax-account`: POST/list GET
`/statements`, GET `/statements/:id`, POST/list GET `/controls`, GET `/controls/:id`.
The existing Effect query boundary owns the application transition. No pass-through service
or second runtime was added.

## Source review and checks

Source review compared immutable evidence and exact command replay owners, bank's active
capacity/reversal admission, source-coverage gap controls, commerce effective allocations and
subledger control snapshots. Reviewed failure paths include cross-book/account/evidence
identities, repeated source/event keys, renamed duplicate evidence, changed-input retries,
inactive accounts, unsupported profile/currency/convention, out-of-range dates, inconsistent
opening/movements/closing, empty statements, unknown classifications, source gaps/overlaps,
whole-statement interval refusal, full opening-line coverage, reversing journals, offsetting
unmatched movements, bounds, snapshot-byte preservation and later-dependency staleness.
These are source-review findings, not executed scenarios.

Owned TypeScript Oxlint passed with zero warnings/errors. Owned Oxfmt and `git diff --check`
passed. Shared API/contracts type checks remain root-owned. No tests, fixtures, browser work,
SQL/runtime execution, migration application, external actions, commits or deployment occurred.

Suggested plan05 wording: “Forward3800 adds an evidence-backed synthetic tax-account
statement/event register with stable duplicate-refusing identities and exact source balance
validation. Retained controls include all selected-account GL lines through period end,
source gaps/overlaps, unknown classifications, all unmatched items and exact differences.
Matching, source completeness, tax settlement, legal applicability and close readiness remain
unavailable. This is the bounded VAT-03 register/control subset, not full VAT-03 acceptance;
migration and runtime proof remain open.”

## Unknown-event classification resolution

Forward6700 provides a one-shot operator review for originally unknown events. It does not
rewrite the statement or event. Use the event classification GET to distinguish the recorded
label from the effective reviewed label. Known classifications cannot be revised by this
command. New matching captures and controlv3 consume the immutable resolution; old artifacts
and matching capacity remain unchanged. See [the selected contract and implementation](TAX-ACCOUNT-CLASSIFICATION.md).
