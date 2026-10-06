import * as Settlement from "@open-erp/contracts/payroll-settlements";
import * as Payroll from "@open-erp/contracts/payroll-calculations";
import * as Recovery from "@open-erp/domain/paid-payroll-recovery";
import { equalJson } from "@open-erp/domain/canonicalization";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Db from "../../db/payroll/settlements";
import type { Transaction } from "../../db/transaction";
import { decode, requireTableAccess, type Scope } from "../commerce/support";
import { failure } from "../failures";
import {
  InstructionRecord,
  AllocationRecord,
  seal,
  persist,
  claimBalance,
} from "./settlement-support";
import { type Principal } from "../commerce/support";
import { newId } from "../posting";

export const captureAdjustmentInstructions = Effect.fn("payroll.captureAdjustmentInstructions")(
  function* (
    tx: Transaction,
    scope: Scope,
    employeeId: string,
    month: string,
    ids: ReadonlyArray<string>,
    runId?: string,
  ) {
    yield* requireTableAccess(tx, Db.settlementTables, true);

    if (new Set(ids).size !== ids.length) return yield* failure("InvalidJournal");
    const ready = [];

    for (const row of yield* Db.readRecords(tx, scope.bookId, "payroll_adjustment_instructions")) {
      const retained = yield* decode(InstructionRecord, row.body);

      if (retained.employeeId !== employeeId || retained.month !== month) continue;

      if ((yield* Db.readInstructionConsumption(tx, scope.bookId, retained.id)).length) continue;

      if ((yield* Db.readInstructionCancellation(tx, scope.bookId, retained.id)).length) continue;

      if (retained.netRecovery) {
        const balance = yield* claimBalance(tx, scope, retained.netRecovery.claimId);

        if (
          retained.signedGrossDeltaMinor !== "0" ||
          balance.remaining !== retained.netRecovery.amountMinor ||
          balance.claim.recoveryReceivableAccountId !== retained.netRecovery.receivableAccountId
        )
          return yield* failure("StaleDependency");
      }

      const reserved = (yield* Db.readInstructionReservations(tx, scope.bookId, retained.id))[0];

      if (reserved && reserved.runId !== runId) return yield* failure("AlreadyPosted");
      ready.push(yield* decode(Settlement.AdjustmentSnapshot, row.body));
    }

    if (!equalJson(ready.map((row) => row.id).sort(), [...ids].sort()))
      return yield* failure("StaleDependency");

    return ready;
  },
);

export const appendAdjustmentInstructions = Effect.fn("payroll.appendAdjustmentInstructions")(
  function* (
    input: typeof Payroll.PreparePayRun.Type,
    instructions: ReadonlyArray<typeof Settlement.AdjustmentSnapshot.Type>,
  ) {
    if (instructions.length && input.recordClass !== "synthetic")
      return yield* failure("UnsupportedProfile");
    const adjustments = [...input.work.adjustments];
    const deductions = [...input.employment.deductionComponents];

    let available =
      BigInt(input.employment.monthlyCashSalary) +
      [...input.employment.grossAdjustments, ...input.work.adjustments].reduce(
        (sum, row) => sum + BigInt(row.minor),
        0n,
      );

    for (const row of [...instructions].sort((left, right) =>
      left.kind === right.kind
        ? left.id.localeCompare(right.id)
        : left.kind === "additional_compensation"
          ? -1
          : 1,
    )) {
      if (row.netRecovery) {
        if (
          row.signedGrossDeltaMinor !== "0" ||
          deductions.some((item) => item.componentId === row.id)
        )
          return yield* failure("InvalidJournal");

        deductions.push({
          componentId: row.id,
          minor: row.netRecovery.amountMinor,
          description: "Qualified recovery from net salary",
          destinationRole: "owner",
          reducesBenefit: null,
        });

        continue;
      }

      if (row.kind === "future_pay") {
        const result = Recovery.compileFuturePayAdjustment({
          adjustmentId: row.id,
          employeeId: row.employeeId,
          originalPayRefs: [row.paidEventId],
          lawfulOffsetBasis: row.executionId,
          supportedFutureEarningsMinor: available.toString(),
          grossDeltaMinor: (-BigInt(row.signedGrossDeltaMinor)).toString(),
        });

        if (Result.isFailure(result)) return yield* failure("UnsupportedProfile");
      }

      if (adjustments.some((item) => item.componentId === row.id) || row.id.length > 64)
        return yield* failure("InvalidJournal");
      adjustments.push({
        componentId: row.id,
        minor: row.signedGrossDeltaMinor,
        description: "Retained paid-payroll adjustment instruction",
        evidence: [row.evidence],
      });
      available += BigInt(row.signedGrossDeltaMinor);
    }

    return {
      ...input,
      employment: { ...input.employment, deductionComponents: deductions },
      work: { ...input.work, adjustments },
    };
  },
);

export const reserveAdjustmentInstructions = Effect.fn("payroll.reserveAdjustmentInstructions")(
  function* (
    tx: Transaction,
    scope: Scope,
    runId: string,
    approvalId: string,
    snapshots: ReadonlyArray<typeof Settlement.AdjustmentSnapshot.Type>,
  ) {
    for (const snapshot of snapshots) {
      if ((yield* Db.readInstructionCancellation(tx, scope.bookId, snapshot.id)).length)
        return yield* failure("StaleDependency");
      const existing = (yield* Db.readInstructionReservations(tx, scope.bookId, snapshot.id))[0];

      if (existing && (existing.runId !== runId || !equalJson(existing.snapshot, snapshot)))
        return yield* failure("AlreadyPosted");
      yield* Db.insertInstructionReservation(tx, scope.bookId, runId, approvalId, snapshot);
    }
  },
);

export const consumeAdjustmentInstructions = Effect.fn("payroll.consumeAdjustmentInstructions")(
  function* (
    tx: Transaction,
    scope: Scope,
    runId: string,
    snapshots: ReadonlyArray<typeof Settlement.AdjustmentSnapshot.Type>,
    principal: Principal,
  ) {
    for (const snapshot of snapshots) {
      if ((yield* Db.readInstructionCancellation(tx, scope.bookId, snapshot.id)).length)
        return yield* failure("StaleDependency");
      const existing = (yield* Db.readInstructionReservations(tx, scope.bookId, snapshot.id))[0];

      if (!existing || existing.runId !== runId || !equalJson(existing.snapshot, snapshot))
        return yield* failure("StaleDependency");
      yield* Db.insertInstructionConsumption(tx, scope.bookId, runId, snapshot);

      if (snapshot.netRecovery) {
        const balance = yield* claimBalance(tx, scope, snapshot.netRecovery.claimId);

        if (balance.remaining !== snapshot.netRecovery.amountMinor)
          return yield* failure("StaleDependency");

        const allocation = yield* seal(
          tx,
          scope,
          principal,
          "execute_payroll_run",
          runId,
          AllocationRecord,
          {
            id: newId("payroll_net_allocation"),
            claimId: snapshot.netRecovery.claimId,
            executionId: snapshot.executionId,
            payrollRunId: runId,
            amountMinor: snapshot.netRecovery.amountMinor,
          },
        );

        yield* persist(tx, "payroll_recovery_allocations", allocation);
      }
    }
  },
);
