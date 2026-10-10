import * as Effect from "effect/Effect";
import { sql } from "drizzle-orm";
import type * as Schema from "effect/Schema";
import type { Transaction } from "./transaction";

export type RequestRow = {
  body: Schema.JsonObject;
  admissionDigest: string;
  actorId: string;
  credentialHash: string | null;
  sessionId: string | null;
  policyId: string;
  generation: number;
  status: string;
  reason: string | null;
  disclosed: boolean;
  leaseExpired: boolean;
  result: Schema.JsonObject | null;
};

export function readPolicy(tx: Transaction, bookId: string, questionId: string) {
  return tx.execute<{ body: Schema.JsonObject }>(
    sql`select body from openerp.book_decision_policies where book_id=${bookId} and question_id=${questionId} order by sequence desc limit 1`,
    "objects",
  );
}

export function readKey(tx: Transaction, bookId: string, key: string) {
  return tx.execute<{ id: string; body: Schema.JsonObject; admissionDigest: string }>(
    sql`select id,body,admission_digest as "admissionDigest" from openerp.decision_requests where book_id=${bookId} and idempotency_key=${key}`,
    "objects",
  );
}

export const readRequest = Effect.fn("decisionJobs.db.readRequest")(function* (
  tx: Transaction,
  bookId: string,
  id: string,
  lock = false,
) {
  if (lock)
    yield* tx.execute(
      sql`select request_id from openerp.decision_request_controls where book_id=${bookId} and request_id=${id} for update`,
      "objects",
    );

  return yield* tx.execute<RequestRow>(
    sql`
 select r.body,r.admission_digest as "admissionDigest",r.requested_by as "actorId",r.credential_hash as "credentialHash",r.session_id as "sessionId",r.policy_id as "policyId",
 c.generation,c.status,c.reason,(c.disclosed_at is not null or exists(select 1 from openerp.decision_attempts a where a.book_id=r.book_id and a.request_id=r.id and a.phase='disclosed')) as disclosed,coalesce(c.lease_expires_at<=clock_timestamp(),true) as "leaseExpired",s.body as result
 from openerp.decision_requests r join openerp.decision_request_controls c on c.book_id=r.book_id and c.request_id=r.id
 left join openerp.decision_results s on s.book_id=r.book_id and s.request_id=r.id
 where r.book_id=${bookId} and r.id=${id}`,
    "objects",
  );
});

export function insertRequest(
  tx: Transaction,
  row: {
    bookId: string;
    id: string;
    key: string;
    admissionDigest: string;
    actorId: string;
    credentialHash: string | null;
    sessionId: string | null;
    policyId: string;
    body: Schema.JsonObject;
  },
) {
  return tx.execute(
    sql`insert into openerp.decision_requests(book_id,id,idempotency_key,admission_digest,requested_by,credential_hash,session_id,policy_id,body) values(${row.bookId},${row.id},${row.key},${row.admissionDigest},${row.actorId},${row.credentialHash},${row.sessionId},${row.policyId},${JSON.stringify(row.body)}::jsonb)`,
    "objects",
  );
}

export function insertControl(tx: Transaction, bookId: string, id: string) {
  return tx.execute(
    sql`insert into openerp.decision_request_controls(book_id,request_id) values(${bookId},${id})`,
    "objects",
  );
}

export function readSubject(tx: Transaction, bookId: string, id: string) {
  return tx.execute<{ body: Schema.JsonObject }>(
    sql`
 select r.body from openerp.supplier_invoice_drafts d join openerp.supplier_invoice_draft_revisions r on r.book_id=d.book_id and r.draft_id=d.id and r.revision=d.current_revision
 where d.book_id=${bookId} and d.id=${id} for share of d`,
    "objects",
  );
}

export function readEvidence(tx: Transaction, bookId: string, id: string) {
  return tx.execute<{ content: string; mediaType: string }>(
    sql`select content,media_type as "mediaType" from openerp.evidence where book_id=${bookId} and id=${id}`,
    "objects",
  );
}

export function readRequester(tx: Transaction, bookId: string, row: RequestRow) {
  return tx.execute<{ live: boolean }>(
    sql`
 select exists(select 1 from openerp.memberships m where m.book_id=${bookId} and m.actor_id=${row.actorId} and m.role='operator')
 and not exists(select 1 from openerp.identity_admissions a where a.actor_id=${row.actorId} and not a.enabled)
 and (${row.credentialHash}::text is not null and exists(select 1 from openerp.credentials x where x.token_hash=${row.credentialHash} and x.actor_id=${row.actorId} and x.revoked_at is null and x.expires_at>clock_timestamp())
 or ${row.sessionId}::text is not null and exists(select 1 from openerp_auth.session x where x.id=${row.sessionId} and x.user_id=${row.actorId} and x.expires_at>clock_timestamp())) as live`,
    "objects",
  );
}

export function lockRequester(tx: Transaction, bookId: string, row: RequestRow) {
  return tx.execute(
    sql`
 select actor_id from openerp.memberships where book_id=${bookId} and actor_id=${row.actorId} for share`,
    "objects",
  );
}

export function lockRequesterCredential(tx: Transaction, row: RequestRow) {
  return tx.execute(
    sql`select actor_id from openerp.credentials where token_hash=${row.credentialHash} for share`,
    "objects",
  );
}

export function lockRequesterSession(tx: Transaction, row: RequestRow) {
  return tx.execute(
    sql`select id from openerp_auth.session where id=${row.sessionId} for share`,
    "objects",
  );
}

export function lockRequesterAdmission(tx: Transaction, row: RequestRow) {
  return tx.execute(
    sql`select actor_id from openerp.identity_admissions where actor_id=${row.actorId} for share`,
    "objects",
  );
}

export function startAttempt(tx: Transaction, bookId: string, id: string) {
  return tx.execute<{ generation: number }>(
    sql`update openerp.decision_request_controls set status='running',generation=generation+1,lease_expires_at=clock_timestamp()+interval '60 seconds' where book_id=${bookId} and request_id=${id} returning generation`,
    "objects",
  );
}

export function appendAttempt(
  tx: Transaction,
  bookId: string,
  id: string,
  generation: number,
  phase: string,
  body: Schema.JsonObject,
) {
  return tx.execute(
    sql`insert into openerp.decision_attempts(book_id,request_id,generation,phase,body) values(${bookId},${id},${generation},${phase},${JSON.stringify(body)}::jsonb) on conflict do nothing`,
    "objects",
  );
}

export function markDisclosure(tx: Transaction, bookId: string, id: string, generation: number) {
  return tx.execute(
    sql`update openerp.decision_request_controls set disclosed_at=clock_timestamp() where book_id=${bookId} and request_id=${id} and generation=${generation} and status='running' and lease_expires_at>clock_timestamp() returning request_id`,
    "objects",
  );
}

export function finish(
  tx: Transaction,
  bookId: string,
  id: string,
  generation: number,
  status: string,
  reason: string | null,
) {
  return tx.execute(
    sql`update openerp.decision_request_controls set status=${status},reason=${reason},lease_expires_at=null where book_id=${bookId} and request_id=${id} and generation=${generation}`,
    "objects",
  );
}

export function insertResult(
  tx: Transaction,
  bookId: string,
  requestId: string,
  id: string,
  body: Schema.JsonObject,
  generation: number,
) {
  return tx.execute<{ id: string }>(
    sql`insert into openerp.decision_results(book_id,request_id,id,body) select ${bookId},${requestId},${id},${JSON.stringify(body)}::jsonb from openerp.decision_request_controls where book_id=${bookId} and request_id=${requestId} and generation=${generation} and status='running' and lease_expires_at>clock_timestamp() returning id`,
    "objects",
  );
}

export function pending(tx: Transaction, actorId: string) {
  return tx.execute<{ bookId: string; entityId: string; id: string }>(
    sql`select r.book_id as "bookId",b.entity_id as "entityId",r.id from openerp.decision_requests r join openerp.books b on b.id=r.book_id join openerp.decision_request_controls c on c.book_id=r.book_id and c.request_id=r.id where exists(select 1 from openerp.memberships m where m.book_id=r.book_id and m.actor_id=${actorId}) and (c.status='ready' or (c.status='running' and c.lease_expires_at<=clock_timestamp())) order by r.created_at limit 20`,
    "objects",
  );
}

export function readBookCutoff(tx: Transaction, bookId: string) {
  return tx.execute<{ cutoff: string }>(
    sql`select committed_sequence::text as cutoff from openerp.books where id=${bookId}`,
    "objects",
  );
}
