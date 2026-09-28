import { sql } from "drizzle-orm";
import type * as Schema from "effect/Schema";
import type { Transaction } from "../transaction";

type JsonObject = Schema.JsonObject;

// The cash-flow owner's retained inputs only. This module selects; it never
// classifies a row, chooses a perimeter, derives a sign or renders a statement.
// Every fact the owner reports comes from these posted records inside the
// caller's transaction.
export const cashFlowTables = [
  "books",
  "accounts",
  "vouchers",
  "journal_lines",
  "periods",
] as const;

export type CashFlowBookRow = {
  readonly entityId: string;
  readonly currency: string;
  readonly committedSequence: string;
};

export type CashFlowAccountRow = {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly version: string;
};

export type CashFlowComponentRow = {
  readonly componentId: string;
  readonly voucherId: string;
  readonly lineId: string;
  readonly postingDate: string;
  readonly accountId: string;
  readonly debitMinor: string;
  readonly creditMinor: string;
  readonly ownedTransfer: boolean;
};

// Every posted journal line inside the requested interval and at or before the
// book boundary, not only the cash lines. The owner needs the non-cash
// counterpart of each cash leg, and a voucher that moves cash against cash has
// no non-cash counterpart at all, so the whole voucher membership is required
// for the transfer check to mean anything.
//
// ownedTransfer comes from the voucher posting purpose, which is the owned
// transfer identity. Two equal and opposite cash amounts are never treated as a
// transfer on their own: without that purpose the owner must leave the row
// unclassified.
const ownedResultTransferPurposes: ReadonlyArray<string> = ["result_transfer_v1"];

export function readCashFlowBook(transaction: Transaction, bookId: string) {
  return transaction.execute<CashFlowBookRow>(
    sql`
      select entity_id as "entityId", currency, committed_sequence::text as "committedSequence"
      from openerp.books where id = ${bookId}
    `,
    "objects",
  );
}

export function readCashFlowAccounts(transaction: Transaction, bookId: string, limit: number) {
  return transaction.execute<CashFlowAccountRow>(
    sql`
      select id, code, name, version::text as version
      from openerp.accounts where book_id = ${bookId}
      order by code
      limit ${limit + 1}
    `,
    "objects",
  );
}

// fromDate is null for the whole retained history, which is what the owner
// needs: opening cash is the balance before startsOn, so history before the
// reported interval has to be read too, not just the interval itself.
export function readCashFlowComponents(
  transaction: Transaction,
  bookId: string,
  fromDate: string | null,
  endsOn: string,
  sequence: string,
  limit: number,
) {
  return transaction.execute<CashFlowComponentRow>(
    sql`
      select v.id || '_' || l.ordinal as "componentId", v.id as "voucherId", l.id as "lineId",
        v.posting_date::text as "postingDate", l.account_id as "accountId",
        l.debit_minor::text as "debitMinor", l.credit_minor::text as "creditMinor",
        v.posting_purpose in (${sql.join(
          ownedResultTransferPurposes.map((purpose) => sql`${purpose}`),
          sql`, `,
        )}) as "ownedTransfer"
      from openerp.journal_lines l
      join openerp.vouchers v on v.book_id = l.book_id and v.id = l.voucher_id
      where l.book_id = ${bookId} and v.sequence <= ${sequence}::bigint
        and v.posting_date <= ${endsOn}::date
        and (${fromDate}::date is null or v.posting_date >= ${fromDate}::date)
      order by v.sequence, l.ordinal
      limit ${limit + 1}
    `,
    "objects",
  );
}

export type CashFlowPeriodRow = {
  readonly id: string;
  readonly startsOn: string;
  readonly endsOn: string;
};

// Retained period coverage. The owner uses this as its source-control basis:
// a reported interval that is not fully covered by retained periods is not a
// complete statement, and the owner says so rather than filling the gap.
export function readCashFlowPeriods(transaction: Transaction, bookId: string, limit: number) {
  return transaction.execute<CashFlowPeriodRow>(
    sql`
      select id, starts_on::text as "startsOn", ends_on::text as "endsOn"
      from openerp.periods where book_id = ${bookId}
      order by starts_on
      limit ${limit + 1}
    `,
    "objects",
  );
}

export type { JsonObject };
