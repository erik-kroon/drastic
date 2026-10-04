import * as Inputs from "@open-erp/contracts/payroll-inputs";
import { compileDomesticPurchase } from "@open-erp/domain/purchasing";
import { reviewClaim } from "@open-erp/domain/employee-claims";
import { prepareTripAward } from "@open-erp/domain/mileage-reimbursement";
import {
  normalizeWork,
  calculateVariablePay,
  holidayTarget,
  compileHolidayAdjustment,
} from "@open-erp/domain/variable-pay";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { failure } from "../failures";
import { economicKey } from "../purchases/recognition";

export const compileInput = Effect.fn("payroll.compileInput")(function* (
  submitted: typeof Inputs.PayrollInput.Type,
  currentHolidayMoneyMinor: string,
  currentHolidaySocialMinor: string,
) {
  const input = submitted.input;
  const basis = input.basis;

  const outputs: typeof Inputs.PayrollInputOutputs.Type = {
    reimbursementMinor: "0",
    grossMinor: "0",
    grossRecognizedMinor: "0",
    taxFacts: [],
    mileage: null,
    work: null,
    components: [],
    holiday: null,
    holidayMoneyDeltaMinor: "0",
    holidaySocialDeltaMinor: "0",
  };

  const componentKeys = [`economic:${input.economicKey}`];

  const journal: Array<{
    accountId: string;
    debitMinor: string;
    creditMinor: string;
    description: string;
  }> = [];

  if (basis.kind === "claim") {
    const purchaseKey = economicKey(basis.counterpartyId, basis.supplierDocumentNumber);

    componentKeys.push(`purchase:${purchaseKey}`);

    if (
      basis.paidBy !== "employee" ||
      basis.line.sourceRefs.some((ref) => ref.evidenceId !== input.evidence.evidenceId)
    )
      return yield* failure("UnsupportedProfile");

    const purchase = compileDomesticPurchase({
      currencyScale: 2,
      recognitionDate: input.postingDate,
      taxPoint: { taxPointOn: input.postingDate, basis: "document_date" },
      funding: {
        accountId: input.liabilityAccountId,
        role: "employee_liability",
        inputVatAccountId: basis.inputVatAccountId,
      },
      reportingObligationId: null,
      ruleReleaseId: null,
      taxComponentPrefix: submitted.id,
      lines: [basis.line],
    });

    if (Result.isFailure(purchase)) return yield* failure("InvalidJournal");
    const line = purchase.success.lines[0];

    if (!line) return yield* failure("InternalError");

    const decision = reviewClaim({
      claimId: submitted.id,
      employeeId: input.employeeId,
      currency: "SEK",
      knownComponentKeys: [],
      items: [
        {
          componentKey: input.economicKey,
          state: "unrecognized",
          netMinor: line.netMinor,
          deductibleTaxMinor: line.deductibleTaxMinor,
          nonDeductibleTaxMinor: line.nonDeductibleTaxMinor,
          taxableAllowance: false,
          conflictResolutionRef: null,
        },
      ],
    });

    if (Result.isFailure(decision)) return yield* failure("InvalidJournal");

    for (const ref of basis.line.sourceRefs)
      componentKeys.push(
        `receipt:${JSON.stringify([purchaseKey, basis.line.sourceLineId, ref.evidenceId, ref.sourceKey])}`,
      );

    return {
      outputs: {
        ...outputs,
        reimbursementMinor: decision.success.reimbursableMinor,
        taxFacts: purchase.success.taxFacts,
      },
      componentKeys,
      journal: purchase.success.journal,
    };
  }

  if (basis.kind === "mileage") {
    if (
      basis.trip.claimantId !== input.employeeId ||
      basis.trip.routeEvidenceRef !== input.evidence.evidenceId ||
      basis.trip.departureOn.slice(0, 7) !== input.month ||
      basis.trip.arrivalOn < basis.trip.departureOn ||
      basis.trip.arrivalOn.slice(0, 7) !== input.month ||
      basis.trip.previousRevision !== null ||
      basis.release.evidenceSourceHash !== `sha256:${input.evidence.sha256}`
    )
      return yield* failure("UnsupportedProfile");

    const award = prepareTripAward({
      awardId: submitted.id,
      trip: basis.trip,
      release: basis.release,
      payoutRoute: "payroll",
      payrollProfilePresent: true,
      priorAwardTripIds: [],
      overlappingTripIds: [],
    });

    if (Result.isFailure(award)) return yield* failure("UnsupportedProfile");
    const split = award.success.split;

    if (BigInt(split.entitlementMinor) <= 0n) return yield* failure("InvalidJournal");
    componentKeys.push(
      `trip:${basis.trip.id}`,
      `trip-route:${input.employeeId}:${basis.trip.departureOn}:${basis.trip.arrivalOn}:${basis.trip.origin}:${basis.trip.destination}`,
    );

    for (const [minor, expense, liability, description] of [
      [
        split.exemptPaidPartMinor,
        basis.expenseAccountId,
        input.liabilityAccountId,
        "Exempt mileage award",
      ],
      [
        split.taxablePartMinor,
        basis.taxableExpenseAccountId,
        basis.taxableLiabilityAccountId,
        "Taxable mileage award",
      ],
    ] as const) {
      if (minor !== "0")
        journal.push(
          { accountId: expense, debitMinor: minor, creditMinor: "0", description },
          { accountId: liability, debitMinor: "0", creditMinor: minor, description },
        );
    }

    return {
      outputs: {
        ...outputs,
        reimbursementMinor: split.exemptPaidPartMinor,
        grossMinor: split.taxablePartMinor,
        grossRecognizedMinor: split.taxablePartMinor,
        mileage: split,
      },
      componentKeys,
      journal,
    };
  }

  return yield* compileVariableInput(
    submitted,
    basis,
    outputs,
    currentHolidayMoneyMinor,
    currentHolidaySocialMinor,
  );
});

const compileVariableInput = Effect.fn("payroll.compileVariableInput")(function* (
  submitted: typeof Inputs.PayrollInput.Type,
  basis: Extract<typeof Inputs.PayrollInputBasis.Type, { kind: "variable" }>,
  outputs: typeof Inputs.PayrollInputOutputs.Type,
  currentHolidayMoneyMinor: string,
  currentHolidaySocialMinor: string,
) {
  const input = submitted.input;
  const componentKeys = [`economic:${input.economicKey}`];

  const journal: Array<{
    accountId: string;
    debitMinor: string;
    creditMinor: string;
    description: string;
  }> = [];

  if (
    basis.work.some(
      (segment) =>
        !["worked", "overtime"].includes(segment.kind) ||
        segment.scheduleDate.slice(0, 7) !== input.month,
    ) ||
    basis.earnings.some(
      (row) =>
        row.componentKind !== "cash" ||
        !row.withholdingBase ||
        !row.contributionBase ||
        !row.holidayAccrualBase,
    )
  )
    return yield* failure("UnsupportedProfile");
  const work = normalizeWork(basis.work, 0);
  const components = calculateVariablePay(basis.earnings, []);
  const holiday = holidayTarget(basis.holiday);

  if (Result.isFailure(work) || Result.isFailure(components) || Result.isFailure(holiday))
    return yield* failure("InvalidJournal");

  if (
    BigInt(holiday.success.valueMinor) < 0n ||
    BigInt(holiday.success.socialTargetMinor) < 0n ||
    basis.holiday.openingValueMinor !== currentHolidayMoneyMinor ||
    basis.holiday.openingSocialMinor !== currentHolidaySocialMinor ||
    basis.holiday.movements.some((row) => !["earned", "used"].includes(row.kind))
  )
    return yield* failure("UnsupportedProfile");

  const minutes = basis.earnings.reduce(
    (sum, row) => sum + (BigInt(row.unitsNumerator) * 60n) / BigInt(row.unitsDenominator),
    0n,
  );

  if (
    basis.earnings.some(
      (row) => (BigInt(row.unitsNumerator) * 60n) % BigInt(row.unitsDenominator) !== 0n,
    ) ||
    minutes !== BigInt(work.success.workedMinor) + BigInt(work.success.overtimeMinor)
  )
    return yield* failure("InvalidJournal");
  componentKeys.push(
    ...basis.work.map((row) => `work:${row.sourceId}`),
    ...basis.earnings.map((row) => `earning:${row.sourceIdentity}`),
    ...basis.holiday.movements.map((row) => `holiday:${row.sourceIdentity}`),
  );

  const adjustment = compileHolidayAdjustment({
    currentMoneyLiabilityMinor: currentHolidayMoneyMinor,
    currentSocialProvisionMinor: currentHolidaySocialMinor,
    target: holiday.success,
    expenseAccountId: basis.holidayExpenseAccountId,
    liabilityAccountId: basis.holidayLiabilityAccountId,
    socialExpenseAccountId: basis.socialExpenseAccountId,
    socialProvisionAccountId: basis.socialProvisionAccountId,
  });

  if (Result.isFailure(adjustment)) return yield* failure("InvalidJournal");

  const gross = components.success
    .reduce((sum, row) => sum + BigInt(row.amountMinor), 0n)
    .toString();

  journal.push(
    {
      accountId: basis.expenseAccountId,
      debitMinor: gross,
      creditMinor: "0",
      description: "Synthetic variable cash entitlement",
    },
    {
      accountId: input.liabilityAccountId,
      debitMinor: "0",
      creditMinor: gross,
      description: "Variable payroll entitlement liability",
    },
    ...adjustment.success.journal,
  );

  return {
    outputs: {
      ...outputs,
      grossMinor: gross,
      grossRecognizedMinor: gross,
      work: work.success,
      components: components.success,
      holiday: holiday.success,
      holidayMoneyDeltaMinor: adjustment.success.moneyDeltaMinor,
      holidaySocialDeltaMinor: adjustment.success.socialDeltaMinor,
    },
    componentKeys,
    journal,
  };
});
