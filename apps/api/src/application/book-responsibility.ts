import * as Effect from "effect/Effect";
import * as O from "@open-erp/contracts/onboarding";
import * as Db from "../db/onboarding-lifecycle";
import type { Transaction } from "../db/transaction";
import { decode, type Scope } from "./commerce/support";
import { failure } from "./failures";

export function readBookResponsibility(tx: Transaction, scope: Scope) {
  return Effect.gen(function* () {
    const current = (yield* Db.readLatestResponsibility(tx, scope.bookId))[0];

    return current === undefined
      ? undefined
      : yield* decode(O.OnboardingResponsibilities, current.body);
  });
}

export function requireBookResponsibility(
  tx: Transaction,
  scope: Scope,
  actorId: string,
  role: "preparerId" | "bookkeepingApproverId" | "paymentApproverId" | "vatResponsibleId",
) {
  return Effect.gen(function* () {
    const current = yield* readBookResponsibility(tx, scope);

    if (current !== undefined && current.assignments[role] !== actorId)
      return yield* failure("Forbidden");

    return current;
  });
}
