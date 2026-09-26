import { digest as digestNative } from "../json";
import { equalJson } from "@open-erp/domain/canonicalization";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Documents from "@open-erp/contracts/invoice-documents";
import * as Issuance from "@open-erp/contracts/invoice-issuance";
import * as Ar from "@open-erp/contracts/ar-legal-issue";
import * as LegalPdf from "@open-erp/contracts/legal-invoice-pdf";
import * as Pdf from "@open-erp/contracts/invoice-pdf";
import * as Effect from "effect/Effect";
import type * as Schema from "effect/Schema";

import * as CaptureDb from "../../db/commerce/documents";
import { lockBookForUpdate } from "../../db/posting";
import type { Transaction } from "../../db/transaction";
import { isoNow, newId, replay, saveCommand } from "../posting";
import { failure } from "../failures";
import { renderInvoiceDocument } from "../invoice-document-renderer";
import { renderInvoicePdf } from "../invoice-pdf-renderer";
import { renderLegalInvoicePdf } from "../legal-invoice-pdf-renderer";
import { renderLegalInvoicePdfV2 } from "../legal-invoice-pdf-renderer-v2";
import {
  decode,
  requireTableAccess,
  unsupported,
  withBook,
  type JsonObject,
  type Scope,
} from "./support";

const DocumentCaptureSchema = Documents.InvoiceDocumentCapture;

const DocumentViewSchema = Documents.InvoiceDocumentView;

const DocumentHistorySchema = Documents.InvoiceDocumentHistory;

const DocumentPrepareSchema = Documents.PrepareInvoiceDocument;

const IssueReceiptSchema = Issuance.InvoiceIssueReceipt;

const IssueReviewSchema = Issuance.InvoiceIssueReview;

const PdfCaptureSchema = Pdf.InvoicePdfCapture;

const PdfViewSchema = Pdf.InvoicePdfView;

const PdfHistorySchema = Pdf.InvoicePdfHistory;

const PdfPrepareSchema = Pdf.PrepareInvoicePdf;

const LegalCaptureSchema = LegalPdf.LegalInvoicePdfCapture;

const LegalIssueSchema = Ar.ArLegalIssueReceipt;

const LegalViewSchema = LegalPdf.LegalInvoicePdfView;

const LegalHistorySchema = LegalPdf.LegalInvoicePdfHistory;

const LegalPrepareSchema = LegalPdf.PrepareLegalInvoicePdf;

const maxArtifactBytes = 1048576;

const maxLegalArtifactBytes = 2097152;

const reviewBoundary = "SYNTHETIC REVIEW DOCUMENT — NOT A LEGAL INVOICE — NOT DELIVERED";

const canonicalBase64 = /^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;

const sha256Hex = /^[a-f0-9]{64}$/u;

export type RenderedSeal = {
  readonly captureDigest: string;
  readonly sourceDigest: string;
  readonly generatorVersion: string;
  readonly contentBase64: string;
  readonly sha256: string;
  readonly byteLength: number;
};

function base64(bytes: Uint8Array) {
  let binary = "";

  for (const byte of bytes) binary += String.fromCharCode(byte);

  return btoa(binary);
}

function bytesEqual(left: Uint8Array, right: Uint8Array) {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}

export function decodeBase64(value: string, maxBytes: number) {
  if (!canonicalBase64.test(value) || value.length < 4) return failure("InvalidJournal");

  return Effect.try({
    try: () => Uint8Array.from(atob(value), (character) => character.charCodeAt(0)),
    catch: () => failure("InvalidJournal"),
  }).pipe(
    Effect.flatMap((bytes) =>
      bytes.length < 1 || bytes.length > maxBytes
        ? failure("InvalidJournal")
        : Effect.succeed(bytes),
    ),
  );
}

export function sha256HexOf(bytes: Uint8Array) {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);

  return Effect.tryPromise({
    try: () => crypto.subtle.digest("SHA-256", copy),
    catch: () => failure("InternalError"),
  }).pipe(
    Effect.map((hash) =>
      Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join(""),
    ),
  );
}

function renderFailure(error: unknown) {
  return error instanceof Accounting.AccountingError ? error : failure("InternalError");
}

function hasReviewBoundaries(bytes: Uint8Array) {
  return Effect.try({
    try: () => {
      const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);

      return (
        text.startsWith("<!doctype html>") &&
        text.endsWith("</html>\n") &&
        text.includes(reviewBoundary)
      );
    },
    catch: () => false,
  });
}

function startsWithPdf(bytes: Uint8Array, prefix: string) {
  return String.fromCharCode(...bytes.subarray(0, prefix.length)) === prefix;
}

function digestOf(value: JsonObject) {
  return digestNative(value);
}

function sealedBody(withoutDigest: JsonObject) {
  return digestOf(withoutDigest).pipe(
    Effect.map((digest): JsonObject => Object.assign({}, withoutDigest, { digest })),
  );
}

function requireSealDeclaration(sealed: RenderedSeal) {
  return sha256Hex.test(sealed.sha256) &&
    Number.isInteger(sealed.byteLength) &&
    sealed.byteLength > 0
    ? Effect.void
    : failure("InvalidJournal");
}

function withArtifact(
  capture: JsonObject,
  artifact: CaptureDb.ArtifactRow | undefined,
): JsonObject {
  return artifact
    ? {
        capture,
        artifact: Object.assign({}, artifact.descriptor, {
          contentBase64: artifact.contentBase64,
        }),
      }
    : { capture, artifact: null };
}

function readDocumentView(transaction: Transaction, bookId: string, id: string) {
  return Effect.gen(function* () {
    const captures = yield* CaptureDb.readDocumentCapture(transaction, bookId, id);
    const capture = captures[0];

    if (!capture) return yield* failure("NotFound");
    const artifacts = yield* CaptureDb.readDocumentArtifact(transaction, bookId, id);

    return yield* decode(DocumentViewSchema, withArtifact(capture.body, artifacts[0]));
  });
}

function readPdfView(transaction: Transaction, bookId: string, id: string) {
  return Effect.gen(function* () {
    const captures = yield* CaptureDb.readPdfCapture(transaction, bookId, id);
    const capture = captures[0];

    if (!capture) return yield* failure("NotFound");
    const artifacts = yield* CaptureDb.readPdfArtifact(transaction, bookId, id);

    return yield* decode(PdfViewSchema, withArtifact(capture.body, artifacts[0]));
  });
}

function readLegalPdfView(transaction: Transaction, bookId: string, id: string) {
  return Effect.gen(function* () {
    const captures = yield* CaptureDb.readLegalCapture(transaction, bookId, id);
    const capture = captures[0];

    if (!capture) return yield* failure("NotFound");
    const artifacts = yield* CaptureDb.readLegalArtifact(transaction, bookId, id);

    return yield* decode(LegalViewSchema, withArtifact(capture.body, artifacts[0]));
  });
}

function readIssueCapture(
  transaction: Transaction,
  bookId: string,
  issueId: string,
  lock: "share" | "update",
) {
  return Effect.gen(function* () {
    const rows = yield* CaptureDb.readIssueWithReview(transaction, bookId, issueId, lock);
    const row = rows[0];

    if (!row) return yield* failure("NotFound");
    const issue = yield* decode(IssueReceiptSchema, row.issue);
    const review = yield* decode(IssueReviewSchema, row.review);

    return { reviewId: row.reviewId, issue, review, issueBody: row.issue, reviewBody: row.review };
  });
}

function requireSyntheticIssue(
  issue: typeof IssueReceiptSchema.Type,
  review: typeof IssueReviewSchema.Type,
  scope: Scope,
) {
  if (
    issue.reviewDigest !== review.digest ||
    issue.draftDigest !== review.draftSnapshot.digest ||
    issue.draftId !== review.draftSnapshot.id ||
    issue.draftRevision !== review.draftSnapshot.revision ||
    !equalJson(issue.scope, scope) ||
    !equalJson(review.scope, scope)
  ) {
    return failure("StaleDependency");
  }

  if (
    issue.profile !== "synthetic-manual-invoice-v1" ||
    review.profile !== "synthetic-manual-invoice-v1" ||
    issue.issued !== true ||
    issue.recognized !== true ||
    issue.legalInvoice !== false ||
    issue.delivered !== false ||
    issue.legalDocumentNumber !== null
  ) {
    return unsupported();
  }

  return Effect.void;
}

function requireRegisterAgreement(
  transaction: Transaction,
  bookId: string,
  review: typeof IssueReviewSchema.Type,
  issue: typeof IssueReceiptSchema.Type,
) {
  const binding: CaptureDb.IssueRegisterBinding = {
    postingReceipt: issue.postingReceipt,
    changeSetId: review.postingPlan.id,
    registerInvoiceId: issue.registerInvoiceId,
    voucherId: issue.postingReceipt.voucherId,
    documentNumber: issue.internalDocumentNumber,
  };

  return CaptureDb.readIssueRegisterAgreement(transaction, bookId, binding).pipe(
    Effect.flatMap((rows) => (rows[0]?.agreed === true ? Effect.void : failure("StaleDependency"))),
  );
}

function requireReviewEvidence(
  transaction: Transaction,
  bookId: string,
  review: typeof IssueReviewSchema.Type,
  code: "MissingEvidence" | "StaleDependency",
) {
  return CaptureDb.readEvidenceAgreement(
    transaction,
    bookId,
    review.evidence.id,
    review.evidence.sha256,
  ).pipe(Effect.flatMap((rows) => (rows[0]?.agreed === true ? Effect.void : failure(code))));
}

export const getInvoiceDocument = Effect.fn("commerce.documents.get")(function* (
  token: string,
  input: { scope: Scope; id: string },
) {
  return yield* withBook(token, input.scope, false, function* (transaction) {
    yield* requireTableAccess(transaction, CaptureDb.invoiceDocumentTables, false);

    return yield* readDocumentView(transaction, input.scope.bookId, input.id);
  });
});

export const invoiceDocumentHistory = Effect.fn("commerce.documents.history")(function* (
  token: string,
  input: { scope: Scope; id: string },
) {
  return yield* withBook(token, input.scope, false, function* (transaction) {
    yield* requireTableAccess(transaction, CaptureDb.invoiceDocumentTables, false);

    const issues = yield* CaptureDb.readIssueWithReview(
      transaction,
      input.scope.bookId,
      input.id,
      "share",
    );

    if (issues.length === 0) return yield* failure("NotFound");
    const rows = yield* CaptureDb.readDocumentHistory(transaction, input.scope.bookId, input.id);

    return yield* decode(DocumentHistorySchema, {
      scope: input.scope,
      issueId: input.id,
      complete: true,
      items: rows.map((row) => ({
        id: row.id,
        captureDigest: row.captureDigest,
        createdAt: row.createdAt,
        generatorVersion: row.generatorVersion,
        sealed: row.sealed,
        sha256: row.sha256,
      })),
    });
  });
});

export const captureInvoiceDocument = Effect.fn("commerce.documents.capture")(function* (
  token: string,
  command: {
    scope: Scope;
    idempotencyKey: string;
    input: typeof Documents.PrepareInvoiceDocument.Type;
  },
) {
  return yield* withBook(
    token,
    command.scope,
    false,
    function* (transaction, principal) {
      const request = yield* replay(
        transaction,
        command.scope,
        command.idempotencyKey,
        "capture_invoice_document",
        principal.actorId,
        command.input,
        DocumentCaptureSchema,
      );

      if (request.previous) return request.previous;
      yield* requireTableAccess(transaction, CaptureDb.invoiceDocumentTables, true);
      yield* lockBookForUpdate(transaction, command.scope);
      const input = yield* decode(DocumentPrepareSchema, command.input);

      const source = yield* readIssueCapture(
        transaction,
        command.scope.bookId,
        input.issueId,
        "update",
      );

      if (source.issue.digest !== input.issueDigest) return yield* failure("StaleDependency");
      yield* requireSyntheticIssue(source.issue, source.review, command.scope);
      yield* requireRegisterAgreement(
        transaction,
        command.scope.bookId,
        source.review,
        source.issue,
      );
      yield* requireReviewEvidence(
        transaction,
        command.scope.bookId,
        source.review,
        "MissingEvidence",
      );

      const existing = yield* CaptureDb.readDocumentCaptureByGenerator(
        transaction,
        command.scope.bookId,
        input.issueId,
        input.generatorVersion,
      );

      const previous = existing[0];

      if (previous) {
        if (!equalJson(previous.body.input, input)) {
          return yield* failure("IdempotencyConflict");
        }

        return yield* saveCapture(
          transaction,
          command,
          principal,
          request.expected,
          "capture_invoice_document",
          DocumentCaptureSchema,
          previous.body,
        );
      }

      const captureSource: JsonObject = { review: source.reviewBody, issue: source.issueBody };
      const id = newId("invoice_document");

      const body = yield* sealedBody({
        id,
        scope: command.scope,
        input,
        generatorVersion: input.generatorVersion,
        format: "synthetic-invoice-review-html",
        language: "en",
        source: captureSource,
        sourceDigest: yield* digestOf(captureSource),
        createdBy: principal.actorId,
        createdAt: yield* isoNow(transaction),
        historicalOnly: true,
        legalInvoice: false,
        delivered: false,
      });

      if (JSON.stringify(body).length > 524288) return yield* failure("UnsupportedProfile");
      yield* CaptureDb.insertDocumentCapture(transaction, {
        bookId: command.scope.bookId,
        id,
        issueId: input.issueId,
        reviewId: source.reviewId,
        generatorVersion: input.generatorVersion,
        actorId: principal.actorId,
        body,
      });

      return yield* saveCapture(
        transaction,
        command,
        principal,
        request.expected,
        "capture_invoice_document",
        DocumentCaptureSchema,
        body,
      );
    },
    "update",
  );
});

function saveCapture<A extends JsonObject>(
  transaction: Transaction,
  command: { scope: Scope; idempotencyKey: string },
  principal: { actorId: string },
  expected: string,
  operation: string,
  schema: Schema.Decoder<A>,
  body: JsonObject,
) {
  return Effect.gen(function* () {
    const result = yield* decode(schema, body);
    yield* saveCommand(
      transaction,
      command.scope,
      command.idempotencyKey,
      expected,
      operation,
      principal.actorId,
      result,
    );

    return result;
  });
}

export const resumeInvoiceDocument = Effect.fn("commerce.documents.resume")(function* (
  token: string,
  input: { scope: Scope; id: string },
) {
  const view = yield* getInvoiceDocument(token, input);

  if (view.artifact) return view;

  const bytes = yield* Effect.try({
    try: () => renderInvoiceDocument(view.capture),
    catch: renderFailure,
  });

  return yield* sealInvoiceDocument(token, {
    scope: input.scope,
    id: input.id,
    sealed: {
      captureDigest: view.capture.digest,
      sourceDigest: view.capture.sourceDigest,
      generatorVersion: view.capture.generatorVersion,
      contentBase64: base64(bytes),
      sha256: yield* sha256HexOf(bytes),
      byteLength: bytes.length,
    },
  });
});

export const sealInvoiceDocument = Effect.fn("commerce.documents.seal")(function* (
  token: string,
  command: { scope: Scope; id: string; sealed: RenderedSeal },
) {
  return yield* withBook(
    token,
    command.scope,
    false,
    function* (transaction) {
      yield* requireTableAccess(transaction, CaptureDb.invoiceDocumentTables, true);
      yield* lockBookForUpdate(transaction, command.scope);
      yield* requireSealDeclaration(command.sealed);

      const captures = yield* CaptureDb.readDocumentCapture(
        transaction,
        command.scope.bookId,
        command.id,
      );

      const capture = captures[0];

      if (!capture) return yield* failure("NotFound");
      const captureValue = yield* decode(DocumentCaptureSchema, capture.body);

      if (
        captureValue.digest !== command.sealed.captureDigest ||
        captureValue.sourceDigest !== command.sealed.sourceDigest ||
        captureValue.generatorVersion !== command.sealed.generatorVersion
      ) {
        return yield* failure("StaleDependency");
      }

      const agreement = yield* CaptureDb.readIssueReviewAgreement(
        transaction,
        command.scope.bookId,
        capture.issueId,
        capture.reviewId,
        captureValue.source.issue,
        captureValue.source.review,
      );

      if (agreement[0]?.agreed !== true) return yield* failure("StaleDependency");
      const bytes = yield* decodeBase64(command.sealed.contentBase64, maxArtifactBytes);

      if (
        bytes.length !== command.sealed.byteLength ||
        (yield* sha256HexOf(bytes)) !== command.sealed.sha256
      ) {
        return yield* failure("InvalidJournal");
      }

      if (!(yield* hasReviewBoundaries(bytes))) return yield* failure("InvalidJournal");

      const existing = yield* CaptureDb.readSealedBytes(
        transaction,
        "invoice_document_artifacts",
        command.scope.bookId,
        command.id,
      );

      const sealedBytes = existing[0]?.content;

      if (sealedBytes) {
        if (!bytesEqual(sealedBytes, bytes)) return yield* failure("IdempotencyConflict");

        return yield* readDocumentView(transaction, command.scope.bookId, command.id);
      }

      yield* CaptureDb.insertArtifact(transaction, "invoice_document_artifacts", {
        bookId: command.scope.bookId,
        captureId: command.id,
        descriptor: {
          captureId: command.id,
          scope: captureValue.scope,
          captureDigest: command.sealed.captureDigest,
          sourceDigest: command.sealed.sourceDigest,
          issueId: capture.issueId,
          issueDigest: captureValue.input.issueDigest,
          generatorVersion: command.sealed.generatorVersion,
          format: "synthetic-invoice-review-html",
          language: "en",
          encoding: "UTF-8",
          mediaType: "text/html",
          filename: documentFilename(command.sealed.generatorVersion, command.id, captureValue),
          byteLength: bytes.length,
          sha256: command.sealed.sha256,
          sealedAt: yield* isoNow(transaction),
          historicalOnly: true,
          legalInvoice: false,
          delivered: false,
        },
        content: bytes,
      });

      return yield* readDocumentView(transaction, command.scope.bookId, command.id);
    },
    "update",
  );
});

function documentFilename(
  generatorVersion: string,
  captureId: string,
  capture: typeof DocumentCaptureSchema.Type,
) {
  if (generatorVersion !== Documents.invoiceDocumentGenerator) return `${captureId}.html`;

  return `invoice-${capture.source.issue.internalDocumentNumber.replace(/[^a-zA-Z0-9_-]/gu, "")}.html`;
}

export const prepareInvoiceDocument = Effect.fn("commerce.documents.prepare")(function* (
  token: string,
  command: {
    scope: Scope;
    idempotencyKey: string;
    input: typeof Documents.PrepareInvoiceDocument.Type;
  },
) {
  const capture = yield* captureInvoiceDocument(token, command);

  return yield* resumeInvoiceDocument(token, { scope: command.scope, id: capture.id });
});

export const getInvoicePdf = Effect.fn("commerce.pdfs.get")(function* (
  token: string,
  input: { scope: Scope; id: string },
) {
  return yield* withBook(token, input.scope, false, function* (transaction) {
    yield* requireTableAccess(transaction, CaptureDb.invoicePdfTables, false);

    return yield* readPdfView(transaction, input.scope.bookId, input.id);
  });
});

export const invoicePdfHistory = Effect.fn("commerce.pdfs.history")(function* (
  token: string,
  input: { scope: Scope; id: string },
) {
  return yield* withBook(token, input.scope, false, function* (transaction) {
    yield* requireTableAccess(transaction, CaptureDb.invoicePdfTables, false);

    const issues = yield* CaptureDb.readIssueWithReview(
      transaction,
      input.scope.bookId,
      input.id,
      "share",
    );

    if (issues.length === 0) return yield* failure("NotFound");
    const rows = yield* CaptureDb.readPdfHistory(transaction, input.scope.bookId, input.id);

    return yield* decode(PdfHistorySchema, {
      scope: input.scope,
      issueId: input.id,
      complete: true,
      items: rows.map((row) => ({
        id: row.id,
        digest: row.captureDigest,
        sealed: row.sealed,
        sha256: row.sha256,
      })),
    });
  });
});

export const captureInvoicePdf = Effect.fn("commerce.pdfs.capture")(function* (
  token: string,
  command: { scope: Scope; idempotencyKey: string; input: typeof Pdf.PrepareInvoicePdf.Type },
) {
  return yield* withBook(
    token,
    command.scope,
    false,
    function* (transaction, principal) {
      const request = yield* replay(
        transaction,
        command.scope,
        command.idempotencyKey,
        "capture_invoice_pdf",
        principal.actorId,
        command.input,
        PdfCaptureSchema,
      );

      if (request.previous) return request.previous;
      yield* requireTableAccess(transaction, CaptureDb.invoicePdfTables, true);
      yield* lockBookForUpdate(transaction, command.scope);
      const input = yield* decode(PdfPrepareSchema, command.input);

      const source = yield* readIssueCapture(
        transaction,
        command.scope.bookId,
        input.issueId,
        "update",
      );

      if (source.issue.digest !== input.issueDigest) return yield* failure("StaleDependency");
      yield* requireSyntheticIssue(source.issue, source.review, command.scope);
      yield* requireRegisterAgreement(
        transaction,
        command.scope.bookId,
        source.review,
        source.issue,
      );
      yield* requireReviewEvidence(
        transaction,
        command.scope.bookId,
        source.review,
        "StaleDependency",
      );

      const existing = yield* CaptureDb.readPdfCaptureByIssue(
        transaction,
        command.scope.bookId,
        input.issueId,
      );

      const previous = existing[0];

      if (previous) {
        if (!equalJson(previous.body.input, input)) {
          return yield* failure("IdempotencyConflict");
        }

        return yield* saveCapture(
          transaction,
          command,
          principal,
          request.expected,
          "capture_invoice_pdf",
          PdfCaptureSchema,
          previous.body,
        );
      }

      const captureSource: JsonObject = { review: source.reviewBody, issue: source.issueBody };
      const id = newId("invoice_pdf");

      const body = yield* sealedBody({
        id,
        scope: command.scope,
        input,
        source: captureSource,
        sourceDigest: yield* digestOf(captureSource),
        createdBy: principal.actorId,
        createdAt: yield* isoNow(transaction),
        historicalOnly: true,
        legalInvoice: false,
        delivered: false,
      });

      if (JSON.stringify(body).length > 524288) return yield* failure("UnsupportedProfile");
      yield* CaptureDb.insertPdfCapture(transaction, {
        bookId: command.scope.bookId,
        id,
        issueId: input.issueId,
        actorId: principal.actorId,
        body,
      });

      return yield* saveCapture(
        transaction,
        command,
        principal,
        request.expected,
        "capture_invoice_pdf",
        PdfCaptureSchema,
        body,
      );
    },
    "update",
  );
});

export const resumeInvoicePdf = Effect.fn("commerce.pdfs.resume")(function* (
  token: string,
  input: { scope: Scope; id: string },
) {
  const view = yield* getInvoicePdf(token, input);

  if (view.artifact) return view;

  const rendered = yield* Effect.try({
    try: () => new Uint8Array(renderInvoicePdf(view.capture)),
    catch: renderFailure,
  });

  return yield* sealInvoicePdf(token, {
    scope: input.scope,
    id: input.id,
    sealed: {
      captureDigest: view.capture.digest,
      sourceDigest: view.capture.sourceDigest,
      generatorVersion: view.capture.input.generatorVersion,
      contentBase64: base64(rendered),
      sha256: yield* sha256HexOf(rendered),
      byteLength: rendered.length,
    },
  });
});

export const sealInvoicePdf = Effect.fn("commerce.pdfs.seal")(function* (
  token: string,
  command: { scope: Scope; id: string; sealed: RenderedSeal },
) {
  return yield* withBook(
    token,
    command.scope,
    false,
    function* (transaction) {
      yield* requireTableAccess(transaction, CaptureDb.invoicePdfTables, true);
      yield* lockBookForUpdate(transaction, command.scope);
      yield* requireSealDeclaration(command.sealed);

      const captures = yield* CaptureDb.readPdfCapture(
        transaction,
        command.scope.bookId,
        command.id,
      );

      const capture = captures[0];

      if (!capture) return yield* failure("NotFound");

      if (
        capture.body.digest !== command.sealed.captureDigest ||
        capture.body.sourceDigest !== command.sealed.sourceDigest
      ) {
        return yield* failure("StaleDependency");
      }

      const captureValue = yield* decode(PdfCaptureSchema, capture.body);

      const agreement = yield* CaptureDb.readPdfSourceAgreement(
        transaction,
        command.scope.bookId,
        capture.issueId,
        captureValue.source.issue,
        captureValue.source.review,
      );

      if (agreement[0]?.agreed !== true) return yield* failure("StaleDependency");
      const bytes = yield* decodeBase64(command.sealed.contentBase64, maxArtifactBytes);

      if (
        bytes.length !== command.sealed.byteLength ||
        (yield* sha256HexOf(bytes)) !== command.sealed.sha256 ||
        !startsWithPdf(bytes, "%PDF-1.4")
      ) {
        return yield* failure("InvalidJournal");
      }

      const existing = yield* CaptureDb.readSealedBytes(
        transaction,
        "invoice_pdf_artifacts",
        command.scope.bookId,
        command.id,
      );

      const sealedBytes = existing[0]?.content;

      if (sealedBytes) {
        if (!bytesEqual(sealedBytes, bytes)) return yield* failure("IdempotencyConflict");

        return yield* readPdfView(transaction, command.scope.bookId, command.id);
      }

      yield* CaptureDb.insertArtifact(transaction, "invoice_pdf_artifacts", {
        bookId: command.scope.bookId,
        captureId: command.id,
        descriptor: {
          captureId: command.id,
          captureDigest: command.sealed.captureDigest,
          filename: `${command.id}.pdf`,
          mediaType: "application/pdf",
          byteLength: bytes.length,
          sha256: command.sealed.sha256,
          sealedAt: yield* isoNow(transaction),
          legalInvoice: false,
          delivered: false,
        },
        content: bytes,
      });

      return yield* readPdfView(transaction, command.scope.bookId, command.id);
    },
    "update",
  );
});

export const prepareInvoicePdf = Effect.fn("commerce.pdfs.prepare")(function* (
  token: string,
  command: { scope: Scope; idempotencyKey: string; input: typeof Pdf.PrepareInvoicePdf.Type },
) {
  const capture = yield* captureInvoicePdf(token, command);

  return yield* resumeInvoicePdf(token, { scope: command.scope, id: capture.id });
});

export const getLegalInvoicePdf = Effect.fn("commerce.legalPdfs.get")(function* (
  token: string,
  input: { scope: Scope; id: string },
) {
  return yield* withBook(token, input.scope, false, function* (transaction) {
    yield* requireTableAccess(transaction, CaptureDb.legalInvoicePdfTables, false);

    return yield* readLegalPdfView(transaction, input.scope.bookId, input.id);
  });
});

export const legalInvoicePdfHistory = Effect.fn("commerce.legalPdfs.history")(function* (
  token: string,
  input: { scope: Scope; id: string },
) {
  return yield* withBook(token, input.scope, false, function* (transaction) {
    yield* requireTableAccess(transaction, CaptureDb.legalInvoicePdfTables, false);
    const issues = yield* CaptureDb.readLegalIssue(transaction, input.scope.bookId, input.id);

    if (issues.length === 0) return yield* failure("NotFound");
    const rows = yield* CaptureDb.readLegalPdfHistory(transaction, input.scope.bookId, input.id);

    return yield* decode(LegalHistorySchema, {
      scope: input.scope,
      issueId: input.id,
      complete: true,
      items: rows.map((row) => ({
        id: row.id,
        digest: row.captureDigest,
        sealed: row.sealed,
        sha256: row.sha256,
      })),
    });
  });
});

export const captureLegalInvoicePdf = Effect.fn("commerce.legalPdfs.capture")(function* (
  token: string,
  command: {
    scope: Scope;
    idempotencyKey: string;
    input: typeof LegalPdf.PrepareLegalInvoicePdf.Type;
  },
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (transaction, principal) {
      const request = yield* replay(
        transaction,
        command.scope,
        command.idempotencyKey,
        "capture_ar_legal_pdf",
        principal.actorId,
        command.input,
        LegalCaptureSchema,
      );

      if (request.previous) return request.previous;
      yield* requireTableAccess(transaction, CaptureDb.legalInvoicePdfTables, true);
      yield* lockBookForUpdate(transaction, command.scope);
      const input = yield* decode(LegalPrepareSchema, command.input);

      const rows = yield* CaptureDb.readLegalIssue(
        transaction,
        command.scope.bookId,
        input.issueId,
      );

      const row = rows[0];

      if (!row) return yield* failure("NotFound");
      const issue = yield* decode(LegalIssueSchema, row.body);

      if (
        issue.digest !== input.issueDigest ||
        !equalJson(issue.scope, command.scope) ||
        issue.issued !== true ||
        issue.legalInvoice !== true ||
        issue.recognized !== true ||
        issue.delivered !== false ||
        issue.policySnapshot.digest !== issue.policyDigest ||
        issue.issuedOn !== issue.draftSnapshot.content.plannedIssueDate ||
        !issue.issuedAt.startsWith(issue.issuedOn) ||
        issue.legalDocumentNumber.startsWith("SYN-")
      ) {
        return yield* failure("StaleDependency");
      }

      const legalBinding: CaptureDb.LegalIssueBinding = {
        policyId: issue.policyId,
        policySnapshot: issue.policySnapshot,
        postingReceipt: issue.postingReceipt,
        voucherId: issue.postingReceipt.voucherId,
        registerInvoiceId: issue.registerInvoiceId,
        documentNumber: issue.legalDocumentNumber,
      };

      const agreement = yield* CaptureDb.readLegalIssueAgreement(
        transaction,
        command.scope.bookId,
        legalBinding,
      );

      if (agreement[0]?.agreed !== true) return yield* failure("StaleDependency");

      const existing = yield* CaptureDb.readLegalCaptureByIssue(
        transaction,
        command.scope.bookId,
        input.issueId,
      );

      const previous = existing[0];

      if (previous) {
        if (!equalJson(previous.body.input, input)) {
          return yield* failure("IdempotencyConflict");
        }

        return yield* saveCapture(
          transaction,
          command,
          principal,
          request.expected,
          "capture_ar_legal_pdf",
          LegalCaptureSchema,
          previous.body,
        );
      }

      const captureSource: JsonObject = { issue: row.body };
      const id = newId("ar_pdf");

      const body = yield* sealedBody({
        id,
        scope: command.scope,
        issueId: input.issueId,
        input,
        source: captureSource,
        sourceDigest: yield* digestOf(captureSource),
        createdBy: principal.actorId,
        createdAt: yield* isoNow(transaction),
      });

      if (JSON.stringify(body).length > 524288) return yield* failure("UnsupportedProfile");
      yield* CaptureDb.insertLegalCapture(transaction, {
        bookId: command.scope.bookId,
        id,
        issueId: input.issueId,
        body,
      });

      return yield* saveCapture(
        transaction,
        command,
        principal,
        request.expected,
        "capture_ar_legal_pdf",
        LegalCaptureSchema,
        body,
      );
    },
    "update",
  );
});

export const resumeLegalInvoicePdf = Effect.fn("commerce.legalPdfs.resume")(function* (
  token: string,
  input: { scope: Scope; id: string },
) {
  const view = yield* getLegalInvoicePdf(token, input);

  if (view.artifact) return view;
  const version = view.capture.input.rendererVersion;

  const rendered = new Uint8Array(
    yield* Effect.gen(function* () {
      if (version === "openerp-se-invoice-takumi-v1") {
        return yield* Effect.tryPromise({
          try: () => renderLegalInvoicePdf(view.capture),
          catch: renderFailure,
        });
      }

      if (version === "openerp-se-invoice-takumi-v2") {
        return yield* Effect.tryPromise({
          try: () => renderLegalInvoicePdfV2(view.capture),
          catch: renderFailure,
        });
      }

      return yield* unsupported();
    }),
  );

  return yield* sealLegalInvoicePdf(token, {
    scope: input.scope,
    id: input.id,
    sealed: {
      captureDigest: view.capture.digest,
      sourceDigest: view.capture.sourceDigest,
      generatorVersion: version,
      contentBase64: base64(rendered),
      sha256: yield* sha256HexOf(rendered),
      byteLength: rendered.length,
    },
  });
});

export const sealLegalInvoicePdf = Effect.fn("commerce.legalPdfs.seal")(function* (
  token: string,
  command: { scope: Scope; id: string; sealed: RenderedSeal },
) {
  return yield* withBook(
    token,
    command.scope,
    false,
    function* (transaction) {
      yield* requireTableAccess(transaction, CaptureDb.legalInvoicePdfTables, true);
      yield* lockBookForUpdate(transaction, command.scope);
      yield* requireSealDeclaration(command.sealed);

      const captures = yield* CaptureDb.readLegalCapture(
        transaction,
        command.scope.bookId,
        command.id,
      );

      const capture = captures[0];

      if (!capture) return yield* failure("NotFound");
      const captureValue = yield* decode(LegalCaptureSchema, capture.body);
      const rendererVersion = captureValue.input.rendererVersion;

      if (rendererVersion !== command.sealed.generatorVersion) return yield* unsupported();

      if (
        captureValue.digest !== command.sealed.captureDigest ||
        captureValue.sourceDigest !== command.sealed.sourceDigest
      ) {
        return yield* failure("StaleDependency");
      }

      const bytes = yield* decodeBase64(command.sealed.contentBase64, maxLegalArtifactBytes);

      if (
        bytes.length !== command.sealed.byteLength ||
        (yield* sha256HexOf(bytes)) !== command.sealed.sha256 ||
        !startsWithPdf(bytes, "%PDF-")
      ) {
        return yield* failure("InvalidJournal");
      }

      const agreement = yield* CaptureDb.readLegalIssueSourceAgreement(
        transaction,
        command.scope.bookId,
        capture.issueId,
        captureValue.source.issue,
      );

      if (agreement[0]?.agreed !== true) return yield* failure("StaleDependency");

      const existing = yield* CaptureDb.readSealedBytes(
        transaction,
        "ar_legal_pdf_artifacts",
        command.scope.bookId,
        command.id,
      );

      const sealedBytes = existing[0]?.content;

      if (sealedBytes) {
        if (!bytesEqual(sealedBytes, bytes)) return yield* failure("IdempotencyConflict");

        return yield* readLegalPdfView(transaction, command.scope.bookId, command.id);
      }

      yield* CaptureDb.insertArtifact(transaction, "ar_legal_pdf_artifacts", {
        bookId: command.scope.bookId,
        captureId: command.id,
        descriptor: {
          captureId: command.id,
          captureDigest: command.sealed.captureDigest,
          filename: `${captureValue.source.issue.legalDocumentNumber}.pdf`,
          mediaType: "application/pdf",
          byteLength: bytes.length,
          sha256: command.sealed.sha256,
          sealedAt: yield* isoNow(transaction),
          legalInvoice: true,
          delivered: false,
          rendererVersion,
        },
        content: bytes,
      });

      return yield* readLegalPdfView(transaction, command.scope.bookId, command.id);
    },
    "update",
  );
});

export const prepareLegalInvoicePdf = Effect.fn("commerce.legalPdfs.prepare")(function* (
  token: string,
  command: {
    scope: Scope;
    idempotencyKey: string;
    input: typeof LegalPdf.PrepareLegalInvoicePdf.Type;
  },
) {
  const capture = yield* captureLegalInvoicePdf(token, command);

  return yield* resumeLegalInvoicePdf(token, { scope: command.scope, id: capture.id });
});
