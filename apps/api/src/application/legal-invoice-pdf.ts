import * as Accounting from "@open-erp/contracts/accounting";
import * as Pdf from "@open-erp/contracts/legal-invoice-pdf";
import {
  getLegalInvoicePdf as readLegalInvoicePdf,
  legalInvoicePdfHistory as readLegalInvoicePdfHistory,
  prepareLegalInvoicePdf as prepareLegalInvoicePdfOperation,
  resumeLegalInvoicePdf as resumeLegalInvoicePdfOperation,
} from "./commerce/documents";

export const getLegalInvoicePdf = (
  token: string,
  input: typeof Pdf.LegalInvoicePdfCapabilities.commerce_get_legal_invoice_pdf.input.Type,
) => readLegalInvoicePdf(token, input);

export const legalInvoicePdfHistory = (
  token: string,
  input: typeof Pdf.LegalInvoicePdfCapabilities.commerce_legal_invoice_pdf_history.input.Type,
) => readLegalInvoicePdfHistory(token, input);

export const resumeLegalInvoicePdf = (
  token: string,
  input: typeof Pdf.LegalInvoicePdfCapabilities.commerce_get_legal_invoice_pdf.input.Type,
) => resumeLegalInvoicePdfOperation(token, input);

export const prepareLegalInvoicePdf = (
  token: string,
  input: {
    scope: typeof Accounting.Scope.Type;
    idempotencyKey: string;
    input: typeof Pdf.PrepareLegalInvoicePdf.Type;
  },
) => prepareLegalInvoicePdfOperation(token, input);
