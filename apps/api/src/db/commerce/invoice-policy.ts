import { sql } from "drizzle-orm";
import type { Transaction } from "../transaction";
import type { JsonObject } from "./access";

export const invoicePolicyTables = [
  "invoice_policy_candidates",
  "invoice_policy_reviews",
  "evidence",
] as const;

export type PolicyCandidateRow = {
  readonly id: string;
  readonly profileKey: string;
  readonly actorId: string;
  readonly body: JsonObject;
};

export type PolicyReviewRow = {
  readonly id: string;
  readonly candidateId: string;
  readonly actorId: string;
  readonly body: JsonObject;
};

export type PolicyEvidenceRow = { readonly present: boolean };

export type PolicyCountRow = { readonly count: number };

export type PolicyHistoryRow = {
  readonly id: string;
  readonly profileKey: string;
  readonly actorId: string;
  readonly body: JsonObject;
  readonly review: JsonObject | null;
};

export function readCandidate(transaction: Transaction, bookId: string, id: string) {
  return transaction.execute<PolicyCandidateRow>(
    sql`
      select c.id, c.profile_key as "profileKey", c.actor_id as "actorId", c.body
      from openerp.invoice_policy_candidates c
      where c.book_id = ${bookId} and c.id = ${id}
    `,
    "objects",
  );
}

export function readCandidateByProfileKey(
  transaction: Transaction,
  bookId: string,
  profileKey: string,
) {
  return transaction.execute<PolicyCandidateRow>(
    sql`
      select c.id, c.profile_key as "profileKey", c.actor_id as "actorId", c.body
      from openerp.invoice_policy_candidates c
      where c.book_id = ${bookId} and c.profile_key = ${profileKey}
    `,
    "objects",
  );
}

export function readReviewForCandidate(
  transaction: Transaction,
  bookId: string,
  candidateId: string,
) {
  return transaction.execute<PolicyReviewRow>(
    sql`
      select r.id, r.candidate_id as "candidateId", r.actor_id as "actorId", r.body
      from openerp.invoice_policy_reviews r
      where r.book_id = ${bookId} and r.candidate_id = ${candidateId}
    `,
    "objects",
  );
}

export function readPolicyEvidence(
  transaction: Transaction,
  bookId: string,
  reference: JsonObject,
) {
  return transaction.execute<PolicyEvidenceRow>(
    sql`
      select exists (
        select from openerp.evidence e
        where e.book_id = ${bookId} and e.id = ${reference.evidenceId}
          and e.sha256 = ${reference.sha256}
      ) as present
    `,
    "objects",
  );
}

export function readCandidateCount(transaction: Transaction, bookId: string) {
  return transaction.execute<PolicyCountRow>(
    sql`select count(*)::integer as count from openerp.invoice_policy_candidates where book_id = ${bookId}`,
    "objects",
  );
}

export function insertCandidate(
  transaction: Transaction,
  row: { bookId: string; id: string; profileKey: string; actorId: string; body: JsonObject },
) {
  return transaction.execute(
    sql`
      insert into openerp.invoice_policy_candidates (book_id, id, profile_key, actor_id, body)
      values (${row.bookId}, ${row.id}, ${row.profileKey}, ${row.actorId}, ${JSON.stringify(row.body)}::jsonb)
    `,
    "objects",
  );
}

export function insertReview(
  transaction: Transaction,
  row: { bookId: string; id: string; candidateId: string; actorId: string; body: JsonObject },
) {
  return transaction.execute(
    sql`
      insert into openerp.invoice_policy_reviews (book_id, id, candidate_id, actor_id, body)
      values (${row.bookId}, ${row.id}, ${row.candidateId}, ${row.actorId}, ${JSON.stringify(row.body)}::jsonb)
    `,
    "objects",
  );
}

export function readPolicyHistory(transaction: Transaction, bookId: string) {
  return transaction.execute<PolicyHistoryRow>(
    sql`
      select c.id, c.profile_key as "profileKey", c.actor_id as "actorId", c.body,
        (select r.body from openerp.invoice_policy_reviews r
          where r.book_id = c.book_id and r.candidate_id = c.id) as review
      from openerp.invoice_policy_candidates c
      where c.book_id = ${bookId}
      order by c.id
    `,
    "objects",
  );
}

export function readPolicyCandidateWithReview(
  transaction: Transaction,
  bookId: string,
  id: string,
) {
  return transaction.execute<PolicyHistoryRow>(
    sql`
      select c.id, c.profile_key as "profileKey", c.actor_id as "actorId", c.body,
        (select r.body from openerp.invoice_policy_reviews r
          where r.book_id = c.book_id and r.candidate_id = c.id) as review
      from openerp.invoice_policy_candidates c
      where c.book_id = ${bookId} and c.id = ${id}
    `,
    "objects",
  );
}
