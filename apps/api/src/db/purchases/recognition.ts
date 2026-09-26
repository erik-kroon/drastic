import { sql } from "drizzle-orm";
import type * as Schema from "effect/Schema";
import { textArray } from "../sql-values";
import type { Transaction } from "../transaction";

type JsonObject = Schema.JsonObject;

export const recognitionTables = [
  "purchase_recognitions",
  "purchase_tax_facts",
  "purchase_line_capacities",
] as const;

export type RecognitionRow = {
  readonly id: string;
  readonly economicKey: string;
  readonly draftId: string;
  readonly draftRevision: string;
  readonly counterpartyId: string;
  readonly documentNumber: string;
  readonly voucherId: string;
  readonly payableId: string;
  readonly changeSetId: string;
  readonly approvalId: string;
  readonly recognitionDate: string;
  readonly taxPointOn: string;
  readonly grossMinor: string;
  readonly deductibleTaxMinor: string;
  readonly body: JsonObject;
  readonly digest: string;
};

export type TaxFactRow = {
  readonly id: string;
  readonly recognitionId: string;
  readonly sourceLineId: string;
  readonly componentRole: string;
  readonly taxComponentId: string;
  readonly voucherId: string;
  readonly signedBaseMinor: string;
  readonly signedDeductibleTaxMinor: string;
  readonly taxPointOn: string;
  readonly adjustsTaxFactId: string | null;
  readonly body: JsonObject;
};

export type CapacityRow = {
  readonly recognitionId: string;
  readonly sourceLineId: string;
  readonly expenseAccountId: string;
  readonly inputVatAccountId: string | null;
  readonly originalNetMinor: string;
  readonly originalSourceTaxMinor: string;
  readonly originalDeductibleTaxMinor: string;
  readonly creditedNetMinor: string;
  readonly creditedSourceTaxMinor: string;
  readonly releasedDeductionMinor: string;
  readonly version: string;
  readonly body: JsonObject;
  readonly updatedAt: string;
};

export type CreditCapacityEffect = {
  readonly sourceLineId: string;
  readonly creditedNetMinor: string;
  readonly creditedSourceTaxMinor: string;
  readonly releasedDeductionMinor: string;
  readonly version: string;
};

const recognitionColumns = sql`
  id, economic_key as "economicKey", draft_id as "draftId", draft_revision::text as "draftRevision",
  counterparty_id as "counterpartyId", document_number as "documentNumber", voucher_id as "voucherId",
  payable_id as "payableId", change_set_id as "changeSetId", approval_id as "approvalId",
  recognition_date::text as "recognitionDate", tax_point_on::text as "taxPointOn",
  gross_minor::text as "grossMinor", deductible_tax_minor::text as "deductibleTaxMinor",
  body, digest
`;

const taxFactColumns = sql`
  id, recognition_id as "recognitionId", source_line_id as "sourceLineId",
  component_role as "componentRole", tax_component_id as "taxComponentId", voucher_id as "voucherId",
  signed_base_minor::text as "signedBaseMinor",
  signed_deductible_tax_minor::text as "signedDeductibleTaxMinor",
  tax_point_on::text as "taxPointOn", adjusts_tax_fact_id as "adjustsTaxFactId", body
`;

const capacityColumns = sql`
  recognition_id as "recognitionId", source_line_id as "sourceLineId",
  expense_account_id as "expenseAccountId", input_vat_account_id as "inputVatAccountId",
  original_net_minor::text as "originalNetMinor",
  original_source_tax_minor::text as "originalSourceTaxMinor",
  original_deductible_tax_minor::text as "originalDeductibleTaxMinor",
  credited_net_minor::text as "creditedNetMinor",
  credited_source_tax_minor::text as "creditedSourceTaxMinor",
  released_deduction_minor::text as "releasedDeductionMinor", version::text as version,
  body, updated_at::text as "updatedAt"
`;

export function readRecognition(tx: Transaction, bookId: string, recognitionId: string) {
  return tx.execute<RecognitionRow>(
    sql`select ${recognitionColumns} from openerp.purchase_recognitions
      where book_id = ${bookId} and id = ${recognitionId}`,
    "objects",
  );
}

// One reviewed supplier identity recognizes one purchase. A revised document is
// not automatically another purchase, so the key refuses a second recognition.
export function readRecognitionByEconomicKey(tx: Transaction, bookId: string, economicKey: string) {
  return tx.execute<RecognitionRow>(
    sql`select ${recognitionColumns} from openerp.purchase_recognitions
      where book_id = ${bookId} and economic_key = ${economicKey}`,
    "objects",
  );
}

export function readRecognitionByDraft(tx: Transaction, bookId: string, draftId: string) {
  return tx.execute<RecognitionRow>(
    sql`select ${recognitionColumns} from openerp.purchase_recognitions
      where book_id = ${bookId} and draft_id = ${draftId}`,
    "objects",
  );
}

export function readRecognitionByPayable(tx: Transaction, bookId: string, payableId: string) {
  return tx.execute<RecognitionRow>(
    sql`select ${recognitionColumns} from openerp.purchase_recognitions
      where book_id = ${bookId} and payable_id = ${payableId}
        and event_owner = 'supplier_purchase'`,
    "objects",
  );
}

export function readCounterpartyDocumentRecognition(
  tx: Transaction,
  bookId: string,
  counterpartyId: string,
  documentNumber: string,
) {
  return tx.execute<{ readonly present: boolean }>(
    sql`select exists (
        select 1 from openerp.purchase_recognitions
        where book_id = ${bookId} and counterparty_id = ${counterpartyId}
          and document_number = ${documentNumber}
      ) as present`,
    "objects",
  );
}

export function insertRecognition(
  tx: Transaction,
  bookId: string,
  row: {
    readonly eventOwner: "supplier_purchase" | "supplier_credit";
    readonly id: string;
    readonly economicKey: string;
    readonly originalRecognitionId: string | null;
    readonly draftId: string | null;
    readonly draftRevision: string | null;
    readonly counterpartyId: string;
    readonly documentNumber: string;
    readonly voucherId: string;
    readonly payableId: string;
    readonly changeSetId: string;
    readonly approvalId: string;
    readonly recognitionDate: string;
    readonly taxPointOn: string;
    readonly grossMinor: string;
    readonly deductibleTaxMinor: string;
    readonly body: JsonObject;
    readonly digest: string;
    readonly recordedAt: string;
  },
) {
  return tx.execute(
    sql`insert into openerp.purchase_recognitions
      (book_id,id,economic_key,event_owner,original_recognition_id,draft_id,draft_revision,
        counterparty_id,document_number,voucher_id,payable_id,change_set_id,approval_id,
        recognition_date,tax_point_on,gross_minor,deductible_tax_minor,body,digest,recorded_at)
      values(${bookId},${row.id},${row.economicKey},${row.eventOwner},${row.originalRecognitionId},
        ${row.draftId},${row.draftRevision}::bigint,${row.counterpartyId},${row.documentNumber},${row.voucherId},
        ${row.payableId},${row.changeSetId},${row.approvalId},${row.recognitionDate}::date,
        ${row.taxPointOn}::date,${row.grossMinor}::numeric,${row.deductibleTaxMinor}::numeric,
        ${JSON.stringify(row.body)}::jsonb,${row.digest},${row.recordedAt}::timestamptz)`,
    "objects",
  );
}

export function readTaxFacts(tx: Transaction, bookId: string, recognitionId: string) {
  return tx.execute<TaxFactRow>(
    sql`select ${taxFactColumns} from openerp.purchase_tax_facts
      where book_id = ${bookId} and recognition_id = ${recognitionId}
      order by tax_point_on, source_line_id, component_role`,
    "objects",
  );
}

export function readAdjustmentTaxFacts(tx: Transaction, bookId: string, recognitionId: string) {
  return tx.execute<TaxFactRow>(
    sql`select a.id, a.recognition_id as "recognitionId", a.source_line_id as "sourceLineId",
        a.component_role as "componentRole", a.tax_component_id as "taxComponentId",
        a.voucher_id as "voucherId", a.signed_base_minor::text as "signedBaseMinor",
        a.signed_deductible_tax_minor::text as "signedDeductibleTaxMinor",
        a.tax_point_on::text as "taxPointOn", a.adjusts_tax_fact_id as "adjustsTaxFactId", a.body
      from openerp.purchase_tax_facts a
      join openerp.purchase_tax_facts original
        on original.book_id = a.book_id and original.id = a.adjusts_tax_fact_id
      where a.book_id = ${bookId} and original.recognition_id = ${recognitionId}
      order by a.tax_point_on, a.source_line_id, a.component_role`,
    "objects",
  );
}

// An owned recognition already published components for this voucher. An
// independent tax-fact admission over the same voucher would be a second
// recognition of one economic event, so its owner reads this and refuses.
export function readRecognizedVoucher(tx: Transaction, bookId: string, voucherId: string) {
  return tx.execute<{ readonly present: boolean }>(
    sql`select exists (
        select 1 from openerp.purchase_recognitions
        where book_id = ${bookId} and voucher_id = ${voucherId}
      ) as present`,
    "objects",
  );
}

export function insertTaxFact(
  tx: Transaction,
  bookId: string,
  row: {
    readonly id: string;
    readonly recognitionId: string;
    readonly sourceLineId: string;
    readonly componentRole: string;
    readonly taxComponentId: string;
    readonly voucherId: string;
    readonly signedBaseMinor: string;
    readonly signedOutputTaxMinor: string;
    readonly signedDeductibleTaxMinor: string;
    readonly sourceTaxMinor: string;
    readonly nonDeductibleTaxMinor: string;
    readonly taxPointOn: string;
    readonly adjustsTaxFactId: string | null;
    readonly body: JsonObject;
    readonly digest: string;
    readonly recordedAt: string;
  },
) {
  return tx.execute(
    sql`insert into openerp.purchase_tax_facts
      (book_id,id,recognition_id,source_line_id,component_role,tax_component_id,voucher_id,
        signed_base_minor,signed_output_tax_minor,signed_deductible_tax_minor,source_tax_minor,
        non_deductible_tax_minor,tax_point_on,adjusts_tax_fact_id,body,digest,recorded_at)
      values(${bookId},${row.id},${row.recognitionId},${row.sourceLineId},${row.componentRole},
        ${row.taxComponentId},${row.voucherId},${row.signedBaseMinor}::numeric,
        ${row.signedOutputTaxMinor}::numeric,${row.signedDeductibleTaxMinor}::numeric,
        ${row.sourceTaxMinor}::numeric,${row.nonDeductibleTaxMinor}::numeric,${row.taxPointOn}::date,
        ${row.adjustsTaxFactId},${JSON.stringify(row.body)}::jsonb,${row.digest},
        ${row.recordedAt}::timestamptz)`,
    "objects",
  );
}

export function readCapacities(tx: Transaction, bookId: string, recognitionId: string) {
  return tx.execute<CapacityRow>(
    sql`select ${capacityColumns} from openerp.purchase_line_capacities
      where book_id = ${bookId} and recognition_id = ${recognitionId}
      order by source_line_id collate "C"`,
    "objects",
  );
}

// Domain capacity rows are locked in stable source-line order before a credit
// consumes them. Every competing writer follows the same book and line order.
export function lockCapacities(
  tx: Transaction,
  bookId: string,
  recognitionId: string,
  sourceLineIds: ReadonlyArray<string>,
) {
  return tx.execute<CapacityRow>(
    sql`select ${capacityColumns} from openerp.purchase_line_capacities
      where book_id = ${bookId} and recognition_id = ${recognitionId}
        and source_line_id = any(${textArray([...sourceLineIds])})
      order by source_line_id collate "C"
      for update`,
    "objects",
  );
}

export function insertCapacity(
  tx: Transaction,
  bookId: string,
  row: {
    readonly recognitionId: string;
    readonly sourceLineId: string;
    readonly expenseAccountId: string;
    readonly inputVatAccountId: string | null;
    readonly originalNetMinor: string;
    readonly originalSourceTaxMinor: string;
    readonly originalDeductibleTaxMinor: string;
    readonly body: JsonObject;
    readonly updatedAt: string;
  },
) {
  return tx.execute(
    sql`insert into openerp.purchase_line_capacities
      (book_id,recognition_id,source_line_id,expense_account_id,input_vat_account_id,
        original_net_minor,original_source_tax_minor,original_deductible_tax_minor,body,updated_at)
      values(${bookId},${row.recognitionId},${row.sourceLineId},${row.expenseAccountId},
        ${row.inputVatAccountId},${row.originalNetMinor}::numeric,${row.originalSourceTaxMinor}::numeric,
        ${row.originalDeductibleTaxMinor}::numeric,${JSON.stringify(row.body)}::jsonb,
        ${row.updatedAt}::timestamptz)`,
    "objects",
  );
}

// Consumption is an exact versioned update. A zero-row update means another
// writer moved the capacity, and the caller refuses instead of overwriting it.
export function consumeCapacity(
  tx: Transaction,
  bookId: string,
  recognitionId: string,
  effect: CreditCapacityEffect,
  body: JsonObject,
  updatedAt: string,
) {
  return tx.execute<{ readonly version: string }>(
    sql`update openerp.purchase_line_capacities
      set credited_net_minor = credited_net_minor + ${effect.creditedNetMinor}::numeric,
        credited_source_tax_minor = credited_source_tax_minor + ${effect.creditedSourceTaxMinor}::numeric,
        released_deduction_minor = released_deduction_minor + ${effect.releasedDeductionMinor}::numeric,
        version = version + 1, body = ${JSON.stringify(body)}::jsonb, updated_at = ${updatedAt}::timestamptz
      where book_id = ${bookId} and recognition_id = ${recognitionId}
        and source_line_id = ${effect.sourceLineId} and version = ${effect.version}::bigint
      returning version::text as version`,
    "objects",
  );
}
