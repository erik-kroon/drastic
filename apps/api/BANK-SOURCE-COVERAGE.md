# Bank source interval coverage (2000)

## Existing owners and bounded scope

Existing1300 `reconcile_bank_capacity` already reports per-account item capacity and opening/
closing controls. It refuses partial statement boundaries and does not capture a cross-account
required inventory or exact downloadable report bytes. Existing0930 closing inventories already
retain operator-reviewed expected bank accounts and evidence.0510 occurrence discovery is not a
required-account inventory.2000 reuses the closing inventory and existing bank statement bodies;
it adds only a source-interval diagnostic snapshot, not another declaration or matching engine.

## Failure cases recorded before implementation

- Authorize before any scoped lookup/count. Foreign inventory, period, account and evidence
  identities must not leak. Read/capture locks follow admission then the book barrier.
- Input names an existing closing inventory and explicit inclusive start/end dates equal to its
  owning accounting period. The latest inventory is required for a new capture. Saved historical
  inventories remain embedded in old report bytes. No invented source inventory or zero family.
- Pin every declared account and every currently mapped source account. Missing mapping, missing
  statements, undeclared mapped accounts and an empty expected list remain visible review gaps.
- Reuse all intersecting statements, preserving full original intervals/rows even when a report
  boundary cuts through a statement. Never synthesize a boundary balance by summing partial rows.
- Inclusive intervals are adjacent only when next.startsOn = previous.endsOn + 1 day. Overlap
  includes a shared date. Find union gaps using the furthest covered date, not the previous row
  alone; nested overlaps must not create false gaps or discard records.
- Compare closing/opening balances only for adjacent same-source/same-currency statements. Gaps,
  overlaps and cut boundaries do not authorize inferred balances or automatic reconciliation.
  Existing admission rejects overlap; diagnostics still surface any retained overlap if present.
- Statement completeness remains an explicit retained assertion. Independently retain/check each
  full statement opening + normalized movement = closing. Do not combine offsetting diagnostics.
- Pin inventory identity, period/configuration, source mappings/revisions, all relevant account
  versions and the committed ledger cutoff. Later imports, mappings, inventory/configuration,
  matching/unmatching or postings conservatively stale the report. Report capture alone does not.
- Fail before partial capture above100 declared/mapped union accounts,200 intersecting statements,
  10000 total retained rows,200 saved reports or8 MiB JSON. Old report bytes remain recoverable if
  live scope later exceeds bounds; currentness becomes false, not an unreadable historical artifact.
- Report/bytes/hash/length/command receipt commit together. Same-key replay returns the original
  result after current authorization, before changed dependencies or limits. No financial write.
- No automatic deduplication, overlap selection, waiver, matching, opening entry or closing-gate
  changes. Even no detected interval gaps does not prove full-company/provider source coverage,
  legal applicability or financial-close readiness.
- UI validates input/output and exact downloaded bytes/hash/identity, preserves failed inputs and
  mounted retry keys, and provides saved discovery/GET. Reload does not preserve unsent forms.
- No tests/test edits, checks/builds/toolchain, database/migration execution, browser/server,
  dependency/external actions or commits are authorized. All behavior remains runtime-unverified.

## Implementation and root integration

Implemented source only:

- `apps/api/migrations/2000-bank-source-coverage.sql` (new, unapplied).
- `packages/contracts/src/bank-source-coverage.ts`.
- `apps/api/src/db/statements/bank-source-coverage.ts`.
- `apps/api/src/transport/http/routes/bank-source-coverage.ts`.
- `apps/web/src/components/bank-source-coverage/{panel,review,copy}.tsx` / `.ts`.

No existing migration, source admission, matching, financial posting, reconciliation or closing
function was replaced. This report does not satisfy a closing check and creates no source mapping.

### Shared composition

1. Export `"./bank-source-coverage": "./src/bank-source-coverage.ts"` from contracts.
2. Add `BankSourceCoverageApi` to shared `Api`; spread `BankSourceCoverageCapabilities` into
   the shared capability catalog.
3. Spread `bankSourceCoverageStatements` into the database statement map and compose
   `BankSourceCoverageHandlers` in HTTP.
4. Bind the three capabilities below. Arguments exclude the authenticated token, which the
   existing `bindCapability` supplies.
5. Mount `BankSourceCoveragePanel({book,locale})` under Accounts. It remounts local state when
   the book changes. Root must preserve its existing authenticated-identity reset/cache boundary.

| Capability | Statement | Arguments after token |
| --- | --- | --- |
| `bank_create_source_coverage` | `createBankSourceCoverage` | `scopeParameter(input.scope), input.idempotencyKey, JSON.stringify(input.input)` |
| `bank_get_source_coverage` | `getBankSourceCoverage` | `scopeParameter(input.scope), input.id` |
| `bank_list_source_coverage` | `listBankSourceCoverage` | `scopeParameter(input.scope)` |

| Method / scoped route | Input / output | SQL function |
| --- | --- | --- |
| POST `/api/v1/entities/:entityId/books/:bookId/bank-source-coverage` | `CreateBankSourceCoverage` → `BankSourceCoverageReport` | `create_bank_source_coverage(text,jsonb,text,jsonb)` |
| GET same collection | `BankSourceCoverageList` | `list_bank_source_coverage(text,jsonb)` |
| GET same collection + `/:id` | `BankSourceCoverageView` | `get_bank_source_coverage(text,jsonb,text)` |

POST requires the existing `Idempotency-Key` header. It records a diagnostic report and command
receipt only; its capability is not marked read-only. GET capabilities are read-only. Normal
scoped book access may capture/report these existing facts; only the existing operator-only
closing-inventory workflow may change the source declaration. There is no new approval surface.

The private `bank_source_coverage_reports` table stores `(book_id,id,inventory_id,body,content,
sha256,byte_length)`. If maintained Drizzle mappings are needed, root owns them. Runtime has
only the three scoped function EXECUTEs, no table/helper grants. No service, adapter, dependency
or direct table write is added to the application runtime.

### Input and inventory reuse

`CreateBankSourceCoverage` requires `{inventoryId, startsOn, endsOn}`. The inventory is the
latest retained `closing_inventories` row for its owning period; the requested dates must equal
that period's dates. This deliberately narrow first slice does not extend a period declaration
to another date range. The existing closing readiness read exposes the current inventory ID.
An absent inventory must be declared through its existing reviewed workflow, not invented by
this report. A later replacement inventory makes existing reports historical.

The report embeds the retained `ClosingInventory` contract, period/version, and the union of
all declared bank account IDs and all currently mapped `bank_sources` accounts in the book.
Mapped accounts omitted from the declaration remain visible even if they have no statement in
the interval. Their relevance is a review question; this slice has no dated source applicability
model and does not silently classify them as inactive/not required. Declared accounts without
a mapping return null source identity/revision, not a fabricated revision zero. An empty declared
account list is an explicit diagnostic, not proof that the bank source family is empty.

Only admitted synthetic statements are inspected. Unadmitted source occurrences, parser
previews, external provider coverage and unknown source families are not inferred from this
report. All those inventories remain owned by their existing workflows. No file/feed/parser or
provider-reference contract is added.

### Inclusive boundaries and independent balances

Every intersecting retained statement is included with its complete original `BankStatement`
body and all original rows; this uses the existing `bank_statement_body`. A statement crossing
a requested boundary is not clipped or split. All its normalized observations contribute to its
own movement check, not to a fabricated requested-boundary balance.

Per account:

- `gaps` are exact inclusive dates not covered by any retained statement interval. The sweep
  tracks the furthest covered day, so nested overlaps do not create false gaps.
- `overlaps` preserve every overlapping statement pair and intersection. Sharing one date is
  overlap because both boundaries are inclusive. Current native admission already refuses new
  overlaps; this report preserves and exposes any retained overlap rather than assuming it absent.
- `adjacentBalances` compares each pair with `next.startsOn = previous.endsOn + 1 day`, equal
  source-bank identity and the same book currency. `differenceMinor = next opening - previous
  closing`. Those are independent retained checkpoints, not computed running balances.
- Gaps have no balance comparison. Overlap does not authorize a preferred statement or an
  automatic union of movements. Empty adjacent-pair arrays mean no supported comparison exists,
  not that missing balances equal zero.
- Account `openingMinor` is available only when exactly one retained statement covers the
  requested first day and starts exactly there, with matching source identity/currency. Closing
  uses the equivalent end condition. Otherwise the value is null with an explicit diagnostic.
- Each full statement retains `movementMinor`, normalized row count and
  `movementDifferenceMinor = retained opening + normalized movements - retained closing`.
  Completeness assertions, boundary cuts, identity/currency issues, movement differences and
  source/normalized row-count differences remain distinct diagnostics.

No total across source accounts is used to cancel a gap, balance difference or overlapping row.
`hasReviewGaps:false` means no detected issue in these bounded retained controls only.
`coverage:"not_established"` and `financialCloseReady:false` are unconditional. This is not a
bank↔ledger reconciliation, a bank-family applicability decision, statutory readiness or a new
technical-close permission. Existing bank reconciliation and closing gates are untouched.

### Cutoff, bytes and recovery

Capture follows scoped admission with a book `FOR UPDATE` barrier. Currentness reads use the
same book's shared barrier. The dependency digest binds the selected and latest inventory,
owning period/date/version/lock state, book profile/writer/currency/committed sequence, the
complete declared/mapped account set with labels/versions, every source mapping/revision,
and each intersecting statement/evidence identity/hash. Source revisions already advance when
matching/unmatching changes their retained relationships; those changes conservatively stale
this source-only report as well. Unrelated ledger posts can also stale it. Creating another
coverage report does not itself change the dependency digest.

Report body, canonical exact UTF-8 JSON content, independent byte SHA256, byte length and the
idempotent command receipt commit together. The report digest identifies the report body;
artifact SHA256 identifies its exact downloaded bytes. Same-key replay returns the original
report before checking current inventory or capture bounds. GET never recomputes saved report
contents. It returns saved bytes and separate `dependenciesCurrent`; if live input exceeds the
bounded read scope this flag is false and saved bytes remain readable.

Discovery returns every saved report, bounded by the200-report insertion limit, with no hidden
pagination/truncation. The UI preserves failed forms and mounted retry keys, supports direct ID
lookup and saved discovery, and validates byte length/hash plus decoded report identity/scope
before displaying/downloading the retained artifact. It renders values from those retained
bytes. The download carries the original content, never browser-recalculated monetary values.
Sensitive source rows and evidence identifiers are disclosed before download. Unsaved inputs
and retry maps are not durable across reload; recover any committed capture through discovery.

## Source review and unperformed proof

Source inspection traced admission/book scoping, original immutability, latest-inventory scope,
bounded complete enumeration, inclusive adjacency/gap/overlap logic, independent stated balance
comparisons, null checkpoints, dependency currentness, atomic artifacts/receipts, and SQL to
contract to UI field correspondence. Failure-case reasoning included missing/empty inventories,
missing mappings/statements, one-day gaps, touching intervals, nested overlaps, statement cuts,
balance differences and later source/inventory/ledger changes. These are source conclusions,
not executed tests or observed runtime acceptance.

No tests/test edits, checks/builds/toolchain, database or migration execution, browsers, servers,
external actions, dependency changes, commits or nested delegation occurred. Runtime SQL,
response decoding, concurrency, failure recovery, download and accessibility behavior remain
unverified. Shared registration/mounting and any later authorized proof remain root-owned.

## Root source integration

Contracts exports, shared API/capability catalog, bindings, statement dispatcher and HTTP handlers are connected. Accounts → Statement coverage and the legacy workspace mount the report UI. Independent source review traced inclusive union/gaps, shared-day overlaps, true adjacent balance comparisons, missing boundaries, declared/mapped union, bounds and currentness; no concrete blocker was found. Existing closing gates remain unchanged. No runtime or schema execution was performed.

The report inspector retains previously verified cached bytes after a failed refresh. Currentness is unknown during errors, fetching, paused requests or before a successful post-mount read; last successful status is described as such. Download still uses the retained exact artifact. Source-only follow-up; no checks or runtime verification.
