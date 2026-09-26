import * as Schema from "effect/Schema";
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import * as Accounting from "./accounting";
import { accountingErrors } from "./accounting-errors";
import { RoleKind } from "./roles";
import { CommandReceipt, EvidenceReference } from "./commerce";

// Frozen regular-payroll calculation. Nothing here decides a statutory rate, a
// table row, a per-diem, a contribution band or a holiday rule: every one of
// those is a qualified input carried by a reviewed payroll rule release. A
// missing qualified input is an explicit refusal, never a zero and never a
// default.

const ComponentId = Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9_-]{1,63}$/));

// The exact algorithm this packet's calculator implements. A reviewed payroll
// rule release declares this version in order to be usable by it; a release that
// declares any other version is refused, never reinterpreted.
export const SupportedCalculatorVersion = "payroll-regular-v1";

// An exact rate crosses the wire as canonical integer strings. It is never a
// JavaScript number.
const RateNumerator = Schema.String.check(Schema.isPattern(/^(0|[1-9][0-9]{0,37})$/));

const RateDenominator = Schema.String.check(Schema.isPattern(/^[1-9][0-9]{0,18}$/));

export const SignedInteger = Schema.String.check(Schema.isPattern(/^-?(0|[1-9][0-9]*)$/));

export const ExactRate = Schema.Struct({
  numerator: RateNumerator,
  denominator: RateDenominator,
});

export const RoundingMode = Schema.Literals(["half_up", "half_even", "toward_zero", "floor"]);

export const PayrollRounding = Schema.Struct({
  mode: RoundingMode,
  scale: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 6 })),
});

const AgeYears = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 120 }));

const StatusClass = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64));

const PayFrequency = Schema.Literals([
  "monthly",
  "four_weekly",
  "biweekly",
  "weekly",
  "daily",
  "hourly",
]);

const AggregationPeriod = Schema.Literals([
  "per_pay_event",
  "per_calendar_month",
  "per_calendar_year",
]);

const ObligationKind = Schema.Literals(["employer_contribution", "pension", "holiday", "other"]);

// One reviewed band of an exact marginal schedule. `upperMinor: null` is an
// unbounded final band. Bands are contiguous from zero; a gap or an overlap is a
// refusal, not a silent zero range.
export const ContributionBand = Schema.Struct({
  lowerMinor: Accounting.MinorUnits,
  upperMinor: Schema.NullOr(Accounting.MinorUnits),
  rate: ExactRate,
}).check(
  Schema.makeFilter((band) => {
    const issues: Array<Schema.FilterIssue> = [];

    if (band.upperMinor !== null && band.upperMinor <= band.lowerMinor) {
      issues.push({
        path: ["upperMinor"],
        issue: "A contribution band must be strictly wider than its lower bound.",
      });
    }

    return issues;
  }),
);

export const ObligationProfile = Schema.Struct({
  profileId: Accounting.Identifier,
  obligationKind: ObligationKind,
  aggregationPeriod: AggregationPeriod,
  eligibleStatusClasses: Schema.Array(StatusClass).check(Schema.isMinLength(1)),
  minimumAgeOnPaymentOn: Schema.NullOr(AgeYears),
  maximumAgeOnPaymentOn: Schema.NullOr(AgeYears),
  obligationReference: Accounting.Description,
  bands: Schema.Array(ContributionBand).check(Schema.isMinLength(1), Schema.isMaxLength(64)),
  rounding: PayrollRounding,
  sourceReference: Accounting.Description,
});

export const WithholdingRow = Schema.Struct({
  lowerMinor: Accounting.MinorUnits,
  upperMinor: Accounting.MinorUnits,
  amountMinor: Accounting.MinorUnits,
}).check(
  Schema.makeFilter((row) => {
    const issues: Array<Schema.FilterIssue> = [];

    if (row.upperMinor < row.lowerMinor) {
      issues.push({
        path: ["upperMinor"],
        issue: "A withholding row must end at or after its lower bound.",
      });
    }

    return issues;
  }),
);

// A published table is imported and versioned, never represented as one
// universal percentage. The calculator selects the unit value with the release's
// own base rounding, then requires exactly one matching row.
const WithholdingTable = Schema.Struct({
  kind: Schema.Literal("table"),
  ruleId: Accounting.Identifier,
  frequency: PayFrequency,
  tableId: Accounting.Description,
  column: Accounting.Description,
  baseRounding: PayrollRounding,
  rows: Schema.Array(WithholdingRow).check(Schema.isMinLength(1), Schema.isMaxLength(2000)),
  sourceReference: Accounting.Description,
});

const WithholdingFixedAmount = Schema.Struct({
  kind: Schema.Literal("fixed_amount"),
  ruleId: Accounting.Identifier,
  frequency: PayFrequency,
  amountMinor: Accounting.MinorUnits,
  sourceReference: Accounting.Description,
});

const WithholdingPercentage = Schema.Struct({
  kind: Schema.Literal("approved_percentage"),
  ruleId: Accounting.Identifier,
  frequency: PayFrequency,
  rate: ExactRate,
  rounding: PayrollRounding,
  sourceReference: Accounting.Description,
});

export const WithholdingRule = Schema.Union([
  WithholdingTable,
  WithholdingFixedAmount,
  WithholdingPercentage,
]);

// A non-cash benefit can produce a taxable base without another expense. The
// component says whether its cost is already recognized; the release says how
// that kind enters the withholding and contribution bases.
export const BenefitBaseMapping = Schema.Struct({
  benefitKind: ComponentId,
  withholdingBase: Schema.Literals(["declared_amount", "not_taxable"]),
  contributionBase: Schema.Literals(["declared_amount", "not_a_base"]),
  note: Accounting.Description,
});

export const PayrollAccrual = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("none") }),
  Schema.Struct({
    kind: Schema.Literal("fixed_minor_per_pay_event"),
    amountMinor: Accounting.MinorUnits,
  }),
  Schema.Struct({
    kind: Schema.Literal("percentage_of_qualifying_base"),
    rate: ExactRate,
    base: Schema.Literals(["gross_cash", "gross_cash_plus_contribution_benefits"]),
  }),
]);

// The payroll family section of a reviewed company rule release. It is the only
// source of statutory tables, decisions, contribution bands and holiday
// accrual policy in this packet.
export const PayrollRuleRelease = Schema.Struct({
  calculatorVersion: Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9._-]{2,127}$/)),
  // The compiled calculator implements no proration. A release that declares
  // anything else is refused rather than paid at a full monthly salary.
  cashProrationPolicy: Schema.Literal("none"),
  supportedWorkPatterns: Schema.Array(Schema.Literals(["monthly_salaried"])).check(
    Schema.isMinLength(1),
  ),
  withholdingRules: Schema.Array(WithholdingRule).check(Schema.isMinLength(1)),
  benefitBaseMappings: Schema.Array(BenefitBaseMapping).check(Schema.isMaxLength(64)),
  obligationProfiles: Schema.Array(ObligationProfile).check(Schema.isMinLength(1)),
  accrualProfiles: Schema.Array(
    Schema.Struct({
      componentId: ComponentId,
      obligationProfileId: Accounting.Identifier,
      accrual: PayrollAccrual,
      rounding: PayrollRounding,
    }),
  ).check(Schema.isMaxLength(64)),
  roundingByComponent: Schema.Struct({
    gross: PayrollRounding,
    withholding: PayrollRounding,
    netDeduction: PayrollRounding,
    reimbursement: PayrollRounding,
    payable: PayrollRounding,
  }),
  supportedDeductionRoleKinds: Schema.Array(RoleKind).check(Schema.isMinLength(1)),
  sourceManifest: Accounting.Description,
});

const EarningsPeriod = Schema.Struct({
  startsOn: Accounting.AccountingDate,
  endsOn: Accounting.AccountingDate,
}).check(
  Schema.makeFilter((period) => {
    const issues: Array<Schema.FilterIssue> = [];

    if (period.startsOn > period.endsOn) {
      issues.push({
        path: ["endsOn"],
        issue: "The earnings period must end on or after its start date.",
      });
    }

    if (period.startsOn.slice(0, 7) !== period.endsOn.slice(0, 7)) {
      issues.push({
        path: ["endsOn"],
        issue: "The initial regular profile supports one earnings period inside a calendar month.",
      });
    }

    return issues;
  }),
);

const GrossAdjustment = Schema.Struct({
  componentId: ComponentId,
  minor: Accounting.SignedMinorUnits,
  description: Accounting.Description,
  evidence: Schema.Array(EvidenceReference).check(Schema.isMaxLength(20)),
});

// The calculator supports only supported non-taxable cash reimbursements. A
// taxable cash component is a gross adjustment, not a reimbursement.
const SupportedReimbursement = Schema.Struct({
  componentId: ComponentId,
  minor: Accounting.MinorUnits,
  description: Accounting.Description,
  evidence: EvidenceReference,
  treatment: Schema.Literal("non_taxable_reimbursement"),
});

const BenefitComponent = Schema.Struct({
  componentId: ComponentId,
  benefitKind: ComponentId,
  cashMinor: Accounting.MinorUnits,
  withholdingBaseMinor: Accounting.MinorUnits,
  contributionBaseMinor: Accounting.MinorUnits,
  costRecognition: Schema.Literals(["already_recognized", "paired_effect_required", "unsupported"]),
  note: Accounting.Description,
});

// A post-tax deduction carries its reviewed destination role. Only a deduction
// that names a benefit, with an explicit amount, reduces that benefit's base.
const DeductionComponent = Schema.Struct({
  componentId: ComponentId,
  minor: Accounting.MinorUnits,
  description: Accounting.Description,
  destinationRole: RoleKind,
  reducesBenefit: Schema.NullOr(
    Schema.Struct({ componentId: ComponentId, minor: Accounting.MinorUnits }),
  ),
});

const WithholdingSelection = Schema.Struct({
  ruleId: Accounting.Identifier,
  tableColumn: Schema.NullOr(Accounting.Description),
  taxStatus: StatusClass,
  evidence: Schema.Array(EvidenceReference).check(Schema.isMinLength(1), Schema.isMaxLength(20)),
});

const ObligationSelection = Schema.Struct({
  profileId: Accounting.Identifier,
  obligationReference: Accounting.Description,
  statusClass: StatusClass,
  ageOnPaymentOn: AgeYears,
  evidence: Schema.Array(EvidenceReference).check(Schema.isMinLength(1), Schema.isMaxLength(20)),
});

// `unknown` is refused. Absence must be evidenced; omission is not a decision.
export const ObligationApplicability = Schema.Union([
  Schema.Struct({ state: Schema.Literal("applicable"), selection: ObligationSelection }),
  Schema.Struct({
    state: Schema.Literal("evidenced_not_applicable"),
    evidence: Schema.Array(EvidenceReference).check(Schema.isMinLength(1), Schema.isMaxLength(20)),
  }),
  Schema.Struct({ state: Schema.Literal("unknown") }),
]);

export const EmploymentForCalculation = Schema.Struct({
  employeeId: Accounting.Identifier,
  effectiveRevision: Accounting.Identifier,
  monthlyCashSalary: Accounting.MinorUnits,
  workPattern: Schema.Literals(["monthly_salaried"]),
  withholding: WithholdingSelection,
  grossAdjustments: Schema.Array(GrossAdjustment).check(Schema.isMaxLength(200)),
  reimbursements: Schema.Array(SupportedReimbursement).check(Schema.isMaxLength(200)),
  benefitComponents: Schema.Array(BenefitComponent).check(Schema.isMaxLength(100)),
  deductionComponents: Schema.Array(DeductionComponent).check(Schema.isMaxLength(100)),
  holidayPolicy: ObligationApplicability,
  pensionAndOtherObligations: Schema.Array(ObligationApplicability).check(Schema.isMaxLength(20)),
});

export const WorkInput = Schema.Struct({
  effectiveRevision: Accounting.Identifier,
  earningsPeriod: EarningsPeriod,
  expectedPaymentOn: Accounting.AccountingDate,
  absence: Schema.Array(Schema.String.check(Schema.isMaxLength(200))).check(
    Schema.isMaxLength(200),
  ),
  adjustments: Schema.Array(GrossAdjustment).check(Schema.isMaxLength(200)),
  reimbursements: Schema.Array(SupportedReimbursement).check(Schema.isMaxLength(200)),
  evidence: Schema.Array(EvidenceReference).check(Schema.isMinLength(1), Schema.isMaxLength(40)),
});

export const PreparePayRun = Schema.Struct({
  recordClass: Schema.Literals(["actual_company", "synthetic"]),
  employment: EmploymentForCalculation,
  work: WorkInput,
  reason: Accounting.Description,
});

export const FormulaStep = Schema.Struct({
  step: ComponentId,
  statement: Accounting.Description,
  numerator: SignedInteger,
  denominator: RateDenominator,
  roundedMinor: Accounting.SignedMinorUnits,
  residualNumerator: SignedInteger,
});

export const PayrollAccrualComponent = Schema.Struct({
  componentId: ComponentId,
  obligationKind: ObligationKind,
  profileId: Accounting.Identifier,
  obligationReference: Accounting.Description,
  baseMinor: Accounting.MinorUnits,
  minor: Accounting.MinorUnits,
  rounding: PayrollRounding,
});

export const PayrollBenefitBasis = Schema.Struct({
  componentId: ComponentId,
  benefitKind: ComponentId,
  cashMinor: Accounting.MinorUnits,
  withholdingBaseMinor: Accounting.MinorUnits,
  contributionBaseMinor: Accounting.MinorUnits,
  costRecognition: Schema.Literals(["already_recognized", "paired_effect_required", "unsupported"]),
});

// The exact retained basis. A later employee change does not rewrite it; a new
// relevant dated input makes a new execution require a new calculation.
export const PayrollCalculationBasis = Schema.Struct({
  employeeId: Accounting.Identifier,
  employmentRevisionId: Accounting.Identifier,
  workRevisionId: Accounting.Identifier,
  openingRevisionId: Accounting.Identifier,
  // The retained 9107 opening balance for the obligation this run contributes
  // under. It is the prior compatible monthly contribution base.
  openingBaseMinor: Accounting.MinorUnits,
  // Contribution bases this owner already froze for the same employee and the
  // same calendar month. The marginal schedule is evaluated over
  // openingBaseMinor + priorFrozenBaseMinor, so a monthly reduced band is split
  // across runs instead of granted once per run. A reservation from an executed
  // run belongs to the execution owner.
  priorFrozenCalculationIds: Schema.Array(Accounting.Identifier).check(Schema.isMaxLength(40)),
  priorFrozenBaseMinor: Accounting.MinorUnits,
  earningsPeriod: EarningsPeriod,
  expectedPaymentOn: Accounting.AccountingDate,
  currency: Schema.String.check(Schema.isPattern(/^[A-Z]{3}$/)),
  currencyScale: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 6 })),
  ruleReleaseId: Accounting.Identifier,
  ruleReleaseChecksum: Accounting.Digest,
  ruleReleaseVersion: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 10000 })),
  companyActivationId: Schema.NullOr(Accounting.Identifier),
  familyMembershipEpoch: Schema.NullOr(Accounting.MinorUnits),
  factRevisionIds: Schema.Array(Accounting.Identifier).check(Schema.isMaxLength(40)),
  factReviewIds: Schema.Array(Accounting.Identifier).check(Schema.isMaxLength(40)),
  roleBindingIds: Schema.Array(Accounting.Identifier).check(Schema.isMaxLength(20)),
  evidenceIds: Schema.Array(Accounting.Identifier).check(Schema.isMinLength(1)),
  calculatorVersion: Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9._-]{2,127}$/)),
  // A basis is only ever recorded complete. A missing qualified input is refused
  // by the calculation, so a partial coverage is never frozen and reported as
  // one.
  sourceCoverage: Schema.Literals(["complete"]),
  reviewedInput: PreparePayRun,
});

export const PayrollFrozenCalculation = Schema.Struct({
  owner: Schema.Literal("payroll_calculation"),
  calculatorVersion: Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9._-]{2,127}$/)),
  employeeId: Accounting.Identifier,
  earningsPeriod: EarningsPeriod,
  expectedPaymentOn: Accounting.AccountingDate,
  currency: Schema.String.check(Schema.isPattern(/^[A-Z]{3}$/)),
  currencyScale: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 6 })),
  grossMinor: Accounting.MinorUnits,
  cashReimbursementMinor: Accounting.MinorUnits,
  withholdingBaseMinor: Accounting.MinorUnits,
  withholdingMinor: Accounting.MinorUnits,
  netDeductionMinor: Accounting.MinorUnits,
  contributionBaseMinor: Accounting.MinorUnits,
  employerContributionMinor: Accounting.MinorUnits,
  payableMinor: Accounting.MinorUnits,
  priorContributionBaseMinor: Accounting.MinorUnits,
  benefitBases: Schema.Array(PayrollBenefitBasis),
  extraAccruals: Schema.Array(PayrollAccrualComponent),
  formulaRows: Schema.Array(FormulaStep).check(Schema.isMinLength(1)),
  roundingResiduals: Schema.Array(FormulaStep).check(Schema.isMinLength(1)),
});

export const PayrollCalculationInputRef = Schema.Struct({
  kind: Schema.Literals([
    "employment_revision",
    "work_revision",
    "opening_revision",
    "prior_frozen_calculation",
    "rule_release",
    "company_activation",
    "company_fact_revision",
    "company_fact_review",
    "company_role_binding",
    "evidence",
  ]),
  resourceId: Accounting.Identifier,
  version: Accounting.Identifier,
  reason: Accounting.Description,
});

// A frozen calculation has no financial effect. It posts no journal, pays no
// salary, makes no declaration and reserves no monthly contribution capacity.
export const PayrollCalculation = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  employeeId: Accounting.Identifier,
  changeSetId: Accounting.Identifier,
  planDigest: Accounting.Digest,
  basis: PayrollCalculationBasis,
  calculation: PayrollFrozenCalculation,
  inputRefs: Schema.Array(PayrollCalculationInputRef),
  noFinancialEffect: Schema.Literal(true),
  createdBy: Accounting.Identifier,
  createdAt: Schema.String,
  receipt: CommandReceipt,
});

export const PayrollCalculationPage = Schema.Struct({
  scope: Accounting.Scope,
  employeeId: Accounting.Identifier,
  items: Schema.Array(PayrollCalculation),
  next: Schema.NullOr(Accounting.Identifier),
});

const key = Accounting.IdempotencyHeaders.fields["idempotency-key"];

const scoped = { scope: Accounting.Scope };

export const PayrollCalculationCapabilities = {
  payroll_prepare_calculation: {
    description:
      "Freeze one regular salaried calculation for one employee and one earnings period from the current employment, work and opening records, under a reviewed payroll rule release. Withholding tables, contribution bands and holiday rules come only from that release; a missing qualified input is refused, never defaulted. It posts no journal, pays nothing, makes no declaration and reserves no contribution capacity.",
    input: Schema.Struct({ ...scoped, idempotencyKey: key, input: PreparePayRun }),
    output: PayrollCalculation,
    readOnly: false,
  },
  payroll_get_calculation: {
    description:
      "Read one immutable frozen calculation with the exact basis and formula lineage it was compiled from. The saved meaning never changes with later employee or rule data.",
    input: Schema.Struct({ ...scoped, calculationId: Accounting.Identifier }),
    output: PayrollCalculation,
    readOnly: true,
  },
  payroll_list_calculations: {
    description:
      "Page this employee's frozen calculations for one earnings period after an identifier. Follow next until null.",
    input: Schema.Struct({
      ...scoped,
      employeeId: Accounting.Identifier,
      after: Schema.optional(Accounting.Identifier),
    }),
    output: PayrollCalculationPage,
    readOnly: true,
  },
};

const root = "/v1/entities/:entityId/books/:bookId/payroll";

export const PayrollCalculationApi = HttpApiGroup.make("payrollCalculation")
  .add(
    HttpApiEndpoint.post("preparePayrollCalculation", `${root}/calculations`, {
      params: Accounting.Scope,
      headers: Accounting.IdempotencyHeaders,
      payload: PreparePayRun.annotate({ parseOptions: { onExcessProperty: "error" } }),
      success: PayrollCalculation,
      error: accountingErrors,
    }),
  )
  .add(
    HttpApiEndpoint.get("getPayrollCalculation", `${root}/calculations/:calculationId`, {
      params: Schema.Struct({
        ...Accounting.Scope.fields,
        calculationId: Accounting.Identifier,
      }),
      success: PayrollCalculation,
      error: accountingErrors,
    }),
  )
  .add(
    HttpApiEndpoint.get("listPayrollCalculations", `${root}/employees/:employeeId/calculations`, {
      params: Schema.Struct({
        ...Accounting.Scope.fields,
        employeeId: Accounting.Identifier,
      }),
      query: Schema.Struct({ after: Schema.optional(Accounting.Identifier) }),
      success: PayrollCalculationPage,
      error: accountingErrors,
    }),
  );
