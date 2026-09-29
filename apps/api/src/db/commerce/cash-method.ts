import { sql } from "drizzle-orm";
import type * as Schema from "effect/Schema";
import type { Transaction } from "../transaction";

type JsonObject = Schema.JsonObject;

// The retained recognition. The commercial gross is the invoice's own amount
// and the net/tax split comes from the recognition voucher's retained journal
// lines, not from anything a caller states.
export type InvoiceBasisRow = {
  readonly invoiceId: string;
  readonly direction: string;
  readonly amountMinor: string;
  readonly voucherId: string;
  readonly recognitionLineId: string;
  readonly controlAccountId: string;
  readonly body: JsonObject;
  readonly bookCurrency: string;
  readonly bookScale: number;
};

export type RecognitionComponentRow = {
  readonly id: string;
  readonly accountId: string;
  readonly description: string;
  readonly debitMinor: string;
  readonly creditMinor: string;
};

export type CashMethodLineRow = {
  readonly id: string;
  readonly invoiceId: string;
  readonly sourceLineId: string;
  readonly direction: string;
  readonly currency: string;
  readonly originalGrossMinor: string;
  readonly creditedGrossMinor: string;
  readonly paidGrossMinor: string;
  readonly recognizedGrossMinor: string;
  readonly componentPolicy: string;
  readonly rounding: string;
  readonly profileWitness: string;
  readonly version: string;
};

export type RecognitionRow = {
  readonly id: string;
  readonly lineId: string;
  readonly triggerKind: string;
  readonly triggerRef: string;
  readonly recognizedGrossMinor: string;
  readonly recognizedGrossAfterMinor: string;
  readonly paidGrossAfterMinor: string;
};

export type YearEndRunRow = {
  readonly id: string;
  readonly accountingPeriodId: string;
  readonly cutoffOn: string;
  readonly recognizedLineCount: number;
  readonly recognizedGrossMinor: string;
  readonly runKey: string;
};

// The three tables this owner adds, probed with the same privilege check the
// commerce owners use. A role that cannot reach them refuses at the gate.
export const cashMethodTables = [
  "cash_method_lines",
  "cash_method_recognitions",
  "cash_method_year_end_runs",
] as const;

const tableAccess = sql`
  select
    requested.table_name as "tableName",
    case when to_regclass('openerp.' || requested.table_name) is null then false
      else has_table_privilege(current_user, 'openerp.' || requested.table_name, 'select') end as "canSelect",
    case when to_regclass('openerp.' || requested.table_name) is null then false
      else has_table_privilege(current_user, 'openerp.' || requested.table_name, 'insert') end as "canInsert",
    -- Only the line is ever updated, and only on its own pointer columns, so
    -- the update grant is a column grant and must be probed as one. A
    -- table-level check would read false for a correctly scoped role.
    case when requested.table_name <> 'cash_method_lines' then true
      else to_regclass('openerp.cash_method_lines') is not null
        and has_column_privilege(current_user, 'openerp.cash_method_lines',
          'paid_gross_minor', 'update')
        and has_column_privilege(current_user, 'openerp.cash_method_lines',
          'recognized_gross_minor', 'update')
        and has_column_privilege(current_user, 'openerp.cash_method_lines',
          'version', 'update') end as "canUpdate"
  from unnest(array[${sql.join(
    cashMethodTables.map((name) => sql`${name}`),
    sql`, `,
  )}]::text[]) as requested(table_name)
`;

export function readCashMethodAccess(transaction: Transaction) {
  return transaction.execute<{
    tableName: string;
    canSelect: boolean;
    canInsert: boolean;
    canUpdate: boolean;
  }>(tableAccess, "objects");
}

export function readInvoiceBasis(transaction: Transaction, bookId: string, invoiceId: string) {
  return transaction.execute<InvoiceBasisRow>(
    sql`
      select i.id as "invoiceId", i.direction, i.amount_minor::text as "amountMinor",
        i.recognition_voucher_id as "voucherId", i.recognition_line_id as "recognitionLineId",
        i.control_account_id as "controlAccountId", r.body,
        bk.currency as "bookCurrency", bk.currency_scale as "bookScale"
      from openerp.commerce_invoices i
      join openerp.books bk on bk.id = i.book_id
      left join openerp.commerce_invoice_revisions r
        on r.book_id = i.book_id and r.invoice_id = i.id and r.revision = i.current_revision
      where i.book_id = ${bookId} and i.id = ${invoiceId}
    `,
    "objects",
  );
}

// The net and tax components of the recognition, read from the retained
// journal lines. The expense or revenue side is the recognition's own line;
// the tax side is the tax line beside it. Nothing is inferred from the gross.
export function readRecognitionComponents(
  transaction: Transaction,
  bookId: string,
  voucherId: string,
) {
  return transaction.execute<RecognitionComponentRow>(
    sql`
      select l.id, l.account_id as "accountId", l.description,
        l.debit_minor::text as "debitMinor", l.credit_minor::text as "creditMinor"
      from openerp.journal_lines l
      where l.book_id = ${bookId} and l.voucher_id = ${voucherId}
      order by l.id
    `,
    "objects",
  );
}

export function readLine(transaction: Transaction, bookId: string, lineId: string) {
  return transaction.execute<CashMethodLineRow>(
    sql`
      select id, invoice_id as "invoiceId", source_line_id as "sourceLineId", direction, currency,
        original_gross_minor as "originalGrossMinor", credited_gross_minor as "creditedGrossMinor",
        paid_gross_minor as "paidGrossMinor", recognized_gross_minor as "recognizedGrossMinor",
        component_policy as "componentPolicy", rounding, profile_witness as "profileWitness",
        version::text as version
      from openerp.cash_method_lines
      where book_id = ${bookId} and id = ${lineId}
    `,
    "objects",
  );
}

export function readLineForUpdate(transaction: Transaction, bookId: string, lineId: string) {
  return transaction.execute<CashMethodLineRow>(
    sql`
      select id, invoice_id as "invoiceId", source_line_id as "sourceLineId", direction, currency,
        original_gross_minor as "originalGrossMinor", credited_gross_minor as "creditedGrossMinor",
        paid_gross_minor as "paidGrossMinor", recognized_gross_minor as "recognizedGrossMinor",
        component_policy as "componentPolicy", rounding, profile_witness as "profileWitness",
        version::text as version
      from openerp.cash_method_lines
      where book_id = ${bookId} and id = ${lineId}
      for update
    `,
    "objects",
  );
}

export function readLineBySource(
  transaction: Transaction,
  bookId: string,
  invoiceId: string,
  sourceLineId: string,
) {
  return transaction.execute<CashMethodLineRow>(
    sql`
      select id, invoice_id as "invoiceId", source_line_id as "sourceLineId", direction, currency,
        original_gross_minor as "originalGrossMinor", credited_gross_minor as "creditedGrossMinor",
        paid_gross_minor as "paidGrossMinor", recognized_gross_minor as "recognizedGrossMinor",
        component_policy as "componentPolicy", rounding, profile_witness as "profileWitness",
        version::text as version
      from openerp.cash_method_lines
      where book_id = ${bookId} and invoice_id = ${invoiceId} and source_line_id = ${sourceLineId}
    `,
    "objects",
  );
}

export function insertLine(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly invoiceId: string;
    readonly sourceLineId: string;
    readonly direction: string;
    readonly currency: string;
    readonly originalGrossMinor: string;
    readonly creditedGrossMinor: string;
    readonly componentPolicy: string;
    readonly rounding: string;
    readonly profileWitness: string;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.cash_method_lines
        (book_id, id, invoice_id, source_line_id, direction, currency, original_gross_minor,
          credited_gross_minor, component_policy, rounding, profile_witness)
      values (${row.bookId}, ${row.id}, ${row.invoiceId}, ${row.sourceLineId}, ${row.direction},
        ${row.currency}, ${row.originalGrossMinor}, ${row.creditedGrossMinor},
        ${row.componentPolicy}, ${row.rounding}, ${row.profileWitness})
    `,
    "objects",
  );
}

// The line advances exactly one version under the version the writer observed.
// A concurrent recognition updates nothing and the caller refuses.
export function advanceLine(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly lineId: string;
    readonly expectedVersion: string;
    readonly paidGrossMinor: string;
    readonly recognizedGrossMinor: string;
  },
) {
  return transaction.execute(
    sql`
      update openerp.cash_method_lines
      set paid_gross_minor = ${row.paidGrossMinor},
        recognized_gross_minor = ${row.recognizedGrossMinor},
        version = (${row.expectedVersion}::bigint + 1)
      where book_id = ${row.bookId} and id = ${row.lineId}
        and version = ${row.expectedVersion}::bigint
      returning 1::text as moved
    `,
    "objects",
  );
}

export function readRecognition(
  transaction: Transaction,
  bookId: string,
  lineId: string,
  triggerKind: string,
  triggerRef: string,
) {
  return transaction.execute<RecognitionRow>(
    sql`
      select id, line_id as "lineId", trigger_kind as "triggerKind", trigger_ref as "triggerRef",
        recognized_gross_minor as "recognizedGrossMinor",
        recognized_gross_after_minor as "recognizedGrossAfterMinor",
        paid_gross_after_minor as "paidGrossAfterMinor"
      from openerp.cash_method_recognitions
      where book_id = ${bookId} and line_id = ${lineId}
        and trigger_kind = ${triggerKind} and trigger_ref = ${triggerRef}
    `,
    "objects",
  );
}

export function readRecognitions(transaction: Transaction, bookId: string, lineId: string) {
  return transaction.execute<RecognitionRow>(
    sql`
      select id, line_id as "lineId", trigger_kind as "triggerKind", trigger_ref as "triggerRef",
        recognized_gross_minor as "recognizedGrossMinor",
        recognized_gross_after_minor as "recognizedGrossAfterMinor",
        paid_gross_after_minor as "paidGrossAfterMinor"
      from openerp.cash_method_recognitions
      where book_id = ${bookId} and line_id = ${lineId}
      order by recorded_at, id
      limit 200
    `,
    "objects",
  );
}

export function insertRecognition(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly lineId: string;
    readonly triggerKind: string;
    readonly triggerRef: string;
    readonly recognizedGrossMinor: string;
    readonly recognizedGrossAfterMinor: string;
    readonly paidGrossAfterMinor: string;
    readonly netMinor: string;
    readonly taxMinor: string;
    readonly deductibleMinor: string;
    readonly evidenceId: string;
    readonly changeSetId: string;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.cash_method_recognitions
        (book_id, id, line_id, trigger_kind, trigger_ref, recognized_gross_minor,
          recognized_gross_after_minor, paid_gross_after_minor, net_minor, tax_minor,
          deductible_minor, evidence_id, change_set_id)
      values (${row.bookId}, ${row.id}, ${row.lineId}, ${row.triggerKind}, ${row.triggerRef},
        ${row.recognizedGrossMinor}, ${row.recognizedGrossAfterMinor}, ${row.paidGrossAfterMinor},
        ${row.netMinor}, ${row.taxMinor}, ${row.deductibleMinor}, ${row.evidenceId},
        ${row.changeSetId})
    `,
    "objects",
  );
}

// The unpaid population a year-end run would recognize: a line that has been
// registered, is not fully paid, and has not already been recognized unpaid by
// an earlier run over any period.
export function readUnpaidPopulation(transaction: Transaction, bookId: string) {
  return transaction.execute<CashMethodLineRow>(
    sql`
      select l.id, l.invoice_id as "invoiceId", l.source_line_id as "sourceLineId", l.direction,
        l.currency, l.original_gross_minor as "originalGrossMinor",
        l.credited_gross_minor as "creditedGrossMinor", l.paid_gross_minor as "paidGrossMinor",
        l.recognized_gross_minor as "recognizedGrossMinor", l.component_policy as "componentPolicy",
        l.rounding, l.profile_witness as "profileWitness", l.version::text as version
      from openerp.cash_method_lines l
      where l.book_id = ${bookId}
        and l.recognized_gross_minor::numeric
          < l.original_gross_minor::numeric - l.credited_gross_minor::numeric
        and not exists (
          select 1 from openerp.cash_method_recognitions r
          where r.book_id = l.book_id and r.line_id = l.id
            and r.trigger_kind = 'year_end_unpaid'::text
        )
      order by l.id
      limit 500
    `,
    "objects",
  );
}

export function readYearEndRunByPeriod(
  transaction: Transaction,
  bookId: string,
  accountingPeriodId: string,
) {
  return transaction.execute<YearEndRunRow>(
    sql`
      select id, accounting_period_id as "accountingPeriodId",
        cutoff_on::text as "cutoffOn", recognized_line_count as "recognizedLineCount",
        recognized_gross_minor as "recognizedGrossMinor", run_key as "runKey"
      from openerp.cash_method_year_end_runs
      where book_id = ${bookId} and accounting_period_id = ${accountingPeriodId}
    `,
    "objects",
  );
}

export function insertYearEndRun(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly accountingPeriodId: string;
    readonly cutoffOn: string;
    readonly rationale: string;
    readonly evidenceId: string;
    readonly recognizedLineCount: number;
    readonly recognizedGrossMinor: string;
    readonly runKey: string;
    readonly actorId: string;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.cash_method_year_end_runs
        (book_id, id, accounting_period_id, cutoff_on, rationale, evidence_id,
          recognized_line_count, recognized_gross_minor, run_key, created_by)
      values (${row.bookId}, ${row.id}, ${row.accountingPeriodId}, ${row.cutoffOn}::date,
        ${row.rationale}, ${row.evidenceId}, ${row.recognizedLineCount},
        ${row.recognizedGrossMinor}, ${row.runKey}, ${row.actorId})
    `,
    "objects",
  );
}
