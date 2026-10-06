import * as Effect from "effect/Effect";
import * as Settlement from "@open-erp/contracts/payroll-settlements";
import { equalJson } from "@open-erp/domain/canonicalization";
import type { Transaction } from "../../db/transaction";
import type { Scope } from "../commerce/support";
import { failure } from "../failures";
import { readRetained } from "./settlement-support";
import { captureCalculationBasis } from "./calculations";
import { correctionPopulation, correctedMileageSnapshots } from "./paid-correction-population";

export const validateComparison = Effect.fn("payroll.validatePaidComparison")(function* (
  tx: Transaction,
  scope: Scope,
  id: string,
) {
  const comparison = yield* readRetained(
    tx,
    scope,
    "payroll_correction_comparisons",
    id,
    Settlement.CorrectionComparison,
  );

  const paid = yield* readRetained(
    tx,
    scope,
    "payroll_paid_events",
    comparison.paidEventId,
    Settlement.PaidPayrollEvent,
  );

  if (paid.digest !== comparison.originalPaidDigest) return yield* failure("StaleDependency");

  const population = yield* correctionPopulation(tx, scope, paid);

  if (
    (comparison.correctionPopulationDigest !== undefined &&
      comparison.correctionPopulationDigest !== population.digest) ||
    (comparison.correctionPopulationDigest === undefined &&
      population.mileageCorrections.length > 0)
  )
    return yield* failure("StaleDependency");

  const captured = yield* captureCalculationBasis(tx, scope, comparison.input, {
    kind: "paid_comparison",
    originalBasis: paid.originalEmployee.calculation.basis,
    mileageInputs: correctedMileageSnapshots(
      paid,
      comparison.mileageCorrections ?? population.mileageCorrections,
    ),
  });

  if (
    !equalJson(captured.basis, comparison.basis) ||
    !equalJson(captured.calculated, comparison.calculation)
  )
    return yield* failure("StaleDependency");

  return { comparison, paid };
});
