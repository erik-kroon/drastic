import { sql } from "drizzle-orm";
import type { Transaction } from "../transaction";
import { allocatedLineSql, allocatedSourceSql } from "./shared";

type Json = import("effect/Schema").Json;

type JsonObject = import("effect/Schema").JsonObject;

export type StatementRow = {
  readonly id: string;
  readonly accountId: string;
  readonly sourceBankAccountId: string;
  readonly statementIdentifier: string;
  readonly evidenceId: string;
  readonly startsOn: string;
  readonly endsOn: string;
  readonly source: JsonObject;
  readonly importInput: JsonObject;
  readonly evidenceSha256: string;
};

export type ObservationRow = {
  readonly statementId: string;
  readonly rowOrdinal: number;
  readonly providerId: string | null;
  readonly sourceBankAccountId: string;
  readonly observedOn: string;
  readonly description: string;
  readonly amountMinor: string;
  readonly accountId: string;
  readonly evidenceId: string;
  readonly evidenceSha256: string;
  readonly startsOn: string;
  readonly endsOn: string;
};

export type LineRow = {
  readonly voucherId: string;
  readonly lineId: string;
  readonly ordinal: number;
  readonly accountId: string;
  readonly description: string;
  readonly amountMinor: string;
  readonly postedOn: string;
  readonly sequence: string;
  readonly postingPurpose: string;
  readonly action: Json;
};

export type MatchRow = {
  readonly statementId: string;
  readonly rowOrdinal: number;
  readonly voucherId: string;
  readonly lineId: string;
  readonly origin: string;
  readonly actorId: string;
};

export type ReportBoundsRow = {
  readonly observations: number;
  readonly lines: number;
  readonly statements: number;
  readonly allocations: number;
};

export type LedgerTotalsRow = {
  readonly openingMinor: string;
  readonly closingMinor: string;
  readonly sequence: string;
};

export type SourceRevisionRow = { readonly revision: string | null };

export type IntervalStatementRow = {
  readonly id: string;
  readonly startsOn: string;
  readonly endsOn: string;
  readonly openingMinor: string;
  readonly closingMinor: string;
  readonly declaredComplete: string | null;
  readonly body: JsonObject;
};

export function statementBodyColumns() {
  return sql`jsonb_build_object(
    'id', s.id, 'kind', s.source->>'kind', 'statementIdentifier', s.statement_identifier,
    'sourceBankAccountId', s.source_bank_account_id, 'accountId', s.account_id,
    'startsOn', s.starts_on::text, 'endsOn', s.ends_on::text, 'evidenceId', s.evidence_id,
    'evidenceSha256', e.sha256, 'currency', s.source->>'currency',
    'openingMinor', s.source->>'openingMinor', 'closingMinor', s.source->>'closingMinor',
    'completeness', s.source->'completeness', 'rows', s.source->'rows')`;
}

export function matchBodyColumns() {
  return sql`jsonb_build_object('statementId', m.statement_id, 'rowOrdinal', m.row_ordinal,
    'voucherId', m.voucher_id, 'lineId', m.line_id, 'origin', m.origin, 'actorId', m.actor_id)`;
}

export function readStatement(transaction: Transaction, bookId: string, statementId: string) {
  return transaction.execute<StatementRow>(
    sql`
      select s.id, s.account_id as "accountId", s.source_bank_account_id as "sourceBankAccountId",
        s.statement_identifier as "statementIdentifier", s.evidence_id as "evidenceId",
        s.starts_on::text as "startsOn", s.ends_on::text as "endsOn", s.source,
        s.import_input as "importInput", e.sha256 as "evidenceSha256"
      from openerp.bank_statements s
      join openerp.evidence e on (e.book_id, e.id) = (s.book_id, s.evidence_id)
      where s.book_id = ${bookId} and s.id = ${statementId}
    `,
    "objects",
  );
}

export function readStatementByIdentity(
  transaction: Transaction,
  bookId: string,
  sourceBankAccountId: string,
  statementIdentifier: string,
) {
  return transaction.execute<StatementRow>(
    sql`
      select s.id, s.account_id as "accountId", s.source_bank_account_id as "sourceBankAccountId",
        s.statement_identifier as "statementIdentifier", s.evidence_id as "evidenceId",
        s.starts_on::text as "startsOn", s.ends_on::text as "endsOn", s.source,
        s.import_input as "importInput", e.sha256 as "evidenceSha256"
      from openerp.bank_statements s
      join openerp.evidence e on (e.book_id, e.id) = (s.book_id, s.evidence_id)
      where s.book_id = ${bookId} and s.source_bank_account_id = ${sourceBankAccountId}
        and s.statement_identifier = ${statementIdentifier}
    `,
    "objects",
  );
}

export function readObservation(
  transaction: Transaction,
  bookId: string,
  statementId: string,
  rowOrdinal: number,
) {
  return transaction.execute<ObservationRow>(
    sql`
      select o.statement_id as "statementId", o.row_ordinal as "rowOrdinal",
        o.provider_id as "providerId", o.source_bank_account_id as "sourceBankAccountId",
        o.observed_on::text as "observedOn", o.description, o.amount_minor::text as "amountMinor",
        s.account_id as "accountId", s.evidence_id as "evidenceId", e.sha256 as "evidenceSha256",
        s.starts_on::text as "startsOn", s.ends_on::text as "endsOn"
      from openerp.bank_observations o
      join openerp.bank_statements s on (s.book_id, s.id) = (o.book_id, o.statement_id)
      join openerp.evidence e on (e.book_id, e.id) = (s.book_id, s.evidence_id)
      where o.book_id = ${bookId} and o.statement_id = ${statementId} and o.row_ordinal = ${rowOrdinal}
    `,
    "objects",
  );
}

export function readLine(
  transaction: Transaction,
  bookId: string,
  voucherId: string,
  lineId: string,
) {
  return transaction.execute<LineRow>(
    sql`
      select l.voucher_id as "voucherId", l.id as "lineId", l.ordinal, l.account_id as "accountId",
        l.description, (l.debit_minor - l.credit_minor)::text as "amountMinor",
        v.posting_date::text as "postedOn", v.sequence::text as sequence,
        v.posting_purpose as "postingPurpose", v.action
      from openerp.journal_lines l
      join openerp.vouchers v on (v.book_id, v.id) = (l.book_id, l.voucher_id)
      where l.book_id = ${bookId} and l.voucher_id = ${voucherId} and l.id = ${lineId}
    `,
    "objects",
  );
}

export function readObservationMatch(
  transaction: Transaction,
  bookId: string,
  statementId: string,
  rowOrdinal: number,
) {
  return transaction.execute<MatchRow>(
    sql`
      select statement_id as "statementId", row_ordinal as "rowOrdinal",
        voucher_id as "voucherId", line_id as "lineId", origin, actor_id as "actorId"
      from openerp.bank_matches
      where book_id = ${bookId} and statement_id = ${statementId} and row_ordinal = ${rowOrdinal}
    `,
    "objects",
  );
}

export function readLineMatch(
  transaction: Transaction,
  bookId: string,
  voucherId: string,
  lineId: string,
) {
  return transaction.execute<MatchRow>(
    sql`
      select statement_id as "statementId", row_ordinal as "rowOrdinal",
        voucher_id as "voucherId", line_id as "lineId", origin, actor_id as "actorId"
      from openerp.bank_matches
      where book_id = ${bookId} and voucher_id = ${voucherId} and line_id = ${lineId}
    `,
    "objects",
  );
}

export function readAllocatedLegPresence(
  transaction: Transaction,
  bookId: string,
  statementId: string,
  rowOrdinal: number,
  voucherId: string,
  lineId: string,
) {
  return transaction.execute<{ readonly present: boolean }>(
    sql`
      select exists (
        select 1 from openerp.bank_active_allocation_legs a
        where a.book_id = ${bookId}
          and ((a.statement_id = ${statementId} and a.row_ordinal = ${rowOrdinal})
            or (a.voucher_id = ${voucherId} and a.line_id = ${lineId}))
      ) as present
    `,
    "objects",
  );
}

export function insertMatch(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly statementId: string;
    readonly rowOrdinal: number;
    readonly voucherId: string;
    readonly lineId: string;
    readonly origin: string;
    readonly actorId: string;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.bank_matches
        (book_id, statement_id, row_ordinal, voucher_id, line_id, origin, actor_id)
      values (${row.bookId}, ${row.statementId}, ${row.rowOrdinal}, ${row.voucherId}, ${row.lineId},
        ${row.origin}, ${row.actorId})
    `,
    "objects",
  );
}

export function readStatementMatches(
  transaction: Transaction,
  bookId: string,
  statementId: string,
) {
  return transaction.execute<{ readonly matches: Json }>(
    sql`
      select coalesce(jsonb_agg(${matchBodyColumns()} order by m.row_ordinal), '[]'::jsonb) as matches
      from openerp.bank_active_matches m
      where m.book_id = ${bookId} and m.statement_id = ${statementId}
    `,
    "objects",
  );
}

export function readStatementCut(
  transaction: Transaction,
  bookId: string,
  accountId: string,
  startsOn: string,
  endsOn: string,
) {
  return transaction.execute<{ readonly present: boolean }>(
    sql`
      select exists (
        select 1 from openerp.bank_statements s
        where s.book_id = ${bookId} and s.account_id = ${accountId}
          and s.starts_on <= ${endsOn}::date and s.ends_on >= ${startsOn}::date
          and (s.starts_on < ${startsOn}::date or s.ends_on > ${endsOn}::date)
      ) as present
    `,
    "objects",
  );
}

export function readIntervalStatements(
  transaction: Transaction,
  bookId: string,
  accountId: string,
  startsOn: string,
  endsOn: string,
) {
  return transaction.execute<IntervalStatementRow>(
    sql`
      select s.id, s.starts_on::text as "startsOn", s.ends_on::text as "endsOn",
        s.source->>'openingMinor' as "openingMinor", s.source->>'closingMinor' as "closingMinor",
        s.source->'completeness'->>'declaredComplete' as "declaredComplete",
        ${statementBodyColumns()} as body
      from openerp.bank_statements s
      join openerp.evidence e on (e.book_id, e.id) = (s.book_id, s.evidence_id)
      where s.book_id = ${bookId} and s.account_id = ${accountId}
        and s.starts_on >= ${startsOn}::date and s.ends_on <= ${endsOn}::date
      order by s.starts_on, s.id collate "C"
    `,
    "objects",
  );
}

export function readReportBounds(
  transaction: Transaction,
  bookId: string,
  accountId: string,
  startsOn: string,
  endsOn: string,
  committedSequence: string,
) {
  return transaction.execute<ReportBoundsRow>(
    sql`
      select
        (select count(*) from (
          select 1 from openerp.bank_observations o
          join openerp.bank_statements s on (s.book_id, s.id) = (o.book_id, o.statement_id)
          where s.book_id = ${bookId} and s.account_id = ${accountId}
            and s.starts_on >= ${startsOn}::date and s.ends_on <= ${endsOn}::date
          union all
          select 1 from openerp.journal_lines l
          join openerp.vouchers v on (v.book_id, v.id) = (l.book_id, l.voucher_id)
          where l.book_id = ${bookId} and l.account_id = ${accountId}
            and v.posting_date between ${startsOn}::date and ${endsOn}::date
            and v.sequence <= ${committedSequence}::bigint
          limit 1001
        ) selected_rows)::integer as observations,
        (select count(*) from (
          select 1 from openerp.bank_statements s
          where s.book_id = ${bookId} and s.account_id = ${accountId}
            and s.starts_on >= ${startsOn}::date and s.ends_on <= ${endsOn}::date
          limit 101
        ) selected_statements)::integer as statements,
        (select count(*) from openerp.bank_active_allocation_legs a
          join openerp.bank_statements s on (s.book_id, s.id) = (a.book_id, a.statement_id)
          where s.book_id = ${bookId} and s.account_id = ${accountId}
            and s.starts_on >= ${startsOn}::date and s.ends_on <= ${endsOn}::date
          limit 1001)::integer as allocations
    `,
    "objects",
  );
}

export function readLedgerTotals(
  transaction: Transaction,
  bookId: string,
  accountId: string,
  startsOn: string,
  endsOn: string,
  committedSequence: string,
) {
  return transaction.execute<LedgerTotalsRow>(
    sql`
      select
        coalesce(sum(l.debit_minor - l.credit_minor) filter (
          where v.posting_date < ${startsOn}::date), 0)::text as "openingMinor",
        coalesce(sum(l.debit_minor - l.credit_minor), 0)::text as "closingMinor",
        coalesce(max(v.sequence), 0)::text as sequence
      from openerp.journal_lines l
      join openerp.vouchers v on (v.book_id, v.id) = (l.book_id, l.voucher_id)
      where l.book_id = ${bookId} and l.account_id = ${accountId}
        and v.posting_date <= ${endsOn}::date and v.sequence <= ${committedSequence}::bigint
    `,
    "objects",
  );
}

export function readSourceRows(
  transaction: Transaction,
  bookId: string,
  accountId: string,
  startsOn: string,
  endsOn: string,
  capacity: boolean,
) {
  const book = sql`${bookId}`;
  const allocated = allocatedSourceSql(book, sql`s.id`, sql`o.row_ordinal`);

  return transaction.execute<{ readonly rows: Json }>(
    sql`
      select coalesce(jsonb_agg(jsonb_build_object(
          'statementId', o.statement_id, 'evidenceId', s.evidence_id, 'evidenceSha256', e.sha256,
          'rowOrdinal', o.row_ordinal, 'providerId', o.provider_id, 'date', o.observed_on::text,
          'description', o.description, 'amountMinor', o.amount_minor::text
          ${capacity ? sql`, 'allocatedMinor', (${allocated})::text` : sql``}
          ${capacity ? sql`, 'remainingMinor', (o.amount_minor - ${allocated})::text` : sql``}
        ) order by s.starts_on, o.row_ordinal), '[]'::jsonb) as rows
      from openerp.bank_observations o
      join openerp.bank_statements s on (s.book_id, s.id) = (o.book_id, o.statement_id)
      join openerp.evidence e on (e.book_id, e.id) = (s.book_id, s.evidence_id)
      where s.book_id = ${bookId} and s.account_id = ${accountId}
        and s.starts_on >= ${startsOn}::date and s.ends_on <= ${endsOn}::date
    `,
    "objects",
  );
}

export function readLedgerRows(
  transaction: Transaction,
  bookId: string,
  accountId: string,
  startsOn: string,
  endsOn: string,
  committedSequence: string,
  capacity: boolean,
) {
  const book = sql`${bookId}`;
  const allocated = allocatedLineSql(book, sql`l.voucher_id`, sql`l.id`);

  return transaction.execute<{ readonly rows: Json }>(
    sql`
      select coalesce(jsonb_agg(jsonb_build_object(
          'voucherId', v.id, 'lineId', l.id, 'date', v.posting_date::text, 'sequence', v.sequence::text,
          'description', l.description, 'amountMinor', (l.debit_minor - l.credit_minor)::text
          ${capacity ? sql`, 'allocatedMinor', (${allocated})::text` : sql``}
          ${capacity ? sql`, 'remainingMinor', (l.debit_minor - l.credit_minor - ${allocated})::text` : sql``}
        ) order by v.sequence, l.ordinal), '[]'::jsonb) as rows
      from openerp.journal_lines l
      join openerp.vouchers v on (v.book_id, v.id) = (l.book_id, l.voucher_id)
      where l.book_id = ${bookId} and l.account_id = ${accountId}
        and v.posting_date between ${startsOn}::date and ${endsOn}::date
        and v.sequence <= ${committedSequence}::bigint
    `,
    "objects",
  );
}

export function readIntervalMatches(
  transaction: Transaction,
  bookId: string,
  accountId: string,
  startsOn: string,
  endsOn: string,
) {
  return transaction.execute<{ readonly matches: Json }>(
    sql`
      select coalesce(jsonb_agg(${matchBodyColumns()} order by s.starts_on, m.row_ordinal),
        '[]'::jsonb) as matches
      from openerp.bank_active_matches m
      join openerp.bank_statements s on (s.book_id, s.id) = (m.book_id, m.statement_id)
      where s.book_id = ${bookId} and s.account_id = ${accountId}
        and s.starts_on >= ${startsOn}::date and s.ends_on <= ${endsOn}::date
    `,
    "objects",
  );
}

export function readIntervalAllocations(
  transaction: Transaction,
  bookId: string,
  accountId: string,
  startsOn: string,
  endsOn: string,
) {
  return transaction.execute<{ readonly legs: Json }>(
    sql`
      select coalesce(jsonb_agg(jsonb_build_object('planId', a.plan_id, 'ordinal', a.ordinal,
          'statementId', a.statement_id, 'rowOrdinal', a.row_ordinal, 'voucherId', a.voucher_id,
          'lineId', a.line_id, 'amountMinor', a.amount_minor::text)
        order by a.plan_id, a.ordinal), '[]'::jsonb) as legs
      from openerp.bank_active_allocation_legs a
      join openerp.bank_statements s on (s.book_id, s.id) = (a.book_id, a.statement_id)
      where s.book_id = ${bookId} and s.account_id = ${accountId}
        and s.starts_on >= ${startsOn}::date and s.ends_on <= ${endsOn}::date
    `,
    "objects",
  );
}

export function readAccountLedgerSequence(
  transaction: Transaction,
  bookId: string,
  accountId: string,
  endsOn: string,
) {
  return transaction.execute<{ readonly sequence: string }>(
    sql`
      select coalesce(max(v.sequence), 0)::text as sequence
      from openerp.journal_lines l
      join openerp.vouchers v on (v.book_id, v.id) = (l.book_id, l.voucher_id)
      where l.book_id = ${bookId} and l.account_id = ${accountId}
        and v.posting_date <= ${endsOn}::date
    `,
    "objects",
  );
}
