import { sql } from "drizzle-orm";
import * as Schema from "effect/Schema";
import type { Transaction } from "../transaction";

type JsonObject = Schema.JsonObject;

export type ProposalRow = {
  readonly id: string;
  readonly periodId: string;
  readonly body: JsonObject;
};

export type BodyRow = { readonly body: JsonObject };

export type PeriodRow = {
  readonly id: string;
  readonly locked: boolean;
  readonly version: string;
  readonly startsOn: string;
  readonly endsOn: string;
};

export type ApprovalRow = {
  readonly id: string;
  readonly proposalId: string;
  readonly actorId: string;
  readonly expiresAt: string;
  readonly body: JsonObject;
};

export type ProposalSummaryRow = {
  readonly id: string;
  readonly digest: string;
  readonly action: string;
  readonly reason: string;
  readonly proposedBy: string;
  readonly createdAt: string;
  readonly capturedStartsOn: string;
  readonly capturedEndsOn: string;
  readonly capturedLedgerSequence: string;
  readonly transitionId: string | null;
  readonly certificateId: string | null;
};

export type HistoryRow = { readonly body: JsonObject; readonly periodVersion: string };

export type CountRow = { readonly total: string };

export type ExistsRow = { readonly present: boolean };

export function lockProposal(transaction: Transaction, bookId: string, proposalId: string) {
  return transaction.execute<ProposalRow>(
    sql`
      select id, period_id as "periodId", body from openerp.closing_proposals
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
    readonly periodId: string;
    readonly body: JsonObject;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.closing_proposals (book_id, id, period_id, body)
      values (${row.bookId}, ${row.id}, ${row.periodId}, ${JSON.stringify(row.body)}::jsonb)
    `,
    "objects",
  );
}

export function readTransition(transaction: Transaction, bookId: string, proposalId: string) {
  return transaction.execute<BodyRow>(
    sql`
      select body from openerp.closing_transitions
      where book_id = ${bookId} and proposal_id = ${proposalId}
    `,
    "objects",
  );
}

export function lockApproval(
  transaction: Transaction,
  bookId: string,
  proposalId: string,
  approvalId: string,
) {
  return transaction.execute<ApprovalRow>(
    sql`
      select id, proposal_id as "proposalId", actor_id as "actorId",
        expires_at::text as "expiresAt", body
      from openerp.closing_approvals
      where book_id = ${bookId} and id = ${approvalId} and proposal_id = ${proposalId}
      for share
    `,
    "objects",
  );
}

export function lockPeriodForUpdate(transaction: Transaction, bookId: string, periodId: string) {
  return transaction.execute<PeriodRow>(
    sql`
      select id, locked, version::text as version, starts_on::text as "startsOn",
        ends_on::text as "endsOn"
      from openerp.periods
      where book_id = ${bookId} and id = ${periodId}
      for update
    `,
    "objects",
  );
}

export function setPeriodLock(
  transaction: Transaction,
  bookId: string,
  periodId: string,
  locked: boolean,
) {
  return transaction.execute<PeriodRow>(
    sql`
      update openerp.periods set locked = ${locked}
      where book_id = ${bookId} and id = ${periodId}
      returning id, locked, version::text as version, starts_on::text as "startsOn",
        ends_on::text as "endsOn"
    `,
    "objects",
  );
}

export function insertTransition(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly periodId: string;
    readonly proposalId: string;
    readonly approvalId: string;
    readonly periodVersion: string;
    readonly body: JsonObject;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.closing_transitions
        (book_id, id, period_id, proposal_id, approval_id, period_version, body)
      values (${row.bookId}, ${row.id}, ${row.periodId}, ${row.proposalId}, ${row.approvalId},
        ${row.periodVersion}::bigint, ${JSON.stringify(row.body)}::jsonb)
    `,
    "objects",
  );
}

export function insertCertificate(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly periodId: string;
    readonly transitionId: string;
    readonly body: JsonObject;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.closing_certificates (book_id, id, period_id, transition_id, body)
      values (${row.bookId}, ${row.id}, ${row.periodId}, ${row.transitionId},
        ${JSON.stringify(row.body)}::jsonb)
    `,
    "objects",
  );
}

export function insertInvalidations(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly kind: string;
    readonly transitionId: string;
    readonly from: string;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.closing_invalidations (book_id, kind, artifact_id, transition_id)
      select ${row.bookId}, ${row.kind}, candidate.id, ${row.transitionId}
      from ${
        row.kind === "certificate"
          ? sql`(select c.id from openerp.closing_certificates c
            join openerp.periods p on p.book_id = c.book_id and p.id = c.period_id
            where c.book_id = ${row.bookId} and p.ends_on >= ${row.from}::date) candidate`
          : row.kind === "report"
            ? sql`(select r.id from openerp.report_snapshots r
              where r.book_id = ${row.bookId} and r.ends_on >= ${row.from}::date) candidate`
            : sql`(select r.id from openerp.bank_reconciliations r
              where r.book_id = ${row.bookId} and (r.body->>'endsOn')::date >= ${row.from}::date) candidate`
      }
      on conflict do nothing
    `,
    "objects",
  );
}

export function countInvalidationCandidates(
  transaction: Transaction,
  bookId: string,
  kind: string,
  from: string,
) {
  return transaction.execute<CountRow>(
    kind === "certificate"
      ? sql`
          select count(*)::text as total
          from openerp.closing_certificates c
          join openerp.periods p on p.book_id = c.book_id and p.id = c.period_id
          where c.book_id = ${bookId} and p.ends_on >= ${from}::date
            and not exists (
              select 1 from openerp.closing_invalidations i
              where i.book_id = ${bookId} and i.kind = 'certificate' and i.artifact_id = c.id)
        `
      : sql`
          select count(*)::text as total
          from openerp.report_snapshots r
          where r.book_id = ${bookId} and r.ends_on >= ${from}::date
            and not exists (
              select 1 from openerp.closing_invalidations i
              where i.book_id = ${bookId} and i.kind = 'report' and i.artifact_id = r.id)
        `,
    "objects",
  );
}

export function readCertificate(transaction: Transaction, bookId: string, certificateId: string) {
  return transaction.execute<{ readonly body: JsonObject; readonly periodId: string }>(
    sql`
      select period_id as "periodId", body from openerp.closing_certificates
      where book_id = ${bookId} and id = ${certificateId}
    `,
    "objects",
  );
}

export function readInvalidation(
  transaction: Transaction,
  bookId: string,
  kind: string,
  artifactId: string,
) {
  return transaction.execute<{ readonly transitionId: string | null }>(
    sql`
      select transition_id as "transitionId" from openerp.closing_invalidations
      where book_id = ${bookId} and kind = ${kind} and artifact_id = ${artifactId}
    `,
    "objects",
  );
}

export function listProposals(
  transaction: Transaction,
  bookId: string,
  periodId: string,
  after: string,
  limit: number,
) {
  return transaction.execute<ProposalSummaryRow>(
    sql`
      select p.id, p.body->>'digest' as digest, p.body->>'action' as action,
        p.body->>'reason' as reason, p.body->>'proposedBy' as "proposedBy",
        p.body->>'createdAt' as "createdAt",
        p.body->'basis'->>'startsOn' as "capturedStartsOn",
        p.body->'basis'->>'endsOn' as "capturedEndsOn",
        p.body->'basis'->'dependencies'->>'ledgerSequence' as "capturedLedgerSequence",
        t.id as "transitionId", t.body->>'certificateId' as "certificateId"
      from openerp.closing_proposals p
      left join openerp.closing_transitions t
        on t.book_id = p.book_id and t.period_id = p.period_id and t.proposal_id = p.id
      where p.book_id = ${bookId} and p.period_id = ${periodId}
        and p.id collate "C" > ${after} collate "C"
      order by p.id collate "C"
      limit ${limit}
    `,
    "objects",
  );
}

export function readHistory(
  transaction: Transaction,
  bookId: string,
  periodId: string,
  after: string,
  limit: number,
) {
  return transaction.execute<HistoryRow>(
    sql`
      select body, period_version::text as "periodVersion"
      from openerp.closing_transitions
      where book_id = ${bookId} and period_id = ${periodId}
        and period_version > ${after}::numeric
      order by period_version
      limit ${limit}
    `,
    "objects",
  );
}

export function countHistory(
  transaction: Transaction,
  bookId: string,
  periodId: string,
  after: string,
) {
  return transaction.execute<CountRow>(
    sql`
      select count(*)::text as total
      from openerp.closing_transitions
      where book_id = ${bookId} and period_id = ${periodId}
        and period_version > ${after}::numeric
    `,
    "objects",
  );
}

export function periodExists(transaction: Transaction, bookId: string, periodId: string) {
  return transaction.execute<ExistsRow>(
    sql`select exists (select 1 from openerp.periods where book_id = ${bookId} and id = ${periodId}) as present`,
    "objects",
  );
}

export function proposalExists(
  transaction: Transaction,
  bookId: string,
  periodId: string,
  proposalId: string,
) {
  return transaction.execute<ExistsRow>(
    sql`
      select exists (
        select 1 from openerp.closing_proposals
        where book_id = ${bookId} and period_id = ${periodId} and id = ${proposalId}
      ) as present
    `,
    "objects",
  );
}
