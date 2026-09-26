# Internal trial balance

`trial_balance_v1` is a synthetic internal report, not a statutory balance sheet, tax return or period close certificate.

POST `.../report-snapshots` with `kind`, `startsOn`, `endsOn` and a stable Idempotency-Key. The command locks the book, freezes its committed sequence and account labels, and stores full-scope account totals atomically with the receipt. Repeating the command returns the same snapshot; create a new command for a new cutoff. Inactive accounts remain visible.

GET `.../report-snapshots/:id` recovers the immutable header. GET `.../:id/lines` pages frozen account lines (100 at a time, `after=accountId`). GET `.../:id/lines/:lineId/explanation` pages original voucher contributions (`after=sequence:ordinal`), including evidence references. Cursors operate inside the report ID's fixed sequence and interval. Totals always describe the full selected scope. The account's opening amount includes all earlier postings; period debits and credits include both originals and reversals. No fiscal-year profit transfer, VAT treatment or source completeness is inferred.

MCP exposes `reports_prepare`, `reports_get`, `reports_lines`, `reports_explain` through the same named handlers as REST. All values remain exact minor-unit strings. A balanced report explicitly retains `coverage: not_established` and warnings. Later postings do not silently rewrite an old report.

Manual local journal-and-reversal report and drilldown receipts are retained in `.agents/work/openerp-implementation/manual-period-receipts.json`. No automated tests, independent format validators or compliance verification have been performed.

## Saved-snapshot comparisons

[REPORT-COMPARISONS.md](REPORT-COMPARISONS.md) documents the4600 read-only two-snapshot
comparison. It uses frozen account identities/labels, exact right-minus-left signed differences,
explicit missing sides and stable bounded pagination with complete source totals. Only newly
captured reports retain currencyScale; comparisons refuse missing historical scale rather than
read live book scale. Old report bytes/replay are unchanged. Comparisons are diagnostic arithmetic,
not reviewed openings, statutory comparatives or financial-close readiness.

## Semantic statement snapshots

[REPORT-STATEMENTS.md](REPORT-STATEMENTS.md) documents `semantic_statement_v1`: a pure,
deterministic profit-and-loss and balance-sheet snapshot derived from retained ledger facts under
one reviewed mapping release, with an explicit virtual untransferred result, a topological subtotal
graph, retained row and contribution membership, and separate arithmetic and coverage statuses. It
is a new artifact beside the synthetic trial-balance and role-bucket family reports above, not a
recalculation of them.
