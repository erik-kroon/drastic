import * as Accounting from "@open-erp/contracts/accounting";
import * as Runs from "@open-erp/contracts/payroll-runs";
import * as Settlement from "@open-erp/contracts/payroll-settlements";
import { equalJson } from "@open-erp/domain/canonicalization";
import * as Effect from "effect/Effect";
import * as Db from "../../db/payroll/settlements";
import * as RunDb from "../../db/payroll/runs";
import type { Transaction } from "../../db/transaction";
import { decode, type Scope } from "../commerce/support";
import { failure } from "../failures";
import { readRetained, type ClaimRecord } from "./settlement-support";

export const verifyVoucher = Effect.fn("payroll.verifyRetainedVoucher")(function* (
  tx: Transaction,
  scope: Scope,
  plan: typeof Accounting.ChangeSet.Type,
  voucherId: string,
) {
  const expected = plan.groups
    .flatMap((group) => group.actions.flatMap((action) => action.lines))
    .map((line) => ({
      lineId: line.lineId,
      accountId: line.accountId,
      debitMinor: line.debitMinor,
      creditMinor: line.creditMinor,
    }))
    .sort((left, right) => left.lineId.localeCompare(right.lineId));

  const actual = yield* Db.readVoucherLines(tx, scope.bookId, voucherId);

  if (!equalJson(actual, expected)) return yield* failure("InvalidJournal");
});

export const verifyRunLedger = Effect.fn("payroll.verifyRunLedger")(function* (
  tx: Transaction,
  scope: Scope,
  run: typeof Runs.PayrollRun.Type,
) {
  const row = (yield* RunDb.readExecution(tx, scope.bookId, run.id))[0];

  if (!row) return yield* failure("ApprovalRequired");
  const execution = yield* decode(Runs.PayrollRunExecution, row.body);
  yield* verifyVoucher(tx, scope, run.postingPlan, execution.postingReceipt.voucherId);
});

export const verifyRecoveryLedger = Effect.fn("payroll.verifyRecoveryLedger")(function* (
  tx: Transaction,
  scope: Scope,
  claims: ReadonlyArray<typeof ClaimRecord.Type>,
) {
  for (const claim of claims) {
    const execution = yield* readRetained(
      tx,
      scope,
      "payroll_settlement_executions",
      claim.executionId,
      Settlement.SettlementExecution,
    );

    const review = yield* readRetained(
      tx,
      scope,
      "payroll_settlement_reviews",
      execution.reviewId,
      Settlement.SettlementReview,
    );

    if (
      !review.postingPlan ||
      !execution.postingReceipt ||
      execution.recoveryClaim?.id !== claim.id
    )
      return yield* failure("InvalidJournal");
    yield* verifyVoucher(tx, scope, review.postingPlan, execution.postingReceipt.voucherId);
  }
});
