import { sql } from "drizzle-orm";
import type * as Schema from "effect/Schema";
import type { Transaction } from "../transaction";

export const paidRecoveryTables = [
  "payroll_paid_recovery_assessments",
  "payroll_paid_recovery_drafts",
  "payroll_paid_recovery_legs",
  "payroll_paid_recovery_attachments",
  "payroll_paid_recovery_qualifications",
  "payroll_paid_recovery_claim_reviews",
  "payroll_paid_recovery_cancellations",
] as const;

export type RecordTable = (typeof paidRecoveryTables)[number];

type BodyRow = { readonly body: Schema.JsonObject };

export function record(tx: Transaction, bookId: string, table: RecordTable, id: string) {
  return tx.execute<BodyRow>(
    sql`select body from openerp.${sql.identifier(table)} where book_id=${bookId} and id=${id}`,
    "objects",
  );
}

export function related(
  tx: Transaction,
  bookId: string,
  table: Exclude<RecordTable, "payroll_paid_recovery_assessments">,
  assessmentId: string,
) {
  return tx.execute<BodyRow>(
    sql`select body from openerp.${sql.identifier(table)} where book_id=${bookId} and assessment_id=${assessmentId} order by body->>'createdAt',id collate "C" limit 101`,
    "objects",
  );
}

export function insert(
  tx: Transaction,
  table: RecordTable,
  row: {
    readonly id: string;
    readonly digest: string;
    readonly scope: { readonly bookId: string };
  },
  body: Schema.JsonObject,
) {
  return tx.execute(
    sql`insert into openerp.${sql.identifier(table)}(book_id,id,digest,body) values(${row.scope.bookId},${row.id},${row.digest},${JSON.stringify(body)}::jsonb)`,
  );
}

export function list(tx: Transaction, bookId: string, cursor?: string) {
  return tx.execute<BodyRow>(
    sql`select body from openerp.payroll_paid_recovery_assessments where book_id=${bookId} and id collate "C">${cursor ?? ""} collate "C" order by id collate "C" limit 21`,
    "objects",
  );
}

export function claimReviewLink(tx: Transaction, bookId: string, reviewId: string) {
  return tx.execute<BodyRow>(
    sql`select body from openerp.payroll_paid_recovery_claim_reviews where book_id=${bookId} and review_id=${reviewId}`,
    "objects",
  );
}

export function legReviews(tx: Transaction, bookId: string, legId: string) {
  return tx.execute<BodyRow>(
    sql`select body from openerp.payroll_settlement_reviews where book_id=${bookId} and body->'input'->>'paidRecoveryLegId'=${legId} order by body->>'createdAt',id collate "C" limit 101`,
    "objects",
  );
}

export function instructionRuns(
  tx: Transaction,
  bookId: string,
  instructionIds: readonly string[],
) {
  return tx.execute<BodyRow>(
    sql`select body from openerp.payroll_runs r where book_id=${bookId} and exists(select from jsonb_array_elements(r.body->'employees') e cross join lateral jsonb_array_elements(coalesce(e->'calculation'->'basis'->'adjustmentInstructions','[]'::jsonb)) i where i->>'id'=any(array[${sql.join(
      instructionIds.map((id) => sql`${id}`),
      sql`, `,
    )}]::text[])) order by body->>'createdAt',id collate "C" limit 101`,
    "objects",
  );
}

export function noncashReviews(tx: Transaction, bookId: string, runId: string, employeeId: string) {
  return tx.execute<BodyRow>(
    sql`select body from openerp.payroll_settlement_reviews where book_id=${bookId} and body->'input'->>'kind'='noncash_payment' and body->'input'->>'runId'=${runId} and body->'input'->>'employeeId'=${employeeId} order by body->>'createdAt',id collate "C" limit 101`,
    "objects",
  );
}

export function basisSources(tx: Transaction, bookId: string, cursor?: string) {
  return tx.execute<{
    id: string;
    title: string;
    sha256: string;
    mediaType: string;
    createdAt: string;
  }>(
    sql`select id,title,sha256,media_type as "mediaType",created_at::text as "createdAt" from openerp.evidence where book_id=${bookId} and id collate "C">${cursor ?? ""} collate "C" order by id collate "C" limit 21`,
    "objects",
  );
}
