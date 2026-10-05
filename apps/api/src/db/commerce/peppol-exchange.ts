import { sql } from "drizzle-orm";
import type * as Schema from "effect/Schema";
import type { Transaction } from "../transaction";

type Body = { readonly body: Schema.JsonObject };

export const tables = [
  "peppol_bindings",
  "peppol_validation_runs",
  "peppol_artifacts",
  "peppol_approvals",
  "peppol_attempts",
  "peppol_outcomes",
  "peppol_submission_admissions",
  "peppol_inbound",
  "peppol_integrity_incidents",
] as const;

export function readBinding(tx: Transaction, book: string, id: string) {
  return tx.execute<Body>(
    sql`select body from openerp.peppol_bindings where book_id=${book} and id=${id}`,
    "objects",
  );
}

export function readCurrentBinding(tx: Transaction, book: string, role: string, subject: string) {
  return tx.execute<Body>(
    sql`select body from openerp.peppol_bindings where book_id=${book} and role=${role} and subject_key=${subject} order by revision desc limit 1`,
    "objects",
  );
}

export function insertBinding(
  tx: Transaction,
  book: string,
  row: {
    readonly id: string;
    readonly role: string;
    readonly subjectKey: string;
    readonly revision: string;
    readonly body: Schema.JsonObject;
  },
) {
  return tx.execute(
    sql`insert into openerp.peppol_bindings(book_id,id,role,subject_key,revision,body) values (${book},${row.id},${row.role},${row.subjectKey},${row.revision}::numeric,${JSON.stringify(row.body)}::jsonb)`,
    "objects",
  );
}

export function readArtifact(tx: Transaction, book: string, id: string) {
  return tx.execute<Body>(
    sql`select body from openerp.peppol_artifacts where book_id=${book} and id=${id}`,
    "objects",
  );
}

export function insertArtifact(
  tx: Transaction,
  book: string,
  row: {
    readonly id: string;
    readonly kind: string;
    readonly sourceId: string;
    readonly senderId: string;
    readonly recipientId: string;
    readonly xmlSha256: string;
    readonly body: Schema.JsonObject;
  },
) {
  return tx.execute(
    sql`insert into openerp.peppol_artifacts(book_id,id,invoice_issue_id,credit_id,sender_binding_id,recipient_binding_id,xml_sha256,body) values (${book},${row.id},${row.kind === "invoice" ? row.sourceId : null},${row.kind === "credit" ? row.sourceId : null},${row.senderId},${row.recipientId},${row.xmlSha256},${JSON.stringify(row.body)}::jsonb)`,
    "objects",
  );
}

export function insertValidation(
  tx: Transaction,
  book: string,
  id: string,
  candidate: string,
  body: Schema.JsonObject,
) {
  return tx.execute(
    sql`insert into openerp.peppol_validation_runs(book_id,id,candidate_id,body) values (${book},${id},${candidate},${JSON.stringify(body)}::jsonb)`,
    "objects",
  );
}

export function readApproval(tx: Transaction, book: string, artifact: string, id: string) {
  return tx.execute<Body>(
    sql`select body from openerp.peppol_approvals where book_id=${book} and artifact_id=${artifact} and id=${id}`,
    "objects",
  );
}

export function insertApproval(
  tx: Transaction,
  book: string,
  row: {
    readonly id: string;
    readonly artifactId: string;
    readonly actorId: string;
    readonly expiresAt: string;
    readonly body: Schema.JsonObject;
  },
) {
  return tx.execute(
    sql`insert into openerp.peppol_approvals(book_id,id,artifact_id,actor_id,expires_at,body) values (${book},${row.id},${row.artifactId},${row.actorId},${row.expiresAt},${JSON.stringify(row.body)}::jsonb)`,
    "objects",
  );
}

export function readAttempt(tx: Transaction, book: string, id: string) {
  return tx.execute<Body>(
    sql`select body from openerp.peppol_attempts where book_id=${book} and id=${id}`,
    "objects",
  );
}

export function insertSubmission(
  tx: Transaction,
  book: string,
  row: {
    readonly id: string;
    readonly attemptId: string;
    readonly artifactId: string;
    readonly approvalId: string;
    readonly commandKey: string;
    readonly kind: string;
    readonly body: Schema.JsonObject;
  },
) {
  return tx.execute(
    sql`insert into openerp.peppol_submission_admissions(book_id,id,attempt_id,artifact_id,approval_id,command_key,kind,body) values(${book},${row.id},${row.attemptId},${row.artifactId},${row.approvalId},${row.commandKey},${row.kind},${JSON.stringify(row.body)}::jsonb) on conflict(book_id,attempt_id,command_key,kind,approval_id) do nothing`,
    "objects",
  );
}

export function readSubmissions(tx: Transaction, book: string, attempt: string) {
  return tx.execute<Body>(
    sql`select body from openerp.peppol_submission_admissions where book_id=${book} and attempt_id=${attempt} order by body->>'admittedAt',id`,
    "objects",
  );
}

export function readAttemptByArtifact(tx: Transaction, book: string, id: string) {
  return tx.execute<Body>(
    sql`select body from openerp.peppol_attempts where book_id=${book} and artifact_id=${id}`,
    "objects",
  );
}

export function readAttemptByProviderKey(tx: Transaction, book: string, key: string) {
  return tx.execute<Body>(
    sql`select body from openerp.peppol_attempts where book_id=${book} and provider_key=${key}`,
    "objects",
  );
}

export function insertAttempt(
  tx: Transaction,
  book: string,
  row: {
    readonly id: string;
    readonly artifactId: string;
    readonly approvalId: string;
    readonly providerKey: string;
    readonly body: Schema.JsonObject;
  },
) {
  return tx.execute(
    sql`insert into openerp.peppol_attempts(book_id,id,artifact_id,approval_id,provider_key,body) values (${book},${row.id},${row.artifactId},${row.approvalId},${row.providerKey},${JSON.stringify(row.body)}::jsonb)`,
    "objects",
  );
}

export function readOutcomes(tx: Transaction, book: string, id: string) {
  return tx.execute<Body>(
    sql`select body from openerp.peppol_outcomes where book_id=${book} and attempt_id=${id} order by body->>'observedAt',id`,
    "objects",
  );
}

export function insertOutcome(
  tx: Transaction,
  book: string,
  id: string,
  attempt: string,
  body: Schema.JsonObject,
) {
  return tx.execute(
    sql`insert into openerp.peppol_outcomes(book_id,id,attempt_id,body) values (${book},${id},${attempt},${JSON.stringify(body)}::jsonb)`,
    "objects",
  );
}

export function readInbound(tx: Transaction, book: string, id: string) {
  return tx.execute<Body>(
    sql`select body from openerp.peppol_inbound where book_id=${book} and id=${id}`,
    "objects",
  );
}

export function readInboundIdentity(
  tx: Transaction,
  book: string,
  provider: string,
  participant: string,
  message: string,
) {
  return tx.execute<Body & { readonly id: string; readonly contentHash: string }>(
    sql`select id,content_hash as "contentHash",body from openerp.peppol_inbound where book_id=${book} and provider_account=${provider} and recipient_participant=${participant} and message_id=${message}`,
    "objects",
  );
}

export function readInboundBusiness(tx: Transaction, book: string, business: string) {
  return tx.execute<{ readonly id: string }>(
    sql`select id from openerp.peppol_inbound where book_id=${book} and business_identity=${business} limit 1`,
    "objects",
  );
}

export function insertInbound(
  tx: Transaction,
  book: string,
  row: {
    readonly id: string;
    readonly provider: string;
    readonly participant: string;
    readonly message: string;
    readonly contentHash: string;
    readonly business: string;
    readonly occurrenceId: string;
    readonly body: Schema.JsonObject;
  },
) {
  return tx.execute(
    sql`insert into openerp.peppol_inbound(book_id,id,provider_account,recipient_participant,message_id,content_hash,business_identity,occurrence_id,body) values (${book},${row.id},${row.provider},${row.participant},${row.message},${row.contentHash},${row.business},${row.occurrenceId},${JSON.stringify(row.body)}::jsonb)`,
    "objects",
  );
}

export function insertIncident(
  tx: Transaction,
  book: string,
  id: string,
  inbound: string,
  hash: string,
  body: Schema.JsonObject,
) {
  return tx.execute(
    sql`insert into openerp.peppol_integrity_incidents(book_id,id,inbound_id,content_hash,body) values (${book},${id},${inbound},${hash},${JSON.stringify(body)}::jsonb) on conflict (book_id,inbound_id,content_hash) do nothing`,
    "objects",
  );
}
