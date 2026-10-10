import { sql } from "drizzle-orm";
import type * as Schema from "effect/Schema";
import type { Transaction } from "./transaction";

export const mandateTables = [
  "posting_mandates",
  "posting_mandate_counterparties",
  "posting_mandate_revocations",
  "posting_mandate_consumptions",
] as const;

export type MandateRow = {
  readonly id: string;
  readonly grantorId: string;
  readonly granteeId: string;
  readonly body: Schema.JsonObject;
  readonly digest: string;
  readonly grantedAt: string;
  readonly current: boolean;
  readonly revocation: Schema.JsonObject | null;
  readonly consumedEvents: number;
  readonly consumedGross: ReadonlyArray<string>;
};

const mandateColumns = sql`m.id, m.grantor_id as "grantorId", m.grantee_id as "granteeId", m.body,
  m.digest, m.granted_at::text as "grantedAt",
  (clock_timestamp() >= m.valid_from and clock_timestamp() < m.valid_until) as current,
  (select jsonb_build_object('actorId', r.actor_id, 'reason', r.reason, 'revokedAt', r.revoked_at::text)
    from openerp.posting_mandate_revocations r
    where r.book_id = m.book_id and r.mandate_id = m.id) as revocation,
  (select count(*)::int from openerp.posting_mandate_consumptions c
    where c.book_id = m.book_id and c.mandate_id = m.id) as "consumedEvents",
  array(select c.gross_minor from openerp.posting_mandate_consumptions c
    where c.book_id = m.book_id and c.mandate_id = m.id order by c.ordinal) as "consumedGross"`;

// The mandate row lock serializes every execution and revocation of one mandate,
// so remaining limits are read and consumed under the same lock.
export function lockMandate(tx: Transaction, bookId: string, id: string) {
  return tx.execute<MandateRow>(
    sql`select ${mandateColumns} from openerp.posting_mandates m
      where m.book_id = ${bookId} and m.id = ${id} for update of m`,
    "objects",
  );
}

export function readMandate(tx: Transaction, bookId: string, id: string) {
  return tx.execute<MandateRow>(
    sql`select ${mandateColumns} from openerp.posting_mandates m
      where m.book_id = ${bookId} and m.id = ${id}`,
    "objects",
  );
}

export function listMandates(tx: Transaction, bookId: string) {
  return tx.execute<MandateRow>(
    sql`select ${mandateColumns} from openerp.posting_mandates m
      where m.book_id = ${bookId} order by m.granted_at desc, m.id limit 100`,
    "objects",
  );
}

export function insertMandate(
  tx: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly grantorId: string;
    readonly granteeId: string;
    readonly validFrom: string;
    readonly validUntil: string;
    readonly body: Schema.JsonObject;
    readonly digest: string;
  },
) {
  return tx.execute(
    sql`insert into openerp.posting_mandates
      (book_id, id, grantor_id, grantee_id, family, valid_from, valid_until, body, digest)
      values (${row.bookId}, ${row.id}, ${row.grantorId}, ${row.granteeId}, 'supplier_acceptance',
        ${row.validFrom}::timestamptz, ${row.validUntil}::timestamptz, ${JSON.stringify(row.body)}::jsonb,
        ${row.digest})`,
    "objects",
  );
}

export function insertMandateCounterparty(
  tx: Transaction,
  row: {
    readonly bookId: string;
    readonly mandateId: string;
    readonly counterpartyId: string;
    readonly revision: string;
  },
) {
  return tx.execute(
    sql`insert into openerp.posting_mandate_counterparties (book_id, mandate_id, counterparty_id, revision)
      values (${row.bookId}, ${row.mandateId}, ${row.counterpartyId}, ${row.revision}::bigint)`,
    "objects",
  );
}

export function readMandateCounterparty(
  tx: Transaction,
  bookId: string,
  mandateId: string,
  counterpartyId: string,
) {
  return tx.execute<{ readonly revision: string }>(
    sql`select revision::text as revision from openerp.posting_mandate_counterparties
      where book_id = ${bookId} and mandate_id = ${mandateId} and counterparty_id = ${counterpartyId}`,
    "objects",
  );
}

// The supplier's current revision and role, read under a share lock so a revision
// committed concurrently waits for the posting group.
export function readCurrentCounterparty(tx: Transaction, bookId: string, counterpartyId: string) {
  return tx.execute<{ readonly currentRevision: string; readonly role: string }>(
    sql`select current_revision::text as "currentRevision", role from openerp.commerce_counterparties
      where book_id = ${bookId} and id = ${counterpartyId} for share`,
    "objects",
  );
}

export function insertRevocation(
  tx: Transaction,
  row: {
    readonly bookId: string;
    readonly mandateId: string;
    readonly actorId: string;
    readonly reason: string;
  },
) {
  return tx.execute(
    sql`insert into openerp.posting_mandate_revocations (book_id, mandate_id, actor_id, reason)
      values (${row.bookId}, ${row.mandateId}, ${row.actorId}, ${row.reason})`,
    "objects",
  );
}

export function insertConsumption(
  tx: Transaction,
  row: {
    readonly bookId: string;
    readonly mandateId: string;
    readonly ordinal: number;
    readonly reviewId: string;
    readonly approvalId: string;
    readonly acceptanceId: string;
    readonly grossMinor: string;
  },
) {
  return tx.execute(
    sql`insert into openerp.posting_mandate_consumptions
      (book_id, mandate_id, ordinal, review_id, approval_id, acceptance_id, gross_minor)
      values (${row.bookId}, ${row.mandateId}, ${row.ordinal}, ${row.reviewId}, ${row.approvalId},
        ${row.acceptanceId}, ${row.grossMinor})`,
    "objects",
  );
}
