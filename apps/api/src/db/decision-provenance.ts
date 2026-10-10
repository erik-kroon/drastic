import { sql } from "drizzle-orm";
import type * as Schema from "effect/Schema";
import type { Transaction } from "./transaction";

export function insertSuggestion(
  transaction: Transaction,
  input: {
    bookId: string;
    id: string;
    actorId: string;
    sessionId: string | null;
    identity: string;
    subjectDigest: string;
    body: Schema.JsonObject;
  },
) {
  return transaction.execute(
    sql`insert into openerp.suggestion_records(book_id,id,actor_id,session_id,subject_identity,subject_digest,body) values (${input.bookId},${input.id},${input.actorId},${input.sessionId},${input.identity},${input.subjectDigest},${JSON.stringify(input.body)}::jsonb)`,
  );
}

export function readCitedSuggestion(transaction: Transaction, bookId: string, id: string) {
  return transaction.execute<{
    actorId: string;
    sessionId: string | null;
    subjectDigest: string;
    subjectIdentity: string;
    body: Schema.JsonObject;
  }>(
    sql`select actor_id as "actorId",session_id as "sessionId",subject_digest as "subjectDigest",subject_identity as "subjectIdentity",body from openerp.suggestion_records where book_id=${bookId} and id=${id}`,
    "objects",
  );
}

export function readExposure(
  transaction: Transaction,
  bookId: string,
  actorId: string,
  identity: string,
  citedIds: readonly string[],
) {
  return transaction.execute<{ uncited: boolean }>(
    sql`select exists(select 1 from openerp.suggestion_records where book_id=${bookId} and actor_id=${actorId} and subject_identity=${identity} and jsonb_array_length(body->'ranked'->'options') > 0 and not exists (select 1 from openerp.suggestion_records cited where cited.book_id=${bookId} and cited.actor_id=${actorId} and cited.id in (select jsonb_array_elements_text(${JSON.stringify(citedIds)}::jsonb)) and cited.subject_identity=suggestion_records.subject_identity and cited.body->>'optionSetDigest'=suggestion_records.body->>'optionSetDigest')) as uncited`,
    "objects",
  );
}

export function insertProvenance(
  transaction: Transaction,
  input: {
    bookId: string;
    kind: string;
    id: string;
    actorId: string;
    classification: string;
    body: Schema.JsonObject;
  },
) {
  return transaction.execute(
    sql`insert into openerp.decision_provenance(book_id,decision_kind,decision_id,actor_id,classification,body) values (${input.bookId},${input.kind},${input.id},${input.actorId},${input.classification},${JSON.stringify(input.body)}::jsonb)`,
  );
}
