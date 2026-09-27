import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { AccountingDate, Description, Identifier } from "./values";
import { MinorUnits } from "./money";
import { assertBalancedJournal, type PurchaseJournalLine } from "./purchasing";

// Pure pay-run posting math for one book and pay period. NEXT-21 leaf:
// run journal, paid/reporting bridge, AGI mapping and payslip semantics
// over the NEXT-20 frozen calculation. Posting, payment admission,
// declaration rendering and submission stay with the payroll
// runs-and-declarations owners; this compiler never moves cash, never
// fabricates a paid fact and never recalculates table withholding at
// export time.
//
// No database and no runtime. Every amount (frozen gross, withholding,
// deductions, contributions, accruals) arrives as a reviewed exact input;
// the application owns reading it from the frozen run, the paid-event
// history and the AGI release. A bound failure is an error rather than a
// partial posting or an estimated declaration.

export const PayrollFailureCode = Schema.Literals([
  "NegativePayable",
  "UnrecognizedBenefitExpense",
  "PartialPaymentUnsupported",
  "PaymentMismatch",
  "MissingPaidEvidence",
  "UnpaidRunHasNoPaidRecord",
  "WithholdingDecreaseNeedsReview",
  "AmendmentIdentityChanged",
  "ReconciliationDifference",
  "AlreadyExecuted",
  "PaidRunCorrectionRefused",
  "UnbalancedJournal",
  "StalePayrollBasis",
]);

export type PayrollFailureCode = typeof PayrollFailureCode.Type;

export const PayrollFailure = Schema.Struct({
  code: PayrollFailureCode,
  message: Description,
});

export type PayrollFailure = typeof PayrollFailure.Type;

export type Checked<A> = Result.Result<A, PayrollFailure>;

function fail(code: PayrollFailureCode, message: string): Checked<never> {
  return Result.fail({ code, message });
}

export type BusinessDay = typeof AccountingDate.Type;

function amount(value: bigint) {
  return value.toString();
}

export const DeductionLine = Schema.Struct({
  deductionId: Identifier,
  amountMinor: MinorUnits,
  destinationAccountId: Identifier,
});

export type DeductionLine = typeof DeductionLine.Type;

export const AccrualPair = Schema.Struct({
  accrualId: Identifier,
  expenseAccountId: Identifier,
  liabilityAccountId: Identifier,
  amountMinor: MinorUnits,
});

export type AccrualPair = typeof AccrualPair.Type;

// One employee's frozen run components. The payable is derived, never
// supplied: payable = gross - withholding - deductions. Reimbursements
// already recognized elsewhere arrive with their clearing, not as new
// benefit expense.
export const RunEmployee = Schema.Struct({
  employeeId: Identifier,
  grossMinor: MinorUnits,
  withholdingMinor: MinorUnits,
  cashReimbursementMinor: MinorUnits,
  reimbursementAlreadyRecognized: Schema.Boolean,
  deductions: Schema.Array(DeductionLine),
  employerContributionMinor: MinorUnits,
  accruals: Schema.Array(AccrualPair),
});

export type RunEmployee = typeof RunEmployee.Type;

export const RunRoles = Schema.Struct({
  salaryExpenseAccountId: Identifier,
  reimbursementExpenseAccountId: Identifier,
  netPayLiabilityAccountId: Identifier,
  withholdingLiabilityAccountId: Identifier,
  employerContributionExpenseAccountId: Identifier,
  employerContributionLiabilityAccountId: Identifier,
});

export type RunRoles = typeof RunRoles.Type;

export const PayRunInput = Schema.Struct({
  runId: Identifier,
  employees: Schema.Array(RunEmployee).check(Schema.isMinLength(1), Schema.isMaxLength(1000)),
  roles: RunRoles,
  commandKey: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  knownCommandKeys: Schema.Array(
    Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  ),
});

export type PayRunInput = typeof PayRunInput.Type;

export const PayRunPlan = Schema.Struct({
  runId: Identifier,
  commandKey: PayRunInput.fields.commandKey,
  journal: Schema.Array(
    Schema.Struct({
      sourceLineId: Schema.NullOr(Identifier),
      accountId: Identifier,
      debitMinor: MinorUnits,
      creditMinor: MinorUnits,
      description: Description,
    }),
  ),
  employeePayables: Schema.Array(
    Schema.Struct({
      employeeId: Identifier,
      payableMinor: MinorUnits,
    }),
  ),
});

export type PayRunPlan = typeof PayRunPlan.Type;

function addSigned(
  lines: Array<PurchaseJournalLine>,
  line: {
    readonly accountId: string;
    readonly signedMinor: bigint;
    readonly description: string;
  },
) {
  if (line.signedMinor === 0n) return;

  lines.push({
    sourceLineId: null,
    accountId: line.accountId,
    debitMinor: amount(line.signedMinor > 0n ? line.signedMinor : 0n),
    creditMinor: amount(line.signedMinor < 0n ? -line.signedMinor : 0n),
    description: line.description,
  });
}

// No cash movement and no paid-reporting fact from posting alone. A later
// employee edit never changes these sealed bytes.
export function compilePayRunJournal(input: PayRunInput): Checked<PayRunPlan> {
  if (input.knownCommandKeys.includes(input.commandKey)) {
    return fail(
      "AlreadyExecuted",
      "The same pay-run key returns its original receipt; it never posts twice.",
    );
  }

  const journal: Array<PurchaseJournalLine> = [];
  const payables: Array<{ readonly employeeId: string; readonly payableMinor: string }> = [];

  for (const employee of input.employees) {
    const gross = BigInt(employee.grossMinor);
    const withholding = BigInt(employee.withholdingMinor);
    let deductions = 0n;

    for (const deduction of employee.deductions) deductions += BigInt(deduction.amountMinor);

    const payable = gross - withholding - deductions;

    if (payable < 0n) {
      return fail(
        "NegativePayable",
        `The net payable for ${employee.employeeId} cannot go negative.`,
      );
    }

    addSigned(journal, {
      accountId: input.roles.salaryExpenseAccountId,
      signedMinor: gross,
      description: `Salary expense ${employee.employeeId}`,
    });

    if (!employee.reimbursementAlreadyRecognized) {
      addSigned(journal, {
        accountId: input.roles.reimbursementExpenseAccountId,
        signedMinor: BigInt(employee.cashReimbursementMinor),
        description: `Reimbursement ${employee.employeeId}`,
      });
    } else if (BigInt(employee.cashReimbursementMinor) !== 0n) {
      return fail(
        "UnrecognizedBenefitExpense",
        `No benefit expense is added when its cost is already recognized for ${employee.employeeId}.`,
      );
    }

    addSigned(journal, {
      accountId: input.roles.netPayLiabilityAccountId,
      signedMinor: -payable,
      description: `Net pay liability ${employee.employeeId}`,
    });

    addSigned(journal, {
      accountId: input.roles.withholdingLiabilityAccountId,
      signedMinor: -withholding,
      description: `Withholding ${employee.employeeId}`,
    });

    for (const deduction of employee.deductions) {
      addSigned(journal, {
        accountId: deduction.destinationAccountId,
        signedMinor: -BigInt(deduction.amountMinor),
        description: `Deduction ${deduction.deductionId}`,
      });
    }

    addSigned(journal, {
      accountId: input.roles.employerContributionExpenseAccountId,
      signedMinor: BigInt(employee.employerContributionMinor),
      description: `Employer contribution ${employee.employeeId}`,
    });

    addSigned(journal, {
      accountId: input.roles.employerContributionLiabilityAccountId,
      signedMinor: -BigInt(employee.employerContributionMinor),
      description: `Contribution liability ${employee.employeeId}`,
    });

    for (const accrual of employee.accruals) {
      addSigned(journal, {
        accountId: accrual.expenseAccountId,
        signedMinor: BigInt(accrual.amountMinor),
        description: `Accrual ${accrual.accrualId}`,
      });

      addSigned(journal, {
        accountId: accrual.liabilityAccountId,
        signedMinor: -BigInt(accrual.amountMinor),
        description: `Accrual liability ${accrual.accrualId}`,
      });
    }

    payables.push({ employeeId: employee.employeeId, payableMinor: amount(payable) });
  }

  const finished = assertBalancedJournal(journal, 2);

  if (Result.isFailure(finished)) return fail("UnbalancedJournal", finished.failure.message);

  return Result.succeed({
    runId: input.runId,
    commandKey: input.commandKey,
    journal: finished.success,
    employeePayables: payables,
  });
}

export const PayrollPaymentInput = Schema.Struct({
  runId: Identifier,
  employeeId: Identifier,
  liabilityMinor: MinorUnits,
  paymentMinor: MinorUnits,
  evidenceId: Schema.NullOr(Identifier),
  bankAccountId: Identifier,
  netPayLiabilityAccountId: Identifier,
});

export type PayrollPaymentInput = typeof PayrollPaymentInput.Type;

export const PaidCompensationEvent = Schema.Struct({
  runId: Identifier,
  employeeId: Identifier,
  paidOn: AccountingDate,
  paidMinor: MinorUnits,
  evidenceId: Identifier,
  reportingPeriod: Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}$/)),
});

export type PaidCompensationEvent = typeof PaidCompensationEvent.Type;

export const PayrollPaymentResult = Schema.Struct({
  event: PaidCompensationEvent,
  liabilitySettledMinor: MinorUnits,
});

export type PayrollPaymentResult = typeof PayrollPaymentResult.Type;

// Salary payment accounting and PaidCompensationEvent admission are one
// named application transaction. An exported salary instruction or an
// operator's unverified settled status is not evidence. The initial
// profile requires the full employee net payment.
export function preparePayrollPayment(
  input: PayrollPaymentInput,
  paidOn: BusinessDay,
): Checked<PayrollPaymentResult> {
  if (input.evidenceId === null) {
    return fail(
      "MissingPaidEvidence",
      "Missing cash evidence keeps final AGI membership incomplete.",
    );
  }

  if (BigInt(input.paymentMinor) !== BigInt(input.liabilityMinor)) {
    return fail(
      "PartialPaymentUnsupported",
      "The initial profile requires the full employee net payment with its own qualified allocation otherwise.",
    );
  }

  return Result.succeed({
    event: {
      runId: input.runId,
      employeeId: input.employeeId,
      paidOn,
      paidMinor: input.paymentMinor,
      evidenceId: input.evidenceId,
      reportingPeriod: paidOn.slice(0, 7),
    },
    liabilitySettledMinor: input.liabilityMinor,
  });
}

// January work paid in February belongs to the February paid-reporting
// population under the selected rule: AGI timing follows paid/provided
// compensation, not creation of a proposed run.
export function resolveReportingPeriod(paidOn: BusinessDay): string {
  return paidOn.slice(0, 7);
}

// An unpaid pay run with no paid evidence yields no paid individual record.
// This refusal is what keeps declarations honest instead of fabricated.
export function requirePaidRecord(
  events: ReadonlyArray<PaidCompensationEvent>,
): Checked<ReadonlyArray<PaidCompensationEvent>> {
  if (events.length === 0) {
    return fail(
      "UnpaidRunHasNoPaidRecord",
      "An unpaid run with no paid evidence produces no fabricated paid individual record.",
    );
  }

  return Result.succeed(events);
}

export const AgiItemInput = Schema.Struct({
  employerId: Identifier,
  reportingPeriod: PaidCompensationEvent.fields.reportingPeriod,
  payeeId: Identifier,
  specificationNumber: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64)),
  grossCashMinor: MinorUnits,
  withholdingMinor: MinorUnits,
  contributionBaseMinor: MinorUnits,
});

export type AgiItemInput = typeof AgiItemInput.Type;

export const AgiTotals = Schema.Struct({
  grossMinor: MinorUnits,
  withholdingMinor: MinorUnits,
  contributionBaseMinor: MinorUnits,
});

export type AgiTotals = typeof AgiTotals.Type;

// The specification number is the retained nonzero stable ID for the
// reporting item. Aggregation uses the recorded withholding and frozen run
// evidence; table withholding is never recalculated from current salary.
export function aggregateAgiItems(items: ReadonlyArray<AgiItemInput>): AgiTotals {
  let gross = 0n;
  let withholding = 0n;
  let base = 0n;

  for (const item of items) {
    gross += BigInt(item.grossCashMinor);
    withholding += BigInt(item.withholdingMinor);
    base += BigInt(item.contributionBaseMinor);
  }

  return {
    grossMinor: amount(gross),
    withholdingMinor: amount(withholding),
    contributionBaseMinor: amount(base),
  };
}

export const AgiReconciliationInput = Schema.Struct({
  postedAccrualsMinor: MinorUnits,
  unpaidMinor: MinorUnits,
  otherPeriodMinor: MinorUnits,
  adjustmentMinor: Schema.Array(MinorUnits),
  declaredMinor: MinorUnits,
});

export type AgiReconciliationInput = typeof AgiReconciliationInput.Type;

// posted accruals - unpaid/other-period components +/- explicit
// adjustments == declared period components, with all bridges evidenced.
export function assertAgiReconciliation(input: AgiReconciliationInput): Checked<string> {
  let adjustments = 0n;

  for (const adjustment of input.adjustmentMinor) adjustments += BigInt(adjustment);

  const recomposed =
    BigInt(input.postedAccrualsMinor) -
    BigInt(input.unpaidMinor) -
    BigInt(input.otherPeriodMinor) +
    adjustments;

  if (recomposed !== BigInt(input.declaredMinor)) {
    return fail(
      "ReconciliationDifference",
      "Paid semantic totals must reconcile to the registers and GL or the declaration is refused.",
    );
  }

  return Result.succeed(input.declaredMinor);
}

export const AgiAmendmentInput = Schema.Struct({
  employerId: Identifier,
  reportingPeriod: AgiItemInput.fields.reportingPeriod,
  payeeId: Identifier,
  specificationNumber: AgiItemInput.fields.specificationNumber,
  original: AgiItemInput,
  correctedWithholdingMinor: MinorUnits,
  withholdingCorrectionQualified: Schema.Boolean,
});

export type AgiAmendmentInput = typeof AgiAmendmentInput.Type;

export const AgiAmendmentResult = Schema.Struct({
  specificationNumber: AgiItemInput.fields.specificationNumber,
  replacementMinor: MinorUnits,
});

export type AgiAmendmentResult = typeof AgiAmendmentResult.Type;

// An amendment retains employer, period, payee and the SAME specification
// number: a new number would add another item instead of replacing the old
// one. A withholding decrease without a specifically qualified correction
// exception is refused into a specialist review case.
export function prepareAgiAmendment(input: AgiAmendmentInput): Checked<AgiAmendmentResult> {
  if (
    input.original.employerId !== input.employerId ||
    input.original.reportingPeriod !== input.reportingPeriod ||
    input.original.payeeId !== input.payeeId ||
    input.original.specificationNumber !== input.specificationNumber
  ) {
    return fail(
      "AmendmentIdentityChanged",
      "An amendment retains employer, period, payee and the same specification number.",
    );
  }

  if (
    BigInt(input.correctedWithholdingMinor) < BigInt(input.original.withholdingMinor) &&
    !input.withholdingCorrectionQualified
  ) {
    return fail(
      "WithholdingDecreaseNeedsReview",
      "A withholding decrease without a qualified correction exception needs specialist review.",
    );
  }

  return Result.succeed({
    specificationNumber: input.specificationNumber,
    replacementMinor: input.correctedWithholdingMinor,
  });
}

export const UnpaidCorrectionInput = Schema.Struct({
  runId: Identifier,
  hasPayment: Schema.Boolean,
  hasFiledRecord: Schema.Boolean,
  hasDependentConsumption: Schema.Boolean,
  reversalMinor: MinorUnits,
  replacementMinor: MinorUnits,
});

export type UnpaidCorrectionInput = typeof UnpaidCorrectionInput.Type;

export const UnpaidCorrectionResult = Schema.Struct({
  groupMinor: MinorUnits,
});

export type UnpaidCorrectionResult = typeof UnpaidCorrectionResult.Type;

// Negative recovery of already paid salary needs a separately qualified
// recovery profile: the unpaid reversal algorithm is refused on paid money.
export function prepareUnpaidRunCorrection(
  input: UnpaidCorrectionInput,
): Checked<UnpaidCorrectionResult> {
  if (input.hasPayment || input.hasFiledRecord || input.hasDependentConsumption) {
    return fail(
      "PaidRunCorrectionRefused",
      "A run with payment, a filed record or later consumption needs a qualified recovery profile.",
    );
  }

  return Result.succeed({
    groupMinor: amount(BigInt(input.reversalMinor) + BigInt(input.replacementMinor)),
  });
}
