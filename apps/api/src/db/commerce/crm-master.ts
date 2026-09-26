import { sql } from "drizzle-orm";
import type { Transaction } from "../transaction";
import type { JsonObject } from "./access";

export const crmMasterTables = [
  "commerce_counterparties",
  "commerce_counterparty_revisions",
  "crm_party_annotations",
  "evidence",
] as const;

export type PartyRow = {
  readonly id: string;
  readonly hasMore: boolean;
  readonly revision: JsonObject;
  readonly annotations: JsonObject;
};

export type AnnotationRow = {
  readonly id: string;
  readonly partyId: string;
  readonly kind: string;
  readonly label: string;
  readonly detail: string;
  readonly evidenceId: string;
  readonly recordedBy: string;
  readonly recordedAt: string;
};

export type PartyExistsRow = { readonly present: boolean };

export type EvidenceIdentityRow = { readonly id: string };

export function readDirectoryPage(
  transaction: Transaction,
  bookId: string,
  search: string,
  role: string,
  after: string,
  limit: number,
) {
  const bound = limit + 1;

  return transaction.execute<PartyRow>(
    sql`
      select page.id, page.total > ${limit} as "hasMore", page.revision,
        coalesce((
          select jsonb_agg(jsonb_build_object('id', a.id, 'kind', a.kind, 'label', a.label,
            'detail', a.detail, 'evidenceId', a.evidence_id, 'recordedBy', a.recorded_by,
            'recordedAt', a.recorded_at) order by a.id collate "C")
          from openerp.crm_party_annotations a
          where a.book_id = ${bookId} and a.party_id = page.id
        ), '[]'::jsonb) as annotations
      from (
        select c.id, c.role, c.current_revision, r.body as revision,
          count(*) over () as total, row_number() over (order by c.id collate "C") as position
        from openerp.commerce_counterparties c
        join openerp.commerce_counterparty_revisions r
          on r.book_id = c.book_id and r.counterparty_id = c.id and r.revision = c.current_revision
        where c.book_id = ${bookId} and c.id collate "C" > ${after} collate "C"
          and (${role} = '' or c.role = ${role} or (c.role = 'both' and ${role} in ('customer', 'supplier')))
          and (${search} = ''
            or c.external_key ilike ${`%${search}%`}
            or r.body->>'displayName' ilike ${`%${search}%`}
            or exists (
              select from openerp.crm_party_annotations a
              where a.book_id = c.book_id and a.party_id = c.id and a.kind = 'alias'
                and a.label ilike ${`%${search}%`}
            ))
        order by c.id collate "C"
        limit ${bound}
      ) page
      where page.position <= ${limit}
      order by page.id collate "C"
    `,
    "objects",
  );
}

export function readEvidenceIdentity(transaction: Transaction, bookId: string, evidenceId: string) {
  return transaction.execute<EvidenceIdentityRow>(
    sql`
      select e.id from openerp.evidence e
      where e.book_id = ${bookId} and e.id = ${evidenceId}
    `,
    "objects",
  );
}

export function readPartyExists(transaction: Transaction, bookId: string, partyId: string) {
  return transaction.execute<PartyExistsRow>(
    sql`
      select exists (
        select from openerp.commerce_counterparties c
        where c.book_id = ${bookId} and c.id = ${partyId}
      ) as present
    `,
    "objects",
  );
}

export function insertAnnotation(
  transaction: Transaction,
  row: {
    bookId: string;
    partyId: string;
    id: string;
    kind: string;
    label: string;
    detail: string;
    evidenceId: string;
    recordedBy: string;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.crm_party_annotations
        (book_id, party_id, id, kind, label, detail, evidence_id, recorded_by)
      values (${row.bookId}, ${row.partyId}, ${row.id}, ${row.kind}, ${row.label}, ${row.detail},
        ${row.evidenceId}, ${row.recordedBy})
    `,
    "objects",
  );
}

export function readAnnotation(transaction: Transaction, bookId: string, id: string) {
  return transaction.execute<AnnotationRow>(
    sql`
      select a.id, a.party_id as "partyId", a.kind, a.label, a.detail, a.evidence_id as "evidenceId",
        a.recorded_by as "recordedBy", a.recorded_at as "recordedAt"
      from openerp.crm_party_annotations a
      where a.book_id = ${bookId} and a.id = ${id}
    `,
    "objects",
  );
}
