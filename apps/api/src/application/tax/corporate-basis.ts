import * as Tax from "@open-erp/contracts/corporate-tax";
import * as Result from "effect/Result";

// The exact pre-close corporate income-tax bridge, the reviewed declaration field
// mapping and the reviewed SRU record writer.
//
// Nothing here reads a database, starts a runtime, calls a network service or
// trusts a caller-supplied calculated effect. Every rate, rounding policy, loss
// profile, journal series, field code, header record, separator, encoding and
// terminator comes from a reviewed corporate-tax rule release or from a reviewed
// input. A missing qualified input is a refusal.
//
// No statutory rate, reporting box, calendar or destination rule is embedded
// here. A release that declares a different calculator version is refused rather
// than reinterpreted, and nothing here asserts Swedish tax or VAT compliance.

export type Release = typeof Tax.CorporateTaxRuleRelease.Type;

export type Overlay = typeof Tax.PreTaxOverlay.Type;

export type Adjustment = typeof Tax.TaxAdjustment.Type;

export type LossPosition = typeof Tax.ReviewedLossPosition.Type;

export type Bridge = typeof Tax.TaxBridge.Type;

export type Row = typeof Tax.TaxBridgeRow.Type;

export type Step = typeof Tax.TaxFormulaStep.Type;

export type Field = typeof Tax.PreparedIncomeTaxField.Type;

export type Bundle = typeof Tax.SruFormatBundle.Type;

export type Refusal = typeof Tax.TaxRefusal.Type;

export type RowKind = typeof Tax.TaxRowKind.Type;

export type FieldSource = typeof Tax.FieldSource.Type;

type Rounding = typeof Tax.TaxRounding.Type;

type Mapping = typeof Tax.FieldMapping.Type;

type Exact = { readonly n: bigint; readonly d: bigint };

// Every wire amount and every rate component is a canonical integer string, so it
// becomes a bigint without ever passing through a JavaScript number.
const integer = (value: string) => BigInt(value);

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

// C1. Signed, ties away from zero for half_up, ties to even for half_even, toward
// zero for toward_zero and a real floor for floor. A bound failure is a refusal,
// not a truncation and not a saturation.
export function roundRational(value: Exact, mode: Rounding["mode"]): bigint {
  if (value.d <= 0n) return value.n;

  const negative = value.n < 0n;
  const numerator = negative ? -value.n : value.n;
  const quotient = numerator / value.d;
  const remainder = numerator % value.d;

  if (mode === "floor") return negative ? -(quotient + (remainder === 0n ? 0n : 1n)) : quotient;

  let rounded = quotient;

  if (mode === "half_up") {
    if (2n * remainder >= value.d) rounded = quotient + 1n;
  } else if (mode === "half_even") {
    if (2n * remainder > value.d || (2n * remainder === value.d && quotient % 2n === 1n)) {
      rounded = quotient + 1n;
    }
  }

  return negative ? -rounded : rounded;
}

// One exact rescale, rounded once at the destination unit. A destination coarser
// than the source divides; a finer one multiplies and needs no rounding. The
// division and the rate multiplication are never rounded separately, so no
// intermediate residual is lost.
export function rescale(value: Exact, from: number, to: number, mode: Rounding["mode"]): bigint {
  if (to === from) return roundRational(value, mode);

  if (to > from) return roundRational(reduce(value.n * 10n ** BigInt(to - from), value.d), mode);

  return roundRational({ n: value.n, d: value.d * 10n ** BigInt(from - to) }, mode);
}

function fail<A>(code: Refusal["code"], message: string): Result.Result<A, Refusal> {
  return Result.fail({ code, message });
}

function step(id: string, statement: string, value: Exact, policy: Rounding | null): Step {
  return {
    id,
    statement,
    exact: { numerator: value.n.toString(), denominator: value.d.toString() },
    minor: roundRational(value, policy?.mode ?? "toward_zero").toString(),
    rounding: policy,
  };
}

function row(
  rowId: string,
  kind: RowKind,
  label: string,
  value: bigint,
  formulaIds: ReadonlyArray<string>,
) {
  return { rowId, kind, label, valueMinor: value.toString(), formulaIds: [...formulaIds] };
}

export type BridgeCalculation = {
  readonly pretaxProfitMinor: bigint;
  readonly adjustmentTotalMinor: bigint;
  readonly taxableBeforeLossMinor: bigint;
  readonly allowedLossOffsetMinor: bigint;
  readonly taxableIncomeMinor: bigint;
  readonly currentTaxMinor: bigint;
  readonly otherIncomeTaxExpenseMinor: bigint;
  readonly incomeTaxExpenseAddbackMinor: bigint;
  readonly projectedAfterTaxResultMinor: bigint;
  readonly closingLossBasisMinor: bigint | null;
  readonly rows: ReadonlyArray<Row>;
  readonly formula: ReadonlyArray<Step>;
};

// A duplicate over one economic component is refused unless the reviewed release
// explicitly establishes the two adjustments as distinct and non-overlapping. The
// release names the component identity and both adjustment identities, so a
// component description can never be compared against an adjustment identity.
function duplicateComponent(adjustments: ReadonlyArray<Adjustment>, release: Release) {
  const permitted = (identity: string, first: string, second: string) =>
    release.bridge.nonOverlappingAdjustments.some(
      (entry) =>
        entry.economicComponentIdentity === identity &&
        ((entry.firstAdjustmentId === first && entry.secondAdjustmentId === second) ||
          (entry.firstAdjustmentId === second && entry.secondAdjustmentId === first)),
    );

  const seen = new Map<string, string>();

  for (const adjustment of adjustments) {
    const previous = seen.get(adjustment.economicComponentIdentity);

    if (previous === undefined) {
      seen.set(adjustment.economicComponentIdentity, adjustment.id);
      continue;
    }

    if (previous === adjustment.id) return adjustment;

    if (!permitted(adjustment.economicComponentIdentity, previous, adjustment.id))
      return adjustment;
  }

  return null;
}

type AccountRefusal = "role" | "calculator" | "duplicate_account" | "transfer_overlap" | "scale";

// The income-tax accounts are the reviewed exclusion set resolved from the
// company admission owner's account role bindings. A current expense account and
// a current liability account are each required exactly once, every account is
// distinct, and none of them may also be a mechanical transfer role. That makes
// "excluded exactly once" structural rather than assumed.
function reviewAccounts(overlay: Overlay, release: Release): AccountRefusal | null {
  if (release.calculatorVersion !== Tax.SupportedCalculatorVersion) return "calculator";

  if (overlay.currencyScale < 0 || overlay.currencyScale > 6) return "scale";

  const expense = overlay.incomeTaxAccounts.filter((entry) => entry.role === "current_expense");
  const liability = overlay.incomeTaxAccounts.filter((entry) => entry.role === "current_liability");

  if (expense.length !== 1 || liability.length !== 1) return "role";

  const transfers = new Set(overlay.mechanicalTransferEffectsExcludedFromPL.roles);
  const declared = new Set<string>();

  for (const entry of overlay.incomeTaxAccounts) {
    if (declared.has(entry.accountId)) return "duplicate_account";

    if (transfers.has(entry.accountId)) return "transfer_overlap";

    declared.add(entry.accountId);
  }

  return null;
}

const accountRefusals = {
  role: {
    code: "IncomeTaxRoleMissing",
    message:
      "The reviewed income-tax accounts must name exactly one current expense account and exactly one current liability account.",
  },
  calculator: {
    code: "UnsupportedCalculatorVersion",
    message: "The reviewed release declares a different calculator version.",
  },
  duplicate_account: {
    code: "DuplicateIncomeTaxAccount",
    message: "A reviewed income-tax account is declared more than once.",
  },
  transfer_overlap: {
    code: "IncomeTaxTransferOverlap",
    message:
      "A reviewed income-tax account is also a mechanical result-transfer role, so it cannot be excluded exactly once.",
  },
  scale: {
    code: "IncomeTaxEffectMismatch",
    message: "The captured currency scale is not a usable minor unit.",
  },
} satisfies Record<AccountRefusal, Refusal>;

// The retained income-tax population splits by the reviewed account role. Only
// the current-expense role sits inside the profit and loss, so only it is added
// back; the other supported income-tax expense is a separate profit-and-loss
// expense that stays in the pre-tax result and is subtracted from the projected
// result. The current liability is a balance-sheet account, so its movements are
// not in this population at all and one appearing here is a refusal.
function incomeTaxEffect(overlay: Overlay) {
  const roles = new Map(overlay.incomeTaxAccounts.map((entry) => [entry.accountId, entry.role]));
  const seen = new Set<string>();
  let current = 0n;
  let other = 0n;

  for (const component of overlay.incomeTaxComponents) {
    const role = roles.get(component.accountId);

    if (role !== "current_expense" && role !== "other_income_tax_expense") {
      return { code: "foreign" as const, current: 0n, other: 0n };
    }

    if (seen.has(component.componentId))
      return { code: "repeated" as const, current: 0n, other: 0n };

    seen.add(component.componentId);

    const value = integer(component.signedMinor);

    if (role === "current_expense") current += value;
    else other += value;
  }

  return { code: null, current, other };
}

/**
 * calculateCorporateTax(overlay, adjustments, lossPosition, support, recognized, release)
 *
 * `recognized` is the exact sum of the current income-tax effects this owner has
 * already recognised for the same company and fiscal year, read by the caller
 * inside its own transaction. It is never taken from a payload and never derived
 * from a ledger sequence.
 */
export function calculateCorporateTax(
  overlay: Overlay,
  adjustments: ReadonlyArray<Adjustment>,
  lossPosition: LossPosition,
  support: typeof Tax.OtherIncomeTaxExpenseSupport.Type,
  recognized: bigint,
  release: Release,
): Result.Result<BridgeCalculation, Refusal> {
  if (recognized < 0n)
    return fail("NegativeRecognized", "Recognised current income tax cannot be negative.");

  const accounts = reviewAccounts(overlay, release);

  if (accounts !== null)
    return fail(accountRefusals[accounts].code, accountRefusals[accounts].message);

  const effect = incomeTaxEffect(overlay);

  if (effect.code === "foreign")
    return fail(
      "ForeignIncomeTaxComponent",
      "A retained component names an account outside the reviewed profit-and-loss income-tax set.",
    );

  if (effect.code === "repeated")
    return fail(
      "RepeatedIncomeTaxComponent",
      "A retained income-tax component appears more than once.",
    );

  if (effect.current !== integer(overlay.incomeTaxExpenseEffectMinor))
    return fail(
      "IncomeTaxEffectMismatch",
      "The captured income-tax effect does not equal the sum of its retained components.",
    );

  // The other supported income-tax expense must be evidenced and supported when
  // the retained population actually holds one, and an evidenced zero is only
  // accepted when it holds none. Neither direction is inferred.
  if (effect.other > 0n && support.state !== "supported")
    return fail(
      "OtherIncomeTaxExpenseUnsupported",
      "The retained income-tax population holds other supported income-tax expense, so it must be evidenced and supported rather than evidenced as zero.",
    );

  if (effect.other < 0n && support.state === "evidenced_zero")
    return fail(
      "OtherIncomeTaxExpenseMismatch",
      "The retained income-tax population holds a negative other income-tax expense, which an evidenced zero cannot cover.",
    );

  // The pre-tax result is the retained statement result with the whole current
  // income-tax expense added back exactly once. Posting a current-tax effect
  // therefore cannot change the pre-tax figure the tax is calculated from.
  const retained = integer(overlay.retainedStatementResultMinor);
  const pretax = retained + effect.current;
  const other = effect.other;

  const duplicate = duplicateComponent(adjustments, release);

  if (duplicate !== null)
    return fail(
      "DuplicateEconomicComponent",
      `Adjustment ${duplicate.id} covers an economic component another adjustment already covers, and the reviewed release does not establish the two as distinct and non-overlapping.`,
    );

  const opening = integer(lossPosition.openingLossAvailableMinor);
  const consumed = integer(lossPosition.consumedBeforeMinor);
  const available = opening - consumed;

  if (available < 0n)
    return fail(
      "NegativeLossAvailability",
      "The reviewed loss position has a negative remaining allowance.",
    );

  if (
    lossPosition.ownershipOrRestrictionChangeObserved &&
    release.bridge.lossProfile !== "no_special_restrictions"
  ) {
    return fail(
      "UnsupportedLossTreatment",
      "An ownership change or a loss restriction is observed and the reviewed release does not cover it, so no closing loss basis and no consumption can be stated.",
    );
  }

  const formula: Array<Step> = [
    step(
      "f_retained_result",
      "retainedStatementResult = the snapshot's retained untransferred fiscal-year result",
      { n: retained, d: 1n },
      null,
    ),
    step(
      "f_income_tax_effect",
      "incomeTaxExpenseEffect = sum of the retained current-expense component signed amounts",
      { n: effect.current, d: 1n },
      null,
    ),
    step(
      "f_pretax",
      "pretaxProfit = retainedStatementResult + incomeTaxExpenseEffect",
      { n: pretax, d: 1n },
      null,
    ),
    step(
      "f_recognized",
      "recognizedCurrentTax = sum of this owner's effective year deltas",
      { n: recognized, d: 1n },
      null,
    ),
    step(
      "f_other_income_tax",
      "otherIncomeTaxExpense = sum of the retained other income-tax expense component signed amounts",
      { n: other, d: 1n },
      null,
    ),
  ];

  const rows: Array<Row> = [
    row(
      "r_retained_result",
      "retained_statement_result",
      "Retained fiscal-year result after current income tax",
      retained,
      ["f_retained_result"],
    ),
    row(
      "r_income_tax_effect",
      "income_tax_expense_addback",
      "Current income-tax expense inside the retained result",
      effect.current,
      ["f_income_tax_effect"],
    ),
    row(
      "r_recognized",
      "recognized_current_tax",
      "Current income tax already recognised this year",
      recognized,
      ["f_recognized"],
    ),
    row(
      "r_other_income_tax",
      "other_income_tax_expense",
      "Other supported income-tax expense",
      other,
      ["f_other_income_tax"],
    ),
    row("r_pretax", "pretax_profit", "Pre-tax result for the pre-close bridge", pretax, [
      "f_pretax",
    ]),
  ];

  let adjustmentTotal = 0n;

  for (const entry of adjustments) adjustmentTotal += integer(entry.signedTaxableAdjustmentMinor);

  const beforeLoss = pretax + adjustmentTotal;

  formula.push(
    step(
      "f_adjustment_total",
      "adjustmentTotal = sum of every signed taxable adjustment",
      { n: adjustmentTotal, d: 1n },
      null,
    ),
  );
  formula.push(
    step(
      "f_taxable_before_loss",
      "taxableBeforeLoss = pretaxProfit + adjustmentTotal",
      {
        n: beforeLoss,
        d: 1n,
      },
      null,
    ),
  );

  rows.push(
    row("r_adjustment_total", "adjustment_total", "Reviewed taxable adjustments", adjustmentTotal, [
      "f_adjustment_total",
    ]),
  );
  rows.push(
    row(
      "r_taxable_before_loss",
      "taxable_before_loss",
      "Taxable result before any loss offset",
      beforeLoss,
      ["f_taxable_before_loss"],
    ),
  );

  // A negative taxable result never becomes a negative cash receivable: the offset
  // is bounded by the reviewed allowance and the taxable base is clamped at zero.
  const offset = beforeLoss > 0n ? (available < beforeLoss ? available : beforeLoss) : 0n;
  const taxableRaw = beforeLoss > offset ? beforeLoss - offset : 0n;
  const rate = release.bridge.rate;
  const basePolicy = release.bridge.taxableBaseRounding;
  const taxPolicy = release.bridge.currentTaxRounding;

  const base = rescale(
    { n: taxableRaw, d: 1n },
    overlay.currencyScale,
    basePolicy.scale,
    basePolicy.mode,
  );

  const currentTax = rescale(
    { n: base * integer(rate.numerator), d: integer(rate.denominator) },
    basePolicy.scale,
    taxPolicy.scale,
    taxPolicy.mode,
  );

  if (currentTax < 0n)
    return fail("NegativeCurrentTax", "A current income-tax target cannot be negative.");

  const addedThisYear = beforeLoss < 0n ? -beforeLoss : 0n;
  const projected = pretax - currentTax - other;
  const closingEligible = release.bridge.lossProfile === "no_special_restrictions";
  // The reviewed allowance available to this bridge is the opening position less
  // what was already consumed before it, and a draft never adopts a loss right.
  const closing = closingEligible ? available - offset + addedThisYear : null;

  formula.push(
    step(
      "f_loss_available",
      "lossAvailable = reviewedOpeningLoss - consumedBefore",
      { n: available, d: 1n },
      null,
    ),
  );
  formula.push(
    step(
      "f_allowed_offset",
      "allowedLossOffset = min(max(taxableBeforeLoss, 0), lossAvailable)",
      { n: offset, d: 1n },
      null,
    ),
  );
  formula.push(
    step(
      "f_taxable_raw",
      "taxableRaw = max(taxableBeforeLoss - allowedLossOffset, 0)",
      {
        n: taxableRaw,
        d: 1n,
      },
      null,
    ),
  );
  formula.push(
    step(
      "f_taxable_base",
      `taxableBase = taxableRaw rescaled to the reviewed base rounding (scale ${basePolicy.scale})`,
      { n: base, d: 1n },
      basePolicy,
    ),
  );
  formula.push(
    step(
      "f_current_tax",
      `currentTax = taxableBase * ${rate.numerator} / ${rate.denominator} rescaled to the reviewed current-tax rounding (scale ${taxPolicy.scale})`,
      { n: base * integer(rate.numerator), d: integer(rate.denominator) },
      taxPolicy,
    ),
  );
  formula.push(
    step(
      "f_projected_after_tax",
      "projectedAfterTaxResult = pretaxProfit - currentTax - otherIncomeTaxExpense",
      { n: projected, d: 1n },
      null,
    ),
  );

  if (closing !== null) {
    formula.push(
      step(
        "f_closing_loss",
        "closingLossBasis = reviewedLossAvailable - allowedLossOffset + max(-taxableBeforeLoss, 0)",
        { n: closing, d: 1n },
        null,
      ),
    );
  }

  rows.push(
    row(
      "r_allowed_offset",
      "allowed_loss_offset",
      "Loss offset allowed by the reviewed position",
      offset,
      ["f_loss_available", "f_allowed_offset"],
    ),
  );
  rows.push(
    row(
      "r_taxable_income",
      "taxable_income",
      "Taxable income for the pre-close calculation",
      base,
      ["f_taxable_raw", "f_taxable_base"],
    ),
  );
  rows.push(
    row("r_current_tax", "current_tax", "Current corporate income tax", currentTax, [
      "f_current_tax",
    ]),
  );
  rows.push(
    row(
      "r_projected_after_tax",
      "projected_after_tax_result",
      "Projected result after the current tax",
      projected,
      ["f_projected_after_tax"],
    ),
  );

  if (closing !== null) {
    rows.push(
      row(
        "r_closing_loss",
        "closing_loss_basis",
        "Closing loss basis for the qualified profile",
        closing,
        ["f_closing_loss"],
      ),
    );
  }

  return Result.succeed({
    pretaxProfitMinor: pretax,
    adjustmentTotalMinor: adjustmentTotal,
    taxableBeforeLossMinor: beforeLoss,
    allowedLossOffsetMinor: offset,
    taxableIncomeMinor: base,
    currentTaxMinor: currentTax,
    otherIncomeTaxExpenseMinor: other,
    incomeTaxExpenseAddbackMinor: effect.current,
    projectedAfterTaxResultMinor: projected,
    closingLossBasisMinor: closing,
    rows,
    formula,
  });
}

export function bridgeAmount(bridge: Bridge, kind: RowKind) {
  return integer(bridge.rows.find((entry) => entry.kind === kind)?.valueMinor ?? "0");
}

// A typed source selector names exactly one retained bridge row. A source with no
// matching row kind is a reviewed-mapping error, never a silently absent figure.
function sourceKind(source: FieldSource): RowKind | null {
  switch (source) {
    case "pretax_profit":
      return "pretax_profit";
    case "adjustment_total":
      return "adjustment_total";
    case "taxable_before_loss":
      return "taxable_before_loss";
    case "allowed_loss_offset":
      return "allowed_loss_offset";
    case "taxable_income":
      return "taxable_income";
    case "current_tax":
      return "current_tax";
    case "other_income_tax_expense":
      return "other_income_tax_expense";
    case "income_tax_expense_addback":
      return "income_tax_expense_addback";
    case "projected_after_tax_result":
      return "projected_after_tax_result";
    case "recognized_current_tax":
      return "recognized_current_tax";
    case "retained_statement_result":
      return "retained_statement_result";
    case "statement_row":
      return null;
  }
}

function readField(
  bridge: Bridge,
  mapping: Mapping,
  rows: ReadonlyMap<string, bigint>,
): Result.Result<bigint, Refusal> {
  if (mapping.source === "statement_row") {
    if (mapping.statementRowId === null)
      return fail(
        "MissingStatementRow",
        `Field ${mapping.fieldCode} selects a statement row and names none.`,
      );

    const value = rows.get(mapping.statementRowId);

    if (value === undefined)
      return fail(
        "UnknownStatementRow",
        `Field ${mapping.fieldCode} names a row the retained statement does not hold.`,
      );

    return Result.succeed(value);
  }

  const kind = sourceKind(mapping.source);

  if (kind === null)
    return fail("UnknownFieldSource", `Field ${mapping.fieldCode} names an unsupported source.`);

  const owner = bridge.rows.find((entry) => entry.kind === kind);

  if (owner === undefined)
    return fail("UnknownFieldSource", `The sealed bridge holds no row of kind ${kind}.`);

  return Result.succeed(integer(owner.valueMinor));
}

// A field's exact amount: the signed source value, rescaled once to the format the
// reviewed mapping declares. This never fails, so it returns the amount directly.
function fieldValue(bridge: Bridge, mapping: Mapping, signed: bigint) {
  if (mapping.format.kind === "integer_minor") return signed;

  return rescale(
    { n: signed, d: 1n },
    bridge.overlay.currencyScale,
    mapping.format.scale,
    mapping.format.rounding.mode,
  );
}

export type Declaration = {
  readonly fields: ReadonlyArray<Field>;
  readonly reconciliation: typeof Tax.DeclarationReconciliation.Type;
  readonly blockReasons: ReadonlyArray<string>;
};

// The five figures the declaration's own cross-field total is built from. They
// are the bridge's addback, adjustment, before-loss, offset and taxable income.
const reconciliationSources: ReadonlySet<FieldSource> = new Set([
  "income_tax_expense_addback",
  "current_tax",
  "adjustment_total",
  "taxable_before_loss",
  "allowed_loss_offset",
  "taxable_income",
]);

// Which current-tax figure the form has to add back depends on where its declared
// accounting result came from. A projected after-tax result already has the whole
// calculated current tax deducted from it, so the form adds that back. A retained
// ledger result only has the tax actually booked inside the retained population
// deducted from it, so the form adds that back instead. Using the wrong one would
// silently reconcile a form against a different basis than the engine used.
export function taxAddbackSource(source: typeof Tax.DeclaredResultSource.Type): FieldSource {
  return source === "projected_bridge_result" ? "current_tax" : "income_tax_expense_addback";
}

/**
 * prepareIncomeTaxFields(bridge, declaredResultSource, declaredResult, statementRows, release)
 *
 * The form receives the qualified financial-statement values, starts from that
 * declared accounting result, adds the current income-tax expense back under the
 * explicit reviewed mapping, includes every bridge adjustment exactly once, and
 * reconciles to the bridge's own taxable result. That is what keeps the engine and
 * the exported declaration on one starting result instead of two.
 */
export function prepareIncomeTaxFields(
  bridge: Bridge,
  source: typeof Tax.DeclaredResultSource.Type,
  declaredResult: bigint | null,
  statementRows: ReadonlyMap<string, bigint>,
  release: Release,
): Result.Result<Declaration, Refusal> {
  const declaration = release.declaration;

  // A real submitter or a real delegate is required. A delegate names the
  // declarant it acts for, so a delegate without one is a refusal.
  if (
    declaration.submitter.submitterRole === "delegate" &&
    declaration.submitter.declarantId === null
  ) {
    return fail(
      "SubmitterIdentityMissing",
      "A delegate submission must name the declarant it is submitted for.",
    );
  }

  const start =
    source === "projected_bridge_result"
      ? declaredResult === null
        ? Result.succeed(bridgeAmount(bridge, "projected_after_tax_result"))
        : fail<bigint>(
            "DeclaredResultConflict",
            "A projected declaration cannot also name a retained statement result.",
          )
      : declaredResult === null
        ? fail<bigint>(
            "DeclaredResultMissing",
            "A ledger declaration requires the retained statement result.",
          )
        : Result.succeed(declaredResult);

  if (Result.isFailure(start)) return fail(start.failure.code, start.failure.message);

  const blockReasons: Array<string> = [];
  const fields: Array<Field> = [];
  const declared = new Set<string>();
  const addbackSource = taxAddbackSource(source);

  for (const mapping of declaration.fieldMap) {
    const key = `${mapping.formId}/${mapping.fieldCode}`;

    if (declared.has(key))
      return fail(
        "DuplicateFieldCode",
        `Field ${key} is mapped more than once in the reviewed mapping.`,
      );

    if (!declaration.formIds.includes(mapping.formId))
      return fail(
        "UnknownFormId",
        `Field ${key} names a form the reviewed release does not select.`,
      );

    declared.add(key);

    const read = readField(bridge, mapping, statementRows);

    if (Result.isFailure(read)) {
      // A required field that cannot be read blocks the declaration. An optional
      // one is simply absent; it is never filled with a zero.
      if (mapping.required) return fail(read.failure.code, read.failure.message);

      continue;
    }

    const signed = read.success * BigInt(mapping.sign);
    const value = fieldValue(bridge, mapping, signed);

    const kind = mapping.source === "statement_row" ? null : sourceKind(mapping.source);
    const owner = kind === null ? undefined : bridge.rows.find((entry) => entry.kind === kind);

    fields.push({
      ordinal: fields.length + 1,
      fieldCode: mapping.fieldCode,
      formId: mapping.formId,
      label: mapping.label,
      source: mapping.source,
      statementRowId: mapping.statementRowId,
      sign: mapping.sign,
      format: mapping.format,
      required: mapping.required,
      valueMinor: value.toString(),
      formulaIds: owner?.formulaIds ?? [],
    });
  }

  for (const wanted of [addbackSource, ...declaration.requiredReconciliationSources]) {
    if (!fields.some((entry) => entry.required && entry.source === wanted)) {
      blockReasons.push(
        `The reviewed mapping carries no required reconciliation source for ${wanted}.`,
      );
    }
  }

  // The reconciling figures must stay in the book's own minor unit. A rescaled
  // reconciliation field would silently compare two different units, so it blocks
  // the declaration instead of being quietly accepted.
  for (const mapping of declaration.fieldMap) {
    if (!reconciliationSources.has(mapping.source)) continue;

    if (mapping.format.kind !== "integer_minor") {
      blockReasons.push(
        `Reconciliation field ${mapping.formId}/${mapping.fieldCode} must stay in the book's minor unit.`,
      );
    }
  }

  const addback = bridgeAmount(bridge, sourceKind(taxAddbackSource(source)) ?? "current_tax");
  const adjustments = bridgeAmount(bridge, "adjustment_total");
  const offset = bridgeAmount(bridge, "allowed_loss_offset");
  const formBeforeLoss = start.success + addback + adjustments;
  const formTaxable = formBeforeLoss > offset ? formBeforeLoss - offset : 0n;
  const bridgeBeforeLoss = bridgeAmount(bridge, "taxable_before_loss");
  const bridgeTaxable = bridgeAmount(bridge, "taxable_income");

  const reconciliation: typeof Tax.DeclarationReconciliation.Type = {
    declaredResultMinor: start.success.toString(),
    incomeTaxExpenseAddbackMinor: addback.toString(),
    adjustmentTotalMinor: adjustments.toString(),
    allowedLossOffsetMinor: offset.toString(),
    formTaxableBeforeLossMinor: formBeforeLoss.toString(),
    formTaxableIncomeMinor: formTaxable.toString(),
    bridgeTaxableBeforeLossMinor: bridgeBeforeLoss.toString(),
    bridgeTaxableIncomeMinor: bridgeTaxable.toString(),
    reconciles: formBeforeLoss === bridgeBeforeLoss && formTaxable === bridgeTaxable,
    formulaIds: [
      "f_pretax",
      "f_income_tax_effect",
      "f_adjustment_total",
      "f_allowed_offset",
      "f_taxable_base",
    ],
  };

  if (!reconciliation.reconciles) {
    blockReasons.push(
      `The declared form basis ${formTaxable.toString()} does not reconcile to the bridge's taxable income ${bridgeTaxable.toString()}.`,
    );
  }

  return Result.succeed({ fields, reconciliation, blockReasons });
}

// Every emitted value is ASCII, so each declared encoding below carries it as one
// byte. A value outside that set is a refusal, never a substitution.
const emittable = /^[0-9A-Za-z .,:;_+@\-/()'*#%]*$/u;

const signedInteger = /^-?(0|[1-9][0-9]*)$/u;

export type RenderedFile = {
  readonly kind: "info" | "blanket_letter";
  readonly filename: string;
  readonly encoding: Bundle["encoding"];
  readonly byteLength: number;
  readonly recordCount: number;
  readonly fieldCount: number;
  readonly text: string;
  readonly bytes: Uint8Array;
};

export type RenderedSru = {
  readonly files: ReadonlyArray<RenderedFile>;
  readonly fieldCount: number;
};

function emittableValue(value: string, maximum: number): Result.Result<string, Refusal> {
  if (value.length > maximum)
    return fail("FieldValueTooLong", "An emitted value exceeds the reviewed length bound.");

  if (!emittable.test(value))
    return fail("UnsafeValue", "An emitted value holds an unsupported character.");

  return Result.succeed(value);
}

// A marker is written directly in front of a separator, so a marker that itself
// holds a separator or a line ending would make the record impossible to split back
// apart. That conflict spans two reviewed fields, so it is checked here where both
// are known rather than expressed in the contract. A real reviewed marker such as a
// hash-led uppercase name passes; only a self-contradictory bundle is refused.
function usableMarker(
  marker: string,
  bundle: Bundle,
  name: string,
): Result.Result<string, Refusal> {
  const newline = bundle.lineEnding === "crlf" ? "\r\n" : "\n";

  if (!emittable.test(marker))
    return fail("UnsafeValue", `The reviewed ${name} marker holds an unsupported character.`);

  for (const separator of [bundle.recordNameValueSeparator, bundle.fieldValueSeparator]) {
    if (marker.includes(separator)) {
      return fail(
        "UnsafeValue",
        `The reviewed ${name} marker contains a separator it is written next to.`,
      );
    }
  }

  if (marker.includes("\n") || marker.includes("\r") || marker.includes(newline)) {
    return fail("UnsafeValue", `The reviewed ${name} marker contains a line break.`);
  }

  return Result.succeed(marker);
}

/**
 * renderSru(fields, bundle)
 *
 * Every record name, separator, encoding, terminator and filename comes from the
 * reviewed bundle. The two record markers the file-transfer contract names are
 * the only record kinds this writer knows; the grammar around them is data, and
 * the forms are emitted in the reviewed declared order. A required mapped field
 * the selected forms do not carry is a refusal, never a silently dropped field.
 */
export function renderSru(
  fields: ReadonlyArray<Field>,
  bundle: Bundle,
): Result.Result<RenderedSru, Refusal> {
  const newline = bundle.lineEnding === "crlf" ? "\r\n" : "\n";

  // Every marker is checked before anything is emitted, so a bundle that cannot be
  // written unambiguously produces no file at all.
  for (const [marker, name] of [
    [bundle.blankLetterRecord, "blank-letter record"],
    [bundle.uppgiftRecord, "field record"],
    [bundle.infoRecordPrefix, "info record prefix"],
  ] as const) {
    const usable = usableMarker(marker, bundle, name);

    if (Result.isFailure(usable)) return fail(usable.failure.code, usable.failure.message);
  }

  const present = new Map(
    fields.map((entry) => [`${entry.formId}/${entry.fieldCode}`, entry] as const),
  );

  const emitted = new Set<string>();
  const blanket: Array<string> = [];
  let fieldCount = 0;

  for (const form of bundle.blanketLetterFile.forms) {
    const identity = emittableValue(form.formId, bundle.maximumFieldValueLength);

    if (Result.isFailure(identity)) return fail(identity.failure.code, identity.failure.message);

    blanket.push(
      `${bundle.blankLetterRecord}${bundle.recordNameValueSeparator}${identity.success}`,
    );

    for (const code of form.fieldCodes) {
      const found = present.get(`${form.formId}/${code}`);

      if (found === undefined) continue;

      const value = emittableValue(found.valueMinor, bundle.maximumFieldValueLength);

      if (Result.isFailure(value)) return fail(value.failure.code, value.failure.message);

      if (!emittable.test(code))
        return fail("UnsafeValue", `Field ${code} holds an unsupported character.`);

      blanket.push(
        `${bundle.uppgiftRecord}${bundle.fieldValueSeparator}${code}${bundle.fieldValueSeparator}${value.success}`,
      );

      emitted.add(`${form.formId}/${code}`);
      fieldCount += 1;
    }

    const closed = emittableValue(form.terminator, bundle.maximumFieldValueLength);

    if (Result.isFailure(closed)) return fail(closed.failure.code, closed.failure.message);

    blanket.push(closed.success);
  }

  for (const entry of fields) {
    const key = `${entry.formId}/${entry.fieldCode}`;

    if (entry.required && !emitted.has(key)) {
      return fail(
        "FieldNotInSelectedForm",
        `Required field ${key} is not carried by any selected form in the reviewed bundle.`,
      );
    }
  }

  const end = emittableValue(
    bundle.blanketLetterFile.fileTerminator,
    bundle.maximumFieldValueLength,
  );

  if (Result.isFailure(end)) return fail(end.failure.code, end.failure.message);

  blanket.push(end.success);

  const info: Array<string> = [];

  for (const entry of bundle.infoFile.records) {
    const value = emittableValue(entry.value, bundle.maximumFieldValueLength);

    if (Result.isFailure(value)) return fail(value.failure.code, value.failure.message);

    info.push(
      `${bundle.infoRecordPrefix}${entry.tag}${bundle.recordNameValueSeparator}${value.success}`,
    );
  }

  const infoTerminator = emittableValue(bundle.infoFile.terminator, bundle.maximumFieldValueLength);

  if (Result.isFailure(infoTerminator))
    return fail(infoTerminator.failure.code, infoTerminator.failure.message);

  const infoText = `${info.join(newline)}${newline}${infoTerminator.success}${newline}`;

  if (infoText.length > bundle.maximumFileBytes)
    return fail("FileTooLarge", "The info file exceeds the reviewed size bound.");

  const blanketText = `${blanket.join(newline)}${newline}`;

  if (blanketText.length > bundle.maximumFileBytes)
    return fail("FileTooLarge", "The blanket-letter file exceeds the reviewed size bound.");

  const encoder = new TextEncoder();

  return Result.succeed({
    fieldCount,
    files: [
      {
        kind: "info",
        filename: bundle.infoFile.filename,
        encoding: bundle.encoding,
        byteLength: encoder.encode(infoText).length,
        recordCount: info.length + 1,
        fieldCount: 0,
        text: infoText,
        bytes: encoder.encode(infoText),
      },
      {
        kind: "blanket_letter",
        filename: bundle.blanketLetterFile.filename,
        encoding: bundle.encoding,
        byteLength: encoder.encode(blanketText).length,
        recordCount: blanket.length,
        fieldCount,
        text: blanketText,
        bytes: encoder.encode(blanketText),
      },
    ],
  });
}

export type Reparse = {
  readonly lexicallyValid: boolean;
  readonly records: number;
  readonly fields: number;
  readonly types: number;
  readonly crossFieldTotals: number;
  readonly values: ReadonlyMap<string, string>;
};

export type ExpectedField = {
  readonly key: string;
  readonly valueMinor: bigint;
};

const invalid: Reparse = {
  lexicallyValid: false,
  records: 0,
  fields: 0,
  types: 0,
  crossFieldTotals: 0,
  values: new Map(),
};

type Scan = {
  readonly records: number;
  readonly fields: number;
  readonly values: ReadonlyMap<string, string>;
};

type Expected = {
  readonly declaredResultMinor: bigint;
  readonly addbackKey: string;
  readonly adjustmentKey: string;
  readonly beforeLossKey: string;
  readonly offsetKey: string;
  readonly taxableKey: string;
  readonly fields: ReadonlyArray<ExpectedField>;
};

// The record structure is re-derived from the retained text without consulting the
// renderer: the terminator, the form markers, the field markers, the separators and
// the declared field type of every value all have to hold.
function scanRecords(file: RenderedFile, bundle: Bundle): Scan | null {
  const newline = bundle.lineEnding === "crlf" ? "\r\n" : "\n";

  const end =
    file.kind === "info" ? bundle.infoFile.terminator : bundle.blanketLetterFile.fileTerminator;

  const lines = file.text.split(newline);

  if (lines[lines.length - 1] !== "" || lines[lines.length - 2] !== end) return null;

  const body = lines.slice(0, lines.length - 2);

  const forms =
    file.kind === "blanket_letter"
      ? new Map(
          bundle.blanketLetterFile.forms.flatMap((form) =>
            form.fieldCodes.map((code) => [`${form.formId}/${code}`, true] as const),
          ),
        )
      : new Map<string, true>();

  const terminators = new Map(
    file.kind === "blanket_letter"
      ? bundle.blanketLetterFile.forms.map((form) => [form.formId, form.terminator] as const)
      : [],
  );

  const values = new Map<string, string>();
  let current = "";
  let fields = 0;

  for (const line of body) {
    if (line === "") return null;

    if (file.kind === "info") {
      if (
        !line.startsWith(bundle.infoRecordPrefix) ||
        !line.includes(bundle.recordNameValueSeparator)
      ) {
        return null;
      }

      continue;
    }

    if (line.startsWith(`${bundle.blankLetterRecord}${bundle.recordNameValueSeparator}`)) {
      if (current !== "") return null;

      current = line.slice(
        bundle.blankLetterRecord.length + bundle.recordNameValueSeparator.length,
      );

      if (current === "" || !emittable.test(current)) return null;

      if (!terminators.has(current)) return null;

      continue;
    }

    // The per-form terminator closes the form it follows. A field after it, or a
    // field with no open form, is a broken record rather than a tolerated one.
    if (current !== "" && line === terminators.get(current)) {
      current = "";

      continue;
    }

    if (current === "") return null;

    if (!line.startsWith(`${bundle.uppgiftRecord}${bundle.fieldValueSeparator}`)) return null;

    const parts = line
      .slice(bundle.uppgiftRecord.length + bundle.fieldValueSeparator.length)
      .split(bundle.fieldValueSeparator);

    if (parts.length !== 2) return null;

    const [code, value] = parts;

    if (code === undefined || value === undefined) return null;

    if (forms.get(`${current}/${code}`) !== true) return null;

    if (!signedInteger.test(value)) return null;

    values.set(`${current}/${code}`, value);
    fields += 1;
  }

  return { records: body.length, fields, values };
}

// The declaration's own cross-field total, recomputed only from the values recovered
// out of the produced bytes and the retained declared accounting result. It returns
// the number of totals it actually compared, so a retained manifest never claims a
// check it did not make.
function crossFieldTotal(values: ReadonlyMap<string, string>, expected: Expected) {
  const keys = [
    expected.addbackKey,
    expected.adjustmentKey,
    expected.beforeLossKey,
    expected.offsetKey,
    expected.taxableKey,
  ];

  // A reconciling figure the produced bytes do not carry cannot be checked, so it is
  // a failed check rather than a zero.
  if (keys.some((key) => !values.has(key))) return -1;

  const addback = integer(values.get(keys[0] ?? "") ?? "0");
  const adjustment = integer(values.get(keys[1] ?? "") ?? "0");
  const beforeLoss = integer(values.get(keys[2] ?? "") ?? "0");
  const offset = integer(values.get(keys[3] ?? "") ?? "0");
  const taxable = integer(values.get(keys[4] ?? "") ?? "0");

  if (beforeLoss !== expected.declaredResultMinor + addback + adjustment) return -1;

  const recomputed = beforeLoss - offset;

  return taxable === (recomputed > 0n ? recomputed : 0n) ? 2 : -1;
}

/**
 * reparseSru(file, bundle, expected)
 *
 * An independent lexical check of the produced bytes. It re-derives the record
 * structure and every field value from the retained text without consulting the
 * renderer, checks each recovered value against the exact value its prepared field
 * holds, and recomputes the declaration's own cross-field total from the recovered
 * values. It is a check of these exact bytes, never a destination acceptance and
 * never a filing.
 *
 * The info file carries no field values, so it gets the structural check only and
 * reports zero compared values and totals rather than claiming a comparison it
 * could not make.
 */
export function reparseSru(file: RenderedFile, bundle: Bundle, expected: Expected): Reparse {
  const scan = scanRecords(file, bundle);

  if (scan === null) return invalid;

  if (file.kind === "info") {
    return {
      lexicallyValid: true,
      records: scan.records,
      fields: 0,
      types: 0,
      crossFieldTotals: 0,
      values: scan.values,
    };
  }

  // Every recovered value must equal the exact value its prepared field holds, so a
  // renderer that emitted a different figure cannot be retained as a file.
  for (const entry of expected.fields) {
    const recovered = scan.values.get(entry.key);

    if (recovered === undefined || integer(recovered) !== entry.valueMinor) return invalid;
  }

  const compared = crossFieldTotal(scan.values, expected);

  if (compared < 0) return invalid;

  return {
    lexicallyValid: true,
    records: scan.records,
    fields: scan.fields,
    types: scan.fields,
    crossFieldTotals: compared,
    values: scan.values,
  };
}
