import * as Contracts from "@open-erp/contracts/accounting";
import * as AssignmentContracts from "@open-erp/contracts/dimensions";
import * as Dimensions from "@open-erp/domain/dimensions";
import { AccountingError, FailureCode } from "@open-erp/domain/errors";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { failure } from "../failures";
import * as Catalogue from "../../db/dimensions";
import * as Db from "../../db/posting";
import { lockBookForShare } from "../../db/posting";
import type { Transaction } from "../../db/transaction";
import {
  decode,
  requireTableAccess,
  toJsonObject,
  unsupported,
  withBook,
  type JsonObject,
  type Scope,
} from "../commerce/support";

// NEXT-14. The application owner of a posted line's original dimension
// assignment.
//
// Three responsibilities and nothing else:
//   * preparation resolves one assignment state per dimension effective at the
//     posting date and seals it with the plan, so a reviewed default is never
//     inserted silently at execution or at a historical import;
//   * execution re-checks the sealed states against the catalogue and appends
//     the retained rows inside the caller's transaction, after the journal
//     lines and before the receipt;
//   * a read projects the retained rows over a dated window and freezes the SIE
//     object map for the same selection.
//
// The pure rules are in @open-erp/domain/dimensions. This module owns the
// transaction, the mapping from a domain refusal to the public error family,
// and nothing about the financial meaning of a posting.

type Action = typeof Contracts.VoucherPostingAction.Type;

type Line = Action["lines"][number];

type RefusalCode =
  | Dimensions.AssignmentFailureCode
  | Dimensions.ProjectionFailureCode
  | Dimensions.ObjectMapFailureCode;

type Refusal = { readonly code: RefusalCode; readonly message: string };

type PublicFailureCode = typeof FailureCode.Type;

// A stored voucher action is history and is read as history. Only the line
// identity is decoded here; the assignments a reversal must repeat come from
// the retained rows, not from the original action's own copy of them.
const StoredAction = Schema.Struct({
  lines: Schema.Array(Schema.Struct({ lineId: Schema.String })),
});

const originalStatuses: ReadonlyArray<Dimensions.OriginalDimensionStatus> = [
  "explicit",
  "explicit_unassigned",
  "historical_exemption",
  "not_recorded_in_source",
];

// Every domain refusal maps onto the existing public error family. A dimension
// with no reviewed requirement is an unsupported profile, an exemption without
// retained evidence is missing evidence, and a state that no longer resolves to
// the approved assignment set is a stale dependency.
const refusals = {
  unknown_dimension: "InvalidJournal",
  duplicate_dimension: "InvalidJournal",
  unordered_dimensions: "InvalidJournal",
  incomplete_policy: "UnsupportedProfile",
  inconsistent_status: "InvalidJournal",
  unknown_value: "InvalidJournal",
  ineligible_value: "InvalidJournal",
  not_an_explicit_value: "InvalidJournal",
  fixed_value_mismatch: "InvalidJournal",
  unbound_exemption: "MissingEvidence",
  reversal_mismatch: "InvalidJournal",
  changed_since_preparation: "StaleDependency",
  unconserved_partition: "InvalidJournal",
  revision_not_declared: "StaleDependency",
  too_many_dimensions: "UnsupportedProfile",
  too_many_objects: "UnsupportedProfile",
  ambiguous_source_code: "InvalidJournal",
} satisfies Record<RefusalCode, PublicFailureCode>;

function refuse(outcome: Refusal): Effect.Effect<never, AccountingError> {
  return Effect.fail(
    new AccountingError({ code: refusals[outcome.code], message: outcome.message }),
  );
}

function decodeJson<A>(schema: Schema.Decoder<A>, value: JsonObject) {
  return Schema.decodeEffect(schema)(value).pipe(Effect.mapError(() => failure("InternalError")));
}

type RetainedAssignment = {
  readonly dimensionCode: string;
  readonly dimensionRevision: number;
  readonly status: Dimensions.OriginalDimensionStatus;
  readonly valueCode: string | null;
  readonly valueRevision: number | null;
  readonly capturedLabel: string;
  readonly exemptionEvidenceId: string | null;
  readonly sourceValueCode: string | null;
};

function toAssignment(row: RetainedAssignment): Dimensions.OriginalDimensionAssignment {
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

type CapturedCatalogue = {
  readonly dimensions: ReadonlyArray<Dimensions.CatalogueDimension>;
  readonly values: ReadonlyArray<Dimensions.CatalogueValue>;
};

function captureCatalogue(transaction: Transaction, bookId: string, postingDate: string) {
  return Effect.gen(function* () {
    const catalogue: CapturedCatalogue = {
      dimensions: yield* Catalogue.readEffectiveDimensions(transaction, bookId, postingDate),
      values: yield* Catalogue.readEffectiveDimensionValues(transaction, bookId, postingDate),
    };

    return catalogue;
  });
}

type ReversalBasis = {
  readonly originalVoucherId: string;
  readonly originalLineIds: ReadonlyArray<string>;
  readonly byOriginalLine: ReadonlyMap<
    string,
    ReadonlyArray<Dimensions.OriginalDimensionAssignment>
  >;
};

// A reversal repeats the original line's retained assignment bytes. The stored
// rows are the authority, so a voucher posted before this owner still reverses
// against the facts on record and an archived catalogue value is inherited
// rather than recomputed.
function readReversalBasis(transaction: Transaction, bookId: string, originalVoucherId: string) {
  return Effect.gen(function* () {
    const voucherRows = yield* Db.readVoucher(transaction, bookId, originalVoucherId);

    if (voucherRows.length !== 1) return yield* failure("NotFound");

    const stored = yield* decodeJson(StoredAction, voucherRows[0]?.action ?? {});
    const rows = yield* Catalogue.readOriginalAssignments(transaction, bookId, originalVoucherId);
    const byLine = new Map<string, Array<Dimensions.OriginalDimensionAssignment>>();

    for (const row of rows) {
      const existing = byLine.get(row.lineId) ?? [];

      existing.push(toAssignment(row));
      byLine.set(row.lineId, existing);
    }

    const basis: ReversalBasis = {
      originalVoucherId,
      originalLineIds: stored.lines.map((line) => line.lineId),
      byOriginalLine: byLine,
    };

    return basis;
  });
}

function* basisFor(transaction: Transaction, scope: Scope, action: Action) {
  if (action.postingPurpose !== "reversal") return null;

  if (action.correctsVoucherId === null) return yield* failure("InvalidJournal");

  return yield* readReversalBasis(transaction, scope.bookId, action.correctsVoucherId);
}

function lineInputs(
  action: Action,
  catalogue: CapturedCatalogue,
  basis: ReversalBasis | null,
): ReadonlyArray<Dimensions.AssignmentLineInput> {
  const mode = basis === null ? "new_posting" : "exact_reversal";
  const policy = action.dimensionPolicy ?? [];
  const evidenceIds = action.evidenceRefs.map((reference) => reference.evidenceId);

  return action.lines.map((line, index) => ({
    lineId: line.lineId,
    postingDate: action.postingDate,
    mode,
    declared: line.originalDimensions ?? [],
    policy,
    dimensions: catalogue.dimensions,
    values: catalogue.values,
    original:
      basis === null ? [] : (basis.byOriginalLine.get(basis.originalLineIds[index] ?? "") ?? []),
    evidenceIds,
  }));
}

// Preparation. Each line's assignments are resolved against the catalogue as it
// stands on the posting date and the result is sealed with the plan, so approval
// covers exactly the assignment set execution will retain. A dimension
// effective at the posting date with no reviewed requirement refuses here rather
// than posting an unclassified line.
export function resolveAssignmentsInTransaction(
  transaction: Transaction,
  scope: Scope,
  action: Action,
) {
  return Effect.gen(function* () {
    const catalogue = yield* captureCatalogue(transaction, scope.bookId, action.postingDate);
    const basis = yield* basisFor(transaction, scope, action);
    const lines: Array<Line> = [];

    for (const [index, input] of lineInputs(action, catalogue, basis).entries()) {
      const resolved = Dimensions.resolveOriginalAssignments(input);

      if (Result.isFailure(resolved)) return yield* refuse(resolved.failure);

      const line = action.lines[index];

      if (line === undefined) return yield* failure("InternalError");

      lines.push({ ...line, originalDimensions: [...resolved.success] });
    }

    const assigned: Action = { ...action, lines };

    return assigned;
  });
}

// Execution. The caller already holds the book writer lock and has just written
// the journal lines. The sealed assignments are re-resolved and compared, so an
// archive, an effective-date change or a changed requirement between approval
// and execution refuses instead of re-classifying an approved posting, and the
// retained rows are appended here in the same transaction as the lines.
export function applyOriginalAssignmentsInTransaction(
  transaction: Transaction,
  scope: Scope,
  action: Action,
  voucherId: string,
) {
  return Effect.gen(function* () {
    const catalogue = yield* captureCatalogue(transaction, scope.bookId, action.postingDate);
    const basis = yield* basisFor(transaction, scope, action);
    const writes: Array<Catalogue.AssignmentWrite> = [];

    for (const [index, input] of lineInputs(action, catalogue, basis).entries()) {
      const checked = Dimensions.validateAssignmentsForEveryLine(input);

      if (Result.isFailure(checked)) return yield* refuse(checked.failure);

      const line = action.lines[index];

      if (line === undefined) return yield* failure("InternalError");

      for (const assignment of checked.success) {
        writes.push({
          bookId: scope.bookId,
          voucherId,
          lineId: line.lineId,
          dimensionCode: assignment.dimensionCode,
          dimensionRevision: assignment.dimensionRevision,
          status: assignment.status,
          valueCode: assignment.valueCode,
          valueRevision: assignment.valueRevision,
          capturedLabel: assignment.capturedLabel,
          exemptionEvidenceId: assignment.exemptionEvidenceId,
          sourceValueCode: assignment.sourceValueCode,
          inheritedFromVoucherId: basis?.originalVoucherId ?? null,
          inheritedFromLineId: basis === null ? null : (basis.originalLineIds[index] ?? null),
        });
      }
    }

    if (writes.length > 0) yield* Catalogue.insertOriginalAssignmentsBatch(transaction, writes);
  });
}

type AssignmentReportInput =
  typeof import("@open-erp/contracts/capabilities").Capabilities.dimensions_assignment_report.input.Type;

type LineAssignmentRow = RetainedAssignment & {
  readonly voucherId: string;
  readonly lineId: string;
};

function groupByLine(
  rows: ReadonlyArray<LineAssignmentRow>,
): ReadonlyMap<string, ReadonlyArray<Dimensions.OriginalDimensionAssignment>> {
  const grouped = new Map<string, Array<Dimensions.OriginalDimensionAssignment>>();

  for (const row of rows) {
    const key = `${row.voucherId}:${row.lineId}`;
    const existing = grouped.get(key) ?? [];

    existing.push(toAssignment(row));
    grouped.set(key, existing);
  }

  return grouped;
}

function partitionView(partition: Dimensions.DimensionPartition) {
  return {
    dimensionCode: partition.dimensionCode,
    unfiltered: partition.unfiltered,
    buckets: partition.buckets.map((bucket) => ({
      state: bucket.state,
      valueCode: bucket.valueCode,
      valueRevision: bucket.valueRevision,
      capturedLabel: bucket.capturedLabel,
      signedMinor: bucket.totals.signedMinor,
      contributionCount: bucket.totals.contributionCount,
    })),
  };
}

function stateView(state: Dimensions.AssignmentState) {
  return {
    state: state.state,
    dimensionCode: state.dimensionCode,
    valueCode: state.valueCode,
    valueRevision: state.valueRevision,
    capturedLabel: state.capturedLabel,
  };
}

// Which retained assignments a frozen object map declares, and how many rows
// carry each recorded state. Only an explicit value becomes an exported object;
// an explicitly unassigned line, an evidenced exemption and a source that
// recorded nothing each stay a counted state rather than becoming an object.
export function objectMapSource(retained: ReadonlyArray<RetainedAssignment>) {
  const used = new Map<string, Dimensions.UsedAssignment>();

  for (const row of retained) {
    if (row.status !== "explicit" || row.valueCode === null || row.valueRevision === null) continue;

    used.set(`${row.dimensionCode}:${row.valueCode}`, {
      dimensionCode: row.dimensionCode,
      dimensionRevision: row.dimensionRevision,
      valueCode: row.valueCode,
      valueRevision: row.valueRevision,
      capturedLabel: row.capturedLabel,
      sourceValueCode: row.sourceValueCode,
    });
  }

  return {
    used: [...used.values()],
    recordedStates: originalStatuses.map((status) => ({
      status,
      assignmentCount: retained.filter((row) => row.status === status).length,
    })),
  };
}

// A book-scoped read of the retained original assignments for one dated window.
// Every requested dimension partitions the same money independently, so two
// dimension systems over the same lines each total the same unfiltered amount
// and are never added together. The cross tab places each contribution in
// exactly one ordered tuple. No balancing contribution is invented to make a
// dimension filter look balanced, and a selection that would exceed the retained
// bound refuses instead of reporting a partition of partial money.
export const dimensionAssignmentReport = Effect.fn("dimensions.assignmentReport")(function* (
  token: string,
  command: AssignmentReportInput,
) {
  return yield* withBook(token, command.scope, false, function* (transaction) {
    const input = command.input;
    const limit = Catalogue.maximumAssignmentRows;

    if (input.from > input.to) return yield* failure("InvalidJournal");

    if (input.dimensionCodes.length === 0 || input.dimensionCodes.length > 64)
      return yield* failure("InvalidJournal");

    if (new Set(input.dimensionCodes).size !== input.dimensionCodes.length)
      return yield* failure("InvalidJournal");

    yield* requireTableAccess(transaction, Catalogue.assignmentTables, false);
    yield* lockBookForShare(transaction, command.scope);

    const contributions = yield* Catalogue.readAssignmentContributions(
      transaction,
      command.scope.bookId,
      input.from,
      input.to,
      limit,
    );

    if (contributions.length > limit) return yield* unsupported();

    const retained = yield* Catalogue.readOriginalAssignmentsInWindow(
      transaction,
      command.scope.bookId,
      input.from,
      input.to,
      limit,
    );

    if (retained.length > limit) return yield* unsupported();

    const assignments = groupByLine(retained);
    const codes = [...input.dimensionCodes].sort();
    const partitions = [];

    for (const dimensionCode of codes) {
      const partition = Dimensions.projectOneDimension(contributions, assignments, dimensionCode);

      if (Result.isFailure(partition)) return yield* refuse(partition.failure);

      partitions.push(partitionView(partition.success));
    }

    const crossTab = Dimensions.projectCrossTab(contributions, assignments, codes);

    if (Result.isFailure(crossTab)) return yield* refuse(crossTab.failure);

    const catalogue = yield* captureCatalogue(transaction, command.scope.bookId, input.to);

    const frozen = Dimensions.freezeObjectMap({
      dimensions: catalogue.dimensions,
      values: catalogue.values,
      ...objectMapSource(retained),
    });

    if (Result.isFailure(frozen)) return yield* refuse(frozen.failure);

    return yield* decode(
      AssignmentContracts.DimensionAssignmentReport,
      yield* toJsonObject({
        scope: command.scope,
        from: input.from,
        to: input.to,
        contributionCount: contributions.length,
        assignmentCount: retained.length,
        partitions,
        crossTab: {
          dimensionCodes: crossTab.success.dimensionCodes,
          unfiltered: crossTab.success.unfiltered,
          tuples: crossTab.success.tuples.map((tuple) => ({
            key: tuple.key.map(stateView),
            totals: tuple.totals,
          })),
        },
        objectMap: {
          dimensions: frozen.success.dimensions,
          objects: frozen.success.objects,
          usedAssignmentCount: frozen.success.usedAssignmentCount,
          recordedStates: frozen.success.recordedStates,
        },
      }),
    );
  });
});
