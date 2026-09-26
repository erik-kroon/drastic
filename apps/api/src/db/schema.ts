import type { IdentityProvisioning } from "@open-erp/contracts/identity";
import type * as Recovery from "@open-erp/contracts/posting-recovery";
import type * as Schema from "effect/Schema";
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
  body: jsonb("body").$type<Schema.JsonObject>().notNull(),
});
