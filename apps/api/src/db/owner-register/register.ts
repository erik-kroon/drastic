import { sql } from "drizzle-orm";
import * as Effect from "effect/Effect";
import type * as Schema from "effect/Schema";
import type { Transaction } from "../transaction";

type JsonObject = Schema.JsonObject;

export type TableAccessRow = {
  readonly tableName: string;
  readonly canSelect: boolean;
  readonly canInsert: boolean;
  readonly canUpdate: boolean;
};

export type OwnerRow = {
  readonly id: string;
  readonly sourceKey: string;
  readonly body: JsonObject;
};

export type RecordRow = {
  readonly id: string;
  readonly ownerId: string;
  readonly sourceKey: string;
  readonly evidenceId: string;
  readonly locator: string;
  readonly occurredOn: string;
  readonly amountMinor: string;
  readonly currentRevision: string;
  readonly body: JsonObject;
};

export type RevisionRow = {
  readonly revision: string;
  readonly body: JsonObject;
};

export type ReviewRow = {
  readonly id: string;
  readonly recordId: string;
  readonly actorId: string;
  readonly revision: string;
  readonly body: JsonObject;
};

export type EffectRow = {
  readonly id: string;
  readonly recordId: string;
  readonly ownerId: string;
  readonly voucherId: string;
  readonly lineId: string;
  readonly accountId: string;
  readonly postingDate: string;
  readonly side: string;
  readonly classification: string;
  readonly origin: string;
  readonly amountMinor: string;
  readonly body: JsonObject;
};

export type ProposalLinkRow = {
  readonly id: string;
  readonly recordId: string;
  readonly reviewId: string;
  readonly changeSetId: string;
  readonly lineId: string;
  readonly body: JsonObject;
};

export type AllocationRow = {
  readonly total: string;
  readonly legs: string;
};

export type AllocationPlanRow = { readonly body: JsonObject };

export type ApprovalRow = {
  readonly id: string;
  readonly planId: string;
  readonly actorId: string;
  readonly digest: string;
  readonly expiresAt: string;
  readonly consumed: boolean;
  readonly body: JsonObject;
};

export type ReceiptRow = {
  readonly id: string;
  readonly approvalId: string;
  readonly body: JsonObject;
};

export type ControlRow = { readonly body: JsonObject };

export type JournalLineRow = {
  readonly id: string;
  readonly accountId: string;
  readonly debitMinor: string;
  readonly creditMinor: string;
};

export type LedgerBalanceRow = {
  readonly accountId: string;
  readonly amount: string;
  readonly sequence: string;
};

export type AllocationLegRow = {
  readonly receiptId: string;
  readonly ordinal: number;
  readonly claimId: string;
  readonly settlementId: string;
  readonly amountMinor: string;
};

export const ownerTables = [
  "owner_parties",
  "owner_records",
  "owner_revisions",
  "owner_reviews",
  "owner_control_accounts",
  "owner_proposal_links",
  "owner_effects",
  "owner_allocation_plans",
  "owner_allocation_approvals",
  "owner_allocation_receipts",
  "owner_allocation_legs",
  "owner_controls",
] as const;

const tableAccess = sql`
  select
    requested.table_name as "tableName",
    case when to_regclass('openerp.' || requested.table_name) is null then false
      else has_table_privilege(current_user, 'openerp.' || requested.table_name, 'select') end as "canSelect",
    case when to_regclass('openerp.' || requested.table_name) is null then false
      else has_table_privilege(current_user, 'openerp.' || requested.table_name, 'insert') end as "canInsert",
    case when to_regclass('openerp.' || requested.table_name) is null then false
      else has_table_privilege(current_user, 'openerp.' || requested.table_name, 'update') end as "canUpdate"
  from unnest(array[${sql.join(
    ownerTables.map((name) => sql`${name}`),
    sql`, `,
  )}]::text[]) as requested(table_name)
`;

export function readOwnerAccess(transaction: Transaction) {
  return transaction.execute<TableAccessRow>(tableAccess, "objects");
}

export function readOwner(transaction: Transaction, bookId: string, ownerId: string) {
  return transaction.execute<OwnerRow>(
    sql`
      select p.id, p.source_key as "sourceKey", p.body
      from openerp.owner_parties p
      where p.book_id = ${bookId} and p.id = ${ownerId}
    `,
    "objects",
  );
}

export function readOwnerBySourceKey(transaction: Transaction, bookId: string, sourceKey: string) {
  return transaction.execute<{ readonly id: string }>(
    sql`
      select p.id
      from openerp.owner_parties p
      where p.book_id = ${bookId} and p.source_key = ${sourceKey}
    `,
    "objects",
  );
}

export function listOwners(transaction: Transaction, bookId: string, after: string, limit: number) {
  return transaction.execute<OwnerRow>(
    sql`
      select p.id, p.source_key as "sourceKey", p.body
      from openerp.owner_parties p
      where p.book_id = ${bookId} and p.id collate "C" > ${after} collate "C"
      order by p.id collate "C"
      limit ${limit}
    `,
    "objects",
  );
}

export function insertOwner(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly sourceKey: string;
    readonly evidenceId: string;
    readonly body: JsonObject;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.owner_parties (book_id, id, source_key, evidence_id, body)
      values (${row.bookId}, ${row.id}, ${row.sourceKey}, ${row.evidenceId}, ${JSON.stringify(row.body)}::jsonb)
    `,
    "objects",
  );
}

export function readRecord(transaction: Transaction, bookId: string, recordId: string) {
  return transaction.execute<RecordRow>(
    sql`
      select r.id, r.owner_id as "ownerId", r.source_key as "sourceKey", r.evidence_id as "evidenceId",
        r.locator, r.occurred_on::text as "occurredOn", r.amount_minor::text as "amountMinor",
        r.current_revision::text as "currentRevision", r.body
      from openerp.owner_records r
      where r.book_id = ${bookId} and r.id = ${recordId}
    `,
    "objects",
  );
}

export function readRecordIdsByOccurrence(
  transaction: Transaction,
  bookId: string,
  sourceKey: string,
  evidenceId: string,
  locator: string,
) {
  return transaction.execute<{ readonly id: string }>(
    sql`
      select r.id
      from openerp.owner_records r
      where r.book_id = ${bookId}
        and (r.source_key = ${sourceKey} or (r.evidence_id = ${evidenceId} and r.locator = ${locator}))
    `,
    "objects",
  );
}

export function listRecordIds(
  transaction: Transaction,
  bookId: string,
  after: string,
  limit: number,
) {
  return transaction.execute<{ readonly id: string }>(
    sql`
      select r.id
      from openerp.owner_records r
      where r.book_id = ${bookId} and r.id collate "C" > ${after} collate "C"
      order by r.id collate "C"
      limit ${limit}
    `,
    "objects",
  );
}

export function listRecordsForOwner(
  transaction: Transaction,
  bookId: string,
  ownerId: string | null,
  endsOn: string,
) {
  return transaction.execute<RecordRow>(
    ownerId === null
      ? sql`
          select r.id, r.owner_id as "ownerId", r.source_key as "sourceKey", r.evidence_id as "evidenceId",
            r.locator, r.occurred_on::text as "occurredOn", r.amount_minor::text as "amountMinor",
            r.current_revision::text as "currentRevision", r.body
          from openerp.owner_records r
          where r.book_id = ${bookId} and r.occurred_on <= ${endsOn}::date
          order by r.id collate "C"
        `
      : sql`
          select r.id, r.owner_id as "ownerId", r.source_key as "sourceKey", r.evidence_id as "evidenceId",
            r.locator, r.occurred_on::text as "occurredOn", r.amount_minor::text as "amountMinor",
            r.current_revision::text as "currentRevision", r.body
          from openerp.owner_records r
          where r.book_id = ${bookId} and r.owner_id = ${ownerId} and r.occurred_on <= ${endsOn}::date
          order by r.id collate "C"
        `,
    "objects",
  );
}

export function insertRecord(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly ownerId: string;
    readonly sourceKey: string;
    readonly evidenceId: string;
    readonly locator: string;
    readonly occurredOn: string;
    readonly amountMinor: string;
    readonly body: JsonObject;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.owner_records
        (book_id, id, owner_id, source_key, evidence_id, locator, occurred_on, amount_minor, current_revision, body)
      values (${row.bookId}, ${row.id}, ${row.ownerId}, ${row.sourceKey}, ${row.evidenceId}, ${row.locator},
        ${row.occurredOn}::date, ${row.amountMinor}::numeric, 1, ${JSON.stringify(row.body)}::jsonb)
    `,
    "objects",
  );
}

export function advanceRecordRevision(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly expectedRevision: string;
    readonly nextRevision: string;
  },
) {
  return transaction.execute(
    sql`
      update openerp.owner_records
      set current_revision = ${row.nextRevision}::bigint
      where book_id = ${row.bookId} and id = ${row.id} and current_revision = ${row.expectedRevision}::bigint
    `,
    "objects",
  );
}

export function readRevision(
  transaction: Transaction,
  bookId: string,
  recordId: string,
  revision: string,
) {
  return transaction.execute<RevisionRow>(
    sql`
      select r.revision::text as revision, r.body
      from openerp.owner_revisions r
      where r.book_id = ${bookId} and r.record_id = ${recordId} and r.revision = ${revision}::bigint
    `,
    "objects",
  );
}

export function listRevisions(transaction: Transaction, bookId: string, recordId: string) {
  return transaction.execute<RevisionRow>(
    sql`
      select r.revision::text as revision, r.body
      from openerp.owner_revisions r
      where r.book_id = ${bookId} and r.record_id = ${recordId}
      order by r.revision
    `,
    "objects",
  );
}

export function insertRevision(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly recordId: string;
    readonly revision: string;
    readonly body: JsonObject;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.owner_revisions (book_id, record_id, revision, body)
      values (${row.bookId}, ${row.recordId}, ${row.revision}::bigint, ${JSON.stringify(row.body)}::jsonb)
    `,
    "objects",
  );
}

export function readReviewByRevision(
  transaction: Transaction,
  bookId: string,
  recordId: string,
  revision: string,
) {
  return transaction.execute<ReviewRow>(
    sql`
      select w.id, w.record_id as "recordId", w.actor_id as "actorId", w.revision::text as revision, w.body
      from openerp.owner_reviews w
      where w.book_id = ${bookId} and w.record_id = ${recordId} and w.revision = ${revision}::bigint
    `,
    "objects",
  );
}

export function readReviewById(transaction: Transaction, bookId: string, reviewId: string) {
  return transaction.execute<ReviewRow>(
    sql`
      select w.id, w.record_id as "recordId", w.actor_id as "actorId", w.revision::text as revision, w.body
      from openerp.owner_reviews w
      where w.book_id = ${bookId} and w.id = ${reviewId}
    `,
    "objects",
  );
}

export function insertReview(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly recordId: string;
    readonly revision: string;
    readonly actorId: string;
    readonly body: JsonObject;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.owner_reviews (book_id, id, record_id, revision, actor_id, body)
      values (${row.bookId}, ${row.id}, ${row.recordId}, ${row.revision}::bigint, ${row.actorId},
        ${JSON.stringify(row.body)}::jsonb)
    `,
    "objects",
  );
}

export function readEffectByRecord(transaction: Transaction, bookId: string, recordId: string) {
  return transaction.execute<EffectRow>(
    sql`
      select e.id, e.record_id as "recordId", e.owner_id as "ownerId", e.voucher_id as "voucherId",
        e.line_id as "lineId", e.account_id as "accountId", e.posting_date::text as "postingDate",
        e.side, e.classification, e.origin, e.amount_minor::text as "amountMinor", e.body
      from openerp.owner_effects e
      where e.book_id = ${bookId} and e.record_id = ${recordId}
    `,
    "objects",
  );
}

export function readEffectById(transaction: Transaction, bookId: string, effectId: string) {
  return transaction.execute<EffectRow>(
    sql`
      select e.id, e.record_id as "recordId", e.owner_id as "ownerId", e.voucher_id as "voucherId",
        e.line_id as "lineId", e.account_id as "accountId", e.posting_date::text as "postingDate",
        e.side, e.classification, e.origin, e.amount_minor::text as "amountMinor", e.body
      from openerp.owner_effects e
      where e.book_id = ${bookId} and e.id = ${effectId}
    `,
    "objects",
  );
}

export function readEffectByLine(
  transaction: Transaction,
  bookId: string,
  voucherId: string,
  lineId: string,
) {
  return transaction.execute<{ readonly id: string }>(
    sql`
      select e.id
      from openerp.owner_effects e
      where e.book_id = ${bookId} and e.voucher_id = ${voucherId} and e.line_id = ${lineId}
    `,
    "objects",
  );
}

export function listEffects(
  transaction: Transaction,
  bookId: string,
  ownerId: string | null,
  endsOn: string,
) {
  return transaction.execute<EffectRow>(
    ownerId === null
      ? sql`
          select e.id, e.record_id as "recordId", e.owner_id as "ownerId", e.voucher_id as "voucherId",
            e.line_id as "lineId", e.account_id as "accountId", e.posting_date::text as "postingDate",
            e.side, e.classification, e.origin, e.amount_minor::text as "amountMinor", e.body
          from openerp.owner_effects e
          where e.book_id = ${bookId} and e.posting_date <= ${endsOn}::date
          order by e.id collate "C"
        `
      : sql`
          select e.id, e.record_id as "recordId", e.owner_id as "ownerId", e.voucher_id as "voucherId",
            e.line_id as "lineId", e.account_id as "accountId", e.posting_date::text as "postingDate",
            e.side, e.classification, e.origin, e.amount_minor::text as "amountMinor", e.body
          from openerp.owner_effects e
          where e.book_id = ${bookId} and e.owner_id = ${ownerId} and e.posting_date <= ${endsOn}::date
          order by e.id collate "C"
        `,
    "objects",
  );
}

export function insertEffect(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly recordId: string;
    readonly ownerId: string;
    readonly reviewId: string;
    readonly voucherId: string;
    readonly lineId: string;
    readonly accountId: string;
    readonly postingDate: string;
    readonly side: string;
    readonly classification: string;
    readonly origin: string;
    readonly amountMinor: string;
    readonly body: JsonObject;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.owner_effects
        (book_id, id, record_id, owner_id, review_id, voucher_id, line_id, account_id, posting_date,
          side, classification, origin, amount_minor, body)
      values (${row.bookId}, ${row.id}, ${row.recordId}, ${row.ownerId}, ${row.reviewId}, ${row.voucherId},
        ${row.lineId}, ${row.accountId}, ${row.postingDate}::date, ${row.side}, ${row.classification},
        ${row.origin}, ${row.amountMinor}::numeric, ${JSON.stringify(row.body)}::jsonb)
    `,
    "objects",
  );
}

export function listProposalLinks(transaction: Transaction, bookId: string, recordId: string) {
  return transaction.execute<ProposalLinkRow>(
    sql`
      select l.id, l.record_id as "recordId", l.review_id as "reviewId",
        l.change_set_id as "changeSetId", l.line_id as "lineId", l.body
      from openerp.owner_proposal_links l
      where l.book_id = ${bookId} and l.record_id = ${recordId}
      order by l.id collate "C"
    `,
    "objects",
  );
}

export function readProposalLinksByChangeSet(
  transaction: Transaction,
  bookId: string,
  changeSetId: string,
) {
  return transaction.execute<ProposalLinkRow>(
    sql`
      select l.id, l.record_id as "recordId", l.review_id as "reviewId",
        l.change_set_id as "changeSetId", l.line_id as "lineId", l.body
      from openerp.owner_proposal_links l
      where l.book_id = ${bookId} and l.change_set_id = ${changeSetId}
    `,
    "objects",
  );
}

export function readProposalLinksByRecord(
  transaction: Transaction,
  bookId: string,
  recordId: string,
) {
  return listProposalLinks(transaction, bookId, recordId);
}

export function readPostedProposalLink(
  transaction: Transaction,
  bookId: string,
  recordId: string,
  changeSetId: string,
) {
  return transaction.execute<ProposalLinkRow>(
    sql`
      select l.id, l.record_id as "recordId", l.review_id as "reviewId",
        l.change_set_id as "changeSetId", l.line_id as "lineId", l.body
      from openerp.owner_proposal_links l
      join openerp.vouchers v on v.book_id = l.book_id and v.change_set_id = l.change_set_id
      where l.book_id = ${bookId} and l.record_id = ${recordId} and l.change_set_id = ${changeSetId}
    `,
    "objects",
  );
}

export function readPostedReviewLink(
  transaction: Transaction,
  bookId: string,
  recordId: string,
  reviewId: string,
) {
  return transaction.execute<ProposalLinkRow>(
    sql`
      select l.id, l.record_id as "recordId", l.review_id as "reviewId",
        l.change_set_id as "changeSetId", l.line_id as "lineId", l.body
      from openerp.owner_proposal_links l
      join openerp.vouchers v on v.book_id = l.book_id and v.change_set_id = l.change_set_id
      where l.book_id = ${bookId} and l.record_id = ${recordId} and l.review_id = ${reviewId}
    `,
    "objects",
  );
}

export function insertProposalLink(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly recordId: string;
    readonly reviewId: string;
    readonly changeSetId: string;
    readonly lineId: string;
    readonly body: JsonObject;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.owner_proposal_links
        (book_id, id, record_id, review_id, change_set_id, line_id, body)
      values (${row.bookId}, ${row.id}, ${row.recordId}, ${row.reviewId}, ${row.changeSetId}, ${row.lineId},
        ${JSON.stringify(row.body)}::jsonb)
    `,
    "objects",
  );
}

export function insertControlAccount(transaction: Transaction, bookId: string, accountId: string) {
  return transaction.execute(
    sql`
      insert into openerp.owner_control_accounts (book_id, account_id)
      values (${bookId}, ${accountId})
      on conflict do nothing
    `,
    "objects",
  );
}

export function readAllocationUsage(transaction: Transaction, bookId: string, effectId: string) {
  return transaction.execute<AllocationRow>(
    sql`
      select coalesce(sum(l.amount_minor),0)::text as total, count(*)::text as legs
      from openerp.owner_allocation_legs l
      where l.book_id = ${bookId} and (l.claim_id = ${effectId} or l.settlement_id = ${effectId})
    `,
    "objects",
  );
}

export function listAllocationLegs(
  transaction: Transaction,
  bookId: string,
  ownerId: string | null,
  endsOn: string,
) {
  return transaction.execute<AllocationLegRow>(
    ownerId === null
      ? sql`
          select l.receipt_id as "receiptId", l.ordinal, l.claim_id as "claimId",
            l.settlement_id as "settlementId", l.amount_minor::text as "amountMinor"
          from openerp.owner_allocation_legs l
          join openerp.owner_effects e on e.book_id = l.book_id and e.id = l.settlement_id
          where l.book_id = ${bookId} and e.posting_date <= ${endsOn}::date
          order by l.receipt_id collate "C", l.ordinal
        `
      : sql`
          select l.receipt_id as "receiptId", l.ordinal, l.claim_id as "claimId",
            l.settlement_id as "settlementId", l.amount_minor::text as "amountMinor"
          from openerp.owner_allocation_legs l
          join openerp.owner_effects e on e.book_id = l.book_id and e.id = l.settlement_id
          where l.book_id = ${bookId} and e.owner_id = ${ownerId} and e.posting_date <= ${endsOn}::date
          order by l.receipt_id collate "C", l.ordinal
        `,
    "objects",
  );
}

export function insertAllocationPlan(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly body: JsonObject;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.owner_allocation_plans (book_id, id, body)
      values (${row.bookId}, ${row.id}, ${JSON.stringify(row.body)}::jsonb)
    `,
    "objects",
  );
}

export function readAllocationPlan(transaction: Transaction, bookId: string, planId: string) {
  return transaction.execute<AllocationPlanRow>(
    sql`
      select p.body
      from openerp.owner_allocation_plans p
      where p.book_id = ${bookId} and p.id = ${planId}
    `,
    "objects",
  );
}

export function readApproval(transaction: Transaction, bookId: string, approvalId: string) {
  return transaction.execute<ApprovalRow>(
    sql`
      select a.id, a.plan_id as "planId", a.actor_id as "actorId", a.digest,
        to_char(a.expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "expiresAt",
        exists (select 1 from openerp.owner_allocation_receipts r
          where r.book_id = a.book_id and r.approval_id = a.id) as consumed,
        a.body
      from openerp.owner_allocation_approvals a
      where a.book_id = ${bookId} and a.id = ${approvalId}
    `,
    "objects",
  );
}

export function readLatestApprovalForPlan(
  transaction: Transaction,
  bookId: string,
  planId: string,
) {
  return transaction.execute<ApprovalRow>(
    sql`
      select a.id, a.plan_id as "planId", a.actor_id as "actorId", a.digest,
        to_char(a.expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "expiresAt",
        exists (select 1 from openerp.owner_allocation_receipts r
          where r.book_id = a.book_id and r.approval_id = a.id) as consumed,
        a.body
      from openerp.owner_allocation_approvals a
      where a.book_id = ${bookId} and a.plan_id = ${planId}
      order by a.expires_at desc, a.id desc
      limit 1
    `,
    "objects",
  );
}

export function insertApproval(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly planId: string;
    readonly actorId: string;
    readonly digest: string;
    readonly expiresAt: string;
    readonly body: JsonObject;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.owner_allocation_approvals (book_id, id, plan_id, actor_id, digest, expires_at, body)
      values (${row.bookId}, ${row.id}, ${row.planId}, ${row.actorId}, ${row.digest},
        ${row.expiresAt}::timestamptz, ${JSON.stringify(row.body)}::jsonb)
    `,
    "objects",
  );
}

export function readReceiptForPlan(transaction: Transaction, bookId: string, planId: string) {
  return transaction.execute<ReceiptRow>(
    sql`
      select r.id, r.approval_id as "approvalId", r.body
      from openerp.owner_allocation_receipts r
      where r.book_id = ${bookId} and r.plan_id = ${planId}
    `,
    "objects",
  );
}

export function insertReceipt(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly planId: string;
    readonly approvalId: string;
    readonly body: JsonObject;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.owner_allocation_receipts (book_id, id, plan_id, approval_id, body)
      values (${row.bookId}, ${row.id}, ${row.planId}, ${row.approvalId}, ${JSON.stringify(row.body)}::jsonb)
    `,
    "objects",
  );
}

export function insertAllocationLegs(
  transaction: Transaction,
  rows: ReadonlyArray<{
    readonly bookId: string;
    readonly receiptId: string;
    readonly ordinal: number;
    readonly claimId: string;
    readonly settlementId: string;
    readonly amountMinor: string;
  }>,
) {
  if (rows.length === 0) return Effect.void;

  return transaction.execute(
    sql`
      insert into openerp.owner_allocation_legs
        (book_id, receipt_id, ordinal, claim_id, settlement_id, amount_minor)
      values ${sql.join(
        rows.map(
          (row) =>
            sql`(${row.bookId}, ${row.receiptId}, ${row.ordinal}, ${row.claimId}, ${row.settlementId}, ${row.amountMinor}::numeric)`,
        ),
        sql`, `,
      )}
    `,
    "objects",
  );
}

export function insertControl(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly body: JsonObject;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.owner_controls (book_id, id, body)
      values (${row.bookId}, ${row.id}, ${JSON.stringify(row.body)}::jsonb)
    `,
    "objects",
  );
}

export function readControl(transaction: Transaction, bookId: string, controlId: string) {
  return transaction.execute<ControlRow>(
    sql`
      select c.body
      from openerp.owner_controls c
      where c.book_id = ${bookId} and c.id = ${controlId}
    `,
    "objects",
  );
}

export function readJournalLine(
  transaction: Transaction,
  bookId: string,
  voucherId: string,
  lineId: string,
) {
  return transaction.execute<JournalLineRow>(
    sql`
      select l.id, l.account_id as "accountId", l.debit_minor::text as "debitMinor",
        l.credit_minor::text as "creditMinor"
      from openerp.journal_lines l
      where l.book_id = ${bookId} and l.voucher_id = ${voucherId} and l.id = ${lineId}
    `,
    "objects",
  );
}

export function readLedgerBalances(
  transaction: Transaction,
  bookId: string,
  accountIds: ReadonlyArray<string>,
  endsOn: string,
) {
  if (accountIds.length === 0) return Effect.succeed([]);

  return transaction.execute<LedgerBalanceRow>(
    sql`
      select l.account_id as "accountId",
        coalesce(sum(l.credit_minor - l.debit_minor),0)::text as amount,
        coalesce(max(v.sequence),0)::text as sequence
      from openerp.journal_lines l
      join openerp.vouchers v on v.book_id = l.book_id and v.id = l.voucher_id
      where l.book_id = ${bookId} and l.account_id in ${accountIds}
        and v.posting_date <= ${endsOn}::date
      group by l.account_id
    `,
    "objects",
  );
}

export function readEffectBodiesForAccount(
  transaction: Transaction,
  bookId: string,
  accountId: string,
  endsOn: string,
) {
  return transaction.execute<{ readonly body: JsonObject }>(
    sql`
      select e.body
      from openerp.owner_effects e
      where e.book_id = ${bookId} and e.account_id = ${accountId} and e.posting_date <= ${endsOn}::date
      order by e.id collate "C"
    `,
    "objects",
  );
}
