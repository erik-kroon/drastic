# Internal trial balance

`trial_balance_v1` is a synthetic internal report, not a statutory balance sheet, tax return or period close certificate.

POST `.../report-snapshots` with `kind`, `startsOn`, `endsOn` and a stable Idempotency-Key. The command locks the book, freezes its committed sequence and account labels, and stores full-scope account totals atomically with the receipt. Repeating the command returns the same snapshot; create a new command for a new cutoff. Inactive accounts remain visible.

GET `.../report-snapshots/:id` recovers the immutable header. GET `.../:id/lines` pages frozen account lines (100 at a time, `after=accountId`). GET `.../:id/lines/:lineId/explanation` pages original voucher contributions (`after=sequence:ordinal`), including evidence references. Cursors operate inside the report ID's fixed sequence and interval. Totals always describe the full selected scope. The account's opening amount includes all earlier postings; period debits and credits include both originals and reversals. No fiscal-year profit transfer, VAT treatment or source completeness is inferred.

MCP exposes `reports_prepare`, `reports_get`, `reports_lines`, `reports_explain` through the same named handlers as REST. All values remain exact minor-unit strings. A balanced report explicitly retains `coverage: not_established` and warnings. Later postings do not silently rewrite an old report.

Manual local journal-and-reversal report and drilldown receipts are retained in `.agents/work/openerp-implementation/manual-period-receipts.json`. No automated tests, independent format validators or compliance verification have been performed.
