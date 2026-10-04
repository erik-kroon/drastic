import * as Effect from "effect/Effect";
import * as O from "@open-erp/contracts/onboarding";
import * as Db from "../db/onboarding-lifecycle";
import type { Transaction } from "../db/transaction";
import { decode, type Scope } from "./commerce/support";

export const rejectedOnboardingControls = Effect.fn("onboarding.rejectedControls")(function* (
  tx: Transaction,
  scope: Scope,
) {
  const snapshots = yield* Effect.forEach(
    yield* Db.readRecords(tx, "snapshots", scope.bookId),
    (row) => decode(O.OnboardingSnapshot, row.body),
  );

  const decisions = yield* Effect.forEach(
    yield* Db.readRecords(tx, "decisions", scope.bookId),
    (row) => decode(O.OnboardingDecision, row.body),
  );

  return new Set(
    snapshots
      .filter((snapshot) =>
        decisions.some(
          (decision) => decision.snapshotId === snapshot.id && decision.decision.kind === "reject",
        ),
      )
      .flatMap((snapshot) => snapshot.controlIds),
  );
});
