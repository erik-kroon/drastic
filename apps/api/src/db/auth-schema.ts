import {
  bigint,
  boolean,
  index,
  integer,
  pgSchema,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { actors } from "./schema";

const auth = pgSchema("openerp_auth");

export const user = auth.table("user", {
  id: text()
    .primaryKey()
    .references(() => actors.id),
  name: text().notNull(),
  email: text().notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const session = auth.table(
  "session",
  {
    id: text().primaryKey(),
    token: text().notNull().unique(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
  },
  (table) => [index("session_user_id_idx").on(table.userId)],
);

export const account = auth.table(
  "account",
  {
    id: text().primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text(),
    password: text(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("account_user_id_idx").on(table.userId),
    unique("account_provider_identity_key").on(table.providerId, table.accountId),
  ],
);

export const verification = auth.table(
  "verification",
  {
    id: text().primaryKey(),
    identifier: text().notNull(),
    value: text().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);

export const rateLimit = auth.table("rate_limit", {
  id: text().primaryKey(),
  key: text().notNull().unique(),
  count: integer().notNull(),
  // Epoch milliseconds, not a financial amount; safely representable as a JS number.
  lastRequest: bigint("last_request", { mode: "number" }).notNull(),
});
