import { Capabilities } from "@open-erp/contracts/capabilities";
import { effectCapability } from "./shared";
import { getArticle, listArticles } from "../commerce/catalog";
import {
  getCandidate as getInvoicePolicyCandidate,
  readHistory as readInvoicePolicyHistory,
} from "../commerce/invoice-policy";
import { getDelivery, readDeliveryHistory } from "../commerce/invoice-delivery";
import {
  getInvoiceDocument,
  invoiceDocumentHistory,
  prepareInvoiceDocument,
  resumeInvoiceDocument,
} from "../invoice-documents";
import { getInvoicePdf, invoicePdfHistory } from "../commerce/documents";
import { getSupplierAcceptanceReview, supplierAcceptanceHistory } from "../purchases/acceptance";
import { getSupplierCreditReview, supplierCreditHistory } from "../purchases/credits";
import { getSupplierInbox, listSupplierInboxes } from "../purchases/inbox";
import {
  getSupplierExtractionState,
  prepareSupplierExtractionReview,
} from "../purchases/extraction";
import {
  getSupplierInvoiceDraft,
  listSupplierInvoiceDrafts,
  supplierInvoiceDraftDuplicates,
  supplierInvoiceDraftHistory,
} from "../purchases/drafts";
import {
  getSupplierPayee,
  getSupplierPaymentBatch,
  listSupplierPaymentEligibility,
} from "../purchases/payments";
import { listDimensions } from "../dimensions";
import { readDirectory, readDirectoryExport } from "../commerce/crm-master";
import {
  applyAllocation,
  executeAllocationReversal,
  getAllocation,
  getAllocationReversal,
  getAllocationStatus,
  getPaymentCapacity,
  getRegisterAllocationStatus,
  listAllocationReversals,
  prepareAllocation,
  prepareAllocationReversal,
} from "../commerce/allocation-reversals";
import {
  getInvoiceIssueReview,
  getInvoiceDraft,
  invoiceDraftHistory,
  invoiceIssueHistory,
  listInvoiceDrafts,
} from "../commerce/invoice-lifecycle";
import {
  createCounterparty,
  createInvoice,
  getCounterparty,
  getInvoice,
  invoiceHistory,
  invoicePayments,
  listCounterparties,
  listInvoices,
  reviseCounterparty,
  reviseInvoice,
  salesRegister,
  supplierInvoiceDuplicates,
} from "../commerce/register";

export const commerceInvoiceCapabilities = {
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
  catalog_list_articles: effectCapability(Capabilities.catalog_list_articles, (token, input) =>
    listArticles(token, { scope: input.scope, after: input.after ?? "" }),
  ),
  catalog_get_article: effectCapability(Capabilities.catalog_get_article, getArticle),
  dimensions_list: effectCapability(Capabilities.dimensions_list, listDimensions),
  crm_directory: effectCapability(Capabilities.crm_directory, (token, input) =>
    readDirectory(token, {
      scope: input.scope,
      filters: {
        search: input.filters.search ?? "",
        role: input.filters.role ?? "",
        after: input.filters.after ?? "",
      },
    }),
  ),
  crm_directory_export: effectCapability(Capabilities.crm_directory_export, (token, input) =>
    readDirectoryExport(token, {
      scope: input.scope,
      filters: {
        search: input.filters.search ?? "",
        role: input.filters.role ?? "",
        after: input.filters.after ?? "",
      },
    }),
  ),
  supplier_inbox_list: effectCapability(Capabilities.supplier_inbox_list, listSupplierInboxes),
  supplier_inbox_get: effectCapability(Capabilities.supplier_inbox_get, getSupplierInbox),
  supplier_inbox_extraction_state: effectCapability(
    Capabilities.supplier_inbox_extraction_state,
    getSupplierExtractionState,
  ),
  supplier_inbox_extraction_review_preparation: effectCapability(
    Capabilities.supplier_inbox_extraction_review_preparation,
    prepareSupplierExtractionReview,
  ),
  commerce_get_invoice_policy_candidate: effectCapability(
    Capabilities.commerce_get_invoice_policy_candidate,
    getInvoicePolicyCandidate,
  ),
  commerce_invoice_policy_history: effectCapability(
    Capabilities.commerce_invoice_policy_history,
    readInvoicePolicyHistory,
  ),
  commerce_get_invoice_delivery: effectCapability(
    Capabilities.commerce_get_invoice_delivery,
    getDelivery,
  ),
  commerce_invoice_delivery_history: effectCapability(
    Capabilities.commerce_invoice_delivery_history,
    readDeliveryHistory,
  ),
  commerce_get_invoice_pdf: effectCapability(Capabilities.commerce_get_invoice_pdf, getInvoicePdf),
  commerce_invoice_pdf_history: effectCapability(
    Capabilities.commerce_invoice_pdf_history,
    invoicePdfHistory,
  ),
  commerce_prepare_allocation_reversal: effectCapability(
    Capabilities.commerce_prepare_allocation_reversal,
    prepareAllocationReversal,
  ),
  commerce_get_allocation_reversal: effectCapability(
    Capabilities.commerce_get_allocation_reversal,
    getAllocationReversal,
  ),
  commerce_list_allocation_reversals: effectCapability(
    Capabilities.commerce_list_allocation_reversals,
    (token, input) =>
      listAllocationReversals(token, { scope: input.scope, after: input.after ?? "" }),
  ),
  commerce_get_allocation_status: effectCapability(
    Capabilities.commerce_get_allocation_status,
    getAllocationStatus,
  ),
  commerce_get_register_allocation_status: effectCapability(
    Capabilities.commerce_get_register_allocation_status,
    getRegisterAllocationStatus,
  ),
  commerce_execute_allocation_reversal: effectCapability(
    Capabilities.commerce_execute_allocation_reversal,
    executeAllocationReversal,
  ),
  commerce_get_invoice_issue_review: effectCapability(
    Capabilities.commerce_get_invoice_issue_review,
    getInvoiceIssueReview,
  ),
  commerce_invoice_issue_history: effectCapability(
    Capabilities.commerce_invoice_issue_history,
    invoiceIssueHistory,
  ),
  commerce_get_supplier_credit_review: effectCapability(
    Capabilities.commerce_get_supplier_credit_review,
    (token, input) => getSupplierCreditReview(token, { scope: input.scope, reviewId: input.id }),
  ),
  commerce_supplier_credit_history: effectCapability(
    Capabilities.commerce_supplier_credit_history,
    (token, input) => supplierCreditHistory(token, { scope: input.scope, invoiceId: input.id }),
  ),
  commerce_get_supplier_acceptance_review: effectCapability(
    Capabilities.commerce_get_supplier_acceptance_review,
    (token, input) =>
      getSupplierAcceptanceReview(token, { scope: input.scope, reviewId: input.id }),
  ),
  commerce_supplier_acceptance_history: effectCapability(
    Capabilities.commerce_supplier_acceptance_history,
    (token, input) => supplierAcceptanceHistory(token, { scope: input.scope, draftId: input.id }),
  ),
  commerce_list_supplier_payment_eligibility: effectCapability(
    Capabilities.commerce_list_supplier_payment_eligibility,
    listSupplierPaymentEligibility,
  ),
  commerce_get_supplier_payee: effectCapability(
    Capabilities.commerce_get_supplier_payee,
    (token, input) => getSupplierPayee(token, { scope: input.scope, proposalId: input.id }),
  ),
  commerce_get_supplier_payment_batch: effectCapability(
    Capabilities.commerce_get_supplier_payment_batch,
    (token, input) => getSupplierPaymentBatch(token, { scope: input.scope, previewId: input.id }),
  ),
  commerce_supplier_invoice_draft_duplicates: effectCapability(
    Capabilities.commerce_supplier_invoice_draft_duplicates,
    (token, input) =>
      supplierInvoiceDraftDuplicates(token, {
        scope: input.scope,
        draftId: input.id,
        after: input.after,
      }),
  ),
  commerce_get_supplier_invoice_draft: effectCapability(
    Capabilities.commerce_get_supplier_invoice_draft,
    (token, input) =>
      getSupplierInvoiceDraft(token, {
        scope: input.scope,
        draftId: input.id,
        revision: input.revision,
      }),
  ),
  commerce_list_supplier_invoice_drafts: effectCapability(
    Capabilities.commerce_list_supplier_invoice_drafts,
    listSupplierInvoiceDrafts,
  ),
  commerce_supplier_invoice_draft_history: effectCapability(
    Capabilities.commerce_supplier_invoice_draft_history,
    (token, input) => supplierInvoiceDraftHistory(token, { scope: input.scope, draftId: input.id }),
  ),
  commerce_get_invoice_draft: effectCapability(
    Capabilities.commerce_get_invoice_draft,
    (token, input) =>
      getInvoiceDraft(token, { scope: input.scope, id: input.id, revision: input.revision }),
  ),
  commerce_list_invoice_drafts: effectCapability(
    Capabilities.commerce_list_invoice_drafts,
    listInvoiceDrafts,
  ),
  commerce_sales_register: effectCapability(Capabilities.commerce_sales_register, (token, input) =>
    salesRegister(token, {
      scope: input.scope,
      q: input.q,
      status: input.status,
      sort: input.sort,
      page: input.page,
    }),
  ),
  commerce_invoice_draft_history: effectCapability(
    Capabilities.commerce_invoice_draft_history,
    invoiceDraftHistory,
  ),
  commerce_create_counterparty: effectCapability(
    Capabilities.commerce_create_counterparty,
    createCounterparty,
  ),
  commerce_revise_counterparty: effectCapability(
    Capabilities.commerce_revise_counterparty,
    reviseCounterparty,
  ),
  commerce_get_counterparty: effectCapability(
    Capabilities.commerce_get_counterparty,
    (token, input) =>
      getCounterparty(token, { scope: input.scope, id: input.id, revision: input.revision }),
  ),
  commerce_list_counterparties: effectCapability(
    Capabilities.commerce_list_counterparties,
    (token, input) => listCounterparties(token, { scope: input.scope, after: input.after ?? "" }),
  ),
  commerce_supplier_invoice_duplicates: effectCapability(
    Capabilities.commerce_supplier_invoice_duplicates,
    (token, input) =>
      supplierInvoiceDuplicates(token, {
        scope: input.scope,
        counterpartyId: input.counterpartyId,
        documentNumber: input.documentNumber,
        evidenceId: input.evidenceId,
        after: input.after,
      }),
  ),
  commerce_create_invoice: effectCapability(Capabilities.commerce_create_invoice, createInvoice),
  commerce_revise_invoice: effectCapability(Capabilities.commerce_revise_invoice, reviseInvoice),
  commerce_get_invoice: effectCapability(Capabilities.commerce_get_invoice, getInvoice),
  commerce_invoice_payments: effectCapability(
    Capabilities.commerce_invoice_payments,
    (token, input) =>
      invoicePayments(token, {
        scope: input.scope,
        id: input.id,
        page: input.page,
        historyPage: input.historyPage,
      }),
  ),
  commerce_invoice_history: effectCapability(
    Capabilities.commerce_invoice_history,
    (token, input) =>
      invoiceHistory(token, { scope: input.scope, id: input.id, after: input.after ?? "" }),
  ),
  commerce_list_invoices: effectCapability(Capabilities.commerce_list_invoices, (token, input) =>
    listInvoices(token, { scope: input.scope, after: input.after ?? "" }),
  ),
  commerce_get_payment_capacity: effectCapability(
    Capabilities.commerce_get_payment_capacity,
    (token, input) =>
      getPaymentCapacity(token, {
        scope: input.scope,
        voucherId: input.voucherId,
        lineId: input.lineId,
      }),
  ),
  commerce_prepare_allocation: effectCapability(
    Capabilities.commerce_prepare_allocation,
    prepareAllocation,
  ),
  commerce_get_allocation: effectCapability(Capabilities.commerce_get_allocation, getAllocation),
  commerce_apply_allocation: effectCapability(
    Capabilities.commerce_apply_allocation,
    applyAllocation,
  ),
};
