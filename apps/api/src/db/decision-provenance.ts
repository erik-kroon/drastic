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

export type SuggestionIdentity = {
  readonly bookId: string;
  readonly actorId: string;
  readonly sessionId: string | null;
  readonly subjectDigest: string;
  readonly optionSetDigest: string;
};

export function readSuggestionIdentity(transaction: Transaction, input: SuggestionIdentity) {
  return transaction.execute<{ id: string }>(
    sql`select suggestion_id as id from openerp.suggestion_identities where book_id=${input.bookId} and actor_id=${input.actorId} and session_id is not distinct from ${input.sessionId} and subject_digest=${input.subjectDigest} and option_set_digest=${input.optionSetDigest}`,
    "objects",
  );
}

export function claimSuggestionIdentity(
  transaction: Transaction,
  input: SuggestionIdentity,
  id: string,
) {
  return transaction.execute<{ id: string }>(
    sql`insert into openerp.suggestion_identities(book_id,actor_id,session_id,subject_digest,option_set_digest,suggestion_id) values(${input.bookId},${input.actorId},${input.sessionId},${input.subjectDigest},${input.optionSetDigest},${id}) on conflict do nothing returning suggestion_id as id`,
    "objects",
  );
}

export function readLegacySuggestions(transaction: Transaction, input: SuggestionIdentity) {
  return transaction.execute<{ id: string; identity: string; body: Schema.JsonObject }>(
    sql`select id,subject_identity as identity,body from openerp.suggestion_records where book_id=${input.bookId} and actor_id=${input.actorId} and session_id is not distinct from ${input.sessionId} and subject_digest=${input.subjectDigest} and body->>'optionSetDigest'=${input.optionSetDigest} order by created_at,id limit 64`,
    "objects",
  );
}
