import type * as Bank from "@open-erp/contracts/reconciliation";
import { sql } from "drizzle-orm";
import type * as Schema from "effect/Schema";
import { textArray } from "../sql-values";
import type { Transaction } from "../transaction";

type JsonObject = Schema.JsonObject;
type Source = typeof Bank.StatementSource.Type;

export function readConflicts(transaction: Transaction, bookId: string, source: Source) {
  const providerIds = source.rows.flatMap((row) =>
    row.providerId === null ? [] : [row.providerId],
  );
  return transaction.execute<{
    readonly mapping: boolean;
    readonly overlap: boolean;
    readonly provider: boolean;
  }>(
    sql`
    select
      exists(select 1 from openerp.bank_sources where book_id = ${bookId}
        and ((account_id = ${source.accountId} and source_bank_account_id <> ${source.sourceBankAccountId})
          or (source_bank_account_id = ${source.sourceBankAccountId} and account_id <> ${source.accountId}))) as mapping,
      exists(select 1 from openerp.bank_statements where book_id = ${bookId}
        and account_id = ${source.accountId} and starts_on <= ${source.endsOn}::date
        and ends_on >= ${source.startsOn}::date) as overlap,
      exists(select 1 from openerp.bank_observations where book_id = ${bookId}
        and source_bank_account_id = ${source.sourceBankAccountId}
        and provider_id = any(${textArray(providerIds)})) as provider
  `,
    "objects",
  );
}

export function insertSource(
  transaction: Transaction,
  bookId: string,
  accountId: string,
  sourceBankAccountId: string,
) {
  return transaction.execute(
    sql`
      insert into openerp.bank_sources (book_id, account_id, source_bank_account_id)
      values (${bookId}, ${accountId}, ${sourceBankAccountId})
      on conflict do nothing
    `,
    "objects",
  );
}

export function insertStatement(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly accountId: string;
    readonly sourceBankAccountId: string;
    readonly statementIdentifier: string;
    readonly evidenceId: string;
    readonly startsOn: string;
    readonly endsOn: string;
    readonly source: JsonObject;
    readonly importInput: JsonObject;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.bank_statements
        (book_id, id, account_id, source_bank_account_id, statement_identifier, evidence_id,
          starts_on, ends_on, source, import_input)
      values (${row.bookId}, ${row.id}, ${row.accountId}, ${row.sourceBankAccountId},
        ${row.statementIdentifier}, ${row.evidenceId}, ${row.startsOn}::date, ${row.endsOn}::date,
        ${JSON.stringify(row.source)}::jsonb, ${JSON.stringify(row.importInput)}::jsonb)
    `,
    "objects",
  );
}

export function insertObservations(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly statementId: string;
    readonly sourceBankAccountId: string;
    readonly rows: ReadonlyArray<typeof Bank.BankRow.Type>;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.bank_observations (book_id, statement_id, row_ordinal, provider_id,
        source_bank_account_id, observed_on, description, amount_minor)
      select ${row.bookId}, ${row.statementId}, r."rowOrdinal", r."providerId",
        ${row.sourceBankAccountId}, r.date::date, r.description, r."amountMinor"::numeric
      from jsonb_to_recordset(${JSON.stringify(row.rows)}::jsonb) as r(
        "rowOrdinal" integer, "providerId" text, date text, description text, "amountMinor" text)
    `,
    "objects",
  );
}
