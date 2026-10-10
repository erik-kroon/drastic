# AUT-06 candidate B: federated attestations, read-boundary composition

## Usage (caller’s view)

A producer captures one declared check against immutable source receipts. The coverage owner admits and retains the attestation atomically. HTTP and MCP consumers ask one operation for a period predicate; they do not run checks, choose required gates, or write on read.

```ts
// Existing bank workflow, after its owned reconciliation/coverage/sign-off commands.
const retained = yield* captureCloseCheck(token, {
  scope,
  periodId,
  idempotencyKey: "synthetic:bank-january-v1",
  selection: {
    checkId: "bank_reconciliation_coverage",
    sources: {
      inventory: { id: inventory.id, digest: inventory.digest },
      coverage: { id: coverage.id, digest: coverage.digest },
      reconciliationIds: reports.map(report => ({ id: report.id, digest: report.digest })),
      signoff: { id: signed.id, digest: signed.digest },
    },
  },
});
// retained is the original CheckRecord on an identical command replay.

// HTTP GET route: one domain operation, then response schema encoding.
const predicate = yield* readClosePredicate(token, { scope, periodId });
return predicate; // done | not_done | inconclusive, all gates and all reported checks

// MCP read capability: same authorized domain operation; no capture dispatch.
case "read_close_predicate":
  return yield* readClosePredicate(token, { scope: args.scope, periodId: args.periodId });
```

The first example is proposed integration, not an existing call. Source reference fields must be derived from each source owner’s real receipt shape; a missing digest is resolved and bound server-side, never invented by the caller. The transport never admits status, amounts, builder version, dependency rules, or an arbitrary producer identifier.

## Problem

AUT-06 needs immutable retained outcomes and separately evaluated current freshness. Existing bank and actual-VAT records already own calculations and freshness; a centralized calculator would duplicate them. Existing ordinary periods belong to fiscal years and have authoritative stored boundaries, without a month/year kind. Existing closing readiness is a synthetic technical-lock owner, with explicit false coverage contracts. Therefore this design retains small, independently owned check attestations and merges them at the read boundary. It does not turn technical-close readiness into financial-close coverage.

## Shape

```ts
// Domain sketch: exact repository brands/error types should be reused during implementation.
type CheckId =
  | "bank_reconciliation_coverage"
  | "supporting_documents"
  | "complete_facts"
  | "no_open_reviews_questions"
  | "actual_vat_control"
  | "tax_account_control"
  | "supplier_independent_reconciliation"
  | "customer_independent_reconciliation"
  | "subledger_control"
  | "closing_provider_coverage";

type FrozenPeriod = Readonly<{
  bookId: BookId;
  periodId: PeriodId;
  startsOn: AccountingDate;
  endsOn: AccountingDate;
  periodDigest: Digest;
  fiscalYearId: FiscalYearId;
}>;

type EvidenceRef = Readonly<{ id: EvidenceId; digest: Digest }>;
type Dependency = Readonly<{
  // A fixed owner-defined kind, not a generic JSON path supplied by a caller.
  kind: DependencyKind;
  identity: string;
  digest: Digest;
}>;
type Observation = Readonly<{
  ledgerSequence: LedgerSequence; // retained provenance, not universal freshness policy
  dependencyDigests: readonly Dependency[];
}>;

type CheckOutcome =
  | Readonly<{ status: "pass"; reasons: readonly [] }>
  | Readonly<{ status: "fail"; reasons: NonEmptyReadonlyArray<CheckReason> }>
  | Readonly<{ status: "not_established"; reasons: NonEmptyReadonlyArray<CheckReason> }>;

type CheckRecord = Readonly<{
  id: CheckRecordId;
  checkId: CheckId;
  period: FrozenPeriod;
  outcome: CheckOutcome;
  observedCutoff: Observation;
  builderVersion: string;
  evidenceRefs: readonly EvidenceRef[];
  // Retain denominator, missing members, source identities and admitted coverage facts.
  coverageFacts: CoverageFacts;
  digest: Digest;
  recordedAt: IsoTime;
  receipt: CommandReceipt;
}>;

type Freshness =
  | Readonly<{ status: "fresh"; observedDependencies: readonly Dependency[] }>
  | Readonly<{ status: "stale"; reasons: NonEmptyReadonlyArray<FreshnessReason>;
      observedDependencies: readonly Dependency[] }>
  | Readonly<{ status: "unavailable"; reasons: NonEmptyReadonlyArray<FreshnessReason> }>;

type CheckResult =
  | Readonly<{ checkId: CheckId; status: "not_run"; record: null;
      freshness: null; reasons: NonEmptyReadonlyArray<CheckReason> }>
  | Readonly<{ checkId: CheckId; status: CheckOutcome["status"];
      record: CheckRecord; freshness: Freshness; reasons: readonly CheckReason[] }>
  | Readonly<{ checkId: CheckId; status: "not_established"; record: null;
      freshness: null; reasons: NonEmptyReadonlyArray<CheckReason> }>;

type ClosePredicate = Readonly<{
  bookId: BookId;
  periodId: PeriodId;
  period: FrozenPeriod;
  policyVersion: "aut06_month_v1";
  gated: readonly CheckResult[]; // fixed, exhaustive policy-owned set
  reported: readonly CheckResult[];
  verdict: "done" | "not_done" | "inconclusive";
  observedAt: IsoTime;
  observationDigest: Digest; // includes selected records and current dependency observations
}>;

type CaptureSelection =
  | Readonly<{ checkId: "bank_reconciliation_coverage"; sources: BankSourceSelection }>
  | Readonly<{ checkId: "actual_vat_control"; sources: ActualVatSourceSelection }>
  | Readonly<{ checkId: "no_open_reviews_questions"; sources: WorkInventorySelection }>;
// No arbitrary status/version/dependency/evidence object admission. Phase 2 and Phase 8
// add owned selection cases only when their complete application owners exist.

export function captureCloseCheck(
  token: string,
  command: Readonly<{ scope: Scope; periodId: PeriodId; idempotencyKey: string;
    selection: CaptureSelection }>,
): Effect.Effect<CheckRecord, CloseCoverageError> {
  throw new Error("not implemented");
}

export function readClosePredicate(
  token: string,
  query: Readonly<{ scope: Scope; periodId: PeriodId }>,
): Effect.Effect<ClosePredicate, CloseCoverageError> {
  throw new Error("not implemented");
}

// Fixed application-private union dispatch, not a public plugin registry.
function captureOwnedCheckInTransaction(
  tx: Transaction, period: FrozenPeriod, selection: CaptureSelection,
): Effect.Effect<AdmittedCheck, CloseCoverageError> {
  throw new Error("not implemented");
}
function observeOwnedCheckInTransaction(
  tx: Transaction, period: FrozenPeriod, record: CheckRecord,
): Effect.Effect<Freshness, CloseCoverageError> {
  throw new Error("not implemented");
}
// No database or transport dependency in the policy reducer.
function composePredicate(
  period: FrozenPeriod, results: ReadonlyMap<CheckId, CheckResult>, observedAt: IsoTime,
): ClosePredicate {
  throw new Error("not implemented");
}
```

The sketch separates durable outcomes from ephemeral freshness at the type level, per encode-lessons-in-structure. `not_run` has no fabricated record. Unsupported owners produce a named `not_established` result even when they have no stored record. Read-only results never mutate or replace a stored `pass` when it becomes stale.

### Ownership and module map

| Module | Knowledge owned |
| --- | --- |
| `packages/domain/src/close-coverage.ts` (new) | Immutable domain model, fixed month gate policy, pure verdict composition. Real consumer declared in domain-leaf-integration manifest. |
| `apps/api/src/application/closing/coverage.ts` (new) | Authorized capture/read operations, replay admission, authoritative registered-period resolution, fixed producer dispatch, immutable selection composition. |
| `apps/api/src/db/closing/coverage.ts` (new) plus forward migration | Append-only attestation storage, scoped source/record lookup, deterministic per-check selection and immutable-row grants. |
| Existing bank reconciliation/coverage/sign-off owners | Exact bank coverage/outcome and actual freshness; expose private transaction-taking readers that share current getter logic. |
| Existing actual-VAT owner | Existing calculation, controls and currentness reasons; expose a private transaction-taking reader reused by the public getter. |
| Existing workspace/work-question owners | Declared open-review and question inventory plus dependency digest; bounded complete inventory, never a page count alone. |
| `packages/contracts/src/close-coverage.ts`, HTTP closing route, capability dispatch/catalog | Parse/encode wire data and advertise one read operation. Capture stays outside ordinary MCP catalog. |

There is one physically append-only coverage table, logically partitioned by `(bookId, periodId, checkId)`; each fixed producer supplies only its own admitted payload. This is federated knowledge and per-check state, not a table per check. There is no shared mutable current-close row or latest-check pointer. An index on `(book_id, period_id, check_id, capture_ordinal desc)` supplies each partition’s newest record. A transactionally allocated insertion ordinal, with deterministic ID tie handling if needed, defines retained selection; timestamps alone do not. A stale newest attestation cannot fall back to an older passing attestation. Read responses include selected immutable record IDs; response-level immutability is an observation value, not a claim that all future reads return the same predicate.

### Period and policy boundary

Resolve `(scope.bookId, periodId)` from `periods`, retain its stored dates and fiscal-year relationship, and admit source records only for those frozen bounds. Never accept client dates or reinterpret a fiscal-year identifier as a posting-period identifier. The Phase 1 month policy applies to ordinary registered periods as the accepted operational close predicate; it is not a year-close policy. Fiscal-year closing continues through the existing financial-close owner. If a registered period covers a year, report that the AUT-06 month policy is unsupported/inconclusive until the supported-period policy is explicitly resolved; do not claim annual completion or split the year into inferred monthly evidence. The repository has no month/year discriminator to rely on.

The required gates are always bank reconciliation plus coverage, supporting documents, complete facts, no open reviews/questions, and actual VAT control. Supporting documents and complete facts remain `not_established` with Phase 2/Phase 8 owner reasons today. They cannot be removed, marked not applicable, or promoted because another owner is empty. Tax account control, provider coverage, subledger, AP and AR remain visibly reported with named unsupported reasons; their zero differences and internal totals cannot promote `done`.

`done` requires every fixed gate to have retained `pass` and current `fresh`. Any absent, unsupported, unavailable or stale gate yields `inconclusive`, including a current failing sibling gate, as Phase 1 explicitly requires. With every gate established and fresh, any retained `fail` yields `not_done`; otherwise all passing gates yield `done`. A stale failure cannot establish current failure. Non-gated results never change the verdict.

### Capture, retries and competing writers

Validate the union selection at transport admission, then resolve the period and source records inside the coverage application operation. Fixed producers derive outcomes from stored owner records and complete denominator inventories. Evidence digests, source scope, full period boundaries, version support, continuity/account mapping and missing members are admitted before any insert. A supplied evidence ID and digest are selectors to validate, not authoritative claims.

Each capture writes one attestation and its ordinary command receipt in the same owner transaction; failure rolls both back. Use the established book/authority writer barrier and existing `replay`/`saveCommand` pattern. The short barrier protects the shared financial/source observation, not a global coverage current-state object. Distinct check captures have independent append-only records and merge only during read. If identical-key concurrency races, the scoped unique receipt identity and transactional replay return one immutable record; a changed request fingerprint conflicts and retains the winner. The fingerprint binds operation, book, period and ordered canonical evidence identity/digest inventory. Changed period or explicit frozen inventory under the same key conflicts. Replay occurs before current re-evaluation: if a source later changes and the same original command is retried, return the original record, whose subsequent read freshness is stale. Never silently recapture under an old key. If capture also uses REPEATABLE READ, authentication can establish a snapshot before waiting for the book lock; the winning capture receipt may be invisible after the wait. Retry the entire transaction on `40001`; a narrowly identified command-key unique collision must also reopen a new transaction and run ordinary replay before classifying identical replay versus changed-input conflict. Do not reinterpret every unique violation as an idempotency race. The simpler choice is READ COMMITTED capture with the established writer barrier and replay after locking, while read composition uses REPEATABLE READ.

### Read consistency and actual freshness

Read authentication/authority, registered period, selected attestations, source-owner freshness and work inventory under one scoped REPEATABLE READ transaction with the existing shared book barrier. Set transaction isolation before the first admission SELECT through the existing `withTransaction` boundary. Keep the in-transaction bank/VAT permission, profile, scope and authority guards. Existing top-level bank/VAT getters each open their own transaction; calling them sequentially would compose incompatible snapshots. Extract transaction-taking reader helpers within the existing owners and reuse their existing logic from both old getters and coverage. REPEATABLE READ keeps writers outside the shared barrier from creating mixed inventory observations; the result means fresh at that one retained observation snapshot. A non-atomic pair of head reads is not a substitute. A locking read whose book/authority row changed after snapshot establishment can fail with SQLSTATE `40001`, already mapped to `TransactionRetry` by `db/transaction.ts`; it cannot be downgraded to an inconclusive check or silently dropped. Retry the whole read with a fresh transaction, or return the existing retryable error.

Bank freshness uses checkpoint `sourceRevision`, account ledger sequence through the report end, book currency/profile/authority, plus coverage’s actual inventory dependency digest and sign-off currentness. Exact reconciliation alone uses account/cutoff-local ledger sequence. Coverage’s `readCoverageDependencyDigest` in `banking/shared.ts:425` includes `book.committedSequence`, and whole-inventory sign-off/coverage therefore declares a global ledger dependency. Since both are required, a later-period posting may leave exact reconciliation fresh while staling the combined bank gate. An unrelated later-period nonfinancial preparation can stay fresh only if the actual declared dependency inventory remains unchanged. Actual VAT currently declares the whole committed ledger boundary and additional VAT profile, membership, rule release, population, component/withdrawal, recognition/control-effect and amendment dependencies. Preserve its `currentnessReasons` exactly; a later-period ledger event can still stale VAT because that is its current owner rule. Narrowing VAT’s rules is a separate change requiring evidence, not an AUT-06 shortcut. Retain owner reasons and dependency kinds so the artifact makes that distinction auditable.

GET does no capture, auto-refresh, receipt insertion, materialization, audit-row creation or backfill. The read MCP capability dispatches exclusively to the read operation using existing agent read policy. Adding the catalog entry requires both MCP suites and row-count evidence across repeated reads.

Interface depth: two public operations hide admission, retention, owner freshness, fixed gating, transaction consistency and unsupported-state explanation. The caller provides identities, not internal stages. Domain contracts do not re-export SQL rows or transport schemas, per boundary-discipline. Producer adapters exist because they hide different evidence knowledge; do not add pass-through load/validate/save modules.

## Synthesis decision

Candidate B submitted for arena comparison. The synthesis owner should choose a base and record adopted/rejected parts; this candidate does not pre-claim selection.

## Tradeoffs accepted

- We accept an explicit capture per check in exchange for independently retryable producer work and no shared mutable close-status row.
- We accept transaction-taking reader refactors in the existing bank/VAT owners in exchange for one coherent read observation and one freshness implementation per owner.
- We accept a fixed check union and gate policy in exchange for exhaustive handling and no user-defined plugin/policy escape hatch.
- We accept visibly inconclusive predicates today in exchange for keeping the required Phase 2 and Phase 8 gates honest.
- We accept an append-only newest-record index and selection rule in exchange for preserving every prior outcome without mutable pointers.

## Alternatives considered

- A central `capturePeriodCoverage` command reads all source owners and writes one large close snapshot. It hides orchestration well but forces unrelated check producers to share retry cadence and one aggregate record identity; refreshing bank evidence duplicates unsupported/VAT state and couples every new phase to aggregate capture.
- A live readiness calculator with no retained attestations has the smallest API but cannot prove original outcomes after source revisions or satisfy immutable retry evidence; it exposes temporal ambiguity to every consumer.
- Per-owner physical tables and public owner-specific capture endpoints strengthen physical isolation but multiply transport, grants and query plumbing without an established need. Logical partitions hide that storage complexity behind the same small interface.

## Failure cases and verification plan

These cases precede implementation; no tests or source changes were made by this candidate.

1. Fresh synthetic complete bank evidence passes only its own gate, with full statements, denominator and zero unresolved items retained.
2. Zero arithmetic with a missing expected statement, account mapping or continuity item never passes and retains missing identity/reason.
3. Never-captured check returns `not_run`; Phase 2/8 absent owners return named `not_established`; empty internal totals never imply AP/AR evidence.
4. Source revision or relevant-period ledger mutation leaves the record byte-for-byte unchanged and returns stale freshness; later-period posting can keep exact reconciliation fresh while staling global bank coverage/sign-off; unrelated nonfinancial preparation follows unchanged declared dependencies; actual VAT retains its broader current rule.
5. Cross-book source, changed period bounds, unsupported builder, malformed evidence digest, duplicate/incomplete selected inventory or forged status refuses admission with no record/receipt writes.
6. Same key/same frozen inventory returns identical record identity; same key/changed period or inventory conflicts; simultaneous identical captures yield one receipt and record; partial failure rolls back both.
7. A source writer racing read/capture cannot produce a mixed fresh observation. Deterministic synchronization barriers exercise writer-before/after observation and source revisions that do not touch global sequence.
8. A reported unsupported or failed check never changes the fixed gated verdict. A stale pass cannot count. A current fail plus unsupported gate uses the documented verdict precedence.
9. No-open-work gate covers all scoped open review/question owners, including records beyond a default page limit and owner withdrawal/revision, or stays `not_established`; one empty attention page cannot pass.
10. Repeated HTTP and MCP reads preserve all row counts, attestations, command receipts and source records. An agent cannot reach capture through the ordinary read catalog.

Use real synthetic PostgreSQL/API HTTP and MCP E2E workflows and retain replayable setup/run instructions, owner receipts, redacted artifacts, original record digests, current dependency observations, denominator facts and row-count before/after evidence under `test-results/agent-p1`. Required implementation checks: `check:changed`, `check:changed:full`, `check:owners`, `test:mcp`, `test:mcp:eval`; browser test changes additionally follow TesterArmy/Luna and `check:browser`. These checks were not run for this read-only design. Synthetic proof does not establish production readiness, provider acceptance or statutory close.

## Open questions and risks

- What exact ordinary-period admission should `aut06_month_v1` support when stored periods have arbitrary dates and no month/year discriminator? Keep unsupported scope inconclusive until resolved, rather than invent annual policy.
- Can the existing canonical period-attention CTE plus a conservative book-wide latest-question metadata inventory establish the required gate? This grounded implementation option deliberately over-blocks a month for unresolved questions elsewhere in the book; retain that declared scope and its dependency digest, or keep the gate `not_established` until a narrower complete owner exists.
- Can the transaction wrapper establish REPEATABLE READ before every admission SELECT while preserving existing guards, and can retryable serialization/command-key races be demonstrated over the real operation?

## Next implementation step

Write the E2E admission/replay/staleness failure contract first, then implement the append-only coverage schema and the single bank attestation capture against transaction-taking existing owner readers.

## Grounding evidence

- Contract: `docs/plans/05-accounting-agent/phase-01-close-predicate.md`; `docs/operations/automation-coverage-vectors.md`; `/tmp/drastic-aut06-grounding.md`.
- Ordinary periods/fiscal years: `apps/api/src/db/schema.ts:173-190`; authoritative period reader `apps/api/src/db/closing/inventories.ts:89-106`; synthetic period/year containment and unsupported statutory shape `apps/api/src/db/closing/inventories.ts:398-407,594-595`.
- Bank capture/atomic receipt and retained freshness: `apps/api/src/application/banking/reconciliations.ts:490-522,565-650`; view contract `packages/contracts/src/reconciliation.ts:158-164`; coverage freshness `apps/api/src/application/banking/coverage.ts:491-526`; parent-grounded global coverage ledger dependency `apps/api/src/application/banking/shared.ts:425`.
- Existing transaction-taking banking integration precedent: `apps/api/src/application/banking/reconciliations.ts:687` (`readCashOpeningWitnessInTransaction`).
- Actual VAT immutable owner/currentness: `apps/api/src/application/vat/actual-return.ts:1076-1232,1286-1456,1459-1486`.
- Unsupported contracts: `packages/contracts/src/closing-providers.ts:5-14,69-72,121-128`; `packages/contracts/src/closing.ts:30-39`; tax-account control `apps/api/src/application/vat/tax-account.ts:1896`.
- Existing multi-owner composition: `apps/api/src/application/firm-portfolio.ts:123-200`; existing readiness’s own transaction `apps/api/src/application/closing/proposals.ts:115-135`.
- Question ownership and bounded inventories: `apps/api/src/application/work-questions.ts:1-57`; canonical attention import/use `apps/api/src/application/firm-portfolio.ts:8,123`. Full no-open-work closure remains an explicit implementation risk, not proven by this trace.
- Skill basis: canonical architect `SKILL.md`, runner prompt, rationale template and design-red-flags under `/Users/admin/.codex/plugins/cache/pstack-codex/pstack/0.15.2+codex.20260918001226/skills/architect/`; software-engineering architecture and communication guides.

Self-screen: no caller-selected gates/statuses, public transport types, mutable latest pointer, temporal load/validate/save modules, or owner arithmetic copies. The producer dispatch hides genuine owner differences; reject extra pass-through adapters.
