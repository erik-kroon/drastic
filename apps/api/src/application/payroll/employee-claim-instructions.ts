import * as Claims from "@open-erp/contracts/employee-claims";
import * as Payroll from "@open-erp/contracts/payroll-calculations";
import * as Effect from "effect/Effect";
import { equalJson } from "@open-erp/domain/canonicalization";
import * as Db from "../../db/payroll/employee-claims";
import * as InputDb from "../../db/payroll/inputs";
import type { Transaction } from "../../db/transaction";
import { decode, toJsonObject, type Scope } from "../commerce/support";
import { failure } from "../failures";
import { checkedInstruction, employeeRevision } from "./employee-claim-basis";

export const captureClaimInstructions = Effect.fn("claims.capturePayrollInstructions")(function* (
  tx: Transaction,
  scope: Scope,
  employeeId: string,
  month: string,
  ids: ReadonlyArray<string>,
  runId?: string,
) {
  if (new Set(ids).size !== ids.length || ids.length > 100) return yield* failure("InvalidJournal");

  for (const row of yield* Db.expiredReservations(tx, scope.bookId))
    yield* InputDb.insertReservationRelease(tx, scope.bookId, row.approvalId, row.runId);
  const snapshots = [];

  for (const id of [...ids].sort()) {
    const instruction = yield* checkedInstruction(tx, scope, id);

    if (
      instruction.kind !== "payroll" ||
      instruction.employeeId !== employeeId ||
      instruction.month !== month
    )
      return yield* failure("UnsupportedProfile");

    if (
      (yield* employeeRevision(tx, scope, employeeId, month)).id !== instruction.employeeRevisionId
    )
      return yield* failure("StaleDependency");

    if ((yield* Db.readConsumption(tx, scope.bookId, id)).length)
      return yield* failure("AlreadyPosted");
    const reservation = (yield* Db.readReservation(tx, scope.bookId, id))[0];

    if (reservation && reservation.runId !== runId) return yield* failure("AlreadyPosted");
    snapshots.push(
      yield* decode(
        Claims.ClaimPayrollSnapshot,
        yield* toJsonObject({
          instructionId: id,
          instructionDigest: instruction.digest,
          claimId: instruction.claimId,
          recognitionId: instruction.recognitionId,
          parentInputId: instruction.parentInputId,
          parentExecutionId: instruction.parentExecutionId,
          employeeId,
          month,
          amountMinor: instruction.amountMinor,
          liabilityAccountId: instruction.liabilityAccountId,
          evidence: instruction.evidence,
        }),
      ),
    );
  }

  return snapshots;
});

export const appendClaimInstructions = Effect.fn("claims.appendPayrollInstructions")(function* (
  input: typeof Payroll.PreparePayRun.Type,
  snapshots: ReadonlyArray<typeof Claims.ClaimPayrollSnapshot.Type>,
) {
  if (snapshots.length && input.recordClass !== "synthetic")
    return yield* failure("UnsupportedProfile");
  const reimbursements = [...input.work.reimbursements];

  const ids = [
    ...input.employment.grossAdjustments,
    ...input.work.adjustments,
    ...input.employment.reimbursements,
    ...reimbursements,
  ].map((row) => row.componentId);

  for (const row of snapshots) {
    if (ids.includes(row.instructionId)) return yield* failure("InvalidJournal");
    reimbursements.push({
      componentId: row.instructionId,
      minor: row.amountMinor,
      description: "Approved fixed employee claim payroll instruction",
      evidence: row.evidence,
      treatment: "non_taxable_reimbursement",
    });
  }

  return { ...input, work: { ...input.work, reimbursements } };
});

export const reserveClaimInstructions = Effect.fn("claims.reservePayrollInstructions")(function* (
  tx: Transaction,
  scope: Scope,
  runId: string,
  approvalId: string,
  snapshots: ReadonlyArray<typeof Claims.ClaimPayrollSnapshot.Type>,
) {
  for (const snapshot of snapshots) {
    const current = yield* captureClaimInstructions(
      tx,
      scope,
      snapshot.employeeId,
      snapshot.month,
      [snapshot.instructionId],
      runId,
    );

    if (!equalJson(current[0], snapshot)) return yield* failure("StaleDependency");
    yield* Db.reserve(tx, scope.bookId, runId, approvalId, snapshot);
  }
});

export const consumeClaimInstructions = Effect.fn("claims.consumePayrollInstructions")(function* (
  tx: Transaction,
  scope: Scope,
  runId: string,
  snapshots: ReadonlyArray<typeof Claims.ClaimPayrollSnapshot.Type>,
) {
  for (const snapshot of snapshots) {
    const current = yield* captureClaimInstructions(
      tx,
      scope,
      snapshot.employeeId,
      snapshot.month,
      [snapshot.instructionId],
      runId,
    );

    const reservation = (yield* Db.readReservation(tx, scope.bookId, snapshot.instructionId))[0];

    if (
      !equalJson(current[0], snapshot) ||
      !reservation ||
      reservation.runId !== runId ||
      !equalJson(reservation.snapshot, snapshot)
    )
      return yield* failure("StaleDependency");
    yield* Db.consume(tx, scope.bookId, runId, snapshot);
  }
});
