import * as Acceptance from "@open-erp/contracts/supplier-acceptance";
import * as Capture from "@open-erp/contracts/approval-consequences";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Consequence from "@open-erp/domain/treatment-consequence";
import {
  syntheticStatementMappingRelease,
  resolveSyntheticStatementAccount,
} from "@open-erp/jurisdiction-se/synthetic-statement-mapping";
import * as Effect from "effect/Effect";
import type { Transaction } from "../../db/transaction";
import * as PostingDb from "../../db/posting";
import * as DimensionsDb from "../../db/dimensions";
import * as AcceptanceDb from "../../db/purchases/acceptance";
import { digest } from "../posting";
import { failure } from "../failures";
import * as Shared from "./shared";

type Review = typeof Acceptance.SupplierAcceptanceReview.Type;

type Action = typeof Accounting.VoucherPostingAction.Type;

export const sourcePostingBindings = Effect.fn("purchases.consequences.sourceBindings")(function* (
  recognition: NonNullable<Review["recognition"]>,
  action: Action,
  selected: NonNullable<Review["originalLines"]>,
) {
  if (recognition.journal.length !== action.lines.length) return yield* failure("InternalError");

  const lines = recognition.journal.map((line, ordinal) => {
    const posting = action.lines[ordinal]!;
    const selection = selected.find((item) => item.lineId === line.sourceLineId);

    return {
      sourceLineId: line.sourceLineId,
      postingLineId: posting.lineId,
      ordinal,
      role:
        line.sourceLineId === null
          ? "control"
          : selection?.expenseAccountId === line.accountId
            ? "expense"
            : "input_vat",
    };
  });

  if (
    recognition.journal.some(
      (line, index) =>
        line.accountId !== action.lines[index]!.accountId ||
        line.debitMinor !== action.lines[index]!.debitMinor ||
        line.creditMinor !== action.lines[index]!.creditMinor,
    )
  )
    return yield* failure("InternalError");

  return yield* Shared.decode(
    Capture.SourcePostingBindings,
    yield* Shared.toJsonObject({ version: "purchase_journal_order_v1", lines }),
  );
});

export const recognitionExtras = Effect.fn("purchases.consequences.recognitionExtras")(function* (
  recognition: NonNullable<Review["recognition"]>,
  plan: Review["postingPlan"],
  selected: Review["originalLines"],
) {
  const action = plan.groups[0]?.actions[0];

  const bindings =
    action?.kind === "post_voucher" && selected !== undefined
      ? yield* sourcePostingBindings(recognition, action, selected)
      : undefined;

  if (bindings) return yield* Shared.toJsonObject({ recognition, sourcePostingBindings: bindings });

  return yield* Shared.toJsonObject({ recognition });
});

export const captureApprovalConsequences = Effect.fn("purchases.consequences.captureApproval")(
  function* (transaction: Transaction, bookId: string, cutoff: string, review: Review) {
    const mappingRelease = {
      id: syntheticStatementMappingRelease.id,
      checksum: yield* digest(syntheticStatementMappingRelease),
      qualification: "synthetic_only" as const,
    };

    const empty = (status: "source_bindings_not_captured" | "unsupported_profile") => ({
      version: "approval_consequence_capture_v1" as const,
      status,
      mappingRelease,
      sourceLines: [],
    });

    if (review.profile !== "swedish-purchase-v1" || !review.originalLines || !review.recognition)
      return empty("unsupported_profile");

    const bindings = review.sourcePostingBindings;
    const action = review.postingPlan.groups[0]?.actions[0];

    if (!bindings || !action || action.kind !== "post_voucher")
      return empty("source_bindings_not_captured");

    const period = (yield* PostingDb.readPeriod(transaction, bookId, action.accountingPeriodId))[0];

    if (!period) return yield* failure("InternalError");

    const dimensions = yield* DimensionsDb.readEffectiveDimensions(
      transaction,
      bookId,
      action.postingDate,
    );

    const knownEmpty =
      dimensions.length === 0 &&
      (action.dimensionPolicy?.length ?? 0) === 0 &&
      action.lines.every((line) => (line.originalDimensions?.length ?? 0) === 0);

    const sourceLines: Array<(typeof Capture.ApprovalConsequenceCapture.Type.sourceLines)[number]> =
      [];

    for (const selected of review.originalLines) {
      const binding = bindings.lines.find(
        (line) => line.sourceLineId === selected.lineId && line.role === "expense",
      );

      const posting = binding ? action.lines[binding.ordinal] : undefined;

      if (
        !binding ||
        !posting ||
        posting.lineId !== binding.postingLineId ||
        posting.accountId !== selected.expenseAccountId
      )
        return empty("source_bindings_not_captured");

      const account = (yield* AcceptanceDb.readExpenseAccount(
        transaction,
        bookId,
        selected.expenseAccountId,
        [],
      ))[0];

      const mapped = account
        ? resolveSyntheticStatementAccount(syntheticStatementMappingRelease, account.code)
        : null;

      const accounts =
        mapped?.status === "known"
          ? [
              {
                accountId: selected.expenseAccountId,
                classification: mapped.classification,
                placement: mapped.placement,
                statementLeaf: mapped.statementLeaf,
              },
            ]
          : [];

      const witness = selected.treatment.categoryResolution;

      const capture = yield* Shared.decode(
        Consequence.CapturedTreatment,
        yield* Shared.toJsonObject({
          accountId: selected.expenseAccountId,
          originalCommitCutoff: cutoff,
          postingOn: action.postingDate,
          mapping: { checksum: mappingRelease.checksum, applicableAtCutoff: cutoff, accounts },
          vat: {
            category: witness?.categoryId ?? null,
            profileIdentity:
              witness?.ruleReleaseChecksum ??
              (review.profileWitness?.family === "vat"
                ? review.profileWitness.ruleReleaseChecksum
                : null),
            resolvedRate: selected.treatment.rate,
            deduction: selected.treatment.deduction,
          },
          period: { id: period.id, startsOn: period.startsOn, endsOn: period.endsOn },
          dimensions: { requirements: knownEmpty ? [] : null, assignments: knownEmpty ? [] : null },
        }),
      );

      sourceLines.push({ sourceLineId: selected.lineId, postingLineId: posting.lineId, capture });
    }

    return yield* Shared.decode(
      Capture.ApprovalConsequenceCapture,
      yield* Shared.toJsonObject({
        version: "approval_consequence_capture_v1",
        status: "captured",
        mappingRelease,
        sourceLines,
      }),
    );
  },
);
