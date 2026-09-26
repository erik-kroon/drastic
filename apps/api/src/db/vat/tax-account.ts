import { sql } from "drizzle-orm";
import * as Effect from "effect/Effect";
import type * as Schema from "effect/Schema";
import { readTableAccess, type JsonObject } from "../commerce/access";
import type { Transaction } from "../transaction";

type Json = Schema.Json;

export type CountRow = { readonly total: number };

export type EventRow = {
  readonly id: string;
  readonly accountId: string;
  readonly eventKey: string;
  readonly statementId: string;
  readonly ordinal: number;
};

export type StatementRow = {
  readonly id: string;
  readonly accountId: string;
  readonly statementKey: string;
  readonly evidenceId: string;
  readonly reviewEvidenceId: string;
  readonly evidenceSha256: string;
  readonly sourceLocator: string;
  readonly startsOn: string;
  readonly endsOn: string;
  readonly body: JsonObject;
};

export type SourceRow = {
  readonly accountId: string;
  readonly sourceKey: string;
};

export type MatchRow = {
  readonly id: string;
  readonly eventId: string;
  readonly voucherId: string;
  readonly lineId: string;
  readonly evidenceId: string;
  readonly body: JsonObject;
};

export type UnmatchRow = {
  readonly id: string;
  readonly matchId: string;
  readonly evidenceId: string;
  readonly body: JsonObject;
};

export type ResolutionRow = {
  readonly id: string;
  readonly eventId: string;
  readonly evidenceId: string;
  readonly body: JsonObject;
};

export type ControlRow = {
  readonly id: string;
  readonly body: JsonObject;
  readonly content: string;
  readonly sha256: string;
  readonly byteLength: number;
};

export type ItemRow = { readonly item: JsonObject };

export type LineRow = {
  readonly voucherId: string;
  readonly lineId: string;
  readonly ordinal: number;
  readonly sequence: string;
  readonly postingDate: string;
  readonly accountId: string;
  readonly debitMinor: string;
  readonly creditMinor: string;
  readonly description: string;
  readonly postingPurpose: string;
  readonly correctsVoucherId: string | null;
  readonly evidenceRefs: Json;
};

export type ReservationRow = { readonly reserved: boolean };

export const taxAccountTables = [
  "tax_account_sources",
  "tax_account_statements",
  "tax_account_events",
  "tax_account_classification_resolutions",
  "tax_account_matches",
  "tax_account_unmatches",
  "tax_account_match_capacity",
  "tax_account_controls",
  "accounts",
  "vouchers",
  "journal_lines",
  "evidence",
  "command_receipts",
  "books",
] as const;

export function readTaxAccountAccess(transaction: Transaction) {
  return readTableAccess(transaction, taxAccountTables);
}

export type BookStateRow = {
  readonly id: string;
  readonly profile: string;
  readonly profileVersion: string;
  readonly writerEpoch: string;
  readonly authority: string;
  readonly currency: string;
  readonly currencyScale: number;
  readonly committedSequence: string;
};

export function readBookState(transaction: Transaction, bookId: string) {
  return transaction.execute<BookStateRow>(
    sql`
      select id, profile, profile_version::text as "profileVersion",
        writer_epoch::text as "writerEpoch", authority, currency,
        currency_scale as "currencyScale", committed_sequence::text as "committedSequence"
      from openerp.books
      where id = ${bookId}
    `,
    "objects",
  );
}

export type PeriodRow = {
  readonly id: string;
  readonly version: string;
  readonly locked: boolean;
};

export function readPeriodsForDate(transaction: Transaction, bookId: string, date: string) {
  return transaction.execute<PeriodRow>(
    sql`
      select id, version::text as version, locked from openerp.periods
      where book_id = ${bookId} and ${date}::date between starts_on and ends_on
      order by id
      for share
    `,
    "objects",
  );
}

const countableTables = new Set([
  "tax_account_sources",
  "tax_account_statements",
  "tax_account_events",
  "tax_account_classification_resolutions",
  "tax_account_matches",
  "tax_account_unmatches",
  "tax_account_controls",
]);

export function readCount(transaction: Transaction, table: string, bookId: string) {
  if (!countableTables.has(table)) return Effect.succeed<ReadonlyArray<CountRow>>([]);

  return transaction.execute<CountRow>(
    sql`select count(*)::integer as total from openerp.${sql.identifier(table)} where book_id = ${bookId}`,
    "objects",
  );
}

export function readSource(transaction: Transaction, bookId: string, accountId: string) {
  return transaction.execute<SourceRow>(
    sql`
      select account_id as "accountId", source_key as "sourceKey"
      from openerp.tax_account_sources
      where book_id = ${bookId} and account_id = ${accountId}
    `,
    "objects",
  );
}

export function readSourceByKey(transaction: Transaction, bookId: string, sourceKey: string) {
  return transaction.execute<SourceRow>(
    sql`
      select account_id as "accountId", source_key as "sourceKey"
      from openerp.tax_account_sources
      where book_id = ${bookId} and source_key = ${sourceKey}
    `,
    "objects",
  );
}

export function readSourceCount(transaction: Transaction, bookId: string) {
  return transaction.execute<CountRow>(
    sql`select count(*)::integer as total from openerp.tax_account_sources where book_id = ${bookId}`,
    "objects",
  );
}

export function insertSource(
  transaction: Transaction,
  row: { readonly bookId: string; readonly accountId: string; readonly sourceKey: string },
) {
  return transaction.execute(
    sql`
      insert into openerp.tax_account_sources (book_id, account_id, source_key)
      values (${row.bookId}, ${row.accountId}, ${row.sourceKey})
    `,
    "objects",
  );
}

export function readStatementByKey(
  transaction: Transaction,
  bookId: string,
  accountId: string,
  statementKey: string,
) {
  return transaction.execute<StatementRow>(
    sql`
      select id, account_id as "accountId", statement_key as "statementKey",
        evidence_id as "evidenceId", review_evidence_id as "reviewEvidenceId",
        evidence_sha256 as "evidenceSha256", source_locator as "sourceLocator",
        starts_on::text as "startsOn", ends_on::text as "endsOn", body
      from openerp.tax_account_statements
      where book_id = ${bookId} and account_id = ${accountId} and statement_key = ${statementKey}
    `,
    "objects",
  );
}

export function readStatementBySource(
  transaction: Transaction,
  bookId: string,
  accountId: string,
  evidenceSha256: string,
  sourceLocator: string,
) {
  return transaction.execute<{ readonly id: string }>(
    sql`
      select id from openerp.tax_account_statements
      where book_id = ${bookId} and account_id = ${accountId}
        and evidence_sha256 = ${evidenceSha256} and source_locator = ${sourceLocator}
    `,
    "objects",
  );
}

export function readStatement(transaction: Transaction, bookId: string, id: string) {
  return transaction.execute<StatementRow>(
    sql`
      select id, account_id as "accountId", statement_key as "statementKey",
        evidence_id as "evidenceId", review_evidence_id as "reviewEvidenceId",
        evidence_sha256 as "evidenceSha256", source_locator as "sourceLocator",
        starts_on::text as "startsOn", ends_on::text as "endsOn", body
      from openerp.tax_account_statements
      where book_id = ${bookId} and id = ${id}
    `,
    "objects",
  );
}

export function readStatementsForAccount(
  transaction: Transaction,
  bookId: string,
  accountId: string,
  startsOn: string,
  endsOn: string,
) {
  return transaction.execute<StatementRow>(
    sql`
      select id, account_id as "accountId", statement_key as "statementKey",
        evidence_id as "evidenceId", review_evidence_id as "reviewEvidenceId",
        evidence_sha256 as "evidenceSha256", source_locator as "sourceLocator",
        starts_on::text as "startsOn", ends_on::text as "endsOn", body
      from openerp.tax_account_statements
      where book_id = ${bookId} and account_id = ${accountId}
        and starts_on >= ${startsOn} and ends_on <= ${endsOn}
      order by starts_on, ends_on, id collate "C"
    `,
    "objects",
  );
}

export function readOverlappingStatements(
  transaction: Transaction,
  bookId: string,
  accountId: string,
  startsOn: string,
  endsOn: string,
) {
  return transaction.execute<{ readonly id: string }>(
    sql`
      select id from openerp.tax_account_statements
      where book_id = ${bookId} and account_id = ${accountId}
        and starts_on <= ${endsOn} and ends_on >= ${startsOn}
        and (starts_on < ${startsOn} or ends_on > ${endsOn})
    `,
    "objects",
  );
}

export function readDependencyStatements(
  transaction: Transaction,
  bookId: string,
  accountId: string,
  startsOn: string,
  endsOn: string,
) {
  return transaction.execute<ItemRow>(
    sql`
      select jsonb_build_object('id', id, 'digest', body->>'digest') as item
      from openerp.tax_account_statements
      where book_id = ${bookId} and account_id = ${accountId}
        and starts_on <= ${endsOn} and ends_on >= ${startsOn}
      order by id collate "C"
    `,
    "objects",
  );
}

export function listStatementItems(transaction: Transaction, bookId: string) {
  return transaction.execute<ItemRow>(
    sql`
      select jsonb_build_object(
        'id', id, 'digest', body->>'digest', 'accountId', account_id,
        'sourceAccountKey', body->'input'->>'sourceAccountKey',
        'statementKey', statement_key,
        'startsOn', starts_on::text, 'endsOn', ends_on::text,
        'createdAt', body->>'createdAt'
      ) as item
      from openerp.tax_account_statements
      where book_id = ${bookId}
      order by starts_on desc, id collate "C"
      limit 201
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
    readonly statementKey: string;
    readonly evidenceId: string;
    readonly reviewEvidenceId: string;
    readonly evidenceSha256: string;
    readonly sourceLocator: string;
    readonly startsOn: string;
    readonly endsOn: string;
    readonly body: JsonObject;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.tax_account_statements
        (book_id, id, account_id, statement_key, evidence_id, review_evidence_id,
          evidence_sha256, source_locator, starts_on, ends_on, body)
      values (${row.bookId}, ${row.id}, ${row.accountId}, ${row.statementKey}, ${row.evidenceId},
        ${row.reviewEvidenceId}, ${row.evidenceSha256}, ${row.sourceLocator}, ${row.startsOn},
        ${row.endsOn}, ${JSON.stringify(row.body)}::jsonb)
    `,
    "objects",
  );
}

export function readEvent(transaction: Transaction, bookId: string, id: string) {
  return transaction.execute<EventRow>(
    sql`
      select id, account_id as "accountId", event_key as "eventKey",
        statement_id as "statementId", ordinal
      from openerp.tax_account_events
      where book_id = ${bookId} and id = ${id}
    `,
    "objects",
  );
}

export function readEventByKey(
  transaction: Transaction,
  bookId: string,
  accountId: string,
  eventKey: string,
) {
  return transaction.execute<{ readonly id: string }>(
    sql`
      select id from openerp.tax_account_events
      where book_id = ${bookId} and account_id = ${accountId} and event_key = ${eventKey}
    `,
    "objects",
  );
}

export function readEventCount(transaction: Transaction, bookId: string) {
  return transaction.execute<CountRow>(
    sql`select count(*)::integer as total from openerp.tax_account_events where book_id = ${bookId}`,
    "objects",
  );
}

export function insertEvents(
  transaction: Transaction,
  rows: ReadonlyArray<{
    readonly bookId: string;
    readonly id: string;
    readonly accountId: string;
    readonly eventKey: string;
    readonly statementId: string;
    readonly ordinal: number;
  }>,
) {
  if (rows.length === 0) return Effect.succeed([]);

  return transaction.execute(
    sql`
      insert into openerp.tax_account_events
        (book_id, id, account_id, event_key, statement_id, ordinal)
      values ${sql.join(
        rows.map(
          (row) =>
            sql`(${row.bookId}, ${row.id}, ${row.accountId}, ${row.eventKey}, ${row.statementId}, ${row.ordinal})`,
        ),
        sql`, `,
      )}
    `,
    "objects",
  );
}

export function readWorklistScan(
  transaction: Transaction,
  bookId: string,
  accountId: string,
  afterId: string,
) {
  return transaction.execute<{ readonly id: string }>(
    sql`
      select id from openerp.tax_account_events
      where book_id = ${bookId} and account_id = ${accountId} and id collate "C" > ${afterId} collate "C"
      order by id collate "C"
      limit 51
    `,
    "objects",
  );
}

export function readResolutionByEvent(transaction: Transaction, bookId: string, eventId: string) {
  return transaction.execute<ResolutionRow>(
    sql`
      select id, event_id as "eventId", evidence_id as "evidenceId", body
      from openerp.tax_account_classification_resolutions
      where book_id = ${bookId} and event_id = ${eventId}
    `,
    "objects",
  );
}

export function readResolutionCount(transaction: Transaction, bookId: string) {
  return transaction.execute<CountRow>(
    sql`
      select count(*)::integer as total from openerp.tax_account_classification_resolutions
      where book_id = ${bookId}
    `,
    "objects",
  );
}

export function readDependencyResolutions(
  transaction: Transaction,
  bookId: string,
  accountId: string,
  startsOn: string,
  endsOn: string,
) {
  return transaction.execute<ItemRow>(
    sql`
      select jsonb_build_object('id', r.id, 'digest', r.body->>'digest') as item
      from openerp.tax_account_classification_resolutions r
      join openerp.tax_account_events e on e.book_id = r.book_id and e.id = r.event_id
      join openerp.tax_account_statements s on s.book_id = e.book_id and s.id = e.statement_id
      where r.book_id = ${bookId} and e.account_id = ${accountId}
        and s.ends_on >= ${startsOn} and s.starts_on <= ${endsOn}
      order by r.id collate "C"
    `,
    "objects",
  );
}

export function insertResolution(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly eventId: string;
    readonly evidenceId: string;
    readonly body: JsonObject;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.tax_account_classification_resolutions
        (book_id, id, event_id, evidence_id, body)
      values (${row.bookId}, ${row.id}, ${row.eventId}, ${row.evidenceId}, ${JSON.stringify(row.body)}::jsonb)
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
      select v.id as "voucherId", l.id as "lineId", l.ordinal, v.sequence::text as sequence,
        v.posting_date::text as "postingDate", l.account_id as "accountId",
        l.debit_minor::text as "debitMinor", l.credit_minor::text as "creditMinor",
        l.description, v.posting_purpose as "postingPurpose",
        v.corrects_voucher_id as "correctsVoucherId", v.action->'evidenceRefs' as "evidenceRefs"
      from openerp.journal_lines l
      join openerp.vouchers v on v.book_id = l.book_id and v.id = l.voucher_id
      where l.book_id = ${bookId} and l.voucher_id = ${voucherId} and l.id = ${lineId}
    `,
    "objects",
  );
}

export function readReservation(
  transaction: Transaction,
  bookId: string,
  eventId: string,
  voucherId: string,
  lineId: string,
) {
  return transaction.execute<ReservationRow>(
    sql`
      select exists(
        select 1 from openerp.tax_account_match_capacity c
        where c.book_id = ${bookId}
          and (c.event_id = ${eventId} or (c.voucher_id = ${voucherId} and c.line_id = ${lineId}))
      ) as reserved
    `,
    "objects",
  );
}

export function readMatch(transaction: Transaction, bookId: string, id: string) {
  return transaction.execute<MatchRow>(
    sql`
      select id, event_id as "eventId", voucher_id as "voucherId", line_id as "lineId",
        evidence_id as "evidenceId", body
      from openerp.tax_account_matches
      where book_id = ${bookId} and id = ${id}
    `,
    "objects",
  );
}

export function readMatchesForBook(transaction: Transaction, bookId: string) {
  return transaction.execute<MatchRow>(
    sql`
      select id, event_id as "eventId", voucher_id as "voucherId", line_id as "lineId",
        evidence_id as "evidenceId", body
      from openerp.tax_account_matches
      where book_id = ${bookId}
      order by id collate "C"
    `,
    "objects",
  );
}

export function readMatchCapacity(transaction: Transaction, bookId: string, matchId: string) {
  return transaction.execute<ReservationRow>(
    sql`
      select exists(
        select 1 from openerp.tax_account_match_capacity c
        where c.book_id = ${bookId} and c.match_id = ${matchId}
      ) as reserved
    `,
    "objects",
  );
}

export function readMatchInventory(transaction: Transaction, bookId: string) {
  return transaction.execute<ItemRow>(
    sql`
      select jsonb_build_object('id', id, 'digest', body->>'digest') as item
      from openerp.tax_account_matches
      where book_id = ${bookId}
      order by id collate "C"
    `,
    "objects",
  );
}

export function readUnmatchInventory(transaction: Transaction, bookId: string) {
  return transaction.execute<ItemRow>(
    sql`
      select jsonb_build_object('id', id, 'matchId', match_id, 'digest', body->>'digest') as item
      from openerp.tax_account_unmatches
      where book_id = ${bookId}
      order by id collate "C"
    `,
    "objects",
  );
}

export function insertMatch(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly eventId: string;
    readonly voucherId: string;
    readonly lineId: string;
    readonly evidenceId: string;
    readonly body: JsonObject;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.tax_account_matches
        (book_id, id, event_id, voucher_id, line_id, evidence_id, body)
      values (${row.bookId}, ${row.id}, ${row.eventId}, ${row.voucherId}, ${row.lineId},
        ${row.evidenceId}, ${JSON.stringify(row.body)}::jsonb)
    `,
    "objects",
  );
}

export function insertMatchCapacity(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly matchId: string;
    readonly eventId: string;
    readonly voucherId: string;
    readonly lineId: string;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.tax_account_match_capacity
        (book_id, match_id, event_id, voucher_id, line_id)
      values (${row.bookId}, ${row.matchId}, ${row.eventId}, ${row.voucherId}, ${row.lineId})
    `,
    "objects",
  );
}

export function releaseMatchCapacity(transaction: Transaction, bookId: string, matchId: string) {
  return transaction.execute(
    sql`
      delete from openerp.tax_account_match_capacity
      where book_id = ${bookId} and match_id = ${matchId}
    `,
    "objects",
  );
}

export function readUnmatchByMatch(transaction: Transaction, bookId: string, matchId: string) {
  return transaction.execute<UnmatchRow>(
    sql`
      select id, match_id as "matchId", evidence_id as "evidenceId", body
      from openerp.tax_account_unmatches
      where book_id = ${bookId} and match_id = ${matchId}
    `,
    "objects",
  );
}

export function insertUnmatch(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly matchId: string;
    readonly evidenceId: string;
    readonly body: JsonObject;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.tax_account_unmatches (book_id, id, match_id, evidence_id, body)
      values (${row.bookId}, ${row.id}, ${row.matchId}, ${row.evidenceId}, ${JSON.stringify(row.body)}::jsonb)
    `,
    "objects",
  );
}

export function readLedgerLines(
  transaction: Transaction,
  bookId: string,
  accountId: string,
  startsOn: string,
  endsOn: string,
  committedSequence: string,
) {
  return transaction.execute<ItemRow>(
    sql`
      select jsonb_build_object(
        'voucherId', v.id, 'lineId', l.id, 'ordinal', l.ordinal,
        'sequence', v.sequence::text, 'postingDate', v.posting_date::text,
        'part', case when v.posting_date < ${startsOn} then 'opening' else 'movement' end,
        'debitMinor', l.debit_minor::text, 'creditMinor', l.credit_minor::text,
        'amountMinor', (l.debit_minor - l.credit_minor)::text,
        'description', l.description, 'postingPurpose', v.posting_purpose,
        'correctsVoucherId', v.corrects_voucher_id,
        'reversedByVoucherIds', coalesce((
          select jsonb_agg(r.id order by r.id collate "C") from openerp.vouchers r
          where r.book_id = ${bookId} and r.corrects_voucher_id = v.id
            and r.posting_purpose = 'reversal' and r.sequence <= ${committedSequence}), '[]')
      ) as item
      from openerp.journal_lines l
      join openerp.vouchers v on v.book_id = l.book_id and v.id = l.voucher_id
      where l.book_id = ${bookId} and l.account_id = ${accountId}
        and v.posting_date <= ${endsOn} and v.sequence <= ${committedSequence}
      order by v.sequence, l.ordinal
    `,
    "objects",
  );
}

export function readLedgerLineBound(
  transaction: Transaction,
  bookId: string,
  accountId: string,
  endsOn: string,
  committedSequence: string,
) {
  return transaction.execute<CountRow>(
    sql`
      select count(*)::integer as total from (
        select 1 from openerp.journal_lines l
        join openerp.vouchers v on v.book_id = l.book_id and v.id = l.voucher_id
        where l.book_id = ${bookId} and l.account_id = ${accountId}
          and v.posting_date <= ${endsOn} and v.sequence <= ${committedSequence}
        limit 5001
      ) bounded
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
  return transaction.execute<{
    readonly opening: string;
    readonly movement: string;
    readonly closing: string;
  }>(
    sql`
      select
        coalesce(sum(l.debit_minor - l.credit_minor) filter (where v.posting_date < ${startsOn}), 0)::text as opening,
        coalesce(sum(l.debit_minor - l.credit_minor) filter (where v.posting_date >= ${startsOn}), 0)::text as movement,
        coalesce(sum(l.debit_minor - l.credit_minor), 0)::text as closing
      from openerp.journal_lines l
      join openerp.vouchers v on v.book_id = l.book_id and v.id = l.voucher_id
      where l.book_id = ${bookId} and l.account_id = ${accountId}
        and v.posting_date <= ${endsOn} and v.sequence <= ${committedSequence}
    `,
    "objects",
  );
}

export function readVoucherSequence(transaction: Transaction, bookId: string, voucherId: string) {
  return transaction.execute<{ readonly sequence: string; readonly postingPurpose: string }>(
    sql`
      select sequence::text as sequence, posting_purpose as "postingPurpose"
      from openerp.vouchers
      where book_id = ${bookId} and id = ${voucherId}
    `,
    "objects",
  );
}

export function readCorrections(transaction: Transaction, bookId: string, voucherId: string) {
  return transaction.execute<{ readonly id: string }>(
    sql`
      select id from openerp.vouchers
      where book_id = ${bookId} and corrects_voucher_id = ${voucherId}
      order by id collate "C"
    `,
    "objects",
  );
}

export function readSubledgerBasisReference(
  transaction: Transaction,
  bookId: string,
  voucherId: string,
  lineId: string,
) {
  return transaction.execute<{
    readonly scheduleId: string;
    readonly basisDigest: string;
    readonly voucherId: string;
    readonly lineId: string;
  }>(
    sql`
      select l.schedule_id as "scheduleId", b.body->>'digest' as "basisDigest",
        l.voucher_id as "voucherId", l.line_id as "lineId"
      from openerp.subledger_basis_lines l
      join openerp.subledger_bases b on b.book_id = l.book_id and b.schedule_id = l.schedule_id
      where l.book_id = ${bookId} and l.voucher_id = ${voucherId} and l.line_id = ${lineId}
    `,
    "objects",
  );
}

export function readControl(transaction: Transaction, bookId: string, id: string) {
  return transaction.execute<ControlRow>(
    sql`
      select id, body, content, sha256, byte_length as "byteLength"
      from openerp.tax_account_controls
      where book_id = ${bookId} and id = ${id}
    `,
    "objects",
  );
}

export function listControlItems(transaction: Transaction, bookId: string) {
  return transaction.execute<ItemRow>(
    sql`
      select jsonb_build_object(
        'id', id, 'digest', body->>'digest', 'input', body->'input',
        'createdAt', body->>'createdAt'
      ) as item
      from openerp.tax_account_controls
      where book_id = ${bookId}
      order by body->>'createdAt' desc, id collate "C"
      limit 201
    `,
    "objects",
  );
}

export function readControlCount(transaction: Transaction, bookId: string) {
  return transaction.execute<CountRow>(
    sql`select count(*)::integer as total from openerp.tax_account_controls where book_id = ${bookId}`,
    "objects",
  );
}

export function insertControl(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly body: JsonObject;
    readonly content: string;
    readonly sha256: string;
    readonly byteLength: number;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.tax_account_controls (book_id, id, body, content, sha256, byte_length)
      values (${row.bookId}, ${row.id}, ${JSON.stringify(row.body)}::jsonb, ${row.content},
        ${row.sha256}, ${row.byteLength})
    `,
    "objects",
  );
}
