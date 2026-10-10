import * as Effect from "effect/Effect";
import * as O from "@open-erp/contracts/onboarding";
import * as C from "@open-erp/contracts/subledger-controls";
import * as S from "@open-erp/contracts/subledgers";
import * as Cases from "../../db/onboarding";
import * as Lifecycle from "../../db/onboarding-lifecycle";
import * as Projection from "../../db/onboarding-projection";
import type { Transaction } from "../../db/transaction";
import { databaseFailure } from "../../db/transaction";
import { decode, type Scope } from "../commerce/support";
import { basisMatchesRevision } from "../subledger/schedule-basis";
import { rejectedOnboardingControls } from "./control-rejection";

export const readAssetHandoffCount = Effect.fn("onboarding.assetHandoffCount")(function* (
  tx: Transaction,
  scope: Scope,
) {
  const current = (yield* Cases.readCurrent(tx, scope.bookId).pipe(
    Effect.mapError(databaseFailure),
  ))[0];

  if (!current) return null;
  const onboarding = yield* decode(O.OnboardingCase, current.body);

  const controls = yield* Effect.forEach(
    yield* Lifecycle.readRecords(tx, "controls", scope.bookId).pipe(
      Effect.mapError(databaseFailure),
    ),
    (row) => decode(O.OnboardingControl, row.body),
  );

  const control = controls
    .filter(
      (item) =>
        item.kind === "historical_asset_register" &&
        item.asOf === onboarding.configuration.dates.historyEndsOn,
    )
    .sort((a, b) => b.qualifiedAt.localeCompare(a.qualifiedAt) || b.id.localeCompare(a.id))[0];

  if (!control?.assetRegister) return null;
  const rejected = yield* rejectedOnboardingControls(tx, scope);

  if (rejected.has(control.id) || rejected.has(control.assetRegister.trialBalanceControlId))
    return null;

  const bases = yield* Effect.forEach(
    yield* Projection.readAssetHandoffBases(tx, scope.bookId).pipe(
      Effect.mapError(databaseFailure),
    ),
    (row) =>
      Effect.gen(function* () {
        return {
          basis: yield* decode(C.SubledgerBasis, row.basis),
          revision: yield* decode(S.ScheduleRevision, row.revision),
        };
      }),
  );

  for (const item of control.assetRegister.rows) {
    const matches = bases.filter(
      ({ basis, revision }) =>
        basis.input.sourceLocator ===
          `onboarding_asset:${control.sourceSha256}:${item.sourceIdentity}` &&
        basis.reviewSha256 === control.sourceSha256.replace(/^sha256:/, "") &&
        basis.input.originalCostMinor === item.costMinor &&
        basis.input.accumulatedMinor === item.accumulatedDepreciationMinor &&
        basis.input.carryingMinor === item.carryingMinor &&
        revision.terms.kind === "asset" &&
        revision.terms.creditAccountId === item.accountId &&
        revision.terms.costMinor === item.carryingMinor,
    );

    const match = matches[0];

    if (
      matches.length !== 1 ||
      !match ||
      !(yield* basisMatchesRevision(match.basis, match.revision))
    )
      return null;
  }

  return control.assetRegister.rows.length;
});
