# Accountant review pack (END-03)

## Accepted scope

Create a retained accountant-review snapshot from a **current immutable internal trial-balance report**. Materialize all pages and JSON/CSV bytes under one book barrier. Provide balances, all ledger-prefix lines (including explicitly excluded later-dated lines), receipts, evidence and separately visible source/control gaps. Old packs and artifact bytes survive later edits, posting and reopen.

This is synthetic review tooling. It does not activate a real company, establish opening balances or completeness, calculate taxes, transfer results, generate SIE/iXBRL/annual reports, or claim compatibility with any Visma product. Privately paid expenses and shareholder funding need evidence and accountant classification; this pack must not label them loans, conditional/unconditional equity, VAT-free or already settled by inference.

## Risks and acceptance cases recorded before implementation

- **Mixed snapshots:** report creation and pack creation can race with posting. Reject a report whose sequence is not the locked book sequence. Pack creation holds book FOR UPDATE; later reads use only materialized rows/artifacts. Each page names pack ID, section, digest and fixed total.
- **Intermediate correction:** never accept a client-chosen sequence. Use the current committed book sequence under its barrier, which excludes half-committed correction groups.
- **Unknown opening:** show observed pre-interval ledger totals separately from verified opening authority. No prior vouchers is not proof of zero opening. Always retain the unverified opening status, supplied explanation and evidence references.
- **False completeness:** bank, commerce and schedule hooks describe represented state only. Empty modules cannot mean not applicable. Missing company profile/inventory and unsupported legal tax/owner treatment remain explicit unverified or blocked rows; installed review providers do not establish those facts. User-declared exclusions remain visible and cannot waive checks.
- **Lost response:** exact actor/scope/input/key returns the stored creation receipt. Changed input or wrong scope cannot recover another pack.
- **Later changes/reopen:** currentness is separate from immutable content. A changed dependency marks the old pack historical, without changing a row or artifact hash.
- **Omitted evidence:** inventory every retained evidence record at capture, distinguish included opening/movement evidence from excluded-later and no-included-posting records, and include retained text/hash/source locators. An unlinked record is a review gap, not discarded noise.
- **Lineage loss:** include voucher, event, change set, approval, execution receipt, reversal link, posting purpose and original evidence refs. Opening and movement lines remain distinguishable; later-dated lines in the committed prefix are explicitly excluded from totals.
- **Large or partial export:** synchronous first-year package is bounded. Refuse before committing any pack if row/content/byte limits are exceeded. Never call truncation a complete export.
- **Formula injection/precision loss:** CSV cells use a documented text marker before source values and RFC4180 quoting. Exact minor-unit values remain strings. JSON is the lossless primary representation. File byte hashes cover the exact UTF-8 content delivered to the browser.
- **Cross-book/data leakage:** authorize every creation/read/download through current backend admission. Export filenames contain generated IDs only. Original evidence may be sensitive; show a download warning, not a public link.
- **Local-only currentness:** a green dependency comparison means unchanged captured sources, not statutory readiness, legal verification or external acceptance.

Root must run native types/lint and permitted local API/browser observations. This owner adds no tests/fixtures and runs no database writes, migrations, builds or servers. Static checks do not prove races, crash recovery, browser behavior or accounting correctness.

## Implementation / integration

Source implementation is present in `0810-accountant-review-packs.sql`, `packages/contracts/src/accountant-review.ts`, `src/accountant-review.ts` and `apps/web/src/components/accountant-review/`. It has not been migrated or exercised by this owner. Root owns shared composition and native/runtime validation.

### Stable capture and contents

The preparation input names an existing current internal report, an opening explanation, retained opening-evidence IDs, accountant notes and explicitly declared excluded sources. Additional provider materialization occurs under the same book barrier; the owner inventory digest also pins after-end excluded source revisions and identities. The UI can prepare that report first using the existing report API. A stale report or report invalidated by reopening is rejected; an old pack remains readable. No arbitrary historical sequence is accepted because live source/register state cannot be reconstructed from an old ledger watermark alone.

The capture holds the existing book `FOR UPDATE` barrier after admission. It checks report account identity/labels, reconstructs each account total from committed lines, and refuses incomplete receipt/approval joins. Financial values stay exact decimal minor-unit strings. Every posted line at the captured prefix is assigned `opening`, `movement` or `excluded_after_end`. Original and reversing entries both remain visible. Lineage includes event, change set, digest, receipt, approval/approver, correction link and evidence locators.

All retained evidence in the book is captured as immutable content plus original hash. Evidence with no included posting is explicitly classified, not omitted or automatically treated as requiring a journal. A bank/control source document need not itself create a posting. Opening-explanation-only use and later-dated excluded voucher use remain separate. Unretained missing sources cannot be counted.

Private existing providers are consumed exactly: `bank_close_dependencies`, `commerce_period_status`, `subledger_close_dependencies`, `owner_period_status` and `expense_tax_dependencies`. Latest explicit bank inventory declarations are pinned for overlapping periods. Coverage rows name missing declarations, expected but unrepresented sources and missing exact-interval reconciliations. Represented commerce and schedule data never establish whole-company completeness. Owner sources/reviews, posted effects, allocation legs and owner-control snapshots are captured through the released0610 contract. Every current expense source/review is captured with0710 source/reviewer controls and all provider exclusions in `actual_review` mode. No tax calculation/contribution is enabled. This version never probes table presence to infer support.

`companyCompleteness` is always `not_established`; `statutoryReady` is always false. `openingBasis.status` remains `not_verified` even when the preparer supplies evidence. This package does not implement approved opening sets or zero-opening approval.

### Pagination and historical versions

Pack, materialized rows and artifacts are append-only. Page size is25. Every page repeats pack ID/digest, selected section, total and next continuation. The page function never re-queries live ledger/source rows. The book-local pack ordinal is allocated under its existing lock; no sequence-backed state is introduced.

Live `dependenciesCurrent` is returned separately from immutable pack content. It compares current sequence/profile/writer, account/year/period configuration, retained evidence inventory, relevant closing history, bank declarations and provider snapshots. It is intentionally conservative: later unrelated activity can mark a pack historical. A true value is not an accounting signoff. Exact creation-key replay returns the original command result; callers should GET the pack for currentness rather than interpreting a replayed creation response as a fresh check.

### Downloadable artifacts

Eight stored UTF-8 files are generated atomically:

- `json`: canonical JSON with the immutable pack and all seven complete sections.
- `balances_csv`: recorded opening, period debits/credits and recorded closing per account.
- `journal_csv`: all captured-prefix lines, inclusion basis and complete voucher/receipt/evidence lineage.
- `evidence_csv`: complete retained evidence inventory, dispositions, references and original text.
- `coverage_csv`: all missing/unavailable/unverified/excluded source/control observations.
- `owner_sources_csv`: every current owner source/revision/review, including explicitly excluded after-end records.
- `owner_controls_csv`: exact provider-owned through-date records/effects/allocations, outstanding registered positions, movements and whole-account comparisons. Opening balance stays null.
- `expense_tax_csv`: every current expense source/review and its nullable control differences/exclusions. Actual-review mode always excludes financial contributions.

Every CSV has a header and a first `recordType=manifest` row containing pack/digest/report identity, sequence, currency/scale, opening basis, all coverage observations, owner/tax provider basis digests and non-statutory status. Ordinary rows have their section as record type. An empty section still retains its manifest row. Each data cell is RFC4180-quoted and prefixed by exactly one apostrophe; remove that one transport marker when reading CSV programmatically. Quotes inside cells are doubled, line endings are CRLF, and embedded source newlines are retained. This neutralizes spreadsheet formulas and preserves long numeric strings as text. JSON is the lossless primary format; CSV is not an accounting-software import contract.

SHA-256 and byte length cover the exact retained UTF-8 content, not a browser re-render. Pack/row digests use the existing canonical JSON algorithm. JSON does not contain its own artifact hash; descriptors are returned alongside the pack to avoid a self-hash cycle. The browser validates identity, length and SHA-256 before offering a Blob download. Its link ref owns and releases the object URL.

### Explicit synchronous bounds

Preparation refuses more than1000 vouchers,5000 journal lines,1000 accounts,1000 evidence records or2 MiB total retained original evidence. Provider capture additionally refuses more than100 owners,1000 owner sources/effects,5000 owner allocation legs or200 expense sources. Each generated file is limited to8 MiB. No partial pack is saved on a refusal; a larger durable export is not implemented. Inputs allow20 opening evidence references and20 declared exclusions. The UI exposes one optional exclusion; the API supports the full bounded list.

### Remaining proof and real-company gates

Bounded source lint/format checks are not database, accounting, browser or security-concurrency proof. Root must review/apply the forward migration after current immutable migrations and perform allowed local observations. The meaningful manual path is prepare → inspect all sections/page boundaries → compare exact downloaded bytes/hash → mutate/reopen in an authorized synthetic book → read the unchanged old pack and observe separate historical currentness.

No real-company opening balances, VAT/deductibility, owner-funding classification, liabilities, source completeness, independent file-consumer acceptance or Visma compatibility is established. No external validator, provider, filing or deployment is part of this package. Exact shared integration instructions live in `.agents/work/accountant-review-handoff.md`.

## Owner and expense-review integration risks (recorded before0820)

-0820 must replace only the private live closing basis in a new forward migration. Existing0800 bytes, certificates, approvals and receipts remain unchanged. Older proposals lack these dependencies and must become stale rather than receive implied approval for new checks.

- Capture and recheck owner `sourceDigest` and expense-tax `basisDigest` under the existing book barrier. Unresolved/unlinked owner sources and missing/stale expense reviews block technical close. Unpaid but linked owner expense/loan claims do not block it merely because capacity remains.
- Empty provider inventories do not establish source completeness, zero openings, no liabilities or tax eligibility. Reviewed facts are not statutory acceptance. Reopen remains available for repair when close prerequisites fail.
- Accountant packs must materialize provider-owned source/review/controls and explicit outside-interval rows at one basis. Bound owner identities/sources/effects/allocations and expense sources before materialization; fail atomically rather than omit rows.
- Reuse provider control/assessment helpers, without recreating owner allocation or tax eligibility rules. Expense assessment is captured in `actual_review` mode: no tax contribution or legal profile is activated by this package.
- Old pack bytes/page meanings must not change.0810 remains unapplied and may be extended before root applies it;0820 independently upgrades current closing behavior. Root owns migration ordering, runtime observations and concurrency proof.

Provider inventory limits are checked before aggregating source hooks, including currentness reads. If live provider state exceeds supported bounds, an old pack/descriptor read remains available with `dependenciesCurrent=false`; stored pages and artifact bytes stay readable and unchanged. Known expense sources remain explicit missing close coverage regardless of whether their review digest is current.

##6400 row continuation binding — failure contract before code

0810 row continuation accepts an unbound ordinal. A continuation from another pack/section,
or a nonexistent position, can silently skip materialized rows and appear terminal. For example,
`25` from a30-row journal yields an empty final evidence page when that section has only one row.
This is a REST/MCP continuation defect, not ledger loss or corruption of complete file exports.
The web client already separates pack/digest/section query keys; no browser reproduction is claimed.

- Replace only `accountant_review_rows_page`. Preserve current scoped authorization and the
  section whitelist. Resolve the authorized immutable pack before inspecting an anchor.
- Bind each continuation to `packId:section:ordinal`. Require bounded syntax, positive numeric
  position, exact pack/section identity and a real retained row in that section. Refuse malformed,
  overflowing, zero, cross-context, missing-anchor and numeric-only cursors without fallback.
- Omitting `after` starts the first page. The existing internal empty-string sentinel also means
  no cursor; public schema validation does not admit an explicit empty cursor.
- Keep materialized row selection,25-row ordering/lookahead, total, pack digest, empty first pages
  and exactly25-row final pages unchanged. Later posting/reopen cannot change saved content.
- Use a separate local row cursor/query contract. Pack-list continuation and the private
  ordinal parser remain unchanged. No existing shared binding/signature or UI edit is needed.
- Stored pack JSON/CSV contain complete section arrays, not row-page responses. SIE reads those
  stored rows directly. Their bytes, hashes, selections and recovery paths must remain unchanged.
- The earlier numeric-only cursor is malformed under the new contract. Omit `after` to restart
  the section. The in-repo client already treats continuation as an opaque string.

Source review and static checks are not runtime proof. No tests, SQL compilation/application,
runtime, provider, browser/UI or VCS actions are authorized for this packet.

###6400 implemented source and integration

`6400-accountant-review-row-cursors.sql` replaces only the existing row-page function. New
continuation is `packId:section:ordinal`. SQL bounds it to163 characters (128-character pack
ID,14-character maximum section name,19-digit positive position and two separators), validates
syntax/context, catches bigint overflow, and requires an exact stored row anchor. All failures
use structured accounting errors. Current authorization and immutable pack lookup precede
anchor access. The25-row query, lookahead, totals, digest and response items are unchanged.

`ReviewRowCursor` and `ReviewRowQuery` apply only to row-query inputs and `ReviewPage.next`.
The existing REST route and MCP binding still pass the same string parameter. The web row
consumer already treats continuation as an opaque string, URL-encodes it, and separates queries
by book/pack/digest/section; no UI change or browser reproduction is claimed. Pack-list output,
query and SQL ordinal parser retain their existing contract.

The complete JSON/CSV exports are materialized from stored section arrays. They do not contain
`ReviewPage` responses or row cursors. SIE capture reads stored rows directly, without this
pager. No saved pack, row, artifact, filename, digest, byte hash or SIE capture/seal path changes.
Old packs remain readable through the new pager and unchanged file-download APIs.

The previous in-repo numeric cursor shape is rejected by the new query contract. No deployed
old client or production data is assumed; the current web client already accepts the bound
cursor returned by the new pager.

Fresh source review covered all local schema consumers, the full function/schema diff, saved
JSON/CSV construction, direct SIE row selection, empty sections, real terminal anchors and exact
page-size boundaries. Whitespace inspection passed. These are source checks only. No tests,
SQL compilation/application, runtime/provider/browser/UI or VCS actions were performed. Root
owns shared static checks and maintained plan06/wave integration; no shared wiring edit is needed.
