import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as O from "@open-erp/contracts/onboarding";
import * as A from "@open-erp/contracts/accounting";
import type * as Intake from "@open-erp/contracts/source-intake";
import * as Sie from "@open-erp/contracts/sie-import";
import * as Db from "../db/onboarding-lifecycle";
import * as Sources from "../db/sie-import";
import type { Transaction } from "../db/transaction";
import { decode, type Scope } from "./commerce/support";
import { readSourceBytesInTransaction } from "./source-retention";
import { isoNow, newId } from "./posting";
import { failure } from "./failures";

const Document = Schema.Struct({
  kind: Schema.Literal("onboarding_invoice_source_v1"),
  documentNumber: Schema.String,
  counterpartyName: Schema.String,
  currency: Schema.String,
  amountMinor: A.MinorUnits,
  correctsOccurrenceId: Schema.optionalKey(A.Identifier),
});

const Report = Schema.Struct({
  previewId: A.Identifier,
  previewDigest: A.Digest,
  findings: Schema.Array(
    Schema.Struct({
      voucherOrdinal: Schema.Int,
      kind: Schema.Literals(["duplicate_candidate", "unsupported_currency"]),
      occurrenceIds: Schema.Array(A.Identifier).check(Schema.isMinLength(1), Schema.isMaxLength(2)),
      resolutionOccurrenceId: Schema.NullOr(A.Identifier),
    }),
  ).check(Schema.isMaxLength(1000)),
});

const json = (bytes: Uint8Array) =>
  Effect.try({
    try: () =>
      JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes)),
    catch: () => failure("InvalidJournal"),
  });

export const qualifyImportReview = Effect.fn("onboarding.qualifyImportReview")(function* (
  tx: Transaction,
  scope: Scope,
  actorId: string,
  input: typeof O.QualifyOnboardingControl.Type,
  original: { occurrence: typeof Intake.SourceOccurrence.Type; bytes: Uint8Array },
) {
  const report = yield* decode(Report, yield* json(original.bytes));
  const record = (yield* Sources.readPreview(tx, scope.bookId, report.previewId))[0];

  if (!record) return yield* failure("NotFound");
  const preview = yield* decode(Sie.SiePreview, record.body);

  if (preview.digest !== report.previewDigest) return yield* failure("StaleDependency");

  const findings = yield* Effect.forEach(report.findings, (item) =>
    Effect.gen(function* () {
      if (!preview.vouchers.some((voucher) => voucher.ordinal === item.voucherOrdinal))
        return yield* failure("InvalidJournal");

      const documents = yield* Effect.forEach(item.occurrenceIds, (id) =>
        Effect.gen(function* () {
          const retained = yield* readSourceBytesInTransaction(tx, scope, id);

          return yield* decode(Document, yield* json(retained.bytes));
        }),
      );

      const first = documents[0];

      if (!first) return yield* failure("InvalidJournal");
      let state: "pending" | "dismissed" | "corrected" = "pending";

      if (item.kind === "duplicate_candidate") {
        if (
          documents.length !== 2 ||
          new Set(item.occurrenceIds).size !== 2 ||
          documents.some(
            (document) =>
              document.documentNumber !== first.documentNumber ||
              document.counterpartyName !== first.counterpartyName ||
              document.currency !== first.currency ||
              document.amountMinor !== first.amountMinor,
          )
        )
          return yield* failure("InvalidJournal");

        if (item.resolutionOccurrenceId) {
          const review = yield* readSourceBytesInTransaction(
            tx,
            scope,
            item.resolutionOccurrenceId,
          );

          const decision = yield* decode(
            Schema.Struct({
              kind: Schema.Literal("onboarding_duplicate_review_v1"),
              occurrenceIds: Schema.Array(A.Identifier),
              choice: Schema.Literal("dismiss_duplicate"),
              reason: A.Description,
            }),
            yield* json(review.bytes),
          );

          if (
            decision.occurrenceIds.toSorted().join(",") !== item.occurrenceIds.toSorted().join(",")
          )
            return yield* failure("StaleDependency");
          state = "dismissed";
        }
      } else {
        if (documents.length !== 1 || first.currency === "SEK")
          return yield* failure("InvalidJournal");

        if (item.resolutionOccurrenceId) {
          const replacement = yield* readSourceBytesInTransaction(
            tx,
            scope,
            item.resolutionOccurrenceId,
          );

          const corrected = yield* decode(Document, yield* json(replacement.bytes));

          if (
            corrected.correctsOccurrenceId !== item.occurrenceIds[0] ||
            corrected.documentNumber !== first.documentNumber ||
            corrected.counterpartyName !== first.counterpartyName ||
            corrected.amountMinor !== first.amountMinor ||
            corrected.currency !== "SEK"
          )
            return yield* failure("StaleDependency");
          state = "corrected";
        }
      }

      return {
        voucherOrdinal: item.voucherOrdinal,
        kind: item.kind,
        documentNumber: first.documentNumber,
        counterpartyName: first.counterpartyName,
        currency: first.currency,
        occurrenceIds: [
          ...item.occurrenceIds,
          ...(item.resolutionOccurrenceId ? [item.resolutionOccurrenceId] : []),
        ],
        state,
      };
    }),
  );

  return yield* decode(O.OnboardingControl, {
    id: newId("onboardingcontrol"),
    scope,
    occurrenceId: original.occurrence.id,
    sourceSha256: original.occurrence.sha256,
    sourceSystem: original.occurrence.sourceSystem,
    sourceAccountId: original.occurrence.sourceAccountId,
    kind: "historical_import_review",
    parserVersion: "onboarding_csv_v1",
    asOf: (
      preview.vouchers
        .map((voucher) => voucher.date)
        .toSorted()
        .at(-1) ?? ""
    ).replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3"),
    currency: "SEK",
    facts: [],
    importReview: { previewId: preview.id, previewDigest: preview.digest, findings },
    provenance: input.provenance,
    qualifiedBy: actorId,
    qualifiedAt: yield* isoNow(tx),
  });
});

export const requireResolvedImportReview = Effect.fn("onboarding.requireResolvedImportReview")(
  function* (tx: Transaction, scope: Scope, previewId: string) {
    const controls = yield* Effect.forEach(
      yield* Db.readRecords(tx, "controls", scope.bookId),
      (row) => decode(O.OnboardingControl, row.body),
    );

    const latest = controls
      .filter((control) => control.importReview?.previewId === previewId)
      .toSorted(
        (left, right) =>
          right.qualifiedAt.localeCompare(left.qualifiedAt) || right.id.localeCompare(left.id),
      )[0];

    if (latest?.importReview?.findings.some((finding) => finding.state === "pending"))
      return yield* failure("ApprovalRequired");
  },
);
