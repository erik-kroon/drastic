import * as Accounting from "@open-erp/contracts/accounting";

import * as Effect from "effect/Effect";

import { failure } from "./failures";
import * as Db from "../db/posting";
import { type Transaction } from "../db/transaction";

export type Scope = typeof Accounting.Scope.Type;

export function readExecutionApprovalInTransaction(
  transaction: Transaction,
  scope: Scope,
  plan: { readonly id: string; readonly planDigest: string },
  approvalId: string,
) {
  return executionApproval(transaction, scope, plan, approvalId);
}

export function executionApproval(
  transaction: Transaction,
  scope: Scope,
  plan: { readonly id: string; readonly planDigest: string },
  approvalId: string,
) {
  return Effect.gen(function* () {
    const approvalRows = yield* Db.readApproval(transaction, scope.bookId, approvalId, "update");
    const approval = approvalRows[0];

    if (
      !approval ||
      approval.changeSetId !== plan.id ||
      approval.digest !== plan.planDigest ||
      approval.consumedAt !== null
    ) {
      return yield* failure("ApprovalRequired");
    }

    if (
      (yield* Db.readOperatorMembership(transaction, scope.bookId, approval.actorId)).length === 0
    ) {
      return yield* failure("ApprovalRequired");
    }

    const admission = yield* Db.readActorAdmission(transaction, approval.actorId);

    if (admission[0]?.enabled === false) return yield* failure("ApprovalRequired");

    if ((yield* Db.readApprovalRevocation(transaction, scope.bookId, approval.id)).length > 0) {
      return yield* failure("ApprovalRequired");
    }

    const now = yield* Db.readDatabaseTime(transaction);

    if (Date.parse(approval.expiresAt) <= Date.parse(now.now)) {
      return yield* failure("ApprovalRequired");
    }

    return approval;
  });
}
