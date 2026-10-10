import * as Collections from "@open-erp/contracts/collections";
import * as LegalPdf from "@open-erp/contracts/legal-invoice-pdf";
import * as Effect from "effect/Effect";
import { equalJson } from "@open-erp/domain/canonicalization";
import * as DocumentDb from "../../db/commerce/documents";
import type { Transaction } from "../../db/transaction";
import { sha256HexOf } from "../bytes";
import { failure } from "../failures";
import { newId } from "../identifiers";
import {
  decodeBase64,
  legalInvoicePdfHistory,
  prepareLegalInvoicePdf,
  resumeLegalInvoicePdf,
} from "./documents";
import { getArLegalIssue } from "./legal";
import { decode, objectField, type Scope } from "./support";

export const ensureReminderInvoicePdf = Effect.fn("commerce.reminders.ensureInvoicePdf")(function* (
  token: string,
  scope: Scope,
  issueId: string,
) {
  const history = yield* legalInvoicePdfHistory(token, { scope, id: issueId });
  const existing = history.items[0];

  if (existing?.sealed) return;

  if (existing) {
    yield* resumeLegalInvoicePdf(token, { scope, id: existing.id });

    return;
  }

  const issue = yield* getArLegalIssue(token, { scope, id: issueId });

  yield* prepareLegalInvoicePdf(token, {
    scope,
    idempotencyKey: newId("reminder_pdf"),
    input: {
      issueId,
      issueDigest: issue.digest,
      rendererVersion: LegalPdf.legalInvoiceRendererVersion,
    },
  });
});

export function readReminderInvoiceAttachment(tx: Transaction, scope: Scope, issueId: string) {
  return Effect.gen(function* () {
    const row = (yield* DocumentDb.readLegalCaptureByIssue(tx, scope.bookId, issueId))[0];

    if (!row) return yield* failure("StaleDependency");

    const capture = yield* decode(LegalPdf.LegalInvoicePdfCapture, row.body).pipe(
      Effect.mapError(() => failure("StaleDependency")),
    );

    const stored = (yield* DocumentDb.readLegalArtifact(tx, scope.bookId, capture.id))[0];

    if (!stored) return yield* failure("StaleDependency");

    const artifact = yield* decode(LegalPdf.LegalInvoicePdfArtifact, {
      captureId: stored.descriptor.captureId ?? null,
      captureDigest: stored.descriptor.captureDigest ?? null,
      filename: stored.descriptor.filename ?? null,
      mediaType: stored.descriptor.mediaType ?? null,
      byteLength: stored.descriptor.byteLength ?? null,
      sha256: stored.descriptor.sha256 ?? null,
      sealedAt: stored.descriptor.sealedAt ?? null,
      legalInvoice: stored.descriptor.legalInvoice ?? null,
      delivered: stored.descriptor.delivered ?? null,
      rendererVersion: stored.descriptor.rendererVersion ?? null,
      contentBase64: stored.contentBase64,
    }).pipe(Effect.mapError(() => failure("StaleDependency")));

    const bytes = yield* decodeBase64(artifact.contentBase64, 2097152).pipe(
      Effect.mapError(() => failure("StaleDependency")),
    );

    const issue = (yield* DocumentDb.readLegalIssue(tx, scope.bookId, issueId))[0];

    if (
      capture.issueId !== issueId ||
      !equalJson(capture.scope, scope) ||
      !issue ||
      !equalJson(issue.body, objectField(objectField(row.body, "source"), "issue")) ||
      artifact.captureId !== capture.id ||
      artifact.captureDigest !== capture.digest ||
      artifact.byteLength !== bytes.byteLength ||
      artifact.sha256 !== (yield* sha256HexOf(bytes))
    )
      return yield* failure("StaleDependency");

    const reference = yield* decode(Collections.ReminderAttachment, artifact);

    return { reference, contentBase64: artifact.contentBase64 };
  });
}
