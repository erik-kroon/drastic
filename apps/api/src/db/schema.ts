import type { IdentityProvisioning } from "@open-erp/contracts/identity";
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
  plan: jsonb("plan").notNull(),
  digest: text().notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
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
  action: jsonb("action").notNull(),
  expectedLineCount: integer("expected_line_count").notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true, mode: "string" }).notNull(),
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
  body: jsonb("body").notNull(),
});

export const commandReceipts = openerp.table("command_receipts", {
  bookId: text("book_id").notNull(),
  key: text().notNull(),
  requestDigest: text("request_digest").notNull(),
  operation: text().notNull(),
  actorId: text("actor_id").notNull(),
  result: jsonb("result").notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true, mode: "string" }).notNull(),
});

export const outbox = openerp.table("outbox", {
  bookId: text("book_id").notNull(),
  id: text().notNull(),
  receiptId: text("receipt_id").notNull(),
  kind: text().notNull(),
  payload: jsonb("payload").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  deliveredAt: timestamp("delivered_at", { withTimezone: true, mode: "string" }),
  attempts: integer().notNull(),
});

export const postingGroupReceipts = openerp.table("posting_group_receipts", {
  bookId: text("book_id").notNull(),
  id: text().notNull(),
  changeSetId: text("change_set_id").notNull(),
  groupId: text("group_id").notNull(),
  planDigest: text("plan_digest").notNull(),
  body: jsonb("body").notNull(),
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
