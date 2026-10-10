import * as Effect from "effect/Effect";
import * as O from "@open-erp/contracts/onboarding";
import { renderOnboardingReceipt } from "../../adapters/pdf/onboarding-receipt";
import * as Db from "../../db/onboarding-lifecycle";
import { databaseFailure } from "../../db/transaction";
import { withAdmittedPrincipal } from "../identity";
import { decode, type Scope } from "../commerce/support";
import { failure } from "../failures";

export const getOnboardingActivationArtifact = Effect.fn("onboarding.receipt.artifact")(function* (
  token: string,
  command: { scope: Scope },
) {
  const receipt = yield* withAdmittedPrincipal(
    { token },
    command.scope,
    { operatorOnly: false },
    (tx) =>
      Effect.gen(function* () {
        const rows = yield* Db.readRecords(tx, "activations", command.scope.bookId).pipe(
          Effect.mapError(databaseFailure),
        );

        const row = rows[0];

        if (!row) return yield* failure("NotFound");

        return yield* decode(O.OnboardingActivationReceipt, row.body);
      }),
  );

  return yield* Effect.tryPromise({
    try: () => renderOnboardingReceipt(receipt),
    catch: () => failure("UnsupportedProfile"),
  });
});
