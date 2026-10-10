import * as Contracts from "@open-erp/contracts/dimensions";
import type { OriginalDimensionAssignment } from "@open-erp/domain/dimensions";
import * as Restatement from "@open-erp/domain/dimension-restatement";
import { AccountingError, FailureCode } from "@open-erp/domain/errors";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { failure } from "../failures";
import * as Catalogue from "../../db/dimensions";
import type { Transaction } from "../../db/transaction";
import {
  decode,
  requireTableAccess,
  toJsonObject,
  withBook,
  type Scope,
} from "../commerce/support";
import { digest } from "../json";
import { isoNow, replay, saveCommand } from "../command-receipts";
import { newId } from "../identifiers";

// NEXT-43. The application owner of reviewed dimension restatement.
//
// Three responsibilities and nothing else:
//   * preparation reads the retained original assignments, the current
//     classification heads and the exact retained financial facts of a named
//     selection, and seals the preview. The request names posted lines and a
//     desired reviewed assignment set; it states no amount, account, currency,
//     tax point or economic owner, and it states no financial fact.
//   * application re-reads the sealed plan, re-checks every head against the
//     revision the reviewer approved, and appends the reviewed history beside
//     the original tags. It never edits a journal line, an original assignment
//     or a posted amount.
//   * a read resolves one line's classification as at a cutoff, as the original
//     recorded tags or as the latest approved reviewed revision at or before
//     that cutoff.
//
// The pure rules are in @open-erp/domain/dimension-restatement. This module owns
// the transaction, the mapping from a domain refusal to the public error
// family, and nothing about the financial meaning of a posting.
//
// The reviewed analytical policy is a configuration witness, exactly as NEXT-14's
// posting witness is, and it is sealed into the plan a reviewer approves. It is
// not derived from retained rows, and it is not a financial fact.

type Refusal = {
  readonly code: Restatement.RestatementFailureCode;
  readonly message: string;
};

type PublicFailureCode = typeof FailureCode.Type;

// Every domain refusal maps onto the existing public error family. A head that
// moved is a stale dependency, because the reviewer approved a different state.
// A selection that contradicts the retained financial facts, or that would move
// money between dimension buckets, is an invalid journal rather than a stale
// read: the request itself is wrong.
const refusals = {
  IncompleteSelection: "InvalidJournal",
  FinancialChangeRejected: "InvalidJournal",
  UnknownOriginalHistory: "InvalidJournal",
  IncompleteAssignmentSet: "InvalidJournal",
  PolicyViolation: "InvalidJournal",
  TotalsChanged: "InvalidJournal",
  HeadMismatch: "StaleDependency",
} satisfies Record<Restatement.RestatementFailureCode, PublicFailureCode>;

function refuse(outcome: Refusal): Effect.Effect<never, AccountingError> {
  return Effect.fail(
    new AccountingError({ code: refusals[outcome.code], message: outcome.message }),
  );
}

const AssignmentsSchema = Schema.Array(
  Schema.Struct({
    dimensionCode: Schema.String,
    valueCode: Schema.NullOr(Schema.String),
    valueRevision: Schema.NullOr(Schema.Number),
  }),
);

function decodeAssignments(value: unknown): ReadonlyArray<Restatement.ReviewedAssignment> {
  return Schema.decodeUnknownSync(AssignmentsSchema)(value).map((assignment) => ({
    dimensionCode: assignment.dimensionCode,
    valueCode: assignment.valueCode,
    valueRevision: assignment.valueRevision,
  }));
}

function toJsonAssignments(assignments: ReadonlyArray<Restatement.ReviewedAssignment>) {
  return assignments.map((assignment) => ({
    dimensionCode: assignment.dimensionCode,
    valueCode: assignment.valueCode,
    valueRevision: assignment.valueRevision,
  }));
}

// The exact signed amount one posted line contributes, derived from the
// retained journal row rather than from any request.
function readLineAmount(transaction: Transaction, bookId: string, line: Catalogue.LineIdentity) {
  return Effect.gen(function* () {
    const facts = (yield* Catalogue.readLineFinancialFacts(transaction, bookId, line))[0];

    if (facts === undefined) return yield* failure("NotFound");

    return BigInt(facts.debitMinor) - BigInt(facts.creditMinor);
  });
}

// A digest of the retained financial facts of one line. It exists so the
// compiler can prove the review changed no financial fact, and it is computed
// here from retained rows.
function readLineFinancialDigest(
  transaction: Transaction,
  bookId: string,
  line: Catalogue.LineIdentity,
) {
  return Effect.gen(function* () {
    const facts = (yield* Catalogue.readLineFinancialFacts(transaction, bookId, line))[0];

    if (facts === undefined) return null;

    return yield* digest({
      accountId: facts.accountId,
      debitMinor: facts.debitMinor,
      creditMinor: facts.creditMinor,
      postingDate: facts.postingDate,
    });
  });
}

function toOriginal(row: Catalogue.AssignmentRow): OriginalDimensionAssignment {
  return {
    dimensionCode: row.dimensionCode,
    dimensionRevision: row.dimensionRevision,
    status: row.status,
    valueCode: row.valueCode,
    valueRevision: row.valueRevision,
    capturedLabel: row.capturedLabel,
    exemptionEvidenceId: row.exemptionEvidenceId,
    sourceValueCode: row.sourceValueCode,
  };
}

// classificationAt answers with either the original recorded tags or a reviewed
// set. The wire shape is always a reviewed set, so an original entry that was
// not explicit becomes an explicit null value here: an explicitly removed
// assignment must read as unassigned rather than inherit today's default.
type ResolvedAssignments =
  | ReadonlyArray<Restatement.ReviewedAssignment>
  | ReadonlyArray<OriginalDimensionAssignment>;

function normalize(resolved: ResolvedAssignments): ReadonlyArray<Restatement.ReviewedAssignment> {
  return resolved.map((entry) => {
    if ("status" in entry) {
      return {
        dimensionCode: entry.dimensionCode,
        valueCode: entry.status === "explicit" ? entry.valueCode : null,
        valueRevision: entry.status === "explicit" ? entry.valueRevision : null,
      };
    }

    return {
      dimensionCode: entry.dimensionCode,
      valueCode: entry.valueCode,
      valueRevision: entry.valueRevision,
    };
  });
}

// An untouched line has no head row. That is revision 0, the original tag, so
// an absent row is a fact rather than a missing one.
function readHead(transaction: Transaction, bookId: string, line: Catalogue.LineIdentity) {
  return Effect.gen(function* () {
    const row = (yield* Catalogue.readClassificationHead(transaction, bookId, line))[0];

    return {
      lineId: line.lineId,
      revisionId: row?.revisionId ?? 0,
      version: row?.version ?? 0,
    } satisfies Restatement.ClassificationHead;
  });
}

// The reviewed set currently in force for one line, resolved from its retained
// revisions. A line with no revision resolves to its original tags, which is
// exactly what a head at revision 0 means.
function readCurrentReviewed(
  revisions: ReadonlyArray<Catalogue.ClassificationRevisionRow>,
  original: ReadonlyArray<OriginalDimensionAssignment>,
) {
  const records = revisions.map((row): Restatement.ClassificationRevisionRecord => ({
    revisionId: row.revisionId,
    recordedAt: row.recordedAt,
    assignments: decodeAssignments(row.assignments),
  }));

  return normalize(
    Restatement.classificationAt(original, records, "reviewed", "9999-12-31T23:59:59Z"),
  );
}

function toRecords(rows: ReadonlyArray<Catalogue.ClassificationRevisionRow>) {
  return rows.map((row): Restatement.ClassificationRevisionRecord => ({
    revisionId: row.revisionId,
    recordedAt: row.recordedAt,
    assignments: decodeAssignments(row.assignments),
  }));
}

type SelectedLine = { readonly voucherId: string; readonly lineId: string };

// The line id is only unique inside its voucher, and the plan keys a line by
// its line id, so a selection that reuses one line id across two vouchers would
// silently collapse two lines into one. That is refused here.
function selectionOf(
  input: typeof Contracts.PrepareRestatement.Type,
): ReadonlyArray<SelectedLine> | null {
  const lines = input.lines.map((line) => ({
    voucherId: line.voucherId,
    lineId: line.lineId,
  }));

  if (new Set(lines.map((line) => line.lineId)).size !== lines.length) return null;

  return lines;
}

// Preparation. The retained original assignments, the current heads and the
// exact retained line amounts are read inside the transaction, the pure compiler
// decides the reviewed plan, and the plan is sealed with its digest and its
// selection. The reviewer approves exactly what they saw.
export const prepareDimensionRestatement = Effect.fn("dimensions.prepareRestatement")(function* (
  token: string,
  command: {
    readonly scope: Scope;
    readonly idempotencyKey: string;
    readonly input: typeof Contracts.PrepareRestatement.Type;
  },
) {
  return yield* withBook(token, command.scope, true, function* (transaction, principal) {
    const operation = "prepare_dimension_restatement";

    const request = yield* replay(
      transaction,
      command.scope,
      command.idempotencyKey,
      operation,
      principal.actorId,
      yield* toJsonObject(command.input),
      Contracts.RestatementPlanView,
    );

    if (request.previous) return request.previous;

    yield* requireTableAccess(transaction, Catalogue.classificationTables, true);

    const lines = selectionOf(command.input);

    if (lines === null) return yield* failure("InvalidJournal");

    const sealed: Array<Restatement.RestatementLine> = [];

    for (const line of lines) {
      const identity: Catalogue.LineIdentity = {
        voucherId: line.voucherId,
        lineId: line.lineId,
      };

      const rows = yield* Catalogue.readOriginalAssignmentsForLine(
        transaction,
        command.scope.bookId,
        identity,
      );

      const [head, signedMinor, retainedFinancialDigest, revisions] = yield* Effect.all([
        readHead(transaction, command.scope.bookId, identity),
        readLineAmount(transaction, command.scope.bookId, identity),
        readLineFinancialDigest(transaction, command.scope.bookId, identity),
        Catalogue.readClassificationRevisions(transaction, command.scope.bookId, identity),
      ]);

      if (retainedFinancialDigest === null) return yield* failure("NotFound");

      sealed.push({
        lineId: line.lineId,
        financialDigest: retainedFinancialDigest,
        retainedFinancialDigest,
        signedMinor: signedMinor.toString(),
        originalAssignments: rows.map(toOriginal),
        currentAssignments: [...readCurrentReviewed(revisions, rows.map(toOriginal))],
        currentHeadRevision: head.revisionId,
      });
    }

    const compiled = Restatement.prepareRestatement({
      analyticalScope: command.input.analyticalScope,
      policy: command.input.dimensionPolicy,
      lines: sealed,
      changes: command.input.changes.map((change) => ({
        lineId: change.lineId,
        expectedHeadRevision: change.expectedHeadRevision,
        desiredAssignments: change.desiredAssignments,
        reason: change.reason,
      })),
    });

    if (Result.isFailure(compiled)) return yield* refuse(compiled.failure);

    const planId = newId("dimension_restatement");
    const now = yield* isoNow(transaction);

    const body = {
      scope: command.scope,
      planId,
      analyticalScope: command.input.analyticalScope,
      plan: compiled.success,
    };

    const planDigest = yield* digest(body);

    yield* Catalogue.insertRestatementPlan(transaction, {
      bookId: command.scope.bookId,
      id: planId,
      analyticalScope: command.input.analyticalScope,
      reason: command.input.reason,
      digest: planDigest,
      plan: yield* toJsonObject(compiled.success),
      selection: lines.map((line) => ({ lineId: line.lineId, voucherId: line.voucherId })),
      recordedAt: now,
    });

    const view = yield* decode(
      Contracts.RestatementPlanView,
      yield* toJsonObject({ ...body, digest: planDigest, createdAt: now }),
    );

    yield* saveCommand(
      transaction,
      command.scope,
      command.idempotencyKey,
      request.expected,
      operation,
      principal.actorId,
      yield* toJsonObject(view),
    );

    return view;
  });
});

const SealedPlanSchema = Schema.Struct({
  analyticalScope: Schema.String,
  assignments: Schema.Array(
    Schema.Struct({
      lineId: Schema.String,
      expectedHeadRevision: Schema.Number,
      desiredAssignments: AssignmentsSchema,
      reason: Schema.String,
    }),
  ),
});

// Application. The sealed plan and its selection are re-read and the digest
// checked, then every head is re-read and compared with the revision the
// reviewer approved. A head that moved refuses instead of merging, an identical
// desired set replays without a new version, and the revision is appended
// beside the original tags in the same transaction.
export const applyDimensionRestatement = Effect.fn("dimensions.applyRestatement")(function* (
  token: string,
  command: {
    readonly scope: Scope;
    readonly idempotencyKey: string;
    // The plan is addressed by the path, so the id arrives beside the payload.
    readonly planId: string;
    readonly input: typeof Contracts.ApplyRestatement.Type;
  },
) {
  return yield* withBook(token, command.scope, true, function* (transaction, principal) {
    const operation = "apply_dimension_restatement";

    const request = yield* replay(
      transaction,
      command.scope,
      command.idempotencyKey,
      operation,
      principal.actorId,
      yield* toJsonObject(command.input),
      Contracts.RestatementApplied,
    );

    if (request.previous) return request.previous;

    yield* requireTableAccess(transaction, Catalogue.classificationTables, true);

    const row = (yield* Catalogue.readRestatementPlan(
      transaction,
      command.scope.bookId,
      command.planId,
    ))[0];

    if (row === undefined) return yield* failure("NotFound");

    if (row.digest !== command.input.digest) return yield* failure("StaleDependency");

    const plan = Schema.decodeUnknownSync(SealedPlanSchema)(row.plan);
    const selection = Catalogue.decodePlanSelection(row.selection);
    const voucherOf = new Map(selection.map((entry) => [entry.lineId, entry.voucherId]));
    const now = yield* isoNow(transaction);
    const results: Array<typeof Contracts.RestatementAppliedLine.Type> = [];
    let appended = 0;
    let replayed = 0;

    for (const entry of plan.assignments) {
      const voucherId = voucherOf.get(entry.lineId);

      if (voucherId === undefined) return yield* failure("InvalidJournal");

      const identity: Catalogue.LineIdentity = { voucherId, lineId: entry.lineId };
      const head = yield* readHead(transaction, command.scope.bookId, identity);

      const original = (yield* Catalogue.readOriginalAssignmentsForLine(
        transaction,
        command.scope.bookId,
        identity,
      )).map(toOriginal);

      const revisions = yield* Catalogue.readClassificationRevisions(
        transaction,
        command.scope.bookId,
        identity,
      );

      const current = readCurrentReviewed(revisions, original);

      const outcome = Restatement.appendRevision(
        head,
        entry.expectedHeadRevision,
        decodeAssignments(entry.desiredAssignments),
        current,
        now,
      );

      if (Result.isFailure(outcome)) return yield* refuse(outcome.failure);

      if (outcome.success.outcome === "replayed") {
        replayed += 1;

        results.push({
          voucherId,
          lineId: entry.lineId,
          outcome: "replayed",
          revisionId: outcome.success.head.revisionId,
          version: outcome.success.head.version,
        });

        continue;
      }

      const revision = outcome.success.revision;

      appended += 1;

      yield* Catalogue.insertClassificationRevision(transaction, {
        bookId: command.scope.bookId,
        voucherId,
        lineId: entry.lineId,
        revisionId: revision.revisionId,
        analyticalScope: row.analyticalScope,
        reason: entry.reason,
        assignments: toJsonAssignments(revision.assignments),
        recordedAt: now,
      });

      if (head.revisionId === 0) {
        yield* Catalogue.insertClassificationHead(transaction, {
          bookId: command.scope.bookId,
          voucherId,
          lineId: entry.lineId,
          revisionId: revision.revisionId,
          version: outcome.success.head.version,
          recordedAt: now,
        });
      } else {
        yield* Catalogue.updateClassificationHead(transaction, {
          bookId: command.scope.bookId,
          voucherId,
          lineId: entry.lineId,
          revisionId: revision.revisionId,
          version: outcome.success.head.version,
          recordedAt: now,
        });
      }

      results.push({
        voucherId,
        lineId: entry.lineId,
        outcome: "appended",
        revisionId: revision.revisionId,
        version: outcome.success.head.version,
      });
    }

    const view = yield* decode(
      Contracts.RestatementApplied,
      yield* toJsonObject({
        scope: command.scope,
        planId: command.planId,
        digest: command.input.digest,
        appendedCount: appended,
        replayedCount: replayed,
        lines: results,
        createdAt: now,
      }),
    );

    yield* saveCommand(
      transaction,
      command.scope,
      command.idempotencyKey,
      request.expected,
      operation,
      principal.actorId,
      yield* toJsonObject(view),
    );

    return view;
  });
});

// Report-time resolution. The retained original tags and the retained revision
// history are read and the pure compiler answers which set applied at this
// cutoff. A saved report keeps the view it was built from, because the cutoff is
// part of the question rather than a display choice.
export const dimensionClassificationView = Effect.fn("dimensions.classificationView")(function* (
  token: string,
  command: { readonly scope: Scope; readonly input: typeof Contracts.ClassificationQuery.Type },
) {
  return yield* withBook(token, command.scope, false, function* (transaction) {
    yield* requireTableAccess(transaction, Catalogue.classificationTables, false);

    const identity: Catalogue.LineIdentity = {
      voucherId: command.input.voucherId,
      lineId: command.input.lineId,
    };

    const original = (yield* Catalogue.readOriginalAssignmentsForLine(
      transaction,
      command.scope.bookId,
      identity,
    )).map(toOriginal);

    const revisions = yield* Catalogue.readClassificationRevisions(
      transaction,
      command.scope.bookId,
      identity,
    );

    const resolved = Restatement.classificationAt(
      original,
      toRecords(revisions),
      command.input.mode,
      command.input.classificationCutoff,
    );

    const latest = revisions
      .filter((row) => row.recordedAt <= command.input.classificationCutoff)
      .at(-1);

    return yield* decode(
      Contracts.ClassificationView,
      yield* toJsonObject({
        scope: command.scope,
        voucherId: command.input.voucherId,
        lineId: command.input.lineId,
        mode: command.input.mode,
        classificationCutoff: command.input.classificationCutoff,
        resolvedRevisionId: latest?.revisionId ?? 0,
        assignments: toJsonAssignments(normalize(resolved)),
        revisionCount: revisions.length,
      }),
    );
  });
});

// The original-versus-reviewed analytical view over a selection. It reads the
// retained original tags and the retained revision history, then the pure
// compiler partitions the same selection per dimension in both views. No amount,
// original tag or revision is touched, and two dimensions are never added
// together: each is independent of the others.
export const dimensionRestatementView = Effect.fn("dimensions.restatementView")(function* (
  token: string,
  command: { readonly scope: Scope; readonly input: typeof Contracts.AnalyticalViewQuery.Type },
) {
  return yield* withBook(token, command.scope, false, function* (transaction) {
    yield* requireTableAccess(transaction, Catalogue.classificationTables, false);

    // The same scoped line twice would double its amount in every partition
    // while both conservation checks repeat the mistake, so refuse up front.
    const identities = command.input.lines.map(
      (selected) => `${selected.voucherId}:${selected.lineId}`,
    );

    if (new Set(identities).size !== identities.length) return yield* failure("InvalidJournal");

    const lines: Array<Restatement.AnalyticalViewLine> = [];

    for (const selected of command.input.lines) {
      const identity: Catalogue.LineIdentity = {
        voucherId: selected.voucherId,
        lineId: selected.lineId,
      };

      const original = (yield* Catalogue.readOriginalAssignmentsForLine(
        transaction,
        command.scope.bookId,
        identity,
      )).map(toOriginal);

      const rows = yield* Catalogue.readClassificationRevisions(
        transaction,
        command.scope.bookId,
        identity,
      );

      lines.push({
        voucherId: selected.voucherId,
        lineId: selected.lineId,
        signedMinor: (yield* readLineAmount(
          transaction,
          command.scope.bookId,
          identity,
        )).toString(),
        originalAssignments: original,
        revisions: toRecords(rows),
      });
    }

    const view = Restatement.analyticalView({
      lines,
      dimensionCodes: command.input.dimensionCodes,
      classificationCutoff: command.input.classificationCutoff,
    });

    if (Result.isFailure(view)) return yield* refuse(view.failure);

    return yield* decode(
      Contracts.AnalyticalViewResult,
      yield* toJsonObject({
        scope: command.scope,
        classificationCutoff: view.success.classificationCutoff,
        dimensionCodes: view.success.dimensionCodes,
        lineCount: view.success.lineCount,
        revisionCount: view.success.revisionCount,
        unfilteredTotalMinor: view.success.unfilteredTotalMinor,
        lines: view.success.lines.map((line) => ({
          voucherId: line.voucherId,
          lineId: line.lineId,
          signedMinor: line.signedMinor,
          original: line.original.map((entry) => ({
            dimensionCode: entry.dimensionCode,
            status: entry.status,
            valueCode: entry.valueCode,
            valueRevision: entry.valueRevision,
          })),
          reviewed: toJsonAssignments(line.reviewed),
          resolvedRevisionId: line.resolvedRevisionId,
        })),
        originalTotals: view.success.originalTotals,
        reviewedTotals: view.success.reviewedTotals,
      }),
    );
  });
});
