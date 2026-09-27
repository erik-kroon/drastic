import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { readChild } from "../db/period-work";
import type { Transaction } from "../db/transaction";
import { failure } from "./failures";

// Supplied only by the batch orchestrator, never by a transport payload. The
// owning financial transaction checks it while holding the same book barrier
// as cancellation, closing the gap between dispatch and posting.
export class PeriodWorkExecutionFence extends Context.Service<
  PeriodWorkExecutionFence,
  {
    readonly bookId: string;
    readonly workIdentity: string;
    readonly batchId: string;
    readonly planId: string;
    readonly revision: string;
    readonly cancelVersion: string;
  }
>()("open-erp/PeriodWorkExecutionFence") {}

export const assertPeriodWorkFence = Effect.fn("periodWork.executionFence")(function* (
  transaction: Transaction,
  bookId: string,
  planId: string,
) {
  const context = yield* Effect.serviceOption(PeriodWorkExecutionFence);

  if (Option.isNone(context)) return;

  const expected = context.value;

  if (expected.bookId !== bookId || expected.planId !== planId)
    return yield* failure("StaleDependency");

  const child = (yield* readChild(transaction, bookId, expected.workIdentity))[0];

  if (
    !child ||
    child.state !== "prepared" ||
    child.batchId !== expected.batchId ||
    child.planId !== planId ||
    child.revision !== expected.revision ||
    child.cancelVersion !== expected.cancelVersion
  ) {
    return yield* failure("StaleDependency");
  }
});
