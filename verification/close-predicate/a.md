# AUT06 candidate A: one immutable capture, owner freshness ports

## Usage (caller’s view)

The public application surface is two operations. Capture accepts retained owner evidence identities, never check outcomes or amounts. Read returns the selected immutable capture plus current freshness; it never captures implicitly.

```ts
// Operator HTTP POST /v1/entities/:entityId/books/:bookId/periods/:periodId/close-predicate-captures
const capture = yield* captureClosePredicate(token, {
  scope, periodId, idempotencyKey,
  evidence: {
    inventory: { id: inventoryId, digest: inventoryDigest },
    bankInventorySignoff: { id: bankPlanId, digest: bankPlanDigest },
    actualVatReturn: { id: returnId, digest: returnDigest },
  },
});

// HTTP GET /.../periods/:periodId/close-predicate?captureId=...
const predicate = yield* readClosePredicate(token, { scope, periodId, captureId: capture.id });
// predicate.gated.voucher_support.retained.outcome.status === "not_established"
// predicate.gated.voucher_support.retained.outcome.reasons[0] === "voucher_support_owner_not_released"
// predicate.verdict === "inconclusive"

// Existing MCP dispatcher invokes the same read operation.
const result = yield* readClosePredicate(agentToken, { scope, periodId });
// No capture: every callable gate is not_run; unavailable gates stay explicit.
// A selected capture is immutable; result freshness belongs only to this read.
```

Missing evidence is a supported capture input using explicit `null`, yielding `not_run` for an available owner; foreign, malformed or mismatched supplied evidence is an admission refusal. Read without `captureId` selects the newest admitted capture by a stable database ordinal, without scanning bounded owner lists or inventing new evidence.

## Problem and grounding

Plan05 phase01 and `docs/operations/automation-coverage-vectors.md` require retained outcomes and live freshness to remain separate, with one book/period predicate. Existing public bank/VAT getters each open their own transactions, so sequencing those getters cannot establish a coherent aggregate. Their financial policy must stay with their owners.

- `apps/api/src/application/banking/reconciliations.ts:566-638` already compares source revision, account ledger sequence through the retained end date, currency, profile and native authority.
- `banking/signoffs.ts:38-68,170-242` owns completeness, exact statement membership and whole-interval consistency. `db/banking/shared.ts:425` includes the global committed book sequence in coverage dependency identity: a later-period posting stales coverage/inventory signoff even when exact account reconciliation remains current. `banking/inventory-signoffs.ts:51-75` owns current declared inventory. `packages/contracts/src/bank-inventory-signoffs.ts:28-65` limits this to `declared_inventory_only`, while company completeness is `not_established` and financial close readiness is false.
- `vat/actual-return.ts:1076-1223,1459-1483` owns actual-return currentness, including its deliberately conservative global `ledger_boundary_moved` rule. `packages/contracts/src/vat-returns.ts:880-913` owns calculation support, source coverage, control reconciliation and period verification.
- `vat/tax-account.ts:1896` retains `coverage: not_established`, `reconciled: false`; zero differences cannot promote this reported check.
- `db/workspace.ts:489-621,657-668,735-752` owns canonical period attention membership, including undated documents. `db/work-questions.ts:81-103` defines unresolved as latest state other than closed. Answered questions remain unresolved.

**Exact stored calendar month:** capture/read load `(book_id, period_id)` and require the stored bounds to start on day 1 and end on that month’s final calendar day. They freeze fiscal-year identity, row version and bounds. This is a month-close predicate, not annual close: phase01 names month close; `0001-schema.sql:323-334` permits any ordered interval; `0002-integrity.sql:213-240` only enforces fiscal-year containment and non-overlap. Native setup (`company-setup.ts:232-246`) generates month slices but can generate partial months at year edges. Neither an annual row nor a partial row qualifies. Do not synthesize January from a stored January–December row, accept request dates, or mutate the calendar. Refuse with named `calendar_month_period_required` diagnostic. Synthetic proof must create an actual stored month row in an isolated book.

## Shape: types and signatures

The sketch uses domain types, not HTTP schemas; names below are proposed. Bodies are deliberately unimplemented.

```ts
type EvidenceIdentity = Readonly<{ id: Identifier; digest: Digest }>;
type FrozenMonth = Readonly<{
  bookId: Identifier; periodId: Identifier; fiscalYearId: Identifier;
  startsOn: CalendarDate; endsOn: CalendarDate; periodVersion: Sequence;
}>; // Constructor validates the scoped stored row and exact calendar month.

type GateId = "bank_reconciliation" | "bank_coverage" | "voucher_support"
  | "complete_facts" | "no_open_reviews_or_questions" | "actual_vat_control";
type Outcome =
  | { readonly status: "pass"; readonly reasons: readonly [] }
  | { readonly status: "fail"; readonly reasons: NonEmptyReadonlyArray<Reason> }
  | { readonly status: "not_established"; readonly reasons: NonEmptyReadonlyArray<Reason> }
  | { readonly status: "not_run"; readonly reasons: NonEmptyReadonlyArray<Reason> };

type Dependency = Readonly<{ owner: OwnerId; ruleVersion: string; digest: Digest }>;
type CheckRecord = Readonly<{
  checkId: CheckId; outcome: Outcome;
  observedCutoff: { ledgerSequence: Sequence; dependencies: readonly Dependency[] };
  builderVersion: string; evidenceRefs: readonly EvidenceIdentity[];
  coverageFacts: CoverageFacts; // Exact denominator and admitted independent evidence scope.
}>;
type Freshness =
  | { readonly status: "fresh"; readonly currentDependencies: readonly Dependency[] }
  | { readonly status: "stale"; readonly reasons: NonEmptyReadonlyArray<Reason>;
      readonly currentDependencies: readonly Dependency[] }
  | { readonly status: "unavailable"; readonly reasons: NonEmptyReadonlyArray<Reason> };
type GateSet<T> = Readonly<{ [K in GateId]: T }>;
type Capture = Readonly<{
  id: Identifier; scope: BookScope; month: FrozenMonth; captureOrdinal: Sequence;
  builderVersion: string; inventoryDigest: Digest;
  gated: GateSet<CheckRecord>; reported: readonly CheckRecord[];
  digest: Digest; createdAt: Instant; receipt: CommandReceipt;
}>;
type ClosePredicate = Readonly<{
  scope: BookScope; month: FrozenMonth; capture: Capture | null;
  gated: GateSet<{ retained: CheckRecord; freshness: Freshness }>;
  reported: readonly { retained: CheckRecord; freshness: Freshness }[];
  verdict: "done" | "not_done" | "inconclusive";
}>;
type CaptureEvidence = Readonly<{
  inventory: EvidenceIdentity;
  bankInventorySignoff: EvidenceIdentity | null;
  actualVatReturn: EvidenceIdentity | null;
}>;

function captureClosePredicate(token: string, command: {
  scope: BookScope; periodId: Identifier; idempotencyKey: CommandKey;
  evidence: CaptureEvidence;
}): Effect<Capture, AccountingError> { throw new Error("not implemented"); }
function readClosePredicate(token: string, query: {
  scope: BookScope; periodId: Identifier; captureId?: Identifier;
}): Effect<ClosePredicate, AccountingError> { throw new Error("not implemented"); }

// Internal owner ports accept the caller’s already-admitted transaction.
// Each lives in its owner, reuses its existing access/profile/admission checks,
// decodes retained owner records, and hides those owner wire/storage details.
function readBankCloseWitnessInTransaction(tx: Transaction, admitted: AdmittedBook,
  month: FrozenMonth, selected: EvidenceIdentity | null): Effect<BankCloseWitness, AccountingError>;
function readActualVatCloseWitnessInTransaction(tx: Transaction, admitted: AdmittedBook,
  month: FrozenMonth, selected: EvidenceIdentity | null): Effect<VatCloseWitness, AccountingError>;
function readPeriodAttentionWitnessInTransaction(tx: Transaction, admitted: AdmittedBook,
  month: FrozenMonth): Effect<AttentionCloseWitness, AccountingError>;
function evaluateClosePredicate(capture: Capture | null,
  live: LiveOwnerWitnesses): ClosePredicate { throw new Error("not implemented"); }
```

Use a closed `GateSet`, not a caller-supplied array; unavailable phase02 voucher support and phase08 complete facts are mandatory `not_established` entries with their named missing owners. No caller, registry discovery or unavailable schema can omit them. Report AP/AR independent counterparties, legacy provider/subledger controls and tax account unsupported state separately; they cannot change the verdict or establish done.

Retained pass comes from admitted owner outcomes only. Bank pass is for the entire exact declared bank inventory and period, backed by signed inventory/member receipts and the bank owner’s complete reconciliation/coverage rules. A single balanced account cannot cover an omitted declared account. Source gaps, mapping failures, unavailable boundaries, missing signoffs or unresolved items retain reasons and denominator identities. This narrow pass never changes owner `companyCompleteness` or `financialCloseReady` claims. Extract a reusable in-transaction bank witness from current owners rather than copying arithmetic/completeness conditions into AUT06.

Actual VAT pass requires the owner’s supported calculation, verified matching registered period, complete independent source coverage, reconciled controls and no applicable blockers. A quarterly/yearly actual return cannot certify the requested month by slicing: mismatched evidence is refused. No suitable available month control is `not_run` or explicit `not_established` with the owner’s cadence reason. Preserve the VAT owner’s currentness reasons exactly; unrelated nonfinancial later-period preparations can leave dependencies unchanged and fresh; an actual later-period posting stales the bank coverage/inventory dependency as well as VAT under their existing global rules. Exact account reconciliation can remain current separately, but both bank gates require their own complete dependencies to be fresh. AUT06 adds no blanket aggregate global-sequence equality.

Attention uses the complete canonical period attention projection, not a page of `listAttention`; also retain book-wide latest question metadata conservatively because current anchors lack a complete period attribution contract. This exposes the scope as `period_attention_and_book_questions`, never quietly ignores undated questions. If that scope cannot be admitted completely, the gate is `not_established`. Store complete stable identities/revisions and counts in its digest. Empty attention alone never implies complete facts.

Verdict precedence: any fresh gated `fail` means `not_done`; otherwise any unavailable/stale gate or gated `not_run`/`not_established` means `inconclusive`; only all fresh gated pass means `done`. A stale fail is retained history, not a proven present failure. This explicit precedence prevents stale history from claiming a current result.

## Modules and atomicity

| Module | Knowledge owned |
| --- | --- |
| `packages/domain/src/close-predicate.ts` | Closed gate vocabulary, retained/live distinction and pure verdict; declare the actual API owner consumer in `docs/plans/domain-leaf-integration.json` |
| `apps/api/src/application/closing/close-predicate.ts` | Two deep operations, authority admission, frozen stored month, selected immutable inventory, one-snapshot composition, replay and atomic capture |
| Existing bank/VAT/workspace application owners | Their internal tx-passing witness/freshness ports and current eligibility rules; existing public getters reuse those ports where practical |
| `apps/api/src/db/closing/close-predicate.ts` + forward migration | Scoped immutable capture header/check membership, canonical digest, stable ordinal, `SELECT/INSERT` grants, immutable-row guard and command-receipt integration |
| `packages/contracts/src/close-predicate.ts`, shared API/catalog exports, closing HTTP/capability adapters | Bounded strict wire admission and output adaptation; thin route; one read-only MCP capability |

Before any admission SELECT, the transaction runner must execute `SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`. Pass that one transaction through principal admission and every owner witness. No public owner getter may nest a transaction. Capture additionally takes the existing book update barrier before replay/admission; read takes the shared book barrier. Repeatable read covers workspace/question writers that might not take an exclusive financial barrier; the financial barrier preserves current authority and owner rules.

Repeatable read can raise PostgreSQL `40001` after waiting on a concurrent book update. Do not pretend the existing runner retries it. Either add a narrow whole-transaction retry for recognized serialization failure, with a fresh snapshot and bounded attempts, or expose sanitized `Unavailable` and require the unchanged original-key retry. The latter is sufficient for safe delivery; simultaneous commands may need a retry before replay returns the same capture. Never reuse the old failed snapshot or manufacture a new key.

Capture writes its header, complete gated/reported membership, immutable evidence inventory and existing command receipt in the same transaction. Failure/crash before commit leaves none; unknown commit result recovers with the original key. Canonical request identity binds scoped period plus sorted immutable identities/digests and explicit absent selections. Same key/exact request returns the original capture **before live freshness validation**; same key/changed period or evidence inventory conflicts. An identical retry does not resnapshot attention or upgrade outcomes. New evidence needs a new explicit capture command/key. Never accept client amounts/statuses. Guard every reference by scoped book, exact frozen period and stored digest before any insertion.

GET/read uses only SELECT plus transaction/session settings and row locks; it writes no capture, receipt, cache, audit event, epoch or owner record. MCP advertises `readOnly: true`; existing `capabilityAgentPolicy` classifies it `read`. Capture remains operator HTTP only in phase01, avoiding a new agent write policy. Source-level catalogue changes still require the authored MCP verification later.

## Tradeoffs accepted and alternatives

We accept one append-only aggregate and full denominator capture in exchange for a recoverable coherent inventory whose historical outcomes cannot drift. Owner ports add only the transaction seam necessary to compose existing policy. We accept conservative book-wide questions and existing VAT global currentness in exchange for avoiding unsupported relevance rules.

An on-demand aggregate over independent public getters has fewer new persistence lines but exposes snapshot coordination to every caller and cannot retain an immutable historical outcome. A per-check append-only event stream with read-time merge offers independent writers but needs selection/ordering/period compatibility rules at every merge and weakens atomic command replay. Candidate A hides these rules behind the two operations; owner policy remains behind narrow internal witness ports.

## Synthesis decision

Candidate A supplied for arena comparison; the parent fills this section after judging the other whole-shape candidate.

## Failure-first proof and next step

Before implementation, encode authored AUT06 E2E failures: never-run, zero difference with missing statement, full declared bank pass, source revision stale without mutation, relevant and unrelated ledger changes under each owner rule, missing mapping/continuity, unsupported tax zero, absent AP/AR owner, foreign/mismatched/malformed evidence refusal, exact replay, key conflict, partial capture rollback, concurrent same-key retry, and HTTP/MCP read row-count stability. Add stored annual/partial period refusal and explicit unavailable voucher/complete-facts gates. Artifact must retain owner receipts, check states, denominator identities, digest changes and unchanged retained bytes under `test-results/agent-p1`; synthetic proof is separate from production qualification.

First implementation step: write the failure vectors and the exact-month/immutable aggregate contract before adding the capture transaction and owner ports. This candidate changes no source and runs no checks.
