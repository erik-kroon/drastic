import { sql } from "drizzle-orm";
import type { Transaction } from "../transaction";
import type { JsonObject } from "./access";

export const legalSalesPolicyTables = [
  "ar_legal_policies",
  "invoice_policy_candidates",
  "invoice_policy_reviews",
  "evidence",
  "books",
] as const;

export type PolicyRow = {
  readonly id: string;
  readonly candidateId: string;
  readonly reviewId: string;
  readonly series: string;
  readonly actorId: string;
  readonly body: JsonObject;
};

export type PolicyBookRow = {
  readonly authority: string;
  readonly currency: string;
  readonly currencyScale: number;
  readonly today: string;
};

export type PolicyCountRow = { readonly count: number };

export type PolicyPresenceRow = { readonly present: boolean };

export function readBookProfile(transaction: Transaction, bookId: string) {
  return transaction.execute<PolicyBookRow>(
    sql`
      select b.authority, b.currency, b.currency_scale as "currencyScale",
        to_char(statement_timestamp() at time zone 'UTC', 'YYYY-MM-DD') as today
      from openerp.books b
      where b.id = ${bookId}
    `,
    "objects",
  );
}

export function readCandidate(transaction: Transaction, bookId: string, candidateId: string) {
  return transaction.execute<{
    readonly id: string;
    readonly actorId: string;
    readonly body: JsonObject;
  }>(
    sql`
      select c.id, c.actor_id as "actorId", c.body
      from openerp.invoice_policy_candidates c
      where c.book_id = ${bookId} and c.id = ${candidateId}
    `,
    "objects",
  );
}

export function readReview(
  transaction: Transaction,
  bookId: string,
  reviewId: string,
  candidateId: string,
) {
  return transaction.execute<{
    readonly id: string;
    readonly actorId: string;
    readonly body: JsonObject;
  }>(
    sql`
      select r.id, r.actor_id as "actorId", r.body
      from openerp.invoice_policy_reviews r
      where r.book_id = ${bookId} and r.id = ${reviewId} and r.candidate_id = ${candidateId}
    `,
    "objects",
  );
}

export function readRetainedEvidence(
  transaction: Transaction,
  bookId: string,
  evidenceId: string,
  sha256: string,
) {
  return transaction.execute<PolicyPresenceRow>(
    sql`
      select exists (
        select from openerp.evidence e
        where e.book_id = ${bookId} and e.id = ${evidenceId} and e.sha256 = ${sha256}
      ) as present
    `,
    "objects",
  );
}

export function readPolicyCount(transaction: Transaction, bookId: string) {
  return transaction.execute<PolicyCountRow>(
    sql`select count(*)::integer as count from openerp.ar_legal_policies where book_id = ${bookId}`,
    "objects",
  );
}

export function readPolicyForCandidate(
  transaction: Transaction,
  bookId: string,
  candidateId: string,
) {
  return transaction.execute<PolicyPresenceRow>(
    sql`
      select exists (
        select from openerp.ar_legal_policies p
        where p.book_id = ${bookId} and p.candidate_id = ${candidateId}
      ) as present
    `,
    "objects",
  );
}

export function readPolicyForSeries(transaction: Transaction, bookId: string, series: string) {
  return transaction.execute<PolicyPresenceRow>(
    sql`
      select exists (
        select from openerp.ar_legal_policies p
        where p.book_id = ${bookId} and p.series = ${series}
      ) as present
    `,
    "objects",
  );
}

export function insertPolicy(
  transaction: Transaction,
  row: {
    bookId: string;
    id: string;
    candidateId: string;
    reviewId: string;
    series: string;
    actorId: string;
    body: JsonObject;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.ar_legal_policies
        (book_id, id, candidate_id, review_id, series, activated_by, body)
      values (${row.bookId}, ${row.id}, ${row.candidateId}, ${row.reviewId}, ${row.series},
        ${row.actorId}, ${JSON.stringify(row.body)}::jsonb)
    `,
    "objects",
  );
}

export function readPolicy(transaction: Transaction, bookId: string, id: string) {
  return transaction.execute<PolicyRow>(
    sql`
      select p.id, p.candidate_id as "candidateId", p.review_id as "reviewId", p.series,
        p.activated_by as "actorId", p.body
      from openerp.ar_legal_policies p
      where p.book_id = ${bookId} and p.id = ${id}
    `,
    "objects",
  );
}

export function readPolicyHistory(transaction: Transaction, bookId: string, limit: number) {
  return transaction.execute<PolicyRow>(
    sql`
      select p.id, p.candidate_id as "candidateId", p.review_id as "reviewId", p.series,
        p.activated_by as "actorId", p.body
      from openerp.ar_legal_policies p
      where p.book_id = ${bookId}
      order by p.id collate "C"
      limit ${limit + 1}
    `,
    "objects",
  );
}
