import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { Database, databaseLayer } from "../src/db/connection";
import * as tables from "../src/db/schema";
import { AccountingDate, Description, Identifier } from "@open-erp/contracts/accounting";

const Provision = Schema.Struct({
  entity: Schema.Struct({ id: Identifier, name: Description }),
  book: Schema.Struct({
    id: Identifier,
    name: Description,
    currency: Schema.Literal("SEK"),
    profile: Schema.Literal("synthetic-core-v1"),
  }),
  actor: Schema.Struct({
    id: Identifier,
    name: Description,
    role: Schema.Literals(["operator", "agent"]),
    tokenExpiresAt: Schema.String,
  }),
  fiscalYear: Schema.Struct({ id: Identifier, startsOn: AccountingDate, endsOn: AccountingDate }),
  periods: Schema.Array(
    Schema.Struct({ id: Identifier, startsOn: AccountingDate, endsOn: AccountingDate }),
  ).check(Schema.isMinLength(1)),
  accounts: Schema.Array(
    Schema.Struct({ id: Identifier, code: Schema.String, name: Description }),
  ).check(Schema.isMinLength(2)),
});
const filename = process.argv[2];
const connectionString = process.env.DATABASE_ADMIN_URL;
const token = process.env.OPENERP_ACCESS_TOKEN;
if (!filename || !connectionString || !token || token.length < 32 || token.length > 512) {
  throw new Error(
    "Usage: DATABASE_ADMIN_URL=… OPENERP_ACCESS_TOKEN=… bun scripts/provision.ts <explicit-synthetic-book.json>. Use a random token of 32–512 characters.",
  );
}
const config = Schema.decodeSync(Schema.fromJsonString(Provision))(
  await readFile(filename, "utf8"),
);
await Effect.runPromise(
  Effect.gen(function* () {
    const db = yield* Database;
    yield* db.transaction((tx) =>
      Effect.gen(function* () {
        yield* tx.insert(tables.entities).values(config.entity);
        yield* tx.insert(tables.books).values({
          ...config.book,
          entityId: config.entity.id,
          currencyScale: 2,
        });
        yield* tx.insert(tables.actors).values({ id: config.actor.id, name: config.actor.name });
        yield* tx.insert(tables.memberships).values({
          bookId: config.book.id,
          actorId: config.actor.id,
          role: config.actor.role,
        });
        yield* tx.insert(tables.credentials).values({
          tokenHash: createHash("sha256").update(token).digest("hex"),
          actorId: config.actor.id,
          expiresAt: config.actor.tokenExpiresAt,
        });
        yield* tx.insert(tables.fiscalYears).values({
          bookId: config.book.id,
          ...config.fiscalYear,
        });
        yield* tx.insert(tables.periods).values(
          config.periods.map((period) => ({
            bookId: config.book.id,
            fiscalYearId: config.fiscalYear.id,
            ...period,
          })),
        );
        yield* tx
          .insert(tables.accounts)
          .values(config.accounts.map((account) => ({ bookId: config.book.id, ...account })));
      }),
    );
  }).pipe(
    Effect.provide(
      databaseLayer({
        connectionString: Redacted.make(connectionString),
        applicationName: "openerp-provision",
        connectTimeoutMs: 10_000,
        statementTimeoutMs: 15_000,
      }),
    ),
  ),
);
console.info(
  `Created synthetic book ${config.book.id}. No production or compliance capability is enabled.`,
);
