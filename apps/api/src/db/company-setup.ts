import { sql } from "drizzle-orm";
import * as Schema from "effect/Schema";
import type { Transaction } from "./transaction";

type JsonObject = Schema.JsonObject;

export const companySetupTables = [
  "entities",
  "books",
  "memberships",
  "actors",
  "company_setups",
  "company_setup_commands",
] as const;

export type BookSetupRow = {
  readonly entityId: string;
  readonly name: string;
  readonly profile: string;
};

export type SetupRow = {
  readonly details: JsonObject;
  readonly revision: number;
  readonly createdBy: string;
};

export type CommandRow = {
  readonly operation: string;
  readonly bookId: string;
  readonly payloadDigest: string;
  readonly result: JsonObject;
};

export type CountRow = { readonly total: number };

export function readSetupBook(transaction: Transaction, bookId: string) {
  return transaction.execute<BookSetupRow>(
    sql`
      select entity_id as "entityId", name, profile
      from openerp.books
      where id = ${bookId}
    `,
    "objects",
  );
}

export function lockSetupBook(transaction: Transaction, bookId: string) {
  return transaction.execute<{ readonly id: string }>(
    sql`select id from openerp.books where id = ${bookId} for update`,
    "objects",
  );
}

export function readSetup(transaction: Transaction, bookId: string, lock: boolean) {
  return transaction.execute<SetupRow>(
    sql`
      select details, revision, created_by as "createdBy"
      from openerp.company_setups
      where book_id = ${bookId}
      ${lock ? sql`for update` : sql`for share`}
    `,
    "objects",
  );
}

export function readCommand(transaction: Transaction, actorId: string, key: string) {
  return transaction.execute<CommandRow>(
    sql`
      select operation, book_id as "bookId", openerp.digest(payload) as "payloadDigest", result
      from openerp.company_setup_commands
      where actor_id = ${actorId} and key = ${key}
      for update
    `,
    "objects",
  );
}

export function countCreatedCompanies(transaction: Transaction, actorId: string) {
  return transaction.execute<CountRow>(
    sql`
      select count(*)::integer as total
      from openerp.company_setups
      where created_by = ${actorId}
    `,
    "objects",
  );
}

export function insertEntity(transaction: Transaction, row: { entityId: string; name: string }) {
  return transaction.execute(
    sql`insert into openerp.entities (id, name) values (${row.entityId}, ${row.name})`,
    "objects",
  );
}

export function insertBook(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly entityId: string;
    readonly name: string;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.books (id, entity_id, name, currency, currency_scale, profile)
      values (${row.bookId}, ${row.entityId}, ${row.name}, 'SEK', 2, 'company-setup-v1')
    `,
    "objects",
  );
}

export function insertOperatorMembership(
  transaction: Transaction,
  row: { readonly bookId: string; readonly actorId: string },
) {
  return transaction.execute(
    sql`
      insert into openerp.memberships (book_id, actor_id, role)
      values (${row.bookId}, ${row.actorId}, 'operator')
    `,
    "objects",
  );
}

export function upsertSetup(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly details: JsonObject;
    readonly revision: number;
    readonly actorId: string;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.company_setups (book_id, details, revision, created_by)
      values (${row.bookId}, ${JSON.stringify(row.details)}::jsonb, ${row.revision}, ${row.actorId})
      on conflict (book_id) do update
        set details = excluded.details, revision = excluded.revision
    `,
    "objects",
  );
}

export function renameBook(transaction: Transaction, bookId: string, name: string) {
  return transaction.execute(
    sql`update openerp.books set name = ${name} where id = ${bookId}`,
    "objects",
  );
}

export function insertCommand(
  transaction: Transaction,
  row: {
    readonly actorId: string;
    readonly key: string;
    readonly bookId: string;
    readonly operation: string;
    readonly payload: JsonObject;
    readonly result: JsonObject;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.company_setup_commands (actor_id, key, book_id, operation, payload, result)
      values (${row.actorId}, ${row.key}, ${row.bookId}, ${row.operation},
        ${JSON.stringify(row.payload)}::jsonb, ${JSON.stringify(row.result)}::jsonb)
    `,
    "objects",
  );
}
