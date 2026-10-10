import * as Recovery from "@open-erp/contracts/paid-payroll-recovery";
import * as Accounting from "@open-erp/contracts/accounting";
import { equalJson } from "@open-erp/domain/canonicalization";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Db from "../../db/payroll/paid-recovery";
import type { Transaction } from "../../db/transaction";
import { decode, requireTableAccess, toJsonObject, type Scope } from "../commerce/support";
import { failure } from "../failures";
import { digest } from "../posting";
import { recordMetadata, requireSettlementAccess } from "./settlement-support";

export const LegRecord = Schema.Struct({
  ...Recovery.PaidRecoveryLeg.fields,
  assessmentId: Accounting.Identifier,
  draftId: Accounting.Identifier,
  ...recordMetadata,
});

export const ClaimReviewLink = Schema.Struct({
  id: Accounting.Identifier,
  assessmentId: Accounting.Identifier,
  qualificationId: Accounting.Identifier,
  reviewId: Accounting.Identifier,
  ...recordMetadata,
});

export const requirePaidRecoveryAccess = Effect.fn("payroll.paidRecoveryAccess")(function* (
  tx: Transaction,
  scope: Scope,
  actorId: string,
  write: boolean,
) {
  yield* requireSettlementAccess(tx, scope, actorId, write);
  yield* requireTableAccess(tx, Db.paidRecoveryTables, write);
});

export function readPaidRecoveryRecord<A>(
  tx: Transaction,
  scope: Scope,
  table: Db.RecordTable,
  id: string,
  schema: Schema.Decoder<A>,
) {
  return Effect.gen(function* () {
    const row = (yield* Db.record(tx, scope.bookId, table, id))[0];

    if (!row) return yield* failure("NotFound");

    const payload = Object.fromEntries(
      Object.entries(row.body).filter(([name]) => name !== "digest"),
    );

    if (
      row.body.id !== id ||
      !equalJson(row.body.scope, scope) ||
      (yield* digest(payload)) !== row.body.digest
    )
      return yield* failure("StaleDependency");

    return yield* decode(schema, row.body);
  });
}

export function persistPaidRecoveryRecord(
  tx: Transaction,
  table: Db.RecordTable,
  record: { readonly id: string; readonly digest: string; readonly scope: Scope },
) {
  return Effect.flatMap(toJsonObject(record), (body) => Db.insert(tx, table, record, body));
}

export const requirePaidRecoveryClaimCurrent = Effect.fn("payroll.paidRecoveryClaimCurrent")(
  function* (tx: Transaction, scope: Scope, reviewId: string) {
    const row = (yield* Db.claimReviewLink(tx, scope.bookId, reviewId))[0];

    if (!row) return false;
    const link = yield* decode(ClaimReviewLink, row.body);
    yield* readPaidRecoveryRecord(
      tx,
      scope,
      "payroll_paid_recovery_claim_reviews",
      link.id,
      ClaimReviewLink,
    );

    if (
      (yield* Db.related(
        tx,
        scope.bookId,
        "payroll_paid_recovery_cancellations",
        link.assessmentId,
      )).length
    )
      return yield* failure("AlreadyPosted");

    return true;
  },
);
