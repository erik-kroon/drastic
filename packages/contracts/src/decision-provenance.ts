import { maximumExtractionReviewFields } from "./extraction-limits";
import * as Memory from "@open-erp/domain/firm-memory";
import * as Schema from "effect/Schema";
import * as Accounting from "./accounting";
import * as Commerce from "./commerce";
import { PurchaseCategoryResolution } from "./vat-purchase-categories";

export const PresentedSuggestionIds = Schema.optional(
  Schema.Array(Accounting.Identifier).check(Schema.isMaxLength(32)),
);

export const DecisionSubject = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("supplier_draft"),
    draftId: Accounting.Identifier,
    revision: Commerce.Version,
  }),
  Schema.Struct({
    kind: Schema.Literal("extraction_attempt"),
    occurrenceId: Accounting.Identifier,
    requestId: Accounting.Identifier,
    attemptId: Accounting.Identifier,
    draftId: Schema.NullOr(Accounting.Identifier),
    revision: Schema.NullOr(Commerce.Version),
  }),
  Schema.Struct({
    kind: Schema.Literal("bank_row"),
    statementId: Accounting.Identifier,
    rowOrdinal: Schema.Int,
    revision: Accounting.MinorUnits,
  }),
]);

export const SuggestionOptions = Schema.Union([
  Schema.Struct({
    source: Schema.Literal("firm_memory_v1"),
    version: Schema.Literal("firm_memory_v1"),
    historyDigest: Accounting.Digest,
    legacyItems: Schema.Array(Memory.AccountHint).check(Schema.isMaxLength(5)),
    options: Schema.Array(Memory.Precedent).check(Schema.isMaxLength(5)),
  }),
  Schema.Struct({
    source: Schema.Literal("firm_memory_v2"),
    version: Schema.Literal("firm_memory_v2"),
    historyDigest: Accounting.Digest,
    legacyItems: Schema.Array(Memory.AccountHint).check(Schema.isMaxLength(5)),
    options: Schema.Array(Memory.Precedent).check(Schema.isMaxLength(5)),
  }),
  Schema.Struct({
    source: Schema.Literal("firm_memory_v0"),
    version: Schema.Literals(["supplier_account_history_v1", "supplier_account_history_v2"]),
    options: Schema.Array(
      Schema.Struct({
        expenseAccountId: Accounting.Identifier,
        vatRatePercent: Schema.Literals([0, 6, 12, 25]),
        sourceInvoiceId: Accounting.Identifier,
        categoryResolution: Schema.optional(PurchaseCategoryResolution),
      }),
    ).check(Schema.isMaxLength(5)),
  }),
  Schema.Struct({
    source: Schema.Literal("extraction"),
    version: Schema.Literal("extraction_merge_v1"),
    options: Schema.Array(
      Schema.Struct({
        lineOrdinal: Schema.Int,
        fieldKey: Schema.String,
        value: Schema.NullOr(Schema.String.check(Schema.isMaxLength(1000))),
      }),
    ).check(Schema.isMaxLength(maximumExtractionReviewFields)),
  }),
  Schema.Struct({
    source: Schema.Literal("bank_ranking_v2"),
    version: Schema.Literal("retained_then_reference_amount_date_v2"),
    options: Schema.Array(
      Schema.Struct({
        voucherId: Accounting.Identifier,
        lineId: Accounting.Identifier,
        amountMinor: Accounting.SignedMinorUnits,
      }),
    ).check(Schema.isMaxLength(1000)),
  }),
]);

export const SuggestionRecord = Schema.Struct({
  id: Accounting.Identifier,
  subject: DecisionSubject,
  actorId: Accounting.Identifier,
  sessionId: Schema.NullOr(Schema.String),
  optionSetDigest: Accounting.Digest,
  ranked: SuggestionOptions,
});

export const DecisionClassification = Schema.Literals([
  "independent",
  "accepted_unchanged",
  "corrected",
  "batch_approved",
  "unknown_exposure",
  "historical_import",
]);
