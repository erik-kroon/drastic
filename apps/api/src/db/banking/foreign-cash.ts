import { sql } from "drizzle-orm";
import type { Transaction } from "../transaction";
import type * as Schema from "effect/Schema";

type JsonObject = Schema.JsonObject;

export const tables = [
  "bank_foreign_cash_accounts",
  "bank_foreign_cash_reviews",
  "bank_foreign_cash_approvals",
  "bank_foreign_cash_executions",
  "bank_foreign_cash_effects",
  "bank_foreign_cash_obligation_effects",
  "bank_foreign_cash_native_consumptions",
  "bank_foreign_cash_opening_lines",
  "bank_foreign_cash_book_consumptions",
] as const;

export function readAccount(transaction: Transaction, bookId: string, accountId: string) {
  return transaction.execute<{ readonly body: JsonObject }>(
    sql`select body from openerp.bank_foreign_cash_accounts where book_id=${bookId} and account_id=${accountId}`,
    "objects",
  );
}

export function readEffects(transaction: Transaction, bookId: string, accountId: string) {
  return transaction.execute<{
    readonly id: string;
    readonly nativeDeltaMinor: string;
    readonly carryingDeltaMinor: string;
    readonly actualOn: string;
  }>(
    sql`select id, native_delta_minor::text as "nativeDeltaMinor", carrying_delta_minor::text as "carryingDeltaMinor",actual_on::text as "actualOn" from openerp.bank_foreign_cash_effects where book_id=${bookId} and account_id=${accountId} order by id collate "C"`,
    "objects",
  );
}

export function readObligationConsumptions(
  transaction: Transaction,
  bookId: string,
  itemId: string,
) {
  return transaction.execute<{
    readonly id: string;
    readonly originalReleasedMinor: string;
    readonly carryingReleasedMinor: string;
    readonly body: JsonObject;
  }>(
    sql`select id,native_minor::text as "originalReleasedMinor",carrying_minor::text as "carryingReleasedMinor",body from openerp.bank_foreign_cash_obligation_effects where book_id=${bookId} and item_id=${itemId} order by id collate "C"`,
    "objects",
  );
}

export function readLedger(
  transaction: Transaction,
  bookId: string,
  accountId: string,
  cutoff: string,
) {
  return transaction.execute<{ readonly carryingMinor: string }>(
    sql`select coalesce(sum(l.debit_minor-l.credit_minor),0)::text as "carryingMinor" from openerp.journal_lines l join openerp.vouchers v on (v.book_id,v.id)=(l.book_id,l.voucher_id) where l.book_id=${bookId} and l.account_id=${accountId} and v.posting_date<=${cutoff}::date`,
    "objects",
  );
}

export function readReview(transaction: Transaction, bookId: string, id: string) {
  return transaction.execute<{ readonly body: JsonObject }>(
    sql`select body from openerp.bank_foreign_cash_reviews where book_id=${bookId} and id=${id}`,
    "objects",
  );
}

export function readApproval(
  transaction: Transaction,
  bookId: string,
  reviewId: string,
  id: string,
) {
  return transaction.execute<{ readonly body: JsonObject }>(
    sql`select body from openerp.bank_foreign_cash_approvals where book_id=${bookId} and review_id=${reviewId} and id=${id}`,
    "objects",
  );
}

export function readExecution(transaction: Transaction, bookId: string, reviewId: string) {
  return transaction.execute<{ readonly body: JsonObject }>(
    sql`select body from openerp.bank_foreign_cash_executions where book_id=${bookId} and review_id=${reviewId}`,
    "objects",
  );
}

export function readSourceIdentity(
  transaction: Transaction,
  bookId: string,
  accountId: string,
  identity: string,
) {
  return transaction.execute<{ readonly id: string }>(
    sql`select id from openerp.bank_foreign_cash_effects where book_id=${bookId} and account_id=${accountId} and source_identity=${identity}`,
    "objects",
  );
}

export function insertAccount(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly accountId: string;
    readonly nativeCurrency: string;
    readonly nativeScale: number;
    readonly openedOn: string;
    readonly body: JsonObject;
  },
) {
  return transaction.execute(
    sql`insert into openerp.bank_foreign_cash_accounts(book_id,account_id,native_currency,native_scale,opened_on,body) values (${row.bookId},${row.accountId},${row.nativeCurrency},${row.nativeScale},${row.openedOn}::date,${JSON.stringify(row.body)}::jsonb)`,
    "objects",
  );
}

export function insertReview(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly actorId: string;
    readonly body: JsonObject;
  },
) {
  return transaction.execute(
    sql`insert into openerp.bank_foreign_cash_reviews(book_id,id,actor_id,body) values (${row.bookId},${row.id},${row.actorId},${JSON.stringify(row.body)}::jsonb)`,
    "objects",
  );
}

export function insertApproval(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly reviewId: string;
    readonly actorId: string;
    readonly digest: string;
    readonly expiresAt: string;
    readonly body: JsonObject;
  },
) {
  return transaction.execute(
    sql`insert into openerp.bank_foreign_cash_approvals(book_id,id,review_id,actor_id,digest,expires_at,body) values (${row.bookId},${row.id},${row.reviewId},${row.actorId},${row.digest},${row.expiresAt}::timestamptz,${JSON.stringify(row.body)}::jsonb)`,
    "objects",
  );
}

export function insertExecution(
  transaction: Transaction,
  bookId: string,
  reviewId: string,
  body: JsonObject,
) {
  return transaction.execute(
    sql`insert into openerp.bank_foreign_cash_executions(book_id,review_id,body) values (${bookId},${reviewId},${JSON.stringify(body)}::jsonb)`,
    "objects",
  );
}

export function insertEffect(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly reviewId: string;
    readonly accountId: string;
    readonly sourceIdentity: string;
    readonly nativeDeltaMinor: string;
    readonly carryingDeltaMinor: string;
    readonly actualOn: string;
    readonly voucherId: string | null;
    readonly body: JsonObject;
  },
) {
  return transaction.execute(
    sql`insert into openerp.bank_foreign_cash_effects(book_id,id,review_id,account_id,source_identity,native_delta_minor,carrying_delta_minor,actual_on,voucher_id,body) values (${row.bookId},${row.id},${row.reviewId},${row.accountId},${row.sourceIdentity},${row.nativeDeltaMinor},${row.carryingDeltaMinor},${row.actualOn}::date,${row.voucherId},${JSON.stringify(row.body)}::jsonb)`,
    "objects",
  );
}

export function insertObligationConsumption(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly itemId: string;
    readonly nativeMinor: string;
    readonly carryingMinor: string;
    readonly body: JsonObject;
  },
) {
  return transaction.execute(
    sql`insert into openerp.bank_foreign_cash_obligation_effects(book_id,id,item_id,native_minor,carrying_minor,body) values (${row.bookId},${row.id},${row.itemId},${row.nativeMinor},${row.carryingMinor},${JSON.stringify(row.body)}::jsonb)`,
    "objects",
  );
}

export function readLatestPostingDate(transaction: Transaction, bookId: string, accountId: string) {
  return transaction.execute<{ readonly latestOn: string | null }>(
    sql`select max(v.posting_date)::text as "latestOn" from openerp.journal_lines l join openerp.vouchers v on (v.book_id,v.id)=(l.book_id,l.voucher_id) where l.book_id=${bookId} and l.account_id=${accountId}`,
    "objects",
  );
}

export function readNativeConsumption(
  transaction: Transaction,
  bookId: string,
  statementId: string,
  rowOrdinal: number,
) {
  return transaction.execute<{ readonly body: JsonObject }>(
    sql`select body from openerp.bank_foreign_cash_native_consumptions where book_id=${bookId} and statement_id=${statementId} and row_ordinal=${rowOrdinal} union all select body from openerp.processor_bank_claims where book_id=${bookId} and statement_id=${statementId} and row_ordinal=${rowOrdinal}`,
    "objects",
  );
}

export function readNativeSourceCapacity(
  transaction: Transaction,
  bookId: string,
  statementId: string,
  rowOrdinal: number,
) {
  return transaction.execute<{ readonly consumed: boolean }>(
    sql`select exists(select 1 from openerp.bank_active_matches where book_id=${bookId} and statement_id=${statementId} and row_ordinal=${rowOrdinal}) or exists(select 1 from openerp.bank_active_allocation_legs where book_id=${bookId} and statement_id=${statementId} and row_ordinal=${rowOrdinal}) as consumed`,
    "objects",
  );
}

export function insertNativeConsumption(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly statementId: string;
    readonly rowOrdinal: number;
    readonly reviewId: string;
    readonly accountId: string;
    readonly nativeMinor: string;
    readonly voucherId: string | null;
    readonly lineId: string | null;
    readonly body: JsonObject;
  },
) {
  return transaction.execute(
    sql`insert into openerp.bank_foreign_cash_native_consumptions(book_id,statement_id,row_ordinal,review_id,account_id,native_minor,voucher_id,line_id,body) values (${row.bookId},${row.statementId},${row.rowOrdinal},${row.reviewId},${row.accountId},${row.nativeMinor},${row.voucherId},${row.lineId},${JSON.stringify(row.body)}::jsonb)`,
    "objects",
  );
}

export function readOpeningLines(
  transaction: Transaction,
  bookId: string,
  accountId: string,
  cutoff: string,
) {
  return transaction.execute<{
    readonly voucherId: string;
    readonly lineId: string;
    readonly postingDate: string;
    readonly signedMinor: string;
  }>(
    sql`select l.voucher_id as "voucherId", l.id as "lineId", v.posting_date::text as "postingDate", (l.debit_minor-l.credit_minor)::text as "signedMinor" from openerp.journal_lines l join openerp.vouchers v on (v.book_id,v.id)=(l.book_id,l.voucher_id) where l.book_id=${bookId} and l.account_id=${accountId} and v.posting_date<=${cutoff}::date order by l.voucher_id collate "C", l.id collate "C"`,
    "objects",
  );
}

export function insertOpeningLine(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly accountId: string;
    readonly voucherId: string;
    readonly lineId: string;
    readonly body: JsonObject;
  },
) {
  return transaction.execute(
    sql`insert into openerp.bank_foreign_cash_opening_lines(book_id,account_id,voucher_id,line_id,body) values (${row.bookId},${row.accountId},${row.voucherId},${row.lineId},${JSON.stringify(row.body)}::jsonb)`,
    "objects",
  );
}

export function readNativeSourceRevisions(
  transaction: Transaction,
  bookId: string,
  statementId: string,
  rowOrdinal: number,
) {
  return transaction.execute<{
    readonly revisionId: string;
    readonly eligibilityVersion: string;
    readonly changeKind: string;
    readonly amountMinor: string | null;
  }>(
    sql`select h.latest_revision_id as "revisionId", h.eligibility_version::text as "eligibilityVersion", r.change_kind as "changeKind", r.normalized->>'cashMovementMinor' as "amountMinor" from openerp.bank_observation_heads h join openerp.bank_source_revisions r on (r.book_id,r.id)=(h.book_id,h.latest_revision_id) where h.book_id=${bookId} and h.admitted_statement_id=${statementId} and h.admitted_row_ordinal=${rowOrdinal} order by h.consent_id collate "C", h.provider_transaction_id collate "C"`,
    "objects",
  );
}

export function readBookConsumption(
  transaction: Transaction,
  bookId: string,
  statementId: string,
  rowOrdinal: number,
) {
  return transaction.execute<{ readonly body: JsonObject }>(
    sql`select body from openerp.bank_foreign_cash_book_consumptions where book_id=${bookId} and statement_id=${statementId} and row_ordinal=${rowOrdinal}`,
    "objects",
  );
}

export function insertBookConsumption(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly statementId: string;
    readonly rowOrdinal: number;
    readonly reviewId: string;
    readonly accountId: string;
    readonly nativeMinor: string;
    readonly voucherId: string;
    readonly lineId: string;
    readonly body: JsonObject;
  },
) {
  return transaction.execute(
    sql`insert into openerp.bank_foreign_cash_book_consumptions(book_id,statement_id,row_ordinal,review_id,account_id,native_minor,voucher_id,line_id,body) values (${row.bookId},${row.statementId},${row.rowOrdinal},${row.reviewId},${row.accountId},${row.nativeMinor},${row.voucherId},${row.lineId},${JSON.stringify(row.body)}::jsonb)`,
    "objects",
  );
}

export function readNativeStatementCoverage(
  transaction: Transaction,
  bookId: string,
  statementId: string,
) {
  return transaction.execute<{ readonly complete: boolean }>(
    sql`select not exists(select 1 from openerp.bank_observations o join openerp.bank_statements s on (s.book_id,s.id)=(o.book_id,o.statement_id) where o.book_id=${bookId} and o.statement_id=${statementId} and not exists(select 1 from openerp.bank_foreign_cash_native_consumptions c where (c.book_id,c.statement_id,c.row_ordinal,c.account_id,c.native_minor)=(o.book_id,o.statement_id,o.row_ordinal,s.account_id,o.amount_minor)) and not exists(select 1 from openerp.processor_bank_claims c where (c.book_id,c.statement_id,c.row_ordinal,c.account_id,c.native_minor)=(o.book_id,o.statement_id,o.row_ordinal,s.account_id,o.amount_minor))) as complete`,
    "objects",
  );
}
