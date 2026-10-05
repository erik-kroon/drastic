import { sql } from "drizzle-orm";
import type * as Schema from "effect/Schema";
import type { Transaction } from "../transaction";

export const tables = [
  "document_governance",
  "document_governance_reviews",
  "document_validations",
  "document_manifests",
  "document_signature_intents",
  "document_signature_attempts",
  "document_signature_observations",
  "document_signature_evidence",
  "filing_adoptions",
  "filing_adoption_reviews",
  "filing_intents",
  "filing_authorizations",
  "filing_attempts",
  "filing_observations",
] as const;

export type Table = (typeof tables)[number];

export type BodyRow = { readonly id: string; readonly body: Schema.JsonObject };

export function readRecord(transaction: Transaction, bookId: string, table: Table, id: string) {
  return transaction.execute<BodyRow>(
    sql`select id,body from openerp.${sql.identifier(table)} where book_id=${bookId} and id=${id}`,
    "objects",
  );
}

export function listRecords(transaction: Transaction, bookId: string, table: Table) {
  return transaction.execute<BodyRow>(
    sql`select id,body from openerp.${sql.identifier(table)} where book_id=${bookId} order by ordinal`,
    "objects",
  );
}

export function insertRecord(
  transaction: Transaction,
  table: Table,
  record: {
    readonly id: string;
    readonly scope: { readonly bookId: string };
    readonly digest: string;
  },
  body: Schema.JsonObject,
) {
  return transaction.execute(
    sql`insert into openerp.${sql.identifier(table)}(book_id,id,digest,body) values(${record.scope.bookId},${record.id},${record.digest},${JSON.stringify(body)}::jsonb)`,
    "objects",
  );
}

export function readArtifact(transaction: Transaction, bookId: string, id: string) {
  return transaction.execute<BodyRow>(
    sql`select id,body from openerp.annual_report_artifacts where book_id=${bookId} and id=${id}`,
    "objects",
  );
}

export function readParticipant(transaction: Transaction, bookId: string, actorId: string) {
  return transaction.execute<{ readonly enabled: boolean }>(
    sql`select admission.enabled from openerp.memberships membership join openerp.identity_admissions admission on admission.actor_id=membership.actor_id where membership.book_id=${bookId} and membership.actor_id=${actorId} and membership.role='operator' for share of membership,admission`,
    "objects",
  );
}
