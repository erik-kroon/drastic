import { sql } from "drizzle-orm";
import type * as Schema from "effect/Schema";
import type { Transaction } from "../transaction";

type JsonObject = Schema.JsonObject;

// The financial-close owner's own tables plus every retained record it reads:
// the fiscal year and its periods, the NEXT-13 statement snapshot and rows,
// the NEXT-22 bridge and effects, and the posting kernel's vouchers and
// journal lines for the conservation recheck. This module selects and
// persists; it never chooses a treatment or computes a report.
export const financialCloseTables = [
  "books",
  "accounts",
  "periods",
  "fiscal_years",
  "evidence",
  "events",
  "change_sets",
  "execution_receipts",
  "command_receipts",
  "vouchers",
  "journal_lines",
  "report_statement_snapshots",
  "report_statement_rows",
  "corporate_tax_bridges",
  "corporate_tax_effects",
  "financial_close_preparations",
  "financial_close_proposals",
  "financial_close_approvals",
  "financial_close_transfers",
  "financial_opening_sets",
  "financial_close_certificates",
  "financial_reopen_events",
] as const;

export const financialCloseInserts = [
  "financial_close_preparations",
  "financial_close_proposals",
  "financial_close_approvals",
  "financial_close_transfers",
  "financial_opening_sets",
  "financial_close_certificates",
  "financial_reopen_events",
  "change_sets",
  "events",
  "command_receipts",
] as const;

export type BodyRow = {
  readonly id: string;
  readonly body: JsonObject;
};

export type PreparationRow = BodyRow & {
  readonly fiscalYearId: string;
};

export type ProposalRow = BodyRow & {
  readonly preparationId: string;
  readonly fiscalYearId: string;
};

export type ApprovalRow = {
  readonly id: string;
  readonly proposalId: string;
  readonly actorId: string;
  readonly digest: string;
  readonly expiresAt: string;
  readonly ordinal: number;
  readonly body: JsonObject;
};

export type TransferRow = BodyRow & {
  readonly fiscalYearId: string;
  readonly ordinal: number;
  readonly deltaMinor: string;
  readonly voucherId: string | null;
};

export type CountRow = { readonly total: number };

export type FiscalYearRow = {
  readonly id: string;
  readonly startsOn: string;
  readonly endsOn: string;
};

export type PeriodRow = {
  readonly id: string;
  readonly fiscalYearId: string;
  readonly locked: boolean;
  readonly version: string;
  readonly startsOn: string;
  readonly endsOn: string;
};

export function readFiscalYear(transaction: Transaction, bookId: string, fiscalYearId: string) {
  return transaction.execute<FiscalYearRow>(
    sql`
      select id, starts_on::text as "startsOn", ends_on::text as "endsOn"
      from openerp.fiscal_years
      where book_id = ${bookId} and id = ${fiscalYearId}
    `,
    "objects",
  );
}

export function readPeriodsOfYear(transaction: Transaction, bookId: string, fiscalYearId: string) {
  return transaction.execute<PeriodRow>(
    sql`
      select id, fiscal_year_id as "fiscalYearId", locked, version::text as version,
        starts_on::text as "startsOn", ends_on::text as "endsOn"
      from openerp.periods
      where book_id = ${bookId} and fiscal_year_id = ${fiscalYearId}
      order by starts_on, id collate "C"
    `,
    "objects",
  );
}

export function readPreparationsForYear(
  transaction: Transaction,
  bookId: string,
  fiscalYearId: string,
) {
  return transaction.execute<PreparationRow>(
    sql`
      select id, fiscal_year_id as "fiscalYearId", body
      from openerp.financial_close_preparations
      where book_id = ${bookId} and fiscal_year_id = ${fiscalYearId}
      order by recorded_at, id collate "C"
    `,
    "objects",
  );
}

export function readPreparation(transaction: Transaction, bookId: string, preparationId: string) {
  return transaction.execute<PreparationRow>(
    sql`
      select id, fiscal_year_id as "fiscalYearId", body
      from openerp.financial_close_preparations
      where book_id = ${bookId} and id = ${preparationId}
    `,
    "objects",
  );
}

export function insertPreparation(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly fiscalYearId: string;
    readonly statementSnapshotId: string;
    readonly bridgeId: string;
    readonly body: JsonObject;
    readonly digest: string;
    readonly recordedAt: string;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.financial_close_preparations
        (book_id, id, fiscal_year_id, statement_snapshot_id, bridge_id, body, digest, recorded_at)
      values (${row.bookId}, ${row.id}, ${row.fiscalYearId}, ${row.statementSnapshotId},
        ${row.bridgeId}, ${JSON.stringify(row.body)}::jsonb, ${row.digest},
        ${row.recordedAt}::timestamptz)
    `,
    "objects",
  );
}

export function readProposalByPreparation(
  transaction: Transaction,
  bookId: string,
  preparationId: string,
) {
  return transaction.execute<ProposalRow>(
    sql`
      select id, preparation_id as "preparationId", fiscal_year_id as "fiscalYearId", body
      from openerp.financial_close_proposals
      where book_id = ${bookId} and preparation_id = ${preparationId}
    `,
    "objects",
  );
}

export function readProposal(transaction: Transaction, bookId: string, proposalId: string) {
  return transaction.execute<ProposalRow>(
    sql`
      select id, preparation_id as "preparationId", fiscal_year_id as "fiscalYearId", body
      from openerp.financial_close_proposals
      where book_id = ${bookId} and id = ${proposalId}
    `,
    "objects",
  );
}

export function insertProposal(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly preparationId: string;
    readonly fiscalYearId: string;
    readonly body: JsonObject;
    readonly digest: string;
    readonly recordedAt: string;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.financial_close_proposals
        (book_id, id, preparation_id, fiscal_year_id, body, digest, recorded_at)
      values (${row.bookId}, ${row.id}, ${row.preparationId}, ${row.fiscalYearId},
        ${JSON.stringify(row.body)}::jsonb, ${row.digest}, ${row.recordedAt}::timestamptz)
    `,
    "objects",
  );
}

export function readApprovalCount(transaction: Transaction, bookId: string, proposalId: string) {
  return transaction.execute<CountRow>(
    sql`
      select count(*)::integer as total
      from openerp.financial_close_approvals
      where book_id = ${bookId} and proposal_id = ${proposalId}
    `,
    "objects",
  );
}

export function readApproval(transaction: Transaction, bookId: string, proposalId: string) {
  return transaction.execute<ApprovalRow>(
    sql`
      select id, proposal_id as "proposalId", actor_id as "actorId", digest,
        expires_at::text as "expiresAt", ordinal, body
      from openerp.financial_close_approvals
      where book_id = ${bookId} and proposal_id = ${proposalId}
      order by ordinal desc
      limit 1
    `,
    "objects",
  );
}

export function readApprovalById(
  transaction: Transaction,
  bookId: string,
  approvalId: string,
  proposalId: string,
) {
  return transaction.execute<ApprovalRow>(
    sql`
      select id, proposal_id as "proposalId", actor_id as "actorId", digest,
        expires_at::text as "expiresAt", ordinal, body
      from openerp.financial_close_approvals
      where book_id = ${bookId} and id = ${approvalId} and proposal_id = ${proposalId}
    `,
    "objects",
  );
}

export function insertApproval(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly proposalId: string;
    readonly ordinal: number;
    readonly actorId: string;
    readonly digest: string;
    readonly expiresAt: string;
    readonly body: JsonObject;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.financial_close_approvals
        (book_id, id, proposal_id, ordinal, actor_id, digest, expires_at, body)
      values (${row.bookId}, ${row.id}, ${row.proposalId}, ${row.ordinal}, ${row.actorId},
        ${row.digest}, ${row.expiresAt}::timestamptz, ${JSON.stringify(row.body)}::jsonb)
    `,
    "objects",
  );
}

export function readTransfersForYear(
  transaction: Transaction,
  bookId: string,
  fiscalYearId: string,
) {
  return transaction.execute<TransferRow>(
    sql`
      select id, fiscal_year_id as "fiscalYearId", ordinal,
        delta_minor::text as "deltaMinor", voucher_id as "voucherId", body
      from openerp.financial_close_transfers
      where book_id = ${bookId} and fiscal_year_id = ${fiscalYearId}
      order by ordinal
    `,
    "objects",
  );
}

export function insertTransfer(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly fiscalYearId: string;
    readonly ordinal: number;
    readonly deltaMinor: string;
    readonly voucherId: string | null;
    readonly body: JsonObject;
    readonly digest: string;
    readonly recordedAt: string;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.financial_close_transfers
        (book_id, id, fiscal_year_id, ordinal, delta_minor, voucher_id, body, digest, recorded_at)
      values (${row.bookId}, ${row.id}, ${row.fiscalYearId}, ${row.ordinal},
        ${row.deltaMinor}::numeric, ${row.voucherId}, ${JSON.stringify(row.body)}::jsonb,
        ${row.digest}, ${row.recordedAt}::timestamptz)
    `,
    "objects",
  );
}

// This owner's own committed transfer postings after a snapshot cutoff. The
// close conservation recheck excludes exactly these, so the transfer that
// closes the year does not itself stale the basis it was sealed on.
export function readOwnTransferPostingsAfter(
  transaction: Transaction,
  bookId: string,
  fiscalYearId: string,
  sequence: string,
) {
  return transaction.execute<{ readonly count: string }>(
    sql`
      select count(*)::text as count
      from openerp.financial_close_transfers t
      join openerp.vouchers v
        on v.book_id = t.book_id and v.id = t.voucher_id
      where t.book_id = ${bookId}
        and t.fiscal_year_id = ${fiscalYearId}
        and v.sequence > ${sequence}::bigint
    `,
    "objects",
  );
}

export function insertOpeningSet(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly fiscalYearId: string;
    readonly version: number;
    readonly certificateId: string;
    readonly supersedesId: string | null;
    readonly body: JsonObject;
    readonly digest: string;
    readonly recordedAt: string;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.financial_opening_sets
        (book_id, id, fiscal_year_id, version, certificate_id, supersedes_id, body, digest, recorded_at)
      values (${row.bookId}, ${row.id}, ${row.fiscalYearId}, ${row.version}, ${row.certificateId},
        ${row.supersedesId}, ${JSON.stringify(row.body)}::jsonb, ${row.digest},
        ${row.recordedAt}::timestamptz)
    `,
    "objects",
  );
}

export function readOpeningSetsForYear(
  transaction: Transaction,
  bookId: string,
  fiscalYearId: string,
) {
  return transaction.execute<BodyRow>(
    sql`
      select id, body
      from openerp.financial_opening_sets
      where book_id = ${bookId} and fiscal_year_id = ${fiscalYearId}
      order by version
    `,
    "objects",
  );
}

export function readOpeningSet(transaction: Transaction, bookId: string, openingSetId: string) {
  return transaction.execute<BodyRow>(
    sql`
      select id, body
      from openerp.financial_opening_sets
      where book_id = ${bookId} and id = ${openingSetId}
    `,
    "objects",
  );
}

export function insertCertificate(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly proposalId: string;
    readonly fiscalYearId: string;
    readonly openingSetId: string;
    readonly transferId: string;
    readonly body: JsonObject;
    readonly digest: string;
    readonly recordedAt: string;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.financial_close_certificates
        (book_id, id, proposal_id, fiscal_year_id, opening_set_id, transfer_id, body, digest, recorded_at)
      values (${row.bookId}, ${row.id}, ${row.proposalId}, ${row.fiscalYearId}, ${row.openingSetId},
        ${row.transferId}, ${JSON.stringify(row.body)}::jsonb, ${row.digest},
        ${row.recordedAt}::timestamptz)
    `,
    "objects",
  );
}

export function readCertificatesForYear(
  transaction: Transaction,
  bookId: string,
  fiscalYearId: string,
) {
  return transaction.execute<BodyRow>(
    sql`
      select c.id, c.body
      from openerp.financial_close_certificates c
      where c.book_id = ${bookId} and c.fiscal_year_id = ${fiscalYearId}
      order by c.recorded_at, c.id collate "C"
    `,
    "objects",
  );
}

export function readCertificate(transaction: Transaction, bookId: string, certificateId: string) {
  return transaction.execute<BodyRow>(
    sql`
      select id, body
      from openerp.financial_close_certificates
      where book_id = ${bookId} and id = ${certificateId}
    `,
    "objects",
  );
}

export function readCertificateByProposal(
  transaction: Transaction,
  bookId: string,
  proposalId: string,
) {
  return transaction.execute<BodyRow>(
    sql`
      select id, body
      from openerp.financial_close_certificates
      where book_id = ${bookId} and proposal_id = ${proposalId}
    `,
    "objects",
  );
}

export function insertReopenEvent(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly certificateId: string;
    readonly fiscalYearId: string;
    readonly body: JsonObject;
    readonly digest: string;
    readonly recordedAt: string;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.financial_reopen_events
        (book_id, id, certificate_id, fiscal_year_id, body, digest, recorded_at)
      values (${row.bookId}, ${row.id}, ${row.certificateId}, ${row.fiscalYearId},
        ${JSON.stringify(row.body)}::jsonb, ${row.digest}, ${row.recordedAt}::timestamptz)
    `,
    "objects",
  );
}

export function readReopenForCertificate(
  transaction: Transaction,
  bookId: string,
  certificateId: string,
) {
  return transaction.execute<BodyRow>(
    sql`
      select id, body
      from openerp.financial_reopen_events
      where book_id = ${bookId} and certificate_id = ${certificateId}
    `,
    "objects",
  );
}

export function readReopensForYear(transaction: Transaction, bookId: string, fiscalYearId: string) {
  return transaction.execute<BodyRow>(
    sql`
      select id, body
      from openerp.financial_reopen_events
      where book_id = ${bookId} and fiscal_year_id = ${fiscalYearId}
      order by recorded_at, id collate "C"
    `,
    "objects",
  );
}

export function setYearPeriodLocks(
  transaction: Transaction,
  bookId: string,
  fiscalYearId: string,
  locked: boolean,
) {
  return transaction.execute<PeriodRow>(
    sql`
      update openerp.periods set locked = ${locked}
      where book_id = ${bookId} and fiscal_year_id = ${fiscalYearId}
      returning id, fiscal_year_id as "fiscalYearId", locked, version::text as version,
        starts_on::text as "startsOn", ends_on::text as "endsOn"
    `,
    "objects",
  );
}

export function readActiveAccount(transaction: Transaction, bookId: string, accountId: string) {
  return transaction.execute<{ readonly id: string }>(
    sql`
      select id
      from openerp.accounts
      where book_id = ${bookId} and id = ${accountId} and active
      for share
    `,
    "objects",
  );
}

export function readLaterFiscalYears(transaction: Transaction, bookId: string, endsOn: string) {
  return transaction.execute<FiscalYearRow>(
    sql`
      select id, starts_on::text as "startsOn", ends_on::text as "endsOn"
      from openerp.fiscal_years
      where book_id = ${bookId} and starts_on > ${endsOn}::date
      order by starts_on, id collate "C"
    `,
    "objects",
  );
}

export function readLaterSnapshots(transaction: Transaction, bookId: string, endsOn: string) {
  return transaction.execute<{ readonly id: string }>(
    sql`
      select id
      from openerp.report_statement_snapshots
      where book_id = ${bookId} and body ->> 'asOf' > ${endsOn}
      order by id collate "C"
      limit 501
    `,
    "objects",
  );
}

export function readTransferVoucherLines(
  transaction: Transaction,
  bookId: string,
  voucherId: string,
) {
  return transaction.execute<{
    readonly accountId: string;
    readonly debitMinor: string;
    readonly creditMinor: string;
  }>(
    sql`
      select account_id as "accountId", debit_minor::text as "debitMinor",
        credit_minor::text as "creditMinor"
      from openerp.journal_lines
      where book_id = ${bookId} and voucher_id = ${voucherId}
      order by ordinal
    `,
    "objects",
  );
}
