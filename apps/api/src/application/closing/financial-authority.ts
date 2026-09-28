import * as Effect from "effect/Effect";
import { withAdmittedPrincipal, type VerifiedPrincipal } from "../identity";
import { databaseFailure, type Transaction } from "../../db/transaction";
import * as Db from "../../db/closing/financial-close";
import * as Ledger from "../../db/posting";
import type { Scope } from "../commerce/support";

// Lock the referenced reviewer before the book. Check authority after replay:
// revoked historical approvals must not erase committed receipts.
export function withFinancialApproval<Eff extends Effect.Effect<unknown, unknown, unknown>, A>(
  token: string,
  scope: Scope,
  proposalId: string,
  approvalId: string,
  operation: (tx: Transaction, principal: VerifiedPrincipal) => Generator<Eff, A, never>,
) {
  return withAdmittedPrincipal(
    { token },
    scope,
    {
      operatorOnly: true,
      beforeBook: (tx) =>
        Effect.gen(function* () {
          const approval = (yield* Db.readFinancialReviewer(
            tx,
            scope.bookId,
            proposalId,
            approvalId,
          ))[0];

          if (approval) {
            yield* Ledger.readActorAdmission(tx, approval.actorId);
            yield* Ledger.readOperatorMembership(tx, scope.bookId, approval.actorId);
          }
        }).pipe(Effect.mapError(databaseFailure)),
    },
    (tx, principal) =>
      Effect.gen(() => operation(tx, principal)).pipe(Effect.mapError(databaseFailure)),
    "update",
  );
}

export const reviewerIsCurrent = Effect.fn("closing.reviewerIsCurrent")(function* (
  tx: Transaction,
  bookId: string,
  actorId: string,
) {
  const admission = yield* Ledger.readActorAdmission(tx, actorId);
  const membership = yield* Ledger.readOperatorMembership(tx, bookId, actorId);

  return admission[0]?.enabled !== false && membership.length === 1;
});
