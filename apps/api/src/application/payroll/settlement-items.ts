import type * as Settlement from "@open-erp/contracts/payroll-settlements";
import type * as Domain from "@open-erp/domain/payroll-runs";
import * as Effect from "effect/Effect";
import { failure } from "../failures";
import type { ClaimRecord } from "./settlement-support";

export const paidItemPopulation = Effect.fn("payroll.paidItemPopulation")(function* (
  employerId: string,
  paidEvents: ReadonlyArray<typeof Settlement.PaidPayrollEvent.Type>,
  claims: ReadonlyArray<typeof ClaimRecord.Type>,
) {
  const grouped = new Map<string, typeof Domain.AgiItemInput.Type>();
  let adjustment = 0n;

  for (const paid of paidEvents) {
    const recovered = claims
      .filter((claim) => claim.paidEventId === paid.id)
      .reduce((sum, claim) => sum + BigInt(claim.claimedGrossMinor), 0n);

    const gross = BigInt(paid.grossCashMinor) - recovered;
    const contribution = BigInt(paid.contributionBaseMinor) - recovered;

    if (gross < 0n || contribution < 0n) return yield* failure("StaleDependency");
    adjustment -= recovered;
    const prior = grouped.get(paid.specificationNumber);
    grouped.set(paid.specificationNumber, {
      employerId,
      reportingPeriod: paid.reportingPeriod,
      payeeId: paid.employeeId,
      specificationNumber: paid.specificationNumber,
      grossCashMinor: (gross + BigInt(prior?.grossCashMinor ?? "0")).toString(),
      withholdingMinor: (
        BigInt(paid.withholdingMinor) + BigInt(prior?.withholdingMinor ?? "0")
      ).toString(),
      contributionBaseMinor: (
        contribution + BigInt(prior?.contributionBaseMinor ?? "0")
      ).toString(),
    });
  }

  return {
    items: [...grouped.values()].sort((a, b) =>
      a.specificationNumber.localeCompare(b.specificationNumber),
    ),
    adjustment,
  };
});
