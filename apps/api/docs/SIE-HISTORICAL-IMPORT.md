# Synthetic SIE historical-source staging (IMP-01/02/03 bounded slice)

## Current ownership

Application operations live in [application/sie/historical.ts](../src/application/sie/historical.ts), with shared dispatch in [capabilities](../src/application/capabilities/). The maintained DDL is [0001-schema.sql](../migrations/0001-schema.sql), [0002-integrity.sql](../migrations/0002-integrity.sql) and [0003-roles.sql](../migrations/0003-roles.sql). Historical financial import operations still return unsupported placeholders; this note is not evidence of an implemented import path.

## Historical implementation notes

The notes below record the superseded SQL implementation and its original validation. Migration filenames and statement-map instructions here are historical references, not installation steps or current ownership. Use the [API layout and replacement status](../README.md) and [local setup](../../../docs/local-development.md) for the current application.

This source slice retains original bytes through the existing source-intake authority. PC8 interpretation follows the [pinned primary SIE 4C format review](../../../docs/sources/sie-4c-review.md), section 5.8; a bounded subset parser is not whole-file SIE Group acceptance. It captures an immutable SIE4 interpretation with encoding and record/byte locators, original series/number/date, `#TRANS` final lines and distinct `#RTRANS`/`#BTRANS` correction lines. Unsupported records are retained in the original and identified by blocking diagnostics. The bounded parser accepts an explicit byte encoding and matching `#FORMAT UTF8`, `#FORMAT WIN1252`, or official SIE 4C `#FORMAT PC8` (IBM437). SIE4i and SIE5 remain unsupported. PC8 is decoded with a fixed one-byte code page, not a UTF-8 fallback. An unsupported file can be reviewed but not planned. Reparse creates another immutable interpretation for the same occurrence before staging; only its latest preview may seal or start a plan. No byte-decoding fallback occurs.

Only a retained occurrence whose `sourceSystem` starts with `synthetic_` can seal a plan; an actual source may be inspected but cannot be staged. The reviewed plan freezes a preview digest, one explicit source-to-native account mapping per referenced account, operator rationale, independently supplied `#IB`/`#UB` source-year/account comparisons, and optional independent historical open-item controls. Open items retain their source identity, asserted state, original/outstanding minor units and as-of date. An empty open-item list does not assert no unpaid items. The plan marks historical detail unreconstructable and financial admission unsupported. An existing account mapping is not permission to post SIE lines.

Runs stage the frozen historical source vouchers in ordinal chunks, with the exact frozen plan digest, a fifteen-minute renewable lease, monotonically increasing fence, immutable membership digests and command receipts. Chunk effects, cursor and receipt commit together. Recovery reads the run; pause/resume revokes stale fence tokens. Successful same-key replay returns the original chunk. `staged` means source facts were retained, **not** posted, reconciled, filed, or opened. No GL, period hold, business register, fiscal counter, source-payment, bank match, opening balance or financial correction is created or claimed. Existing manual-journal posting is not an OpeningSet authority: there is no single-opening-basis owner or historical open-item admission operation, and the current report comparison explicitly treats openings as all earlier postings (`migrations/4600-report-comparisons.sql`). Posting both prior movements and an equivalent imported opening would double count. D-06 actual source/version and D-04 profile facts are missing; actual-company import and financial effects remain gated. No source occurrence is rewritten. The normal posting/correction and bank authorities are unchanged.

### Bounded behavior and root integration

- A selected retained original is at most 512 KiB for this parser. Preview is at most 4,000 records, 500 vouchers and 1 MiB normalized JSON after migration 8900; no truncation. The separate staging chunk bound remains 200 vouchers, 2,000 transaction lines and 1 MiB payload. Chunk limit is 200 vouchers, 2,000 total transaction records and 1 MiB normalized membership payload. Object-store originals still use the existing source retrieval and integrity checks.
- Migration `7400-sie-historical-source-staging.sql` is forward-only after existing source-intake migrations. It owns five tables and eight scoped SQL operations. Review its approval and numeric-control comparisons before applying. SQL execution and runtime failure/retry proof remain open.
- Add `"./sie-import": "./src/sie-import.ts"` to `packages/contracts/package.json` exports.
- Import `SieImportApi` from `./sie-import` and append it to shared `packages/contracts/src/api.ts` group composition. There are **no ordinary MCP capabilities**: plan sealing, runs and staging remain operator-only HTTP commands.
- Import and spread `sieImportStatements` from `./statements/sie-import` in `apps/api/src/db/query.ts`.
- Import `SieImportHandlers` from `./transport/http/routes/sie-import` and add it to HTTP composition in `apps/api/src/index.ts`.
- Read after uncertain response with the same idempotency key or known run/plan ID. There is no new permission to generate another key for a possibly committed command.

Owned files: `packages/contracts/src/sie-import.ts`, `apps/api/src/application/sie-import-parser.ts`, `apps/api/src/db/statements/sie-import.ts`, `apps/api/src/transport/http/routes/sie-import.ts`, migration 7400, and this handoff. No tests were added under D-09. Type checking the owned parser/contracts alone passed; full API type checking requires root shared wiring and currently also reports unrelated in-flight worker errors. No financial/runtime behavior is verified.

### Forward financial and historical-register admission (7700–7730)

The earlier staging migration is not rewritten. `7730-reviewed-sie-source.sql` permits an explicitly reviewed external SIE4 subset occurrence (`sourceKind: reviewed_sie4`) as well as a synthetic one. The retained parser still supports only its declared bounded encoding/profile, and each source occurrence keeps its original bytes and identity. This is a generic product path, not a claim that a named company has supplied a file or that every SIE4 exporter has been verified. `financialAdmission: unsupported` on the staged plan/run remains an accurate **staging** statement; later financial admission needs its own basis and approved operation.

`7700-historical-basis.sql` selects one immutable full-history or OpeningSet basis for a book/fiscal year and cutover date. It requires a fully staged source plan, an independent bounded account control and a rationale. Full history must agree with the source #IB mapped by account; financial admission checks that #IB against the complete prior native ledger, then checks final #TRANS movements against independent source #UB. OpeningSet requires a separately sealed exact ledger plan whose lines match reviewed account controls. `post_historical_opening` executes that plan through the existing `approve_change`/`execute_change` authority and records its voucher. The voucher guard rejects a second opening, an earlier posting after cutover, or any ordinary posting before the selected opening. Selecting an OpeningSet after **any** earlier book voucher is rejected because current reports include all prior ledger postings. Reduced-history comparative detail is not reconstructed. A full-history SIE source with multiple fiscal years needs a separate reviewed year/source partition; no source-year ordinal is guessed from the calendar.

`7710-sie-financial-run.sql` accepts a fully staged, single-year full-history source. One frozen source voucher maps to one existing sealed ledger change and current approval. Each bounded chunk checks exact source date, account mapping, ordered signed final lines, plan digest, fence, lease and next ordinal before calling the ledger execution transition. Source `#RTRANS`/`#BTRANS` records stay immutable historical correction evidence but are not added to final `#TRANS` totals. The source reference, source-body digest, native voucher and ledger receipt persist together. An active or paused run fences unrelated voucher inserts. Chunks use stable idempotency keys; a pause/resume increments the fence. No backend transition fabricates an approval. Existing approved manual-journal plans must carry retained evidence; an account mapping alone does not create a ledger posting. Multi-year SIE files, source dimensions, unsupported encodings and unmatched opening/control totals fail closed.

`7720-historical-items.sql` admits a frozen, read-only source register with asserted open-item state, source payment and match identities, source dates or explicit unknown chronology (dated payments and matches do not prove invoice issuance order), distinct account/currency controls and bounded capacity. It checks outstanding versus original signed values, item/payment/match identity and match capacity. These historical facts **do not** consume live commerce or bank payment capacity and do not create new GL entries. An empty item list does not certify that a company had no historical unpaid items. Existing source-plan open-item controls were independently compared during plan seal. Actual source inventory and a reviewed bridge from historical items to live obligations remain company readiness work, not prerequisites for this machinery.

#### Root integration (shared files are not edited by this slice)

- Export `"./historical-migration": "./src/historical-migration.ts"` from `packages/contracts/package.json`.
- Import `HistoricalMigrationApi` from `./historical-migration` and add it to `Api` group composition in `packages/contracts/src/api.ts`. These commands remain operator-only HTTP operations; do **not** add ordinary MCP capabilities.
- Import/spread `historicalMigrationStatements` from `./statements/historical-migration` in `apps/api/src/db/query.ts`.
- Import/add `HistoricalMigrationHandlers` from `./transport/http/routes/historical-migration` in `apps/api/src/index.ts`.

The isolated local PostgreSQL smoke applied the full dirty-tree migration chain through 7730. Migration 7740 adds primary-source PC8 admission; a local PC8 byte sample decoded `Café` and retained two exact final source lines. The disposable cluster applied 7700–7740 and retained receipts; the subsequent full-chain run failed on a concurrently added unrelated legal AR migration after 8000. This does not prove its own migration chain complete. A disposable synthetic book then selected full history, started a run, prepared and approved a manual journal through the existing SQL operations, admitted one final source voucher as a posted ledger voucher with its retained receipt, and admitted an explicitly unknown/empty historical-register inventory. This is a local synthetic path, **not** a concurrent/retry, browser, actual source, legal, statutory or provider proof. `bun run --cwd packages/contracts check-types` passed on the owned contract files. Root wiring and full API type/build checks are pending integration. D-06/D-09 remain open.

### Saved preview inventory

Migration 8200 exposes `GET /v1/entities/:entityId/books/:bookId/source-occurrences/:id/sie-previews`.
It authorizes the book scope and returns the occurrence's complete inventory of at most 50
immutable previews, newest first. Each summary contains its ID, ordinal, encoding, parser
readiness and creation time. It exposes neither original bytes nor approval authority.
The company history screen uses these summaries to reopen saved inspections after a reload.
Parser readiness alone does not establish mapping, reconciliation or posting readiness.

### Customer review and staging

The `/history` company route now offers explicit account mapping, independent signed
opening/closing controls with source descriptions, and a review rationale through
TanStack Form. The form accepts source-identified open items and independent account/currency totals;
unknown payment state and missing detail remain explicit. Adding or clearing an item
or control draft is required before sealing. It does not claim that missing historical
detail was reconstructed. Sealing records a reviewed plan,
and separate controls start, pause, resume and advance its source-staging run. The UI
continues to distinguish staging from historical-basis selection and approved posting.
Migration 8300 adds saved plan/run identities to the scoped preview inventory for reload
recovery. Migration 8310 fixes JSON extraction precedence in compound control identities;
without it, plan sealing fails before comparing independent balances.

On 2026-09-24 an isolated workerd/PostgreSQL/R2 manual scenario retained and parsed one
synthetic PC8 source voucher. It rejected a mismatched closing control with InvalidJournal,
sealed corrected controls, replayed the same plan result, paused/resumed, staged one
voucher, and replayed its chunk without adding another. Browser inspection recovered the
plan/run from source inventory and retained the staged status after reload. These checks
do not prove financial cutover, actual-company migration or complete open-item handling.

Historical-register admissions can be recovered with `GET /sie-plans/:id/historical-items`.
The authorized read returns the immutable admission, or `null` when that book's plan
exists without an admission. A missing plan returns `NotFound`. This supports reload
recovery without persisting an admission response ID in the browser. Register
admission remains separate from financial posting.

### Browser financial migration

The history workspace exposes fiscal-year basis choices from `GET /historical-bases`.
Full history requires independently entered opening controls and an exact staged
source plan. Opening balances use `POST /historical-openings` to retain the controls,
prepare a ledger proposal and select the basis in one transaction. Approval and
posting remain separate through the existing journal review flow.

`GET /sie-runs/:id/financial-workspace` recovers the financial run and the latest
proposal for its current ordinal. `POST /sie-financial-runs/:id/proposals` builds
that proposal from retained final source transactions, preserving line order,
amounts and account mappings. It requires the current fence and ordinal. The
browser reviews and approves the resulting plan before passing it to the existing
financial chunk posting function. Pause/resume and receipts survive reloads.

`GET /sie-runs/:id/closing-comparison` compares the reviewed source closing controls
with native ledger balances through the selected fiscal year end, including
native accounts absent from the source controls. The book lock keeps the reported
ledger sequence and balances consistent. Matching balances are not a claim of
complete source records, tax correctness or company readiness. Existing profile
admission restrictions remain in force.

The staged-plan register form accepts supplied payments, source matches, and independent
payment/match totals through TanStack Form. Unknown dates and chronology remain explicit;
unadded drafts block admission. Saved receipts expose both the retained records and their
independent controls. Admission remains immutable and does not create ledger postings.

`POST /historical-bases/:id/proposals` prepares an unposted opening again after configuration
changes. It requires the expected current change-set ID, preserves the selected basis,
cutover and controls, and requires a new approval. Migration 8370 retains the old-to-new
proposal link and rejects replaced proposals at the ledger insertion boundary, including
after the replacement posts. Posted openings cannot be replaced. The original basis
decision remains intact; replacement rationale is retained with the new proposal evidence.

Migration 8380 requires source-derived proposals to post through their owning financial
run. Pausing a run does not permit direct execution of its prepared proposals. Existing
successful execution retries still recover their original receipts.

On 2026-09-24 local browser checks saved one synthetic payment and match with matching
independent controls, rejected an unfinished draft and missing controls, and recovered
all records after reload. Opening replacement checks exercised stale expected IDs,
same-request replay, browser replacement, successful approved posting, rejection of the
old proposal after posting, and cross-book denial. A separate source run rejected direct
execution while paused, posted through its owning run after resume, rejected a duplicate,
and reconciled at ledger sequence 1. These are scoped local observations, not production
or real-company acceptance.

### Public SIE4 source compatibility, not migration acceptance

Migration `8900` keeps the one-megabyte normalized-preview bound but raises the
retained preview inventory to 4,000 records/500 vouchers. The parser accepts
ASCII space/tab indentation before a `#` record tag while preserving the exact
original bytes, line text and byte locations. [Local-only public corpus and
Worker before/after receipts](../../../docs/plans/evidence/wave2-sie-public-compatibility.md)
show an official SIE Group exercise export captured as 3,490 records, 295 vouchers,
1,330 final transactions and 223 control records with no parser diagnostics. The
original was read back unchanged and same-key source/preview replay was stable.
Other public transfer and malformed samples retain their separate outcomes.
The third-party raw files are not committed because redistribution rights and demo
contact fields have not been cleared.

`ready` means a bounded source interpretation was retained without parser
diagnostics. It does **not** certify full SIE 4E completeness or grant staging or
financial authority. The published exercise export contains two source years, unpaired `#IB`/`#UB`
account sets and nonempty transaction dimensions. SIE 4C permits omission of
zero balances, but this source alone cannot prove an absent value is zero. Existing
seal and financial-run guards still require independent paired controls, one
reviewed source-year basis and supported dimensions; they were not bypassed to
make a public sample appear migrated. An actual previous-system export and its
independent controls, lawful use, fiscal profile and cutover decision remain D-06
and D-04 gates.
