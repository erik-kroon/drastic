import * as Documents from "@open-erp/contracts/invoice-documents";
import {
  getInvoiceDocument as readInvoiceDocument,
  invoiceDocumentHistory as readInvoiceDocumentHistory,
  prepareInvoiceDocument as prepareInvoiceDocumentOperation,
  resumeInvoiceDocument as resumeInvoiceDocumentOperation,
} from "./commerce/documents";

export const getInvoiceDocument = (
  token: string,
  input: typeof Documents.InvoiceDocumentCapabilities.commerce_get_invoice_document.input.Type,
) => readInvoiceDocument(token, input);

export const invoiceDocumentHistory = (
  token: string,
  input: typeof Documents.InvoiceDocumentCapabilities.commerce_invoice_document_history.input.Type,
) => readInvoiceDocumentHistory(token, input);

export const resumeInvoiceDocument = (
  token: string,
  input: typeof Documents.InvoiceDocumentCapabilities.commerce_resume_invoice_document.input.Type,
) => resumeInvoiceDocumentOperation(token, input);

export const prepareInvoiceDocument = (
  token: string,
  input: typeof Documents.InvoiceDocumentCapabilities.commerce_prepare_invoice_document.input.Type,
) => prepareInvoiceDocumentOperation(token, input);
