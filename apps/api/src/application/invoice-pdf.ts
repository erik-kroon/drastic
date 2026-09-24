import * as Accounting from "@open-erp/contracts/accounting";
import * as Pdf from "@open-erp/contracts/invoice-pdf";
import * as Effect from "effect/Effect";
import { query, scopeParameter } from "../db/query";
import { failure } from "./failures";
import { renderInvoicePdf } from "./invoice-pdf-renderer";

function base64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
export const getInvoicePdf = (
  token: string,
  input: typeof Pdf.InvoicePdfCapabilities.commerce_get_invoice_pdf.input.Type,
) => query("getInvoicePdf", [token, scopeParameter(input.scope), input.id], Pdf.InvoicePdfView);
export const invoicePdfHistory = (
  token: string,
  input: typeof Pdf.InvoicePdfCapabilities.commerce_invoice_pdf_history.input.Type,
) =>
  query("invoicePdfHistory", [token, scopeParameter(input.scope), input.id], Pdf.InvoicePdfHistory);
export const resumeInvoicePdf = Effect.fn("invoicePdf.resume")(function* (
  token: string,
  input: typeof Pdf.InvoicePdfCapabilities.commerce_get_invoice_pdf.input.Type,
) {
  const view = yield* getInvoicePdf(token, input);
  if (view.artifact) return view;
  const bytes = yield* Effect.try({
    try: () => renderInvoicePdf(view.capture),
    catch: (error) =>
      error instanceof Accounting.AccountingError ? error : failure("InternalError"),
  });
  const digest = yield* Effect.tryPromise({
    try: () => crypto.subtle.digest("SHA-256", bytes),
    catch: () => failure("InternalError"),
  });
  const sha256 = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return yield* query(
    "sealInvoicePdf",
    [
      token,
      scopeParameter(input.scope),
      input.id,
      JSON.stringify({
        captureDigest: view.capture.digest,
        sourceDigest: view.capture.sourceDigest,
        byteLength: bytes.length,
        sha256,
        contentBase64: base64(bytes),
      }),
    ],
    Pdf.InvoicePdfView,
  );
});
export const prepareInvoicePdf = Effect.fn("invoicePdf.prepare")(function* (
  token: string,
  input: {
    scope: typeof Accounting.Scope.Type;
    idempotencyKey: string;
    input: typeof Pdf.PrepareInvoicePdf.Type;
  },
) {
  const capture = yield* query(
    "captureInvoicePdf",
    [token, scopeParameter(input.scope), input.idempotencyKey, JSON.stringify(input.input)],
    Pdf.InvoicePdfCapture,
  );
  return yield* resumeInvoicePdf(token, { scope: input.scope, id: capture.id });
});
