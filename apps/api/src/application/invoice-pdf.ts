import * as Accounting from "@open-erp/contracts/accounting";
import * as Pdf from "@open-erp/contracts/invoice-pdf";
import {
  getInvoicePdf as readInvoicePdf,
  invoicePdfHistory as readInvoicePdfHistory,
  prepareInvoicePdf as prepareInvoicePdfOperation,
  resumeInvoicePdf as resumeInvoicePdfOperation,
} from "./commerce/documents";

export const getInvoicePdf = (
  token: string,
  input: typeof Pdf.InvoicePdfCapabilities.commerce_get_invoice_pdf.input.Type,
) => readInvoicePdf(token, input);

export const invoicePdfHistory = (
  token: string,
  input: typeof Pdf.InvoicePdfCapabilities.commerce_invoice_pdf_history.input.Type,
) => readInvoicePdfHistory(token, input);

export const resumeInvoicePdf = (
  token: string,
  input: typeof Pdf.InvoicePdfCapabilities.commerce_get_invoice_pdf.input.Type,
) => resumeInvoicePdfOperation(token, input);

export const prepareInvoicePdf = (
  token: string,
  input: {
    scope: typeof Accounting.Scope.Type;
    idempotencyKey: string;
    input: typeof Pdf.PrepareInvoicePdf.Type;
  },
) => prepareInvoicePdfOperation(token, input);
