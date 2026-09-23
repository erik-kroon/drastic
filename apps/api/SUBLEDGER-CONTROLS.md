# Schedule basis and declared-account controls (AST-01/02)

## Scope and acceptance recorded before implementation

Reporting and evidence-backed basis linkage only. No ledger write, depreciation-rule activation,
opening voucher, disposal, schedule replacement or financial-close readiness is introduced.
Only native synthetic schedules are eligible. A basis links already posted evidence; it does
not approve its legal classification. Existing0700 history and APIs retain their interpretation.

```text
operator reviews current schedule + original/opening evidence + posted lines
  -> immutable basis, exact carrying amount, frozen schedule revision
explicit date + declared control accounts + inventory evidence
  -> one committed ledger cutoff + all bounded schedules/bases/occurrences
  -> complete declared-account GL rows + per-row unexplained differences
  -> immutable control snapshot / saved discovery / JSON download
```

Failure and acceptance cases (source-review targets, not tests):

- Current operator permission is required to link a basis; agent tools cannot make that review.
  Every read and command reauthorizes entity/book. Evidence, voucher and line references are
  scoped before any disclosure. Book lock follows admission locks; replay precedes freshness.
- One immutable basis per schedule. Expected schedule digest must match. Source evidence/locator
  and each voucher/line can be linked only once in this register. Foreign, repeated, reversed,
  schedule-generated or unsupported voucher links refuse atomically.
- Acquisition: original cost equals carrying amount, accumulated amount is zero. Imported opening:
  original cost = accumulated recognition + carrying amount. Posted selected debits equal original
  cost; selected credits equal accumulated amount. Their net equals current schedule cost. The
  retained date equals the existing voucher date and precedes the first scheduled occurrence.
  Imported history is not depreciated again. Evidence must be cited by the posted voucher.
- A linked basis freezes subsequent schedule revision insertion; historical revisions remain intact.
  Existing preparations/postings keep their identities. This slice cannot correct a wrong basis by
  deleting it, cloning the source or changing prior schedule terms.
- Capture all bounded schedules, including missing bases and future bases; never omit a missing
  family because its register is empty. Declare every known basis account and schedule credit
  account. Schedule expense/debit accounts cannot be declared as carrying controls. No account
  numbers or legal classifications are inferred. Extra declared accounts are fully inspected.
- Economic as-of date and committed ledger cutoff are separate. All current known schedule/basis
  facts are pinned; occurrences and GL effects are selected through the date. Exact original and
  reversal rows remain distinct. Reversed basis becomes an explicit blocker, not a new opening.
- Expected register effects derive from retained basis lines and fixed schedule terms, not GL totals.
  Every declared-account GL row remains visible, even if unexplained rows offset. A zero aggregate
  difference never establishes reconciliation/completeness. Conflicted, due-unposted or reversed
  occurrences and missing basis remain visible review gaps.
- Snapshot, exact JSON bytes/hash/length and receipt commit together. Same scoped key returns the
  original saved bytes after later changes. No arbitrary historical ledger sequence can be supplied.
  Reads return immutable content and separate currentness; later posting/configuration/schedule/basis
  changes can conservatively stale it. Inventory discovery is complete and bounded, not truncated.
- Bounds:200 schedules/bases,10000 preparations,20 selected basis lines,20 declared accounts,
  5000 declared-account GL rows and200 control snapshots per book; source locators256 characters;
  snapshot JSON8 MiB. Fail closed. Dependency currentness also bounds book accounts/periods at1000.
  All helper functions/tables remain private; runtime receives only scoped entrypoint EXECUTE.
- UI must preserve failed inputs, keep retry keys while mounted, recover saved basis/snapshots from
  the server, show unknown coverage and disclose sensitive downloads. Reload does not preserve
  an unsent draft. Download validates retained byte hash and length; never recalculate money.

No tests/fixtures, commands, runtime/database/browser execution or validation runs are authorized.
All behavior remains runtime-unverified. Company applicability, source coverage, original-cost
classification, useful life and depreciation law remain independent reviewed gates.

## Implemented source and root integration

Source-only implementation:

- `apps/api/migrations/1500-subledger-controls.sql` (forward-only, unapplied).
- `packages/contracts/src/subledger-controls.ts`.
- `apps/api/src/db/statements/subledger-controls.ts`.
- `apps/api/src/transport/http/routes/subledger-controls.ts`.
- `apps/web/src/components/subledger-controls/{panel,basis-form,views,copy}.tsx` / `.ts`.

Root composition is now connected in source (runtime-unverified):

1. Export `"./subledger-controls": "./src/subledger-controls.ts"` from the contracts package.
2. Add `SubledgerControlsApi` to shared `Api` and spread `SubledgerControlCapabilities` into
   the shared capability catalog. Add `SubledgerControlsHandlers` to Worker HTTP composition.
3. Spread `subledgerControlStatements` into the existing database statements object.
   No direct Drizzle writes or additional connections are introduced.
4. Bind the five public capabilities below through the existing `bindCapability`. Basis
   recording is deliberately operator-only REST, not an ordinary MCP review operation.
5. Mount `SubledgerControlsPanel` from `components/subledger-controls/panel` with
   `{book, setup, locale}` under the existing authenticated book/identity boundary. It keys
   local state by book, uses scoped TanStack Query keys and response schemas, and supplies
   English/Swedish local copy. Root still owns auth-change cache isolation.

HTTP base: `/api/v1/entities/:entityId/books/:bookId/subledger-controls`.
Every database statement returns `as result`; scopes and inputs use JSON serialization.

| HTTP operation | Database key / SQL function | Parameters after token | Decoded schema |
| --- | --- | --- | --- |
| POST `/bases` | `recordSubledgerBasis` / `record_subledger_basis` | scope JSON, key text, input JSON | `SubledgerBasis` |
| GET `/bases/:id` (schedule ID) | `getSubledgerBasis` / `get_subledger_basis` | scope JSON, schedule ID text | `SubledgerBasis` |
| GET `/bases` | `listSubledgerBases` / `list_subledger_bases` | scope JSON | `SubledgerBasisList` |
| POST `/snapshots` | `createSubledgerControl` / `create_subledger_control` | scope JSON, key text, input JSON | `SubledgerControl` |
| GET `/snapshots/:id` | `getSubledgerControl` / `get_subledger_control` | scope JSON, snapshot ID text | `SubledgerControlView` |
| GET `/snapshots` | `listSubledgerControls` / `list_subledger_controls` | scope JSON | `SubledgerControlList` |

| MCP capability | Database key | Argument mapping after token |
| --- | --- | --- |
| `subledger_get_basis` | `getSubledgerBasis` | `scopeParameter(input.scope), input.id` |
| `subledger_list_bases` | `listSubledgerBases` | `scopeParameter(input.scope)` |
| `subledger_create_control` | `createSubledgerControl` | `scopeParameter(input.scope), input.idempotencyKey, JSON.stringify(input.input)` |
| `subledger_get_control` | `getSubledgerControl` | `scopeParameter(input.scope), input.id` |
| `subledger_list_controls` | `listSubledgerControls` | `scopeParameter(input.scope)` |

### Basis meaning and bounded refusals

`RecordSubledgerBasis` requires an exact current schedule digest, explicit acquisition or
imported-opening type, posted date, source component locator, source/review evidence,
rationale, original cost, previously accumulated amount, carrying amount, existing voucher
and1–20 selected line IDs. Amounts are canonical strings in the existing book currency/scale.
For an imported opening, selected gross cost debits and accumulated credits must separately
match their retained amounts; net carrying value must equal the schedule's cost. A net-only
imported voucher cannot represent a nonzero accumulated amount in this bounded profile.
This restriction refuses unsupported representation; it never fabricates an opening entry.

The basis date must precede the first schedule occurrence. This permits reviewed linkage to
existing schedules/postings, but not imported schedules whose cost restarts prior depreciation.
A missing/foreign/reversed/correcting/schedule-generated voucher, reused selected line,
reused evidence+component locator or reused schedule fails before any basis/receipt remains.
Human descriptions and distinct locators cannot prove two source components are economically
distinct; source split completeness remains unestablished.

A forward trigger refuses new schedule revisions after basis linkage.1500 also replaces only
`get_schedule`'s revision-allowed condition to reflect this extra freeze; every other response
field and prior revision remains as0700 defined. Existing preparation/posting/reversal identities
are untouched. Incorrect basis decisions need a future reviewed amendment workflow; no edit,
delete, relabel or automatic reversal path exists in this slice.

### Snapshot/control meaning

One book barrier captures current known schedule revisions, bases and due occurrence states,
book committed sequence, declared account labels and every declared-account GL row through
the chosen economic date. Dates and sequence are distinct. Clients cannot select an arbitrary
mid-group sequence. Future bases remain visible, with unavailable carrying value at that date.

Every known basis account and every schedule credit account must be declared, even if their
current balance is zero. Schedule debit/expense accounts are refused as carrying controls.
Accounts with no known register item can be included; all their GL rows remain unexplained.
The declaration is an evidence-backed selection, not a company-completeness assertion.

Expected effects are independent of aggregate GL totals: basis lines retain their exact posted
original-cost/accumulated amounts;0700's two-line occurrence contract supplies the expected
credit at ordinal2, and its full reversal supplies the opposite effect. Each expected effect is
retained separately, even if its matching GL line is missing. Original and reversing rows never
collapse into a zero row. Conflicted occurrence vouchers are not schedule recognition. Basis
reversals remain unexplained ledger effects plus an explicit basis blocker, not a replacement
opening. Remaining carrying amount is unavailable for a missing/future/reversed basis.

Controls report signed debit-minus-credit ledger and expected amounts, their difference,
individual unexplained-row count and missing-expected-row count. `hasReviewGaps` also includes
missing/stale/reversed bases and due unposted/reversed/conflicted occurrences. Offsetting
unexplained rows therefore cannot produce a clean status. Even `hasReviewGaps:false` means
only no detected differences in this selected synthetic scope; `coverage:not_established`
and `financialCloseReady:false` never change.

Snapshots retain canonical JSON bytes plus independent byte SHA256 and length. The full
read provides those immutable bytes and a separately computed `dependenciesCurrent`.
The UI validates schema, identity, byte length and SHA256 before download; it downloads the
retained content rather than recalculating money. The existing internal canonical digest
identifies the semantic snapshot; the artifact SHA256 identifies its exact UTF-8 bytes.

Currentness deliberately binds all book account and period configuration, profile/currency/
writer/ledger state, current schedule revisions, all preparations and all basis digests.
Unrelated changes can make a snapshot historical. A new report does not stale earlier reports
by itself. Above200 schedules,1000 accounts/periods or10000 preparations, old saved reads still
work with `dependenciesCurrent:false`; new captures fail closed. Original saved receipts and
bytes remain recoverable after changes. All lists return the complete bounded inventory in
one response, not a truncated page. The200-basis/report limits are enforced on insertion.

### Closing integration for root

Private `openerp.subledger_control_dependencies(book text)` requires a caller-held book lock.
It returns `version`, `basisDigest`, `basisCount`, `snapshotCount`, `missingBasisCount`, plus
`coverageEstablished:false`, `controlAccountReconciled:false`, `financialCloseReady:false`.
Bind its **whole body** to any new closing/accountant dependency scope, not only its digest:
creating a snapshot changes represented inventory without changing financial/source currentness.

The follow-up1510 source integration below now binds this hook to closing and accountant review.
Both1500 and1510 remain unapplied and runtime-unverified. Correction/bank guards and prior
migrations are unchanged. A clean snapshot cannot turn a required-assets close check into a pass
or waive an existing source/control blocker. Historical close/pack bytes retain their meanings;
old pending proposals become stale against the new complete dependency shape.

### Source review and unperformed proof

Source review traced scoped admission and book locking, operator-only basis review, replay-before-
freshness, database uniqueness/FKs, exact numeric conservation, current committed cutoff,
independent expected effects and all-row declared controls, historical bytes/currentness, limits,
private helpers, runtime EXECUTE-only grants and the ordinary shared Effect/Drizzle request path.
No test, fixture, format/lint/type/build command, migration, database, server, browser, external
service or deployment was run. SQL/TypeScript/runtime behavior and rendered usability remain
unverified.1500 must follow0600 commerce helpers,0700 schedules and the existing admission kernel.
The referenced methods/exports are composed by the root. Reports → Asset controls and the legacy accounting workspace mount the panel under the existing book boundary.

##1510 closing/review dependency follow-up — acceptance before implementation

- Extend latest1001 private owners only; do not copy0800/0810-era replacements over later VAT or
  bank behavior.1300 active bank views and bank/reconciliation hooks remain untouched.
- Capture the entire1500 control dependency under the existing caller-held book barrier, including
  snapshotCount. A new basis or even a report-only snapshot must stale an older close basis/pack.
- Add optional schema fields for historical decoding, but no live SQL fallback for an absent
  historical field. Existing full JSON/digest comparisons must reject stale pending approvals.
  Committed replay stays before live basis computation and must retain original bytes/results.
- Missing bases and represented asset/control records remain independent mandatory blockers.
  A declaration cannot waive failures, and zero net control difference cannot activate coverage.
- New accountant JSON and every CSV manifest must include the complete provider body with false
  readiness flags. Keep visible missing-basis and unavailable-control rows. Old bytes are never
  regenerated; identify new generation with a distinct supported generator version.
- Bound schedules, preparations, basis/control inventory and account/period configuration before
  provider aggregation. Historical pack reads beyond a live bound return unchanged content with
  dependenciesCurrent=false, not a truncated comparison or missing historical record.
- Source-only review. No SQL application, check/test/browser command or external operation.

##1510 implemented source and integration result

Files: `apps/api/migrations/1510-closing-subledger-dependencies.sql`, optional dependency schema
fields in `packages/contracts/src/closing.ts` and `packages/contracts/src/accountant-review.ts`,
and this owning handoff. No new routes, capabilities or shared dispatcher wiring is required.
1510 follows1500; no historical migration was edited or applied.

The forward migration extends the latest1001 definitions of `closing_basis`,
`accountant_review_providers_bounded`, `accountant_review_basis` and `prepare_accountant_review`.
It preserves1001 VAT/provider behavior and dispatches unchanged bank hooks, including1300's
active-bank semantics. No bank view/function or correction guard is replaced.

- `ClosingDependencies.subledgerControls` and `ReviewBasis.subledgerControls` contain the entire
  private provider body, not only its digest. Both are optional only for old artifact decoding.
  New live bases always contain the field. Shared `SubledgerControlDependencies` retains version,
  basisDigest, basis/snapshot/missing-basis counts and all three false readiness/coverage flags.
- New basis changes alter the digest. New control reports alter snapshotCount even without a
  ledger change. Existing full-basis equality in close approval/execution and full digest equality
  in review currentness therefore detect both. Missing historical fields are not backfilled.
  Old committed command/transition replays still return before recomputing live dependencies.
- `ScheduleBasisCoverage` independently fails for every represented schedule missing its basis.
  `SubledgerControlCoverage` independently fails while any schedule, basis or saved control
  snapshot is represented, since full controls remain unavailable. Existing due-occurrence checks
  remain mandatory. Asset family counts include these represented record families, not distinct
  economic assets; even a report-only inventory contradicts not-applicable. Required-family
  unavailable coverage remains blocked. No declaration can waive those failures.
- Accountant generation is now `accountant-review-v3`; schemas still decodev1/v2. New JSON pack
  basis and every CSV manifest providerBasis retain the same complete control dependency.
  Coverage rows expose missing-basis counts and unavailable control coverage. Control report
  contents remain separately retained artifacts; their existence is not a passed financial gate.
- The provider bound includes200 schedules/bases/control snapshots,10000 preparations and
  1000 accounts/periods. Old accountant packs above the live bound remain readable with
  dependenciesCurrent=false. Latest `get_closing_proposal` and `get_closing_certificate` are
  narrowly forward-replaced to give the same historical-read behavior for the new subledger
  bound, without relaxing approval/execution or existing other-provider checks.
- No stored proposals, approvals, certificates, packs, rows, receipt results or artifact bytes
  are updated. New captures alone receive new dependency/generator versions. All existing scoped
  admission, book-lock, replay, grant and transaction boundaries remain in place.

Source review compared each replacement against its latest owning definition and traced
approve/execute/currentness and every artifact-context caller. No checks, tests, database,
browser or toolchain execution occurred. Migration syntax, runtime behavior and compatibility
remain unverified observations, not claims of acceptance.

## 1800 basis-aware posting safeguards — failure cases before implementation

Scope: block new recognition against a reversed/corrected linked carrying basis. Preserve
standalone synthetic schedules without bases, immutable historical postings, receipts and reads.
No migration application or runtime proof is authorized for this wave.

Failure cases to guard:
- A basis is reversed/corrected before native preparation; no new proposal or receipt may survive.
- A valid linked basis is reversed/corrected after preparation or approval; execution must fail
  atomically, including generic kernel and bundle paths that insert vouchers.
- A standalone proposal predates basis linkage; it must not inherit that basis without a new
  preparation and human approval. Pre-1800 linked preparations have no retained basis authority
  and must be prepared again, without rewriting old plans or their digests.
- A generic/equivalent proposal uses a known linked schedule occurrence without native ownership;
  reject it rather than claiming source provenance or universal economic duplicate detection.
- A correction reversal must remain possible/reportable; never reject a genuine reversal merely
  because its event belongs to a linked schedule. Replacement recognition remains guarded.
- Unrelated, foreign-book, missing-basis and historical posted records must not become linked
  implicitly. Preserve authorization, book locks, revocations, committed replay and exact money.
- New basis capture must be in the same transaction as native proposal/preparation and immutable.
  Missing authority is not equivalent to valid linked authority. No client-supplied bypass flag.
- New live basis notices must not reinterpret old retained receipt bytes or claim legal validity,
  complete source reconciliation, disposal, impairment or a correction/amendment workflow.
- Do not replace bank1300, invoice1400 or closing1510 guards or weaken the original kernel checks.

Planned boundaries: private live basis state; additive immutable preparation capture; current
basis checks at native preparation, shared dependency validation and voucher insertion; an
additive live schedule notice. Known linked events outside the native path fail closed. New event
keys, cloned source components and unknown economics remain outside this identity-based guard.

## 1800 implemented source — carrying-basis posting authority

Implemented in `migrations/1800-subledger-basis-posting-guards.sql`; it requires1500 and leaves
all1300–1510 files unchanged. Contracts are additive in `packages/contracts/src/subledgers.ts`.
The existing owned `components/subledgers/schedules.tsx` and `copy.ts` show English/Swedish live
notices, basis voucher/digest, and disable preparation when status is blocked or unavailable.
No new route, capability, query dispatcher or Drizzle maintenance mapping is needed.

```text
native prepare, under book lock
  -> live basis supported? -> sealed proposal + immutable basis_dependency capture
  -> human validation/approval -> current dependency check
  -> execution -> current dependency check -> physical voucher guard -> posting
basis correction/reversal
  -> original basis remains retained -> next recognition fails -> controls stay inspectable
```

### Capture and compatibility

`subledger_preparations.basis_dependency` is an additive nullable JSON column. New preparation
rows capture mode, supported state, basis digest, basis voucher ID, blocker and false legal-policy
flag in the same transaction as the sealed kernel proposal. The existing immutable-row trigger
and unique `(book_id,change_set_id)` bind this capture to the approved plan identity. This is
server-owned provenance, not a client-authored plan field, ambient bypass flag or new kernel
dependency kind. Approval still binds the original sealed plan ID/digest.

Historical rows remain NULL; no UPDATE/backfill rewrites old authority. A historical NULL capture
is accepted only while the schedule is still standalone with no linked basis. A linked historical
preparation, or a captured standalone proposal followed by new linkage, fails `StaleDependency`.
Native re-preparation with a fresh command key appends a new proposal/capture and requires fresh
human approval. Committed preparation/approval/execution command replay still returns its
original result before freshness checks; a replay is not current posting authority.

The private `subledger_posting_basis(book,schedule)` returns standalone synthetic support if no
basis exists. With a basis, any voucher in that book correcting/reversing its original voucher
blocks recognition immediately, regardless of economic date. Schedule-digest or retained-body
mismatch also blocks. It does not infer a replacement basis, pause future terms or activate a
legal profile. `supported:true` is only this prerequisite, not overall posting readiness; existing
profile/account/period/evidence/approval checks still apply.

### Exact enforcement coverage

- `prepare_schedule_occurrence`: checks current basis before a new preparation/reuse, captures it
  on the immutable preparation row, and retains it as optional `postingBasis` in new responses.
  The existing stale-dependency catch appends a new attempt when linkage invalidates an old plan.
- `check_dependencies`: latest0001 function is forward-replaced with exactly one added private
  guard call after existing digest/version/action checks. This covers kernel validation, approval,
  execution, saved-posting recovery diagnostics, recurring reuse and correction-bundle checks.
  Existing revocation, membership, receipt, book-lock and other-provider logic is untouched.
- `subledger_basis_proposal_owner`: a deferred constraint trigger on new change sets checks all
  actions. Native preparation inserts its owner row before transaction end. Generic preparation
  for a known basis-linked occurrence has no such owner and fails at commit, rolling back its
  proposal, event creation and receipt. There is no caller-set bypass or authorization marker.
- `subledger_basis_posting_authority`: immediate BEFORE INSERT voucher trigger reacquires the
  existing book barrier and checks live validity/capture. Generic proposals retained before basis
  linkage also fail here, even if a future execution adapter omits shared dependency validation.
- Known generic identities match book, evidence and retained occurrence event key across schedule
  revisions. Generic adjustment/replacement paths cannot borrow native provenance. A real full
  reversal with a source voucher is not recognition and passes through this added guard; existing
  kernel/bank/commerce/owner correction guards remain authoritative and may still refuse it.
  Correction bundles keep all-or-nothing execution; a guarded replacement cannot partially commit.
- Historical GETs, immutable occurrence IDs, recognized amounts, voucher/receipt bodies and
  snapshots are unchanged. `get_schedule` adds live `postingBasis`; optional contract fields keep
  old response decoding valid. Generic posting recovery already converts stale dependencies into
  a visible blocker without discarding retained history. No new transport composition is needed.

### Limits and remaining proof

The guard identifies retained schedule events, not arbitrary economic equivalence. Another event
key, another evidence object or a cloned source declaration is not universally deduplicated.
Source split completeness and control-account reconciliation remain unestablished. No disposal,
impairment, paused schedule, future-term amendment or immutable-basis replacement is added.
No bank1300, invoice1400 or closing1510 guard/provider definition is replaced. Complete closing
control dependencies and false readiness flags remain unchanged.

Source review traced latest function owners, all preparation inserts, dependency callers, deferred
proposal ordering, immediate voucher admission, book barriers, correction exemptions, replay and
UI/schema compatibility. The forward replacements were compared with their owning definitions.
No tests, fixtures, checks, builds, SQL application, browser/server, dependency or external actions
were performed. Trigger ordering, SQL compilation, concurrency/rollback and rendered UI behavior
remain runtime-unverified. A later authorized proof must exercise reversal-after-approval and
basis-link-after-preparation through native, direct-kernel and correction-bundle public paths.

### 1800 follow-up source review — before hardening

- Selected schedule reads must match the requested schedule/book/entity, including retained
  revisions. Preparation responses must match schedule, requested revision digest and ordinal.
  A schema-valid response for another request must not reach review or clear its retry key.
- Correction bundles use a derived `correction:<voucherId>` event, not the original schedule
  event. Exact-event matching alone misses this known provenance. Reject a replacement when
  its retained correction ancestry leads to a basis-linked schedule occurrence, including
  correction chains retained before1800. Genuine reversal remains allowed by this added guard.
- Existing dispatcher calls execute one approved entrypoint per query. Saved requests execute
  one command; invoice issuance executes one invoice-owned plan; correction bundles execute
  reversal first and then a fresh bundle-owned replacement, never native recognition followed
  by basis reversal. No supported current entrypoint exposes that reverse ordering. A future
  batching path must define commit-time basis validity before it is admitted.

### 1800 follow-up result

No deferred voucher trigger was added. Source review of the public dispatcher and every
`execute_change` caller found no supported recognition-then-basis-reversal atomic entrypoint.
`posting_run_request` dispatches one saved command; invoice issuance posts one invoice-owned
plan; correction execution reverses first and then executes its newly sealed bundle replacement.
The application does not expose arbitrary SQL or multi-command transaction batching. This is a
source-based bound, not a guarantee for arbitrary privileged SQL compositions or future adapters.
If batch composition is introduced, add commit-time recognition checks before supporting that
path; independent later source correction must remain allowed.

The review did find and close a concrete generic-equivalence gap: bundle replacement identity is
`correction:<originalVoucherId>`, not the original occurrence event. The private guard now follows
retained correction-bundle origins recursively and refuses replacement provenance leading to a
basis-linked schedule event. UNION removes repeated ancestry IDs; book predicates scope every
step. Deferred proposal ownership sees the bundle association after its insertion, while shared
validation and immediate voucher admission see retained associations. This includes previously
retained correction chains. It does not infer ancestry from text, account amounts or unknown keys.

Selected schedule GET responses now check requested ID and book/entity on current and every
retained revision. Preparation responses check schedule ID, requested revision digest and ordinal
before clearing retry keys or exposing review navigation. The response has no independent scope
field; the requested digest already identifies the scoped revision, and the request uses the
scoped book path. Create/revise responses in owned `schedule-form.tsx` also check book/entity,
source key and, for revisions, the selected schedule ID. Invalid responses become errors rather
than successful navigation. No contracts or root composition changed in this follow-up.

This follow-up changed only1800, `schedules.tsx`, `schedule-form.tsx` and this handoff. No commands,
tests, database/browser execution or migration application occurred.
