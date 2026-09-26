import { textArray } from "../sql-values";
import { sql } from "drizzle-orm";
import type * as Schema from "effect/Schema";
import type { Transaction } from "../transaction";

type JsonObject = Schema.JsonObject;

export type CoverageRow = {
  readonly id: string;
  readonly inventoryId: string;
  readonly body: JsonObject;
};

export type CapacityRow = {
  readonly id: string;
  readonly accountId: string;
  readonly body: JsonObject;
};

export type SignoffPlanRow = {
  readonly id: string;
  readonly coverageReportId: string;
  readonly reconciliationId: string;
  readonly body: JsonObject;
};

export type SignoffRow = {
  readonly planId: string;
  readonly evidenceId: string;
  readonly body: JsonObject;
  readonly content: string;
  readonly sha256: string;
  readonly byteLength: number;
};

export type InventoryRow = {
  readonly id: string;
  readonly periodId: string;
  readonly ordinal: string;
  readonly body: JsonObject;
};

export type PeriodRow = {
  readonly id: string;
  readonly version: string;
  readonly startsOn: string;
  readonly endsOn: string;
  readonly locked: boolean;
};

export type CountRow = { readonly total: number };

export type AccountSequenceRow = { readonly sequence: string };

export type SignedPlanRow = {
  readonly id: string;
  readonly plan: JsonObject;
  readonly signoff: JsonObject;
  readonly content: string;
  readonly sha256: string;
  readonly byteLength: number;
  readonly coverage: JsonObject;
};

export type InventorySignoffPlanRow = {
  readonly id: string;
  readonly inventoryId: string;
  readonly body: JsonObject;
  readonly content: string;
  readonly sha256: string;
  readonly byteLength: number;
};

export type InventorySignoffRow = {
  readonly planId: string;
  readonly evidenceId: string;
  readonly body: JsonObject;
  readonly content: string;
  readonly sha256: string;
  readonly byteLength: number;
};

export function readCoverage(transaction: Transaction, bookId: string, reportId: string) {
  return transaction.execute<CoverageRow>(
    sql`
      select id, inventory_id as "inventoryId", body
      from openerp.bank_source_coverage_reports
      where book_id = ${bookId} and id = ${reportId}
      for share
    `,
    "objects",
  );
}

export function readCapacityReconciliation(
  transaction: Transaction,
  bookId: string,
  reportId: string,
) {
  return transaction.execute<CapacityRow>(
    sql`
      select id, account_id as "accountId", body
      from openerp.bank_capacity_reconciliations
      where book_id = ${bookId} and id = ${reportId}
      for share
    `,
    "objects",
  );
}

export function readSignoffPlanCount(transaction: Transaction, bookId: string) {
  return transaction.execute<CountRow>(
    sql`select count(*)::integer as total from openerp.bank_signoff_plans where book_id = ${bookId}`,
    "objects",
  );
}

export function readAccountLedgerSequence(
  transaction: Transaction,
  bookId: string,
  accountId: string,
  endsOn: string,
) {
  return transaction.execute<AccountSequenceRow>(
    sql`
      select coalesce(max(v.sequence), 0)::text as sequence
      from openerp.journal_lines l
      join openerp.vouchers v on (v.book_id, v.id) = (l.book_id, l.voucher_id)
      where l.book_id = ${bookId} and l.account_id = ${accountId}
        and v.posting_date <= ${endsOn}::date
    `,
    "objects",
  );
}

export function insertSignoffPlan(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly coverageReportId: string;
    readonly reconciliationId: string;
    readonly body: JsonObject;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.bank_signoff_plans (book_id, id, coverage_report_id, reconciliation_id, body)
      values (${row.bookId}, ${row.id}, ${row.coverageReportId}, ${row.reconciliationId}, ${JSON.stringify(row.body)}::jsonb)
    `,
    "objects",
  );
}

export function readSignoffPlan(transaction: Transaction, bookId: string, planId: string) {
  return transaction.execute<SignoffPlanRow>(
    sql`
      select id, coverage_report_id as "coverageReportId", reconciliation_id as "reconciliationId", body
      from openerp.bank_signoff_plans
      where book_id = ${bookId} and id = ${planId}
    `,
    "objects",
  );
}

export function readReconciliationSignoff(
  transaction: Transaction,
  bookId: string,
  planId: string,
) {
  return transaction.execute<SignoffRow>(
    sql`
      select plan_id as "planId", evidence_id as "evidenceId", body, content, sha256,
        byte_length as "byteLength"
      from openerp.bank_reconciliation_signoffs
      where book_id = ${bookId} and plan_id = ${planId}
    `,
    "objects",
  );
}

export function insertReconciliationSignoff(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly planId: string;
    readonly evidenceId: string;
    readonly body: JsonObject;
    readonly content: string;
    readonly sha256: string;
    readonly byteLength: number;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.bank_reconciliation_signoffs
        (book_id, plan_id, evidence_id, body, content, sha256, byte_length)
      values (${row.bookId}, ${row.planId}, ${row.evidenceId}, ${JSON.stringify(row.body)}::jsonb,
        ${row.content}, ${row.sha256}, ${row.byteLength})
    `,
    "objects",
  );
}

export function listSignoffPlans(transaction: Transaction, bookId: string) {
  return transaction.execute<{ readonly body: JsonObject; readonly signedAt: string | null }>(
    sql`
      select p.body, s.body->>'signedAt' as "signedAt"
      from openerp.bank_signoff_plans p
      left join openerp.bank_reconciliation_signoffs s on (s.book_id, s.plan_id) = (p.book_id, p.id)
      where p.book_id = ${bookId}
      order by p.body->>'createdAt' desc, p.id collate "C"
      limit 200
    `,
    "objects",
  );
}

export function readInventory(transaction: Transaction, bookId: string, inventoryId: string) {
  return transaction.execute<InventoryRow>(
    sql`
      select id, period_id as "periodId", ordinal::text as ordinal, body
      from openerp.closing_inventories
      where book_id = ${bookId} and id = ${inventoryId}
    `,
    "objects",
  );
}

export function readInventorySuperseded(
  transaction: Transaction,
  bookId: string,
  periodId: string,
  ordinal: string,
) {
  return transaction.execute<{ readonly present: boolean }>(
    sql`
      select exists (
        select 1 from openerp.closing_inventories
        where book_id = ${bookId} and period_id = ${periodId} and ordinal > ${ordinal}::bigint
      ) as present
    `,
    "objects",
  );
}

export function readPeriod(transaction: Transaction, bookId: string, periodId: string) {
  return transaction.execute<PeriodRow>(
    sql`
      select id, version::text as version, starts_on::text as "startsOn", ends_on::text as "endsOn", locked
      from openerp.periods
      where book_id = ${bookId} and id = ${periodId}
      for share
    `,
    "objects",
  );
}

export function readInventorySignoffPlanCount(transaction: Transaction, bookId: string) {
  return transaction.execute<CountRow>(
    sql`
      select count(*)::integer as total
      from openerp.bank_inventory_signoff_plans
      where book_id = ${bookId}
    `,
    "objects",
  );
}

export function readSignedAccountIds(
  transaction: Transaction,
  bookId: string,
  planIds: ReadonlyArray<string>,
) {
  return transaction.execute<{ readonly accountId: string | null }>(
    sql`
      select p.body->>'accountId' as "accountId"
      from openerp.bank_signoff_plans p
      join openerp.bank_reconciliation_signoffs signed on (signed.book_id, signed.plan_id) = (p.book_id, p.id)
      where p.book_id = ${bookId} and p.id = any(${textArray(planIds)})
      order by p.body->>'accountId' collate "C"
    `,
    "objects",
  );
}

export function readSignedAccountMembers(
  transaction: Transaction,
  bookId: string,
  planIds: ReadonlyArray<string>,
) {
  return transaction.execute<SignedPlanRow>(
    sql`
      select p.id, p.body as plan, signed.body as signoff, signed.content, signed.sha256,
        signed.byte_length as "byteLength", c.body as coverage
      from openerp.bank_signoff_plans p
      join openerp.bank_reconciliation_signoffs signed
        on (signed.book_id, signed.plan_id) = (p.book_id, p.id)
      join openerp.bank_source_coverage_reports c on (c.book_id, c.id) = (p.book_id, p.coverage_report_id)
      where p.book_id = ${bookId} and p.id = any(${textArray(planIds)})
      order by p.body->>'accountId' collate "C"
    `,
    "objects",
  );
}

export function readUndeclaredBankSources(
  transaction: Transaction,
  bookId: string,
  accountIds: ReadonlyArray<string>,
) {
  return transaction.execute<{ readonly present: boolean }>(
    sql`
      select exists (
        select 1 from openerp.bank_sources
        where book_id = ${bookId} and not (account_id = any(${textArray(accountIds)}))
      ) as present
    `,
    "objects",
  );
}

export function insertInventorySignoffPlan(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly inventoryId: string;
    readonly body: JsonObject;
    readonly content: string;
    readonly sha256: string;
    readonly byteLength: number;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.bank_inventory_signoff_plans
        (book_id, id, inventory_id, body, content, sha256, byte_length)
      values (${row.bookId}, ${row.id}, ${row.inventoryId}, ${JSON.stringify(row.body)}::jsonb,
        ${row.content}, ${row.sha256}, ${row.byteLength})
    `,
    "objects",
  );
}

export function readInventorySignoffPlan(transaction: Transaction, bookId: string, planId: string) {
  return transaction.execute<InventorySignoffPlanRow>(
    sql`
      select id, inventory_id as "inventoryId", body, content, sha256, byte_length as "byteLength"
      from openerp.bank_inventory_signoff_plans
      where book_id = ${bookId} and id = ${planId}
    `,
    "objects",
  );
}

export function readInventorySignoff(transaction: Transaction, bookId: string, planId: string) {
  return transaction.execute<InventorySignoffRow>(
    sql`
      select plan_id as "planId", evidence_id as "evidenceId", body, content, sha256,
        byte_length as "byteLength"
      from openerp.bank_inventory_signoffs
      where book_id = ${bookId} and plan_id = ${planId}
    `,
    "objects",
  );
}

export function insertInventorySignoff(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly planId: string;
    readonly evidenceId: string;
    readonly body: JsonObject;
    readonly content: string;
    readonly sha256: string;
    readonly byteLength: number;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.bank_inventory_signoffs (book_id, plan_id, evidence_id, body, content, sha256, byte_length)
      values (${row.bookId}, ${row.planId}, ${row.evidenceId}, ${JSON.stringify(row.body)}::jsonb,
        ${row.content}, ${row.sha256}, ${row.byteLength})
    `,
    "objects",
  );
}

export function listInventorySignoffPlans(transaction: Transaction, bookId: string) {
  return transaction.execute<{
    readonly inventoryId: string;
    readonly body: JsonObject;
    readonly signedAt: string | null;
  }>(
    sql`
      select p.inventory_id as "inventoryId", p.body, s.body->>'signedAt' as "signedAt"
      from openerp.bank_inventory_signoff_plans p
      left join openerp.bank_inventory_signoffs s on (s.book_id, s.plan_id) = (p.book_id, p.id)
      where p.book_id = ${bookId}
      order by p.body->>'createdAt' desc, p.id collate "C"
      limit 200
    `,
    "objects",
  );
}
