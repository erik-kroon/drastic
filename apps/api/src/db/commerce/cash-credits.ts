import { sql } from "drizzle-orm";
import type * as CashMethod from "@open-erp/contracts/cash-method";
import type { Transaction } from "../transaction";
import type { JsonObject } from "./access";

export function readPlan(tx: Transaction, book: string, id: string) {
  return tx.execute<{ body: JsonObject }>(
    sql`select body from openerp.cash_method_credit_plans where book_id=${book} and id=${id}`,
    "objects",
  );
}

export function insertPlan(
  tx: Transaction,
  book: string,
  plan: typeof CashMethod.CashCreditPlan.Type,
) {
  return tx.execute(sql`insert into openerp.cash_method_credit_plans(book_id,id,invoice_id,change_set_id,evidence_id,body)
    values(${book},${plan.id},${plan.selection.input.invoiceId},${plan.postingPlan?.id ?? null},${plan.selection.creditEvidence.evidenceId},${JSON.stringify(plan)}::jsonb)`);
}

export function readConflicts(
  tx: Transaction,
  book: string,
  input: { invoiceId: string; creditEvidenceId: string; supplierCreditNumber: string },
) {
  return tx.execute<{ present: boolean }>(
    sql`select exists(select from openerp.cash_method_credits
    where book_id=${book} and (evidence_id=${input.creditEvidenceId} or (invoice_id=${input.invoiceId} and supplier_credit_number=${input.supplierCreditNumber}))) as present`,
    "objects",
  );
}

export function readApproval(tx: Transaction, book: string, id: string) {
  return tx.execute<{ body: JsonObject; consumed: boolean }>(
    sql`select body,consumed_at is not null as consumed from openerp.cash_method_credit_approvals where book_id=${book} and id=${id} for update`,
    "objects",
  );
}

export function insertApproval(
  tx: Transaction,
  book: string,
  approval: typeof CashMethod.CashCreditApproval.Type,
) {
  return tx.execute(sql`insert into openerp.cash_method_credit_approvals(book_id,id,plan_id,actor_id,body)
    values(${book},${approval.id},${approval.planId},${approval.actorId},${JSON.stringify(approval)}::jsonb)`);
}

export function consumeApproval(tx: Transaction, book: string, id: string) {
  return tx.execute(
    sql`update openerp.cash_method_credit_approvals set consumed_at=now() where book_id=${book} and id=${id} and consumed_at is null`,
  );
}

export function readRecognizedOrigin(tx: Transaction, book: string, line: string) {
  return tx.execute<{
    id: string;
    voucherId: string;
    vatFactId: string | null;
    initialGrossMinor: string;
  }>(
    sql`
    select r.id,r.voucher_id as "voucherId",r.vat_fact_id as "vatFactId",r.recognized_gross_minor as "initialGrossMinor"
    from openerp.cash_method_recognitions r join openerp.vouchers v on(v.book_id,v.id)=(r.book_id,r.voucher_id)
    where r.book_id=${book} and r.line_id=${line} and r.trigger_kind='year_end_unpaid'
      and not exists(select from openerp.vouchers x where x.book_id=v.book_id and x.corrects_voucher_id=v.id)
    order by r.recorded_at,r.id`,
    "objects",
  );
}

export function insertCredit(
  tx: Transaction,
  book: string,
  plan: typeof CashMethod.CashCreditPlan.Type,
  receipt: typeof CashMethod.CashCreditReceipt.Type,
) {
  const input = plan.selection.input;

  return tx.execute(sql`insert into openerp.cash_method_credits(book_id,id,invoice_id,plan_id,approval_id,evidence_id,draft_id,draft_revision,supplier_credit_number,credit_date,gross_minor,recognized_minor,voucher_id,body)
    values(${book},${receipt.id},${input.invoiceId},${plan.id},${receipt.approvalId},${plan.selection.creditEvidence.evidenceId},${input.draftId},${input.expectedRevision}::bigint,${plan.selection.supplierCreditNumber},${plan.selection.creditDate}::date,
      ${receipt.creditGrossMinor},${receipt.recognizedCorrectionMinor},${receipt.postingReceipt?.voucherId ?? null},${JSON.stringify(receipt)}::jsonb)`);
}

export function readSourceAdoption(tx: Transaction, book: string, draft: string, evidence: string) {
  return tx.execute<{ id: string }>(
    sql`select id from openerp.cash_method_credits where book_id=${book} and (draft_id=${draft} or evidence_id=${evidence})`,
    "objects",
  );
}

export function insertLine(
  tx: Transaction,
  book: string,
  credit: string,
  id: string,
  line: typeof CashMethod.CashCreditLine.Type,
  fact: string | null,
) {
  return tx.execute(sql`insert into openerp.cash_method_credit_lines(book_id,id,credit_id,line_id,original_recognition_id,original_vat_fact_id,vat_fact_id,body)
    values(${book},${id},${credit},${line.lineId},${line.originalRecognitionId},${line.originalVatFactId},${fact},${JSON.stringify(line)}::jsonb)`);
}

export function advanceCoverage(
  tx: Transaction,
  book: string,
  line: typeof CashMethod.CashCreditLine.Type,
) {
  return tx.execute<{ id: string }>(
    sql`update openerp.cash_method_lines set credited_gross_minor=${line.after.creditedGrossMinor},
    recognized_gross_minor=${line.after.recognizedGrossMinor},released_deductible_minor=${line.after.releasedDeductibleMinor},version=version+1
    where book_id=${book} and id=${line.lineId} and version=${line.before.recognizedVersion}::bigint
      and paid_gross_minor=${line.before.paidGrossMinor} and credited_gross_minor=${line.before.creditedGrossMinor}
      and recognized_gross_minor=${line.before.recognizedGrossMinor} returning id`,
    "objects",
  );
}

export function insertFactComponent(
  tx: Transaction,
  book: string,
  fact: string,
  creditLine: string,
  sourceKey: string,
) {
  return tx.execute(sql`insert into openerp.vat_fact_components(book_id,id,source_key,record_class,cash_method_credit_id)
    values(${book},${fact},${sourceKey},'synthetic',${creditLine})`);
}
