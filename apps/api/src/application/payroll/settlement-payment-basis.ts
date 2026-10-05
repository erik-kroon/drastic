import * as Settlement from "@open-erp/contracts/payroll-settlements";
import * as Profiles from "@open-erp/contracts/company-profiles";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Db from "../../db/payroll/calculations";
import type { Transaction } from "../../db/transaction";
import { decode, type Scope } from "../commerce/support";
import { resolveCompanyProfileInTransaction } from "../company-profiles";
import { failure } from "../failures";
import { calculateRegularPayroll } from "./calculation-basis";

export const capturePaymentReportingBasis = Effect.fn("payroll.capturePaymentReportingBasis")(
  function* (
    tx: Transaction,
    scope: Scope,
    employee: typeof Settlement.PaidPayrollEvent.Type.originalEmployee,
    paidOn: string,
  ) {
    const original = employee.calculation;

    const resolved = yield* resolveCompanyProfileInTransaction(tx, scope, "synthetic", {
      postingOn: null,
      taxPointOn: null,
      paymentOn: paidOn,
      reportOn: null,
    });

    const witness = resolved.families.find((row) => row.family === "payroll")?.witness;

    if (!witness) return yield* failure("UnsupportedProfile");
    const row = (yield* Db.readRuleRelease(tx, witness.ruleReleaseId))[0];

    if (!row) return yield* failure("UnsupportedProfile");
    const release = yield* decode(Profiles.RuleRelease, row.body);

    if (!release.payroll || row.checksum !== release.checksum)
      return yield* failure("StaleDependency");

    const basis = {
      ...original.basis,
      expectedPaymentOn: paidOn,
      reviewedInput: {
        ...original.basis.reviewedInput,
        work: { ...original.basis.reviewedInput.work, expectedPaymentOn: paidOn },
      },
    };

    const result = yield* Effect.result(calculateRegularPayroll(basis, release.payroll));

    const fields = [
      "grossMinor",
      "withholdingMinor",
      "payableMinor",
      "contributionBaseMinor",
      "employerContributionMinor",
      "cashReimbursementMinor",
      "netDeductionMinor",
    ] as const;

    const ready =
      Result.isSuccess(result) &&
      fields.every((key) => result.success[key] === original.calculation[key]);

    const readiness: typeof Settlement.PaidPayrollEvent.Type.reportingReadiness = ready
      ? "ready"
      : "adjustment_required";

    return { readiness, witness, releaseChecksum: row.checksum };
  },
);
