import { Capabilities } from "@open-erp/contracts/capabilities";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { query, scopeParameter, type DatabaseOperation } from "./database";

function bindCapability<I, O extends Schema.Json>(
  definition: {
    readonly input: Schema.Decoder<I>;
    readonly output: Schema.Decoder<O>;
    readonly description: string;
    readonly readOnly: boolean;
  },
  operation: DatabaseOperation,
  parameters: (input: I) => Array<string>,
) {
  const execute = (token: string, input: I) =>
    query(operation, [token, ...parameters(input)], definition.output);
  return {
    ...definition,
    execute,
    invoke: (token: string, input: Schema.Json) =>
      Schema.decodeEffect(definition.input)(input, { onExcessProperty: "error" }).pipe(
        Effect.flatMap((decoded) => execute(token, decoded)),
      ),
  };
}

export const capabilities = {
  schedules_create: bindCapability(Capabilities.schedules_create, "createSchedule", (input) => [
    scopeParameter(input.scope),
    input.idempotencyKey,
    JSON.stringify(input.input),
  ]),
  schedules_list: bindCapability(Capabilities.schedules_list, "listSchedules", (input) => [
    scopeParameter(input.scope),
    input.after ?? "",
  ]),
  schedules_get: bindCapability(Capabilities.schedules_get, "getSchedule", (input) => [
    scopeParameter(input.scope),
    input.scheduleId,
  ]),
  schedules_revise: bindCapability(Capabilities.schedules_revise, "reviseSchedule", (input) => [
    scopeParameter(input.scope),
    input.scheduleId,
    input.idempotencyKey,
    JSON.stringify(input.input),
  ]),
  schedules_prepare: bindCapability(
    Capabilities.schedules_prepare,
    "prepareScheduleOccurrence",
    (input) => [
      scopeParameter(input.scope),
      input.scheduleId,
      input.idempotencyKey,
      JSON.stringify(input.input),
    ],
  ),
  periods_closing_readiness: bindCapability(
    Capabilities.periods_closing_readiness,
    "closingReadiness",
    (input) => [scopeParameter(input.scope), input.periodId],
  ),
  periods_prepare_closing: bindCapability(
    Capabilities.periods_prepare_closing,
    "prepareClosing",
    (input) => [
      scopeParameter(input.scope),
      input.periodId,
      input.idempotencyKey,
      JSON.stringify(input.input),
    ],
  ),
  periods_get_closing_proposal: bindCapability(
    Capabilities.periods_get_closing_proposal,
    "getClosingProposal",
    (input) => [scopeParameter(input.scope), input.proposalId],
  ),
  periods_execute_closing: bindCapability(
    Capabilities.periods_execute_closing,
    "executeClosing",
    (input) => [
      scopeParameter(input.scope),
      input.proposalId,
      input.idempotencyKey,
      JSON.stringify(input.input),
    ],
  ),
  periods_closing_history: bindCapability(
    Capabilities.periods_closing_history,
    "closingHistory",
    (input) => [scopeParameter(input.scope), input.periodId, input.after ?? ""],
  ),
  periods_get_closing_certificate: bindCapability(
    Capabilities.periods_get_closing_certificate,
    "getClosingCertificate",
    (input) => [scopeParameter(input.scope), input.certificateId],
  ),

  commerce_create_counterparty: bindCapability(
    Capabilities.commerce_create_counterparty,
    "commerceCreateCounterparty",
    (input) => [scopeParameter(input.scope), input.idempotencyKey, JSON.stringify(input.input)],
  ),
  commerce_revise_counterparty: bindCapability(
    Capabilities.commerce_revise_counterparty,
    "commerceReviseCounterparty",
    (input) => [
      scopeParameter(input.scope),
      input.id,
      input.idempotencyKey,
      JSON.stringify(input.input),
    ],
  ),
  commerce_get_counterparty: bindCapability(
    Capabilities.commerce_get_counterparty,
    "commerceGetCounterparty",
    (input) => [scopeParameter(input.scope), input.id, input.revision ?? ""],
  ),
  commerce_list_counterparties: bindCapability(
    Capabilities.commerce_list_counterparties,
    "commerceListCounterparties",
    (input) => [scopeParameter(input.scope), input.after ?? ""],
  ),
  commerce_create_invoice: bindCapability(
    Capabilities.commerce_create_invoice,
    "commerceCreateInvoice",
    (input) => [scopeParameter(input.scope), input.idempotencyKey, JSON.stringify(input.input)],
  ),
  commerce_revise_invoice: bindCapability(
    Capabilities.commerce_revise_invoice,
    "commerceReviseInvoice",
    (input) => [
      scopeParameter(input.scope),
      input.id,
      input.idempotencyKey,
      JSON.stringify(input.input),
    ],
  ),
  commerce_get_invoice: bindCapability(
    Capabilities.commerce_get_invoice,
    "commerceGetInvoice",
    (input) => [scopeParameter(input.scope), input.id],
  ),
  commerce_invoice_history: bindCapability(
    Capabilities.commerce_invoice_history,
    "commerceInvoiceHistory",
    (input) => [scopeParameter(input.scope), input.id, input.after ?? ""],
  ),
  commerce_list_invoices: bindCapability(
    Capabilities.commerce_list_invoices,
    "commerceListInvoices",
    (input) => [scopeParameter(input.scope), input.after ?? ""],
  ),
  commerce_get_payment_capacity: bindCapability(
    Capabilities.commerce_get_payment_capacity,
    "commerceGetPaymentCapacity",
    (input) => [scopeParameter(input.scope), input.voucherId, input.lineId],
  ),
  commerce_prepare_allocation: bindCapability(
    Capabilities.commerce_prepare_allocation,
    "commercePrepareAllocation",
    (input) => [scopeParameter(input.scope), input.idempotencyKey, JSON.stringify(input.input)],
  ),
  commerce_get_allocation: bindCapability(
    Capabilities.commerce_get_allocation,
    "commerceGetAllocation",
    (input) => [scopeParameter(input.scope), input.id],
  ),
  commerce_apply_allocation: bindCapability(
    Capabilities.commerce_apply_allocation,
    "commerceApplyAllocation",
    (input) => [
      scopeParameter(input.scope),
      input.id,
      input.idempotencyKey,
      JSON.stringify(input.input),
    ],
  ),

  bank_prepare_allocation: bindCapability(
    Capabilities.bank_prepare_allocation,
    "prepareBankAllocation",
    (input) => [scopeParameter(input.scope), input.idempotencyKey, JSON.stringify(input.input)],
  ),
  bank_get_allocation: bindCapability(
    Capabilities.bank_get_allocation,
    "getBankAllocation",
    (input) => [scopeParameter(input.scope), input.planId],
  ),
  bank_execute_allocation: bindCapability(
    Capabilities.bank_execute_allocation,
    "executeBankAllocation",
    (input) => [
      scopeParameter(input.scope),
      input.idempotencyKey,
      input.planId,
      JSON.stringify(input.input),
    ],
  ),
  bank_reconcile_capacity: bindCapability(
    Capabilities.bank_reconcile_capacity,
    "reconcileBankCapacity",
    (input) => [scopeParameter(input.scope), input.idempotencyKey, JSON.stringify(input.input)],
  ),
  bank_get_capacity_reconciliation: bindCapability(
    Capabilities.bank_get_capacity_reconciliation,
    "getBankCapacityReconciliation",
    (input) => [scopeParameter(input.scope), input.reconciliationId],
  ),
  corrections_prepare: bindCapability(
    Capabilities.corrections_prepare,
    "prepareCorrectionBundle",
    (input) => [
      scopeParameter(input.scope),
      input.voucherId,
      input.idempotencyKey,
      JSON.stringify(input.input),
    ],
  ),
  corrections_get: bindCapability(Capabilities.corrections_get, "getCorrectionBundle", (input) => [
    scopeParameter(input.scope),
    input.bundleId,
  ]),
  corrections_for_voucher: bindCapability(
    Capabilities.corrections_for_voucher,
    "getCorrectionBundleForVoucher",
    (input) => [scopeParameter(input.scope), input.voucherId],
  ),
  corrections_execute: bindCapability(
    Capabilities.corrections_execute,
    "executeCorrectionBundle",
    (input) => [
      scopeParameter(input.scope),
      input.bundleId,
      input.idempotencyKey,
      JSON.stringify(input.input),
    ],
  ),
  posting_list_recovery: bindCapability(
    Capabilities.posting_list_recovery,
    "listPostingRecovery",
    (input) => [scopeParameter(input.scope), input.after ?? ""],
  ),
  posting_get_recovery: bindCapability(
    Capabilities.posting_get_recovery,
    "getPostingRecovery",
    (input) => [scopeParameter(input.scope), input.changeSetId, input.after ?? ""],
  ),
  posting_recover_request: bindCapability(
    Capabilities.posting_recover_request,
    "recoverPostingRequest",
    (input) => [scopeParameter(input.scope), input.key],
  ),
  rules_propose: bindCapability(Capabilities.rules_propose, "proposeRecurringRule", (input) => [
    scopeParameter(input.scope),
    input.idempotencyKey,
    JSON.stringify(input.input),
  ]),
  rules_get: bindCapability(Capabilities.rules_get, "getRecurringRule", (input) => [
    scopeParameter(input.scope),
    input.ruleId,
  ]),
  rules_simulate: bindCapability(Capabilities.rules_simulate, "simulateRecurringRule", (input) => [
    scopeParameter(input.scope),
    input.idempotencyKey,
    JSON.stringify(input.input),
  ]),
  rules_get_simulation: bindCapability(
    Capabilities.rules_get_simulation,
    "getRecurringSimulation",
    (input) => [scopeParameter(input.scope), input.simulationId],
  ),
  runs_create_preparation: bindCapability(
    Capabilities.runs_create_preparation,
    "createPreparationRun",
    (input) => [scopeParameter(input.scope), input.idempotencyKey, JSON.stringify(input.input)],
  ),
  runs_get: bindCapability(Capabilities.runs_get, "getPreparationRun", (input) => [
    scopeParameter(input.scope),
    input.runId,
  ]),
  runs_advance: bindCapability(Capabilities.runs_advance, "advancePreparationRun", (input) => [
    scopeParameter(input.scope),
    input.runId,
    input.idempotencyKey,
    JSON.stringify(input.input),
  ]),
  cases_prepare_snapshot: bindCapability(
    Capabilities.cases_prepare_snapshot,
    "prepareCaseSnapshot",
    (input) => [scopeParameter(input.scope), input.idempotencyKey, JSON.stringify(input.input)],
  ),
  cases_list: bindCapability(Capabilities.cases_list, "listCases", (input) => [
    scopeParameter(input.scope),
    input.snapshotId,
    JSON.stringify({ maxItems: input.maxItems, cursor: input.cursor }),
  ]),
  cases_get_context: bindCapability(Capabilities.cases_get_context, "getCaseContext", (input) => [
    scopeParameter(input.scope),
    input.snapshotId,
    input.caseId,
    JSON.stringify({ detail: input.detail, maxItems: input.maxItems, cursor: input.cursor }),
  ]),
  book_get_status: bindCapability(Capabilities.book_get_status, "bookStatus", (input) => [
    scopeParameter(input.scope),
  ]),
  bank_import_statement: bindCapability(
    Capabilities.bank_import_statement,
    "importBankStatement",
    (input) => [scopeParameter(input.scope), input.idempotencyKey, JSON.stringify(input.input)],
  ),
  bank_get_statement: bindCapability(
    Capabilities.bank_get_statement,
    "getBankStatement",
    (input) => [scopeParameter(input.scope), input.statementId],
  ),
  bank_match_observation: bindCapability(
    Capabilities.bank_match_observation,
    "matchBankObservation",
    (input) => [scopeParameter(input.scope), input.idempotencyKey, JSON.stringify(input.input)],
  ),
  bank_reconcile: bindCapability(Capabilities.bank_reconcile, "reconcileBank", (input) => [
    scopeParameter(input.scope),
    input.idempotencyKey,
    JSON.stringify(input.input),
  ]),
  bank_get_reconciliation: bindCapability(
    Capabilities.bank_get_reconciliation,
    "getBankReconciliation",
    (input) => [scopeParameter(input.scope), input.reconciliationId],
  ),
  reports_prepare: bindCapability(Capabilities.reports_prepare, "prepareReport", (input) => [
    scopeParameter(input.scope),
    input.idempotencyKey,
    JSON.stringify(input.input),
  ]),
  reports_get: bindCapability(Capabilities.reports_get, "getReport", (input) => [
    scopeParameter(input.scope),
    input.reportId,
  ]),
  reports_lines: bindCapability(Capabilities.reports_lines, "reportLines", (input) => [
    scopeParameter(input.scope),
    input.reportId,
    input.after ?? "",
  ]),
  reports_explain: bindCapability(Capabilities.reports_explain, "reportExplanation", (input) => [
    scopeParameter(input.scope),
    input.reportId,
    input.lineId,
    input.after ?? "",
  ]),
  book_list: bindCapability(Capabilities.book_list, "listBooks", () => []),
  book_get_setup: bindCapability(Capabilities.book_get_setup, "bookSetup", (input) => [
    scopeParameter(input.scope),
  ]),
  evidence_create: bindCapability(Capabilities.evidence_create, "createEvidence", (input) => [
    scopeParameter(input.scope),
    input.idempotencyKey,
    JSON.stringify(input.input),
  ]),
  evidence_get: bindCapability(Capabilities.evidence_get, "getEvidence", (input) => [
    scopeParameter(input.scope),
    input.evidenceId,
  ]),
  ledger_prepare_journal: bindCapability(
    Capabilities.ledger_prepare_journal,
    "prepareJournal",
    (input) => [scopeParameter(input.scope), input.idempotencyKey, JSON.stringify(input.input)],
  ),
  changes_get: bindCapability(Capabilities.changes_get, "getChange", (input) => [
    scopeParameter(input.scope),
    input.changeSetId,
  ]),
  changes_validate: bindCapability(Capabilities.changes_validate, "validateChange", (input) => [
    scopeParameter(input.scope),
    input.changeSetId,
    input.idempotencyKey,
  ]),
  changes_execute: bindCapability(Capabilities.changes_execute, "executeChange", (input) => [
    scopeParameter(input.scope),
    input.changeSetId,
    input.idempotencyKey,
    JSON.stringify(input.input),
  ]),
  ledger_prepare_correction: bindCapability(
    Capabilities.ledger_prepare_correction,
    "prepareCorrection",
    (input) => [
      scopeParameter(input.scope),
      input.voucherId,
      input.idempotencyKey,
      JSON.stringify(input.input),
    ],
  ),
  ledger_get_voucher: bindCapability(Capabilities.ledger_get_voucher, "getVoucher", (input) => [
    scopeParameter(input.scope),
    input.voucherId,
  ]),
  ledger_list: bindCapability(Capabilities.ledger_list, "listVouchers", (input) => [
    scopeParameter(input.scope),
    input.after ?? "0",
  ]),
  ledger_snapshot: bindCapability(Capabilities.ledger_snapshot, "ledgerSnapshot", (input) => [
    scopeParameter(input.scope),
  ]),
  receipts_get: bindCapability(Capabilities.receipts_get, "getReceipt", (input) => [
    scopeParameter(input.scope),
    input.key,
  ]),
};
