import * as Schema from "effect/Schema";
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import { StatementFactRevisions } from "@open-erp/domain/statements";
import { accountingErrors as errors } from "./accounting-errors";
import * as Accounting from "./accounting";
import { CommandReceipt, EvidenceReference } from "./commerce";

// NEXT-22: the pre-close corporate income-tax bridge, the one current-tax effect
// and the INK2/SRU declaration lineage.
//
// Three deliverables live here and they never share a transaction or a table.
//
// 1. The **bridge** is a sealed pre-close proposal. It is a pure exact
//    calculation over a retained pre-tax population, reviewed tax adjustments, a
//    reviewed loss position and a reviewed rule release. It posts nothing,
//    consumes no loss right and has no financial effect.
// 2. The **current-tax effect** is the one financial effect. It posts only the
//    remaining delta between the sealed year target and what this owner already
//    recognised, and the sealed year target, the journal, the approval use, the
//    receipt and the counter commit together.
// 3. The **declaration lineage** is the INK2 semantic field set and the exact
//    SRU files. It is a report artifact and explicitly not a financial effect,
//    so it is never in the bridge journal transaction.
//
// No statutory rate, no reporting box, no field code, no header record, no
// encoding and no terminator is a default anywhere in this file. Every one of
// them is reviewed data carried by a `corporate_tax` rule release. A missing
// qualified input is an explicit refusal.

// The exact algorithm this packet's bridge implements. A reviewed corporate-tax
// rule release declares this version in order to be usable by it; a release
// that declares any other version is refused, never reinterpreted.
export const SupportedCalculatorVersion = "corporate-preclose-bridge-v1";

// The account roles the pre-close bridge needs. They are reviewed account role
// bindings resolved through the company admission owner, never accounts named by
// a request payload and never accounts inferred from a number or a label.
export const IncomeTaxRoleKind = Schema.Literals([
  "corporate_tax_expense",
  "corporate_tax_liability",
  "corporate_tax_other_expense",
]);

export type IncomeTaxRoleKind = typeof IncomeTaxRoleKind.Type;

export const IncomeTaxRole = Schema.Literals([
  "current_expense",
  "current_liability",
  "other_income_tax_expense",
]);

// An exact rate crosses the wire as canonical integer strings. It is never a
// JavaScript number and it is never an inferred percentage.
const RateNumerator = Schema.String.check(Schema.isPattern(/^[1-9][0-9]{0,37}$/u));

const RateDenominator = Schema.String.check(Schema.isPattern(/^[1-9][0-9]{0,18}$/u));

export const TaxExactRate = Schema.Struct({
  numerator: RateNumerator,
  denominator: RateDenominator,
});

export const TaxRoundingMode = Schema.Literals(["half_up", "half_even", "toward_zero", "floor"]);

export const TaxRounding = Schema.Struct({
  mode: TaxRoundingMode,
  // The declared unit of the produced value. A minor unit at scale 2 is öre; a
  // scale of 0 is whole currency units. The release states the unit, so a
  // rounding scale is never guessed from the book's currency.
  scale: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 6 })),
});

// An exact rational retained as formula lineage. The result is stored unreduced
// as a numerator/denominator pair so a reader can re-derive the exact division.
export const TaxExactValue = Schema.Struct({
  numerator: Schema.String.check(Schema.isPattern(/^-?(0|[1-9][0-9]{0,37})$/u)),
  denominator: Schema.String.check(Schema.isPattern(/^[1-9][0-9]{0,18}$/u)),
});

export const TaxFormulaStep = Schema.Struct({
  id: Accounting.Identifier,
  statement: Accounting.Description,
  exact: TaxExactValue,
  minor: Accounting.SignedMinorUnits,
  rounding: Schema.NullOr(TaxRounding),
});

export const TaxRowKind = Schema.Literals([
  "ledger_fiscal_ytd_result",
  "pretax_profit",
  "adjustment_total",
  "taxable_before_loss",
  "allowed_loss_offset",
  "taxable_income",
  "current_tax",
  "other_income_tax_expense",
  "income_tax_expense_addback",
  "projected_after_tax_result",
  "closing_loss_basis",
  "recognized_current_tax",
]);

// A refused calculation keeps its own reason. It maps onto the existing public
// error family; it never renames a supported error.
export const TaxRefusalCode = Schema.Literals([
  "UnsupportedCalculatorVersion",
  "IncomeTaxRoleMissing",
  "DuplicateIncomeTaxAccount",
  "IncomeTaxTransferOverlap",
  "ForeignIncomeTaxComponent",
  "RepeatedIncomeTaxComponent",
  "IncomeTaxEffectMismatch",
  "OtherIncomeTaxExpenseUnsupported",
  "OtherIncomeTaxExpenseMismatch",
  "DuplicateEconomicComponent",
  "UnsupportedLossTreatment",
  "NegativeLossAvailability",
  "NegativeCurrentTax",
  "NegativeRecognized",
  "DuplicateFieldCode",
  "UnknownFormId",
  "UnknownFieldSource",
  "MissingStatementRow",
  "UnknownStatementRow",
  "DeclaredResultConflict",
  "DeclaredResultMissing",
  "SubmitterIdentityMissing",
  "UnsafeValue",
  "FieldValueTooLong",
  "FieldNotInSelectedForm",
  "FileTooLarge",
  "UnsupportedEncoding",
  "UnreconciledDeclaration",
  "StatementResultMismatch",
]);

export const TaxRefusal = Schema.Struct({
  code: TaxRefusalCode,
  message: Accounting.Description,
});

export const TaxBridgeRow = Schema.Struct({
  rowId: Accounting.Identifier,
  kind: TaxRowKind,
  label: Accounting.Description,
  valueMinor: Accounting.SignedMinorUnits,
  formulaIds: Schema.Array(Accounting.Identifier).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(8),
  ),
});

// The retained pre-tax population. Every figure is derived from the immutable
// statement snapshot named here and from the reviewed account role bindings, so
// the tax journal cannot change it.
export const IncomeTaxComponent = Schema.Struct({
  componentId: Accounting.Identifier,
  voucherId: Accounting.Identifier,
  lineId: Accounting.Identifier,
  sequence: Accounting.MinorUnits,
  accountId: Accounting.Identifier,
  debitMinor: Accounting.MinorUnits,
  creditMinor: Accounting.MinorUnits,
  signedMinor: Accounting.SignedMinorUnits,
  description: Accounting.Description,
});

export const IncomeTaxAccount = Schema.Struct({
  accountId: Accounting.Identifier,
  role: IncomeTaxRole,
  roleKind: IncomeTaxRoleKind,
  roleBindingId: Accounting.Identifier,
  accountVersion: Accounting.MinorUnits,
  evidence: Schema.Array(EvidenceReference).check(Schema.isMinLength(1), Schema.isMaxLength(20)),
  note: Accounting.Description,
});

// The statement snapshot already excludes owned mechanical result transfers from
// its retained profit-and-loss contributions, so the overlay discloses the roles
// and states plainly that the excluded amounts are not derivable from the
// retained snapshot. No amount is invented for them here.
export const MechanicalTransferExclusion = Schema.Struct({
  roles: Schema.Array(Schema.String).check(Schema.isMaxLength(2)),
  excludedFromRetainedContributions: Schema.Literal(true),
  amountRetainedInSnapshot: Schema.Literal(false),
});

export const PreTaxOverlay = Schema.Struct({
  statementSnapshotId: Accounting.Identifier,
  statementDigest: Accounting.Digest,
  fiscalYear: Schema.Struct({
    id: Accounting.Identifier,
    startsOn: Accounting.AccountingDate,
    endsOn: Accounting.AccountingDate,
  }),
  asOf: Accounting.AccountingDate,
  plInterval: Schema.Struct({
    startsOn: Accounting.AccountingDate,
    endsOn: Accounting.AccountingDate,
  }),
  ledgerBoundary: Accounting.MinorUnits,
  recordedCutoff: Schema.String,
  currency: Schema.String,
  currencyScale: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 6 })),
  // The retained profit-and-loss membership this figure was derived from. It is
  // the snapshot's own contribution count and fact revisions, not a live ledger
  // position, so revalidation compares the retained set.
  retainedContributionCount: Schema.Int,
  factRevisions: StatementFactRevisions,
  incomeTaxContributionDigest: Accounting.Digest,
  ledgerFiscalYtdProfitMinor: Accounting.SignedMinorUnits,
  incomeTaxAccounts: Schema.Array(IncomeTaxAccount).check(
    Schema.isMinLength(2),
    Schema.isMaxLength(20),
  ),
  incomeTaxComponents: Schema.Array(IncomeTaxComponent).check(Schema.isMaxLength(2000)),
  incomeTaxExpenseEffectMinor: Accounting.SignedMinorUnits,
  mechanicalTransferEffectsExcludedFromPL: MechanicalTransferExclusion,
  // The retained snapshot's own arithmetic result, reported as it is. A snapshot
  // that does not balance is never described as a complete capture.
  sourceCoverage: Schema.Literals(["arithmetic_passing_capture", "arithmetic_failing_capture"]),
  diagnostics: Schema.Array(Accounting.Description).check(Schema.isMaxLength(40)),
});

export const TaxAdjustmentKind = Schema.Literals([
  "nondeductible_expense",
  "nontaxable_income",
  "supported_schedule_adjustment",
]);

// A duplicate over one economic component is refused unless the reviewed release
// explicitly establishes the two adjustments as distinct and non-overlapping.
// The identity and both adjustment identities are named by the reviewer with
// retained evidence; nothing is inferred from an account number or a label.
export const TaxAdjustment = Schema.Struct({
  id: Accounting.Identifier,
  kind: TaxAdjustmentKind,
  signedTaxableAdjustmentMinor: Accounting.SignedMinorUnits,
  economicComponentIdentity: Accounting.Description,
  sourceContributionIds: Schema.Array(Accounting.Identifier).check(Schema.isMaxLength(200)),
  evidence: Schema.Array(EvidenceReference).check(Schema.isMinLength(1), Schema.isMaxLength(20)),
  ruleRelease: Schema.Literals(["reviewed_bridge_rule", "reviewed_schedule_rule"]),
  explanation: Accounting.Description,
});

export const ReviewedLossPosition = Schema.Union([
  Schema.Struct({
    state: Schema.Literal("evidenced_zero"),
    openingLossAvailableMinor: Schema.Literal("0"),
    consumedBeforeMinor: Schema.Literal("0"),
    ownershipOrRestrictionChangeObserved: Schema.Boolean,
    evidence: Schema.Array(EvidenceReference).check(Schema.isMinLength(1), Schema.isMaxLength(20)),
    note: Accounting.Description,
  }),
  Schema.Struct({
    state: Schema.Literal("supported"),
    openingLossAvailableMinor: Accounting.MinorUnits,
    consumedBeforeMinor: Accounting.MinorUnits,
    ownershipOrRestrictionChangeObserved: Schema.Boolean,
    evidence: Schema.Array(EvidenceReference).check(Schema.isMinLength(1), Schema.isMaxLength(20)),
    note: Accounting.Description,
  }),
]).check(
  Schema.makeFilter((position) => {
    const issues: Array<Schema.FilterIssue> = [];

    if (BigInt(position.consumedBeforeMinor) > BigInt(position.openingLossAvailableMinor)) {
      issues.push({
        path: ["consumedBeforeMinor"],
        issue: "A loss position cannot have consumed more than it opened with.",
      });
    }

    return issues;
  }),
);

export const LossBasis = Schema.Struct({
  position: ReviewedLossPosition,
  // A draft bridge never adopts a loss right. The final selected year and its
  // financial certificate own the adopted movement, so competing drafts cannot
  // consume the same opening allowance twice.
  adopted: Schema.Literal(false),
  adoptionOwner: Schema.Literal("financial_close_certificate"),
  closingLossBasisMinor: Schema.NullOr(Accounting.SignedMinorUnits),
  closingLossBasisAvailable: Schema.Boolean,
});

export const OtherIncomeTaxExpenseSupport = Schema.Union([
  Schema.Struct({
    state: Schema.Literal("evidenced_zero"),
    evidence: Schema.Array(EvidenceReference).check(Schema.isMinLength(1), Schema.isMaxLength(20)),
    note: Accounting.Description,
  }),
  Schema.Struct({
    state: Schema.Literal("supported"),
    evidence: Schema.Array(EvidenceReference).check(Schema.isMinLength(1), Schema.isMaxLength(20)),
    note: Accounting.Description,
  }),
]);

export const TaxBridgeStatus = Schema.Literals([
  "draft",
  "effect_pending",
  "fully_recognized",
  "blocked",
]);

// The exact admission identity this bridge was sealed against, retained in the
// bridge so execution can re-resolve the credential, session, membership, entity
// and book and compare the whole witness rather than one cached permission.
export const TaxAdmissionWitness = Schema.Struct({
  family: Schema.Literal("corporate_tax"),
  selectorDate: Accounting.AccountingDate,
  jurisdiction: Schema.String.check(Schema.isPattern(/^[A-Z]{2}$/u)),
  ruleReleaseId: Accounting.Identifier,
  ruleReleaseChecksum: Accounting.Digest,
  factRevisionIds: Schema.Array(Accounting.Identifier).check(Schema.isMaxLength(40)),
  factReviewIds: Schema.Array(Accounting.Identifier).check(Schema.isMaxLength(40)),
  roleBindingIds: Schema.Array(Accounting.Identifier).check(Schema.isMaxLength(20)),
  activationId: Schema.NullOr(Accounting.Identifier),
});

export const TaxBridge = Schema.Struct({
  kind: Schema.Literal("preclose_corporate_tax_bridge_v1"),
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  changeSetId: Accounting.Identifier,
  fiscalYearId: Accounting.Identifier,
  accountingPeriodId: Accounting.Identifier,
  overlayDigest: Accounting.Digest,
  overlay: PreTaxOverlay,
  admissionWitness: TaxAdmissionWitness,
  adjustments: Schema.Array(TaxAdjustment).check(Schema.isMaxLength(200)),
  adjustmentTotalMinor: Accounting.SignedMinorUnits,
  lossBasis: LossBasis,
  otherSupportedIncomeTaxExpense: OtherIncomeTaxExpenseSupport,
  rows: Schema.Array(TaxBridgeRow).check(Schema.isMinLength(1), Schema.isMaxLength(40)),
  formula: Schema.Array(TaxFormulaStep).check(Schema.isMinLength(1), Schema.isMaxLength(80)),
  taxableBeforeLossMinor: Accounting.SignedMinorUnits,
  allowedLossOffsetMinor: Accounting.SignedMinorUnits,
  taxableIncomeMinor: Accounting.SignedMinorUnits,
  currentTaxTargetMinor: Accounting.AggregateMinorUnits,
  projectedAfterTaxResultMinor: Accounting.SignedMinorUnits,
  recognizedCurrentTaxMinor: Accounting.SignedMinorUnits,
  remainingCurrentTaxDeltaMinor: Accounting.SignedMinorUnits,
  // The reviewed journal series and the exact delta this sealed bridge would
  // post. A zero delta is an explicit no-effect plan, never a zero voucher.
  journalSeries: Schema.String.check(Schema.isPattern(/^[A-Z0-9]{1,16}$/u)),
  postsJournal: Schema.Boolean,
  mappingRelease: Schema.Struct({
    id: Accounting.Identifier,
    checksum: Accounting.Digest,
    version: Schema.Int,
    calculatorVersion: Schema.String,
  }),
  fieldLineage: Schema.Array(Accounting.Identifier).check(Schema.isMaxLength(200)),
  status: TaxBridgeStatus,
  digest: Accounting.Digest,
  createdBy: Accounting.Identifier,
  createdAt: Schema.String,
  noFinancialEffect: Schema.Literal(true),
  receipt: CommandReceipt,
});

export const CorporateTaxEffect = Schema.Struct({
  kind: Schema.Literal("current_income_tax_effect_v1"),
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  bridgeId: Accounting.Identifier,
  bridgeDigest: Accounting.Digest,
  changeSetId: Accounting.Identifier,
  fiscalYearId: Accounting.Identifier,
  statementSnapshotId: Accounting.Identifier,
  statementDigest: Accounting.Digest,
  mappingReleaseId: Accounting.Identifier,
  mappingReleaseChecksum: Accounting.Digest,
  yearTaxTargetMinor: Accounting.AggregateMinorUnits,
  recognizedBeforeMinor: Accounting.AggregateMinorUnits,
  deltaMinor: Accounting.SignedMinorUnits,
  recognizedAfterMinor: Accounting.AggregateMinorUnits,
  voucherId: Schema.NullOr(Accounting.Identifier),
  postingReceipt: Schema.NullOr(Accounting.ExecutionReceipt),
  approvalId: Accounting.Identifier,
  groupReceiptId: Accounting.Identifier,
  noFinancialEffect: Schema.Boolean,
  economicIdentity: Accounting.Description,
  committedAt: Schema.String,
  digest: Accounting.Digest,
  createdBy: Accounting.Identifier,
  receipt: CommandReceipt,
});

// A sealed bridge is never rewritten, so what is still outstanding against its
// year target is reported separately from the sealed bridge itself.
export const TaxBridgeProgress = Schema.Struct({
  checkedAt: Schema.String,
  effectsForYear: Schema.Int,
  recognizedTotalMinor: Accounting.AggregateMinorUnits,
  outstandingMinor: Accounting.SignedMinorUnits,
  fullyRecognized: Schema.Boolean,
});

export const TaxBridgeView = Schema.Struct({
  bridge: TaxBridge,
  progress: TaxBridgeProgress,
  effects: Schema.Array(CorporateTaxEffect).check(Schema.isMaxLength(200)),
});

export const PrepareTaxBridge = Schema.Struct({
  fiscalYearId: Accounting.Identifier,
  statementSnapshotId: Accounting.Identifier,
  // The exact reviewed adjustments for this fiscal year. Each carries its own
  // retained evidence and its own economic component identity.
  adjustments: Schema.Array(TaxAdjustment).check(Schema.isMaxLength(200)),
  lossPosition: ReviewedLossPosition,
  otherIncomeTaxExpense: OtherIncomeTaxExpenseSupport,
  explanation: Accounting.Description,
});

// A current-tax effect is always approved: the year target and the exact delta
// are sealed before execution, and a different key cannot authorize a second
// posting of the same economic event.
export const ExecuteTaxEffect = Schema.Struct({
  bridgeDigest: Accounting.Digest,
  approvalId: Accounting.Identifier,
});

// The declaration lineage. It is an immutable report artifact: it names the
// exact statement snapshot, bridge and form release it was derived from and it
// carries no journal, voucher number or approval use.

// A typed source selector. Every literal names one exact retained bridge row or
// one named row of the immutable statement snapshot. The declared accounting
// result is not one of them: it is the form's starting value, not a mapped field.
export const FieldSource = Schema.Literals([
  "pretax_profit",
  "adjustment_total",
  "taxable_before_loss",
  "allowed_loss_offset",
  "taxable_income",
  "current_tax",
  "other_income_tax_expense",
  "income_tax_expense_addback",
  "projected_after_tax_result",
  "recognized_current_tax",
  "ledger_fiscal_ytd_result",
  "statement_row",
]);

export const FieldSign = Schema.Literals([1, -1]);

// A field carries an exact amount. Identity, name and date values belong to the
// reviewed info records of the SRU bundle, not to a calculated field, so no
// text-valued field is representable here and none is invented.
export const ValueFormat = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("integer_minor") }),
  Schema.Struct({
    kind: Schema.Literal("scaled_integer"),
    // The declared unit of the produced value, counted in the book's minor-unit
    // scale. A scale of 0 is the whole currency unit.
    scale: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 6 })),
    rounding: TaxRounding,
  }),
]);

// One reviewed mapping. The value is a typed source selector plus an allowed
// sign, unit and rounding transformation. Nothing is inferred from an account
// number, a label or a description.
export const FieldMapping = Schema.Struct({
  fieldCode: Schema.String.check(Schema.isPattern(/^[A-Za-z0-9]{1,32}$/u)),
  label: Accounting.Description,
  formId: Schema.String.check(Schema.isPattern(/^[A-Za-z0-9]{1,32}$/u)),
  source: FieldSource,
  statementRowId: Schema.NullOr(Accounting.Identifier),
  sign: FieldSign,
  format: ValueFormat,
  required: Schema.Boolean,
});

// A reviewed statement row selector. Naming it keeps the reviewed mapping from
// inventing a row identity that the retained snapshot does not hold.
export const NonOverlappingAdjustment = Schema.Struct({
  economicComponentIdentity: Accounting.Description,
  firstAdjustmentId: Accounting.Identifier,
  secondAdjustmentId: Accounting.Identifier,
});

export const SruRecord = Schema.Struct({
  tag: Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_]{1,32}$/u)),
  value: Schema.String.check(Schema.isMaxLength(2000)),
});

export const SruForm = Schema.Struct({
  formId: Schema.String.check(Schema.isPattern(/^[A-Za-z0-9]{1,32}$/u)),
  fieldCodes: Schema.Array(Schema.String.check(Schema.isPattern(/^[A-Za-z0-9]{1,32}$/u))).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(400),
  ),
  terminator: Schema.String.check(Schema.isMaxLength(64)),
});

export const SruFormatBundle = Schema.Struct({
  // The concrete encoding is reviewed data. An unsupported encoding token is a
  // refusal, never a substitution.
  encoding: Schema.Literals(["iso-8859-1", "cp437", "utf-8"]),
  lineEnding: Schema.Literals(["crlf", "lf"]),
  recordNameValueSeparator: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(8)),
  fieldValueSeparator: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(8)),
  blankLetterRecord: Schema.Literal("#BLANKETT"),
  uppgiftRecord: Schema.Literal("#UPPGIFT"),
  infoFile: Schema.Struct({
    filename: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64)),
    records: Schema.Array(SruRecord).check(Schema.isMinLength(1), Schema.isMaxLength(40)),
    terminator: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64)),
  }),
  blanketLetterFile: Schema.Struct({
    filename: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64)),
    forms: Schema.Array(SruForm).check(Schema.isMinLength(1), Schema.isMaxLength(40)),
    fileTerminator: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64)),
  }),
  maximumFileBytes: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1048576 })),
  maximumFieldValueLength: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 4000 })),
  sourceReference: Accounting.Description,
});

// The reviewed corporate-tax rule-release section. It is the one rule-release
// authority: this content lives inside the existing `rule_releases` owner and
// not in a second release table.
export const CorporateTaxRuleRelease = Schema.Struct({
  calculatorVersion: Schema.Literal(SupportedCalculatorVersion),
  bridge: Schema.Struct({
    rate: TaxExactRate,
    currentTaxRounding: TaxRounding,
    taxableBaseRounding: TaxRounding,
    lossProfile: Schema.Literals(["no_special_restrictions", "restricted_or_ownership_changed"]),
    // The reviewed voucher series this owner's current-tax accrual posts into.
    // A series is configuration, so it is a reviewed input and never a default.
    journalSeries: Schema.String.check(Schema.isPattern(/^[A-Z0-9]{1,16}$/u)),
    nonOverlappingAdjustments: Schema.Array(NonOverlappingAdjustment).check(Schema.isMaxLength(50)),
    rateSourceReference: Accounting.Description,
  }),
  declaration: Schema.Struct({
    formVersion: Accounting.Description,
    // The exact release-specific form identifiers. These are never guessed from
    // a form name.
    formIds: Schema.Array(Schema.String.check(Schema.isPattern(/^[A-Za-z0-9]{1,32}$/u))).check(
      Schema.isMinLength(1),
      Schema.isMaxLength(40),
    ),
    fieldMap: Schema.Array(FieldMapping).check(Schema.isMinLength(1), Schema.isMaxLength(2000)),
    // The sources a declaration must carry for its taxable basis to reconcile to
    // the bridge. A missing one blocks the declaration instead of leaving a
    // partial form.
    requiredReconciliationSources: Schema.Array(FieldSource).check(
      Schema.isMinLength(1),
      Schema.isMaxLength(12),
    ),
    submitter: Schema.Struct({
      submitterRole: Schema.Literals(["declarant", "delegate"]),
      declarantId: Schema.NullOr(Accounting.Identifier),
      contactName: Accounting.Description,
      contactEmail: Accounting.Description,
      contactPhone: Accounting.Description,
    }),
    fieldMapChecksum: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/u)),
  }),
  sru: SruFormatBundle,
});

export const PreparedIncomeTaxField = Schema.Struct({
  ordinal: Schema.Int,
  fieldCode: Schema.String.check(Schema.isPattern(/^[A-Za-z0-9]{1,32}$/u)),
  formId: Schema.String.check(Schema.isPattern(/^[A-Za-z0-9]{1,32}$/u)),
  label: Accounting.Description,
  source: FieldSource,
  statementRowId: Schema.NullOr(Accounting.Identifier),
  sign: FieldSign,
  format: ValueFormat,
  required: Schema.Boolean,
  valueMinor: Accounting.SignedMinorUnits,
  formulaIds: Schema.Array(Accounting.Identifier).check(Schema.isMaxLength(8)),
});

export const DeclarationReconciliation = Schema.Struct({
  declaredResultMinor: Accounting.SignedMinorUnits,
  incomeTaxExpenseAddbackMinor: Accounting.SignedMinorUnits,
  adjustmentTotalMinor: Accounting.SignedMinorUnits,
  allowedLossOffsetMinor: Accounting.SignedMinorUnits,
  formTaxableBeforeLossMinor: Accounting.SignedMinorUnits,
  formTaxableIncomeMinor: Accounting.SignedMinorUnits,
  bridgeTaxableBeforeLossMinor: Accounting.SignedMinorUnits,
  bridgeTaxableIncomeMinor: Accounting.SignedMinorUnits,
  reconciles: Schema.Boolean,
  formulaIds: Schema.Array(Accounting.Identifier).check(Schema.isMaxLength(12)),
});

export const SruFileManifest = Schema.Struct({
  kind: Schema.Literals(["info", "blanket_letter"]),
  filename: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64)),
  encoding: Schema.Literals(["iso-8859-1", "cp437", "utf-8"]),
  mediaType: Schema.Literal("application/octet-stream"),
  byteLength: Schema.Int,
  sha256: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/u)),
  recordCount: Schema.Int,
  fieldCount: Schema.Int,
  contentBase64: Schema.String,
  sealedAt: Schema.String,
  // An internal re-parse of the exact produced bytes. It is not a destination
  // acceptance and never a filing or a signature.
  validation: Schema.Struct({
    checkedBy: Schema.Literal("independent_sru_reparse_v1"),
    lexicallyValid: Schema.Boolean,
    recordsReparsed: Schema.Int,
    fieldsReparsed: Schema.Int,
    crossFieldTotalsCompared: Schema.Int,
    fieldTypesCompared: Schema.Int,
    destinationAcceptance: Schema.Literal("not_established"),
  }),
});

export const DeclaredResultSource = Schema.Literals([
  "ledger_statement_result",
  "projected_bridge_result",
]);

export const CorporateTaxDeclaration = Schema.Struct({
  kind: Schema.Literal("income_tax_declaration_v1"),
  id: Accounting.Identifier,
  ordinal: Accounting.MinorUnits,
  scope: Accounting.Scope,
  bridgeId: Accounting.Identifier,
  bridgeDigest: Accounting.Digest,
  statementSnapshotId: Accounting.Identifier,
  statementDigest: Accounting.Digest,
  fiscalYear: Schema.Struct({
    id: Accounting.Identifier,
    startsOn: Accounting.AccountingDate,
    endsOn: Accounting.AccountingDate,
  }),
  asOf: Accounting.AccountingDate,
  mappingRelease: Schema.Struct({
    id: Accounting.Identifier,
    checksum: Accounting.Digest,
    version: Schema.Int,
    calculatorVersion: Schema.String,
  }),
  formRelease: Schema.Struct({
    formVersion: Accounting.Description,
    formIds: Schema.Array(Schema.String).check(Schema.isMaxLength(40)),
    fieldMapChecksum: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/u)),
  }),
  declaredResultSource: DeclaredResultSource,
  fields: Schema.Array(PreparedIncomeTaxField).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(2000),
  ),
  reconciliation: DeclarationReconciliation,
  blocked: Schema.Boolean,
  blockReasons: Schema.Array(Accounting.Description).check(Schema.isMaxLength(20)),
  files: Schema.Array(SruFileManifest).check(Schema.isMaxLength(2)),
  // The lineage is a report artifact. It is never a financial effect.
  noFinancialEffect: Schema.Literal(true),
  digest: Accounting.Digest,
  createdBy: Accounting.Identifier,
  createdAt: Schema.String,
  receipt: CommandReceipt,
});

export const CorporateTaxBridgePage = Schema.Struct({
  scope: Accounting.Scope,
  fiscalYearId: Accounting.Identifier,
  items: Schema.Array(TaxBridge).check(Schema.isMaxLength(25)),
  next: Schema.NullOr(Accounting.Identifier),
});

export const CorporateTaxDeclarationPage = Schema.Struct({
  scope: Accounting.Scope,
  fiscalYearId: Accounting.Identifier,
  items: Schema.Array(CorporateTaxDeclaration).check(Schema.isMaxLength(25)),
  next: Schema.NullOr(Accounting.Identifier),
});

export const CorporateTaxEffectPage = Schema.Struct({
  scope: Accounting.Scope,
  fiscalYearId: Accounting.Identifier,
  recognizedTotalMinor: Accounting.AggregateMinorUnits,
  items: Schema.Array(CorporateTaxEffect).check(Schema.isMaxLength(200)),
});

export const PrepareTaxDeclaration = Schema.Struct({
  bridgeId: Accounting.Identifier,
  declaredResultSource: DeclaredResultSource,
});

export const CorporateTaxCapabilities = {
  tax_prepare_bridge: {
    description:
      "Seal a pre-close corporate income-tax bridge over one immutable statement snapshot, the reviewed account role bindings, reviewed tax adjustments, a reviewed loss position and a reviewed corporate-tax rule release. It posts nothing, consumes no loss right and has no financial effect. A missing rate, rounding policy, series, mapping, field code, encoding or terminator is an explicit refusal, never a default.",
    input: Schema.Struct({
      scope: Accounting.Scope,
      idempotencyKey: Accounting.IdempotencyHeaders.fields["idempotency-key"],
      input: PrepareTaxBridge,
    }),
    output: TaxBridgeView,
    readOnly: false,
  },
  tax_get_bridge: {
    description:
      "Read one sealed pre-close tax bridge and the current-tax effects this owner already recognised for its fiscal year. A sealed bridge keeps its captured meaning; later activity creates a new one.",
    input: Schema.Struct({ scope: Accounting.Scope, bridgeId: Accounting.Identifier }),
    output: TaxBridgeView,
    readOnly: true,
  },
  tax_list_bridges: {
    description:
      "Rediscover sealed pre-close tax bridges for one fiscal year. This is a live inventory of proposals, never a statement of completeness, a filing state or a Swedish compliance claim.",
    input: Schema.Struct({
      scope: Accounting.Scope,
      fiscalYearId: Accounting.Identifier,
      after: Schema.optional(Accounting.Identifier),
    }),
    output: CorporateTaxBridgePage,
    readOnly: true,
  },
  tax_execute_effect: {
    description:
      "Recognise the remaining current income-tax delta for a sealed bridge in one book-scoped transaction that commits the journal, the sealed year target, the approval use, the receipt and the counter together. Only the delta is posted: an already recognised target posts nothing and returns a no-effect receipt. Preliminary tax paid to a tax account is never subtracted from the target, and a changed pre-tax population, loss fact or release since sealing refuses instead of re-deriving a different amount.",
    input: Schema.Struct({
      scope: Accounting.Scope,
      idempotencyKey: Accounting.IdempotencyHeaders.fields["idempotency-key"],
      bridgeId: Accounting.Identifier,
      input: ExecuteTaxEffect,
    }),
    output: CorporateTaxEffect,
    readOnly: false,
  },
  tax_list_effects: {
    description:
      "Rediscover the recognised current income-tax effects for one fiscal year and the exact amount still outstanding against the sealed targets.",
    input: Schema.Struct({
      scope: Accounting.Scope,
      fiscalYearId: Accounting.Identifier,
      after: Schema.optional(Accounting.Identifier),
    }),
    output: CorporateTaxEffectPage,
    readOnly: true,
  },
  tax_prepare_declaration: {
    description:
      "Derive the reviewed INK2 semantic fields from one sealed bridge and one immutable statement result, require the declared taxable basis to reconcile to the bridge, retain the exact lineage, and render and independently re-parse the reviewed SRU files outside every transaction. The lineage is a report artifact with no financial effect; it is never a signature, a filing, a destination acceptance or a statutory claim.",
    input: Schema.Struct({
      scope: Accounting.Scope,
      idempotencyKey: Accounting.IdempotencyHeaders.fields["idempotency-key"],
      input: PrepareTaxDeclaration,
    }),
    output: CorporateTaxDeclaration,
    readOnly: false,
  },
  tax_get_declaration: {
    description:
      "Read one retained income-tax declaration lineage and the exact retained SRU bytes. A repeated read returns the retained bytes, never a newly rendered file.",
    input: Schema.Struct({ scope: Accounting.Scope, declarationId: Accounting.Identifier }),
    output: CorporateTaxDeclaration,
    readOnly: true,
  },
  tax_list_declarations: {
    description:
      "Rediscover retained income-tax declaration lineages for one fiscal year. A lineage summary never implies a rendered file, a filed return or an accepted destination.",
    input: Schema.Struct({
      scope: Accounting.Scope,
      fiscalYearId: Accounting.Identifier,
      after: Schema.optional(Accounting.Identifier),
    }),
    output: CorporateTaxDeclarationPage,
    readOnly: true,
  },
};

const scoped = { params: Accounting.Scope, error: errors };

const identified = { params: Accounting.ChangePath, error: errors };

const base = "/v1/entities/:entityId/books/:bookId/corporate-tax";

export const CorporateTaxApi = HttpApiGroup.make("corporateTax").add(
  HttpApiEndpoint.post("prepareTaxBridge", `${base}/bridges`, {
    ...scoped,
    headers: Accounting.IdempotencyHeaders,
    payload: PrepareTaxBridge.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: TaxBridgeView,
  }),
  HttpApiEndpoint.get("getTaxBridge", `${base}/bridges/:id`, {
    ...identified,
    success: TaxBridgeView,
  }),
  HttpApiEndpoint.get("listTaxBridges", `${base}/bridges`, {
    ...scoped,
    query: Schema.Struct({
      fiscalYearId: Accounting.Identifier,
      after: Schema.optional(Accounting.Identifier),
    }),
    success: CorporateTaxBridgePage,
  }),
  HttpApiEndpoint.post("executeTaxEffect", `${base}/bridges/:id/effects`, {
    ...identified,
    headers: Accounting.IdempotencyHeaders,
    payload: ExecuteTaxEffect.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: CorporateTaxEffect,
  }),
  HttpApiEndpoint.get("listTaxEffects", `${base}/effects`, {
    ...scoped,
    query: Schema.Struct({
      fiscalYearId: Accounting.Identifier,
      after: Schema.optional(Accounting.Identifier),
    }),
    success: CorporateTaxEffectPage,
  }),
  HttpApiEndpoint.post("prepareTaxDeclaration", `${base}/declarations`, {
    ...scoped,
    headers: Accounting.IdempotencyHeaders,
    payload: PrepareTaxDeclaration.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: CorporateTaxDeclaration,
  }),
  HttpApiEndpoint.get("getTaxDeclaration", `${base}/declarations/:id`, {
    ...identified,
    success: CorporateTaxDeclaration,
  }),
  HttpApiEndpoint.get("listTaxDeclarations", `${base}/declarations`, {
    ...scoped,
    query: Schema.Struct({
      fiscalYearId: Accounting.Identifier,
      after: Schema.optional(Accounting.Identifier),
    }),
    success: CorporateTaxDeclarationPage,
  }),
);
