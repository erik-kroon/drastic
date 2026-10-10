import * as Schema from "effect/Schema";
import { AccountingDate, Digest, Identifier, isCalendarDate } from "./values";

export const BuilderVersion = Schema.Literal("treatment_consequence_v1");

const Share = Schema.Struct({ numerator: Schema.String, denominator: Schema.String });

const Placement = Schema.Literals(["balance_sheet", "income_statement"]);

const Classification = Schema.Literals(["asset", "liability", "equity", "income", "expense"]);

const Requirement = Schema.Literals(["required", "optional", "fixed"]);

const Assignment = Schema.Struct({
  code: Schema.String,
  revision: Schema.Int,
  valueCode: Schema.NullOr(Schema.String),
  valueRevision: Schema.NullOr(Schema.Int),
});

export const CapturedTreatment = Schema.Struct({
  accountId: Schema.NullOr(Identifier),
  originalCommitCutoff: Schema.String,
  postingOn: Schema.NullOr(AccountingDate),
  mapping: Schema.NullOr(
    Schema.Struct({
      checksum: Digest,
      applicableAtCutoff: Schema.String,
      accounts: Schema.Array(
        Schema.Struct({
          accountId: Identifier,
          classification: Classification,
          placement: Placement,
          statementLeaf: Schema.String,
        }),
      ),
    }),
  ),
  vat: Schema.Struct({
    category: Schema.NullOr(Schema.String),
    profileIdentity: Schema.NullOr(Digest),
    resolvedRate: Schema.NullOr(Share),
    deduction: Schema.NullOr(Share),
  }),
  period: Schema.Struct({
    id: Schema.NullOr(Identifier),
    startsOn: Schema.NullOr(AccountingDate),
    endsOn: Schema.NullOr(AccountingDate),
  }),
  dimensions: Schema.NullOr(
    Schema.Struct({
      requirements: Schema.NullOr(
        Schema.Array(
          Schema.Struct({
            code: Schema.String,
            revision: Schema.Int,
            requirement: Requirement,
            fixedValueCode: Schema.NullOr(Schema.String),
            fixedValueRevision: Schema.NullOr(Schema.Int),
          }),
        ),
      ),
      assignments: Schema.NullOr(Schema.Array(Assignment)),
    }),
  ),
});

export type CapturedTreatment = typeof CapturedTreatment.Type;

export const UnknownReason = Schema.Literals([
  "mapping_not_captured",
  "mapping_not_applicable",
  "invalid_mapping",
  "account_not_mapped",
  "vat_category_not_captured",
  "vat_profile_not_captured",
  "resolved_rate_not_captured",
  "invalid_resolved_rate",
  "deduction_not_captured",
  "invalid_deduction",
  "period_bounds_not_captured",
  "invalid_period",
  "posting_date_not_captured",
  "dimension_requirements_not_captured",
  "dimension_assignments_not_captured",
  "invalid_dimension_capture",
  "required_dimension_not_captured",
  "fixed_dimension_mismatch",
]);

export type UnknownReason = typeof UnknownReason.Type;

const Components = Schema.Struct({
  mappingContentChecksum: Digest,
  statementLeaf: Schema.String,
  classification: Classification,
  placement: Placement,
  vatCategory: Schema.String,
  vatProfileIdentity: Digest,
  resolvedRate: Share,
  deductibleShare: Share,
  period: Schema.Struct({ id: Identifier, startsOn: AccountingDate, endsOn: AccountingDate }),
  dimensions: Schema.Array(
    Schema.Struct({
      code: Schema.String,
      revision: Schema.Int,
      requirement: Schema.Literals(["required", "fixed"]),
      valueCode: Schema.String,
      valueRevision: Schema.Int,
    }),
  ),
});

export const Consequence = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("known"),
    identity: Schema.String,
    components: Components,
  }),
  Schema.Struct({
    status: Schema.Literal("unknown"),
    reasons: Schema.Array(UnknownReason).check(Schema.isMinLength(1)),
  }),
]);

export type Consequence = typeof Consequence.Type;

function mappedAccount(input: CapturedTreatment, reasons: UnknownReason[]) {
  const mapping = input.mapping;

  if (mapping === null) {
    reasons.push("mapping_not_captured");

    return null;
  }

  if (
    !/^\d+$/.test(input.originalCommitCutoff) ||
    mapping.applicableAtCutoff !== input.originalCommitCutoff
  )
    reasons.push("mapping_not_applicable");

  if (
    !Schema.is(Digest)(mapping.checksum) ||
    new Set(mapping.accounts.map((account) => account.accountId)).size !== mapping.accounts.length
  )
    reasons.push("invalid_mapping");
  const account = mapping.accounts.find((item) => item.accountId === input.accountId);

  if (!account) {
    reasons.push("account_not_mapped");

    return null;
  }

  const expectedPlacement =
    account.classification === "income" || account.classification === "expense"
      ? "income_statement"
      : "balance_sheet";

  if (account.statementLeaf.length === 0 || account.placement !== expectedPlacement)
    reasons.push("invalid_mapping");

  return account;
}

function normalizedShare(
  input: CapturedTreatment,
  kind: "rate" | "deduction",
  reasons: UnknownReason[],
) {
  const share = kind === "rate" ? input.vat.resolvedRate : input.vat.deduction;
  const invalid: UnknownReason = kind === "rate" ? "invalid_resolved_rate" : "invalid_deduction";

  if (share === null) {
    reasons.push(kind === "rate" ? "resolved_rate_not_captured" : "deduction_not_captured");

    return null;
  }

  if (!/^\d+$/.test(share.numerator) || !/^\d+$/.test(share.denominator)) {
    reasons.push(invalid);

    return null;
  }

  const numerator = BigInt(share.numerator);
  const denominator = BigInt(share.denominator);

  if (denominator === 0n || numerator > denominator) {
    reasons.push(invalid);

    return null;
  }

  let left = numerator;
  let right = denominator;

  while (right !== 0n) {
    const remainder = left % right;
    left = right;
    right = remainder;
  }

  return { numerator: (numerator / left).toString(), denominator: (denominator / left).toString() };
}

function capturedPeriod(input: CapturedTreatment, reasons: UnknownReason[]) {
  const { id, startsOn, endsOn } = input.period;

  if (id === null || startsOn === null || endsOn === null) {
    reasons.push("period_bounds_not_captured");

    return null;
  }

  if (input.postingOn === null) reasons.push("posting_date_not_captured");
  else if (
    !isCalendarDate(input.postingOn) ||
    input.postingOn < startsOn ||
    input.postingOn > endsOn
  )
    reasons.push("invalid_period");

  if (!isCalendarDate(startsOn) || !isCalendarDate(endsOn) || startsOn > endsOn)
    reasons.push("invalid_period");

  return { id, startsOn, endsOn };
}

function requiredDimensions(input: CapturedTreatment, reasons: UnknownReason[]) {
  const capture = input.dimensions;
  const result: (typeof Components.Type)["dimensions"][number][] = [];

  if (capture === null || capture.requirements === null) {
    reasons.push("dimension_requirements_not_captured");

    return result;
  }

  if (capture.assignments === null) {
    reasons.push("dimension_assignments_not_captured");

    return result;
  }

  if (
    new Set(capture.requirements.map((item) => item.code)).size !== capture.requirements.length ||
    new Set(capture.assignments.map((item) => item.code)).size !== capture.assignments.length
  )
    reasons.push("invalid_dimension_capture");

  for (const policy of capture.requirements) {
    if (policy.code.length === 0 || policy.revision < 1) reasons.push("invalid_dimension_capture");

    if (policy.requirement === "optional") continue;

    const value = capture.assignments.find(
      (item) => item.code === policy.code && item.revision === policy.revision,
    );

    if (
      !value ||
      value.valueCode === null ||
      value.valueCode.length === 0 ||
      value.valueRevision === null ||
      value.valueRevision < 1
    ) {
      reasons.push("required_dimension_not_captured");
      continue;
    }

    if (
      policy.requirement === "fixed" &&
      (policy.fixedValueCode !== value.valueCode ||
        policy.fixedValueRevision !== value.valueRevision)
    )
      reasons.push("fixed_dimension_mismatch");
    result.push({
      code: policy.code,
      revision: policy.revision,
      requirement: policy.requirement,
      valueCode: value.valueCode,
      valueRevision: value.valueRevision,
    });
  }

  return result.sort((left, right) =>
    left.code < right.code ? -1 : left.code > right.code ? 1 : 0,
  );
}

export function classify(input: CapturedTreatment): Consequence {
  const reasons: UnknownReason[] = [];
  const account = mappedAccount(input, reasons);

  if (input.vat.category === null || input.vat.category.length === 0)
    reasons.push("vat_category_not_captured");

  if (input.vat.profileIdentity === null || !Schema.is(Digest)(input.vat.profileIdentity))
    reasons.push("vat_profile_not_captured");

  const resolvedRate = normalizedShare(input, "rate", reasons);
  const deductibleShare = normalizedShare(input, "deduction", reasons);
  const period = capturedPeriod(input, reasons);
  const dimensions = requiredDimensions(input, reasons);

  if (
    reasons.length > 0 ||
    account === null ||
    deductibleShare === null ||
    resolvedRate === null ||
    period === null ||
    input.mapping === null ||
    input.vat.category === null ||
    input.vat.profileIdentity === null
  )
    return { status: "unknown", reasons: [...new Set(reasons)] };

  const components = {
    mappingContentChecksum: input.mapping.checksum,
    statementLeaf: account.statementLeaf,
    classification: account.classification,
    placement: account.placement,
    vatCategory: input.vat.category,
    vatProfileIdentity: input.vat.profileIdentity,
    resolvedRate,
    deductibleShare,
    period,
    dimensions,
  };

  return {
    status: "known",
    identity: `treatment_consequence_v1:${JSON.stringify(components)}`,
    components,
  };
}

export function compare(
  left: Consequence,
  right: Consequence,
): "equivalent" | "different" | "unknown" {
  if (left.status === "unknown" || right.status === "unknown") return "unknown";

  return left.identity === right.identity ? "equivalent" : "different";
}
