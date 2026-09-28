import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { Description, Digest, Identifier } from "./values";
import { MinorUnits } from "./money";

// Pure agent-context math for one book.
// NEXT-50 leaf: compact cross-domain orientation, work ranking and delta
// semantics over existing owners. Context rows point at owning records;
// they are never mutable balances, a second approval register, or a vector
// store of financial facts. Source quotations stay untrusted evidence.
// Salary details never enter a context the principal may not see: a
// revoked grant forces a fresh capture rather than a leaking delta. The
// application owns coherent capture, adapter reads and receipt storage.

export const ContextFailureCode = Schema.Literals([
  "ScopeFingerprintChanged",
  "ContextVersionMismatch",
  "GoalSemanticsMismatch",
  "UnavailableAsZero",
  "IncompleteCoverageClaimed",
  "BlockerHidden",
  "EffectsMerged",
  "ApprovalForged",
]);

export type ContextFailureCode = typeof ContextFailureCode.Type;

export const ContextFailure = Schema.Struct({
  code: ContextFailureCode,
  message: Description,
});

export type ContextFailure = typeof ContextFailure.Type;

export type Checked<A> = Result.Result<A, ContextFailure>;

function fail(code: ContextFailureCode, message: string): Checked<never> {
  return Result.fail({ code, message });
}

export const ModuleStatus = Schema.Literals([
  "available",
  "unsupported",
  "unavailable",
  "not_authorized",
]);

export type ModuleStatus = typeof ModuleStatus.Type;

export const WorkSeverity = Schema.Literals(["blocks_goal", "material", "routine"]);

export type WorkSeverity = typeof WorkSeverity.Type;

export const WorkRef = Schema.Struct({
  owner: Identifier,
  identity: Identifier,
  revision: MinorUnits,
  kind: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
  severity: WorkSeverity,
  affectedPeriod: Schema.NullOr(Identifier),
  blockedOperation: Schema.NullOr(Identifier),
  missingInputs: Schema.Array(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128))),
  nextPermittedPreparation: Schema.NullOr(Identifier),
  immutableRef: Identifier,
  digest: Digest,
});

export type WorkRef = typeof WorkRef.Type;

export const ModuleSummary = Schema.Struct({
  owner: Identifier,
  status: ModuleStatus,
  rowCount: MinorUnits,
  fullCount: MinorUnits,
  hasContinuation: Schema.Boolean,
  coverageKnown: Schema.Boolean,
  ownerVersion: Schema.NullOr(Identifier),
});

export type ModuleSummary = typeof ModuleSummary.Type;

export const BookContextSnapshot = Schema.Struct({
  id: Identifier,
  principalScopeFingerprint: Digest,
  bookId: Identifier,
  goal: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
  recordedCutoff: Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)),
  ledgerBoundary: Identifier,
  contextVersion: MinorUnits,
  modules: Schema.Array(ModuleSummary),
  work: Schema.Array(WorkRef),
  allowedCapabilities: Schema.Array(Identifier),
  contentDigest: Digest,
});

export type BookContextSnapshot = typeof BookContextSnapshot.Type;

// A module reporting zero rows with unknown coverage must not be read as
// complete: unknown coverage is an explicit unknown, never zero unresolved
// cases. An unavailable module contributes no work rows at all.
export function assertModuleCompleteness(module: ModuleSummary): Checked<ModuleSummary> {
  if (module.status === "unavailable" || module.status === "not_authorized") {
    if (BigInt(module.rowCount) !== 0n) {
      return fail("UnavailableAsZero", "An unavailable module cannot contribute work rows.");
    }

    return Result.succeed(module);
  }

  if (BigInt(module.rowCount) === 0n && !module.coverageKnown) {
    return fail(
      "IncompleteCoverageClaimed",
      "Zero rows with unknown coverage must not be reported complete.",
    );
  }

  return Result.succeed(module);
}

export const RankedQuestion = Schema.Struct({
  question: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
  affectedRefs: Schema.Array(Identifier),
  distinctEffects: MinorUnits,
});

export type RankedQuestion = typeof RankedQuestion.Type;

export const RankedWork = Schema.Struct({
  orderedIdentities: Schema.Array(Identifier),
  questions: Schema.Array(RankedQuestion),
});

export type RankedWork = typeof RankedWork.Type;

export const RankWorkInput = Schema.Struct({
  snapshot: BookContextSnapshot,
  goal: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
  period: Schema.NullOr(Identifier),
  deadlineUrgency: Schema.Array(Schema.Struct({ identity: Identifier, dueRank: MinorUnits })),
});

export type RankWorkInput = typeof RankWorkInput.Type;

function severityRank(severity: WorkSeverity) {
  if (severity === "blocks_goal") return 0;

  if (severity === "material") return 1;

  return 2;
}

// Work selection keeps only authorized work relevant to the goal and period,
// orders by goal prevention, materiality class, deadline urgency and stable
// owner/identity, and collapses repeated identical missing-fact blockers
// into one question with affected refs. Collapsed questions never merge
// distinct financial effects: the effect count travels with the question.
export function rankWork(input: RankWorkInput): Checked<RankedWork> {
  if (input.snapshot.goal !== input.goal) {
    return fail("GoalSemanticsMismatch", "Ranking needs the snapshot's own goal.");
  }

  const relevant = input.snapshot.work.filter(
    (item) =>
      (input.period === null ||
        item.affectedPeriod === null ||
        item.affectedPeriod === input.period) &&
      (item.blockedOperation === null ||
        input.snapshot.allowedCapabilities.includes(item.blockedOperation)),
  );

  const urgency = new Map(input.deadlineUrgency.map((entry) => [entry.identity, entry.dueRank]));

  const ordered = [...relevant].sort((left, right) => {
    const severity = severityRank(left.severity) - severityRank(right.severity);

    if (severity !== 0) return severity;

    const leftDue = urgency.get(left.identity);
    const rightDue = urgency.get(right.identity);

    if (leftDue !== undefined && rightDue !== undefined && leftDue !== rightDue) {
      return BigInt(leftDue) < BigInt(rightDue) ? -1 : 1;
    }

    if (leftDue !== undefined && rightDue === undefined) return -1;

    if (leftDue === undefined && rightDue !== undefined) return 1;

    if (left.owner !== right.owner) return left.owner < right.owner ? -1 : 1;

    return left.identity < right.identity ? -1 : left.identity > right.identity ? 1 : 0;
  });

  const questions = new Map<string, RankedQuestion>();

  for (const item of ordered) {
    if (item.missingInputs.length === 0) continue;

    const key = [...item.missingInputs].sort().join("\u0000");
    const existing = questions.get(key);

    if (existing === undefined) {
      questions.set(key, {
        question: `Missing ${[...item.missingInputs].sort().join(", ")}`,
        affectedRefs: [item.immutableRef],
        distinctEffects: "1",
      });
    } else {
      questions.set(key, {
        question: existing.question,
        affectedRefs: [...existing.affectedRefs, item.immutableRef],
        distinctEffects: (BigInt(existing.distinctEffects) + 1n).toString(),
      });
    }
  }

  return Result.succeed({
    orderedIdentities: ordered.map((item) => item.identity),
    questions: [...questions.values()],
  });
}

export const DeltaEntry = Schema.Struct({
  owner: Identifier,
  identity: Identifier,
  state: Schema.Literals(["added", "changed", "resolved", "removed", "unknown_now"]),
});

export type DeltaEntry = typeof DeltaEntry.Type;

export const ContextDelta = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("delta"),
    entries: Schema.Array(DeltaEntry),
    baseDigest: Digest,
    targetDigest: Digest,
  }),
  Schema.Struct({
    kind: Schema.Literal("fresh_context_required"),
  }),
]);

export type ContextDelta = typeof ContextDelta.Type;

export const DeltaInput = Schema.Struct({
  base: BookContextSnapshot,
  target: BookContextSnapshot,
  ownerReportedResolved: Schema.Array(Identifier),
  confirmedScopeChanges: Schema.Array(Identifier),
});

export type DeltaInput = typeof DeltaInput.Type;

// Delta semantics compare by owner and identity, never display text. A
// changed scope fingerprint returns FreshContextRequired with no old
// private names or values. An item absent because an adapter failed is
// unknown, never resolved; only an explicit owner resolution report
// resolves, and only a confirmed scope change removes.
export function getContextDelta(input: DeltaInput): Checked<ContextDelta> {
  if (input.base.principalScopeFingerprint !== input.target.principalScopeFingerprint) {
    return Result.succeed({ kind: "fresh_context_required" });
  }

  if (input.base.bookId !== input.target.bookId || input.base.goal !== input.target.goal) {
    return fail("GoalSemanticsMismatch", "A delta needs the same book and goal semantics.");
  }

  if (input.base.contextVersion !== input.target.contextVersion) {
    return fail(
      "ContextVersionMismatch",
      "A delta needs supported context versions on both sides.",
    );
  }

  const keyOf = (owner: string, identity: string) => `${owner}\u0000${identity}`;

  const baseByKey = new Map(
    input.base.work.map((item) => [keyOf(item.owner, item.identity), item]),
  );

  const targetByKey = new Map(
    input.target.work.map((item) => [keyOf(item.owner, item.identity), item]),
  );

  const resolved = new Set(input.ownerReportedResolved);
  const scopeChanged = new Set(input.confirmedScopeChanges);
  const entries: Array<DeltaEntry> = [];

  for (const [key, item] of targetByKey) {
    const prior = baseByKey.get(key);

    if (prior === undefined) {
      entries.push({ owner: item.owner, identity: item.identity, state: "added" });
    } else if (prior.digest !== item.digest || prior.revision !== item.revision) {
      entries.push({ owner: item.owner, identity: item.identity, state: "changed" });
    }
  }

  for (const [key, item] of baseByKey) {
    if (targetByKey.has(key)) continue;

    if (resolved.has(item.immutableRef)) {
      entries.push({ owner: item.owner, identity: item.identity, state: "resolved" });
    } else if (scopeChanged.has(item.immutableRef)) {
      entries.push({ owner: item.owner, identity: item.identity, state: "removed" });
    } else {
      entries.push({ owner: item.owner, identity: item.identity, state: "unknown_now" });
    }
  }

  return Result.succeed({
    kind: "delta",
    entries,
    baseDigest: input.base.contentDigest,
    targetDigest: input.target.contentDigest,
  });
}

export const SettlementHint = Schema.Struct({
  kind: Schema.Literal("settlement_suggestion"),
  invoiceIdentity: Identifier,
  paymentIdentity: Identifier,
});

export type SettlementHint = typeof SettlementHint.Type;

export const ClassifyPaymentInput = Schema.Struct({
  recognizedInvoiceIdentity: Identifier,
  newBankPaymentIdentity: Identifier,
  invoiceOutstanding: Schema.Boolean,
});

export type ClassifyPaymentInput = typeof ClassifyPaymentInput.Type;

// A new bank payment against a recognized invoice suggests a settlement,
// never a new purchase.
export function classifyIncomingPayment(input: ClassifyPaymentInput): Checked<SettlementHint> {
  if (!input.invoiceOutstanding) {
    return fail("GoalSemanticsMismatch", "A settled invoice takes no settlement suggestion.");
  }

  return Result.succeed({
    kind: "settlement_suggestion",
    invoiceIdentity: input.recognizedInvoiceIdentity,
    paymentIdentity: input.newBankPaymentIdentity,
  });
}
