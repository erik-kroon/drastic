import { Capabilities } from "@open-erp/contracts/capabilities";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type * as Accounting from "@open-erp/contracts/accounting";
import { getSourceOccurrence, retainSource } from "./source-retention";
import { startPreparationJob } from "./preparation-jobs";
import { prepareVatDraft } from "./vat-returns";
import { prepareSie, getSie, listSie, resumeSie } from "./sie";
import {
  prepareInvoiceDocument,
  getInvoiceDocument,
  resumeInvoiceDocument,
  invoiceDocumentHistory,
} from "./invoice-documents";
import type { RequestEnvironment } from "../runtime/environment";
import { query, scopeParameter, type DatabaseOperation } from "../db/query";

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
  return effectCapability(definition, execute);
}

function effectCapability<I, O extends Schema.Json>(
  definition: {
    readonly input: Schema.Decoder<I>;
    readonly output: Schema.Decoder<O>;
    readonly description: string;
    readonly readOnly: boolean;
  },
  execute: (
    token: string,
    input: I,
  ) => Effect.Effect<O, Accounting.AccountingError, RequestEnvironment>,
) {
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
  firm_list: bindCapability(Capabilities.firm_list, "listFirms", () => []),
  firm_get: bindCapability(Capabilities.firm_get, "getFirm", (input) => [input.firmId]),
  firm_create: bindCapability(Capabilities.firm_create, "createFirm", (input) => [
    input.idempotencyKey,
    JSON.stringify(input.input),
  ]),
  firm_save_client: bindCapability(Capabilities.firm_save_client, "saveFirmClient", (input) => [
    input.firmId,
    input.idempotencyKey,
    JSON.stringify(input.input),
  ]),
  firm_remove_client: bindCapability(
    Capabilities.firm_remove_client,
    "removeFirmClient",
    (input) => [input.firmId, input.idempotencyKey, JSON.stringify(input.input)],
  ),
  firm_save_member: bindCapability(Capabilities.firm_save_member, "saveFirmMember", (input) => [
    input.firmId,
    input.idempotencyKey,
    JSON.stringify(input.input),
  ]),

  commerce_get_invoice_cancellation: bindCapability(
    Capabilities.commerce_get_invoice_cancellation,
    "getInvoiceCancellation",
    (input) => [scopeParameter(input.scope), input.id],
  ),
  commerce_get_invoice_cancellation_status: bindCapability(
    Capabilities.commerce_get_invoice_cancellation_status,
    "getInvoiceCancellationStatus",
    (input) => [scopeParameter(input.scope), input.id],
  ),
  workspace_coordination: bindCapability(
    Capabilities.workspace_coordination,
    "workspaceCoordination",
    (input) => [scopeParameter(input.scope)],
  ),
  workspace_save_view: bindCapability(
    Capabilities.workspace_save_view,
    "workspaceSaveView",
    (input) => [scopeParameter(input.scope), input.idempotencyKey, JSON.stringify(input.input)],
  ),
  workspace_delete_view: bindCapability(
    Capabilities.workspace_delete_view,
    "workspaceDeleteView",
    (input) => [scopeParameter(input.scope), input.idempotencyKey, JSON.stringify(input.input)],
  ),
  workspace_assign_work: bindCapability(
    Capabilities.workspace_assign_work,
    "workspaceAssignWork",
    (input) => [scopeParameter(input.scope), input.idempotencyKey, JSON.stringify(input.input)],
  ),
  tax_account_preview_match: bindCapability(
    Capabilities.tax_account_preview_match,
    "previewTaxAccountMatch",
    (input) => [scopeParameter(input.scope), JSON.stringify(input.input)],
  ),
  tax_account_get_match: bindCapability(
    Capabilities.tax_account_get_match,
    "getTaxAccountMatch",
    (input) => [scopeParameter(input.scope), input.id],
  ),
  tax_account_list_matches: bindCapability(
    Capabilities.tax_account_list_matches,
    "listTaxAccountMatches",
    (input) => [scopeParameter(input.scope)],
  ),
  tax_account_get_statement: bindCapability(
    Capabilities.tax_account_get_statement,
    "getTaxAccountStatement",
    (input) => [scopeParameter(input.scope), input.id],
  ),
  tax_account_list_statements: bindCapability(
    Capabilities.tax_account_list_statements,
    "listTaxAccountStatements",
    (input) => [scopeParameter(input.scope)],
  ),
  tax_account_create_control: bindCapability(
    Capabilities.tax_account_create_control,
    "createTaxAccountControl",
    (input) => [scopeParameter(input.scope), input.idempotencyKey, JSON.stringify(input.input)],
  ),
  tax_account_get_control: bindCapability(
    Capabilities.tax_account_get_control,
    "getTaxAccountControl",
    (input) => [scopeParameter(input.scope), input.id],
  ),
  tax_account_list_controls: bindCapability(
    Capabilities.tax_account_list_controls,
    "listTaxAccountControls",
    (input) => [scopeParameter(input.scope)],
  ),
  bank_prepare_inventory_signoff: bindCapability(
    Capabilities.bank_prepare_inventory_signoff,
    "prepareBankInventorySignoff",
    (input) => [scopeParameter(input.scope), input.idempotencyKey, JSON.stringify(input.input)],
  ),
  bank_get_inventory_signoff: bindCapability(
    Capabilities.bank_get_inventory_signoff,
    "getBankInventorySignoff",
    (input) => [scopeParameter(input.scope), input.id],
  ),
  bank_list_inventory_signoffs: bindCapability(
    Capabilities.bank_list_inventory_signoffs,
    "listBankInventorySignoffs",
    (input) => [scopeParameter(input.scope)],
  ),
  bank_prepare_signoff: bindCapability(
    Capabilities.bank_prepare_signoff,
    "prepareBankSignoff",
    (input) => [scopeParameter(input.scope), input.idempotencyKey, JSON.stringify(input.input)],
  ),
  bank_get_signoff: bindCapability(Capabilities.bank_get_signoff, "getBankSignoff", (input) => [
    scopeParameter(input.scope),
    input.id,
  ]),
  bank_list_signoffs: bindCapability(
    Capabilities.bank_list_signoffs,
    "listBankSignoffs",
    (input) => [scopeParameter(input.scope)],
  ),
  bank_create_source_coverage: bindCapability(
    Capabilities.bank_create_source_coverage,
    "createBankSourceCoverage",
    (input) => [scopeParameter(input.scope), input.idempotencyKey, JSON.stringify(input.input)],
  ),
  bank_get_source_coverage: bindCapability(
    Capabilities.bank_get_source_coverage,
    "getBankSourceCoverage",
    (input) => [scopeParameter(input.scope), input.id],
  ),
  bank_list_source_coverage: bindCapability(
    Capabilities.bank_list_source_coverage,
    "listBankSourceCoverage",
    (input) => [scopeParameter(input.scope)],
  ),
  commerce_prepare_invoice_document: effectCapability(
    Capabilities.commerce_prepare_invoice_document,
    prepareInvoiceDocument,
  ),
  commerce_get_invoice_document: effectCapability(
    Capabilities.commerce_get_invoice_document,
    getInvoiceDocument,
  ),
  commerce_resume_invoice_document: effectCapability(
    Capabilities.commerce_resume_invoice_document,
    resumeInvoiceDocument,
  ),
  commerce_invoice_document_history: effectCapability(
    Capabilities.commerce_invoice_document_history,
    invoiceDocumentHistory,
  ),
  fx_list_rates: bindCapability(Capabilities.fx_list_rates, "listExchangeRates", (input) => [
    scopeParameter(input.scope),
  ]),
  fx_get_rate: bindCapability(Capabilities.fx_get_rate, "getExchangeRate", (input) => [
    scopeParameter(input.scope),
    input.id,
  ]),
  fx_capture_conversion: bindCapability(
    Capabilities.fx_capture_conversion,
    "captureConversionReview",
    (input) => [scopeParameter(input.scope), input.idempotencyKey, JSON.stringify(input.input)],
  ),
  fx_list_conversions: bindCapability(
    Capabilities.fx_list_conversions,
    "listConversionReviews",
    (input) => [scopeParameter(input.scope)],
  ),
  fx_get_conversion: bindCapability(
    Capabilities.fx_get_conversion,
    "getConversionReview",
    (input) => [scopeParameter(input.scope), input.id],
  ),
  commerce_prepare_allocation_reversal: bindCapability(
    Capabilities.commerce_prepare_allocation_reversal,
    "prepareCommerceAllocationReversal",
    (input) => [scopeParameter(input.scope), input.idempotencyKey, JSON.stringify(input.input)],
  ),
  commerce_get_allocation_reversal: bindCapability(
    Capabilities.commerce_get_allocation_reversal,
    "getCommerceAllocationReversal",
    (input) => [scopeParameter(input.scope), input.id],
  ),
  commerce_list_allocation_reversals: bindCapability(
    Capabilities.commerce_list_allocation_reversals,
    "listCommerceAllocationReversals",
    (input) => [scopeParameter(input.scope), input.after ?? ""],
  ),
  commerce_get_allocation_status: bindCapability(
    Capabilities.commerce_get_allocation_status,
    "getCommerceAllocationStatus",
    (input) => [scopeParameter(input.scope), input.id],
  ),
  commerce_get_register_allocation_status: bindCapability(
    Capabilities.commerce_get_register_allocation_status,
    "getCommerceRegisterAllocationStatus",
    (input) => [scopeParameter(input.scope), input.id],
  ),
  commerce_execute_allocation_reversal: bindCapability(
    Capabilities.commerce_execute_allocation_reversal,
    "executeCommerceAllocationReversal",
    (input) => [
      scopeParameter(input.scope),
      input.idempotencyKey,
      input.id,
      JSON.stringify(input.input),
    ],
  ),
  bank_discover_match_candidates: bindCapability(
    Capabilities.bank_discover_match_candidates,
    "discoverBankMatchCandidates",
    (input) => [scopeParameter(input.scope), JSON.stringify(input.input)],
  ),
  commerce_get_invoice_issue_review: bindCapability(
    Capabilities.commerce_get_invoice_issue_review,
    "getInvoiceIssueReview",
    (input) => [scopeParameter(input.scope), input.id],
  ),
  commerce_invoice_issue_history: bindCapability(
    Capabilities.commerce_invoice_issue_history,
    "invoiceIssueHistory",
    (input) => [scopeParameter(input.scope), input.id],
  ),
  subledger_get_basis: bindCapability(
    Capabilities.subledger_get_basis,
    "getSubledgerBasis",
    (input) => [scopeParameter(input.scope), input.id],
  ),
  subledger_list_bases: bindCapability(
    Capabilities.subledger_list_bases,
    "listSubledgerBases",
    (input) => [scopeParameter(input.scope)],
  ),
  subledger_create_control: bindCapability(
    Capabilities.subledger_create_control,
    "createSubledgerControl",
    (input) => [scopeParameter(input.scope), input.idempotencyKey, JSON.stringify(input.input)],
  ),
  subledger_get_control: bindCapability(
    Capabilities.subledger_get_control,
    "getSubledgerControl",
    (input) => [scopeParameter(input.scope), input.id],
  ),
  subledger_list_controls: bindCapability(
    Capabilities.subledger_list_controls,
    "listSubledgerControls",
    (input) => [scopeParameter(input.scope)],
  ),
  bank_prepare_match_reversal: bindCapability(
    Capabilities.bank_prepare_match_reversal,
    "prepareBankMatchReversal",
    (input) => [scopeParameter(input.scope), input.idempotencyKey, JSON.stringify(input.input)],
  ),
  bank_get_match_reversal: bindCapability(
    Capabilities.bank_get_match_reversal,
    "getBankMatchReversal",
    (input) => [scopeParameter(input.scope), input.planId],
  ),
  bank_list_match_reversals: bindCapability(
    Capabilities.bank_list_match_reversals,
    "listBankMatchReversals",
    (input) => [scopeParameter(input.scope), input.after ?? ""],
  ),
  bank_execute_match_reversal: bindCapability(
    Capabilities.bank_execute_match_reversal,
    "executeBankMatchReversal",
    (input) => [
      scopeParameter(input.scope),
      input.idempotencyKey,
      input.planId,
      JSON.stringify(input.input),
    ],
  ),
  commerce_get_invoice_draft: bindCapability(
    Capabilities.commerce_get_invoice_draft,
    "getInvoiceDraft",
    (input) => [scopeParameter(input.scope), input.id, input.revision ?? ""],
  ),
  commerce_list_invoice_drafts: bindCapability(
    Capabilities.commerce_list_invoice_drafts,
    "listInvoiceDrafts",
    (input) => [scopeParameter(input.scope)],
  ),
  commerce_sales_register: bindCapability(
    Capabilities.commerce_sales_register,
    "salesRegister",
    (input) => [
      scopeParameter(input.scope),
      JSON.stringify({ q: input.q, status: input.status, sort: input.sort, page: input.page }),
    ],
  ),
  commerce_invoice_draft_history: bindCapability(
    Capabilities.commerce_invoice_draft_history,
    "invoiceDraftHistory",
    (input) => [scopeParameter(input.scope), input.id],
  ),
  sie_prepare: effectCapability(Capabilities.sie_prepare, prepareSie),
  sie_get: effectCapability(Capabilities.sie_get, getSie),
  sie_list: effectCapability(Capabilities.sie_list, listSie),
  sie_resume: effectCapability(Capabilities.sie_resume, resumeSie),
  vat_return_compare_drafts: bindCapability(
    Capabilities.vat_return_compare_drafts,
    "compareVatDrafts",
    (input) => [scopeParameter(input.scope), JSON.stringify(input.input)],
  ),
  vat_return_get_amendment: bindCapability(
    Capabilities.vat_return_get_amendment,
    "getVatAmendment",
    (input) => [scopeParameter(input.scope), input.amendmentId],
  ),
  vat_return_list_amendments: bindCapability(
    Capabilities.vat_return_list_amendments,
    "listVatAmendments",
    (input) => [scopeParameter(input.scope)],
  ),
  vat_return_basis: bindCapability(Capabilities.vat_return_basis, "vatReturnBasis", (input) => [
    scopeParameter(input.scope),
  ]),
  vat_return_get_fact: bindCapability(Capabilities.vat_return_get_fact, "getVatFact", (input) => [
    scopeParameter(input.scope),
    input.factId,
  ]),
  vat_return_prepare_draft: effectCapability(
    Capabilities.vat_return_prepare_draft,
    prepareVatDraft,
  ),
  vat_return_get_draft: bindCapability(
    Capabilities.vat_return_get_draft,
    "getVatDraft",
    (input) => [scopeParameter(input.scope), input.draftId],
  ),
  vat_return_list_drafts: bindCapability(
    Capabilities.vat_return_list_drafts,
    "listVatDrafts",
    (input) => [scopeParameter(input.scope)],
  ),
  commerce_create_register_report: bindCapability(
    Capabilities.commerce_create_register_report,
    "createRegisterReport",
    (input) => [scopeParameter(input.scope), input.idempotencyKey, JSON.stringify(input.input)],
  ),
  commerce_get_register_report: bindCapability(
    Capabilities.commerce_get_register_report,
    "getRegisterReport",
    (input) => [scopeParameter(input.scope), input.id],
  ),
  commerce_list_register_reports: bindCapability(
    Capabilities.commerce_list_register_reports,
    "listRegisterReports",
    (input) => [scopeParameter(input.scope), input.after ?? ""],
  ),
  runs_stop_background: bindCapability(
    Capabilities.runs_stop_background,
    "stopPreparationJob",
    (input) => [
      scopeParameter(input.scope),
      input.jobId,
      input.idempotencyKey,
      JSON.stringify(input.input),
    ],
  ),
  runs_start_background: effectCapability(Capabilities.runs_start_background, startPreparationJob),
  runs_get_background: bindCapability(
    Capabilities.runs_get_background,
    "getPreparationJob",
    (input) => [scopeParameter(input.scope), input.runId],
  ),
  workspace_attention: bindCapability(
    Capabilities.workspace_attention,
    "workspaceAttention",
    (input) => [
      scopeParameter(input.scope),
      JSON.stringify({
        kind: input.kind,
        period: input.period,
        status: input.status,
        sort: input.sort,
        q: input.q,
        after: input.after,
      }),
    ],
  ),
  workspace_list_work: bindCapability(
    Capabilities.workspace_list_work,
    "workspaceListWork",
    (input) => [
      scopeParameter(input.scope),
      JSON.stringify({
        period: input.period,
        status: input.status,
        sort: input.sort,
        q: input.q,
        after: input.after,
      }),
    ],
  ),
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
  periods_list_closing_proposals: bindCapability(
    Capabilities.periods_list_closing_proposals,
    "listClosingProposals",
    (input) => [scopeParameter(input.scope), input.periodId, input.after ?? ""],
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
  commerce_supplier_invoice_duplicates: bindCapability(
    Capabilities.commerce_supplier_invoice_duplicates,
    "commerceSupplierInvoiceDuplicates",
    (input) => [
      scopeParameter(input.scope),
      JSON.stringify({
        counterpartyId: input.counterpartyId,
        documentNumber: input.documentNumber,
        evidenceId: input.evidenceId,
        after: input.after,
      }),
    ],
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
  commerce_invoice_payments: bindCapability(
    Capabilities.commerce_invoice_payments,
    "commerceInvoicePayments",
    (input) => [
      scopeParameter(input.scope),
      input.id,
      JSON.stringify({ page: input.page, historyPage: input.historyPage }),
    ],
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
  accountant_review_prepare: bindCapability(
    Capabilities.accountant_review_prepare,
    "prepareAccountantReview",
    (input) => [scopeParameter(input.scope), input.idempotencyKey, JSON.stringify(input.input)],
  ),
  accountant_review_list: bindCapability(
    Capabilities.accountant_review_list,
    "listAccountantReviews",
    (input) => [scopeParameter(input.scope), input.after ?? ""],
  ),
  accountant_review_get: bindCapability(
    Capabilities.accountant_review_get,
    "getAccountantReview",
    (input) => [scopeParameter(input.scope), input.packId],
  ),
  accountant_review_rows: bindCapability(
    Capabilities.accountant_review_rows,
    "accountantReviewRows",
    (input) => [scopeParameter(input.scope), input.packId, input.section, input.after ?? ""],
  ),
  accountant_review_artifact: bindCapability(
    Capabilities.accountant_review_artifact,
    "getAccountantReviewArtifact",
    (input) => [scopeParameter(input.scope), input.packId, input.format],
  ),
  posting_save_request: bindCapability(
    Capabilities.posting_save_request,
    "savePostingRequest",
    (input) => [scopeParameter(input.scope), input.idempotencyKey, JSON.stringify(input.command)],
  ),
  posting_run_request: bindCapability(
    Capabilities.posting_run_request,
    "runPostingRequest",
    (input) => [scopeParameter(input.scope), input.key],
  ),
  posting_get_saved_request: bindCapability(
    Capabilities.posting_get_saved_request,
    "getSavedPostingRequest",
    (input) => [scopeParameter(input.scope), input.key],
  ),
  posting_list_saved_requests: bindCapability(
    Capabilities.posting_list_saved_requests,
    "listSavedPostingRequests",
    (input) => [scopeParameter(input.scope), input.after ?? ""],
  ),
  source_retain: effectCapability(Capabilities.source_retain, retainSource),
  source_list_occurrences: bindCapability(
    Capabilities.source_list_occurrences,
    "listSourceOccurrences",
    (input) => [scopeParameter(input.scope), input.cursor ?? ""],
  ),
  source_get_occurrence_metadata: bindCapability(
    Capabilities.source_get_occurrence_metadata,
    "getSourceOccurrenceMetadata",
    (input) => [scopeParameter(input.scope), input.occurrenceId],
  ),
  source_get_occurrence: effectCapability(Capabilities.source_get_occurrence, getSourceOccurrence),
  source_capture_review: bindCapability(
    Capabilities.source_capture_review,
    "captureSourceReview",
    (input) => [
      scopeParameter(input.scope),
      input.idempotencyKey,
      input.previewId,
      JSON.stringify(input.input),
    ],
  ),
  source_get_review_artifact: bindCapability(
    Capabilities.source_get_review_artifact,
    "getSourceReviewArtifact",
    (input) => [scopeParameter(input.scope), input.id],
  ),
  source_list_review_artifacts: bindCapability(
    Capabilities.source_list_review_artifacts,
    "listSourceReviewArtifacts",
    (input) => [scopeParameter(input.scope)],
  ),
  source_reparse_csv: bindCapability(
    Capabilities.source_reparse_csv,
    "reparseSourceCsv",
    (input) => [
      scopeParameter(input.scope),
      input.idempotencyKey,
      input.previewId,
      JSON.stringify(input.input),
    ],
  ),
  source_get_revision_history: bindCapability(
    Capabilities.source_get_revision_history,
    "getSourceRevisionHistory",
    (input) => [scopeParameter(input.scope), input.occurrenceId],
  ),
  source_preview_csv: bindCapability(
    Capabilities.source_preview_csv,
    "previewSourceCsv",
    (input) => [
      scopeParameter(input.scope),
      input.idempotencyKey,
      input.occurrenceId,
      JSON.stringify(input.input),
    ],
  ),
  source_get_preview: bindCapability(
    Capabilities.source_get_preview,
    "getSourcePreview",
    (input) => [scopeParameter(input.scope), input.previewId],
  ),
  expense_tax_record_source: bindCapability(
    Capabilities.expense_tax_record_source,
    "recordExpenseTaxSource",
    (input) => [scopeParameter(input.scope), input.idempotencyKey, JSON.stringify(input.input)],
  ),
  expense_tax_inventory: bindCapability(
    Capabilities.expense_tax_inventory,
    "expenseTaxInventory",
    (input) => [scopeParameter(input.scope)],
  ),
  expense_tax_get_source: bindCapability(
    Capabilities.expense_tax_get_source,
    "getExpenseTaxSource",
    (input) => [scopeParameter(input.scope), input.sourceId],
  ),
  expense_tax_prepare_snapshot: bindCapability(
    Capabilities.expense_tax_prepare_snapshot,
    "prepareExpenseTaxSnapshot",
    (input) => [scopeParameter(input.scope), input.idempotencyKey, JSON.stringify(input.input)],
  ),
  expense_tax_get_snapshot: bindCapability(
    Capabilities.expense_tax_get_snapshot,
    "getExpenseTaxSnapshot",
    (input) => [scopeParameter(input.scope), input.snapshotId],
  ),
  expense_tax_list_snapshots: bindCapability(
    Capabilities.expense_tax_list_snapshots,
    "listExpenseTaxSnapshots",
    (input) => [scopeParameter(input.scope), input.after ?? "", input.sourceId ?? ""],
  ),
  owners_create_owner: bindCapability(
    Capabilities.owners_create_owner,
    "ownersCreateOwner",
    (input) => [scopeParameter(input.scope), input.idempotencyKey, JSON.stringify(input.input)],
  ),
  owners_get_owner: bindCapability(Capabilities.owners_get_owner, "ownersGetOwner", (input) => [
    scopeParameter(input.scope),
    input.id,
  ]),
  owners_list_owners: bindCapability(
    Capabilities.owners_list_owners,
    "ownersListOwners",
    (input) => [scopeParameter(input.scope), input.after ?? ""],
  ),
  owners_create_record: bindCapability(
    Capabilities.owners_create_record,
    "ownersCreateRecord",
    (input) => [scopeParameter(input.scope), input.idempotencyKey, JSON.stringify(input.input)],
  ),
  owners_revise_record: bindCapability(
    Capabilities.owners_revise_record,
    "ownersReviseRecord",
    (input) => [
      scopeParameter(input.scope),
      input.id,
      input.idempotencyKey,
      JSON.stringify(input.input),
    ],
  ),
  owners_get_record: bindCapability(Capabilities.owners_get_record, "ownersGetRecord", (input) => [
    scopeParameter(input.scope),
    input.id,
  ]),
  owners_list_records: bindCapability(
    Capabilities.owners_list_records,
    "ownersListRecords",
    (input) => [scopeParameter(input.scope), input.after ?? ""],
  ),
  owners_record_history: bindCapability(
    Capabilities.owners_record_history,
    "ownersRecordHistory",
    (input) => [scopeParameter(input.scope), input.id, input.after ?? ""],
  ),
  owners_attach_proposal: bindCapability(
    Capabilities.owners_attach_proposal,
    "ownersAttachProposal",
    (input) => [
      scopeParameter(input.scope),
      input.id,
      input.idempotencyKey,
      JSON.stringify(input.input),
    ],
  ),
  owners_attach_posted_line: bindCapability(
    Capabilities.owners_attach_posted_line,
    "ownersAttachPostedLine",
    (input) => [
      scopeParameter(input.scope),
      input.id,
      input.idempotencyKey,
      JSON.stringify(input.input),
    ],
  ),
  owners_prepare_allocation: bindCapability(
    Capabilities.owners_prepare_allocation,
    "ownersPrepareAllocation",
    (input) => [scopeParameter(input.scope), input.idempotencyKey, JSON.stringify(input.input)],
  ),
  owners_get_allocation: bindCapability(
    Capabilities.owners_get_allocation,
    "ownersGetAllocation",
    (input) => [scopeParameter(input.scope), input.id],
  ),
  owners_apply_allocation: bindCapability(
    Capabilities.owners_apply_allocation,
    "ownersApplyAllocation",
    (input) => [
      scopeParameter(input.scope),
      input.id,
      input.idempotencyKey,
      JSON.stringify(input.input),
    ],
  ),
  owners_prepare_control: bindCapability(
    Capabilities.owners_prepare_control,
    "ownersPrepareControl",
    (input) => [scopeParameter(input.scope), input.idempotencyKey, JSON.stringify(input.input)],
  ),
  owners_get_control: bindCapability(
    Capabilities.owners_get_control,
    "ownersGetControl",
    (input) => [scopeParameter(input.scope), input.id],
  ),
  owners_recover_command: bindCapability(
    Capabilities.owners_recover_command,
    "ownersRecoverCommand",
    (input) => [scopeParameter(input.scope), input.key],
  ),
  corrections_review_impact: bindCapability(
    Capabilities.corrections_review_impact,
    "prepareCorrectionImpact",
    (input) => [
      scopeParameter(input.scope),
      input.voucherId,
      input.idempotencyKey,
      JSON.stringify(input.input),
    ],
  ),
  corrections_get_impact: bindCapability(
    Capabilities.corrections_get_impact,
    "getCorrectionImpact",
    (input) => [scopeParameter(input.scope), input.impactId],
  ),
  corrections_chain: bindCapability(
    Capabilities.corrections_chain,
    "getCorrectionChain",
    (input) => [scopeParameter(input.scope), input.voucherId],
  ),
  corrections_list: bindCapability(
    Capabilities.corrections_list,
    "listCorrectionBundles",
    (input) => [scopeParameter(input.scope), input.after ?? ""],
  ),
  corrections_recover_request: bindCapability(
    Capabilities.corrections_recover_request,
    "recoverCorrectionRequest",
    (input) => [scopeParameter(input.scope), input.key],
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
  reports_list: bindCapability(Capabilities.reports_list, "listReports", (input) => [
    scopeParameter(input.scope),
    input.after ?? "",
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
  reports_compare: bindCapability(Capabilities.reports_compare, "compareReports", (input) => [
    scopeParameter(input.scope),
    input.leftReportId,
    input.rightReportId,
    input.after ?? "",
  ]),
  reports_general_ledger: bindCapability(
    Capabilities.reports_general_ledger,
    "reportGeneralLedger",
    (input) => [scopeParameter(input.scope), input.reportId, input.lineId, input.after ?? ""],
  ),
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
} satisfies Record<keyof typeof Capabilities, { readonly readOnly: boolean }>;
