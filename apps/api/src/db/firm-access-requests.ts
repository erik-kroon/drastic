import { sql } from "drizzle-orm";
import type { Transaction } from "./transaction";

export type AccessRequestRow = {
  readonly id: string;
  readonly clientName: string;
  readonly organizationNumber: string | null;
  readonly leadId: string | null;
  readonly leadAvailable: boolean;
  readonly requestedBy: string;
  readonly state: string;
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export function readAccessRequests(transaction: Transaction, firmId: string) {
  return transaction.execute<AccessRequestRow>(
    sql`
      select r.id, r.client_name as "clientName", r.organization_number as "organizationNumber",
        r.lead_id as "leadId", r.requested_by as "requestedBy", r.state, r.revision,
        r.created_at::text as "createdAt", r.updated_at::text as "updatedAt",
        exists (
          select 1 from openerp.firm_members m
          where m.firm_id = r.firm_id and m.actor_id = r.lead_id and m.active
            and not exists (
              select 1 from openerp.identity_admissions a
              where a.actor_id = m.actor_id and not a.enabled)
        ) as "leadAvailable"
      from openerp.firm_access_requests r
      where r.firm_id = ${firmId}
      order by r.client_name, r.id collate "C"
      limit 201
    `,
    "objects",
  );
}

export function lockAccessRequest(transaction: Transaction, firmId: string, id: string) {
  return transaction.execute<{
    readonly requestedBy: string;
    readonly state: string;
    readonly revision: number;
  }>(
    sql`
      select requested_by as "requestedBy", state, revision
      from openerp.firm_access_requests
      where firm_id = ${firmId} and id = ${id}
      for update
    `,
    "objects",
  );
}

export function countAccessRequests(transaction: Transaction, firmId: string) {
  return transaction.execute<{ readonly total: number }>(
    sql`select count(*)::integer as total from openerp.firm_access_requests where firm_id = ${firmId}`,
    "objects",
  );
}

export function saveAccessRequest(
  transaction: Transaction,
  row: {
    readonly firmId: string;
    readonly id: string;
    readonly clientName: string;
    readonly organizationNumber: string | null;
    readonly leadId: string | null;
    readonly requestedBy: string;
    readonly state: string;
    readonly revision: number;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.firm_access_requests
        (firm_id, id, client_name, organization_number, lead_id, requested_by, state, revision)
      values (${row.firmId}, ${row.id}, ${row.clientName}, ${row.organizationNumber}, ${row.leadId},
        ${row.requestedBy}, ${row.state}, ${row.revision})
      on conflict (firm_id, id) do update set
        client_name = excluded.client_name, organization_number = excluded.organization_number,
        lead_id = excluded.lead_id, state = excluded.state, revision = excluded.revision,
        updated_at = clock_timestamp()
    `,
    "objects",
  );
}
