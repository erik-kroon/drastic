# VAT return drafts — implementation contract and handoff

## Current ownership

Application operations live in [application/vat-returns.ts](../src/application/vat-returns.ts), with shared dispatch in [capabilities](../src/application/capabilities/). The maintained DDL is [0001-schema.sql](../migrations/0001-schema.sql), [0002-integrity.sql](../migrations/0002-integrity.sql) and [0003-roles.sql](../migrations/0003-roles.sql).

## Historical implementation notes

The notes below record the superseded SQL implementation and its original validation. Migration filenames and statement-map instructions here are historical references, not installation steps or current ownership. Use the [API layout and replacement status](../README.md) and [local setup](../../../docs/local-development.md) for the current application.

### Before implementation: authority, shape and failures

Scope: VAT-01/02 bounded immutable fact capture and calculated return-draft review. No active legal profile, full-return readiness, ledger posting, XML, external filing, or tax payment. Arithmetic has one TypeScript owner executed by the API Effect workflow. SQL owns admission, scoped evidence/ledger references, immutable revisions, stale-basis fencing and command receipts. Existing expense records/snapshots are never changed.

#### Caller and stored shape

Operator records a reviewed VAT fact revision with stable component key and expected prior digest. Facts retain source evidence, reviewer-basis evidence, sale/purchase/unsupported treatment, actual/synthetic class, currency, source net/VAT/gross, explicit registration/accrual/domestic/full-deduction opinions, reviewed tax point/date basis, and optional posted voucher plus exact journal line IDs. A purchase may pin an existing current expense source/review; SQL checks its amounts, evidence, class and voucher compatibility. Missing classifications/references remain explicit blockers, not assumed defaults.

Every fact revision is immutable; a new revision has the same record class and source key. A bounded read returns every current fact and its posted-line observations, reversal status, linked expense-review freshness, and a digest including current book sequence/profile/currency. The Effect workflow reads that basis, computes exact per-fact controls and synthetic contributions, then seals the result only while SQL holds the book barrier and verifies the same basis. A concurrent change rejects a new seal. A completed matching key replays the original result before a freshness check. No browser-provided calculation reaches the seal endpoint.

Actual mode remains a review: all actual rows are excluded from arithmetic contribution; actual totals are unavailable, not zero. Synthetic mode requires synthetic facts and synthetic book profile. Synthetic boxes sum exact minor units first; tax totals drop öre; box49 derives from reported boxes. Non-whole box05 aggregate blocks its reported value. Unknown other-box absence prevents a net49 claim. Source coverage and complete ledger reconciliation are always unestablished and filingReady/legalProfileActive are always false. Declared per-fact line controls cannot certify the whole book.

Snapshots pin the entire bounded basis and calculation; JSON downloads contain that stored record, not a filing artifact. Read/list supports reload discovery. Local request keys survive uncertain responses while mounted; durable saved results are found in the snapshot list, not claimed as browser storage.

#### Limits

At most 200 current source components, 20 revisions each; 500 saved drafts with explicit refusal rather than truncation (list is bounded and complete). At most 20 selected journal lines per fact. Negative/credit component amounts are not admitted; their evidence may remain in the kernel. No invoice-level rounding algorithm is introduced. Fact arithmetic uses exact gross=net+VAT and exact 25% control; unsupported fractions/mismatches remain visible exclusions.

#### Failure cases recorded before code

- Cross-book source/review/evidence/voucher/line references: reject before write or disclosure.
- General agent cannot attribute an operator eligibility review; direct REST recording requires current operator permission. Read/prepare never confers review or legal activation power.
- Missing/null registration, method, domestic eligibility, deduction, date, profile, coverage or absence of other boxes never becomes a supported default.
- Same key and payload replays original bytes after later source/ledger changes; changed payload/actor/operation conflicts. New keys cannot bypass expected source revision.
- Source key class is immutable; linking actual expense history to synthetic facts fails. Changed compatible source/review makes later basis stale without editing old drafts.
- Duplicate evidence/component locators or overlapping journal lines across active facts exclude every conflicting contribution, rather than double-counting.
- Gross/net/VAT mismatch, 25% mismatch, foreign currency, unsupported treatment, missing/reversed ledger link or tax-control mismatch: explicit exclusion.
- Posted voucher must cite source evidence. Selected line IDs must exist in that voucher. One-to-one totals are controls, not proof of source completeness or legal tax treatment.
- Every fact is represented, even outside-period or wrong-mode rows. Inventory bounds fail closed; no filtered empty success.
- Concurrent source revision/posting/reversal between basis read and seal: reject stale, no half-snapshot.
- Effect arithmetic cannot overflow through JavaScript Number; integer strings use BigInt throughout. Aggregate before discarding öre; preserve per-box residuals and net residual.
- Actual mode emits no numeric return boxes; synthetic mode is labelled explicitly and cannot be relabelled into actual mode.
- UI handles empty/loading/failure/retry, operator restrictions, stale source revision, rediscovery and saved JSON; unknown write outcomes keep their request identity.
- Root must include the bounded VAT dependency hook in closing/accountant snapshots: represented facts cannot coexist with an unchallenged tax-not-applicable declaration.

The user has stopped test and validation work. Continue implementation and source review only; do not run checks or change tests/fixtures. Source presence is not runtime or financial proof.

### Implemented source and integration ownership

Implementation source is ready for shared registration. Migration is **1000-vat-return-drafts.sql**, forward-only and unapplied by this owner. No tests, fixtures, dependencies or existing migration changes. No validation runs, builds, type checks, database/server or browser exercises were run for this implementation. User stopped validation work; source review is not proof of behavior.

Owned paths:

- `packages/contracts/src/vat-returns.ts`
- `apps/api/src/application/vat-returns.ts`
- `jurisdictions/se/src/vat/calculation.ts` — the sole exact arithmetic/control owner
- `apps/api/migrations/1000-vat-return-drafts.sql`
- `apps/web/src/components/vat-returns/{panel,forms,views,copy,blockers}`
- This handoff and `docs/sources/vat-return-profile-research.md`.

#### Root composition

1. Add contract export `"./vat-returns": "./src/vat-returns.ts"`.
2. Add `VatReturnsApi` to `packages/contracts/src/api.ts` and `VatReturnsHandlers` to the API Worker handler composition. Group is `vatReturns`.
3. Spread `VatReturnCapabilities` into the shared catalog. Bind the read entries below with existing `bindCapability`. Bind `vat_return_prepare_draft` using existing `effectCapability(Capabilities.vat_return_prepare_draft, prepareVatDraft)`, importing `prepareVatDraft` from `apps/api/src/application/vat-returns.ts`. This is the **same** Effect workflow the HTTP handler calls; never map public preparation directly to SQL seal.
4. `recordVatFact` is operator-only REST. Do not expose it as an ordinary MCP fact-review capability. No public HTTP/MCP endpoint accepts a calculator result or raw seal basis.
5. Register the fixed SQL statements below in `apps/api/src/db/query.ts`; retain existing parameterized Drizzle dispatch and scoped Effect connections.
6. Lazy-mount `VatReturnsPanel` from `components/vat-returns/panel` with `{book, locale}`. Section ID: `vat-returns`. Use a scoped mount key and existing query-cache/auth isolation; local drafts must not survive identity/book changes. No `onPrepared` kernel plan action exists because this module does not create proposals.

| Database operation   | SQL function                     | Parameters following token                                     | Decoded result |
| -------------------- | -------------------------------- | -------------------------------------------------------------- | -------------- |
| `recordVatFact`      | `openerp.record_vat_fact`        | scope JSON, key text, input JSON                               | `VatFact`      |
| `vatReturnBasis`     | `openerp.vat_return_basis`       | scope JSON                                                     | `VatBasis`     |
| `getVatFact`         | `openerp.get_vat_fact`           | scope JSON, fact ID text                                       | `VatFactView`  |
| `sealVatReturnDraft` | `openerp.seal_vat_return_draft`  | scope JSON, key text, input JSON, basis JSON, calculation JSON | `VatDraft`     |
| `getVatDraft`        | `openerp.get_vat_return_draft`   | scope JSON, draft ID text                                      | `VatDraftView` |
| `listVatDrafts`      | `openerp.list_vat_return_drafts` | scope JSON                                                     | `VatDraftList` |

Every statement returns `as result`. Cast interpolated token/key/ID parameters to `text` and serialized scope/input/basis/calculation to `jsonb`. Schema namespace is `@open-erp/contracts/vat-returns`. The request key fingerprints only the public input and actor/operation; computed basis/calculation are not alternate public inputs. SQL replays the prior sealed result before comparing current basis, so a retry recovers the original snapshot even after changes.

| Catalog capability         | Database operation / Effect       | Input after authenticated token   |
| -------------------------- | --------------------------------- | --------------------------------- |
| `vat_return_basis`         | `vatReturnBasis`                  | `scopeParameter(input.scope)`     |
| `vat_return_get_fact`      | `getVatFact`                      | serialized scope, `input.factId`  |
| `vat_return_prepare_draft` | `prepareVatDraft` Effect function | whole typed `PrepareVatCommand`   |
| `vat_return_get_draft`     | `getVatDraft`                     | serialized scope, `input.draftId` |
| `vat_return_list_drafts`   | `listVatDrafts`                   | serialized scope                  |

HTTP base: `/api/v1/entities/:entityId/books/:bookId/vat-returns`. POST `/facts` records operator-reviewed facts; GET `/facts` reads complete bounded current basis; GET `/facts/:id` reads history. POST `/drafts` calculates then saves; GET `/drafts` lists all bounded saved references; GET `/drafts/:id` returns immutable content plus live basis-current status.

#### Closing/accountant hook — root must integrate

Private `openerp.vat_return_dependencies(book text) RETURNS jsonb`; owning SECURITY DEFINER caller **must hold the book lock**. No runtime/public grant exists. It returns:

- `basisDigest`: digest of all current fact bodies, selected posted VAT lines and reversal state, linked expense-review freshness, book sequence/profile/version/currency/scale.
- `sourceCount`: current retained VAT components; bounded at 200. This is a represented count, never expected source coverage.
- `draftCount`: saved VAT drafts; bounded at 500. Preparation changes this count without making its own captured source/ledger basis stale.
- `coverageEstablished:false`, `ledgerReconciled:false`, `legalProfileActive:false`, `filingReady:false`.

Forward migration `1001-closing-vat-dependencies.sql` now pins this whole dependency in closing and accountant snapshots. A nonzero sourceCount **or draftCount** contradicts tax `not_applicable`; required tax remains blocked because full controls/legal activation are unavailable. Even zero counts do not prove tax non-applicability. Applied0930 remains unchanged. See `CLOSING.md` for currentness consumers, historical compatibility and new accountant generator version. Migration application and runtime behavior remain unverified.

#### Authority and calculation boundary

The narrow trusted Effect owner receives only validated server-observed basis, computes BigInt controls once, and invokes SQL seal. SQL rechecks current admission and the exact basis under the book lock, preserves all assessment/source identities and rejects real-profile/readiness flags. SQL is not a second tax calculator. As with other Effect-owned workflows, the runtime database credential is trusted to run the registered backend code; it is not a safe calculator API for arbitrary clients. There is no direct table write grant.

Ledger controls compare only the explicitly selected posted VAT lines to the source VAT, with debit/credit orientation and reversal checks. They do not assert that net/gross controls, all VAT accounts or source coverage reconcile. Snapshots retain line IDs, account IDs, exact debit/credit and voucher date for that limited control. Basis currentness covers ordinary later postings through book sequence.

Actual-company preparation excludes every actual fact from contributions and returns `syntheticBoxes:null`. It still preserves source/rate/selected-ledger discrepancies and exclusion reasons. Synthetic calculation is a clearly labelled partial demonstration only; other-box absence must be expressly selected for that synthetic example. Unknown other-box absence means `box49:null`. A fractional synthetic box05 basis yields no reported box05 and a blocker, while retaining exact subtotals. All modes keep filingReady false.

#### Remaining proof and domain gates

Unperformed: syntax/type/format/lint validation, migration application, restricted-role/HTTP/MCP execution, concurrency/replay, browser interaction/zoom and artifact observation. These are not claimed as passed. Legal release, exact applicable intervals, real registrations/methods/coverage and accountant review remain external activation gates. No XML or filing adapter is implemented.
