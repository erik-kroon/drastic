import { sql } from "drizzle-orm";
import type * as Schema from "effect/Schema";
import type { Transaction } from "./transaction";

type BodyRow = { readonly body: Schema.JsonObject };

export const questionTables = [
  "workspace_questions",
  "workspace_question_revisions",
  "workspace_question_attachments",
] as const;

export function readDocumentLineage(tx: Transaction, bookId: string, occurrenceId: string) {
  return tx.execute<{ readonly draftId: string | null }>(
    sql`select draft_id as "draftId" from openerp.supplier_inbox
      where book_id = ${bookId} and occurrence_id = ${occurrenceId}`,
    "objects",
  );
}

export function readSupplierLineage(tx: Transaction, bookId: string, draftId: string) {
  return tx.execute<{
    readonly digest: string;
    readonly occurrenceIds: string[];
    readonly completed: boolean;
    readonly reviewPlanId: string | null;
    readonly reviewPlanDigest: string | null;
  }>(
    sql`select r.body->>'digest' as digest,
      array(select i.occurrence_id from openerp.supplier_inbox i
        where i.book_id = d.book_id and i.draft_id = d.id order by i.occurrence_id limit 2) as "occurrenceIds",
      (exists(select 1 from openerp.supplier_acceptances a where a.book_id = d.book_id and a.draft_id = d.id)
        or exists(select 1 from openerp.commerce_invoices c where c.book_id = d.book_id and c.cash_method_source_draft_id = d.id)
        or exists(select 1 from openerp.cash_method_credits c where c.book_id = d.book_id and c.draft_id = d.id)
        or exists(select 1 from openerp.service_purchases s where s.book_id = d.book_id and s.draft_id = d.id)) as completed,
      review.change_set_id as "reviewPlanId",
      review.body#>>'{postingPlan,planDigest}' as "reviewPlanDigest"
      from openerp.supplier_invoice_drafts d
      join openerp.supplier_invoice_draft_revisions r on r.book_id = d.book_id and r.draft_id = d.id and r.revision = d.current_revision
      left join lateral (
        select a.change_set_id, a.body from openerp.supplier_acceptance_reviews a
        where a.book_id = d.book_id and a.draft_id = d.id and a.draft_revision = d.current_revision
        order by a.ordinal desc limit 1
      ) review on true
      where d.book_id = ${bookId} and d.id = ${draftId}`,
    "objects",
  );
}

export function readNativeReviewDraft(tx: Transaction, bookId: string, planId: string) {
  return tx.execute<{ readonly draftId: string }>(
    sql`select draft_id as "draftId" from openerp.supplier_acceptance_reviews
      where book_id = ${bookId} and change_set_id = ${planId}`,
    "objects",
  );
}

export function readQuestionAnchors(tx: Transaction, bookId: string, rootKey: string) {
  return tx.execute<BodyRow>(
    sql`select body from openerp.workspace_questions where book_id = ${bookId} and root_key = ${rootKey}
      order by body->>'createdAt', id limit 51`,
    "objects",
  );
}

export function readQuestionAnchor(tx: Transaction, bookId: string, questionId: string) {
  return tx.execute<BodyRow>(
    sql`select body from openerp.workspace_questions where book_id = ${bookId} and id = ${questionId}`,
    "objects",
  );
}

export function readQuestionRevisions(tx: Transaction, bookId: string, questionId: string) {
  return tx.execute<BodyRow & { readonly state: string; readonly waitingOn: string | null }>(
    sql`select body, state, waiting_on as "waitingOn" from openerp.workspace_question_revisions
      where book_id = ${bookId} and question_id = ${questionId} order by revision limit 51`,
    "objects",
  );
}

export function readQuestionSummary(tx: Transaction, bookId: string, rootKey: string) {
  return tx.execute<{
    readonly total: number;
    readonly unresolved: number;
    readonly open: number;
    readonly answered: number;
    readonly waitingOn: string[];
  }>(
    sql`with latest as (
      select q.id, r.state, r.waiting_on from openerp.workspace_questions q
      join lateral (
        select state, waiting_on from openerp.workspace_question_revisions r
        where r.book_id = q.book_id and r.question_id = q.id order by revision desc limit 1
      ) r on true
      where q.book_id = ${bookId} and q.root_key = ${rootKey}
    ) select count(*)::integer as total,
      count(*) filter(where state <> 'closed')::integer as unresolved,
      count(*) filter(where state = 'open')::integer as open,
      count(*) filter(where state = 'answered')::integer as answered,
      coalesce(array_agg(distinct waiting_on) filter(where state <> 'closed' and waiting_on is not null), array[]::text[]) as "waitingOn"
      from latest`,
    "objects",
  );
}

export function insertQuestion(
  tx: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly rootKey: string;
    readonly occurrenceId: string | null;
    readonly supplierDraftId: string | null;
    readonly statementId: string | null;
    readonly rowOrdinal: number | null;
    readonly body: Schema.JsonObject;
  },
) {
  return tx.execute(
    sql`insert into openerp.workspace_questions(book_id,id,root_key,occurrence_id,supplier_draft_id,statement_id,row_ordinal,body)
      values(${row.bookId},${row.id},${row.rootKey},${row.occurrenceId},${row.supplierDraftId},${row.statementId},${row.rowOrdinal},${JSON.stringify(row.body)}::jsonb)`,
  );
}

export function insertQuestionRevision(
  tx: Transaction,
  row: {
    readonly bookId: string;
    readonly questionId: string;
    readonly revision: number;
    readonly state: string;
    readonly waitingOn: string | null;
    readonly body: Schema.JsonObject;
  },
) {
  return tx.execute(
    sql`insert into openerp.workspace_question_revisions(book_id,question_id,revision,state,waiting_on,body)
      values(${row.bookId},${row.questionId},${row.revision},${row.state},${row.waitingOn},${JSON.stringify(row.body)}::jsonb)`,
  );
}

export function insertQuestionAttachment(
  tx: Transaction,
  row: {
    readonly bookId: string;
    readonly questionId: string;
    readonly revision: number;
    readonly ordinal: number;
    readonly occurrenceId: string;
    readonly sha256: string;
  },
) {
  return tx.execute(
    sql`insert into openerp.workspace_question_attachments(book_id,question_id,revision,ordinal,occurrence_id,sha256)
      values(${row.bookId},${row.questionId},${row.revision},${row.ordinal},${row.occurrenceId},${row.sha256})`,
  );
}

export function readRootAttachments(tx: Transaction, bookId: string, rootKey: string) {
  return tx.execute<{ readonly occurrenceId: string; readonly byteLength: number }>(
    sql`select distinct a.occurrence_id as "occurrenceId", (o.body->>'byteLength')::integer as "byteLength"
      from openerp.workspace_question_attachments a
      join openerp.workspace_questions q on q.book_id = a.book_id and q.id = a.question_id
      join openerp.intake_occurrences o on o.book_id = a.book_id and o.id = a.occurrence_id
      where q.book_id = ${bookId} and q.root_key = ${rootKey} limit 11`,
    "objects",
  );
}
