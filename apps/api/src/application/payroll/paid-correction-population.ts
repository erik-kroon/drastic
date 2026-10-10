import * as Effect from "effect/Effect";
import * as Settlement from "@open-erp/contracts/payroll-settlements";
import * as Mileage from "@open-erp/contracts/mileage-corrections";
import * as Db from "../../db/payroll/mileage-corrections";
import type { Transaction } from "../../db/transaction";
import { decode, type Scope } from "../commerce/support";
import { failure } from "../failures";
import { digest } from "../json";
import {
  ClaimRecord,
  InstructionRecord,
  ReportingCorrection,
  readRetained,
} from "./settlement-support";
import { readMileageRecord } from "./mileage-correction-records";

export const correctionPopulation = Effect.fn("payroll.correctionPopulation")(function* (
  tx: Transaction,
  scope: Scope,
  paid: typeof Settlement.PaidPayrollEvent.Type,
) {
  const claimRows = yield* Db.paidClaims(tx, scope.bookId, paid.id);
  const instructionRows = yield* Db.paidInstructions(tx, scope.bookId, paid.id);
  const correctionRows = yield* Db.paidCorrections(tx, scope.bookId, paid.id);

  if ([claimRows, instructionRows, correctionRows].some((rows) => rows.length > 100))
    return yield* failure("UnsupportedProfile");

  const claims = [];
  const instructions = [];
  const corrections = [];

  for (const row of claimRows) claims.push(yield* decode(ClaimRecord, row.body));

  for (const row of instructionRows) instructions.push(yield* decode(InstructionRecord, row.body));

  for (const row of correctionRows) corrections.push(yield* decode(ReportingCorrection, row.body));

  const mileageCorrections: NonNullable<
    typeof Settlement.CorrectionComparison.Type.mileageCorrections
  >[number][] = [];

  const visited = new Set<string>();

  const history: {
    readonly recordedAt: string;
    readonly comparison: typeof Settlement.CorrectionComparison.Type;
  }[] = [];

  for (const claim of claims) {
    const execution = yield* readRetained(
      tx,
      scope,
      "payroll_settlement_executions",
      claim.executionId,
      Settlement.SettlementExecution,
    );

    const comparison = yield* readRetained(
      tx,
      scope,
      "payroll_correction_comparisons",
      claim.comparisonId,
      Settlement.CorrectionComparison,
    );

    history.push({ recordedAt: execution.createdAt, comparison });

    if (!claim.mileageSource || visited.has(claim.mileageSource.originalInputId)) continue;

    const edges = yield* Db.successors(tx, scope.bookId, claim.mileageSource.originalInputId);

    if (edges.length > 100) return yield* failure("UnsupportedProfile");

    const predecessors = new Set(edges.map((row) => row.previousExecutionId));
    const tips = edges.filter((row) => !predecessors.has(row.executionId));

    if (tips.length !== 1) return yield* failure("StaleDependency");

    const tip = tips[0];

    if (!tip) return yield* failure("StaleDependency");

    const proposal = yield* readMileageRecord(
      tx,
      scope,
      "payroll_mileage_correction_proposals",
      tip.proposalId,
      Mileage.MileageCorrectionProposal,
    );

    if (!proposal.comparison) return yield* failure("StaleDependency");

    visited.add(claim.mileageSource.originalInputId);
    mileageCorrections.push({
      originalInputId: proposal.input.originalInputId,
      originalInputDigest: proposal.input.originalInputDigest,
      split: proposal.comparison.revisedSplit,
    });
  }

  mileageCorrections.sort((left, right) =>
    left.originalInputId.localeCompare(right.originalInputId),
  );

  history.sort((left, right) => right.recordedAt.localeCompare(left.recordedAt));

  if (history.length > 1 && history[0]?.recordedAt === history[1]?.recordedAt)
    return yield* failure("StaleDependency");

  const latest = history[0];

  return {
    claims,
    instructions,
    corrections,
    mileageCorrections,
    latestComparison: latest?.comparison ?? null,
    digest: yield* digest({ paid: paid.digest, claims, instructions, corrections }),
  };
});

export function correctedMileageSnapshots(
  paid: typeof Settlement.PaidPayrollEvent.Type,
  corrections: NonNullable<typeof Settlement.CorrectionComparison.Type.mileageCorrections>,
) {
  return (paid.originalEmployee.calculation.basis.payrollInputs ?? []).map((snapshot) => {
    const correction = corrections.find((row) => row.originalInputId === snapshot.inputId);

    return correction
      ? {
          ...snapshot,
          reimbursementMinor: correction.split.exemptPaidPartMinor,
          grossMinor: correction.split.taxablePartMinor,
          grossRecognizedMinor: correction.split.taxablePartMinor,
        }
      : snapshot;
  });
}
