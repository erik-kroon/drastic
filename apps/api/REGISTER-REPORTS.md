# Bounded invoice register snapshots

## Accepted slice and failure cases (before implementation)

Create, rediscover and download an immutable synthetic same-currency receivable/payable ageing and control-account snapshot. It consumes existing registered invoices and posted allocation legs. It does not issue invoices, post journals, initiate payments or claim source completeness.

- Wrong entity/book, revoked access and cross-book IDs must fail before any record or total is exposed.
- Retry with the same actor, key and exact input must return the original snapshot; changed input under that key must conflict. Later postings, allocations or metadata revisions must not rewrite old snapshots.
- Pin the current committed ledger sequence, all declared commerce control accounts, every included journal line, the current invoice metadata revision used for due dates, and each included allocation receipt/ordinal/plan digest.
- The as-of date filters economic posting dates, not when facts became known. Use current known registration/metadata/allocation facts at capture. Label that basis explicitly; do not pretend to reconstruct what users knew on a historical date.
- Include carry-forward recognition and all control-account journal lines through the as-of date. Exclude future-dated recognition/payments. Freeze the selected due date; later metadata edits must not change ageing.
- Keep customer debit-positive and supplier credit-positive balances separate. Exact integer minor-unit strings and PostgreSQL numeric arithmetic must preserve amounts and sums beyond JavaScript safe integers.
- Residual register amounts equal recognition less included allocations. Match them against the full declared-account GL balance. Unregistered GL rows and unallocated settlement-side amounts remain signed unexplained contributions; never create a balancing plug or classify them as verified payments.
- Equal opposite unexplained contributions must remain visible even if the net difference is zero. Empty account/invoice selections and zero differences never imply complete source coverage.
- A due date equal to the as-of date is not overdue. Bucket remaining amounts into not due, 1–30, 31–60, 61–90 and over 90 days. Settled invoices contribute zero; historical payments after the date do not reduce earlier residuals.
- Invalid recognition/allocation references or overconsumption must reject the snapshot rather than publish authoritative invented residuals.
- Bound capture to 100 declared accounts and 2,000 combined invoices, allocation legs and GL lines, with a 2 MiB stored report limit. Reject excess scope without any snapshot or receipt; never truncate totals. Smaller as-of scope can help, but large carry-forward history needs future durable reporting.
- A report created between list pages must not shift that inventory. Allocate per-book report ordinals under the book lock; bind every opaque cursor to entity/book, captured ordinal cutoff and last ordinal. Reject malformed, cross-scope, out-of-range or impossible cursors. Return exact inventory count and a cursor for its first page; a deliberate refresh starts a new inventory.
- Materialized invoice, allocation, ledger and account-array lengths must equal the selected counts. A missing joined row must fail explicitly, never disappear into a plausible total.
- Report creation has no financial writes or approval consumption. Snapshot plus command receipt commit atomically. Runtime gets only scoped command/read/list function execution, never table writes.
- UI must expose capture, saved-list recovery, exact saved report, readable ageing/control differences and a complete JSON download. Error/retry preserves captured request identity. Data stays book-scoped and out of browser persistence.

## Verification gate

No tests or fixtures are added or changed. Before claiming verified behavior, the integrator must exercise the actual restricted Worker/PostgreSQL and browser paths, retain report JSON/receipts, and independently calculate expected as-of residuals, ageing and per-line control differences. Required examples include a later-dated partial payment, changed due date after capture, offsetting unexplained GL lines, empty declared accounts, wrong scope, exact replay/conflict and oversize rejection. Static checks do not establish these outcomes.

## Implemented source and ownership

The additive migration `0920-commerce-register-snapshots.sql` stores the complete bounded manifest in `commerce_register_snapshots`. Immutable-row protection forbids update/delete. Creation takes the established authorization lock then the book mutation lock, checks/replays the command, reads current facts, saves the snapshot and command receipt atomically. Reads authorize before looking up any scope-bound record. No prior migration is edited.

`digest` is `openerp.digest(report - 'digest')`, using the existing canonicalizer; it binds the complete saved report, including capture metadata and all contribution arrays. It is not a claim that the report was independently audited. Each report also has a per-book positive ordinal allocated under the book lock. The report inventory uses this append-only ordinal, not random IDs. A first request captures the current maximum; subsequent opaque `after` cursors bind entity/book, cutoff and last ordinal. The response carries exact `total`, `cutoff`, `first` and `next`. Cursors are bounded canonical-JSON hex navigation tokens, not credentials; every page reauthorizes and checks scope, numeric bounds and inventory/page cardinality. New reports cannot alter a captured inventory. `first` returns to that inventory's first page; omitting `after` deliberately captures a new inventory. Full materialized report-array cardinalities must also equal the selected counts before anything is saved.

The report has no live freshness overlay: its as-of date, capture timestamp and ledger sequence identify the retained basis. A new capture uses a new key. An exact retry returns the old capture, not refreshed data.

All currently declared commerce control accounts are selected, including inactive accounts. Their classification/version/name and all posted lines through the date and committed ledger sequence are frozen. Accounts not declared by commerce are outside this report. Invoice metadata uses the current revision at capture, not a reconstructed historical revision. Included allocation identities use the payment posting date; their committed timestamps remain visible. Current invalid/corrected references reject, even if a correction is dated after the requested date. That is conservative current-known-fact validation, not a historical validity claim.

For each account, normalize debits minus credits for customers and credits minus debits for suppliers. Register effect is recognized invoice amount minus included allocation amount. Each ledger contribution retains `unexplainedMinor = normalized GL amount - register effect`. Account difference is `ledgerMinor - outstandingMinor`. A zero net difference with nonzero unexplained lines has status `differences`. Unapplied settlement-side rows stay unexplained; this slice does not determine their economic purpose. Age buckets apply only to remaining invoice amounts. No customer/supplier netting or cross-currency aggregation occurs.

The commerce panel mounts `register-reports.tsx`: capture through the existing retry-safe command form; fixed-cutoff saved-report discovery (20 summaries in per-book capture order); scoped GET by saved ID; saved control/ageing/invoice/ledger/allocation views with local 50-row pagination; full JSON download. The JSON includes every retained row even when the screen shows one page. The request form has the existing explicit retry-key/manual-retention behavior, not crash-safe local persistence. Saved server reports can be rediscovered after reload.

## Shared integration map (integrator-owned)

- Export `"./register-reports": "./src/register-reports.ts"` from `packages/contracts/package.json`.
- Add `RegisterReportsApi` to `packages/contracts/src/api.ts` and spread `RegisterReportCapabilities` into `packages/contracts/src/capabilities.ts`.
- Add `RegisterReportHandlers` from `apps/api/src/register-reports.ts` to the API composition in `apps/api/src/index.ts`.
- Import/spread `registerReportStatements` from `apps/api/src/register-report-statements.ts` into `apps/api/src/database.ts`. It uses the existing Drizzle Effect adapter and no new connection owner.
- Bind the following capabilities in `apps/api/src/capabilities.ts` using the existing `bindCapability`. Parameter lists below exclude the token that `bindCapability` prepends.

| Capability | Dispatcher operation | Parameters | Output |
| --- | --- | --- | --- |
| `commerce_create_register_report` | `createRegisterReport` | `[scopeParameter(input.scope), input.idempotencyKey, JSON.stringify(input.input)]` | `RegisterReport` |
| `commerce_get_register_report` | `getRegisterReport` | `[scopeParameter(input.scope), input.id]` | `RegisterReport` |
| `commerce_list_register_reports` | `listRegisterReports` | `[scopeParameter(input.scope), input.after ?? ""]` | `RegisterReportPage` |

REST paths use `/api/v1/entities/:entityId/books/:bookId/commerce/register-snapshots`: POST with `{asOfDate}` and `Idempotency-Key`, GET list with optional opaque `after` cursor (pass unchanged), GET `/:id` for the full immutable snapshot. All are shared REST/MCP capabilities. Capture is not approval or a financial operation, so it does not add an operator-only approval endpoint.

The worker changed no shared dispatcher/catalog/export/entrypoint, db mappings, global messages, workspace or UI primitives. The commerce panel and local copy own the new visible section. If maintenance needs a Drizzle table mapping, the integrator owns that mapping; runtime only calls the scoped SQL functions.

## Status

Implemented source pending shared integration and runtime/browser verification. No tests/fixtures, database runs, servers, repository-wide checks, commits or deployments were performed by this worker. Owned-file formatting/lint results are reported separately at handoff. SQL behavior, capture/replay, report arithmetic, pagination, download, narrow layout, keyboard and 200% zoom remain unverified until the integration gate above is exercised.
