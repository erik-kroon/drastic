import * as Accounting from "@open-erp/contracts/accounting";
import * as Pdf from "@open-erp/contracts/legal-invoice-pdf";
import * as Effect from "effect/Effect";
import { query, scopeParameter } from "../db/query";
import { failure } from "./failures";
import { renderLegalInvoicePdf } from "./legal-invoice-pdf-renderer";

function base64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
export const getLegalInvoicePdf = (
  token: string,
  input: typeof Pdf.LegalInvoicePdfCapabilities.commerce_get_legal_invoice_pdf.input.Type,
) =>
  query(
    "getLegalInvoicePdf",
    [token, scopeParameter(input.scope), input.id],
    Pdf.LegalInvoicePdfView,
  );
export const legalInvoicePdfHistory = (
  token: string,
  input: typeof Pdf.LegalInvoicePdfCapabilities.commerce_legal_invoice_pdf_history.input.Type,
) =>
  query(
    "legalInvoicePdfHistory",
    [token, scopeParameter(input.scope), input.id],
    Pdf.LegalInvoicePdfHistory,
  );
export const resumeLegalInvoicePdf = Effect.fn("legalInvoicePdf.resume")(function* (
  token: string,
  input: typeof Pdf.LegalInvoicePdfCapabilities.commerce_get_legal_invoice_pdf.input.Type,
) {
  const view = yield* getLegalInvoicePdf(token, input);
  if (view.artifact) return view;
  const bytes = yield* Effect.tryPromise({
    try: () => renderLegalInvoicePdf(view.capture),
    catch: (error) =>
      error instanceof Accounting.AccountingError ? error : failure("InternalError"),
  });
  const digest = yield* Effect.tryPromise({
    try: () => crypto.subtle.digest("SHA-256", new Uint8Array(bytes)),
    catch: () => failure("InternalError"),
  });
  const sha256 = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return yield* query(
    "sealLegalInvoicePdf",
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
    Pdf.LegalInvoicePdfView,
  );
});
export const prepareLegalInvoicePdf = Effect.fn("legalInvoicePdf.prepare")(function* (
  token: string,
  input: {
    scope: typeof Accounting.Scope.Type;
    idempotencyKey: string;
    input: typeof Pdf.PrepareLegalInvoicePdf.Type;
  },
) {
  const capture = yield* query(
    "captureLegalInvoicePdf",
    [token, scopeParameter(input.scope), input.idempotencyKey, JSON.stringify(input.input)],
    Pdf.LegalInvoicePdfCapture,
  );
  return yield* resumeLegalInvoicePdf(token, { scope: input.scope, id: capture.id });
});
