# Source intake: retained originals and bounded UTF-8 bank CSV

## Working contract

IMP-01 plus a bounded IMP-02 slice: scoped exact-byte retention → immutable CSV preview and diagnostics → explicit operator approval → atomic admission through the existing bank import authority → saved receipt and observed-source discovery. This does not post, match, classify tax, settle invoices or establish required-source completeness. Existing JSON import and bank allocation authority remain unchanged.

The supported reviewed profile is `bank_csv_utf8_v1`: UTF-8 (optional leading BOM), explicitly selected comma/semicolon/tab delimiter, LF or CRLF record endings, RFC-style double quotes and doubled-quote escapes (including quoted delimiters/newlines), a mandatory unique header, explicit date/description/signed-amount columns and optional provider-ID column. Dates are explicitly YYYY-MM-DD or DD/MM/YYYY; decimal separator is explicitly dot or comma; sign orientation is explicitly inflow-positive or outflow-positive. No locale guessing, thousands grouping, currency inference or automatic reordering. Unused columns remain in original records and produce review warnings. The operator declares bank source/account, currency/scale, inclusive interval and independent opening/closing minor-unit totals plus a completeness assertion/basis.

CSV interpretation is bounded to 64 KiB original bytes, 200 data records, 32 columns and 4000 bytes per field. Retention also accepts supported original documents up to 5 MiB through a private object-store adapter; larger or non-CSV originals remain downloadable without being interpreted. Normalized evidence must fit the existing 65536-character/262144-byte evidence authority. Larger work is refused visibly, never admitted in truncated form. IMP-03 chunking/leases and broader provider profiles remain separate.

Content is immutable book-scoped bytes keyed by SHA-256. Occurrence identity is `(book, sourceSystem, sourceAccountId, occurrenceKey, sourceRevision)`, supplied separately from its content hash and filename. Identical bytes can have distinct occurrences; the same occurrence cannot change content or acquire a second admission. Mapping edits create new immutable previews, not overwritten interpretations. Admission calls existing `create_evidence` and `import_bank_statement` with deterministic internal command keys under the same book lock. No alternate observation/matching/ledger authority is created. Existing importer overlap/profile constraints remain authoritative, including the current synthetic-only admission gate.

The object-store extension, pending upload reconciliation, coordinated recovery and unverified hosted gates are described in [Cloudflare delivery](../../../docs/operations/cloudflare.md). Migration `0910-retained-source-objects.sql` extends the content representation and guards the bounded CSV functions. Tests for this extension were skipped at the user's request. Live verification still requires an authenticated staging environment.

Forward migration `2700-source-upload-replay.sql` lets the internal upload admission return an optional completed occurrence alongside its existing object-reference fields. The workflow still validates canonical input bytes and computes their SHA-256 first. After current authorization, the book lock and exact-command replay validation, a completed retry returns the saved occurrence/receipt without acquiring or reading/writing object storage. Pending uploads retain intent/actor validation, conditional upload, byte-length/hash readback and separately authorized completion. This returns a historical receipt; it does not establish current object availability. Public contracts and download verification are unchanged. Migration0910 remains unchanged. This repair has only been source-reviewed; no checks, tests, migration application or runtime verification were performed.

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

A content locator is `(bookId, sha256)` in the immutable content table. Small CSV bytes remain inline; other originals use a versioned book-scoped object key with byte length and hash. The Effect retention/retrieval adapter verifies object contents and database authority; direct SQL CSV preview/get paths refuse external bytes. Scope never shares content records across books. Source system, source account, occurrence key and revision identify an occurrence; filename and content must agree when that occurrence is reused. Source account identity remains the existing bank authority's identifier; no automatic system-prefix mapping is introduced. Existing JSON imports are neither rewritten nor retroactively given intake occurrences.

The normalized statement uses occurrence ID as its `statementIdentifier`; each observation ordinal is CSV record ordinal minus the header. Original zero-based byte offsets are end-exclusive, while physical lines/CSV records are one-based. The preview stores decoded fields plus original locators; the original byte object preserves quoting, BOM and line-ending spelling. Structural failure returns no partial record collection and `structuralComplete=false`, with its failing locator and complete original bytes still available. Semantic failure retains records and successful normalized rows for diagnosis, but `ready=false` and no admissible statement.

Additional bounds: at most 50 immutable previews per occurrence; inventory pages have at most 20 occurrences. Inventory pagination is not a frozen completeness snapshot; refresh from the first page after new retention. Nonempty unsupported CSV content can be retained within the CSV bound and produce blocked previews. Files larger than 5 MiB and empty files cannot be uploaded. No skipped-row mechanism exists.

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

## Immutable reparse and review recovery (forward migration3200)

Implemented in source, not runtime-verified. An explicit reparse now links one unadmitted preview to a new immutable preview of the **same retained occurrence and bytes**. It records both digests, the actor, time, rationale and command receipt. It does not replace an admitted source, change bytes, merge equal rows, or approve an interpretation.

```text
retained bytes → preview A + diagnostics + reviews
                     │ explicit reparse (digest + mapping + rationale)
                     ▼
                preview B + diagnostics → fresh operator approval → admission
A and its reviews remain readable; A cannot receive a new approval or admission.
```

`POST /source-previews/:id/reparse` takes `ReparseSourceCsv` and returns `SourceReparse`. The path ID and input digest/version identify the old preview. A blocked parse result is retained and still supersedes the old preview; an invalid command, unsupported original, or exhausted 50-preview bound rolls back the entire reparse. This is an explicit choice to retire the old interpretation, not automatic selection of whichever preview parses successfully. Ordinary preview creation remains a parallel candidate operation and does not silently supersede anything.

`GET /source-occurrences/:id/revisions` returns `SourceRevisionHistory`: all preview IDs/digests/ordinals, readiness and diagnostic counts, supersession edges, the latest own approval per preview (including expired reviews), and the occurrence's admission receipt. The existing 50-preview bound also bounds these collections. Fetch each immutable preview with `GET /source-previews/:id` for its full mapping, records and diagnostics. Recovery does not read object storage. `ownApprovals` is review history, not current approval authority.

`getSourcePreview` adds the optional `supersededByPreviewId` field and hides current approval for a superseded preview. `dependenciesCurrent` is true only when the preview is not superseded and its stored dependencies still match current account/source configuration. The preview body/digest is unchanged. Database insert guards reject fresh approval or admission of a superseded preview. Admission guard failure rolls back the whole transaction, including any inner evidence/import commands. Existing operator-only authority, expiry, dependency checks and same-operator admission still apply. Exact-command retries return historical receipts after current authorization; a saved approval receipt cannot override the supersession guard.

Reparse and admission serialize on the existing book lock. Reparse refuses admitted occurrences, already superseded predecessors and mismatched digests. A replacement is created in the same transaction, so links cannot cycle or cross occurrences through the public command. Same-key replay returns the original pair even after a later revision; a changed request conflicts. Concurrent different-key attempts cannot create two replacements for one predecessor. No historical records are updated or deleted. Supersession may be requested by the same scoped actors who can prepare previews; only an operator can approve/admit the replacement.

### Current integration delta

The existing source-intake group, exports, statement spread and HTTP layer already exist at the current paths. No shared adapter changes are needed. Root only needs these bindings in `apps/api/src/application/capabilities.ts`:

```ts
source_reparse_csv: bindCapability(Capabilities.source_reparse_csv, "reparseSourceCsv", (input) => [
  scopeParameter(input.scope), input.idempotencyKey, input.previewId, JSON.stringify(input.input),
]),
source_get_revision_history: bindCapability(
  Capabilities.source_get_revision_history,
  "getSourceRevisionHistory",
  (input) => [scopeParameter(input.scope), input.occurrenceId],
),
```

Owned changes are `packages/contracts/src/source-intake.ts`, `apps/api/src/transport/http/routes/source-intake.ts`, `apps/api/src/db/statements/source-intake.ts`, and `apps/api/migrations/3200-source-intake-revisions.sql`. Shared contract/capability spreads discover the additions. Both REST routes use the existing Effect query boundary; MCP uses the same SQL operations via the bindings above. Only the two new authenticated SQL commands gain runtime execution. The helper trigger and lineage table have no runtime write/execution grant. Historical migrations are unchanged.

### Remaining observation gate

Owned-file `oxfmt --write` passed on the three changed TypeScript files and two domain documents. Owned-file `oxlint` passed with zero warnings/errors. Source review confirmed historical migration hashes were unchanged. No tests or fixtures were added. No migration was applied and no database, transport or concurrency behavior was exercised. Root owns integrated type validation and runtime evidence. When authorized, observe stale-digest/cross-book/role-loss refusals; blocked-to-ready and ready-to-blocked reparse; expired-review recovery; exact-key response-loss recovery; concurrent reparse/admit; rejection of old-preview approval/admission without committed evidence or bank changes; unchanged old bytes/diagnostics/admitted statements/matches; and the 50-preview limit. These are pending observations, not verified acceptance.

## Durable interpretation review export (3900)

The [review artifact handoff](SOURCE-REVIEW-ARTIFACTS.md) adds exact retained canonical JSON
captures of one selected preview, its original occurrence/content locator, all normalized rows
and diagnostics, and non-authorizing review/admission state at capture. Existing ad hoc UI
preview downloads are not durable captures. New capture/get/list REST/MCP operations recover
saved bytes/hash/length without reparsing or pretending historical reviews are current authority.
Approval IDs/commands are excluded from review/admission summaries. The artifact establishes
neither source completeness nor posting authority. No UI or storage adapter was changed.

## Verification status and root's next action

Bounded owned-file formatting and Oxlint are the only worker checks. `oxfmt` completed on eight owned TypeScript files and the two domain documents; `oxlint` completed on the eight TypeScript files with zero warnings and zero errors. No native typecheck, SQL execution, migration, browser interaction, concurrency/crash/revocation experiment, test/fixture, dependency installation, Git action, build, server or real-company operation was performed. Source inspection is not runtime proof. Shared exports/group/dispatcher composition must land before native type validation; no integrated-build claim is made.

Root should integrate the maps above, serialize normal native validation, then observe the real scoped REST/UI path under authorized synthetic profiles. Retain a repeatable private observation artifact containing original SHA/length, occurrence/preview/approval IDs, exact declared mapping, diagnostics, normalized row IDs, admission receipt, before/after bank/ledger checkpoints and downloaded-byte hash. Do not put private source content into the repository.

Manual acceptance sequence (not an added automated test or fixture):

1. Retain an authorized file, retrieve/download it and independently compare every byte/SHA. Retain the same bytes as another explicitly distinct occurrence and observe distinct IDs but equal content SHA. Reuse the first occurrence identity with changed bytes/filename and observe conflict.
2. Preview with explicit mapping; inspect quoted delimiters/escaped quotes/multiline fields, exact large money, date/sign choices, original locators and unused-column warnings. Exercise each documented unsupported case and assert `ready=false`, no admissible statement, and no bank/ledger effect. Independently check record/field limits and canonical base64 enforcement.
3. Review/approve as operator, admit with that same operator, then replay exact input. Refresh/discover after simulated response loss. Assert one occurrence admission, one statement, one observation per data record, no generated match and unchanged ledger sequence. Concurrent admission and changed-payload replay must not duplicate effects.
4. Change relevant source/configuration after approval; expire approval; remove operator authority; cross book/entity scope. Observe explicit rejections before effects. Re-parse only unadmitted occurrences; reject reinterpretation after admission. Confirm existing JSON imports remain unchanged and overlapping new occurrences are refused, not deduplicated.
5. Drive the UI at narrow width/200% zoom with keyboard. Confirm every row/diagnostic is reachable, form mapping survives a retry, failed reads do not switch the selected source, cross-book selection clears drafts, and downloads reproduce the retained artifacts.

Still out of scope: SIE, bank/provider connectors, native provider profile certification, optional-column inference, foreign-currency conversion, inferred balances/VAT/company facts, arbitrary overlap maps, multi-chunk import/leases/cancel/compensation, admitted-source replacement, automatic matching/posting, new residual authority, archive certification and actual-company activation/completeness.

## Root review amendment

Unapplied0510 now uses explicit `(occurrence).field` composite access in the SQL-language `intake_summary`. Approval expiry is assigned after the book lock and validation, immediately before approval creation. No other behavior changed. Source review only; no SQL/runtime check was run.

0510 file SHA-256: `af448df45946719d89e4e23f7a53d5b4ab0b81de43a50c4d953abb3cb873f43d`.

## Metadata-only occurrence recovery: failure contract before implementation

A known-ID original read currently depends on object storage for object-backed files. A storage
outage or failed original integrity check must not hide the retained occurrence metadata.

- Reuse the authorized, book-scoped `get_source_storage` owner and its shared book barrier;
  unknown or foreign occurrences still refuse.
- Project an explicit public allowlist, never spread the internal storage response. Do not expose
  original bytes, private object descriptors, approval IDs or approval command/receipt material.
- Keep complete preview references within the existing50-preview bound; never truncate history.
- Keep `originalAvailability: not_checked` explicit. Retention metadata and historical admission
  references do not prove current object availability, current readiness or fresh authority.
- The existing original-content endpoint retains its storage failures and byte/hash checks.
  The metadata read never calls storage, parses, admits, matches, posts or creates an artifact.
- Null admission means no retained admission, not eligibility to admit. Existing selected-preview
  reads remain the owner of full interpretation details and separate currentness.

### Implemented metadata-only read

`GET /v1/entities/:entityId/books/:bookId/source-occurrences/:id/metadata` and read-only MCP
`source_get_occurrence_metadata` return the committed public occurrence (including original
hash/length/media type and retention receipt), latest/all preview IDs and an admission summary.
Admission reuses the existing safe review-summary contract: preview/digest/time/actor,
statement/evidence IDs and checkpoint. It excludes the approval ID and all admission command
receipts. The retention receipt is provenance, not an approval bearer.

The response always includes `originalAvailability: "not_checked"`. There are no content bytes,
private object keys/descriptors or approval tokens. This is a metadata recovery read, not a
successful download, an availability probe or a new artifact. It remains usable if object
storage cannot be reached because the statement only calls the existing authorized
`get_source_storage` database owner once under its shared book barrier, then explicitly builds
an allowlisted result. It never invokes the runtime storage adapter. The existing owner's inline
base64 may be constructed inside PostgreSQL, but is excluded from the returned statement result.
All preview IDs remain in retained reverse-ordinal order, bounded by the existing50-row invariant.

The original-content endpoint and storage integrity checks are unchanged and retain their errors.
The current web workspace still uses that original-content endpoint; this packet adds a backend
recovery consumer, not an unimplemented UI fallback. Selected-preview detail/currentness and
interpretation/admission authority remain with their existing owners.

Root integration uses the existing `sourceIntakeStatements`, `SourceIntakeCapabilities`,
`SourceIntakeApi` and `SourceIntakeHandlers` composition. Add only the shared capability binding:

```ts
source_get_occurrence_metadata: bindCapability(Capabilities.source_get_occurrence_metadata, "getSourceOccurrenceMetadata", (input) => [
  scopeParameter(input.scope), input.occurrenceId,
]),
```

No migration, storage adapter, schema table mapping or new package export is required. The three
local TypeScript owners are the source-intake contract, statement fragment and HTTP handler.
Pending runtime observations if separately authorized: foreign/unknown IDs; empty/multiple/50
preview references; unadmitted/admitted summaries; no secret or byte fields; unavailable/missing/
corrupt object does not block metadata; and original download still fails rather than pretending
availability. Source inspection is not runtime verification.

Owned checks: `oxfmt --write` passed for three TypeScript files and two domain documents;
`oxlint` passed for the three TypeScript files with zero warnings/errors. Source comparison
confirmed the existing storage query and original-content handler remained unchanged. No shared
typecheck, tests/helpers/fixtures, SQL/runtime/object-store access, UI, migration, provider,
external/dependency/deployment or VCS action was performed. Root owns shared binding/type checks.

## Forward5900: exact source-mapping currentness

### Failure contract before implementation

A preview may map retained source S to ledger account A before either has a bank mapping. A later
statement can map S to B. Existing account-A dependencies remain equal because that import only
increments B's source revision. The preview GET/capture can then claim current dependencies and
fresh approval can succeed even though the unchanged bank importer refuses the conflicting map.

- Reuse the existing two-way mapping conflict policy: A mapped to another source or S mapped to
  another account. Bind the check to this book, exact retained occurrence and mapped account.
- Unknown/foreign occurrence and null mapped-account inputs fail closed. No cross-book lookup,
  global source revision, full-inventory dependency or automatic remapping is introduced.
- Apply the private predicate to fresh approval/admission and separate GET/capture currentness.
  Check under the existing book barrier that orders source imports. Do not broaden the immutable
  dependency object/digest; unrelated T-to-B imports must not stale S-to-A through this check.
- Preserve exact-key replay before fresh checks and already-admitted recovery before admission
  checks. Old saved approvals/captures remain historical results, not fresh eligibility claims.
- Preserve3200 supersession and3900 capture allowlists/currentness. Old artifact bytes, previews,
  retained originals, reviewers, receipts and original bank-import fence remain unchanged.
- Reparse still uses the existing parser: conflicting mappings produce its source_mapping
  diagnostic; only an explicit corrected mapping can change a new interpretation.
- Do not change public contracts, role checks, routes, storage, posting authority or UI.

### Implemented source and review handoff

`5900-source-mapping-currentness.sql` adds private
`intake_source_mapping_current(book, occurrenceId, accountId)`. It returns a boolean from the
exact retained book/occurrence plus the existing two-way `bank_sources` conflict predicate. It
returns false for missing/foreign occurrences or a null account. It adds no account-role policy,
inventory version or dependency field. The predicate takes no locks itself; all four callers
already hold the shared/exclusive book barrier used to order native source imports.

Fresh0510 approval and admission extend their existing stale-dependency condition with this
predicate. A cross-account mapping conflict now refuses before new approval or evidence/import
work.3200 preview GET and3900 new review capture separately AND the same predicate into their
existing currentness flag. Capture still succeeds for stale history with the flag false. Its
saved bytes/digest describe that capture, never a retroactive rewrite of an older capture.

The replacement functions were taken from their latest owners:0510 approve/admit,3200 GET and
3900 capture. Each function diff adds only its predicate use to the existing currentness check.
Successful command replay remains before new checks; the admission's existing admitted-result
recovery branch remains before the fresh guard.3200 supersession check/approval withholding and
physical supersession guards remain, as do3900 reviewer/admission allowlists, full-history bounds,
canonical bytes/hash/length and immutable artifact insertion. Original importer conflict checks
remain the final admission authority. No public function signature or grant changes; the new
private helper is revoked from PUBLIC and runtime.

The original `intake_dependencies` body, preview dependencies/digests, parser bytes/diagnostics,
retained mappings and source revisions are unchanged. Only an actually conflicting mapping adds
staleness: an unrelated T-to-B import cannot change this predicate for S-to-A. Other existing
staleness reasons still apply independently. An already established matching S-to-A map is not a
new conflict; imports on A may still change its original sourceRevision dependency as before.

No contract, HTTP/MCP, query registry, storage adapter or UI wiring is required. Existing consumers
already read `dependenciesCurrent`; existing reparse continues to require an explicit reviewed
mapping and retains its original source_mapping diagnostics. Root owns common plan/status notes.

Source-reviewed cases: previously unmapped S-to-A followed by S-to-B; A occupied by another
source; matching mapping; unrelated source/account mapping; missing/foreign occurrence and null
account; old-key approval/admission/capture replay; fresh stale checks; admitted recovery;
superseded preview; and old capture/preview identity preservation. No runtime/concurrency or SQL
compilation/application evidence is claimed. Migration execution requires separate authorization.

Owned validation: formatting passed for the two focused domain documents. Source diffs confirmed
only four predicate uses plus the private helper; original0510/3200/3900 files stayed unchanged.
No TypeScript changed, so no owned TypeScript lint/typecheck was needed. No tests/helpers/fixtures,
SQL compilation/execution/application, runtime/provider/storage access, common wiring/docs, UI,
dependency/deployment or VCS action was performed. Root retains integration and independent review.

## Key-only retention recovery: failure contract before implementation

A committed `source_retain` response can be lost before its caller receives the generated
occurrence ID. The public retry requires original bytes even when2700 can recover a completed
object upload without touching storage. Existing metadata GET requires the missing occurrence
ID; posting, correction and owner command readers do not accept retention operations.
Inventory is not exact request-key recovery: a second successful retention command can return
an existing occurrence whose frozen receipt belongs to the original actor and key.

- Read an existing committed result only. Current scoped authorization and a book SHARE barrier
  precede exact original-key validation and lookup. Require command receipt book, key, CURRENT
  actor and operation `retain_source` or `retain_source_object`.
- Return the existing frozen `SourceOccurrence` result without changing its provenance. Ownership
  is the command receipt actor, never `result.retainedBy` or the result's original receipt actor/key.
- Recover both inline and completed object retention without original bytes, file or object store.
  Never call upload completion, fetch storage, create a receipt or mutate an occurrence.
- Unknown, foreign-actor/book, unrelated-operation and pending-upload keys cannot disclose a
  result. NotFound describes absence at this check, not terminal failure or permission for a new
  key; a late request can still commit.
- Validate8–128-character request keys using the existing idempotency-key format. Exclude request
  payload/digest, private object descriptors, preview/approval/admission data and any current
  availability claim. The two allowed owners already save only safe occurrence metadata.
- Preserve historical SQL owners, replay, source limits, approval authority and storage behavior.
  No new artifact, table, generic receipt export, UI workflow or permission expansion beyond the
  scoped read. SQL/runtime/concurrency observations remain separately authorized gates.

### Implemented6300 read and integration handoff

`6300-source-retention-recovery.sql` adds `recover_source_retention(text,jsonb,text)`.
`GET /source-retention-requests/:key` and read-only MCP `source_recover_retention` return the
existing `SourceOccurrence` schema. The input is only current scope and original request key.
The recovered ID can then address the existing metadata or original-content getter.

The read selects `command_receipts.result` only for the current actor, exact book/key and the
`retain_source` / `retain_source_object` operation allowlist. It returns that saved JSON unchanged.
A successful duplicate-retention command can therefore recover an occurrence whose retainedBy
and original receipt belong to a different actor/key; those fields remain historical provenance.
No current approval, admission, preview state or original-availability claim is appended.

Only committed command receipts count. A pending `source_uploads` row is not completion and is
never completed by this read. Unknown keys, another actor's keys and unrelated receipt families
produce the same NotFound message: absence is non-final and is not permission to use a new key.
The scoped book SHARE barrier makes lookup consistent with the existing book-write workflow;
it does not prevent a later request from committing after this read ends.

The existing `SourceIntakeApi`, `SourceIntakeHandlers`, `SourceIntakeCapabilities` and
`sourceIntakeStatements` maps contain the additions. No new module export or shared API/query
composition is required. Root owns the application capability binding:

```ts
source_recover_retention: bindCapability(Capabilities.source_recover_retention, "recoverSourceRetention", (input) => [
  scopeParameter(input.scope), input.key,
]),
```

No application/storage adapter, historical migration, generic receipt reader or UI changed.
Owned formatting/lint and source inspection are static checks only. Runtime observations remain
pending for lost inline/object-retention responses, duplicate existing occurrences with new
actor/key provenance, pending and late uploads, unrelated/foreign keys and unavailable storage.
No tests, SQL compilation/application, provider operations or runtime observations were run.
