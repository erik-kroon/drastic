import * as Accounting from "@open-erp/contracts/accounting";
import * as Corrections from "@open-erp/contracts/corrections";
import * as Schema from "effect/Schema";
import { and, asc, desc, eq, gt, inArray, sql } from "drizzle-orm";
import {
  correctionBundleApprovals,
  correctionBundleReceipts,
  correctionBundles,
  correctionImpactReviews,
  journalLines,
  vouchers,
} from "./schema";
import type { Transaction } from "./transaction";

type JsonObject = Schema.JsonObject;

export type BundleRow = {
  readonly bookId: string;
  readonly id: string;
  readonly originalVoucherId: string;
  readonly reversalChangeSetId: string;
  readonly replacementChangeSetId: string;
  readonly body: JsonObject;
  readonly digest: string;
  readonly createdAt: string;
};

export function readBundle(
  transaction: Transaction,
  scope: typeof Accounting.Scope.Type,
  bundleId: string,
  _lock: "share" | "update" = "share",
) {
  return transaction
    .select({
      bookId: correctionBundles.bookId,
      id: correctionBundles.id,
      originalVoucherId: correctionBundles.originalVoucherId,
      reversalChangeSetId: correctionBundles.reversalChangeSetId,
      replacementChangeSetId: correctionBundles.replacementChangeSetId,
      body: correctionBundles.body,
      digest: correctionBundles.digest,
      createdAt: correctionBundles.createdAt,
    })
    .from(correctionBundles)
    .where(and(eq(correctionBundles.bookId, scope.bookId), eq(correctionBundles.id, bundleId)));
}

export function readBundleByChangeSet(
  transaction: Transaction,
  bookId: string,
  changeSetId: string,
) {
  return transaction
    .select({ id: correctionBundles.id })
    .from(correctionBundles)
    .where(
      and(
        eq(correctionBundles.bookId, bookId),
        sql`${changeSetId} in (${correctionBundles.reversalChangeSetId}, ${correctionBundles.replacementChangeSetId})`,
      ),
    );
}

export function readBundleForVoucher(
  transaction: Transaction,
  scope: typeof Accounting.Scope.Type,
  voucherId: string,
) {
  return transaction
    .select({
      bookId: correctionBundles.bookId,
      id: correctionBundles.id,
      originalVoucherId: correctionBundles.originalVoucherId,
      reversalChangeSetId: correctionBundles.reversalChangeSetId,
      replacementChangeSetId: correctionBundles.replacementChangeSetId,
      body: correctionBundles.body,
      digest: correctionBundles.digest,
      createdAt: correctionBundles.createdAt,
    })
    .from(correctionBundles)
    .where(
      and(
        eq(correctionBundles.bookId, scope.bookId),
        eq(correctionBundles.originalVoucherId, voucherId),
      ),
    )
    .orderBy(desc(correctionBundles.createdAt), desc(correctionBundles.id))
    .limit(1);
}

export function listBundles(
  transaction: Transaction,
  scope: typeof Accounting.Scope.Type,
  after: string | undefined,
) {
  const afterId = after ?? "";

  return transaction
    .select({
      id: correctionBundles.id,
      originalVoucherId: correctionBundles.originalVoucherId,
      createdAt: correctionBundles.createdAt,
      digest: correctionBundles.digest,
      receipt: correctionBundleReceipts.body,
    })
    .from(correctionBundles)
    .leftJoin(
      correctionBundleReceipts,
      and(
        eq(correctionBundleReceipts.bookId, correctionBundles.bookId),
        eq(correctionBundleReceipts.bundleId, correctionBundles.id),
      ),
    )
    .where(and(eq(correctionBundles.bookId, scope.bookId), gt(correctionBundles.id, afterId)))
    .orderBy(asc(correctionBundles.id))
    .limit(26);
}

export function insertBundle(
  transaction: Transaction,
  row: {
    bookId: string;
    id: string;
    originalVoucherId: string;
    reversalChangeSetId: string;
    replacementChangeSetId: string;
    body: JsonObject;
    digest: string;
  },
) {
  return transaction.insert(correctionBundles).values([row]);
}

export function readBundleApproval(
  transaction: Transaction,
  scope: typeof Accounting.Scope.Type,
  bundleId: string,
  approvalId: string,
  _lock: "share" | "update" = "share",
) {
  return transaction
    .select({
      bookId: correctionBundleApprovals.bookId,
      id: correctionBundleApprovals.id,
      bundleId: correctionBundleApprovals.bundleId,
      reversalApprovalId: correctionBundleApprovals.reversalApprovalId,
      replacementApprovalId: correctionBundleApprovals.replacementApprovalId,
      expiresAt: correctionBundleApprovals.expiresAt,
      body: correctionBundleApprovals.body,
    })
    .from(correctionBundleApprovals)
    .where(
      and(
        eq(correctionBundleApprovals.bookId, scope.bookId),
        eq(correctionBundleApprovals.bundleId, bundleId),
        eq(correctionBundleApprovals.id, approvalId),
      ),
    );
}

export function readLatestBundleApproval(
  transaction: Transaction,
  scope: typeof Accounting.Scope.Type,
  bundleId: string,
) {
  return transaction
    .select({
      id: correctionBundleApprovals.id,
      reversalApprovalId: correctionBundleApprovals.reversalApprovalId,
      replacementApprovalId: correctionBundleApprovals.replacementApprovalId,
      expiresAt: correctionBundleApprovals.expiresAt,
      body: correctionBundleApprovals.body,
    })
    .from(correctionBundleApprovals)
    .where(
      and(
        eq(correctionBundleApprovals.bookId, scope.bookId),
        eq(correctionBundleApprovals.bundleId, bundleId),
      ),
    )
    .orderBy(desc(correctionBundleApprovals.expiresAt), desc(correctionBundleApprovals.id))
    .limit(1);
}

export function insertBundleApproval(
  transaction: Transaction,
  row: {
    bookId: string;
    id: string;
    bundleId: string;
    reversalApprovalId: string;
    replacementApprovalId: string;
    expiresAt: string;
    body: JsonObject;
  },
) {
  return transaction.insert(correctionBundleApprovals).values([row]);
}

export function readBundleReceipt(
  transaction: Transaction,
  scope: typeof Accounting.Scope.Type,
  bundleId: string,
) {
  return transaction
    .select({
      bookId: correctionBundleReceipts.bookId,
      bundleId: correctionBundleReceipts.bundleId,
      originalVoucherId: correctionBundleReceipts.originalVoucherId,
      approvalId: correctionBundleReceipts.approvalId,
      reversalReceiptId: correctionBundleReceipts.reversalReceiptId,
      replacementReceiptId: correctionBundleReceipts.replacementReceiptId,
      body: correctionBundleReceipts.body,
    })
    .from(correctionBundleReceipts)
    .where(
      and(
        eq(correctionBundleReceipts.bookId, scope.bookId),
        eq(correctionBundleReceipts.bundleId, bundleId),
      ),
    );
}

export function insertBundleReceipt(
  transaction: Transaction,
  row: {
    bookId: string;
    bundleId: string;
    originalVoucherId: string;
    approvalId: string;
    reversalReceiptId: string;
    replacementReceiptId: string;
    body: JsonObject;
  },
) {
  return transaction.insert(correctionBundleReceipts).values([row]);
}

export function readImpactReview(
  transaction: Transaction,
  scope: typeof Accounting.Scope.Type,
  impactId: string,
) {
  return transaction
    .select({
      bookId: correctionImpactReviews.bookId,
      id: correctionImpactReviews.id,
      voucherId: correctionImpactReviews.voucherId,
      body: correctionImpactReviews.body,
    })
    .from(correctionImpactReviews)
    .where(
      and(
        eq(correctionImpactReviews.bookId, scope.bookId),
        eq(correctionImpactReviews.id, impactId),
      ),
    );
}

export function insertImpactReview(
  transaction: Transaction,
  row: { bookId: string; id: string; voucherId: string; body: JsonObject },
) {
  return transaction.insert(correctionImpactReviews).values([row]);
}

export function readChainVoucherIds(transaction: Transaction, bookId: string, voucherId: string) {
  return transaction.execute<{ id: string }>(
    sql`
    with recursive edges(source, target) as (
      select v.id, v.corrects_voucher_id
      from openerp.vouchers v
      where v.book_id = ${bookId} and v.corrects_voucher_id is not null
      union
      select v.corrects_voucher_id, v.id
      from openerp.vouchers v
      where v.book_id = ${bookId} and v.corrects_voucher_id is not null
      union
      select r.original_voucher_id, e.voucher_id
      from openerp.correction_bundle_receipts r
      join openerp.execution_receipts e
        on e.book_id = r.book_id and e.id = r.replacement_receipt_id
      where r.book_id = ${bookId}
      union
      select e.voucher_id, r.original_voucher_id
      from openerp.correction_bundle_receipts r
      join openerp.execution_receipts e
        on e.book_id = r.book_id and e.id = r.replacement_receipt_id
      where r.book_id = ${bookId}
    ), chain(id) as (
      select ${voucherId}::text
      union
      select edge.target from edges edge join chain on chain.id = edge.source
    )
    select id from chain
  `,
    "objects",
  );
}

export function readVouchersByIds(transaction: Transaction, bookId: string, ids: string[]) {
  if (ids.length === 0)
    return transaction
      .select()
      .from(vouchers)
      .where(sql`false`);

  return transaction
    .select({
      id: vouchers.id,
      number: vouchers.number,
      sequence: vouchers.sequence,
      recordedAt: vouchers.recordedAt,
      action: vouchers.action,
    })
    .from(vouchers)
    .where(and(eq(vouchers.bookId, bookId), inArray(vouchers.id, ids)))
    .orderBy(asc(vouchers.sequence));
}

export function readChainLines(transaction: Transaction, bookId: string, voucherIds: string[]) {
  if (voucherIds.length === 0)
    return transaction
      .select()
      .from(journalLines)
      .where(sql`false`);

  return transaction
    .select({
      voucherId: journalLines.voucherId,
      accountId: journalLines.accountId,
      debitMinor: journalLines.debitMinor,
      creditMinor: journalLines.creditMinor,
    })
    .from(journalLines)
    .where(and(eq(journalLines.bookId, bookId), inArray(journalLines.voucherId, voucherIds)));
}

export function readBundleReceiptsForVouchers(
  transaction: Transaction,
  bookId: string,
  voucherIds: string[],
) {
  if (voucherIds.length === 0) {
    return transaction
      .select()
      .from(correctionBundleReceipts)
      .where(sql`false`);
  }

  return transaction
    .select({ body: correctionBundleReceipts.body })
    .from(correctionBundleReceipts)
    .where(
      and(
        eq(correctionBundleReceipts.bookId, bookId),
        inArray(correctionBundleReceipts.originalVoucherId, voucherIds),
      ),
    )
    .orderBy(sql`${correctionBundleReceipts.body}->>'committedAt'`);
}

type ResourceRow = { resource: typeof Corrections.CorrectionImpactResource.Type };

export function readImpactResources(
  transaction: Transaction,
  bookId: string,
  voucherId: string,
  postingDate: string,
) {
  return transaction.execute<ResourceRow>(
    sql`
    select resource from (
      select jsonb_build_object(
        'kind', 'bank_match', 'id', source.statement_id,
        'detail', 'Retained bank match: row ' || source.row_ordinal::text || ', line ' || source.line_id || '. Unmatch the active relationship before correcting.',
        'path', '/bank-statements/' || source.statement_id, 'blocks', true
      ) as resource
      from openerp.bank_active_matches source
      where source.book_id = ${bookId} and source.voucher_id = ${voucherId}
      union all
      select jsonb_build_object(
        'kind', 'bank_allocation', 'id', source.plan_id,
        'detail', 'Applied bank allocation: row ' || source.row_ordinal::text || ', line ' || source.line_id || '. Unmatch the active allocation before correcting.',
        'path', '/bank-allocation-plans/' || source.plan_id, 'blocks', true
      )
      from openerp.bank_active_allocation_legs source
      where source.book_id = ${bookId} and source.voucher_id = ${voucherId}
      union all
      select jsonb_build_object(
        'kind', 'bank_allocation', 'id', source.id,
        'detail', 'Unexecuted bank allocation plan references this voucher. It must revalidate after any correction.',
        'path', '/bank-allocation-plans/' || source.id, 'blocks', false
      )
      from openerp.bank_allocation_plans source
      where source.book_id = ${bookId}
        and not exists (
          select 1 from openerp.bank_allocation_executions execution
          where execution.book_id = source.book_id and execution.plan_id = source.id
        )
        and exists (
          select 1 from jsonb_array_elements(source.input->'legs') item(leg)
          where leg->>'voucherId' = ${voucherId}
        )
      union all
      select jsonb_build_object(
        'kind', 'invoice', 'id', source.id,
        'detail', 'Registered invoice recognition, line ' || source.recognition_line_id || '. Use the commerce owner; generic release is unavailable.',
        'path', '/commerce/invoices/' || source.id, 'blocks', true
      )
      from openerp.commerce_invoices source
      where source.book_id = ${bookId} and source.recognition_voucher_id = ${voucherId}
      union all
      select jsonb_build_object(
        'kind', 'payment_allocation', 'id', source.receipt_id,
        'detail', 'Applied invoice payment, invoice ' || source.invoice_id || ', line ' || source.payment_line_id || '. Unallocate the active payment before correcting.',
        'path', '/commerce/invoices/' || source.invoice_id, 'blocks', true
      )
      from openerp.commerce_active_allocation_legs source
      where source.book_id = ${bookId} and source.payment_voucher_id = ${voucherId}
      union all
      select jsonb_build_object(
        'kind', 'payment_allocation', 'id', source.id,
        'detail', 'Unapplied commerce payment plan references this voucher. Its owner must revalidate the plan; this review does not release capacity.',
        'path', '/commerce/allocation-plans/' || source.id, 'blocks', false
      )
      from openerp.commerce_allocation_plans source
      where source.book_id = ${bookId}
        and source.body->'payment'->>'voucherId' = ${voucherId}
        and not exists (
          select 1 from openerp.commerce_allocation_receipts receipt
          where receipt.book_id = source.book_id and receipt.plan_id = source.id
        )
      union all
      select distinct jsonb_build_object(
        'kind', 'schedule', 'id', source.schedule_id,
        'detail', 'Represented schedule occurrence ' || source.ordinal::text || '. Posted-occurrence compensation is unavailable.',
        'path', '/schedules/' || source.schedule_id, 'blocks', true
      )
      from openerp.subledger_preparations source
      join openerp.change_sets plan on plan.book_id = source.book_id and plan.id = source.change_set_id
      join openerp.vouchers voucher on voucher.book_id = source.book_id and voucher.id = ${voucherId}
      where source.book_id = ${bookId}
        and (source.change_set_id = voucher.change_set_id
          or plan.plan->'groups'->0->'actions'->0->>'eventId' = voucher.event_id)
      union all
      select jsonb_build_object(
        'kind', 'report', 'id', source.id,
        'detail', 'Retained report covers the correction date. Its original bytes stay unchanged; prepare a new snapshot after posting.',
        'path', '/report-snapshots/' || source.id, 'blocks', false
      )
      from openerp.report_snapshots source
      where source.book_id = ${bookId} and ${postingDate}::date between source.starts_on and source.ends_on
      union all
      select jsonb_build_object(
        'kind', 'closing', 'id', source.id,
        'detail', 'Technical certificate depends on the ledger sequence. A new posting makes its basis stale; no automatic reopen or statutory finding.',
        'path', '/closing-certificates/' || source.id, 'blocks', false
      )
      from openerp.closing_certificates source
      where source.book_id = ${bookId}
      union all
      select jsonb_build_object('kind','owner_record','id',r.id,'detail','An owner source or retained effect owns this voucher. Generic correction is unsupported.',
        'path','/owner-register/records/'||r.id,'blocks',true,'dependencyDigest',openerp.digest(jsonb_build_object('source',r.body,'revision',r.current_revision)))
      from openerp.owner_records r where r.book_id=${bookId} and (
        exists(select from openerp.owner_effects e where e.book_id=r.book_id and e.record_id=r.id and e.voucher_id=${voucherId}) or
        exists(select from openerp.events e join openerp.vouchers v on(v.book_id,v.event_id)=(e.book_id,e.id)
          where e.book_id=r.book_id and e.evidence_id=r.evidence_id and e.event_key=r.locator and v.id=${voucherId}) or
        exists(select from openerp.owner_proposal_links l join openerp.vouchers v on(v.book_id,v.change_set_id)=(l.book_id,l.change_set_id)
          where l.book_id=r.book_id and l.record_id=r.id and v.id=${voucherId}))
      union all
      select jsonb_build_object('kind','tax_account_match','id',m.id,'detail','Unmatch the active tax-account relation before correcting.',
        'path','/tax-account/matches/'||m.id,'blocks',true,'dependencyDigest',openerp.digest(jsonb_build_object('match',m.body,'capacity',to_jsonb(c))))
      from openerp.tax_account_match_capacity c join openerp.tax_account_matches m on(m.book_id,m.id)=(c.book_id,c.match_id)
      where c.book_id=${bookId} and c.voucher_id=${voucherId}
      union all
      select jsonb_build_object('kind','schedule','id',d.schedule_id,'detail','A terminal disposal owns the asset and its represented history. Generic correction is unsupported.',
        'path','/schedules/'||d.schedule_id,'blocks',true,'dependencyDigest',d.body->>'digest')
      from openerp.subledger_disposals d join openerp.subledger_disposal_reviews r on(r.book_id,r.id)=(d.book_id,d.review_id)
      join openerp.execution_receipts e on(e.book_id,e.id)=(d.book_id,d.posting_receipt_id)
      where d.book_id=${bookId} and (e.voucher_id=${voucherId} or r.body->'basis'->'carryingBasis'->'input'->>'voucherId'=${voucherId}
        or exists(select from jsonb_array_elements(r.body->'basis'->'occurrences') o where ${voucherId} in(o->>'voucherId',o->>'reversalVoucherId')))
      union all
      select jsonb_build_object('kind','schedule','id',i.schedule_id,'detail','An impairment owns this voucher or its carrying-basis history. Generic correction is unsupported.',
        'path','/schedules/'||i.schedule_id,'blocks',true,'dependencyDigest',i.body->>'digest')
      from openerp.subledger_impairments i where i.book_id=${bookId} and (i.voucher_id=${voucherId}
        or exists(select from openerp.subledger_bases b where (b.book_id,b.schedule_id)=(i.book_id,i.schedule_id) and b.voucher_id=${voucherId})
        or exists(select from openerp.subledger_schedule_revisions r join openerp.events e on e.book_id=r.book_id and e.evidence_id=r.evidence_id
          join openerp.vouchers v on(v.book_id,v.event_id)=(e.book_id,e.id) where (r.book_id,r.schedule_id)=(i.book_id,i.schedule_id) and v.id=${voucherId}
          and exists(select from jsonb_array_elements(r.body->'occurrences') o where o->>'eventKey'=e.event_key)))
      union all
      select jsonb_build_object('kind','vat_control_reclassification','id',e.id,'detail','VAT reclassification owns this voucher or its source contribution. Generic correction is unsupported.',
        'path','/vat-returns/reclassifications/'||e.review_id,'blocks',true,'dependencyDigest',e.body->>'digest')
      from openerp.vat_control_reclassification_effects e where e.book_id=${bookId} and (e.voucher_id=${voucherId}
        or exists(select from openerp.vat_control_reclassification_contributions c where(c.book_id,c.effect_id)=(e.book_id,e.id) and c.voucher_id=${voucherId}))
    ) resources
    order by resource->>'kind', resource->>'id', resource->>'detail'
    limit 1001
  `,
    "objects",
  );
}
