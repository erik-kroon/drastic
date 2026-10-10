import * as Inputs from "@open-erp/contracts/payroll-inputs";

import * as Effect from "effect/Effect";
import * as Db from "../../db/payroll/inputs";

import type { Transaction } from "../../db/transaction";

import { decode, requireRetainedEvidence, type Scope } from "../commerce/support";
import { failure } from "../failures";

import { digest } from "../json";

export const checkedInput = Effect.fn("payroll.checkedInput")(function* (
  tx: Transaction,
  scope: Scope,
  id: string,
  expectedDigest?: string,
) {
  const row = (yield* Db.readInput(tx, scope.bookId, id))[0];

  if (!row) return yield* failure("NotFound");
  const submitted = yield* decode(Inputs.PayrollInput, row.body);
  const body = Object.fromEntries(Object.entries(row.body).filter(([field]) => field !== "digest"));

  if (
    submitted.scope.entityId !== scope.entityId ||
    submitted.scope.bookId !== scope.bookId ||
    submitted.id !== id ||
    (expectedDigest !== undefined && submitted.digest !== expectedDigest) ||
    (yield* digest(body)) !== submitted.digest
  )
    return yield* failure("StaleDependency");
  yield* requireRetainedEvidence(tx, scope.bookId, submitted.input.evidence);

  return submitted;
});
