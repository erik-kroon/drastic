import * as Effect from "effect/Effect";
import * as O from "@open-erp/contracts/onboarding";
import * as Db from "../db/onboarding-lifecycle";
import type { Transaction } from "../db/transaction";
import { decode, type Scope } from "./commerce/support";
import { failure } from "./failures";

export function requireOnboardingResponsibility(
  tx: Transaction,
  scope: Scope,
  actorId: string,
  role: "preparerId" | "bookkeepingApproverId" | "paymentApproverId" | "vatResponsibleId",
) {
  return Effect.gen(function* () {
    const policies = yield* Effect.forEach(
      yield* Db.readRecords(tx, "responsibilities", scope.bookId),
      (row) => decode(O.OnboardingResponsibilities, row.body),
    );

    const current = policies.sort((a, b) => b.revision - a.revision)[0];

    if (current !== undefined && current.assignments[role] !== actorId)
      return yield* failure("Forbidden");
  });
}
