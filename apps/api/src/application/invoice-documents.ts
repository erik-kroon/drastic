import * as Accounting from "@open-erp/contracts/accounting";
import * as Documents from "@open-erp/contracts/invoice-documents";
import * as Effect from "effect/Effect";
import { query, scopeParameter } from "../db/query";
import { failure } from "./failures";
import { renderInvoiceDocument } from "./invoice-document-renderer";

function base64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
export const getInvoiceDocument = (token: string, input: typeof Documents.InvoiceDocumentCapabilities.commerce_get_invoice_document.input.Type) =>
  query("getInvoiceDocument", [token, scopeParameter(input.scope), input.id], Documents.InvoiceDocumentView);

export const invoiceDocumentHistory = (token: string, input: typeof Documents.InvoiceDocumentCapabilities.commerce_invoice_document_history.input.Type) =>
  query("invoiceDocumentHistory", [token, scopeParameter(input.scope), input.id], Documents.InvoiceDocumentHistory);

export const resumeInvoiceDocument = Effect.fn("invoiceDocument.resume")(function* (
  token: string, input: typeof Documents.InvoiceDocumentCapabilities.commerce_resume_invoice_document.input.Type,
) {
  const view = yield* getInvoiceDocument(token, input);
  if (view.artifact) return view;
  const bytes = yield* Effect.try({
    try: () => renderInvoiceDocument(view.capture),
    catch: (error) => error instanceof Accounting.AccountingError ? error : failure("InternalError"),
  });
  const digest = yield* Effect.tryPromise({
    try: () => crypto.subtle.digest("SHA-256", bytes),
    catch: () => failure("InternalError"),
  });
  const sha256 = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return yield* query("sealInvoiceDocument", [token, scopeParameter(input.scope), input.id, JSON.stringify({
    captureDigest: view.capture.digest, sourceDigest: view.capture.sourceDigest,
    generatorVersion: view.capture.generatorVersion, byteLength: bytes.length, sha256, contentBase64: base64(bytes),
  })], Documents.InvoiceDocumentView);
});

export const prepareInvoiceDocument = Effect.fn("invoiceDocument.prepare")(function* (
  token: string, input: typeof Documents.InvoiceDocumentCapabilities.commerce_prepare_invoice_document.input.Type,
) {
  const capture = yield* query("captureInvoiceDocument", [
    token, scopeParameter(input.scope), input.idempotencyKey, JSON.stringify(input.input),
  ], Documents.InvoiceDocumentCapture);
  return yield* resumeInvoiceDocument(token, { scope: input.scope, id: capture.id });
});
