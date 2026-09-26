import * as Schema from "effect/Schema";
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import * as Accounting from "./accounting";
import { accountingErrors } from "./accounting-errors";
import { CommandReceipt, EvidenceReference } from "./commerce";
import { PayrollRuleRelease } from "./payroll-calculations";
import { RoleKind } from "./roles";

export { RoleKind };

// Capability-specific company admission. The four families below are the ones this
// owner admits. The legal_ar family is activated by commerce.legalProfile.activate,
// so it is reported as owner-bound and never activated here.

export const Family = Schema.Literals(["posting_eligibility", "vat", "payroll", "statements"]);

export const FactKind = Schema.Literals([
  "jurisdiction",
  "legal_form",
  "organization_number",
  "accounting_method",
  "vat_registration",
  "vat_period",
  "fiscal_year",
  "payroll_registration",
]);

export const RecordClass = Schema.Literals(["actual_company", "synthetic"]);

export const Jurisdiction = Schema.String.check(Schema.isPattern(/^[A-Z]{2}$/));

export const OrganizationNumber = Schema.String.check(Schema.isPattern(/^\d{10}$/));

export const Registration = Schema.Literals(["registered", "not_registered"]);

const LegalForm = Schema.Literals(["aktiebolag", "enskild_firma"]);

const AccountingMethod = Schema.Literals(["accrual", "cash"]);

const VatPeriod = Schema.Literals(["monthly", "quarterly", "yearly"]);

const FiscalYear = Schema.Struct({
  startsOn: Accounting.AccountingDate,
  endsOn: Accounting.AccountingDate,
}).check(
  Schema.makeFilter(
    (year) => year.startsOn <= year.endsOn || "The fiscal year must end on or after its start.",
  ),
);

function factValue<S extends Schema.Top>(known: S) {
  return Schema.Union([
    Schema.Struct({ state: Schema.Literal("known"), value: known }),
    Schema.Struct({ state: Schema.Literal("unknown") }),
    Schema.Struct({ state: Schema.Literal("not_applicable"), reason: Accounting.Description }),
  ]);
}

const factFields = {
  effectiveFrom: Accounting.AccountingDate,
  effectiveTo: Schema.NullOr(Accounting.AccountingDate),
  supersedesId: Schema.NullOr(Accounting.Identifier),
  evidence: Schema.Array(EvidenceReference).check(Schema.isMinLength(1), Schema.isMaxLength(20)),
  note: Accounting.Description,
};

export const RecordFactRevision = Schema.Union([
  Schema.Struct({
    factKind: Schema.Literal("jurisdiction"),
    value: factValue(Jurisdiction),
    ...factFields,
  }),
  Schema.Struct({
    factKind: Schema.Literal("legal_form"),
    value: factValue(LegalForm),
    ...factFields,
  }),
  Schema.Struct({
    factKind: Schema.Literal("organization_number"),
    value: factValue(OrganizationNumber),
    ...factFields,
  }),
  Schema.Struct({
    factKind: Schema.Literal("accounting_method"),
    value: factValue(AccountingMethod),
    ...factFields,
  }),
  Schema.Struct({
    factKind: Schema.Literal("vat_registration"),
    value: factValue(Registration),
    ...factFields,
  }),
  Schema.Struct({
    factKind: Schema.Literal("vat_period"),
    value: factValue(VatPeriod),
    ...factFields,
  }),
  Schema.Struct({
    factKind: Schema.Literal("fiscal_year"),
    value: factValue(FiscalYear),
    ...factFields,
  }),
  Schema.Struct({
    factKind: Schema.Literal("payroll_registration"),
    value: factValue(Registration),
    ...factFields,
  }),
]);

export const ReviewFactRevision = Schema.Struct({
  factRevisionId: Accounting.Identifier,
  expectedDigest: Accounting.Digest,
  result: Schema.Literals(["confirmed", "rejected"]),
  rationale: Accounting.Description,
});

export const RecordRoleBinding = Schema.Struct({
  roleKind: RoleKind,
  accountId: Accounting.Identifier,
  effectiveFrom: Accounting.AccountingDate,
  effectiveTo: Schema.NullOr(Accounting.AccountingDate),
  supersedesId: Schema.NullOr(Accounting.Identifier),
  reviewer: Accounting.Identifier,
  evidence: Schema.Array(EvidenceReference).check(Schema.isMinLength(1), Schema.isMaxLength(20)),
  note: Accounting.Description,
});

export const FactRevision = Schema.Union([
  Schema.Struct({
    id: Accounting.Identifier,
    entityId: Accounting.Identifier,
    factKind: Schema.Literal("jurisdiction"),
    value: factValue(Jurisdiction),
    ...factFields,
    recordedBy: Accounting.Identifier,
    recordedAt: Schema.String,
    digest: Accounting.Digest,
    receipt: CommandReceipt,
  }),
  Schema.Struct({
    id: Accounting.Identifier,
    entityId: Accounting.Identifier,
    factKind: Schema.Literal("legal_form"),
    value: factValue(LegalForm),
    ...factFields,
    recordedBy: Accounting.Identifier,
    recordedAt: Schema.String,
    digest: Accounting.Digest,
    receipt: CommandReceipt,
  }),
  Schema.Struct({
    id: Accounting.Identifier,
    entityId: Accounting.Identifier,
    factKind: Schema.Literal("organization_number"),
    value: factValue(OrganizationNumber),
    ...factFields,
    recordedBy: Accounting.Identifier,
    recordedAt: Schema.String,
    digest: Accounting.Digest,
    receipt: CommandReceipt,
  }),
  Schema.Struct({
    id: Accounting.Identifier,
    entityId: Accounting.Identifier,
    factKind: Schema.Literal("accounting_method"),
    value: factValue(AccountingMethod),
    ...factFields,
    recordedBy: Accounting.Identifier,
    recordedAt: Schema.String,
    digest: Accounting.Digest,
    receipt: CommandReceipt,
  }),
  Schema.Struct({
    id: Accounting.Identifier,
    entityId: Accounting.Identifier,
    factKind: Schema.Literal("vat_registration"),
    value: factValue(Registration),
    ...factFields,
    recordedBy: Accounting.Identifier,
    recordedAt: Schema.String,
    digest: Accounting.Digest,
    receipt: CommandReceipt,
  }),
  Schema.Struct({
    id: Accounting.Identifier,
    entityId: Accounting.Identifier,
    factKind: Schema.Literal("vat_period"),
    value: factValue(VatPeriod),
    ...factFields,
    recordedBy: Accounting.Identifier,
    recordedAt: Schema.String,
    digest: Accounting.Digest,
    receipt: CommandReceipt,
  }),
  Schema.Struct({
    id: Accounting.Identifier,
    entityId: Accounting.Identifier,
    factKind: Schema.Literal("fiscal_year"),
    value: factValue(FiscalYear),
    ...factFields,
    recordedBy: Accounting.Identifier,
    recordedAt: Schema.String,
    digest: Accounting.Digest,
    receipt: CommandReceipt,
  }),
  Schema.Struct({
    id: Accounting.Identifier,
    entityId: Accounting.Identifier,
    factKind: Schema.Literal("payroll_registration"),
    value: factValue(Registration),
    ...factFields,
    recordedBy: Accounting.Identifier,
    recordedAt: Schema.String,
    digest: Accounting.Digest,
    receipt: CommandReceipt,
  }),
]);

export const FactReview = Schema.Struct({
  factRevisionId: Accounting.Identifier,
  entityId: Accounting.Identifier,
  revisionDigest: Accounting.Digest,
  reviewer: Accounting.Identifier,
  result: Schema.Literals(["confirmed", "rejected"]),
  rationale: Accounting.Description,
  reviewedAt: Schema.String,
  digest: Accounting.Digest,
  receipt: CommandReceipt,
});

export const RoleBinding = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  roleKind: RoleKind,
  accountId: Accounting.Identifier,
  accountVersion: Accounting.MinorUnits,
  effectiveFrom: Accounting.AccountingDate,
  effectiveTo: Schema.NullOr(Accounting.AccountingDate),
  supersedesId: Schema.NullOr(Accounting.Identifier),
  reviewer: Accounting.Identifier,
  evidence: Schema.Array(EvidenceReference).check(Schema.isMinLength(1), Schema.isMaxLength(20)),
  note: Accounting.Description,
  recordedBy: Accounting.Identifier,
  recordedAt: Schema.String,
  digest: Accounting.Digest,
  receipt: CommandReceipt,
});

// Each family selects its configuration by its own dates, never by today's date.
export const ProfileDates = Schema.Struct({
  postingOn: Schema.NullOr(Accounting.AccountingDate),
  taxPointOn: Schema.NullOr(Accounting.AccountingDate),
  paymentOn: Schema.NullOr(Accounting.AccountingDate),
  reportOn: Schema.NullOr(Accounting.AccountingDate),
});

export const ProfileWitness = Schema.Struct({
  family: Family,
  recordClass: RecordClass,
  dates: ProfileDates,
  selectorDate: Accounting.AccountingDate,
  jurisdiction: Jurisdiction,
  ruleReleaseId: Accounting.Identifier,
  ruleReleaseChecksum: Accounting.Digest,
  factRevisionIds: Schema.Array(Accounting.Identifier).check(Schema.isMaxLength(40)),
  factReviewIds: Schema.Array(Accounting.Identifier).check(Schema.isMaxLength(40)),
  roleBindingIds: Schema.Array(Accounting.Identifier).check(Schema.isMaxLength(20)),
  activationId: Schema.NullOr(Accounting.Identifier),
});

export const ProfileGap = Schema.Struct({
  state: Schema.Literals([
    "unknown_fact",
    "ambiguous_fact",
    "unreviewed_fact",
    "missing_rule_release",
    "ambiguous_rule_release",
    "inapplicable_release",
    "missing_role_binding",
    "ambiguous_role_binding",
    "inactive_account",
    "stale_role_binding",
    "missing_activation",
    "overlapping_activation",
  ]),
  subject: Schema.String,
  affectedOperations: Schema.Array(Schema.String).check(Schema.isMinLength(1)),
});

export const ProfileResolution = Schema.Struct({
  family: Family,
  recordClass: RecordClass,
  dates: ProfileDates,
  selectorDate: Schema.NullOr(Accounting.AccountingDate),
  status: Schema.Literals(["resolved", "incomplete"]),
  witness: Schema.NullOr(ProfileWitness),
  gaps: Schema.Array(ProfileGap),
});

export const OwnerBoundFamily = Schema.Struct({
  family: Schema.Literal("legal_ar"),
  activationOwner: Schema.Literal("commerce.legalProfile.activate"),
  effect: Accounting.Description,
  admitted: Schema.Boolean,
});

export const CompanyProfile = Schema.Struct({
  scope: Accounting.Scope,
  recordClass: RecordClass,
  families: Schema.Array(ProfileResolution),
  ownerBoundFamilies: Schema.Array(OwnerBoundFamily),
  checkedAt: Schema.String,
});

export const PrepareCompanyActivation = Schema.Struct({
  family: Family,
  recordClass: RecordClass,
  dates: ProfileDates,
  effectiveFrom: Accounting.AccountingDate,
  effectiveTo: Schema.NullOr(Accounting.AccountingDate),
  reason: Accounting.Description,
});

export const ActivationDependency = Schema.Struct({
  kind: Schema.Literals(["fact_revision", "rule_release", "role_binding", "family_membership"]),
  resourceId: Schema.String,
  version: Schema.String,
  reason: Schema.String,
});

export const CompanyActivationPlan = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  canonicalization: Schema.Literal("openerp-c14n-v1"),
  owner: Schema.Literal("company_activation"),
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  version: Schema.Literal(1),
  input: PrepareCompanyActivation,
  witness: ProfileWitness,
  dependencies: Schema.Array(ActivationDependency).check(Schema.isMinLength(1)),
  digest: Accounting.Digest,
  createdBy: Accounting.Identifier,
  createdAt: Schema.String,
});

export const ApproveCompanyActivation = Schema.Struct({ planDigest: Accounting.Digest });

export const CompanyActivationApproval = Schema.Struct({
  id: Accounting.Identifier,
  planId: Accounting.Identifier,
  planDigest: Accounting.Digest,
  scope: Accounting.Scope,
  actorId: Accounting.Identifier,
  expiresAt: Schema.String,
  createdAt: Schema.String,
  receipt: CommandReceipt,
});

export const ExecuteCompanyActivation = Schema.Struct({
  planDigest: Accounting.Digest,
  approvalId: Accounting.Identifier,
});

export const CompanyActivation = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  family: Family,
  ruleReleaseId: Accounting.Identifier,
  factRevisionIds: Schema.Array(Accounting.Identifier).check(Schema.isMaxLength(40)),
  factReviewIds: Schema.Array(Accounting.Identifier).check(Schema.isMaxLength(40)),
  roleBindingIds: Schema.Array(Accounting.Identifier).check(Schema.isMaxLength(20)),
  applicabilityScope: Accounting.Scope,
  effectiveFrom: Accounting.AccountingDate,
  effectiveTo: Schema.NullOr(Accounting.AccountingDate),
  changeSetId: Schema.NullOr(Accounting.Identifier),
  approvedDigest: Accounting.Digest,
  activatedBy: Accounting.Identifier,
  activatedAt: Schema.String,
  digest: Accounting.Digest,
});

// A genuinely financial-free admission commits a no-effect receipt, never a zero voucher.
export const CompanyActivationReceipt = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  changeSetId: Accounting.Identifier,
  groupId: Accounting.Identifier,
  planDigest: Accounting.Digest,
  activationId: Accounting.Identifier,
  approvalId: Accounting.Identifier,
  journalIds: Schema.Array(Accounting.Identifier),
  noFinancialEffect: Schema.Literal(true),
  committedAt: Schema.String,
  receipt: CommandReceipt,
});

export const CompanyActivationImpact = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  factRevisionId: Accounting.Identifier,
  supersededRevisionId: Accounting.Identifier,
  activationId: Accounting.Identifier,
  alreadyInForce: Schema.Boolean,
  recordedAt: Schema.String,
  digest: Accounting.Digest,
});

// A release is reviewed executable data for one family, never a prompt or arbitrary
// code. An empty applicability list constrains nothing.
export const ReleaseApplicability = Schema.Struct({
  legalForms: Schema.Array(LegalForm),
  accountingMethods: Schema.Array(AccountingMethod),
  vatRegistrations: Schema.Array(Registration),
  payrollRegistrations: Schema.Array(Registration),
});

export const RuleRelease = Schema.Struct({
  id: Accounting.Identifier,
  jurisdiction: Jurisdiction,
  family: Family,
  version: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 10000 })),
  checksum: Accounting.Digest,
  applicability: ReleaseApplicability,
  requiredFactKinds: Schema.Array(FactKind).check(Schema.isMaxLength(40)),
  requiredRoleKinds: Schema.Array(RoleKind).check(Schema.isMaxLength(20)),
  calculatorVersion: Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9._-]{2,127}$/)),
  rounding: Schema.Struct({
    mode: Schema.Literals(["half_up", "half_even", "toward_zero", "floor"]),
    scale: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 6 })),
  }),
  validFrom: Accounting.AccountingDate,
  validTo: Accounting.AccountingDate,
  sourceManifest: Accounting.Description,
  qualificationStatus: Schema.Literals(["reviewed", "withdrawn"]),
  recordClasses: Schema.Array(RecordClass).check(Schema.isMinLength(1), Schema.isMaxLength(2)),
  // A family carries its own reviewed executable content in this one release
  // record. The payroll family's tables, decisions, contribution bands and
  // holiday policy live here, so there is exactly one rule-release authority.
  payroll: Schema.optional(PayrollRuleRelease),
}).check(
  Schema.makeFilter(
    (release) =>
      release.validFrom <= release.validTo || "A release must be valid until at least its start.",
  ),
);

const key = Accounting.IdempotencyHeaders.fields["idempotency-key"];

export const CompanyProfileCapabilities = {
  company_record_fact: {
    description:
      "Record an immutable company fact revision with retained evidence. A revision never edits an earlier one; supersede it. A recorded fact is not established until an independent operator confirms its review.",
    input: Schema.Struct({
      scope: Accounting.Scope,
      idempotencyKey: key,
      input: RecordFactRevision,
    }),
    output: FactRevision,
    readOnly: false,
  },
  company_review_fact: {
    description:
      "Independently confirm or reject one immutable fact revision. The reviewer cannot be the recorder. Rejection leaves the fact unestablished; it does not delete the revision.",
    input: Schema.Struct({
      scope: Accounting.Scope,
      idempotencyKey: key,
      input: ReviewFactRevision,
    }),
    output: FactReview,
    readOnly: false,
  },
  company_bind_role: {
    description:
      "Bind one reviewed account role in a book for an effective interval. A rebinding supersedes the earlier binding rather than rewriting it, and the account must belong to this book.",
    input: Schema.Struct({
      scope: Accounting.Scope,
      idempotencyKey: key,
      input: RecordRoleBinding,
    }),
    output: RoleBinding,
    readOnly: false,
  },
  company_get_profile: {
    description:
      "Read each admitted family's resolution for the dates that operation itself uses. Missing, ambiguous and unreviewed facts are named with the operations they block. Unknown is never reported as false, empty or zero, and one incomplete family is not a failure of the whole company.",
    input: Schema.Struct({
      scope: Accounting.Scope,
      recordClass: RecordClass,
      dates: ProfileDates,
    }),
    output: CompanyProfile,
    readOnly: true,
  },
  company_prepare_activation: {
    description:
      "Seal one company activation proposal from the exact reviewed facts, rule release and role bindings current for the requested dates. It activates nothing and posts no journal.",
    input: Schema.Struct({
      scope: Accounting.Scope,
      idempotencyKey: key,
      input: PrepareCompanyActivation,
    }),
    output: CompanyActivationPlan,
    readOnly: false,
  },
  company_approve_activation: {
    description:
      "Approve one exact sealed activation digest as a current book operator. Approval does not activate; executing the approved digest commits the activation, the affected family membership version and a no-journal receipt in one transaction.",
    input: Schema.Struct({
      scope: Accounting.Scope,
      planId: Accounting.Identifier,
      idempotencyKey: key,
      input: ApproveCompanyActivation,
    }),
    output: CompanyActivationApproval,
    readOnly: false,
  },
  company_execute_activation: {
    description:
      "Commit the exact approved activation digest, the affected family membership version and a no-journal receipt together. Reuse the same idempotency key to recover a committed result after an uncertain response.",
    input: Schema.Struct({
      scope: Accounting.Scope,
      planId: Accounting.Identifier,
      idempotencyKey: key,
      input: ExecuteCompanyActivation,
    }),
    output: CompanyActivationReceipt,
    readOnly: false,
  },
  company_get_activation: {
    description:
      "Read one immutable activation with the exact facts, reviews, role bindings and rule release it selected. A later correction never changes this record.",
    input: Schema.Struct({ scope: Accounting.Scope, activationId: Accounting.Identifier }),
    output: CompanyActivation,
    readOnly: true,
  },
};

const bookPath = "/v1/entities/:entityId/books/:bookId";

const scoped = { params: Accounting.Scope, error: accountingErrors };

const mutation = { ...scoped, headers: Accounting.IdempotencyHeaders };

const planMutation = {
  params: Schema.Struct({ ...Accounting.Scope.fields, planId: Accounting.Identifier }),
  headers: Accounting.IdempotencyHeaders,
  error: accountingErrors,
};

export const CompanyProfileApi = HttpApiGroup.make("companyProfile").add(
  HttpApiEndpoint.get("getCompanyProfile", `${bookPath}/company-profile`, {
    params: Accounting.Scope,
    query: Schema.Struct({ recordClass: RecordClass, ...ProfileDates.fields }),
    success: CompanyProfile,
    error: accountingErrors,
  }),
  HttpApiEndpoint.post("recordCompanyFact", `${bookPath}/company-facts`, {
    ...mutation,
    payload: RecordFactRevision.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: FactRevision,
  }),
  HttpApiEndpoint.post("reviewCompanyFact", `${bookPath}/company-facts/:factRevisionId/reviews`, {
    params: Schema.Struct({
      ...Accounting.Scope.fields,
      factRevisionId: Accounting.Identifier,
    }),
    headers: Accounting.IdempotencyHeaders,
    payload: Schema.Struct({ ...ReviewFactRevision.fields }).annotate({
      parseOptions: { onExcessProperty: "error" },
    }),
    success: FactReview,
    error: accountingErrors,
  }),
  HttpApiEndpoint.post("recordCompanyRoleBinding", `${bookPath}/company-role-bindings`, {
    ...mutation,
    payload: RecordRoleBinding.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: RoleBinding,
  }),
  HttpApiEndpoint.post("prepareCompanyActivation", `${bookPath}/company-activation-plans`, {
    ...mutation,
    payload: PrepareCompanyActivation.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: CompanyActivationPlan,
  }),
  HttpApiEndpoint.post(
    "approveCompanyActivation",
    `${bookPath}/company-activation-plans/:planId/approvals`,
    {
      ...planMutation,
      payload: ApproveCompanyActivation.annotate({ parseOptions: { onExcessProperty: "error" } }),
      success: CompanyActivationApproval,
    },
  ),
  HttpApiEndpoint.post(
    "executeCompanyActivation",
    `${bookPath}/company-activation-plans/:planId/executions`,
    {
      ...planMutation,
      payload: ExecuteCompanyActivation.annotate({ parseOptions: { onExcessProperty: "error" } }),
      success: CompanyActivationReceipt,
    },
  ),
  HttpApiEndpoint.get("getCompanyActivation", `${bookPath}/company-activations/:activationId`, {
    params: Schema.Struct({ ...Accounting.Scope.fields, activationId: Accounting.Identifier }),
    success: CompanyActivation,
    error: accountingErrors,
  }),
);
