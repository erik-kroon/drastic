import { sql } from "drizzle-orm";
import type { Transaction } from "../transaction";

// The three tables this owner adds, probed with the same privilege check the
// schedule owner uses. A role that cannot read or insert them refuses the
// whole owner rather than failing on the first write.
export const prepaymentTables = [
  "expense_cost_bases",
  "accrued_costs",
  "accrual_resolutions",
] as const;

const tableAccess = sql`
  select
    requested.table_name as "tableName",
    case when to_regclass('openerp.' || requested.table_name) is null then false
      else has_table_privilege(current_user, 'openerp.' || requested.table_name, 'select') end as "canSelect",
    case when to_regclass('openerp.' || requested.table_name) is null then false
      else has_table_privilege(current_user, 'openerp.' || requested.table_name, 'insert') end as "canInsert"
  from unnest(array[${sql.join(
    prepaymentTables.map((name) => sql`${name}`),
    sql`, `,
  )}]::text[]) as requested(table_name)
`;

export function readPrepaymentAccess(transaction: Transaction) {
  return transaction.execute<{ tableName: string; canSelect: boolean; canInsert: boolean }>(
    tableAccess,
    "objects",
  );
}

export type CostBasisRow = {
  readonly id: string;
  readonly purchaseRecognitionId: string;
  readonly scheduleId: string;
  readonly costMinor: string;
  readonly currency: string;
};

export type AccrualRow = {
  readonly id: string;
  readonly serviceIdentity: string;
  readonly expenseAccountId: string;
  readonly liabilityAccountId: string;
  readonly currency: string;
  readonly originalMinor: string;
  readonly evidenceId: string;
  readonly reviewedOn: string;
  readonly changeSetId: string;
};

export type ResolutionRow = {
  readonly id: string;
  readonly accrualId: string;
  readonly invoiceIdentity: string;
  readonly consumedMinor: string;
  readonly actualNetMinor: string;
  readonly deductibleTaxMinor: string;
  readonly trueUpMinor: string;
  readonly payableMinor: string;
  readonly changeSetId: string;
};

// The link between a purchase recognition and the schedule that defers it. A
// schedule already carrying a basis is refused by the unique key, and the
// owner checks first so the refusal is typed.
export function readCostBasisBySchedule(
  transaction: Transaction,
  bookId: string,
  scheduleId: string,
) {
  return transaction.execute<CostBasisRow>(
    sql`
      select id, purchase_recognition_id as "purchaseRecognitionId",
        schedule_id as "scheduleId", cost_minor as "costMinor", currency
      from openerp.expense_cost_bases
      where book_id = ${bookId} and schedule_id = ${scheduleId}
    `,
    "objects",
  );
}

export function insertCostBasis(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly purchaseRecognitionId: string;
    readonly scheduleId: string;
    readonly costMinor: string;
    readonly currency: string;
    readonly serviceStartsOn: string;
    readonly serviceEndsOnExclusive: string;
    readonly serviceEvidenceId: string;
    readonly reviewedCutoffOn: string;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.expense_cost_bases
        (book_id, id, purchase_recognition_id, schedule_id, cost_minor, currency,
          service_starts_on, service_ends_on_exclusive, service_evidence_id, reviewed_cutoff_on)
      values (${row.bookId}, ${row.id}, ${row.purchaseRecognitionId}, ${row.scheduleId},
        ${row.costMinor}, ${row.currency}, ${row.serviceStartsOn}::date,
        ${row.serviceEndsOnExclusive}::date, ${row.serviceEvidenceId}, ${row.reviewedCutoffOn}::date)
    `,
    "objects",
  );
}

export function readAccrual(transaction: Transaction, bookId: string, accrualId: string) {
  return transaction.execute<AccrualRow>(
    sql`
      select id, service_identity as "serviceIdentity",
        expense_account_id as "expenseAccountId",
        liability_account_id as "liabilityAccountId", currency,
        original_minor as "originalMinor", evidence_id as "evidenceId",
        to_char(reviewed_on, 'YYYY-MM-DD') as "reviewedOn",
        change_set_id as "changeSetId"
      from openerp.accrued_costs
      where book_id = ${bookId} and id = ${accrualId}
    `,
    "objects",
  );
}

export function readAccrualByService(
  transaction: Transaction,
  bookId: string,
  serviceIdentity: string,
) {
  return transaction.execute<AccrualRow>(
    sql`
      select id, service_identity as "serviceIdentity",
        expense_account_id as "expenseAccountId",
        liability_account_id as "liabilityAccountId", currency,
        original_minor as "originalMinor", evidence_id as "evidenceId",
        to_char(reviewed_on, 'YYYY-MM-DD') as "reviewedOn",
        change_set_id as "changeSetId"
      from openerp.accrued_costs
      where book_id = ${bookId} and service_identity = ${serviceIdentity}
    `,
    "objects",
  );
}

export function insertAccrual(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly serviceIdentity: string;
    readonly expenseAccountId: string;
    readonly liabilityAccountId: string;
    readonly currency: string;
    readonly originalMinor: string;
    readonly evidenceId: string;
    readonly reviewedOn: string;
    readonly changeSetId: string;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.accrued_costs
        (book_id, id, service_identity, expense_account_id, liability_account_id,
          currency, original_minor, evidence_id, reviewed_on, change_set_id)
      values (${row.bookId}, ${row.id}, ${row.serviceIdentity}, ${row.expenseAccountId},
        ${row.liabilityAccountId}, ${row.currency}, ${row.originalMinor}, ${row.evidenceId},
        ${row.reviewedOn}::date, ${row.changeSetId})
    `,
    "objects",
  );
}

export function readResolutions(transaction: Transaction, bookId: string, accrualId: string) {
  return transaction.execute<ResolutionRow>(
    sql`
      select id, accrual_id as "accrualId", invoice_identity as "invoiceIdentity",
        consumed_minor as "consumedMinor", actual_net_minor as "actualNetMinor",
        deductible_tax_minor as "deductibleTaxMinor", true_up_minor as "trueUpMinor",
        payable_minor as "payableMinor", change_set_id as "changeSetId"
      from openerp.accrual_resolutions
      where book_id = ${bookId} and accrual_id = ${accrualId}
      order by created_at, id
      limit 50
    `,
    "objects",
  );
}

// The remaining capacity is always the original less every effective
// resolution, read from the retained rows rather than carried on the accrual.
// That is what makes a second resolution of the same capacity impossible to
// miss.
export function readResolvedTotal(transaction: Transaction, bookId: string, accrualId: string) {
  return transaction.execute<{ readonly resolved: string }>(
    sql`
      select coalesce(sum(consumed_minor::numeric), 0)::text as resolved
      from openerp.accrual_resolutions
      where book_id = ${bookId} and accrual_id = ${accrualId}
    `,
    "objects",
  );
}

export function readResolutionByInvoice(
  transaction: Transaction,
  bookId: string,
  accrualId: string,
  invoiceIdentity: string,
) {
  return transaction.execute<ResolutionRow>(
    sql`
      select id, accrual_id as "accrualId", invoice_identity as "invoiceIdentity",
        consumed_minor as "consumedMinor", actual_net_minor as "actualNetMinor",
        deductible_tax_minor as "deductibleTaxMinor", true_up_minor as "trueUpMinor",
        payable_minor as "payableMinor", change_set_id as "changeSetId"
      from openerp.accrual_resolutions
      where book_id = ${bookId} and accrual_id = ${accrualId}
        and invoice_identity = ${invoiceIdentity}
    `,
    "objects",
  );
}

export function insertResolution(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly accrualId: string;
    readonly trueUpMinor: string;
    readonly consumedMinor: string;
    readonly actualNetMinor: string;
    readonly deductibleTaxMinor: string;
    readonly invoiceIdentity: string;
    readonly payableMinor: string;
    readonly changeSetId: string;
    readonly receiptId: string;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.accrual_resolutions
        (book_id, id, accrual_id, true_up_minor, consumed_minor, actual_net_minor,
          deductible_tax_minor, invoice_identity, payable_minor, change_set_id, receipt_id)
      values (${row.bookId}, ${row.id}, ${row.accrualId}, ${row.trueUpMinor}, ${row.consumedMinor},
        ${row.actualNetMinor}, ${row.deductibleTaxMinor}, ${row.invoiceIdentity},
        ${row.payableMinor}, ${row.changeSetId}, ${row.receiptId})
    `,
    "objects",
  );
}
