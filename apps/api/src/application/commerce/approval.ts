import { readApprovalExpiry } from "../../db/commerce/access";
import * as Effect from "effect/Effect";
import type { Transaction } from "../../db/transaction";
import { failure } from "../failures";

export function approvalExpiry(transaction: Transaction) {
  return readApprovalExpiry(transaction).pipe(
    Effect.flatMap((rows) => {
      const expiry = rows[0]?.instant;

      return expiry === undefined ? failure("InternalError") : Effect.succeed(expiry);
    }),
  );
}
