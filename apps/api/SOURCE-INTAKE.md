# Source intake: bounded UTF-8 bank CSV

## Working contract

IMP-01 plus a bounded IMP-02 slice: scoped exact-byte retention → immutable CSV preview and diagnostics → explicit operator approval → atomic admission through the existing bank import authority → saved receipt and observed-source discovery. This does not post, match, classify tax, settle invoices or establish required-source completeness. Existing JSON import and bank allocation authority remain unchanged.

The supported reviewed profile is `bank_csv_utf8_v1`: UTF-8 (optional leading BOM), explicitly selected comma/semicolon/tab delimiter, LF or CRLF record endings, RFC-style double quotes and doubled-quote escapes (including quoted delimiters/newlines), a mandatory unique header, explicit date/description/signed-amount columns and optional provider-ID column. Dates are explicitly YYYY-MM-DD or DD/MM/YYYY; decimal separator is explicitly dot or comma; sign orientation is explicitly inflow-positive or outflow-positive. No locale guessing, thousands grouping, currency inference or automatic reordering. Unused columns remain in original records and produce review warnings. The operator declares bank source/account, currency/scale, inclusive interval and independent opening/closing minor-unit totals plus a completeness assertion/basis.

Bound this first slice to 64 KiB original bytes, 200 data records, 32 columns and 4000 bytes per field. Normalized evidence must fit the existing 65536-character/262144-byte evidence authority. Larger work is refused visibly, never admitted in truncated form. IMP-03 chunking/leases and broader provider profiles remain separate.

Content is immutable book-scoped bytes keyed by SHA-256. Occurrence identity is `(book, sourceSystem, sourceAccountId, occurrenceKey, sourceRevision)`, supplied separately from its content hash and filename. Identical bytes can have distinct occurrences; the same occurrence cannot change content or acquire a second admission. Mapping edits create new immutable previews, not overwritten interpretations. Admission calls existing `create_evidence` and `import_bank_statement` with deterministic internal command keys under the same book lock. No alternate observation/matching/ledger authority is created. Existing importer overlap/profile constraints remain authoritative, including the current synthetic-only admission gate.

## Risks and acceptance cases before implementation

- Identical byte content under two distinct declared occurrences remains two provenance records; retrying the same occurrence with changed content or metadata fails, and retrying admission cannot duplicate observations.
- Preserve BOM, exact bytes, line endings, quoted delimiters, escaped quotes, multiline text, blank fields, row ordinal and physical-line/byte locators. Never collapse equal transactions.
- Invalid UTF-8, NUL, bare CR, mismatched configured line endings, unclosed quotes, text after closing quote, embedded quote in unquoted text, blank records, too many rows/columns or oversized fields produce blocking diagnostics tied to retained bytes.
- Reject ambiguous/non-calendar dates, unsupported decimal/grouping syntax, excess fractional digits, money overflow, out-of-interval records, wrong widths/headers, duplicate provider IDs and control-total disagreement. Money uses exact numeric integer operations, never binary floating point.
- A structurally incomplete or partly invalid preview cannot be approved/admitted. Every data record must yield one observation. Original bytes and rejected-record diagnostics remain retrievable.
- Scoped token/session and book authority are checked in every public SQL operation. Operator approval binds immutable preview digest, selected interpretation and current dependency versions; expiry, role loss or changed source/configuration blocks admission.
- Persist approvals, normalized evidence links, stable statement/occurrence identity and replayable receipts. Admission writes all observations and the receipt together or rolls back. No posting, matching, payment or invoice residual side effect.
- Preview/discovery counts describe observed sources only. Unknown sources, opening basis, VAT, liabilities, company facts and legal classification stay unknown.
- UI file read races cannot attach old bytes to a new selection. No private bytes in localStorage, URLs, logs, fixtures or source code. Network uncertainty retains command keys; saved discovery recovers state after reload.
- Source control was removed by the user. Do not initialize Git, recover history, restore/delete files or commit. Existing migrations through0900 are immutable.

## Implemented source; integration and runtime gates remain open

- `packages/contracts/src/source-intake.ts`: schemas, seven REST endpoints and five non-approval MCP capability definitions.
- `apps/api/src/source-intake.ts`: Effect HTTP handlers using current Better Auth/token authentication and the existing Drizzle query owner.
- `apps/api/src/source-intake-statements.ts`: fixed parameterized Drizzle statements, without another connection/transaction owner.
- `apps/api/migrations/0510-source-intake.sql`: immutable content, occurrence, preview, approval and admission records; SQL byte-state CSV parser, exact integer money and scoped commands. No existing migration was edited.
- `apps/web/src/components/source-intake/{index,workspace,review}.tsx` plus `copy.ts` and `download.ts`: owned UI for retention, paged discovery, original download, explicit mapping, paged original/normalized rows, diagnostics, operator approval/admission and downloadable immutable preview/receipt. Local interface copy is English/Swedish; persisted SQL diagnostics retain their English technical message and stable code.

A content locator is `(bookId, sha256)` in the immutable bytes table. Scope never shares content records across books. Source system, source account, occurrence key and revision identify an occurrence; filename and content must agree when that occurrence is reused. Source account identity remains the existing bank authority's identifier; no automatic system-prefix mapping is introduced. Existing JSON imports are neither rewritten nor retroactively given intake occurrences.

The normalized statement uses occurrence ID as its `statementIdentifier`; each observation ordinal is CSV record ordinal minus the header. Original zero-based byte offsets are end-exclusive, while physical lines/CSV records are one-based. The preview stores decoded fields plus original locators; the original byte object preserves quoting, BOM and line-ending spelling. Structural failure returns no partial record collection and `structuralComplete=false`, with its failing locator and complete original bytes still available. Semantic failure retains records and successful normalized rows for diagnosis, but `ready=false` and no admissible statement.

Additional bounds: at most 50 immutable previews per occurrence; inventory pages have at most 20 occurrences. Inventory pagination is not a frozen completeness snapshot; refresh from the first page after new retention. Unsupported/empty files can be retained within the byte bound and produce blocked previews. Files larger than the bound cannot be uploaded. No skipped-row mechanism exists.

Approval is explicit, operator-only, one hour, bound to exact preview digest/version and current book profile/writer/account/source revision dependencies. The approving operator performs the initial admission. Role/session admission locks are acquired before the book lock. Mutations hold that book lock throughout; reads hold a book SHARE lock. Same-command replay returns its original result. An already admitted occurrence returns the durable same-preview/same-approval receipt even under a new request key; another interpretation fails. A new file is never silently substituted into an old occurrence. Approval alone does not reserve or admit rows.

Admission creates normalized JSON evidence through `create_evidence`, then invokes `import_bank_statement` with no existing matches; the intake admission receipt commits in the same transaction. The deterministic inner keys are `intake_<occurrenceId>_evidence` and `intake_<occurrenceId>_import`. Any conflict or guard failure rolls back evidence, observations and all new receipts. Current synthetic-profile, overlap, source-map and bank identity guards remain authoritative. Ledger sequence, allocations, invoice settlement and required-source inventory are not changed by this domain.

The UI keeps command keys after uncertain failures, discovers durable state after reload, and remounts file/review state when book scope changes. Files and previews stay in memory or the scoped retained backend; no browser storage, private fixtures or logged bytes were added. Original bytes, immutable preview and admission receipt have separate downloads.

## Exact root integration map

1. Add `"./source-intake": "./src/source-intake.ts"` to the contracts package exports. Import/add `SourceIntakeApi` to the shared `Api`; spread `SourceIntakeCapabilities` into the shared capability definitions. No new error codes are required.
2. In `apps/api/src/database.ts`, import `sourceIntakeStatements` from `./source-intake-statements` and spread it into `statements`. This extends `DatabaseOperation` through the existing owner. Keep the current Drizzle Effect connection/error handling intact.
3. Add `SourceIntakeHandlers` to the Worker HTTP layer. The seven handlers call the query owner directly; token/session admission remains unchanged.
4. Bind the five capability definitions below in `apps/api/src/capabilities.ts`. Approval/admission are deliberately absent from ordinary MCP tools. There is no need to duplicate parser logic in the MCP/Worker layer.
5. Mount/lazy-load `SourceIntake({ book, setup, locale })` from `@/components/source-intake`. It resets its own state by entity/book and uses existing request-scoped TanStack Query integration and owned UI components. No route or shared locale edits were made by this worker.
6. Review/apply new migration0510 only after existing0001–0502 and current0900 authorization are available.0510 depends on accounting tables, `authorize`, `replay`, `save_command`, `digest`, `new_id`, `immutable_row`, `bank_date`, bank sources/observations/statements, `create_evidence`, and `import_bank_statement`. Existing0600 bank/control-account guards remain effective at admission. All existing migrations through0900 remain immutable.
7. Root owns any typed table mappings in `apps/api/src/db/schema.ts`: new tables are `intake_contents`, `intake_occurrences`, `intake_previews`, `intake_approvals`, `intake_admissions`. No application direct table writes are needed. Only the seven authenticated public commands receive runtime EXECUTE; all parser/helpers explicitly revoke PUBLIC/runtime execution, with protected search paths.

All paths below are under `/api/v1/entities/:entityId/books/:bookId`. Mutations use `Idempotency-Key`. Drizzle binds `token` first, then the parameters shown.

| REST operation          | Path                                    | Parameters after token                       | Response schema        |
| ----------------------- | --------------------------------------- | -------------------------------------------- | ---------------------- |
| `retainSource`          | POST `/source-occurrences`              | scope, key, JSON input                       | `SourceOccurrence`     |
| `listSourceOccurrences` | GET `/source-occurrences?cursor=<id>`   | scope, cursor or empty string (SQL NULLIF)   | `SourceInventory`      |
| `getSourceOccurrence`   | GET `/source-occurrences/:id`           | scope, occurrence ID                         | `SourceOccurrenceView` |
| `previewSourceCsv`      | POST `/source-occurrences/:id/previews` | scope, key, occurrence ID, JSON mapping      | `SourcePreview`        |
| `getSourcePreview`      | GET `/source-previews/:id`              | scope, preview ID                            | `SourcePreviewView`    |
| `approveSourcePreview`  | POST `/source-previews/:id/approve`     | scope, key, preview ID, JSON approval input  | `SourceApproval`       |
| `admitSourcePreview`    | POST `/source-previews/:id/admit`       | scope, key, preview ID, JSON admission input | `SourceAdmission`      |

Capability bindings use the existing `bindCapability` and these parameter arrays (which exclude token):

| Capability                | Database operation      | Parameters                                                                                             |
| ------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------ |
| `source_retain`           | `retainSource`          | `[scopeParameter(input.scope), input.idempotencyKey, JSON.stringify(input.input)]`                     |
| `source_list_occurrences` | `listSourceOccurrences` | `[scopeParameter(input.scope), input.cursor ?? ""]`                                                    |
| `source_get_occurrence`   | `getSourceOccurrence`   | `[scopeParameter(input.scope), input.occurrenceId]`                                                    |
| `source_preview_csv`      | `previewSourceCsv`      | `[scopeParameter(input.scope), input.idempotencyKey, input.occurrenceId, JSON.stringify(input.input)]` |
| `source_get_preview`      | `getSourcePreview`      | `[scopeParameter(input.scope), input.previewId]`                                                       |

## Verification status and root's next action

Bounded owned-file formatting and Oxlint are the only worker checks. `oxfmt` completed on eight owned TypeScript files and the two domain documents; `oxlint` completed on the eight TypeScript files with zero warnings and zero errors. No native typecheck, SQL execution, migration, browser interaction, concurrency/crash/revocation experiment, test/fixture, dependency installation, Git action, build, server or real-company operation was performed. Source inspection is not runtime proof. Shared exports/group/dispatcher composition must land before native type validation; no integrated-build claim is made.

Root should integrate the maps above, serialize normal native validation, then observe the real scoped REST/UI path under authorized synthetic profiles. Retain a repeatable private observation artifact containing original SHA/length, occurrence/preview/approval IDs, exact declared mapping, diagnostics, normalized row IDs, admission receipt, before/after bank/ledger checkpoints and downloaded-byte hash. Do not put private source content into the repository.

Manual acceptance sequence (not an added automated test or fixture):

1. Retain an authorized file, retrieve/download it and independently compare every byte/SHA. Retain the same bytes as another explicitly distinct occurrence and observe distinct IDs but equal content SHA. Reuse the first occurrence identity with changed bytes/filename and observe conflict.
2. Preview with explicit mapping; inspect quoted delimiters/escaped quotes/multiline fields, exact large money, date/sign choices, original locators and unused-column warnings. Exercise each documented unsupported case and assert `ready=false`, no admissible statement, and no bank/ledger effect. Independently check record/field limits and canonical base64 enforcement.
3. Review/approve as operator, admit with that same operator, then replay exact input. Refresh/discover after simulated response loss. Assert one occurrence admission, one statement, one observation per data record, no generated match and unchanged ledger sequence. Concurrent admission and changed-payload replay must not duplicate effects.
4. Change relevant source/configuration after approval; expire approval; remove operator authority; cross book/entity scope. Observe explicit rejections before effects. Re-parse only unadmitted occurrences; reject reinterpretation after admission. Confirm existing JSON imports remain unchanged and overlapping new occurrences are refused, not deduplicated.
5. Drive the UI at narrow width/200% zoom with keyboard. Confirm every row/diagnostic is reachable, form mapping survives a retry, failed reads do not switch the selected source, cross-book selection clears drafts, and downloads reproduce the retained artifacts.

Still out of scope: SIE, bank/provider connectors, native provider profile certification, optional-column inference, foreign-currency conversion, inferred balances/VAT/company facts, arbitrary overlap maps, multi-chunk import/leases/cancel/compensation, source replacement, automatic matching/posting, new residual authority, archive certification and actual-company activation/completeness.

## Root review amendment

Unapplied0510 now uses explicit `(occurrence).field` composite access in the SQL-language `intake_summary`. Approval expiry is assigned after the book lock and validation, immediately before approval creation. No other behavior changed. Source review only; no SQL/runtime check was run.

0510 file SHA-256: `af448df45946719d89e4e23f7a53d5b4ab0b81de43a50c4d953abb3cb873f43d`.
