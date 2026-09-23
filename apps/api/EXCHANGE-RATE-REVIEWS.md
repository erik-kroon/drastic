# Manual exchange-rate observations and conversion reviews

## 1900 failure cases and decisions — before implementation

This FX-01 subset retains operator-reviewed, explicitly sourced directional rates and exact
synthetic conversion reviews. It never posts invoices, payments, FX gains/losses or revaluation.
No feed retrieval, company/legal activation, automatic date selection or fallback is added.
No checks, tests, DB execution or migration application are authorized for this wave.

Failure cases:
- Foreign-book evidence/observations/revisions and stale revision digests must fail before writes.
- Missing rate, reversed direction, same-currency pair, target other than current book currency,
  wrong effective date, missing scale, zero/negative/decimal/oversized rational parts must fail.
  Explicit rate1 is valid only when entered and reviewed; never supply it by default or invert.
- Only operators may retain or revise rates; evidence and review evidence are both mandatory.
  Ordinary capture is an artifact calculation, not human approval or posting authority.
- Concurrent revisions compare the current digest under the book barrier; retain old revisions.
  Conversion pins the exact current revision; older saved reviews remain readable after revision.
- Replay returns original results before freshness checks; a reused key with a different actor,
  operation or payload conflicts. Observation source keys and capture receipts support recovery.
- Nonnegative original amounts and positive rational major-unit rates are explicit. Source scale
  and book scale must be0–6. Compute exact integer numerator/denominator first; no floating point.
- Named policy `synthetic_half_up_nonnegative_v1`: divide exact target minor units, round ties
  upward. Retain quotient, remainder and signed residual numerator over the same denominator.
  Rounded output over the existing38-digit MinorUnits bound fails; no clipping/approximation.
- Retain calculation formula, inputs, source hashes, operator revision receipt and capture receipt.
  A zero remainder is not source completeness, legal suitability or financial-close readiness.
- Immutable JSON bytes/hash/length remain unchanged; live currentness is separate and false after
  a rate revision or book currency/profile/writer change. Unrelated ledger activity need not stale
  a pure calculation. Currentness is not rate-market freshness or permission to post.
- Bound inventories to200 observations,20 revisions each and200 conversion reviews; lists must
  be complete or fail, never truncate silently. Artifacts are at most1MiB.
- UI validates response scope/identity, preserves retry keys on ambiguity, discovers saved records
  and verifies retained artifact bytes before download. No browser arithmetic or rate defaults.

Implementation shape: new1900 tables/functions, one owned contracts module composing domain
money primitives, local routes/statements and a bounded rate/revision/capture/recovery UI. Root
owns exports, shared query/API/capability composition and routed mounting. Existing1700 commerce,
1800 basis guards and every historical migration remain unchanged.

## Implemented source and required root composition

This is implemented source only. Migration1900 is unapplied; no check/test/browser/DB command
was run. No prior migration,1700 commerce logic or1800 subledger guard was changed.

### Files

- `packages/domain/src/exchange-rates.ts`: transport-independent currency/scale, positive rational,
  rate terms, named synthetic rounding policy and exact result schemas. Existing money primitives
  remain unchanged.
- `packages/contracts/src/exchange-rates.ts`: commands, immutable revisions/reviews, artifact views,
  `ExchangeRatesApi` and `ExchangeRateCapabilities`.
- `apps/api/migrations/1900-exchange-rate-reviews.sql`: immutable observation/revision/review storage,
  scoped admission, exact calculations, receipts, bounded discovery and historical artifact reads.
- `apps/api/src/db/statements/exchange-rates.ts`: `exchangeRateStatements`.
- `apps/api/src/transport/http/routes/exchange-rates.ts`: `ExchangeRatesHandlers`.
- `apps/web/src/components/exchange-rates/{panel,forms,views}.tsx` and `copy.ts`: scoped English/Swedish
  rate retention/revision, selected-revision conversion, saved discovery, inspection and download.

Root must add exports `"./exchange-rates": "./src/exchange-rates.ts"` to BOTH domain and contracts
package manifests. Add `ExchangeRatesApi` to the shared API, `ExchangeRateCapabilities` to the
capability catalog, `exchangeRateStatements` to the dispatcher, and `ExchangeRatesHandlers` to
HTTP composition. Mount `ExchangeRateReviewsPanel` with `{book, locale}` at an authenticated book
surface; it supplies its own entity/book-keyed local-state boundary. No DB maintenance mapping is
needed because all application access goes through approved functions.

Base route: `/api/v1/entities/:entityId/books/:bookId/exchange-rates`.
SQL parameters below are token followed by scoped JSON and the listed arguments.

| Operation | HTTP suffix | SQL function | Remaining parameters | Result |
|---|---|---|---|---|
| createExchangeRate | POST `/` | create_exchange_rate | key,input JSON | ExchangeRateRevision |
| reviseExchangeRate | POST `/:id/revisions` | revise_exchange_rate | id,key,input JSON | ExchangeRateRevision |
| getExchangeRate | GET `/:id` | get_exchange_rate | id | ExchangeRateView |
| listExchangeRates | GET `/` | list_exchange_rates | none | ExchangeRateList |
| captureConversionReview | POST `/reviews` | capture_conversion_review | key,input JSON | ConversionReview |
| getConversionReview | GET `/reviews/:id` | get_conversion_review | id | ConversionReviewView |
| listConversionReviews | GET `/reviews` | list_conversion_reviews | none | ConversionReviewList |

Ordinary automation bindings (binder supplies token):

| Capability | Dispatcher key | Remaining binding parameters |
|---|---|---|
| fx_list_rates | listExchangeRates | scopeParameter(input.scope) |
| fx_get_rate | getExchangeRate | scopeParameter(input.scope),input.id |
| fx_capture_conversion | captureConversionReview | scopeParameter(input.scope),input.idempotencyKey,JSON.stringify(input.input) |
| fx_get_conversion | getConversionReview | scopeParameter(input.scope),input.id |
| fx_list_conversions | listConversionReviews | scopeParameter(input.scope) |

Rate creation/revision intentionally have no ordinary MCP capability. Their SQL admission calls
`authorize(...,true)` independently of UI role visibility. Capture/read authorization remains the
ordinary scoped member path and grants no approval. All runtime table writes/private helpers
are revoked; only the seven authenticated entrypoints receive runtime EXECUTE.

### Exact meaning and safeguards

Rates use target major units per source major unit. Target must equal the selected book currency;
same-currency pairs are refused. Positive numerator/denominator each use canonical strings of up
to38 digits. Currency codes are syntactically three uppercase letters, not a legal currency table.
Source retrieval/effective dates are explicit observations, not automatic retrieval or freshness
attestations. Source evidence, review evidence, hashes, locator, rationale and operator receipt
remain in each immutable revision. Evidence roles can refer to one retained document when that
document actually contains both facts; this is not a two-person approval protocol.

A stable per-book source key identifies an observation. Revisions compare the exact current digest
under the book barrier and link the previous digest. Revised pair/date/source terms are explicit
corrections, never changes to old bytes. New conversion requires the exact CURRENT revision digest,
matching effective date and direction. Old revisions remain readable but cannot create a new
capture. No nearest-date selection, implied source hierarchy, silent inversion or rate1 fallback
exists. A caller may explicitly review a rational1 for different currencies; it is not a default.

For original nonnegative minor amount A, rational rate n/d, original scale s and book scale b:

```text
N = A * n * 10^b       D = d * 10^s
q = div(N,D)           r = mod(N,D), with 0 <= r < D
rounded = q + (2*r >= D ? 1 : 0)
residual = (N - rounded*D) / D
N = rounded*D + residualNumerator
```

SQL numeric owns all arithmetic. Decimal scale factors are constructed as exact integer strings,
not floats. The rate is not reduced or rounded first. The policy is named
`synthetic_half_up_nonnegative_v1`: nearest integer minor unit, ties upward, nonnegative inputs
only. The exact numerator/denominator, pre-rounding quotient/remainder, rounded book minor amount
and signed residual fraction are all retained. A negative residual means rounding increased the
book amount. An exact division has remainder/residual0. Output over the existing38-digit bound
fails instead of clipping. Source scale0–6 is explicit; book scale0–6 comes from locked metadata.
The browser never calculates money or supplies an assumed scale/rate.

### Atomicity, recovery and currentness

All mutations use existing admission locks, then the book FOR UPDATE barrier. Existing command
replay occurs before freshness/profile/limit checks after current authorization. Tables, immutable
JSON bytes/hash/length and receipts commit together. Foreign evidence is refused and scoped FKs
bind observation/revision/source rows. Read locks use the shared book barrier. Inventories are
limited to200 observations,20 revisions per observation and200 conversion captures; complete
lists support discovery after reload. Every artifact is capped at1MiB.

The retained conversion includes its exact rate revision, original evidence hash, full book
currency/scale/profile/version/writer authority/epoch, named formula/policy and capture receipt.
`getConversionReview` returns immutable canonical UTF-8 JSON bytes plus SHA256/byte length and a
separate `dependenciesCurrent`. Only matching current revision digest and unchanged full book
basis make that boolean true. A new rate revision or relevant book change makes it historical;
an unrelated ledger posting does not stale this pure calculation. Historical bytes never change.
Currentness does NOT mean current market rate, source completeness, legal acceptance or readiness.

UI selection is explicit. It never silently switches a selected historical revision to the new
one. Read/capture responses are schema-validated and checked for selected book/record identity.
Download requires matching stored artifact identity, nested rate lineage, byte length and SHA256;
rendered calculation values come from those verified retained bytes. Same mounted input retains
its request key after uncertainty. After reload, use complete saved lists/source keys; in-memory
keys are not durable recovery. Starting another observation is offered only after confirmed save.
The existing evidence retention/inspection controls are reused; previously retained evidence IDs
can also be supplied directly.

### Limits, source review and open proof

`legalPolicyApproved`, `postingSupported`, and `financialCloseReady` remain false. No invoice,
payment, realized/unrealized gain/loss, carrying-basis release, partial allocation, monetary-item
register, revaluation/reversal or foreign-currency GL posting was added. FX-02/03 remain unsupported.
No complete close-family provider is activated by these review artifacts. A future financial FX
workflow must pin reviewed policy and provenance, enforce original/book currency conservation,
source capacity and human approval; generic balanced journals are not FX support.

Source review traced mathematical bounds/scaling/ties/zero, exact strings, scope/FKs, operator-only
rate decisions, concurrent revision serialization, stale/missing/date/direction refusals, receipt
replay, retained JSON integrity, optional historical recovery and all root composition points.
No tests or fixtures were written or changed. No tooling, checks, builds, DB/migration execution,
servers, browser, dependency installation or external actions occurred. SQL compilation, Effect
and UI types, actual requests, rollback/concurrency and downloaded bytes remain unverified.

## Draft/retry lifetime follow-up — failure cases before edits

- A background rate revision must not replace an edit draft or discard its unchanged-input retry
  key after an uncertain write. The edit target must be a user-captured revision, not live data.
- A conversion whose selected revision becomes historical must stay mounted with its draft and
  retry key. Old-key replay may succeed even though a fresh outdated capture must fail.
- A selection click during pending work must not silently replace the mounted form. Switching a
  started draft requires an explicit discard/reset action, with pending work blocking that action.
- Changing observation selection must not silently discard an in-flight form at the panel boundary.
  The inspector must own the chosen draft across background updates; parent navigation must wait
  until the user explicitly closes/discards it. No API/math or new state framework is introduced.

## Root source integration

Domain and contracts package exports, API/capability composition, fixed statements and HTTP handlers are connected. Reports → Exchange rates and the accounting tools workspace mount the scoped panel. Root source review traced exact integer scale conversion, remainder/half-up rounding,38-digit output refusal, authority/replay/currentness and byte-preserving downloads. Rate-refresh request preservation is receiving an owning UI fix. No source observation establishes runtime acceptance.

### Draft/retry lifetime result

The inspector now captures immutable revision objects on explicit edit/conversion selection.
Forms live outside the query-result conditional and do not receive live-digest keys. A rate
refresh, revision update, unavailable query or another opened observation cannot replace either
mounted draft. Panel observation navigation no longer keys/remounts the inspector; it changes
only the displayed read query. The draft shows its own pinned observation/revision. When another
observation is displayed, currentness is stated as unavailable rather than falsely current/stale.

Selection buttons cannot replace an occupied edit/conversion slot. Each form owns an explicit
"Discard draft and retry key" control disabled during pending writes. Only that action clears
its slot; users can then select a new revision. Stale drafts remain submit-capable for exact
same-key replay; the existing backend refuses new obsolete commands. Confirmed conversion reset
is explicitly labeled as another conversion with the same pinned revision. Revision target
currency stays pinned too. No API, arithmetic or SQL change occurred.

Changed source: `exchange-rates/views.tsx`, `forms.tsx`, `panel.tsx`, `copy.ts` and this handoff.
Source review traced background refresh, observation selection, pending/failed writes, replay and
explicit discard. No commands, checks, tests or browser execution occurred. Navigation away from
this feature still requires saved-record recovery after reload; in-memory retry keys are not
claimed as durable storage.

## Live status after refresh failure — before implementation

Cached verified review bytes must remain inspectable/downloadable after a failed or pending live
refresh. Cached dependenciesCurrent must not claim current or stale when the query has not
completed successfully after mounting, is fetching/paused, or is in error. Mark that live status
unknown separately; do not discard or regenerate the historical artifact.

Implemented source: currentness wording requires query success, idle fetch status and a completed
fetch after mount. Failure, fetching, paused or unrefreshed cached data shows unknown, not current
or stale. Previously verified bytes stay inspectable/downloadable. A successful match is explicitly
"at the last successful refresh." Only owned views/copy changed; no SQL/API/arithmetic changes.
No checks, tests or browser execution occurred.

## 2300 permanent withdrawal — failure cases before implementation

- A currently authorized operator may withdraw one currently selected observation with its exact
  current digest, retained withdrawal evidence and rationale. No ordinary MCP mutation may do so.
- Foreign scope/evidence, stale digest and conflicting receipt keys fail atomically. Concurrent
  withdrawal/revision/capture must serialize on the existing whole-book lock.
- Withdrawal is permanent and immutable. No delete, reactivation, hidden substitute/inversion,
  automatic new observation or historical revision/artifact rewrite is allowed.
- New revision/conversion commands must refuse after withdrawal, but successfully committed
  commands replay before withdrawal/freshness checks after current authorization. Historical
  reads and downloads remain available; saved conversion currentness becomes false.
- Live status must be an additive envelope, not inserted into a retained revision or conversion
  body. Lists must distinguish current usability from historical rate facts without truncation.
- Existing pinned edit/conversion forms and uncertain retry keys must survive withdrawal and
  background refresh. New selection may be blocked, but same-key receipt recovery stays usable.
- Withdrawal drafts/retry keys also remain pinned across background revision/observation changes;
  pending work cannot be replaced. Currentness unavailable is not the same as withdrawn/stale.

Plan: one immutable per-observation withdrawal event; an operator-only idempotent endpoint; a
private live usability helper; narrowly forward-replaced1900 revision/capture/read/list functions;
additive optional live envelopes and a local explicit withdrawal form/history notice. No posting,
legal activation, readiness change or new generic workflow framework.

## 2300 implemented source and integration

New `migrations/2300-exchange-rate-withdrawals.sql` adds one immutable withdrawal event per
observation, linked by scoped FK to the selected revision and retained evidence. It requires1900;
1900 and every other historical migration are unchanged. No event or artifact is updated/deleted.
The per-observation primary key and existing200-observation limit bound withdrawal history.

### Command and authority

`WithdrawExchangeRate = {expectedDigest, evidenceId, rationale}`.
`ExchangeRateWithdrawal` retains event ID, scope, observation ID, selected revision/digest, exact
input, evidence hash, permanent=true, timestamp, operator receipt and canonical digest.

- HTTP: POST `/api/v1/entities/:entityId/books/:bookId/exchange-rates/:id/withdrawals`, with the
  existing Idempotency-Key header; response `ExchangeRateWithdrawal`.
- Dispatcher `withdrawExchangeRate`: `withdraw_exchange_rate(token,scope JSON,id,key,input JSON)`.
- The existing `exchangeRateStatements` and `ExchangeRatesHandlers` modules include the new
  operation. Existing root spreads/group composition pick it up; no new package export, handler
  group, table mapping or route mount is needed. Root must accept the added contract endpoint and
  migration ordering. There is deliberately NO ordinary withdrawal MCP capability.
- SQL uses operator-only authorization, then book FOR UPDATE, then exact command replay before
  any freshness/withdrawal check. A successfully committed same-key withdrawal returns its original
  result. A fresh command against an already withdrawn observation fails StaleDependency.
- Operator authority is rechecked even for replay. Withdrawal remains possible after book profile
  changes because this is a permanent historical rate decision, not a posting/profile activation.

### Necessary forward replacements only

`revise_exchange_rate` and `capture_conversion_review` retain their1900 bodies with one added
`exchange_rate_require_active` call after selecting the existing observation. Their replay path
still precedes the guard: successfully committed pre-withdrawal revisions/captures remain
recoverable with their original key/actor/payload. New work refuses. Existing source keys cannot
be reused because observation identity and uniqueness remain immutable; a new independently
reviewed source key is required for a separate observation, never an automatic replacement.

`get_exchange_rate`, `list_exchange_rates`, and `get_conversion_review` are narrowly extended:

- `ExchangeRateView.usability?`: discriminated `{state:"active",withdrawal:null}` or
  `{state:"withdrawn",withdrawal:ExchangeRateWithdrawal}`.
- `ExchangeRateList.statuses?`: complete bounded array of `{observationId,usability}` alongside
  the unchanged immutable `items` revisions. Both arrays use the same locked observation inventory.
- `ConversionReviewView.rateUsability?`: the current observation withdrawal state, outside the
  retained `review` body and artifact. `dependenciesCurrent` additionally requires state=active.

These fields are optional only for historical envelope decoding. Live2300 SQL always emits them.
An active observation means only not withdrawn, not legal acceptance, market freshness, current
book/profile compatibility or permission to post. Old rate facts remain current *revision* history
while usability is separately withdrawn. Old conversion bytes/hash/length never change, even if
withdrawal occurred against a later revision than the review originally selected.

### Local UI and recovery

Owned changes are in `exchange-rates/{panel,views,copy}.tsx/ts`, plus new `withdrawal-form.tsx`.
Rate reads/lists validate withdrawal scope, identity and selected-current digest. Review reads
validate withdrawal scope and observation identity without incorrectly requiring a historical
review's older rate digest to equal the later withdrawal digest.

The operator explicitly opens a withdrawal draft pinned to the displayed current revision. It
requires evidence, rationale and a visible permanence acknowledgement. The draft/retry map stays
mounted outside query-result branches; a background revision/withdrawal or another displayed
observation cannot replace it. Pending work disables explicit discard; occupied slots cannot be
reselected. Success refreshes rate/review status but keeps the withdrawal receipt/draft visible.
The retained event and evidence are inspectable in rate history and saved conversion views.

Known active status gates only NEW edit/conversion/withdrawal selection. Existing pinned edit,
conversion and withdrawal forms remain mounted and retry-capable after withdrawal, so uncertain
same-key successful commands can recover. Fresh obsolete commands remain the backend's refusal.
Missing/failed/fetching/paused/unrefreshed usability is unknown, not active or withdrawn. Cached
verified artifacts remain downloadable. No calculator or financial authority was added to the UI.

### Source review and unchanged limits

Compared each forward replacement with1900: two admission calls, additive read envelopes, one
currentness conjunction; exact conversion arithmetic and retained bytes are unchanged. Traced
scoped FKs/authorization, replay-before-guard, concurrent book-lock ordering, one-event permanence,
old revision/capture recovery, artifact history, list completeness and pinned form lifetime.
No checks, tests, fixtures, toolchain, database/migration application, server/browser or external
actions were performed. SQL compilation, typing, actual concurrency/recovery and rendered behavior
remain unverified. FX02/03 and all legal/posting/readiness flags remain unsupported/false.
