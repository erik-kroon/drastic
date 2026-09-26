import { sql } from "drizzle-orm";
import * as Schema from "effect/Schema";
import type { Transaction } from "./transaction";

type JsonObject = Schema.JsonObject;

export const firmTables = [
  "firms",
  "firm_members",
  "firm_clients",
  "firm_commands",
  "books",
  "memberships",
  "identity_admissions",
] as const;

export type CountRow = { readonly total: number };

export type FirmRow = { readonly id: string; readonly name: string };

export type MemberRow = {
  readonly role: string;
  readonly active: boolean;
  readonly revision: number;
};

export type TeamRow = {
  readonly actorId: string;
  readonly name: string;
  readonly email: string;
  readonly role: string;
  readonly active: boolean;
  readonly signInEnabled: boolean;
  readonly revision: number;
};

export type ClientBookRow = {
  readonly bookId: string;
  readonly entityId: string;
  readonly name: string;
  readonly currency: string;
  readonly profile: string;
  readonly role: string;
  readonly sequence: string;
  readonly leadId: string | null;
  readonly leadAvailable: boolean;
  readonly eligibleLeadIds: JsonObject;
  readonly nextReviewOn: string | null;
  readonly note: string;
  readonly revision: number;
};

export type ClientRow = {
  readonly bookId: string;
  readonly leadId: string | null;
  readonly nextReviewOn: string | null;
  readonly note: string;
  readonly revision: number;
};

export type CommandRow = {
  readonly firmId: string;
  readonly operation: string;
  readonly payloadDigest: string;
  readonly result: JsonObject;
};

export type UserRow = { readonly id: string };

export function readOwnedFirms(transaction: Transaction, actorId: string) {
  return transaction.execute<FirmRow>(
    sql`
      select f.id, f.name
      from openerp.firms f
      join openerp.firm_members m on m.firm_id = f.id
      where m.actor_id = ${actorId} and m.active
      order by f.name, f.id collate "C"
      for share of f
    `,
    "objects",
  );
}

export function countOwnedFirmMemberships(transaction: Transaction, actorId: string) {
  return transaction.execute<CountRow>(
    sql`
      select count(*)::integer as total
      from openerp.firm_members
      where actor_id = ${actorId} and active
    `,
    "objects",
  );
}

export function lockFirm(transaction: Transaction, firmId: string, lock: "share" | "update") {
  return transaction.execute<FirmRow>(
    sql`
      select id, name from openerp.firms where id = ${firmId}
      ${lock === "update" ? sql`for update` : sql`for share`}
    `,
    "objects",
  );
}

export type FirmRoleRow = {
  readonly id: string;
  readonly name: string;
  readonly role: string;
};

export function readOwnedFirmRoles(transaction: Transaction, actorId: string) {
  return transaction.execute<FirmRoleRow>(
    sql`
      select f.id, f.name, m.role
      from openerp.firms f
      join openerp.firm_members m on m.firm_id = f.id
      where m.actor_id = ${actorId} and m.active
      order by f.name, f.id collate "C"
      for share of f
    `,
    "objects",
  );
}

export function readFirmMembership(
  transaction: Transaction,
  firmId: string,
  actorId: string,
  lock: "share" | "update",
) {
  return transaction.execute<MemberRow>(
    sql`
      select role, active, revision from openerp.firm_members
      where firm_id = ${firmId} and actor_id = ${actorId}
      ${lock === "update" ? sql`for update` : sql`for share`}
    `,
    "objects",
  );
}

export function readTeam(transaction: Transaction, firmId: string) {
  return transaction.execute<TeamRow>(
    sql`
      select m.actor_id as "actorId", u.name, u.email, m.role, m.active, m.revision,
        not exists (
          select 1 from openerp.identity_admissions ia
          where ia.actor_id = m.actor_id and not ia.enabled
        ) as "signInEnabled"
      from openerp.firm_members m
      join openerp_auth."user" u on u.id = m.actor_id
      where m.firm_id = ${firmId}
      order by m.active desc, u.name, u.id
    `,
    "objects",
  );
}

export function lockClientBookMemberships(transaction: Transaction, firmId: string) {
  return transaction.execute<{ readonly bookId: string }>(
    sql`
      select m.book_id as "bookId"
      from openerp.memberships m
      join openerp.firm_clients c on c.book_id = m.book_id
      where c.firm_id = ${firmId}
      order by m.book_id, m.actor_id
      for share of m
    `,
    "objects",
  );
}

export function readClientBooks(transaction: Transaction, firmId: string, actorId: string) {
  return transaction.execute<ClientBookRow>(
    sql`
      select c.book_id as "bookId", b.entity_id as "entityId", b.name, b.currency, b.profile,
        m.role, b.committed_sequence::text as sequence, c.lead_id as "leadId",
        exists (
          select 1 from openerp.firm_members fm
          join openerp.memberships bm on bm.actor_id = fm.actor_id
          where fm.firm_id = ${firmId} and fm.active
            and not exists (
              select 1 from openerp.identity_admissions ia
              where ia.actor_id = fm.actor_id and not ia.enabled)
            and fm.actor_id = c.lead_id and bm.book_id = b.id
        ) as "leadAvailable",
        coalesce((
          select jsonb_agg(fm.actor_id order by fm.actor_id collate "C")
          from openerp.firm_members fm
          join openerp.memberships bm on bm.actor_id = fm.actor_id
          where fm.firm_id = ${firmId} and fm.active
            and not exists (
              select 1 from openerp.identity_admissions ia
              where ia.actor_id = fm.actor_id and not ia.enabled)
            and bm.book_id = b.id
        ), '[]'::jsonb) as "eligibleLeadIds",
        c.next_review_on::text as "nextReviewOn", c.note, c.revision
      from openerp.firm_clients c
      join openerp.books b on b.id = c.book_id
      join openerp.memberships m on m.book_id = b.id and m.actor_id = ${actorId}
      where c.firm_id = ${firmId}
      order by b.name, b.id collate "C"
    `,
    "objects",
  );
}

export function readClient(transaction: Transaction, firmId: string, bookId: string) {
  return transaction.execute<ClientRow>(
    sql`
      select book_id as "bookId", lead_id as "leadId", next_review_on::text as "nextReviewOn",
        note, revision
      from openerp.firm_clients
      where firm_id = ${firmId} and book_id = ${bookId}
    `,
    "objects",
  );
}

export function countClients(transaction: Transaction, firmId: string) {
  return transaction.execute<CountRow>(
    sql`select count(*)::integer as total from openerp.firm_clients where firm_id = ${firmId}`,
    "objects",
  );
}

export function countMembers(transaction: Transaction, firmId: string) {
  return transaction.execute<CountRow>(
    sql`select count(*)::integer as total from openerp.firm_members where firm_id = ${firmId}`,
    "objects",
  );
}

export function countSignableAdmins(transaction: Transaction, firmId: string) {
  return transaction.execute<CountRow>(
    sql`
      select count(*)::integer as total
      from openerp.firm_members m
      where m.firm_id = ${firmId} and m.active and m.role = 'admin'
        and not exists (
          select 1 from openerp.identity_admissions ia where ia.actor_id = m.actor_id and not ia.enabled)
    `,
    "objects",
  );
}

export function nextFirmRevision(transaction: Transaction, firmId: string) {
  return transaction.execute<{ readonly revision: number }>(
    sql`
      update openerp.firms set revision = revision + 1 where id = ${firmId}
      returning revision
    `,
    "objects",
  );
}

export function countCreatedFirms(transaction: Transaction, actorId: string) {
  return transaction.execute<CountRow>(
    sql`select count(*)::integer as total from openerp.firms where created_by = ${actorId}`,
    "objects",
  );
}

export function insertFirm(
  transaction: Transaction,
  row: {
    readonly firmId: string;
    readonly name: string;
    readonly actorId: string;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.firms (id, name, created_by)
      values (${row.firmId}, ${row.name}, ${row.actorId})
    `,
    "objects",
  );
}

export function insertFirmAdmin(
  transaction: Transaction,
  row: {
    readonly firmId: string;
    readonly actorId: string;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.firm_members (firm_id, actor_id, role, active, revision)
      values (${row.firmId}, ${row.actorId}, 'admin', true, 1)
    `,
    "objects",
  );
}

export function upsertClient(
  transaction: Transaction,
  row: {
    readonly firmId: string;
    readonly bookId: string;
    readonly leadId: string | null;
    readonly nextReviewOn: string | null;
    readonly note: string;
    readonly revision: number;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.firm_clients (firm_id, book_id, lead_id, next_review_on, note, revision)
      values (${row.firmId}, ${row.bookId}, ${row.leadId}, ${row.nextReviewOn}::date, ${row.note},
        ${row.revision})
      on conflict (firm_id, book_id) do update
        set lead_id = excluded.lead_id, next_review_on = excluded.next_review_on,
          note = excluded.note, revision = excluded.revision
    `,
    "objects",
  );
}

export function deleteClient(transaction: Transaction, firmId: string, bookId: string) {
  return transaction.execute(
    sql`delete from openerp.firm_clients where firm_id = ${firmId} and book_id = ${bookId}`,
    "objects",
  );
}

export function lookupUserByEmail(transaction: Transaction, email: string) {
  return transaction.execute<UserRow>(
    sql`select id from openerp_auth."user" where lower(email) = lower(${email})`,
    "objects",
  );
}

export function readMemberMembership(transaction: Transaction, firmId: string, actorId: string) {
  return transaction.execute<MemberRow>(
    sql`
      select role, active, revision from openerp.firm_members
      where firm_id = ${firmId} and actor_id = ${actorId}
      for update
    `,
    "objects",
  );
}

export function upsertMember(
  transaction: Transaction,
  row: {
    readonly firmId: string;
    readonly actorId: string;
    readonly role: string;
    readonly active: boolean;
    readonly revision: number;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.firm_members (firm_id, actor_id, role, active, revision)
      values (${row.firmId}, ${row.actorId}, ${row.role}, ${row.active}, ${row.revision})
      on conflict (firm_id, actor_id) do update
        set role = excluded.role, active = excluded.active, revision = excluded.revision
    `,
    "objects",
  );
}

export function lockLeadMembership(
  transaction: Transaction,
  firmId: string,
  bookId: string,
  actorId: string,
) {
  return transaction.execute<{ readonly bookId: string }>(
    sql`
      select m.book_id as "bookId"
      from openerp.memberships m
      join openerp.firm_members fm on fm.actor_id = m.actor_id
      where m.book_id = ${bookId} and fm.firm_id = ${firmId} and fm.active
        and not exists (
          select 1 from openerp.identity_admissions ia where ia.actor_id = fm.actor_id and not ia.enabled)
        and fm.actor_id = ${actorId}
      for share of m
    `,
    "objects",
  );
}

export function readCommand(transaction: Transaction, actorId: string, key: string) {
  return transaction.execute<CommandRow>(
    sql`
      select firm_id as "firmId", operation, openerp.digest(payload) as "payloadDigest", result
      from openerp.firm_commands
      where actor_id = ${actorId} and key = ${key}
      for update
    `,
    "objects",
  );
}

export function insertCommand(
  transaction: Transaction,
  row: {
    readonly actorId: string;
    readonly key: string;
    readonly firmId: string;
    readonly operation: string;
    readonly payload: JsonObject;
    readonly result: JsonObject;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.firm_commands (actor_id, key, firm_id, operation, payload, result)
      values (${row.actorId}, ${row.key}, ${row.firmId}, ${row.operation},
        ${JSON.stringify(row.payload)}::jsonb, ${JSON.stringify(row.result)}::jsonb)
    `,
    "objects",
  );
}
