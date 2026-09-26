import * as Accounting from "@open-erp/contracts/accounting";
import * as Payroll from "@open-erp/contracts/payroll-calculations";
import * as Effect from "effect/Effect";
import { failure } from "../failures";

// The exact regular-payroll calculator. It reads no database, starts no runtime
// and trusts no caller-supplied calculated effect: every rate, table row, band,
// per-event amount and holiday rule comes from the reviewed payroll rule release,
// and the reviewed input supplies only qualified source facts.
//
// A missing qualified input is an explicit refusal. It is never a zero, a
// default rate, a default table row, or a silently reduced withholding.

export type Basis = typeof Payroll.PayrollCalculationBasis.Type;

export type Frozen = typeof Payroll.PayrollFrozenCalculation.Type;

export type Release = typeof Payroll.PayrollRuleRelease.Type;

type Rounding = typeof Payroll.PayrollRounding.Type;

type Band = typeof Payroll.ContributionBand.Type;

type ObligationProfile = typeof Payroll.ObligationProfile.Type;

type ObligationInput = typeof Payroll.ObligationApplicability.Type;

type ObligationSelection = Extract<ObligationInput, { state: "applicable" }>["selection"];

type Step = typeof Payroll.FormulaStep.Type;

type Exact = { readonly n: bigint; readonly d: bigint };

// Every wire minor unit and every rate component is a canonical integer string,
// so it becomes bigint without passing through a JavaScript number.
export function toExactInteger(value: string) {
  return BigInt(value);
}

function greatestCommonDivisor(left: bigint, right: bigint): bigint {
  let a = left < 0n ? -left : left;
  let b = right < 0n ? -right : right;

  while (b !== 0n) {
    const next = a % b;
    a = b;
    b = next;
  }

  return a === 0n ? 1n : a;
}

export function reduce(numerator: bigint, denominator: bigint): Exact {
  if (denominator === 0n) return { n: 0n, d: 1n };

  if (denominator < 0n) return reduce(-numerator, -denominator);

  const divisor = greatestCommonDivisor(numerator, denominator);

  return { n: numerator / divisor, d: denominator / divisor };
}

function addExact(left: Exact, right: Exact): Exact {
  return reduce(left.n * right.d + right.n * left.d, left.d * right.d);
}

function multiplyByRate(amount: bigint, rate: typeof Payroll.ExactRate.Type): Exact {
  return reduce(amount * toExactInteger(rate.numerator), toExactInteger(rate.denominator));
}

// Nearest with ties away from zero, plus the three other qualified modes. A mode
// this calculator does not implement is a refusal, never a silent half-up.
export function roundExact(value: Exact, mode: Rounding["mode"]): bigint {
  const { n, d } = value;
  const negative = n < 0n;
  const magnitude = negative ? -n : n;
  const quotient = magnitude / d;
  const remainder = magnitude % d;
  const doubled = 2n * remainder;

  let result: bigint;

  if (mode === "toward_zero") {
    result = quotient;
  } else if (mode === "floor") {
    result = negative && remainder !== 0n ? quotient + 1n : quotient;
  } else if (mode === "half_up") {
    result = quotient + (doubled >= d ? 1n : 0n);
  } else {
    result = quotient + (doubled > d || (doubled === d && quotient % 2n === 1n) ? 1n : 0n);
  }

  return negative ? -result : result;
}

// One rounding decision over the exact rational, at the component's scale. The
// retained residual is what the decision discarded, so nothing is plugged.
export function roundRationalToMinor(value: Exact, policy: Rounding) {
  const denominator = value.d * 10n ** BigInt(policy.scale);
  const rounded = roundExact({ n: value.n, d: denominator }, policy.mode);

  return { rounded, residual: value.n - rounded * denominator };
}

export function roundMinor(amount: bigint, policy: Rounding) {
  return roundRationalToMinor({ n: amount, d: 1n }, policy).rounded;
}

function bandAmount(base: bigint, band: Band): Exact {
  const lower = toExactInteger(band.lowerMinor);
  const ceiling = band.upperMinor === null ? base : toExactInteger(band.upperMinor);
  const upper = ceiling < base ? ceiling : base;

  return upper <= lower ? { n: 0n, d: 1n } : multiplyByRate(upper - lower, band.rate);
}

export function exactTieredTotal(bands: ReadonlyArray<Band>, base: bigint) {
  return bands.reduce<Exact>((total, band) => addExact(total, bandAmount(base, band)), {
    n: 0n,
    d: 1n,
  });
}

// Bands must tile from zero to infinity with no gap and no overlap. A gap would
// contribute nothing over a range of bases without saying so, so it is refused.
export function bandsAreContiguous(bands: ReadonlyArray<Band>) {
  const ordered = [...bands].sort((left, right) =>
    toExactInteger(left.lowerMinor) < toExactInteger(right.lowerMinor) ? -1 : 1,
  );

  let expected = 0n;
  let bounded = true;

  for (const band of ordered) {
    if (toExactInteger(band.lowerMinor) !== expected) return false;

    if (band.upperMinor === null) {
      bounded = false;
      continue;
    }

    const upper = toExactInteger(band.upperMinor);

    if (upper <= expected) return false;

    expected = upper;
  }

  return !bounded;
}

function recorded(id: string, statement: string, value: Exact, policy: Rounding): Step {
  const decision = roundRationalToMinor(value, policy);

  return {
    step: id,
    statement,
    numerator: value.n.toString(),
    denominator: value.d.toString(),
    roundedMinor: decision.rounded.toString(),
    residualNumerator: decision.residual.toString(),
  };
}

function whole(id: string, statement: string, amount: bigint): Step {
  return {
    step: id,
    statement,
    numerator: amount.toString(),
    denominator: "1",
    roundedMinor: amount.toString(),
    residualNumerator: "0",
  };
}

type Resolved = { readonly profile: ObligationProfile; readonly selection: ObligationSelection };

// A person reference alone is not enough to infer age or status eligibility, and
// an obligation that is unknown is blocked rather than treated as absent.
function resolveObligation(
  release: Release,
  input: ObligationInput,
): Resolved | "not_applicable" | "refused" {
  if (input.state === "unknown") return "refused";

  if (input.state === "evidenced_not_applicable") return "not_applicable";

  const matches = release.obligationProfiles.filter(
    (row) => row.profileId === input.selection.profileId,
  );

  const profile = matches[0];

  if (matches.length !== 1 || profile === undefined) return "refused";

  if (!profile.eligibleStatusClasses.includes(input.selection.statusClass)) return "refused";

  if (input.selection.ageOnPaymentOn < (profile.minimumAgeOnPaymentOn ?? 0)) return "refused";

  if (
    profile.maximumAgeOnPaymentOn !== null &&
    input.selection.ageOnPaymentOn > profile.maximumAgeOnPaymentOn
  ) {
    return "refused";
  }

  if (profile.obligationReference !== input.selection.obligationReference) return "refused";

  if (!bandsAreContiguous(profile.bands)) return "refused";

  return { profile, selection: input.selection };
}

function only<T>(rows: ReadonlyArray<T>) {
  return rows.length === 1 ? rows[0] : undefined;
}

type Refusal = "UnsupportedProfile" | "InvalidJournal";

type BenefitOutcome =
  | {
      readonly ok: true;
      readonly rows: Array<typeof Payroll.PayrollBenefitBasis.Type>;
      readonly withholding: bigint;
      readonly contribution: bigint;
    }
  | { readonly ok: false; readonly refusal: Refusal };

function benefitBases(release: Release, basis: Basis): BenefitOutcome {
  const employment = basis.reviewedInput.employment;
  const ids = new Set(employment.benefitComponents.map((row) => row.componentId));
  const reductions = new Map<string, bigint>();

  for (const deduction of employment.deductionComponents) {
    if (!release.supportedDeductionRoleKinds.includes(deduction.destinationRole)) {
      return { ok: false, refusal: "UnsupportedProfile" };
    }

    const target = deduction.reducesBenefit;

    if (target === null) continue;

    // A deduction may only reduce a benefit that exists in this calculation.
    if (!ids.has(target.componentId)) return { ok: false, refusal: "InvalidJournal" };

    reductions.set(
      target.componentId,
      (reductions.get(target.componentId) ?? 0n) + toExactInteger(target.minor),
    );
  }

  const rows: Array<typeof Payroll.PayrollBenefitBasis.Type> = [];
  let withholding = 0n;
  let contribution = 0n;

  for (const component of employment.benefitComponents) {
    if (component.costRecognition === "unsupported") {
      return { ok: false, refusal: "UnsupportedProfile" };
    }

    // A benefit kind the release does not map has no qualified base treatment.
    const mapping = only(
      release.benefitBaseMappings.filter((row) => row.benefitKind === component.benefitKind),
    );

    if (mapping === undefined) return { ok: false, refusal: "UnsupportedProfile" };

    const reduced = reductions.get(component.componentId) ?? 0n;
    const declared = toExactInteger(component.withholdingBaseMinor);

    const base =
      mapping.withholdingBase === "declared_amount" && declared > reduced ? declared - reduced : 0n;

    withholding += base;
    contribution +=
      mapping.contributionBase === "declared_amount"
        ? toExactInteger(component.contributionBaseMinor)
        : 0n;

    rows.push({
      componentId: component.componentId,
      benefitKind: component.benefitKind,
      cashMinor: component.cashMinor,
      withholdingBaseMinor: base.toString(),
      contributionBaseMinor:
        mapping.contributionBase === "declared_amount" ? component.contributionBaseMinor : "0",
      costRecognition: component.costRecognition,
    });
  }

  return { ok: true, rows, withholding, contribution };
}

function withholdingFor(release: Release, basis: Basis, withholdingBase: bigint, policy: Rounding) {
  const selection = basis.reviewedInput.employment.withholding;
  const rule = only(release.withholdingRules.filter((row) => row.ruleId === selection.ruleId));

  // A missing withholding decision, table or percentage is a refusal. It is
  // never replaced by a default percentage and never reduced to available cash.
  if (rule === undefined) return null;

  // The published monthly table is stated in the book's own minor unit.
  if (rule.frequency !== "monthly") return null;

  if (rule.kind === "fixed_amount") {
    return {
      minor: roundMinor(toExactInteger(rule.amountMinor), policy),
      step: whole(
        "withholding",
        `Reviewed fixed withholding decision ${rule.ruleId} for this pay event`,
        roundMinor(toExactInteger(rule.amountMinor), policy),
      ),
    };
  }

  if (rule.kind === "approved_percentage") {
    const value = multiplyByRate(withholdingBase, rule.rate);

    const step = recorded(
      "withholding",
      `Approved percentage ${rule.ruleId} applied to the withholding base`,
      value,
      { ...policy, mode: rule.rounding.mode },
    );

    return { minor: toExactInteger(step.roundedMinor), step };
  }

  // A table in another unit is a refusal, not a silent rescale.
  if (rule.baseRounding.scale !== basis.currencyScale) return null;

  if (selection.tableColumn !== rule.column) return null;

  const row = only(
    rule.rows.filter(
      (candidate) =>
        withholdingBase >= toExactInteger(candidate.lowerMinor) &&
        withholdingBase <= toExactInteger(candidate.upperMinor),
    ),
  );

  if (row === undefined) return null;

  const minor = roundMinor(toExactInteger(row.amountMinor), policy);

  return {
    minor,
    step: whole(
      "withholding",
      `Published table ${rule.tableId} column ${rule.column}, row ${row.lowerMinor} to ${row.upperMinor}`,
      minor,
    ),
  };
}

export const calculateRegularPayroll = (
  basis: Basis,
  release: Release,
): Effect.Effect<Frozen, Accounting.AccountingError> =>
  Effect.gen(function* () {
    const employment = basis.reviewedInput.employment;
    const work = basis.reviewedInput.work;
    const rounding = release.roundingByComponent;

    if (release.calculatorVersion !== Payroll.SupportedCalculatorVersion) {
      return yield* failure("UnsupportedProfile");
    }

    if (release.cashProrationPolicy !== "none") return yield* failure("UnsupportedProfile");

    if (!release.supportedWorkPatterns.includes(employment.workPattern)) {
      return yield* failure("UnsupportedProfile");
    }

    // The compiled calculator implements no proration and no reduced band for an
    // irregular period. An absence blocks the run; it is never paid in full.
    if (work.absence.length > 0) return yield* failure("UnsupportedProfile");

    if (work.earningsPeriod.startsOn > work.expectedPaymentOn) {
      return yield* failure("InvalidJournal");
    }

    if (work.earningsPeriod.endsOn > work.expectedPaymentOn) {
      return yield* failure("InvalidJournal");
    }

    const adjustments = [...employment.grossAdjustments, ...work.adjustments];

    const declaredGross =
      toExactInteger(employment.monthlyCashSalary) +
      adjustments.reduce((total, row) => total + toExactInteger(row.minor), 0n);

    if (declaredGross < 0n) return yield* failure("InvalidJournal");

    const gross = roundMinor(declaredGross, rounding.gross);

    const reimbursements = [...employment.reimbursements, ...work.reimbursements];

    const reimbursement = roundMinor(
      reimbursements.reduce((total, row) => total + toExactInteger(row.minor), 0n),
      rounding.reimbursement,
    );

    const benefits = benefitBases(release, basis);

    if (!benefits.ok) return yield* failure(benefits.refusal);

    const netDeductions = roundMinor(
      employment.deductionComponents.reduce((total, row) => total + toExactInteger(row.minor), 0n),
      rounding.netDeduction,
    );

    const withholdingBase = gross + benefits.withholding;
    const resolved = withholdingFor(release, basis, withholdingBase, rounding.withholding);

    if (resolved === null) return yield* failure("UnsupportedProfile");

    if (resolved.minor < 0n) return yield* failure("InvalidJournal");

    const contributionBase = gross + benefits.contribution;

    const formulaRows: Array<Step> = [
      whole("gross", "Monthly cash salary after qualified gross adjustments", gross),
      whole("reimbursement", "Supported non-taxable cash reimbursements", reimbursement),
      whole("net_deduction", "Post-tax net deductions with a reviewed destination", netDeductions),
      whole("withholding_base", "Gross cash earnings plus taxable benefit bases", withholdingBase),
      resolved.step,
    ];

    const obligationInputs = [employment.holidayPolicy, ...employment.pensionAndOtherObligations];
    const employer: Array<Resolved> = [];
    const accruals: Array<Resolved> = [];

    for (const input of obligationInputs) {
      const outcome = resolveObligation(release, input);

      if (outcome === "not_applicable") continue;

      if (outcome === "refused") return yield* failure("UnsupportedProfile");

      if (outcome.profile.obligationKind === "employer_contribution") {
        employer.push(outcome);
        continue;
      }

      accruals.push(outcome);
    }

    let contribution = 0n;
    let priorBase = 0n;

    if (employer.length === 1) {
      const profile = employer[0]?.profile;

      if (profile === undefined) return yield* failure("UnsupportedProfile");

      // A contribution threshold belongs to its own statutory aggregation
      // period. This calculator resolves one monthly schedule only.
      if (profile.aggregationPeriod !== "per_calendar_month") {
        return yield* failure("UnsupportedProfile");
      }

      priorBase =
        toExactInteger(basis.openingBaseMinor) + toExactInteger(basis.priorFrozenBaseMinor);

      // F(prior + new) - F(prior) is the marginal this pay event adds, so a
      // monthly reduced band is granted once and not once per run.
      const beforeExact = exactTieredTotal(profile.bands, priorBase);
      const afterExact = exactTieredTotal(profile.bands, priorBase + contributionBase);

      contribution =
        roundRationalToMinor(afterExact, profile.rounding).rounded -
        roundRationalToMinor(beforeExact, profile.rounding).rounded;

      formulaRows.push(
        whole(
          "contribution_base",
          "Gross cash earnings plus contribution benefit bases",
          contributionBase,
        ),
        recorded(
          "employer_contribution",
          `F(${priorBase + contributionBase}) minus F(${priorBase}) over ${profile.profileId}`,
          reduce(
            afterExact.n * beforeExact.d - beforeExact.n * afterExact.d,
            afterExact.d * beforeExact.d,
          ),
          profile.rounding,
        ),
      );
    } else if (employer.length > 1) {
      // Two applicable employer contributions need a separate qualified policy.
      return yield* failure("UnsupportedProfile");
    }

    const payable = roundMinor(
      gross + reimbursement - resolved.minor - netDeductions,
      rounding.payable,
    );

    if (payable < 0n) return yield* failure("InvalidJournal");

    const extraAccruals: Array<typeof Payroll.PayrollAccrualComponent.Type> = [];

    for (const entry of accruals) {
      const profile = entry.profile;

      const declared = only(
        release.accrualProfiles.filter((row) => row.obligationProfileId === profile.profileId),
      );

      if (declared === undefined) return yield* failure("UnsupportedProfile");

      if (declared.accrual.kind === "none") continue;

      const onContributionBase =
        declared.accrual.kind === "percentage_of_qualifying_base" &&
        declared.accrual.base === "gross_cash_plus_contribution_benefits";

      const qualifying = onContributionBase ? gross + benefits.contribution : gross;

      const value =
        declared.accrual.kind === "percentage_of_qualifying_base"
          ? multiplyByRate(qualifying, declared.accrual.rate)
          : { n: toExactInteger(declared.accrual.amountMinor), d: 1n };

      const step = recorded(
        "accrual",
        `Accrual for ${profile.profileId} on its qualified base`,
        value,
        declared.rounding,
      );

      formulaRows.push(step);

      extraAccruals.push({
        componentId: declared.componentId,
        obligationKind: profile.obligationKind,
        profileId: profile.profileId,
        obligationReference: profile.obligationReference,
        baseMinor: qualifying.toString(),
        minor: step.roundedMinor,
        rounding: declared.rounding,
      });
    }

    const roundingResiduals = formulaRows.filter((row) => row.residualNumerator !== "0");

    if (roundingResiduals.length === 0) {
      roundingResiduals.push(
        whole("no_residual", "No component rounding residual was produced", 0n),
      );
    }

    return {
      owner: "payroll_calculation",
      calculatorVersion: release.calculatorVersion,
      employeeId: basis.employeeId,
      earningsPeriod: work.earningsPeriod,
      expectedPaymentOn: work.expectedPaymentOn,
      currency: basis.currency,
      currencyScale: basis.currencyScale,
      grossMinor: gross.toString(),
      cashReimbursementMinor: reimbursement.toString(),
      withholdingBaseMinor: withholdingBase.toString(),
      withholdingMinor: resolved.minor.toString(),
      netDeductionMinor: netDeductions.toString(),
      contributionBaseMinor: contributionBase.toString(),
      employerContributionMinor: contribution.toString(),
      payableMinor: payable.toString(),
      priorContributionBaseMinor: priorBase.toString(),
      benefitBases: benefits.rows,
      extraAccruals,
      formulaRows,
      roundingResiduals,
    } satisfies Frozen;
  });
