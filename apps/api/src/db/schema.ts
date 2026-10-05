import type { OriginalDimensionStatus } from "@open-erp/domain/dimensions";
import type { WorkChildState } from "@open-erp/domain/period-work";
import type { IdentityProvisioning } from "@open-erp/contracts/identity";
import type * as Recovery from "@open-erp/contracts/posting-recovery";
import type * as Schema from "effect/Schema";
import { sql } from "drizzle-orm";
import {
  mqDedupe,
  mqFlowChildren,
  mqFlowOutbox,
  mqJobAttempts,
  mqJobs,
  mqQueueControl,
  mqSchedules,
} from "effect-mq/drizzle-postgres";
import {
  bigint,
  boolean,
  date,
  integer,
  jsonb,
  numeric,
  pgSchema,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

// Query mappings for tables accessed by maintenance code. Versioned SQL migrations own
// DDL, grants, constraints, triggers and accounting functions; this is not a push schema.
const openerp = pgSchema("openerp");

// effect-mq owns queue writes; reviewed SQL migrations own the matching DDL.
export const jobs = mqJobs<"preparation">();

export const jobAttempts = mqJobAttempts(jobs);

export const jobSchedules = mqSchedules<"preparation">();

export const jobQueues = mqQueueControl();

export const jobDedupe = mqDedupe<"preparation">();

export const jobFlowChildren = mqFlowChildren();

export const jobFlowOutbox = mqFlowOutbox();

export const migrations = pgTable("openerp_migrations", {
  name: text().primaryKey(),
  sha256: text().notNull(),
  appliedAt: timestamp("applied_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});

export const entities = openerp.table("entities", {
  id: text().primaryKey(),
  name: text().notNull(),
});

export const books = openerp.table("books", {
  id: text().primaryKey(),
  entityId: text("entity_id").notNull(),
  name: text().notNull(),
  currency: text().notNull(),
  currencyScale: integer("currency_scale").notNull(),
  profile: text().notNull(),
  profileVersion: bigint("profile_version", { mode: "bigint" }).notNull().default(1n),
  writerEpoch: bigint("writer_epoch", { mode: "bigint" }).notNull().default(1n),
  authority: text().notNull().default("native"),
  committedSequence: bigint("committed_sequence", { mode: "bigint" }).notNull().default(0n),
});

export const actors = openerp.table("actors", {
  id: text().primaryKey(),
  name: text().notNull(),
});

export const onboardingCases = openerp.table("onboarding_cases", {
  bookId: text("book_id").notNull(),
  id: text().notNull(),
  path: text().notNull(),
  recordClass: text("record_class").notNull(),
  recordedBy: text("recorded_by").notNull(),
});

export const onboardingRevisions = openerp.table("onboarding_revisions", {
  bookId: text("book_id").notNull(),
  caseId: text("case_id").notNull(),
  revision: integer().notNull(),
  body: jsonb().$type<Schema.JsonObject>().notNull(),
});

export const onboardingSources = openerp.table("onboarding_sources", {
  bookId: text("book_id").notNull(),
  caseId: text("case_id").notNull(),
  id: text().notNull(),
  occurrenceId: text("occurrence_id").notNull(),
  category: text().notNull(),
  body: jsonb().$type<Schema.JsonObject>().notNull(),
});

export const onboardingControls = openerp.table("onboarding_controls", {
  bookId: text("book_id").notNull(),
  id: text().notNull(),
  snapshotId: text("snapshot_id"),
  body: jsonb().$type<Schema.JsonObject>().notNull(),
});

export const onboardingResponsibilities = openerp.table("onboarding_responsibilities", {
  bookId: text("book_id").notNull(),
  id: text().notNull(),
  snapshotId: text("snapshot_id"),
  body: jsonb().$type<Schema.JsonObject>().notNull(),
});

export const onboardingSnapshots = openerp.table("onboarding_snapshots", {
  bookId: text("book_id").notNull(),
  id: text().notNull(),
  snapshotId: text("snapshot_id"),
  body: jsonb().$type<Schema.JsonObject>().notNull(),
});

export const onboardingDecisions = openerp.table("onboarding_decisions", {
  bookId: text("book_id").notNull(),
  id: text().notNull(),
  snapshotId: text("snapshot_id"),
  body: jsonb().$type<Schema.JsonObject>().notNull(),
});

export const onboardingActivationIntents = openerp.table("onboarding_activation_intents", {
  bookId: text("book_id").notNull(),
  id: text().notNull(),
  snapshotId: text("snapshot_id"),
  body: jsonb().$type<Schema.JsonObject>().notNull(),
});

export const onboardingOperationalProofs = openerp.table("onboarding_operational_proofs", {
  bookId: text("book_id").notNull(),
  id: text().notNull(),
  snapshotId: text("snapshot_id"),
  body: jsonb().$type<Schema.JsonObject>().notNull(),
});

export const onboardingActivationReceipts = openerp.table("onboarding_activation_receipts", {
  bookId: text("book_id").notNull(),
  id: text().notNull(),
  snapshotId: text("snapshot_id"),
  body: jsonb().$type<Schema.JsonObject>().notNull(),
});

export const onboardingFirstPeriodCompletions = openerp.table(
  "onboarding_first_period_completions",
  {
    bookId: text("book_id").notNull(),
    id: text().notNull(),
    snapshotId: text("snapshot_id"),
    body: jsonb().$type<Schema.JsonObject>().notNull(),
  },
);

export const credentials = openerp.table("credentials", {
  tokenHash: text("token_hash").primaryKey(),
  actorId: text("actor_id").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "string" }),
});

export const memberships = openerp.table("memberships", {
  bookId: text("book_id").notNull(),
  actorId: text("actor_id").notNull(),
  role: text({ enum: ["operator", "agent"] }).notNull(),
});

export const fiscalYears = openerp.table("fiscal_years", {
  bookId: text("book_id").notNull(),
  id: text().notNull(),
  startsOn: date("starts_on", { mode: "string" }).notNull(),
  endsOn: date("ends_on", { mode: "string" }).notNull(),
});

export const periods = openerp.table("periods", {
  bookId: text("book_id").notNull(),
  id: text().notNull(),
  fiscalYearId: text("fiscal_year_id").notNull(),
  startsOn: date("starts_on", { mode: "string" }).notNull(),
  endsOn: date("ends_on", { mode: "string" }).notNull(),
  locked: boolean().notNull().default(false),
  version: bigint({ mode: "bigint" }).notNull().default(1n),
});

export const accounts = openerp.table("accounts", {
  bookId: text("book_id").notNull(),
  id: text().notNull(),
  code: text().notNull(),
  name: text().notNull(),
  active: boolean().notNull().default(true),
  version: bigint({ mode: "bigint" }).notNull().default(1n),
});

export const ruleReleases = openerp.table("rule_releases", {
  id: text().primaryKey(),
  jurisdiction: text().notNull(),
  family: text().notNull(),
  version: integer().notNull(),
  checksum: text().notNull(),
  body: jsonb("body").$type<Schema.JsonObject>().notNull(),
});

export const companyFactRevisions = openerp.table("company_fact_revisions", {
  entityId: text("entity_id").notNull(),
  id: text().notNull(),
  factKind: text("fact_kind").notNull(),
  effectiveFrom: date("effective_from", { mode: "string" }).notNull(),
  effectiveTo: date("effective_to", { mode: "string" }),
  supersedesId: text("supersedes_id"),
  recordedBy: text("recorded_by").notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true, mode: "string" }).notNull(),
  digest: text().notNull(),
  body: jsonb("body").$type<Schema.JsonObject>().notNull(),
});

export const companyFactReviews = openerp.table("company_fact_reviews", {
  entityId: text("entity_id").notNull(),
  factRevisionId: text("fact_revision_id").notNull(),
  reviewer: text().notNull(),
  result: text().notNull(),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true, mode: "string" }).notNull(),
  digest: text().notNull(),
  body: jsonb("body").$type<Schema.JsonObject>().notNull(),
});

export const companyRoleBindings = openerp.table("company_role_bindings", {
  bookId: text("book_id").notNull(),
  id: text().notNull(),
  roleKind: text("role_kind").notNull(),
  accountId: text("account_id").notNull(),
  accountVersion: bigint("account_version", { mode: "bigint" }).notNull(),
  effectiveFrom: date("effective_from", { mode: "string" }).notNull(),
  effectiveTo: date("effective_to", { mode: "string" }),
  supersedesId: text("supersedes_id"),
  reviewer: text().notNull(),
  recordedBy: text("recorded_by").notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true, mode: "string" }).notNull(),
  digest: text().notNull(),
  body: jsonb("body").$type<Schema.JsonObject>().notNull(),
});

export const companyFamilyMemberships = openerp.table("company_family_memberships", {
  bookId: text("book_id").notNull(),
  family: text().notNull(),
  membershipEpoch: bigint("membership_epoch", { mode: "bigint" }).notNull().default(1n),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
});

export const companyActivations = openerp.table("company_activations", {
  bookId: text("book_id").notNull(),
  id: text().notNull(),
  family: text().notNull(),
  ruleReleaseId: text("rule_release_id").notNull(),
  changeSetId: text("change_set_id"),
  effectiveFrom: date("effective_from", { mode: "string" }).notNull(),
  effectiveTo: date("effective_to", { mode: "string" }),
  activatedBy: text("activated_by").notNull(),
  activatedAt: timestamp("activated_at", { withTimezone: true, mode: "string" }).notNull(),
  digest: text().notNull(),
  body: jsonb("body").$type<Schema.JsonObject>().notNull(),
});

export const companyActivationImpacts = openerp.table("company_activation_impacts", {
  bookId: text("book_id").notNull(),
  id: text().notNull(),
  factRevisionId: text("fact_revision_id").notNull(),
  supersededRevisionId: text("superseded_revision_id").notNull(),
  activationId: text("activation_id").notNull(),
  alreadyInForce: boolean("already_in_force").notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true, mode: "string" }).notNull(),
  digest: text().notNull(),
  body: jsonb("body").$type<Schema.JsonObject>().notNull(),
});

export const ruleChangeNotices = openerp.table("rule_change_notices", {
  bookId: text("book_id").notNull(),
  id: text().notNull(),
  oldReleaseId: text("old_release_id").notNull(),
  newReleaseId: text("new_release_id").notNull(),
  changeKind: text("change_kind").notNull(),
  effectiveFrom: date("effective_from", { mode: "string" }).notNull(),
  effectiveTo: date("effective_to", { mode: "string" }),
  reason: text().notNull(),
  qualificationEvidence: jsonb("qualification_evidence").$type<Schema.JsonObject>().notNull(),
  changedSelectors: text("changed_selectors").array().notNull(),
  capturedBy: text("captured_by").notNull(),
  capturedAt: timestamp("captured_at", { withTimezone: true, mode: "string" }).notNull(),
  digest: text().notNull(),
  body: jsonb("body").$type<Schema.JsonObject>().notNull(),
});

export const ruleImpactSnapshots = openerp.table("rule_impact_snapshots", {
  bookId: text("book_id").notNull(),
  id: text().notNull(),
  noticeId: text("notice_id").notNull(),
  recordedCutoff: timestamp("recorded_cutoff", { withTimezone: true, mode: "string" }).notNull(),
  completeTargetMembership: boolean("complete_target_membership").notNull(),
  totalTargets: integer("total_targets").notNull(),
  coveredOwners: text("covered_owners").array().notNull(),
  uncoveredOwners: text("uncovered_owners").array().notNull(),
  body: jsonb("body").$type<Schema.JsonObject>().notNull(),
});

export const ruleImpactTargets = openerp.table("rule_impact_targets", {
  bookId: text("book_id").notNull(),
  snapshotId: text("snapshot_id").notNull(),
  ordinal: integer("ordinal").notNull(),
  targetKind: text("target_kind").notNull(),
  targetId: text("target_id").notNull(),
  targetRevision: text("target_revision").notNull(),
  family: text().notNull(),
  periodId: text("period_id"),
  periodStartsOn: date("period_starts_on", { mode: "string" }),
  periodEndsOn: date("period_ends_on", { mode: "string" }),
  usedRule: text("used_rule").notNull(),
  basisDigest: text("basis_digest").notNull(),
  impactKind: text("impact_kind").notNull(),
  body: jsonb("body").$type<Schema.JsonObject>().notNull(),
});

export const ruleImpactDecisions = openerp.table("rule_impact_decisions", {
  bookId: text("book_id").notNull(),
  id: text().notNull(),
  snapshotId: text("snapshot_id").notNull(),
  noticeId: text("notice_id").notNull(),
  targetKind: text("target_kind").notNull(),
  targetId: text("target_id").notNull(),
  targetRevision: text("target_revision").notNull(),
  decisionKind: text("decision_kind").notNull(),
  reason: text().notNull(),
  evidence: jsonb("evidence").$type<Schema.JsonObject>().notNull(),
  proposedSuccessor: jsonb("proposed_successor").$type<Schema.JsonObject>(),
  reviewer: text("reviewer").notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true, mode: "string" }).notNull(),
  digest: text().notNull(),
  body: jsonb("body").$type<Schema.JsonObject>().notNull(),
});

export const deadlineFulfillments = openerp.table("deadline_fulfillments", {
  bookId: text("book_id").notNull(),
  id: text().notNull(),
  obligationId: text("obligation_id").notNull(),
  obligationRevision: bigint("obligation_revision", { mode: "bigint" }).notNull(),
  referenceDigest: text("reference_digest").notNull(),
  verificationOrdinal: bigint("verification_ordinal", { mode: "bigint" }).notNull().default(1n),
  evidenceDigest: text("evidence_digest"),
  outcomeKind: text("outcome_kind").notNull(),
  referenceKind: text("reference_kind").notNull(),
  reference: jsonb("reference").$type<Schema.JsonObject>().notNull(),
  environment: text().notNull(),
  verification: text().notNull(),
  reason: text().notNull(),
  witness: jsonb("witness").$type<Schema.JsonObject>().notNull(),
  recordedBy: text("recorded_by").notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true, mode: "string" }).notNull(),
  digest: text().notNull(),
  body: jsonb("body").$type<Schema.JsonObject>().notNull(),
});

export const identityProvisioningReceipts = openerp.table("identity_provisioning_receipts", {
  requestId: text("request_id").primaryKey(),
  manifest: jsonb("manifest").$type<typeof IdentityProvisioning.Type>().notNull(),
});

export const identityAdmissions = openerp.table("identity_admissions", {
  actorId: text("actor_id").primaryKey(),
  providerId: text("provider_id").notNull(),
  subject: text().notNull(),
  enabled: boolean().notNull(),
});

export const evidence = openerp.table("evidence", {
  bookId: text("book_id").notNull(),
  id: text().primaryKey(),
  title: text().notNull(),
  content: text().notNull(),
  mediaType: text("media_type").notNull(),
  origin: text().notNull(),
  sha256: text().notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
});

export const events = openerp.table("events", {
  bookId: text("book_id").notNull(),
  id: text().notNull(),
  evidenceId: text("evidence_id").notNull(),
  eventKey: text("event_key").notNull(),
});

export const changeSets = openerp.table("change_sets", {
  bookId: text("book_id").notNull(),
  id: text().notNull(),
  plan: jsonb("plan").$type<Schema.JsonObject>().notNull(),
  digest: text().notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});

export const approvals = openerp.table("approvals", {
  bookId: text("book_id").notNull(),
  id: text().notNull(),
  changeSetId: text("change_set_id").notNull(),
  digest: text().notNull(),
  actorId: text("actor_id").notNull(),
  authorityBasis: jsonb("authority_basis").$type<Schema.JsonObject>().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true, mode: "string" }),
});

export const seriesCounters = openerp.table("series_counters", {
  bookId: text("book_id").notNull(),
  fiscalYearId: text("fiscal_year_id").notNull(),
  series: text().notNull(),
  lastNumber: bigint("last_number", { mode: "bigint" }).notNull(),
});

export const vouchers = openerp.table("vouchers", {
  bookId: text("book_id").notNull(),
  id: text().notNull(),
  fiscalYearId: text("fiscal_year_id").notNull(),
  periodId: text("period_id").notNull(),
  series: text().notNull(),
  number: bigint("number", { mode: "bigint" }).notNull(),
  sequence: bigint("sequence", { mode: "bigint" }).notNull(),
  postingDate: date("posting_date", { mode: "string" }).notNull(),
  eventId: text("event_id").notNull(),
  postingPurpose: text("posting_purpose").notNull(),
  occurrenceKey: text("occurrence_key").notNull(),
  correctsVoucherId: text("corrects_voucher_id"),
  changeSetId: text("change_set_id").notNull(),
  action: jsonb("action").$type<Schema.JsonObject>().notNull(),
  expectedLineCount: integer("expected_line_count").notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true, mode: "string" })
    .notNull()
    .defaultNow(),
});

export const journalLines = openerp.table("journal_lines", {
  bookId: text("book_id").notNull(),
  voucherId: text("voucher_id").notNull(),
  id: text().notNull(),
  ordinal: integer().notNull(),
  accountId: text("account_id").notNull(),
  debitMinor: numeric("debit_minor", { mode: "string" }).notNull(),
  creditMinor: numeric("credit_minor", { mode: "string" }).notNull(),
  description: text().notNull(),
});

// NEXT-14. One immutable row per posted line and per dimension effective at that
// line's posting date. Immutable original assignments are never rewritten, and
// the four recorded states stay distinguishable.
export const journalLineDimensions = openerp.table("journal_line_dimensions", {
  bookId: text("book_id").notNull(),
  voucherId: text("voucher_id").notNull(),
  lineId: text("line_id").notNull(),
  dimensionCode: text("dimension_code").notNull(),
  dimensionRevision: integer("dimension_revision").notNull(),
  // The reviewed baseline constrains this column to exactly the four original
  // states, so the column carries that vocabulary rather than a bare string.
  status: text().$type<OriginalDimensionStatus>().notNull(),
  valueCode: text("value_code"),
  valueRevision: integer("value_revision"),
  capturedLabel: text("captured_label").notNull(),
  exemptionEvidenceId: text("exemption_evidence_id"),
  sourceValueCode: text("source_value_code"),
  inheritedFromVoucherId: text("inherited_from_voucher_id"),
  inheritedFromLineId: text("inherited_from_line_id"),
  recordedAt: timestamp("recorded_at", { withTimezone: true, mode: "string" })
    .notNull()
    .defaultNow(),
});

// NEXT-43. Reviewed classification history beside the immutable original
// assignments. A revision is the complete reviewed assignment set for one
// posted line at one analytical scope, and is never rewritten. The head is the
// current pointer and the only mutable row.
export const dimensionClassificationRevisions = openerp.table(
  "dimension_classification_revisions",
  {
    bookId: text("book_id").notNull(),
    voucherId: text("voucher_id").notNull(),
    lineId: text("line_id").notNull(),
    revisionId: integer("revision_id").notNull(),
    analyticalScope: text("analytical_scope").notNull(),
    reason: text("reason").notNull(),
    // The complete reviewed assignment set, stored as a JSON array. The
    // reviewed baseline requires an array here, so a partial set cannot be
    // smuggled in as a scalar.
    assignments: jsonb("assignments").$type<ReadonlyArray<Schema.JsonObject>>().notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
);

export const dimensionClassificationHeads = openerp.table("dimension_classification_heads", {
  bookId: text("book_id").notNull(),
  voucherId: text("voucher_id").notNull(),
  lineId: text("line_id").notNull(),
  revisionId: integer("revision_id").notNull(),
  version: integer("version").notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true, mode: "string" })
    .notNull()
    .defaultNow(),
});

// NEXT-43. A prepared restatement plan is retained immutably so the apply step
// records exactly the preview a reviewer approved.
export const dimensionRestatementPlans = openerp.table("dimension_restatement_plans", {
  bookId: text("book_id").notNull(),
  id: text("id").notNull(),
  analyticalScope: text("analytical_scope").notNull(),
  reason: text("reason").notNull(),
  digest: text("digest").notNull(),
  plan: jsonb("plan").$type<Schema.JsonObject>().notNull(),
  // The posted lines the plan covers, as {lineId, voucherId}.
  selection: jsonb("selection").$type<ReadonlyArray<Schema.JsonObject>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});

export const executionReceipts = openerp.table("execution_receipts", {
  bookId: text("book_id").notNull(),
  id: text().notNull(),
  changeSetId: text("change_set_id").notNull(),
  voucherId: text("voucher_id").notNull(),
  approvalId: text("approval_id").notNull(),
  body: jsonb("body").$type<Schema.JsonObject>().notNull(),
});

export const commandReceipts = openerp.table("command_receipts", {
  bookId: text("book_id").notNull(),
  key: text().notNull(),
  requestDigest: text("request_digest").notNull(),
  operation: text().notNull(),
  actorId: text("actor_id").notNull(),
  result: jsonb("result").$type<Schema.JsonObject>().notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true, mode: "string" })
    .notNull()
    .defaultNow(),
});

export const periodWorkExecutionResults = openerp.table("period_work_execution_results", {
  bookId: text("book_id").notNull(),
  batchId: text("batch_id").notNull(),
  commandKey: text("command_key").notNull(),
  actorId: text("actor_id").notNull(),
  body: jsonb().$type<Schema.JsonObject>().notNull(),
});

export const outbox = openerp.table("outbox", {
  bookId: text("book_id").notNull(),
  id: text().notNull(),
  receiptId: text("receipt_id").notNull(),
  kind: text().notNull(),
  payload: jsonb("payload").$type<object>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  deliveredAt: timestamp("delivered_at", { withTimezone: true, mode: "string" }),
  attempts: integer().notNull().default(0),
});

export const postingSavedRequests = openerp.table("posting_saved_requests", {
  bookId: text("book_id").notNull(),
  key: text().notNull(),
  actorId: text("actor_id").notNull(),
  command: jsonb("command").$type<typeof Recovery.SavedPostingCommand.Type>().notNull(),
  digest: text().notNull(),
  commandKey: text("command_key").notNull(),
  savedAt: timestamp("saved_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});

export const postingRequestOutcomes = openerp.table("posting_request_outcomes", {
  bookId: text("book_id").notNull(),
  key: text().notNull(),
  state: text().notNull(),
  result: jsonb("result").$type<Schema.JsonObject | null>(),
  refusal: jsonb("refusal").$type<{ readonly code: string; readonly message: string } | null>(),
  recordedAt: timestamp("recorded_at", { withTimezone: true, mode: "string" })
    .notNull()
    .defaultNow(),
});

export const postingRequestAttempts = openerp.table("posting_request_attempts", {
  bookId: text("book_id").notNull(),
  key: text().notNull(),
  attempt: integer().notNull(),
  state: text().notNull(),
  result: jsonb("result").$type<Schema.JsonObject | null>(),
  refusal: jsonb("refusal").$type<{ readonly code: string; readonly message: string } | null>(),
  recordedAt: timestamp("recorded_at", { withTimezone: true, mode: "string" })
    .notNull()
    .defaultNow(),
});

export const postingApprovalRevocations = openerp.table("posting_approval_revocations", {
  bookId: text("book_id").notNull(),
  approvalId: text("approval_id").notNull(),
  actorId: text("actor_id").notNull(),
  reason: text().notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});

export const correctionImpactReviews = openerp.table("correction_impact_reviews", {
  bookId: text("book_id").notNull(),
  id: text().notNull(),
  voucherId: text("voucher_id").notNull(),
  body: jsonb("body").$type<Schema.JsonObject>().notNull(),
});

export const postingGroupReceipts = openerp.table("posting_group_receipts", {
  bookId: text("book_id").notNull(),
  id: text().notNull(),
  changeSetId: text("change_set_id").notNull(),
  groupId: text("group_id").notNull(),
  planDigest: text("plan_digest").notNull(),
  body: jsonb("body").$type<Schema.JsonObject>().notNull(),
  committedAt: timestamp("committed_at", { withTimezone: true, mode: "string" }).notNull(),
});

export const approvalConsumptions = openerp.table("approval_consumptions", {
  bookId: text("book_id").notNull(),
  approvalId: text("approval_id").notNull(),
  changeSetId: text("change_set_id").notNull(),
  groupId: text("group_id").notNull(),
  planDigest: text("plan_digest").notNull(),
  receiptId: text("receipt_id").notNull(),
  approverId: text("approver_id").notNull(),
  consumedById: text("consumed_by_id").notNull(),
  approverBasis: jsonb("approver_basis").$type<Schema.JsonObject>().notNull(),
  executorBasis: jsonb("executor_basis").$type<Schema.JsonObject>().notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true, mode: "string" }).notNull(),
});

export const correctionBundles = openerp.table("correction_bundles", {
  bookId: text("book_id").notNull(),
  id: text().notNull(),
  originalVoucherId: text("original_voucher_id").notNull(),
  reversalChangeSetId: text("reversal_change_set_id").notNull(),
  replacementChangeSetId: text("replacement_change_set_id").notNull(),
  body: jsonb("body").$type<Schema.JsonObject>().notNull(),
  digest: text().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});

export const correctionBundleApprovals = openerp.table("correction_bundle_approvals", {
  bookId: text("book_id").notNull(),
  id: text().notNull(),
  bundleId: text("bundle_id").notNull(),
  reversalApprovalId: text("reversal_approval_id").notNull(),
  replacementApprovalId: text("replacement_approval_id").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }).notNull(),
  body: jsonb("body").$type<Schema.JsonObject>().notNull(),
});

export const reportStatementSnapshots = openerp.table("report_statement_snapshots", {
  bookId: text("book_id").notNull(),
  id: text().notNull(),
  fiscalYearId: text("fiscal_year_id").notNull(),
  asOf: date("as_of", { mode: "string" }).notNull(),
  sequence: bigint("sequence", { mode: "bigint" }).notNull(),
  body: jsonb("body").$type<Schema.JsonObject>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});

export const reportStatementRows = openerp.table("report_statement_rows", {
  bookId: text("book_id").notNull(),
  snapshotId: text("snapshot_id").notNull(),
  ordinal: integer("ordinal").notNull(),
  rowId: text("row_id").notNull(),
  body: jsonb("body").$type<Schema.JsonObject>().notNull(),
});

export const reportStatementContributions = openerp.table("report_statement_contributions", {
  bookId: text("book_id").notNull(),
  snapshotId: text("snapshot_id").notNull(),
  ordinal: integer("ordinal").notNull(),
  rowId: text("row_id").notNull(),
  componentId: text("component_id").notNull(),
  body: jsonb("body").$type<Schema.JsonObject>().notNull(),
});

export const sieBookExports = openerp.table("sie_book_exports", {
  bookId: text("book_id").notNull(),
  id: text().notNull(),
  ordinal: bigint("ordinal", { mode: "bigint" }).notNull(),
  fiscalYearId: text("fiscal_year_id").notNull(),
  asOf: date("as_of", { mode: "string" }).notNull(),
  sequence: bigint("sequence", { mode: "bigint" }).notNull(),
  evidenceId: text("evidence_id").notNull(),
  actorId: text("actor_id").notNull(),
  body: jsonb("body").$type<Schema.JsonObject>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});

export const sieBookExportRows = openerp.table("sie_book_export_rows", {
  bookId: text("book_id").notNull(),
  exportId: text("export_id").notNull(),
  ordinal: integer("ordinal").notNull(),
  rowId: text("row_id").notNull(),
  body: jsonb("body").$type<Schema.JsonObject>().notNull(),
});

export const correctionBundleReceipts = openerp.table("correction_bundle_receipts", {
  bookId: text("book_id").notNull(),
  bundleId: text("bundle_id").notNull(),
  originalVoucherId: text("original_voucher_id").notNull(),
  approvalId: text("approval_id").notNull(),
  reversalReceiptId: text("reversal_receipt_id").notNull(),
  replacementReceiptId: text("replacement_receipt_id").notNull(),
  body: jsonb("body").$type<Schema.JsonObject>().notNull(),
});

// A frozen payroll calculation is a captured proposal. It never carries a
// financial effect; execution and payment are separate named operations.
export const payrollEmployees = openerp.table("payroll_employees", {
  bookId: text("book_id").notNull(),
  id: text("id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});

export const payrollRevisions = openerp.table("payroll_revisions", {
  bookId: text("book_id").notNull(),
  id: text("id").notNull(),
  commandKey: text("command_key").notNull(),
  employeeId: text("employee_id").notNull(),
  kind: text("kind").notNull(),
  effectiveOn: date("effective_on", { mode: "string" }).notNull(),
  supersedes: text("supersedes"),
  evidenceId: text("evidence_id").notNull(),
  body: jsonb("body").$type<Schema.JsonObject>().notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});

export const payrollCurrentRevisions = openerp.table("payroll_current_revisions", {
  bookId: text("book_id").notNull(),
  employeeId: text("employee_id").notNull(),
  kind: text("kind").notNull(),
  effectiveOn: date("effective_on", { mode: "string" }).notNull(),
  revisionId: text("revision_id").notNull(),
});

export const payrollCalculations = openerp.table("payroll_calculations", {
  bookId: text("book_id").notNull(),
  id: text("id").notNull(),
  employeeId: text("employee_id").notNull(),
  revision: integer("revision").notNull(),
  changeSetId: text("change_set_id").notNull(),
  planDigest: text("plan_digest").notNull(),
  ruleReleaseId: text("rule_release_id").notNull(),
  earningsPeriodStart: date("earnings_period_start", { mode: "string" }).notNull(),
  earningsPeriodEnd: date("earnings_period_end", { mode: "string" }).notNull(),
  expectedPaymentOn: date("expected_payment_on", { mode: "string" }).notNull(),
  grossMinor: numeric("gross_minor", { mode: "string" }).notNull(),
  withholdingMinor: numeric("withholding_minor", { mode: "string" }).notNull(),
  netDeductionMinor: numeric("net_deduction_minor", { mode: "string" }).notNull(),
  contributionBaseMinor: numeric("contribution_base_minor", { mode: "string" }).notNull(),
  employerContributionMinor: numeric("employer_contribution_minor", { mode: "string" }).notNull(),
  payableMinor: numeric("payable_minor", { mode: "string" }).notNull(),
  noFinancialEffect: boolean("no_financial_effect").notNull(),
  body: jsonb("body").$type<Schema.JsonObject>().notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});

export const payrollCalculationInputs = openerp.table("payroll_calculation_inputs", {
  bookId: text("book_id").notNull(),
  calculationId: text("calculation_id").notNull(),
  ordinal: integer("ordinal").notNull(),
  kind: text("kind").notNull(),
  resourceId: text("resource_id").notNull(),
  version: text("version").notNull(),
  reason: text("reason").notNull(),
});

export const purchaseRecognitions = openerp.table("purchase_recognitions", {
  bookId: text("book_id").notNull(),
  id: text().notNull(),
  economicKey: text("economic_key").notNull(),
  eventOwner: text("event_owner").notNull(),
  originalRecognitionId: text("original_recognition_id"),
  draftId: text("draft_id"),
  draftRevision: bigint("draft_revision", { mode: "bigint" }),
  counterpartyId: text("counterparty_id").notNull(),
  documentNumber: text("document_number").notNull(),
  voucherId: text("voucher_id").notNull(),
  payableId: text("payable_id").notNull(),
  changeSetId: text("change_set_id").notNull(),
  approvalId: text("approval_id").notNull(),
  recognitionDate: date("recognition_date", { mode: "string" }).notNull(),
  taxPointOn: date("tax_point_on", { mode: "string" }).notNull(),
  grossMinor: numeric("gross_minor", { mode: "string" }).notNull(),
  deductibleTaxMinor: numeric("deductible_tax_minor", { mode: "string" }).notNull(),
  body: jsonb("body").$type<Schema.JsonObject>().notNull(),
  digest: text().notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true, mode: "string" }).notNull(),
});

export const purchaseTaxFacts = openerp.table("purchase_tax_facts", {
  bookId: text("book_id").notNull(),
  id: text().notNull(),
  recognitionId: text("recognition_id").notNull(),
  sourceLineId: text("source_line_id").notNull(),
  componentRole: text("component_role").notNull(),
  taxComponentId: text("tax_component_id").notNull(),
  voucherId: text("voucher_id").notNull(),
  signedBaseMinor: numeric("signed_base_minor", { mode: "string" }).notNull(),
  signedOutputTaxMinor: numeric("signed_output_tax_minor", { mode: "string" }).notNull(),
  signedDeductibleTaxMinor: numeric("signed_deductible_tax_minor", { mode: "string" }).notNull(),
  sourceTaxMinor: numeric("source_tax_minor", { mode: "string" }).notNull(),
  nonDeductibleTaxMinor: numeric("non_deductible_tax_minor", { mode: "string" }).notNull(),
  taxPointOn: date("tax_point_on", { mode: "string" }).notNull(),
  adjustsTaxFactId: text("adjusts_tax_fact_id"),
  body: jsonb("body").$type<Schema.JsonObject>().notNull(),
  digest: text().notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true, mode: "string" }).notNull(),
});

export const servicePurchaseRecognitions = openerp.table("service_purchase_recognitions", {
  bookId: text("book_id").notNull(),
  id: text().notNull(),
  economicKey: text("economic_key").notNull(),
  eventOwner: text("event_owner").notNull(),
  draftId: text("draft_id").notNull(),
  draftRevision: bigint("draft_revision", { mode: "bigint" }).notNull(),
  counterpartyId: text("counterparty_id").notNull(),
  documentNumber: text("document_number").notNull(),
  voucherId: text("voucher_id").notNull(),
  payableId: text("payable_id").notNull(),
  changeSetId: text("change_set_id").notNull(),
  approvalId: text("approval_id").notNull(),
  recognitionDate: date("recognition_date", { mode: "string" }).notNull(),
  taxPointOn: date("tax_point_on", { mode: "string" }).notNull(),
  grossMinor: numeric("gross_minor", { mode: "string" }).notNull(),
  deductibleTaxMinor: numeric("deductible_tax_minor", { mode: "string" }).notNull(),
  body: jsonb("body").$type<Schema.JsonObject>().notNull(),
  digest: text().notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true, mode: "string" }).notNull(),
});

export const servicePurchaseTaxFacts = openerp.table("service_purchase_tax_facts", {
  bookId: text("book_id").notNull(),
  id: text().notNull(),
  recognitionId: text("recognition_id").notNull(),
  sourceLineId: text("source_line_id").notNull(),
  componentRole: text("component_role").notNull(),
  taxComponentId: text("tax_component_id").notNull(),
  voucherId: text("voucher_id").notNull(),
  signedBaseMinor: numeric("signed_base_minor", { mode: "string" }).notNull(),
  signedOutputTaxMinor: numeric("signed_output_tax_minor", { mode: "string" }).notNull(),
  signedDeductibleTaxMinor: numeric("signed_deductible_tax_minor", { mode: "string" }).notNull(),
  sourceTaxMinor: numeric("source_tax_minor", { mode: "string" }).notNull(),
  nonDeductibleTaxMinor: numeric("non_deductible_tax_minor", { mode: "string" }).notNull(),
  taxPointOn: date("tax_point_on", { mode: "string" }).notNull(),
  adjustsTaxFactId: text("adjusts_tax_fact_id"),
  body: jsonb("body").$type<Schema.JsonObject>().notNull(),
  digest: text().notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true, mode: "string" }).notNull(),
});

export const purchaseLineCapacities = openerp.table("purchase_line_capacities", {
  bookId: text("book_id").notNull(),
  recognitionId: text("recognition_id").notNull(),
  sourceLineId: text("source_line_id").notNull(),
  expenseAccountId: text("expense_account_id").notNull(),
  inputVatAccountId: text("input_vat_account_id"),
  originalNetMinor: numeric("original_net_minor", { mode: "string" }).notNull(),
  originalSourceTaxMinor: numeric("original_source_tax_minor", { mode: "string" }).notNull(),
  originalDeductibleTaxMinor: numeric("original_deductible_tax_minor", {
    mode: "string",
  }).notNull(),
  creditedNetMinor: numeric("credited_net_minor", { mode: "string" }).notNull().default("0"),
  creditedSourceTaxMinor: numeric("credited_source_tax_minor", { mode: "string" })
    .notNull()
    .default("0"),
  releasedDeductionMinor: numeric("released_deduction_minor", { mode: "string" })
    .notNull()
    .default("0"),
  version: bigint({ mode: "bigint" }).notNull().default(1n),
  body: jsonb("body").$type<Schema.JsonObject>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
});

export const supplierExtractionRequests = openerp.table("supplier_extraction_requests", {
  bookId: text("book_id").notNull(),
  id: text().notNull(),
  occurrenceId: text("occurrence_id").notNull(),
  generation: integer("generation").notNull(),
  originalHash: text("original_hash").notNull(),
  originalBytes: bigint("original_bytes", { mode: "bigint" }).notNull(),
  engineRelease: text("engine_release").notNull(),
  attemptIdentity: text("attempt_identity").notNull(),
  requestedBy: text("requested_by").notNull(),
  requestedAt: timestamp("requested_at", { withTimezone: true, mode: "string" }).notNull(),
  digest: text().notNull(),
  body: jsonb("body").$type<Schema.JsonObject>().notNull(),
});

export const supplierExtractionRequestStates = openerp.table("supplier_extraction_request_states", {
  bookId: text("book_id").notNull(),
  requestId: text("request_id").notNull(),
  state: text().notNull(),
  cancelVersion: integer("cancel_version").notNull(),
  attemptsMade: integer("attempts_made").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
});

export const supplierFieldDecisions = openerp.table("supplier_field_decisions", {
  bookId: text("book_id").notNull(),
  id: text().notNull(),
  occurrenceId: text("occurrence_id").notNull(),
  requestId: text("request_id").notNull(),
  attemptId: text("attempt_id").notNull(),
  draftId: text("draft_id").notNull(),
  draftRevision: bigint("draft_revision", { mode: "bigint" }).notNull(),
  lineOrdinal: integer("line_ordinal").notNull(),
  fieldKey: text("field_key").notNull(),
  decisionKind: text("decision_kind").notNull(),
  reviewer: text("reviewer").notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true, mode: "string" }).notNull(),
  digest: text().notNull(),
});

// A legal customer credit reduces an already recognized domestic sale. These
// mappings are query shapes for the reviewed SQL migration, not a push schema.
export const customerCreditReviews = openerp.table("customer_credit_reviews", {
  bookId: text("book_id").notNull(),
  id: text("id").notNull(),
  originalLegalIssueId: text("original_legal_issue_id").notNull(),
  registerInvoiceId: text("register_invoice_id").notNull(),
  accountingProfileId: text("accounting_profile_id").notNull(),
  changeSetId: text("change_set_id").notNull(),
  eventId: text("event_id").notNull(),
  evidenceId: text("evidence_id").notNull(),
  ordinal: integer("ordinal").notNull(),
  creditDate: date("credit_date", { mode: "string" }).notNull(),
  netMinor: numeric("net_minor", { mode: "string" }).notNull(),
  taxMinor: numeric("tax_minor", { mode: "string" }).notNull(),
  grossMinor: numeric("gross_minor", { mode: "string" }).notNull(),
  unpaidBeforeMinor: numeric("unpaid_before_minor", { mode: "string" }).notNull(),
  unpaidAfterMinor: numeric("unpaid_after_minor", { mode: "string" }).notNull(),
  body: jsonb("body").$type<Schema.JsonObject>().notNull(),
});

// NEXT-04 actual domestic VAT return. A sealed calculation artifact: the
// application owns the release selection, the capture, the arithmetic and the
// control rollforward, and the retained rows keep a captured meaning.
export const vatActualReturns = openerp.table("vat_actual_returns", {
  bookId: text("book_id").notNull(),
  id: text("id").notNull(),
  ordinal: integer().notNull(),
  startsOn: date("starts_on", { mode: "string" }).notNull(),
  endsOn: date("ends_on", { mode: "string" }).notNull(),
  basisDigest: text("basis_digest").notNull(),
  basisEngine: text("basis_engine").notNull(),
  ruleReleaseId: text("rule_release_id").notNull(),
  ruleReleaseChecksum: text("rule_release_checksum").notNull(),
  periodFactRevisionId: text("period_fact_revision_id").notNull(),
  filingReady: boolean("filing_ready").notNull(),
  controlsReconciled: boolean("controls_reconciled").notNull(),
  coverageComplete: boolean("coverage_complete").notNull(),
  calculationSupported: boolean("calculation_supported").notNull(),
  exactNetMinor: numeric("exact_net_minor", { mode: "string" }).notNull(),
  reportedNetMinor: numeric("reported_net_minor", { mode: "string" }).notNull(),
  residualNetMinor: numeric("residual_net_minor", { mode: "string" }).notNull(),
  ledgerBoundary: bigint("ledger_boundary", { mode: "bigint" }).notNull(),
  digest: text().notNull(),
  body: jsonb("body").$type<Schema.JsonObject>().notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true, mode: "string" }).notNull(),
});

export const vatActualReturnBoxes = openerp.table("vat_actual_return_boxes", {
  bookId: text("book_id").notNull(),
  returnId: text("return_id").notNull(),
  box: text().notNull(),
  kind: text().notNull(),
  exactMinor: numeric("exact_minor", { mode: "string" }).notNull(),
  reportedMinor: numeric("reported_minor", { mode: "string" }).notNull(),
  residualMinor: numeric("residual_minor", { mode: "string" }).notNull(),
});

export const vatActualReturnContributions = openerp.table("vat_actual_return_contributions", {
  bookId: text("book_id").notNull(),
  returnId: text("return_id").notNull(),
  ordinal: integer().notNull(),
  factId: text("fact_id").notNull(),
  origin: text().notNull(),
  mappingRuleId: text("mapping_rule_id").notNull(),
  rateId: text("rate_id").notNull(),
  box: text().notNull(),
  signedMinor: numeric("signed_minor", { mode: "string" }).notNull(),
  basisMinor: numeric("basis_minor", { mode: "string" }).notNull(),
  taxMinor: numeric("tax_minor", { mode: "string" }).notNull(),
  revisionId: text("revision_id").notNull(),
  factDigest: text("fact_digest").notNull(),
});

export const vatActualReturnExclusions = openerp.table("vat_actual_return_exclusions", {
  bookId: text("book_id").notNull(),
  returnId: text("return_id").notNull(),
  ordinal: integer().notNull(),
  factId: text("fact_id").notNull(),
  origin: text().notNull(),
  revisionId: text("revision_id").notNull(),
  reason: text().notNull(),
  detail: text().notNull(),
});

export const vatActualReturnControls = openerp.table("vat_actual_return_controls", {
  bookId: text("book_id").notNull(),
  returnId: text("return_id").notNull(),
  accountId: text("account_id").notNull(),
  role: text().notNull(),
  reviewedOpeningMinor: numeric("reviewed_opening_minor", { mode: "string" }).notNull(),
  expectedClosingMinor: numeric("expected_closing_minor", { mode: "string" }).notNull(),
  frozenGlClosingMinor: numeric("frozen_gl_closing_minor", { mode: "string" }).notNull(),
  differenceMinor: numeric("difference_minor", { mode: "string" }).notNull(),
  reconciled: boolean().notNull(),
});

export const vatActualReturnControlRows = openerp.table("vat_actual_return_control_rows", {
  bookId: text("book_id").notNull(),
  returnId: text("return_id").notNull(),
  accountId: text("account_id").notNull(),
  ordinal: integer().notNull(),
  state: text().notNull(),
  voucherId: text("voucher_id").notNull(),
  lineId: text("line_id").notNull(),
  postingDate: date("posting_date", { mode: "string" }).notNull(),
  signedMinor: numeric("signed_minor", { mode: "string" }).notNull(),
});

export const vatActualReturnCoverage = openerp.table("vat_actual_return_coverage", {
  bookId: text("book_id").notNull(),
  returnId: text("return_id").notNull(),
  family: text().notNull(),
  state: text().notNull(),
  evidenceId: text("evidence_id"),
  evidenceSha256: text("evidence_sha256"),
});

export const customerCreditApprovals = openerp.table("customer_credit_approvals", {
  bookId: text("book_id").notNull(),
  id: text("id").notNull(),
  reviewId: text("review_id").notNull(),
  ordinal: integer("ordinal").notNull(),
  actorId: text("actor_id").notNull(),
  digest: text("digest").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }).notNull(),
  body: jsonb("body").$type<Schema.JsonObject>().notNull(),
});

export const customerCreditNotes = openerp.table("customer_credit_notes", {
  bookId: text("book_id").notNull(),
  id: text("id").notNull(),
  reviewId: text("review_id").notNull(),
  approvalId: text("approval_id").notNull(),
  originalLegalIssueId: text("original_legal_issue_id").notNull(),
  registerInvoiceId: text("register_invoice_id").notNull(),
  creditSeries: text("credit_series").notNull(),
  creditNumber: bigint("credit_number", { mode: "bigint" }).notNull(),
  creditDate: date("credit_date", { mode: "string" }).notNull(),
  periodId: text("period_id").notNull(),
  voucherId: text("voucher_id").notNull(),
  controlLineId: text("control_line_id").notNull(),
  documentId: text("document_id").notNull(),
  counterpartyId: text("counterparty_id").notNull(),
  evidenceId: text("evidence_id").notNull(),
  netMinor: numeric("net_minor", { mode: "string" }).notNull(),
  taxMinor: numeric("tax_minor", { mode: "string" }).notNull(),
  grossMinor: numeric("gross_minor", { mode: "string" }).notNull(),
  unpaidAfterMinor: numeric("unpaid_after_minor", { mode: "string" }).notNull(),
  body: jsonb("body").$type<Schema.JsonObject>().notNull(),
});

// The consumed original-line credit capacity. Its sum under the book writer lock is
// the only authority for how much of an issued line may still be credited.
export const customerCreditLineCredits = openerp.table("customer_credit_line_credits", {
  bookId: text("book_id").notNull(),
  creditId: text("credit_id").notNull(),
  ordinal: integer("ordinal").notNull(),
  originalLineId: text("original_line_id").notNull(),
  netMinor: numeric("net_minor", { mode: "string" }).notNull(),
  taxMinor: numeric("tax_minor", { mode: "string" }).notNull(),
  grossMinor: numeric("gross_minor", { mode: "string" }).notNull(),
  body: jsonb("body").$type<Schema.JsonObject>().notNull(),
});

export const customerCreditDocuments = openerp.table("customer_credit_documents", {
  bookId: text("book_id").notNull(),
  id: text("id").notNull(),
  creditId: text("credit_id").notNull(),
  revision: bigint("revision", { mode: "bigint" }).notNull(),
  digest: text("digest").notNull(),
  body: jsonb("body").$type<Schema.JsonObject>().notNull(),
});

export const customerCreditArtifacts = openerp.table("customer_credit_artifacts", {
  bookId: text("book_id").notNull(),
  id: text().notNull(),
  documentId: text("document_id").notNull(),
  documentRevision: bigint("document_revision", { mode: "bigint" }).notNull(),
  documentDigest: text("document_digest").notNull(),
  rendererVersion: text("renderer_version").notNull(),
  outboxId: text("outbox_id").notNull(),
  descriptor: jsonb().$type<Schema.JsonObject>().notNull(),
  contentBase64: text("content_base64").notNull(),
});

export const customerCreditRenderFailures = openerp.table("customer_credit_render_failures", {
  bookId: text("book_id").notNull(),
  documentId: text("document_id").notNull(),
  documentRevision: bigint("document_revision", { mode: "bigint" }).notNull(),
  documentDigest: text("document_digest").notNull(),
  rendererVersion: text("renderer_version").notNull(),
  ordinal: integer().notNull(),
  code: text().notNull(),
  failedAt: timestamp("failed_at", { withTimezone: true, mode: "string" }).notNull(),
});

// The exact negative tax effect of the credit, bound to the original recognition
// component and the qualified tax period. No return effect is computed or claimed.
export const customerCreditTaxCorrections = openerp.table("customer_credit_tax_corrections", {
  bookId: text("book_id").notNull(),
  id: text("id").notNull(),
  creditId: text("credit_id").notNull(),
  ordinal: integer("ordinal").notNull(),
  originalLineId: text("original_line_id").notNull(),
  originalVoucherId: text("original_voucher_id").notNull(),
  originalControlLineId: text("original_control_line_id").notNull(),
  originalPostingDate: date("original_posting_date", { mode: "string" }).notNull(),
  originalEvidenceId: text("original_evidence_id").notNull(),
  taxPeriodId: text("tax_period_id").notNull(),
  qualifiedOn: date("qualified_on", { mode: "string" }).notNull(),
  baseMinor: numeric("base_minor", { mode: "string" }).notNull(),
  outputTaxMinor: numeric("output_tax_minor", { mode: "string" }).notNull(),
  creditVoucherId: text("credit_voucher_id").notNull(),
  revenueLineId: text("revenue_line_id").notNull(),
  outputVatLineId: text("output_vat_line_id"),
  controlLineId: text("control_line_id").notNull(),
  body: jsonb("body").$type<Schema.JsonObject>().notNull(),
});

export const ownerOperationReviews = openerp.table("owner_operation_reviews", {
  bookId: text("book_id").notNull(),
  id: text().notNull(),
  mode: text("mode").notNull(),
  ownerId: text("owner_id").notNull(),
  ordinal: integer("ordinal").notNull(),
  changeSetId: text("change_set_id").notNull(),
  eventId: text("event_id").notNull(),
  evidenceId: text("evidence_id").notNull(),
  body: jsonb("body").$type<Schema.JsonObject>().notNull(),
  digest: text().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
});

export const ownerOperationApprovals = openerp.table("owner_operation_approvals", {
  bookId: text("book_id").notNull(),
  id: text().notNull(),
  reviewId: text("review_id").notNull(),
  actorId: text("actor_id").notNull(),
  digest: text().notNull(),
  reviewDigest: text("review_digest")
    .notNull()
    .generatedAlwaysAs(sql`body ->> 'reviewDigest'::text`),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }).notNull(),
  body: jsonb("body").$type<Schema.JsonObject>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
});

export const ownerOperationReceipts = openerp.table("owner_operation_receipts", {
  bookId: text("book_id").notNull(),
  id: text().notNull(),
  reviewId: text("review_id").notNull(),
  approvalId: text("approval_id").notNull(),
  mode: text("mode").notNull(),
  ownerId: text("owner_id").notNull(),
  ownerRecordId: text("owner_record_id").notNull(),
  ownerEffectId: text("owner_effect_id").notNull(),
  voucherId: text("voucher_id").notNull(),
  controlLineId: text("control_line_id").notNull(),
  recognitionId: text("recognition_id"),
  invoiceId: text("invoice_id"),
  amountMinor: numeric("amount_minor", { mode: "string" }).notNull(),
  body: jsonb("body").$type<Schema.JsonObject>().notNull(),
  digest: text().notNull(),
  committedAt: timestamp("committed_at", { withTimezone: true, mode: "string" }).notNull(),
});

export const ownerOperationAllocations = openerp.table("owner_operation_allocations", {
  bookId: text("book_id").notNull(),
  receiptId: text("receipt_id").notNull(),
  ordinal: integer("ordinal").notNull(),
  claimId: text("claim_id").notNull(),
  amountMinor: numeric("amount_minor", { mode: "string" }).notNull(),
});

export const ownerPurchaseRecognitions = openerp.table("owner_purchase_recognitions", {
  bookId: text("book_id").notNull(),
  id: text().notNull(),
  economicKey: text("economic_key").notNull(),
  ownerId: text("owner_id").notNull(),
  ownerRecordId: text("owner_record_id").notNull(),
  ownerEffectId: text("owner_effect_id").notNull(),
  counterpartyId: text("counterparty_id").notNull(),
  documentNumber: text("document_number").notNull(),
  voucherId: text("voucher_id").notNull(),
  changeSetId: text("change_set_id").notNull(),
  approvalId: text("approval_id").notNull(),
  recognitionDate: date("recognition_date", { mode: "string" }).notNull(),
  taxPointOn: date("tax_point_on", { mode: "string" }).notNull(),
  grossMinor: numeric("gross_minor", { mode: "string" }).notNull(),
  deductibleTaxMinor: numeric("deductible_tax_minor", { mode: "string" }).notNull(),
  body: jsonb("body").$type<Schema.JsonObject>().notNull(),
  digest: text().notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true, mode: "string" }).notNull(),
});

export const ownerPurchaseTaxFacts = openerp.table("owner_purchase_tax_facts", {
  bookId: text("book_id").notNull(),
  id: text().notNull(),
  recognitionId: text("recognition_id").notNull(),
  sourceLineId: text("source_line_id").notNull(),
  componentRole: text("component_role").notNull(),
  taxComponentId: text("tax_component_id").notNull(),
  voucherId: text("voucher_id").notNull(),
  signedBaseMinor: numeric("signed_base_minor", { mode: "string" }).notNull(),
  signedOutputTaxMinor: numeric("signed_output_tax_minor", { mode: "string" }).notNull(),
  signedDeductibleTaxMinor: numeric("signed_deductible_tax_minor", { mode: "string" }).notNull(),
  sourceTaxMinor: numeric("source_tax_minor", { mode: "string" }).notNull(),
  nonDeductibleTaxMinor: numeric("non_deductible_tax_minor", { mode: "string" }).notNull(),
  taxPointOn: date("tax_point_on", { mode: "string" }).notNull(),
  adjustsTaxFactId: text("adjusts_tax_fact_id"),
  body: jsonb("body").$type<Schema.JsonObject>().notNull(),
  digest: text().notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true, mode: "string" }).notNull(),
});

// A period-work manifest is the frozen selection for one requested interval. A
// source that arrives after it was sealed is not in it; selecting it requires a
// new manifest rather than an edit to this one.
export const periodWorkManifests = openerp.table("period_work_manifests", {
  bookId: text("book_id").notNull(),
  id: text("id").notNull(),
  startsOn: date("starts_on", { mode: "string" }).notNull(),
  endsOn: date("ends_on", { mode: "string" }).notNull(),
  cutoff: date("cutoff", { mode: "string" }).notNull(),
  // A run whose children are all visited is still not a reconciled period. This
  // is how that fact is stated rather than implied.
  populationComplete: boolean("population_complete").notNull(),
  selectedCount: integer("selected_count").notNull(),
  body: jsonb("body").$type<Schema.JsonObject>().notNull(),
  digest: text().notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true, mode: "string" })
    .notNull()
    .defaultNow(),
});

// The mutable run-owned progress of one unit of work. `revision` fences a
// redelivered handler and `cancelVersion` stops a stale handler publishing new
// work; both move only with the state they fence.
export const periodWorkChildren = openerp.table("period_work_children", {
  bookId: text("book_id").notNull(),
  workIdentity: text("work_identity").notNull(),
  manifestId: text("manifest_id").notNull(),
  economicIdentity: text("economic_identity").notNull(),
  sourceRevision: text("source_revision").notNull(),
  state: text("state").$type<WorkChildState>().notNull(),
  revision: bigint("revision", { mode: "bigint" }).notNull().default(1n),
  cancelVersion: bigint("cancel_version", { mode: "bigint" }).notNull().default(0n),
  planId: text("plan_id"),
  planDigest: text("plan_digest"),
  // A committed child keeps its receipt even if the plan later reads as stale.
  receiptId: text("receipt_id"),
  missingFacts: jsonb("missing_facts").$type<Schema.JsonObject>(),
  refusalReason: text("refusal_reason"),
  batchId: text("batch_id"),
  // The owning operation routing resolved to, and the sealed plan and review
  // that operation produced. All three move together or none of them does.
  routedOwner: text("routed_owner"),
  ownerReviewId: text("owner_review_id"),
  ownerReviewDigest: text("owner_review_digest"),
  recordedAt: timestamp("recorded_at", { withTimezone: true, mode: "string" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});

// The sealed fixed manifest a human approved. Immutable once written.
export const periodWorkBatches = openerp.table("period_work_batches", {
  bookId: text("book_id").notNull(),
  id: text("id").notNull(),
  manifestId: text("manifest_id").notNull(),
  memberCount: integer("member_count").notNull(),
  // Informational only, shown beside the members. Never a journal line and
  // never a balancing figure.
  combinedInformationalMinor: numeric("combined_informational_minor", { mode: "string" }).notNull(),
  body: jsonb("body").$type<Schema.JsonObject>().notNull(),
  digest: text().notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true, mode: "string" })
    .notNull()
    .defaultNow(),
});

// One immutable, deterministic member of a sealed batch. The unique index on
// work_identity is what stops one gesture covering a duplicate economic effect.
export const periodWorkBatchMembers = openerp.table("period_work_batch_members", {
  bookId: text("book_id").notNull(),
  batchId: text("batch_id").notNull(),
  ordinal: integer("ordinal").notNull(),
  owner: text("owner").notNull(),
  planId: text("plan_id").notNull(),
  planDigest: text("plan_digest").notNull(),
  inputIdentity: text("input_identity").notNull(),
  workIdentity: text("work_identity").notNull(),
  ownerReviewId: text("owner_review_id").notNull(),
  ownerReviewDigest: text("owner_review_digest").notNull(),
});

// Which exact approval covered which exact batch. The approval itself stays with
// the existing approvals owner.
export const periodWorkBatchApprovals = openerp.table("period_work_batch_approvals", {
  bookId: text("book_id").notNull(),
  batchId: text("batch_id").notNull(),
  memberOrdinal: integer("member_ordinal").notNull(),
  owner: text("owner").notNull(),
  ownerApprovalId: text("owner_approval_id").notNull(),
  planDigest: text("plan_digest").notNull(),
  approverId: text("approver_id").notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true, mode: "string" })
    .notNull()
    .defaultNow(),
});

export const corporateTaxBridges = openerp.table("corporate_tax_bridges", {
  bookId: text("book_id").notNull(),
  id: text().notNull(),
  fiscalYearId: text("fiscal_year_id").notNull(),
  accountingPeriodId: text("accounting_period_id").notNull(),
  statementSnapshotId: text("statement_snapshot_id").notNull(),
  statementDigest: text("statement_digest").notNull(),
  changeSetId: text("change_set_id").notNull(),
  planDigest: text("plan_digest").notNull(),
  ruleReleaseId: text("rule_release_id").notNull(),
  ruleReleaseChecksum: text("rule_release_checksum").notNull(),
  ruleReleaseVersion: integer("rule_release_version").notNull(),
  overlayDigest: text("overlay_digest").notNull(),
  currentTaxTargetMinor: numeric("current_tax_target_minor", { mode: "string" }).notNull(),
  recognizedMinor: numeric("recognized_minor", { mode: "string" }).notNull(),
  deltaMinor: numeric("delta_minor", { mode: "string" }).notNull(),
  postsJournal: boolean("posts_journal").notNull(),
  noFinancialEffect: boolean("no_financial_effect").notNull(),
  body: jsonb("body").$type<Schema.JsonObject>().notNull(),
  digest: text().notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});

export const corporateTaxBridgeInputs = openerp.table("corporate_tax_bridge_inputs", {
  bookId: text("book_id").notNull(),
  bridgeId: text("bridge_id").notNull(),
  ordinal: integer("ordinal").notNull(),
  kind: text("kind").notNull(),
  resourceId: text("resource_id").notNull(),
  version: text("version").notNull(),
  reason: text("reason").notNull(),
});

export const corporateTaxEffects = openerp.table("corporate_tax_effects", {
  bookId: text("book_id").notNull(),
  id: text().notNull(),
  bridgeId: text("bridge_id").notNull(),
  changeSetId: text("change_set_id").notNull(),
  fiscalYearId: text("fiscal_year_id").notNull(),
  voucherId: text("voucher_id"),
  approvalId: text("approval_id").notNull(),
  yearTaxTargetMinor: numeric("year_tax_target_minor", { mode: "string" }).notNull(),
  recognizedBeforeMinor: numeric("recognized_before_minor", { mode: "string" }).notNull(),
  deltaMinor: numeric("delta_minor", { mode: "string" }).notNull(),
  recognizedAfterMinor: numeric("recognized_after_minor", { mode: "string" }).notNull(),
  noFinancialEffect: boolean("no_financial_effect").notNull(),
  body: jsonb("body").$type<Schema.JsonObject>().notNull(),
  digest: text().notNull(),
  createdBy: text("created_by").notNull(),
  committedAt: timestamp("committed_at", { withTimezone: true, mode: "string" }).notNull(),
});

export const corporateTaxDeclarations = openerp.table("corporate_tax_declarations", {
  bookId: text("book_id").notNull(),
  id: text().notNull(),
  ordinal: bigint("ordinal", { mode: "bigint" }).notNull(),
  bridgeId: text("bridge_id").notNull(),
  fiscalYearId: text("fiscal_year_id").notNull(),
  statementSnapshotId: text("statement_snapshot_id").notNull(),
  fieldCount: integer("field_count").notNull(),
  fileCount: integer("file_count").notNull(),
  blocked: boolean("blocked").notNull(),
  noFinancialEffect: boolean("no_financial_effect").notNull(),
  body: jsonb("body").$type<Schema.JsonObject>().notNull(),
  digest: text().notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});

// NEXT-17: the reviewed fee and cash source legs a foreign-currency settlement
// actually posted. Versioned SQL migrations own the DDL; this is the typed mapping.
export const commerceFxSettlementSources = openerp.table("commerce_fx_settlement_sources", {
  bookId: text("book_id").notNull(),
  id: text("id").notNull(),
  settlementId: text("settlement_id").notNull(),
  ordinal: integer("ordinal").notNull(),
  sourceKind: text("source_kind").notNull(),
  sourceIdentity: text("source_identity").notNull(),
  accountId: text("account_id").notNull(),
  journalLineId: text("journal_line_id").notNull(),
  signedBookMinor: numeric("signed_book_minor", { mode: "string" }).notNull(),
  evidenceId: text("evidence_id").notNull(),
  body: jsonb("body").$type<Schema.JsonObject>().notNull(),
});

// NEXT-23: financial close and single-count carry-forward. Versioned SQL
// migrations own the DDL; this is the typed mapping.
export const financialClosePreparations = openerp.table("financial_close_preparations", {
  bookId: text("book_id").notNull(),
  id: text().notNull(),
  fiscalYearId: text("fiscal_year_id").notNull(),
  statementSnapshotId: text("statement_snapshot_id").notNull(),
  bridgeId: text("bridge_id").notNull(),
  body: jsonb("body").$type<Schema.JsonObject>().notNull(),
  digest: text().notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true, mode: "string" }).notNull(),
});

export const financialCloseProposals = openerp.table("financial_close_proposals", {
  bookId: text("book_id").notNull(),
  id: text().notNull(),
  preparationId: text("preparation_id").notNull(),
  fiscalYearId: text("fiscal_year_id").notNull(),
  body: jsonb("body").$type<Schema.JsonObject>().notNull(),
  digest: text().notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true, mode: "string" }).notNull(),
});

export const financialCloseApprovals = openerp.table("financial_close_approvals", {
  bookId: text("book_id").notNull(),
  id: text().notNull(),
  proposalId: text("proposal_id").notNull(),
  ordinal: integer("ordinal").notNull(),
  actorId: text("actor_id").notNull(),
  digest: text().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }).notNull(),
  body: jsonb("body").$type<Schema.JsonObject>().notNull(),
});

export const financialCloseTransfers = openerp.table("financial_close_transfers", {
  bookId: text("book_id").notNull(),
  id: text().notNull(),
  fiscalYearId: text("fiscal_year_id").notNull(),
  ordinal: integer("ordinal").notNull(),
  deltaMinor: numeric("delta_minor", { mode: "string" }).notNull(),
  voucherId: text("voucher_id"),
  body: jsonb("body").$type<Schema.JsonObject>().notNull(),
  digest: text().notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true, mode: "string" }).notNull(),
});

export const financialOpeningSets = openerp.table("financial_opening_sets", {
  bookId: text("book_id").notNull(),
  id: text().notNull(),
  fiscalYearId: text("fiscal_year_id").notNull(),
  version: integer("version").notNull(),
  certificateId: text("certificate_id").notNull(),
  supersedesId: text("supersedes_id"),
  body: jsonb("body").$type<Schema.JsonObject>().notNull(),
  digest: text().notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true, mode: "string" }).notNull(),
});

export const financialCloseCertificates = openerp.table("financial_close_certificates", {
  bookId: text("book_id").notNull(),
  id: text().notNull(),
  proposalId: text("proposal_id").notNull(),
  fiscalYearId: text("fiscal_year_id").notNull(),
  openingSetId: text("opening_set_id").notNull(),
  transferId: text("transfer_id").notNull(),
  body: jsonb("body").$type<Schema.JsonObject>().notNull(),
  digest: text().notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true, mode: "string" }).notNull(),
});

export const financialReopenEvents = openerp.table("financial_reopen_events", {
  bookId: text("book_id").notNull(),
  id: text().notNull(),
  certificateId: text("certificate_id").notNull(),
  fiscalYearId: text("fiscal_year_id").notNull(),
  body: jsonb("body").$type<Schema.JsonObject>().notNull(),
  digest: text().notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true, mode: "string" }).notNull(),
});

// NEXT-24: K2 annual-report semantic model and iXBRL. Versioned SQL
// migrations own the DDL; this is the typed mapping.
export const annualReportDrafts = openerp.table("annual_report_drafts", {
  bookId: text("book_id").notNull(),
  id: text().notNull(),
  fiscalYearId: text("fiscal_year_id").notNull(),
  closeCertificateId: text("close_certificate_id").notNull(),
  body: jsonb("body").$type<Schema.JsonObject>().notNull(),
  digest: text().notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true, mode: "string" }).notNull(),
});

export const annualReportApprovals = openerp.table("annual_report_approvals", {
  bookId: text("book_id").notNull(),
  id: text().notNull(),
  draftId: text("draft_id").notNull(),
  ordinal: integer("ordinal").notNull(),
  actorId: text("actor_id").notNull(),
  digest: text().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }).notNull(),
  body: jsonb("body").$type<Schema.JsonObject>().notNull(),
});

export const annualReportFinals = openerp.table("annual_report_finals", {
  bookId: text("book_id").notNull(),
  id: text().notNull(),
  draftId: text("draft_id").notNull(),
  approvalId: text("approval_id").notNull(),
  fiscalYearId: text("fiscal_year_id").notNull(),
  body: jsonb("body").$type<Schema.JsonObject>().notNull(),
  digest: text().notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true, mode: "string" }).notNull(),
});

export const annualReportPresentations = openerp.table("annual_report_presentations", {
  bookId: text("book_id").notNull(),
  id: text().notNull(),
  finalId: text("final_id").notNull(),
  body: jsonb("body").$type<Schema.JsonObject>().notNull(),
  digest: text().notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true, mode: "string" }).notNull(),
});

export const annualReportArtifacts = openerp.table("annual_report_artifacts", {
  bookId: text("book_id").notNull(),
  id: text().notNull(),
  presentationId: text("presentation_id").notNull(),
  finalId: text("final_id").notNull(),
  body: jsonb("body").$type<Schema.JsonObject>().notNull(),
  digest: text().notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true, mode: "string" }).notNull(),
});

// NEXT-37: VAT assessment ownership and exact-to-assessed bridge. Versioned
// SQL migrations own the DDL; this is the typed mapping.
export const vatRoundingBridges = openerp.table("vat_rounding_bridges", {
  bookId: text("book_id").notNull(),
  id: text().notNull(),
  returnId: text("return_id").notNull(),
  deltaMinor: numeric("delta_minor", { mode: "string" }).notNull(),
  body: jsonb("body").$type<Schema.JsonObject>().notNull(),
  digest: text().notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true, mode: "string" }).notNull(),
});

export const vatBridgeApprovals = openerp.table("vat_bridge_approvals", {
  bookId: text("book_id").notNull(),
  id: text().notNull(),
  bridgeId: text("bridge_id").notNull(),
  ordinal: integer("ordinal").notNull(),
  actorId: text("actor_id").notNull(),
  digest: text().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }).notNull(),
  body: jsonb("body").$type<Schema.JsonObject>().notNull(),
});

export const vatAssessments = openerp.table("vat_assessments", {
  bookId: text("book_id").notNull(),
  id: text().notNull(),
  assessmentIdentity: text("assessment_identity").notNull(),
  returnId: text("return_id").notNull(),
  eventId: text("event_id").notNull(),
  matchRef: text("match_ref"),
  body: jsonb("body").$type<Schema.JsonObject>().notNull(),
  digest: text().notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true, mode: "string" }).notNull(),
});

export const vatAssessmentApprovals = openerp.table("vat_assessment_approvals", {
  bookId: text("book_id").notNull(),
  id: text().notNull(),
  assessmentId: text("assessment_id").notNull(),
  ordinal: integer("ordinal").notNull(),
  actorId: text("actor_id").notNull(),
  digest: text().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }).notNull(),
  body: jsonb("body").$type<Schema.JsonObject>().notNull(),
});

export const vatBridgeReceipts = openerp.table("vat_bridge_receipts", {
  bookId: text("book_id").notNull(),
  id: text().notNull(),
  bridgeId: text("bridge_id").notNull(),
  approvalId: text("approval_id").notNull(),
  voucherId: text("voucher_id"),
  changeSetId: text("change_set_id"),
  body: jsonb("body").$type<Schema.JsonObject>().notNull(),
  digest: text().notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true, mode: "string" }).notNull(),
});

export const vatAssessmentReceipts = openerp.table("vat_assessment_receipts", {
  bookId: text("book_id").notNull(),
  id: text().notNull(),
  assessmentId: text("assessment_id").notNull(),
  assessmentIdentity: text("assessment_identity").notNull(),
  eventId: text("event_id").notNull(),
  approvalId: text("approval_id").notNull(),
  voucherId: text("voucher_id"),
  matchRef: text("match_ref"),
  body: jsonb("body").$type<Schema.JsonObject>().notNull(),
  digest: text().notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true, mode: "string" }).notNull(),
});

export const vatAssessmentReturnBindings = openerp.table("vat_assessment_return_bindings", {
  bookId: text("book_id").notNull(),
  returnId: text("return_id").notNull(),
  obligationId: text("obligation_id").notNull(),
});

export const recurringInvoiceAgreements = openerp.table("recurring_invoice_agreements", {
  bookId: text("book_id").notNull(),
  id: text().notNull(),
  revision: bigint("revision", { mode: "bigint" }).notNull(),
  customerId: text("customer_id").notNull(),
  body: jsonb("body").$type<Schema.JsonObject>().notNull(),
  digest: text().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
});

export const recurringInvoiceAgreementSchedules = openerp.table(
  "recurring_invoice_agreement_schedules",
  {
    bookId: text("book_id").notNull(),
    id: text().notNull(),
    agreementId: text("agreement_id").notNull(),
    revision: bigint("revision", { mode: "bigint" }).notNull(),
    effectiveFromCycle: bigint("effective_from_cycle", { mode: "bigint" }).notNull(),
    body: jsonb("body").$type<Schema.JsonObject>().notNull(),
    digest: text().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  },
);

export const recurringInvoiceTemplateRevisions = openerp.table(
  "recurring_invoice_template_revisions",
  {
    bookId: text("book_id").notNull(),
    id: text().notNull(),
    agreementId: text("agreement_id").notNull(),
    revision: bigint("revision", { mode: "bigint" }).notNull(),
    effectiveFromCycle: bigint("effective_from_cycle", { mode: "bigint" }).notNull(),
    body: jsonb("body").$type<Schema.JsonObject>().notNull(),
    digest: text().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  },
);

export const recurringInvoiceAgreementEvents = openerp.table("recurring_invoice_agreement_events", {
  bookId: text("book_id").notNull(),
  id: text().notNull(),
  agreementId: text("agreement_id").notNull(),
  ordinal: integer("ordinal").notNull(),
  kind: text().notNull(),
  effectiveCycle: bigint("effective_cycle", { mode: "bigint" }).notNull(),
  body: jsonb("body").$type<Schema.JsonObject>().notNull(),
  digest: text().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
});

export const recurringInvoiceOccurrences = openerp.table("recurring_invoice_occurrences", {
  bookId: text("book_id").notNull(),
  id: text().notNull(),
  agreementId: text("agreement_id").notNull(),
  cycleOrdinal: bigint("cycle_ordinal", { mode: "bigint" }).notNull(),
  cycleDate: date("cycle_date", { mode: "string" }).notNull(),
  serviceStartsOn: date("service_starts_on", { mode: "string" }).notNull(),
  serviceEndsOn: date("service_ends_on", { mode: "string" }).notNull(),
  selectedTemplateRevision: bigint("selected_template_revision", { mode: "bigint" }).notNull(),
  selectedTemplateDigest: text("selected_template_digest").notNull(),
  selectedScheduleRevision: bigint("selected_schedule_revision", { mode: "bigint" }).notNull(),
  draftId: text("draft_id").notNull(),
  body: jsonb("body").$type<Schema.JsonObject>().notNull(),
  digest: text().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
});

export const recurringInvoiceOccurrenceIssues = openerp.table(
  "recurring_invoice_occurrence_issues",
  {
    bookId: text("book_id").notNull(),
    id: text().notNull(),
    occurrenceId: text("occurrence_id").notNull(),
    agreementId: text("agreement_id").notNull(),
    cycleOrdinal: bigint("cycle_ordinal", { mode: "bigint" }).notNull(),
    chargeComponentKey: text("charge_component_key").notNull(),
    draftId: text("draft_id").notNull(),
    invoiceIssueId: text("invoice_issue_id").notNull(),
    registerInvoiceId: text("register_invoice_id").notNull(),
    documentNumber: text("document_number").notNull(),
    postingReceiptId: text("posting_receipt_id").notNull(),
    body: jsonb("body").$type<Schema.JsonObject>().notNull(),
    digest: text().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  },
);

// NEXT-07: supplier paid credits and cash refunds. Versioned SQL migrations
// own the DDL; these are the typed mappings.
export const supplierRefundPrincipalIncreases = openerp.table(
  "supplier_refund_principal_increases",
  {
    bookId: text("book_id").notNull(),
    id: text().notNull(),
    creditId: text("credit_id").notNull(),
    invoiceId: text("invoice_id").notNull(),
    apReleaseMinor: numeric("ap_release_minor", { mode: "string" }).notNull(),
    refundIncreaseMinor: numeric("refund_increase_minor", { mode: "string" }).notNull(),
    refundReceivableAccountId: text("refund_receivable_account_id").notNull(),
    body: jsonb("body").$type<Schema.JsonObject>().notNull(),
    digest: text().notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true, mode: "string" }).notNull(),
  },
);

export const supplierRefundReviews = openerp.table("supplier_refund_reviews", {
  bookId: text("book_id").notNull(),
  id: text().notNull(),
  invoiceId: text("invoice_id").notNull(),
  changeSetId: text("change_set_id"),
  eventId: text("event_id"),
  evidenceId: text("evidence_id").notNull(),
  body: jsonb("body").$type<Schema.JsonObject>().notNull(),
});

export const supplierRefundApprovals = openerp.table("supplier_refund_approvals", {
  bookId: text("book_id").notNull(),
  id: text().notNull(),
  reviewId: text("review_id").notNull(),
  actorId: text("actor_id").notNull(),
  digest: text().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }).notNull(),
  body: jsonb("body").$type<Schema.JsonObject>().notNull(),
});

export const supplierRefunds = openerp.table("supplier_refunds", {
  bookId: text("book_id").notNull(),
  id: text().notNull(),
  reviewId: text("review_id").notNull(),
  approvalId: text("approval_id").notNull(),
  invoiceId: text("invoice_id").notNull(),
  amountMinor: numeric("amount_minor", { mode: "string" }).notNull(),
  refundDate: date("refund_date", { mode: "string" }).notNull(),
  voucherId: text("voucher_id"),
  adoptedRef: text("adopted_ref"),
  sourceKind: text("source_kind").notNull(),
  evidenceId: text("evidence_id").notNull(),
  body: jsonb("body").$type<Schema.JsonObject>().notNull(),
  digest: text().notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true, mode: "string" }).notNull(),
});

export const supplierRefundAllocations = openerp.table("supplier_refund_allocations", {
  bookId: text("book_id").notNull(),
  refundId: text("refund_id").notNull(),
  ordinal: integer("ordinal").notNull(),
  allocationId: text("allocation_id").notNull(),
  amountMinor: numeric("amount_minor", { mode: "string" }).notNull(),
});

export const supplierRefundSourceUsages = openerp.table("supplier_refund_source_usages", {
  bookId: text("book_id").notNull(),
  refundId: text("refund_id").notNull(),
  sourceKind: text("source_kind").notNull(),
  bankAccountId: text("bank_account_id"),
  evidenceId: text("evidence_id"),
  adoptedRef: text("adopted_ref"),
  amountMinor: numeric("amount_minor", { mode: "string" }).notNull(),
});

export const evaluationContracts = openerp.table("evaluation_contracts", {
  bookId: text("book_id").notNull(),
  id: text().notNull(),
  predecessorId: text("predecessor_id"),
  predecessorDigest: text("predecessor_digest"),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  digest: text().notNull(),
  body: jsonb("body").$type<Schema.JsonObject>().notNull(),
});

export const supplierSettlementPlans = openerp.table("supplier_settlement_plans", {
  bookId: text("book_id").notNull(),
  id: text().notNull(),
  invoiceId: text("invoice_id").notNull(),
  statementId: text("statement_id").notNull(),
  rowOrdinal: integer("row_ordinal").notNull(),
  paymentChangeSetId: text("payment_change_set_id").notNull(),
  allocationPlanId: text("allocation_plan_id").notNull(),
  reservedVoucherId: text("reserved_voucher_id").notNull(),
  controlLineId: text("control_line_id").notNull(),
  bankLineId: text("bank_line_id").notNull(),
  body: jsonb().$type<Schema.JsonObject>().notNull(),
});

export const supplierSettlementApprovals = openerp.table("supplier_settlement_approvals", {
  bookId: text("book_id").notNull(),
  id: text().notNull(),
  planId: text("plan_id").notNull(),
  actorId: text("actor_id").notNull(),
  paymentApprovalId: text("payment_approval_id").notNull(),
  allocationApprovalId: text("allocation_approval_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  body: jsonb().$type<Schema.JsonObject>().notNull(),
});

export const supplierSettlementRevocations = openerp.table("supplier_settlement_revocations", {
  bookId: text("book_id").notNull(),
  approvalId: text("approval_id").notNull(),
  body: jsonb().$type<Schema.JsonObject>().notNull(),
});

export const supplierSettlementReceipts = openerp.table("supplier_settlement_receipts", {
  bookId: text("book_id").notNull(),
  id: text("id").notNull(),
  planId: text("plan_id").notNull(),
  approvalId: text("approval_id").notNull(),
  statementId: text("statement_id").notNull(),
  rowOrdinal: integer("row_ordinal").notNull(),
  invoiceId: text("invoice_id").notNull(),
  voucherId: text("voucher_id").notNull(),
  allocationReceiptId: text("allocation_receipt_id").notNull(),
  body: jsonb("body").$type<Schema.JsonObject>().notNull(),
});

export const supplierSettlementSourceClaims = openerp.table("supplier_settlement_source_claims", {
  bookId: text("book_id").notNull(),
  statementId: text("statement_id").notNull(),
  rowOrdinal: integer("row_ordinal").notNull(),
  receiptId: text("receipt_id").notNull(),
  planId: text("plan_id").notNull(),
});

export const supplierSettlementCancellationPlans = openerp.table(
  "supplier_settlement_cancellation_plans",
  {
    bookId: text("book_id").notNull(),
    id: text("id").notNull(),
    settlementReceiptId: text("settlement_receipt_id").notNull(),
    paymentChangeSetId: text("payment_change_set_id").notNull(),
    allocationReversalId: text("allocation_reversal_id").notNull(),
    matchReversalId: text("match_reversal_id").notNull(),
    body: jsonb("body").$type<Schema.JsonObject>().notNull(),
  },
);

export const supplierSettlementCancellationApprovals = openerp.table(
  "supplier_settlement_cancellation_approvals",
  {
    bookId: text("book_id").notNull(),
    id: text("id").notNull(),
    planId: text("plan_id").notNull(),
    actorId: text("actor_id").notNull(),
    paymentApprovalId: text("payment_approval_id").notNull(),
    allocationApprovalId: text("allocation_approval_id").notNull(),
    matchApprovalId: text("match_approval_id").notNull(),
    body: jsonb("body").$type<Schema.JsonObject>().notNull(),
  },
);

export const supplierSettlementCancellationReceipts = openerp.table(
  "supplier_settlement_cancellation_receipts",
  {
    bookId: text("book_id").notNull(),
    id: text("id").notNull(),
    planId: text("plan_id").notNull(),
    approvalId: text("approval_id").notNull(),
    settlementReceiptId: text("settlement_receipt_id").notNull(),
    body: jsonb("body").$type<Schema.JsonObject>().notNull(),
  },
);

export const supplierSettlementCancellationRevocations = openerp.table(
  "supplier_settlement_cancellation_revocations",
  {
    bookId: text("book_id").notNull(),
    approvalId: text("approval_id").notNull(),
    body: jsonb().$type<Schema.JsonObject>().notNull(),
  },
);

export const agentContextCaptures = openerp.table("agent_context_captures", {
  bookId: text("book_id").notNull(),
  id: text("id").notNull(),
  actorId: text("actor_id").notNull(),
  body: jsonb().$type<Schema.JsonObject>().notNull(),
  inventory: jsonb().$type<Schema.JsonObject>().notNull(),
});

export const agentContextProgress = openerp.table("agent_context_progress", {
  bookId: text("book_id").notNull(),
  captureId: text("capture_id").notNull(),
  actorId: text("actor_id").notNull(),
  revision: bigint("revision", { mode: "bigint" }).notNull(),
  position: bigint("position", { mode: "bigint" }).notNull(),
  body: jsonb().$type<Schema.JsonObject>().notNull(),
});

export const customerInvoiceDefaults = openerp.table("crm_customer_invoice_defaults", {
  bookId: text("book_id").notNull(),
  partyId: text("party_id").notNull(),
  currentRevision: bigint("current_revision", { mode: "bigint" }).notNull(),
});

export const customerInvoiceDefaultsRevisions = openerp.table(
  "crm_customer_invoice_defaults_revisions",
  {
    bookId: text("book_id").notNull(),
    partyId: text("party_id").notNull(),
    revision: bigint("revision", { mode: "bigint" }).notNull(),
    body: jsonb("body").$type<Schema.JsonObject>().notNull(),
    recordedBy: text("recorded_by").notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
);

export const customerRecipients = openerp.table("crm_customer_recipients", {
  bookId: text("book_id").notNull(),
  partyId: text("party_id").notNull(),
  currentRevision: bigint("current_revision", { mode: "bigint" }).notNull(),
});

export const customerRecipientsRevisions = openerp.table("crm_customer_recipients_revisions", {
  bookId: text("book_id").notNull(),
  partyId: text("party_id").notNull(),
  revision: bigint("revision", { mode: "bigint" }).notNull(),
  body: jsonb("body").$type<Schema.JsonObject>().notNull(),
  recordedBy: text("recorded_by").notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true, mode: "string" })
    .notNull()
    .defaultNow(),
});

export const invoiceTemplates = openerp.table("invoice_templates", {
  bookId: text("book_id").notNull(),
  id: text().notNull(),
  currentRevision: bigint("current_revision", { mode: "bigint" }).notNull(),
});

export const invoiceTemplateRevisions = openerp.table("invoice_template_revisions", {
  bookId: text("book_id").notNull(),
  templateId: text("template_id").notNull(),
  revision: bigint({ mode: "bigint" }).notNull(),
  body: jsonb().$type<Schema.JsonObject>().notNull(),
});

export const cashBases = openerp.table("cash_bases", {
  bookId: text("book_id").notNull(),
  id: text("id").notNull(),
  body: jsonb("body").$type<Schema.JsonObject>().notNull(),
  content: text("content").notNull(),
  sha256: text("sha256").notNull(),
  byteLength: integer("byte_length").notNull(),
});

export const cashForecasts = openerp.table("cash_forecasts", {
  bookId: text("book_id").notNull(),
  id: text("id").notNull(),
  basisId: text("basis_id").notNull(),
  body: jsonb("body").$type<Schema.JsonObject>().notNull(),
  content: text("content").notNull(),
  sha256: text("sha256").notNull(),
  byteLength: integer("byte_length").notNull(),
});

export const reminderMessages = openerp.table("reminder_messages", {
  bookId: text("book_id").notNull(),
  id: text().notNull(),
  prepareKey: text("prepare_key").notNull(),
  requestDigest: text("request_digest").notNull(),
  body: jsonb().$type<Schema.JsonObject>().notNull(),
});

export const reminderApprovals = openerp.table("reminder_approvals", {
  bookId: text("book_id").notNull(),
  messageId: text("message_id").notNull(),
  actorId: text("actor_id").notNull(),
  sessionId: text("session_id").notNull(),
  body: jsonb().$type<Schema.JsonObject>().notNull(),
});

export const reminderAttempts = openerp.table("reminder_attempts", {
  bookId: text("book_id").notNull(),
  messageId: text("message_id").notNull(),
  id: text().notNull(),
  externalIdentity: text("external_identity").notNull(),
  body: jsonb().$type<Schema.JsonObject>().notNull(),
});

export const reminderOutbox = openerp.table("reminder_outbox", {
  bookId: text("book_id").notNull(),
  messageId: text("message_id").notNull(),
  state: text({
    enum: [
      "approved",
      "admitted",
      "reconciling",
      "provider_accepted",
      "delivered",
      "outcome_unknown",
      "failed",
      "cancelled",
      "refused",
    ],
  }).notNull(),
  checkpoint: integer().notNull(),
  cancelVersion: integer("cancel_version").notNull(),
  reason: text(),
  checkedAt: timestamp("checked_at", { withTimezone: true, mode: "string" }).notNull(),
});

export const reminderObservations = openerp.table("reminder_observations", {
  bookId: text("book_id").notNull(),
  attemptId: text("attempt_id").notNull(),
  observationId: text("observation_id").notNull(),
  body: jsonb().$type<Schema.JsonObject>().notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true, mode: "string" }).notNull(),
});

export const recurringInvoiceDraftSchedules = openerp.table("recurring_invoice_draft_schedules", {
  bookId: text("book_id").notNull(),
  agreementId: text("agreement_id").notNull(),
  enabled: boolean().notNull(),
  generation: bigint("generation", { mode: "bigint" }).notNull(),
  firstAutomaticCycle: bigint("first_automatic_cycle", { mode: "bigint" }).notNull(),
  nextCycleOrdinal: bigint("next_cycle_ordinal", { mode: "bigint" }).notNull(),
  requestedBy: text("requested_by").notNull(),
  timeZone: text("time_zone").notNull(),
  duePolicy: text("due_policy").notNull(),
  changedAt: timestamp("changed_at", { withTimezone: true, mode: "string" }).notNull(),
});

export const recurringInvoiceDraftScheduleEvents = openerp.table(
  "recurring_invoice_draft_schedule_events",
  {
    bookId: text("book_id").notNull(),
    agreementId: text("agreement_id").notNull(),
    generation: bigint("generation", { mode: "bigint" }).notNull(),
    body: jsonb().$type<Schema.JsonObject>().notNull(),
  },
);

export const recurringInvoiceDraftJobs = openerp.table("recurring_invoice_draft_jobs", {
  bookId: text("book_id").notNull(),
  id: text().notNull(),
  agreementId: text("agreement_id").notNull(),
  cycleOrdinal: bigint("cycle_ordinal", { mode: "bigint" }).notNull(),
  generation: bigint("generation", { mode: "bigint" }).notNull(),
  scheduleGeneration: bigint("schedule_generation", { mode: "bigint" }).notNull(),
  requestedBy: text("requested_by").notNull(),
  executorId: text("executor_id").notNull(),
  admitted: jsonb().$type<Schema.JsonObject>().notNull(),
  state: text().notNull(),
  reason: text(),
  draftId: text("draft_id"),
  dispatchedAt: timestamp("dispatched_at", { withTimezone: true, mode: "string" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  settledAt: timestamp("settled_at", { withTimezone: true, mode: "string" }),
});
