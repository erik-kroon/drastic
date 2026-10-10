import * as Settlement from "@open-erp/contracts/payroll-settlements";
import * as Effect from "effect/Effect";
import * as Db from "../../db/payroll/settlements";
import * as RunDb from "../../db/payroll/runs";
import type { Transaction } from "../../db/transaction";
import { type Scope } from "../commerce/support";
import { failure } from "../failures";
import { digest } from "../posting";
import { checkedRun } from "./runs";
import { verifyRunLedger } from "./settlement-ledger";
import { capturePaymentReportingBasis } from "./settlement-payment-basis";

export const compileNoncashPayment = Effect.fn("payroll.compileNoncashPayment")(function* (
  tx: Transaction,
  scope: Scope,
  input: Extract<typeof Settlement.PrepareSettlement.Type, { kind: "noncash_payment" }>,
) {
  const run = yield* checkedRun(tx, scope, input.runId);

  if ((yield* RunDb.readExecution(tx, scope.bookId, run.id)).length !== 1)
    return yield* failure("ApprovalRequired");

  if ((yield* Db.readPaidEmployee(tx, scope.bookId, run.id, input.employeeId)).length)
    return yield* failure("AlreadyPosted");
  const employee = run.employees.find((row) => row.calculation.employeeId === input.employeeId);
  const obligation = run.employeeObligations.find((row) => row.employeeId === input.employeeId);

  if (!employee || !obligation) return yield* failure("NotFound");

  const offsets = (employee.calculation.basis.adjustmentInstructions ?? []).filter(
    (row) => row.netRecovery !== undefined,
  );

  if (
    obligation.payableMinor !== "0" ||
    employee.calculation.calculation.payableMinor !== "0" ||
    offsets.length === 0
  )
    return yield* failure("UnsupportedProfile");
  const consumptions = [];

  for (const offset of offsets) {
    const consumption = (yield* Db.readInstructionConsumption(tx, scope.bookId, offset.id))[0];

    if (consumption?.runId !== run.id) return yield* failure("StaleDependency");
    consumptions.push({ instruction: offset, runId: consumption.runId });
  }

  yield* verifyRunLedger(tx, scope, run);
  const reporting = yield* capturePaymentReportingBasis(tx, scope, employee, input.postingDate);

  return {
    reportingReplacement: null,
    originalRun: run,
    paidEvent: null,
    comparison: null,
    lawfulBasis: null,
    claim: null,
    cash: null,
    economicKey: `payment:${run.id}:${input.employeeId}`,
    capacityDigest: yield* digest({ run: run.digest, consumptions, reporting }),
    outputs: {
      reportingReadiness: reporting.readiness,
      amountMinor: "0",
      remainingReceivableMinor: "0",
      signedGrossDeltaMinor: "0",
      contributionCorrectionMinor: "0",
    },
    lines: [],
  };
});
