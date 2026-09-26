import { Capabilities } from "@open-erp/contracts/capabilities";
import { effectCapability } from "./shared";
import { getLegalInvoicePdf, legalInvoicePdfHistory } from "../commerce/documents";
import {
  arLegalIssueHistory,
  getArLegalAccountingProfile,
  getArLegalIssue,
  getArLegalIssueReview,
  getInvoiceCancellation,
  getInvoiceCancellationStatus,
  getLegalDelivery,
  getLegalSalesPolicy,
  readLegalDeliveryHistory,
  readLegalSalesPolicyHistory,
} from "../commerce/legal";

export const commerceLegalCapabilities = {
  commerce_get_invoice_cancellation: effectCapability(
    Capabilities.commerce_get_invoice_cancellation,
    getInvoiceCancellation,
  ),
  commerce_get_invoice_cancellation_status: effectCapability(
    Capabilities.commerce_get_invoice_cancellation_status,
    getInvoiceCancellationStatus,
  ),
  commerce_legal_sales_policy_history: effectCapability(
    Capabilities.commerce_legal_sales_policy_history,
    readLegalSalesPolicyHistory,
  ),
  commerce_get_legal_sales_policy: effectCapability(
    Capabilities.commerce_get_legal_sales_policy,
    getLegalSalesPolicy,
  ),
  commerce_get_legal_invoice_pdf: effectCapability(
    Capabilities.commerce_get_legal_invoice_pdf,
    getLegalInvoicePdf,
  ),
  commerce_legal_invoice_pdf_history: effectCapability(
    Capabilities.commerce_legal_invoice_pdf_history,
    legalInvoicePdfHistory,
  ),
  commerce_get_legal_delivery: effectCapability(
    Capabilities.commerce_get_legal_delivery,
    getLegalDelivery,
  ),
  commerce_legal_delivery_history: effectCapability(
    Capabilities.commerce_legal_delivery_history,
    readLegalDeliveryHistory,
  ),
  commerce_get_ar_legal_accounting_profile: effectCapability(
    Capabilities.commerce_get_ar_legal_accounting_profile,
    getArLegalAccountingProfile,
  ),
  commerce_get_ar_legal_issue_review: effectCapability(
    Capabilities.commerce_get_ar_legal_issue_review,
    getArLegalIssueReview,
  ),
  commerce_get_ar_legal_issue: effectCapability(
    Capabilities.commerce_get_ar_legal_issue,
    getArLegalIssue,
  ),
  commerce_ar_legal_issue_history: effectCapability(
    Capabilities.commerce_ar_legal_issue_history,
    arLegalIssueHistory,
  ),
};
