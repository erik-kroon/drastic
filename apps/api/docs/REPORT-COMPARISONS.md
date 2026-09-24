# Saved report comparisons (4600)

## Existing owner and failure cases before implementation

0120 retains synthetic trial-balance headers and every frozen account line.3400 adds movement
paging for one report/account and saved-header discovery. Neither compares two saved snapshots.
The latest0120 header omits currencyScale; live book scale is mutable, so old scale cannot be
safely inferred. Root approved only a forward prepare_report replacement to capture scale in new
headers. Historical bytes/replay remain unchanged; comparisons reject missing historical scale.

- Authorize the same book before reading either saved ID. Reject foreign/unknown IDs, unsupported
  report kind, missing retained scale and currency/scale mismatch. Never consult current book scale.
- Compare stored account lines only: no live account inventory, voucher query or recalculation.
  Keep frozen labels, report headers/IDs, full snapshot digests, intervals and committed cutoffs.
- Union stable account identities. Same code/name on different IDs is not one account. Missing side
  is null, never a manufactured zero. Per-account differences require both saved sides.
- Preserve signed formulas: movement=debit-credit; closing=opening+movement; difference=right-left.
  Different intervals/cutoffs are diagnostic arithmetic, not statutory/prior-year comparability.
- Full-side totals cover all retained lines, not only the page. Aggregate difference is unavailable
  if either side lacks any union account; do not imply absent representation is zero.
- Support at most10000 complete lines per report and100 union accounts/page. Refuse oversized
  inputs before hashing/aggregating rather than return partial financial totals or hidden truncation.
  Every account in an accepted pair remains discoverable in stable identity order.
- Cursor pins both report IDs/order and an actual union account. Reject malformed, switched-pair,
  cross-book and absent-anchor cursors. Later posts/renames cannot change any page or source digest.
- Read-only comparison writes no rows or receipts and has no close, opening, transfer, legal or
  filing authority. Do not label earlier postings as reviewed opening balances.
- New prepare_report differs from0120 only by retained scale; preserve every guard, lock, replay,
  line formula and receipt. No historical backfill or book metadata change.

## Implemented read contract

`GET /api/v1/entities/:entityId/books/:bookId/report-snapshots/:id/compare/:otherId`
uses `id` as the left snapshot and `otherId` as the right snapshot. MCP `reports_compare`
accepts `{scope,leftReportId,rightReportId,after?}`. Neither transport accepts live date filters,
account-label matching, rates, opening adjustments or amounts.

Both sources must be saved `trial_balance_v1` reports in the authorized book, with retained equal
currency and scale. Missing scale is `UnsupportedProfile`; cross-book/unknown report IDs are
`NotFound`. Different intervals and cutoffs are allowed only as explicit saved-snapshot arithmetic.
`sameInterval` and `sameCutoff` expose the axes, not financial or statutory comparability approval.
Comparing a report with itself is supported and produces zero differences on its represented rows.

Every page carries both complete frozen headers (IDs, dates, cutoffs, currency, warnings and
original count/totals) and deterministic full snapshot digests. The digest is:

```text
digest({header: savedHeader,
        lines: [{accountId, digest: digest(savedLine)}, ... ordered by accountId COLLATE "C"]})
```

It is computed only from retained immutable data; no new snapshot row, receipt, artifact, current
account list or voucher recalculation is created. `digestScope:saved_header_and_account_lines`
is explicit. This is a comparison identity, not a retroactively inserted signature on an old report.

The union aligns stable account IDs, never a guessed code/name equivalent. Each item contains:

- `presence`: `both`, `left_only`, or `right_only`.
- `left`/`right`: full frozen account line and exact `movementMinor=debitMinor-creditMinor`, or null.
- `labelsChanged`: whether frozen code/name changed, or null when a side is missing.
- `difference`: right minus left for opening, debit, credit, signed movement and closing, or null
  when a side is missing. No absent source representation is silently converted to zero.

Every page reports full union/both/left-only/right-only counts and complete totals for each source,
including all retained accounts, not just the displayed page. Total differences are null unless
both reports contain the same identity set. Per-account differences remain available for their
shared identities. Empty saved account sets have their actual zero-row sums; this is not a claim
that the company's accounts or openings are complete. Source account counts, debit/credit header
totals and each saved closing formula are checked before any comparison result is returned.

The formulas remain exact numeric minor-unit arithmetic:

```text
movement = debits - credits
closing = opening + debits - credits
difference = right - left
```

No percentage, sign flip, rescaling, currency conversion or inferred profit transfer is added.
All amounts are strings. Source opening includes earlier postings at each saved cutoff; it is not
a reviewed OpeningSet, prior-year acceptance or comparative statutory disclosure.

## Complete bounded pagination

Each accepted source supports at most10000 complete account lines, independently checked before
full-source aggregation/hashing. More rows refuse the whole comparison; no first10000 totals or
digests are returned. The union can therefore contain20000 distinct IDs. Pages return at most100
items using a101st-row probe. All union rows remain discoverable; full totals/counts repeat unchanged
on every page. No financial total is scoped to the page.

Cursor format is `leftReportId:rightReportId:accountId`. It must pin the same pair in the same
order and identify an actual saved union row. Paging uses `COLLATE "C"` consistently for ordering,
anchor comparison and digest ordering. Malformed or cross-pair cursors and missing anchors refuse.
The final account can validly resume to an empty page. Later postings, new accounts and label changes
cannot enter a frozen source, change a page or alter either source digest. Authorization is checked
again on every request; no cursor grants access.

## Narrow currency-scale prerequisite approved by root

The new4600 forward replacement of `prepare_report` has exactly this functional difference from
the latest0120 implementation:

```diff
- 'currency', book.currency, 'createdAt', ...
+ 'currency', book.currency, 'currencyScale', book.currency_scale, 'createdAt', ...
```

The declaration is `CREATE OR REPLACE FUNCTION` rather than the historical `CREATE FUNCTION`.
Every other byte of that function is unchanged: profile/date guards, authorize→book lock→exact-key
replay, saved header fields/warnings, cutoff, complete account-line formulas/insertion and command
receipt. Existing function privileges survive replacement. No historical migration is edited.
`ReportSnapshot.currencyScale` is optional solely so old saved headers and old-key receipts remain
readable. Old-key replay does not acquire current scale. Comparisons refuse missing scale rather
than use current book metadata. There is no backfill, metadata mutation or automatic regeneration;
a new report of historical dates uses its new actual cutoff, never masquerades as the old snapshot.

## Root integration

Owned files:

- `packages/contracts/src/reports.ts`: additive comparison schemas/API and `ReportComparisonCapabilities`.
- `apps/api/src/transport/http/routes/reports.ts`: `compareReports` delegates to the same capability.
- new `apps/api/src/db/statements/reports.ts`: `reportComparisonStatements`.
- new `apps/api/migrations/4600-report-comparisons.sql`.
- this handoff and owning plan06; `REPORTS.md` links this scope.

No new package export or API group is required. Root adds:

1. Spread `ReportComparisonCapabilities` from the existing reports contract in shared capabilities.
2. Spread `reportComparisonStatements` in the shared query registry.
3. Bind the read-only capability:

```ts
reports_compare: bindCapability(Capabilities.reports_compare, "compareReports", (input) => [
  scopeParameter(input.scope), input.leftReportId, input.rightReportId, input.after ?? "",
]),
```

The existing ReportApi/ReportHandlers composition owns the endpoint. No idempotency key, write
receipt, UI, artifact subsystem or provider action is introduced for comparison. Root owns shared
type checks and wave status.4600 creates one authenticated read function and forward-replaces
prepare solely for scale provenance; compare's runtime role gets EXECUTE only.

## Scope and remaining evidence

Owned-file `oxfmt --write` passed on the three TypeScript modules and three documents. Owned-file
`oxlint` passed on the three TypeScript modules with zero warnings/errors. Source comparison
confirmed the prepare function body differs from0120 only by currencyScale.0120 and3400 remained
unchanged. Comparison references only get_report/report_lines/digest/fail, not live accounts,
vouchers or writes. Shared type checks remain root-owned. No SQL execution, migration application,
runtime/tests/helpers/fixtures, UI/provider/external/dependency/deploy/VCS action was performed.

Every response fixes `interpretation:saved_snapshot_arithmetic_only`, `coverage:not_established`,
`reviewedOpening:false`, `statutoryComparability:false`, and `financialCloseReady:false`. Source
warnings are retained and comparison warnings explain missing identities, frozen label changes,
interval/cutoff differences and unreviewed opening provenance. No close, statutory, filing, tax,
allocation or ledger authority is implied.

Pending observations if separately authorized: one/many/zero accounts; left/right missing sides;
same labels on different IDs and changed labels on the same ID; same-report zero differences;
positive/negative balances and reversals; different intervals/cutoffs; cross-book, missing-scale
and currency/scale mismatch refusal;100/101 and10000/10001 boundaries; full totals beyond page1;
malformed/swapped/absent-anchor cursors; stable pages after posting/renaming; exact full-source
digests; and unchanged historical header/receipt bytes after the scale prerequisite. No tests or
fixtures are added. Source reasoning is not SQL/runtime proof.
