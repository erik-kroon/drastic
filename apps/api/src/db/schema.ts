import type { IdentityProvisioning } from "@open-erp/contracts/identity";
import {
  bigint,
  boolean,
  date,
  integer,
  jsonb,
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
