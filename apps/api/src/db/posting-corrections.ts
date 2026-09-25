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
  lock: "share" | "update" = "share",
) {
  const query = transaction
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
  return lock === "update" ? query.for("update") : query.for("share");
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
    )
    .for("share");
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
    .limit(1)
    .for("share");
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
    .limit(26)
    .for("share");
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
  lock: "share" | "update" = "share",
) {
  const query = transaction
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
  return lock === "update" ? query.for("update") : query.for("share");
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
    .limit(1)
    .for("share");
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
    )
    .for("share");
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
  lock: "share" | "update" = "share",
) {
  const query = transaction
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
  return lock === "update" ? query.for("update") : query.for("share");
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
    .orderBy(asc(vouchers.sequence))
    .for("share");
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
    .where(and(eq(journalLines.bookId, bookId), inArray(journalLines.voucherId, voucherIds)))
    .for("share");
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
    .orderBy(sql`${correctionBundleReceipts.body}->>'committedAt'`)
    .for("share");
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
        'detail', 'Retained bank match: row ' || source.row_ordinal::text || ', line ' || source.line_id || '. Match supersession is unavailable.',
        'path', '/bank-statements/' || source.statement_id, 'blocks', true
      ) as resource
      from openerp.bank_matches source
      where source.book_id = ${bookId} and source.voucher_id = ${voucherId}
      union all
      select jsonb_build_object(
        'kind', 'bank_allocation', 'id', source.plan_id,
        'detail', 'Applied bank allocation: row ' || source.row_ordinal::text || ', line ' || source.line_id || '. Compensation is unavailable.',
        'path', '/bank-allocation-plans/' || source.plan_id, 'blocks', true
      )
      from openerp.bank_allocation_legs source
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
        'detail', 'Applied invoice payment, invoice ' || source.invoice_id || ', line ' || source.payment_line_id || '. Allocation compensation is unavailable.',
        'path', '/commerce/invoices/' || source.invoice_id, 'blocks', true
      )
      from openerp.commerce_allocation_legs source
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
    ) resources
    order by resource->>'kind', resource->>'id', resource->>'detail'
    limit 1001
  `,
    "objects",
  );
}
