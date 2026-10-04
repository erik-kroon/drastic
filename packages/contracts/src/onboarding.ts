import * as Historical from "./historical-migration";
import * as Schema from "effect/Schema";
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import * as A from "./accounting";
import * as Profiles from "./company-profiles";
import * as Intake from "./source-intake";
import * as Sie from "./sie-import";
import * as Commerce from "./commerce";
import * as Bank from "./reconciliation";
import { accountingErrors } from "./accounting-errors";

export const OnboardingPath = Schema.Literals([
  "new_company",
  "existing_company",
  "bureau_managed",
  "demo",
]);

export const MigrationDepth = Schema.Literals([
  "opening_only",
  "current_fiscal_year",
  "full_supported_history",
]);

export const SourceCategory = Schema.Literals([
  "company",
  "previous_books",
  "bank",
  "sales",
  "purchases",
  "tax",
  "assets",
  "payroll",
  "other",
]);

const Revision = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 2147483646 }));

const DateOrUnknown = Schema.NullOr(A.AccountingDate);

export const OnboardingDates = Schema.Struct({
  historyStartsOn: DateOrUnknown,
  historyEndsOn: DateOrUnknown,
  detailStartsOn: DateOrUnknown,
  openingOn: DateOrUnknown,
  acceptanceStartsOn: DateOrUnknown,
  acceptanceEndsOn: DateOrUnknown,
  candidateLiveOn: DateOrUnknown,
  provingPeriodEndsOn: DateOrUnknown,
}).check(
  Schema.makeFilter((dates) => {
    const issues: Array<Schema.FilterIssue> = [];

    const ordered = (start: keyof typeof dates, end: keyof typeof dates, strict = false) => {
      const first = dates[start];
      const last = dates[end];

      if (first !== null && last !== null && (strict ? first >= last : first > last))
        issues.push({ path: [end], issue: `The ${end} must follow ${start}.` });
    };

    ordered("historyStartsOn", "historyEndsOn");
    ordered("historyStartsOn", "detailStartsOn");
    ordered("detailStartsOn", "historyEndsOn");
    ordered("openingOn", "acceptanceStartsOn", true);
    ordered("acceptanceStartsOn", "acceptanceEndsOn");
    ordered("acceptanceEndsOn", "historyEndsOn");
    ordered("acceptanceEndsOn", "candidateLiveOn", true);
    ordered("candidateLiveOn", "provingPeriodEndsOn");

    return issues;
  }),
);

export const OnboardingConfiguration = Schema.Struct({
  migrationDepth: Schema.NullOr(MigrationDepth),
  incumbentSystem: Schema.NullOr(
    Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  ),
  dates: OnboardingDates,
}).check(
  Schema.makeFilter(
    (configuration) =>
      configuration.migrationDepth !== "opening_only" ||
      configuration.dates.detailStartsOn === null ||
      "Opening-only migration cannot claim detailed history.",
  ),
);

export const StartOnboarding = Schema.Struct({ path: OnboardingPath });

export const SaveOnboarding = Schema.Struct({
  expectedRevision: Revision,
  configuration: OnboardingConfiguration,
});

export const PrepareOnboardingImportPlan = Schema.Struct({
  expectedRevision: Revision,
  previewId: A.Identifier,
  expectedPreviewDigest: A.Digest,
  openingControlId: A.Identifier,
  closingControlId: A.Identifier,
  mappings: Sie.SealSiePlan.fields.mappings,
  rationale: A.Description,
});

export const StartOnboardingImport = Schema.Struct({
  expectedRevision: Revision,
  sourcePlanId: A.Identifier,
  expectedSourcePlanDigest: A.Digest,
});

export const OnboardingImportStart = Schema.Struct({
  plan: Sie.SiePlan,
  sourceRun: Sie.SieRunStart,
  financialRun: Historical.RunStart,
});

export const PrepareOnboardingImportBatch = Schema.Struct({
  financialRunId: A.Identifier,
  expectedFence: Schema.String,
  expectedNextOrdinal: Schema.Int,
  expectedSourcePlanDigest: A.Digest,
  rationale: A.Description,
});

export const OnboardingImportBatch = Schema.Struct({
  id: A.Identifier,
  scope: A.Scope,
  financialRunId: A.Identifier,
  sourcePlanId: A.Identifier,
  sourcePlanDigest: A.Digest,
  fence: Schema.String,
  firstOrdinal: Schema.Int,
  proposals: Schema.Array(
    Schema.Struct({
      ordinal: Schema.Int,
      sourceReference: Schema.String,
      change: A.ChangeSet,
    }),
  ).check(Schema.isMinLength(1), Schema.isMaxLength(20)),
  preparedBy: A.Identifier,
  preparedAt: Schema.String,
  digest: A.Digest,
});

export const ApproveOnboardingImportBatch = Schema.Struct({
  batchId: A.Identifier,
  expectedDigest: A.Digest,
});

export const OnboardingImportBatchApproval = Schema.Struct({
  id: A.Identifier,
  scope: A.Scope,
  batchId: A.Identifier,
  batchDigest: A.Digest,
  approvals: Schema.Array(A.Approval).check(Schema.isMinLength(1), Schema.isMaxLength(20)),
  approvedBy: A.Identifier,
  approvedAt: Schema.String,
});

export const ExecuteOnboardingImportBatch = Schema.Struct({
  ...ApproveOnboardingImportBatch.fields,
  approvalId: A.Identifier,
});

export const OnboardingImportBatchWorkspace = Schema.Struct({
  run: Historical.Run,
  total: Schema.Int,
  batch: Schema.NullOr(OnboardingImportBatch),
  approval: Schema.NullOr(OnboardingImportBatchApproval),
  approvalCurrent: Schema.Boolean,
});

export const AttachOnboardingSource = Schema.Struct({
  occurrenceId: A.Identifier,
  category: SourceCategory,
});

export const OnboardingCase = Schema.Struct({
  id: A.Identifier,
  scope: A.Scope,
  revision: Revision,
  path: OnboardingPath,
  recordClass: Profiles.RecordClass,
  configuration: OnboardingConfiguration,
  recordedBy: A.Identifier,
  recordedAt: Schema.String,
  digest: A.Digest,
});

export const OnboardingSource = Schema.Struct({
  id: A.Identifier,
  caseId: A.Identifier,
  scope: A.Scope,
  category: SourceCategory,
  occurrence: Intake.SourceOccurrence,
  linkedBy: A.Identifier,
  linkedAt: Schema.String,
});

export const OnboardingQualification = Schema.Struct({
  family: Profiles.Family,
  state: Schema.Literals([
    "supported",
    "supported_with_handoff",
    "needs_information",
    "not_supported",
  ]),
  scope: Schema.Literal("dated_profile_witness_only"),
  witness: Schema.NullOr(Profiles.ProfileWitness),
  gaps: Schema.Array(Profiles.ProfileGap),
  reason: Schema.String,
});

export const OnboardingTask = Schema.Struct({
  id: Schema.Literals([
    "company",
    "compatibility",
    "sources",
    "import",
    "opening",
    "reconciliation",
    "responsibilities",
    "final_delta",
    "cutover",
    "go_live",
    "proving_period",
  ]),
  state: Schema.Literals(["needs_information", "in_progress", "blocked", "complete"]),
  owner: Schema.String,
  blockers: Schema.Array(Schema.String),
});

export const ImportProgress = Schema.Struct({
  sourceRunId: A.Identifier,
  sourcePlanId: A.Identifier,
  sourceKind: Schema.Literals(["synthetic", "reviewed_sie4"]),
  sourceState: Schema.Literals(["running", "paused", "staged"]),
  nextSourceOrdinal: Schema.Int,
  financialRunId: Schema.NullOr(A.Identifier),
  financialState: Schema.NullOr(Schema.Literals(["running", "paused", "posted"])),
  nextFinancialOrdinal: Schema.NullOr(Schema.Int),
});

export const OnboardingWorkspace = Schema.Struct({
  case: OnboardingCase,
  checkedAt: Schema.String,
  profile: Profiles.CompanyProfile,
  qualification: Schema.Array(OnboardingQualification),
  sources: Schema.Array(OnboardingSource),
  nextSourceCursor: Schema.NullOr(A.Identifier),
  sourceCount: A.AggregateMinorUnits,
  sourceCoverage: Schema.Literal("not_established"),
  imports: Schema.Array(ImportProgress),
  nextImportCursor: Schema.NullOr(A.Identifier),
  tasks: Schema.Array(OnboardingTask),
  cutover: Schema.Struct({
    ready: Schema.Boolean,
    authority: Schema.Literals(["not_established", "fenced", "native"]),
    candidateLiveOn: DateOrUnknown,
    blockers: Schema.Array(Schema.String),
  }),
});

export const OnboardingHistory = Schema.Struct({
  scope: A.Scope,
  items: Schema.Array(OnboardingCase),
  nextBeforeRevision: Schema.NullOr(Revision),
});

export const OnboardingControlKind = Schema.Literals([
  "trial_balance",
  "bank",
  "bank_reconciling_items",
  "historical_originals",
  "historical_payroll_handoff",
  "sales_open_items",
  "purchase_open_items",
  "vat",
  "tax",
]);

export const OnboardingOriginalCoverage = Schema.Struct({
  rows: Schema.Array(
    Schema.Struct({
      sourceIdentity: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
      occurrenceId: Schema.NullOr(A.Identifier),
      sourceSha256: Schema.NullOr(A.Digest),
    }),
  ).check(Schema.isMinLength(1), Schema.isMaxLength(1000)),
});

export const OnboardingPayrollHandoff = Schema.Struct({
  incumbentSystem: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  historyStartsOn: A.AccountingDate,
  retainedThrough: A.AccountingDate,
});

export const OnboardingControl = Schema.Struct({
  id: A.Identifier,
  scope: A.Scope,
  occurrenceId: A.Identifier,
  sourceSha256: A.Digest,
  sourceSystem: Schema.String,
  sourceAccountId: Schema.String,
  kind: OnboardingControlKind,
  originalCoverage: Schema.optionalKey(OnboardingOriginalCoverage),
  payrollHandoff: Schema.optionalKey(OnboardingPayrollHandoff),
  parserVersion: Schema.Literal("onboarding_csv_v1"),
  asOf: A.AccountingDate,
  currency: Schema.String.check(Schema.isPattern(/^[A-Z]{3}$/)),
  facts: Schema.Array(
    Schema.Struct({
      sourceIdentity: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
      accountId: A.Identifier,
      accountCode: Schema.String,
      amountMinor: A.SignedMinorUnits,
    }),
  ),
  provenance: A.Description,
  qualifiedBy: A.Identifier,
  qualifiedAt: Schema.String,
});

export const QualifyOnboardingControl = Schema.Struct({
  occurrenceId: A.Identifier,
  kind: OnboardingControlKind,
  provenance: A.Description,
});

export const ResponsibilityAssignments = Schema.Struct({
  preparerId: A.Identifier,
  bookkeepingApproverId: A.Identifier,
  paymentApproverId: A.Identifier,
  vatResponsibleId: A.Identifier,
  activationConfirmerIds: Schema.Array(A.Identifier).check(
    Schema.isMinLength(2),
    Schema.isMaxLength(10),
  ),
});

export const SaveOnboardingResponsibilities = Schema.Struct({
  expectedRevision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  assignments: ResponsibilityAssignments,
});

export const OnboardingResponsibilities = Schema.Struct({
  id: A.Identifier,
  scope: A.Scope,
  revision: Revision,
  assignments: ResponsibilityAssignments,
  recordedBy: A.Identifier,
  recordedAt: Schema.String,
  digest: A.Digest,
});

export const OnboardingPurpose = Schema.Literals([
  "opening",
  "book_zero",
  "final_delta",
  "activation",
  "first_live",
]);

export const CaptureOnboardingSnapshot = Schema.Struct({
  deltaId: Schema.optional(A.Identifier),
  purpose: OnboardingPurpose,
  controlIds: Schema.Array(A.Identifier).check(Schema.isMaxLength(100)),
  historicalRunIds: Schema.Array(A.Identifier).check(Schema.isMaxLength(100)),
  closingCertificateId: Schema.NullOr(A.Identifier),
});

export const OnboardingComparison = Schema.Struct({
  kind: OnboardingControlKind,
  controlId: A.Identifier,
  accountId: A.Identifier,
  expectedMinor: A.SignedMinorUnits,
  actualMinor: A.SignedMinorUnits,
  differenceMinor: A.SignedMinorUnits,
  explainedMinor: A.SignedMinorUnits,
  unexplainedDifferenceMinor: A.SignedMinorUnits,
  evidenceIds: Schema.Array(A.Identifier),
});

export const OnboardingSnapshot = Schema.Struct({
  id: A.Identifier,
  scope: A.Scope,
  purpose: OnboardingPurpose,
  digest: A.Digest,
  dependencyDigest: A.Digest,
  deltaId: Schema.NullOr(A.Identifier),
  deltaDecisionIds: Schema.Array(A.Identifier),
  caseRevision: Revision,
  bookSequence: A.AggregateMinorUnits,
  writerEpoch: A.AggregateMinorUnits,
  asOf: A.AccountingDate,
  controlIds: Schema.Array(A.Identifier),
  historicalRunIds: Schema.Array(A.Identifier),
  sourceImportPlanIds: Schema.optional(Schema.Array(A.Identifier)),
  closingCertificateId: Schema.NullOr(A.Identifier),
  responsibilityPolicyId: Schema.NullOr(A.Identifier),
  comparisons: Schema.Array(OnboardingComparison),
  blockers: Schema.Array(Schema.String),
  carriedLimitationDecisionIds: Schema.Array(A.Identifier),
  permittedLimitations: Schema.Array(
    Schema.Literals([
      "missing_historical_originals",
      "historical_payroll_retained",
      "missing_tax_statement",
      "unreconciled_bank_difference",
    ]),
  ),
  capturedBy: A.Identifier,
  capturedAt: Schema.String,
});

export const DecideOnboardingSnapshot = Schema.Struct({
  snapshotId: A.Identifier,
  expectedDigest: A.Digest,
  decision: Schema.Union([
    Schema.Struct({
      kind: Schema.Literals([
        "accept_opening",
        "accept_book_zero",
        "accept_final_delta",
        "confirm_activation",
        "reject",
      ]),
      reason: A.Description,
    }),
    Schema.Struct({
      kind: Schema.Literal("accept_limitation"),
      limitation: Schema.Literals([
        "missing_historical_originals",
        "historical_payroll_retained",
        "missing_tax_statement",
        "unreconciled_bank_difference",
      ]),
      reason: A.Description,
    }),
  ]),
});

export const OnboardingAuthorityWitness = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("apiCredential"),
    actorId: A.Identifier,
    credentialHash: Schema.String,
  }),
  Schema.Struct({
    kind: Schema.Literal("betterAuthSession"),
    actorId: A.Identifier,
    sessionId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
  }),
]);

export const OnboardingDecision = Schema.Struct({
  id: A.Identifier,
  scope: A.Scope,
  snapshotId: A.Identifier,
  snapshotDigest: A.Digest,
  decision: DecideOnboardingSnapshot.fields.decision,
  actorId: A.Identifier,
  actorName: Schema.String.check(Schema.isMinLength(1)),
  recordedAt: Schema.String,
  authority: OnboardingAuthorityWitness,
  expiresAt: Schema.String,
});

export const RequestOnboardingActivation = Schema.Struct({
  snapshotId: A.Identifier,
  expectedDigest: A.Digest,
});

export const OnboardingActivationIntent = Schema.Struct({
  id: A.Identifier,
  scope: A.Scope,
  snapshotId: A.Identifier,
  snapshotDigest: A.Digest,
  requestedBy: A.Identifier,
  requestedAt: Schema.String,
  authority: OnboardingAuthorityWitness,
  expiresAt: Schema.String,
});

export const OnboardingOperationalProof = Schema.Struct({
  id: A.Identifier,
  scope: A.Scope,
  snapshotId: A.Identifier,
  snapshotDigest: A.Digest,
  kind: Schema.Literal("synthetic_local_writer_fence_restore_v1"),
  topologyId: Schema.String,
  sourceSystemIdentifier: Schema.String,
  sourceDatabase: Schema.String,
  targetSystemIdentifier: Schema.String,
  targetDatabase: Schema.String,
  observedAt: Schema.String,
  expiresAt: Schema.String,
  artifactDigest: A.Digest,
  writerExclusion: Schema.Literal("old_credentials_denied"),
  acknowledgedEffects: Schema.Literal("reconciled"),
  applicationRecovery: Schema.Literal("restricted_reads_verified"),
  restrictedWrites: Schema.Literal("denied"),
  configurationRecovery: Schema.Literal("exercised"),
  originalClosure: Schema.Literal("verified"),
  externalProviders: Schema.Literal("absent"),
  recoveryElapsedMs: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});

export const OnboardingPerson = Schema.Struct({
  id: A.Identifier,
  name: Schema.String,
  enabled: Schema.Boolean,
  role: Schema.String,
});

export const OnboardingProjection = Schema.Struct({
  companyName: Schema.String,
  people: Schema.Array(OnboardingPerson),
  accounts: Schema.Array(
    Schema.Struct({ id: A.Identifier, code: Schema.String, name: Schema.String }),
  ),
  companyFacts: Profiles.CompanyFactPage.fields.items,
  activations: Schema.Array(Profiles.CompanyActivation),
  ruleReleases: Schema.Array(Profiles.RuleRelease),
  sources: Schema.Array(OnboardingSource),
  importPreviews: Schema.Array(Sie.SiePreview),
  importPlans: Schema.Array(Sie.SiePlan),
  invoices: Schema.Array(Commerce.Invoice),
  bankStatements: Schema.Array(Bank.BankStatement),
  counts: Schema.Struct({
    retainedVouchers: Schema.Int,
    importedVouchers: Schema.Int,
    customerInvoices: Schema.Int,
    supplierInvoices: Schema.Int,
    bankObservations: Schema.Int,
    retainedOriginals: Schema.NullOr(Schema.Int),
    assets: Schema.NullOr(Schema.Int),
  }),
});

export const OnboardingActivationSummary = Schema.Struct({
  companyName: OnboardingProjection.fields.companyName,
  people: OnboardingProjection.fields.people,
  companyFacts: OnboardingProjection.fields.companyFacts,
  activations: OnboardingProjection.fields.activations,
  ruleReleases: OnboardingProjection.fields.ruleReleases,
  counts: OnboardingProjection.fields.counts,
});

export const OnboardingActivationReceipt = Schema.Struct({
  id: A.Identifier,
  scope: A.Scope,
  intentId: A.Identifier,
  projection: OnboardingActivationSummary,
  acceptedLimitations: Schema.Array(OnboardingDecision),
  snapshot: OnboardingSnapshot,
  operationalProof: OnboardingOperationalProof,
  confirmations: Schema.Array(OnboardingDecision),
  authoritativeFrom: A.AccountingDate,
  activatedAt: Schema.String,
  activatedBy: A.Identifier,
  previousEpoch: A.AggregateMinorUnits,
  promotedEpoch: A.AggregateMinorUnits,
  kind: Schema.Literal("synthetic_onboarding_activation_v1"),
  statutoryReady: Schema.Literal(false),
});

export const CompleteOnboardingFirstPeriod = Schema.Struct({
  snapshotId: A.Identifier,
  expectedDigest: A.Digest,
});

export const OnboardingFirstPeriodCompletion = Schema.Struct({
  id: A.Identifier,
  scope: A.Scope,
  activationReceiptId: A.Identifier,
  snapshot: OnboardingSnapshot,
  closingCertificateId: A.Identifier,
  completedBy: A.Identifier,
  completedAt: Schema.String,
  kind: Schema.Literal("synthetic_first_live_period_v1"),
  statutoryReady: Schema.Literal(false),
});

export const OnboardingLifecycle = Schema.Struct({
  scope: A.Scope,
  projection: OnboardingProjection,
  viewerActorId: A.Identifier,
  people: Schema.Array(
    Schema.Struct({
      id: A.Identifier,
      name: Schema.String,
      enabled: Schema.Boolean,
      role: Schema.String,
      affiliation: Schema.Literals(["company", "bureau"]),
    }),
  ),
  controls: Schema.Array(OnboardingControl),
  responsibilities: Schema.NullOr(OnboardingResponsibilities),
  snapshots: Schema.Array(Schema.Struct({ snapshot: OnboardingSnapshot, current: Schema.Boolean })),
  decisions: Schema.Array(OnboardingDecision),
  intents: Schema.Array(OnboardingActivationIntent),
  activation: Schema.NullOr(OnboardingActivationReceipt),
  completion: Schema.NullOr(
    Schema.Struct({ receipt: OnboardingFirstPeriodCompletion, current: Schema.Boolean }),
  ),
});

export const OnboardingActivationArtifact = Schema.Struct({
  receiptId: A.Identifier,
  filename: Schema.String,
  mediaType: Schema.Literal("application/pdf"),
  contentBase64: Schema.String,
});

const base = "/v1/entities/:entityId/books/:bookId/onboarding";

const scoped = { params: A.Scope, error: accountingErrors };

const mutation = { ...scoped, headers: A.IdempotencyHeaders };

export const OnboardingApi = HttpApiGroup.make("onboarding")
  .annotate(HttpApi.PayloadParseOptions, { onExcessProperty: "error" })
  .add(
    HttpApiEndpoint.get("getOnboardingImportBatch", `${base}/import-batches`, {
      ...scoped,
      query: Schema.Struct({ financialRunId: A.Identifier }),
      success: OnboardingImportBatchWorkspace,
    }),
    HttpApiEndpoint.post("prepareOnboardingImportBatch", `${base}/import-batches`, {
      ...mutation,
      payload: PrepareOnboardingImportBatch,
      success: OnboardingImportBatch,
    }),
    HttpApiEndpoint.post("approveOnboardingImportBatch", `${base}/import-batch-approvals`, {
      ...mutation,
      payload: ApproveOnboardingImportBatch,
      success: OnboardingImportBatchApproval,
    }),
    HttpApiEndpoint.post("executeOnboardingImportBatch", `${base}/import-batch-executions`, {
      ...mutation,
      payload: ExecuteOnboardingImportBatch,
      success: Historical.Chunk,
    }),
    HttpApiEndpoint.post("startOnboardingImport", `${base}/imports`, {
      ...mutation,
      payload: StartOnboardingImport,
      success: OnboardingImportStart,
    }),
    HttpApiEndpoint.post("prepareOnboardingImportPlan", `${base}/import-plans`, {
      ...mutation,
      payload: PrepareOnboardingImportPlan,
      success: Sie.SiePlan,
    }),
    HttpApiEndpoint.get("getOnboarding", base, {
      ...scoped,
      query: Schema.Struct({
        sourceAfter: Schema.optional(A.Identifier),
        importAfter: Schema.optional(A.Identifier),
      }),
      success: OnboardingWorkspace,
    }),
    HttpApiEndpoint.get("getOnboardingActivationArtifact", `${base}/activation-artifact`, {
      ...scoped,
      success: OnboardingActivationArtifact,
    }),
    HttpApiEndpoint.get("getOnboardingLifecycle", `${base}/lifecycle`, {
      ...scoped,
      success: OnboardingLifecycle,
    }),
    HttpApiEndpoint.post("qualifyOnboardingControl", `${base}/controls`, {
      ...mutation,
      payload: QualifyOnboardingControl,
      success: OnboardingControl,
    }),
    HttpApiEndpoint.post("saveOnboardingResponsibilities", `${base}/responsibilities`, {
      ...mutation,
      payload: SaveOnboardingResponsibilities,
      success: OnboardingResponsibilities,
    }),
    HttpApiEndpoint.post("captureOnboardingSnapshot", `${base}/snapshots`, {
      ...mutation,
      payload: CaptureOnboardingSnapshot,
      success: OnboardingSnapshot,
    }),
    HttpApiEndpoint.post("decideOnboardingSnapshot", `${base}/decisions`, {
      ...mutation,
      payload: DecideOnboardingSnapshot,
      success: OnboardingDecision,
    }),
    HttpApiEndpoint.post("requestOnboardingActivation", `${base}/activation-intents`, {
      ...mutation,
      payload: RequestOnboardingActivation,
      success: OnboardingActivationIntent,
    }),
    HttpApiEndpoint.post("completeOnboardingFirstPeriod", `${base}/first-period-completions`, {
      ...mutation,
      payload: CompleteOnboardingFirstPeriod,
      success: OnboardingFirstPeriodCompletion,
    }),
    HttpApiEndpoint.post("startOnboarding", base, {
      ...mutation,
      payload: StartOnboarding,
      success: OnboardingCase,
    }),
    HttpApiEndpoint.post("saveOnboarding", `${base}/revisions`, {
      ...mutation,
      payload: SaveOnboarding,
      success: OnboardingCase,
    }),
    HttpApiEndpoint.get("getOnboardingHistory", `${base}/revisions`, {
      ...scoped,
      query: Schema.Struct({
        before: Schema.optional(
          Schema.NumberFromString.check(Schema.isInt(), Schema.isGreaterThan(0)),
        ),
      }),
      success: OnboardingHistory,
    }),
    HttpApiEndpoint.post("attachOnboardingSource", `${base}/sources`, {
      ...mutation,
      payload: AttachOnboardingSource,
      success: OnboardingSource,
    }),
  );
