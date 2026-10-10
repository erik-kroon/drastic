import { Api } from "@open-erp/contracts/api";
import { bookScope, httpRequest } from "@/lib/contract-client";
import * as Schema from "effect/Schema";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Acceptance from "@open-erp/contracts/supplier-acceptance";
import { readAccounting } from "./accounting-api";
import { assertSupplierReviewIdentity } from "@/components/commerce/supplier-acceptance";
import { checkScope } from "@/components/commerce/shared";

export const workGroupSelectionLimit = Acceptance.workGroupSelectionLimit;

export const WorkGroupRequest = Schema.Struct({
  excludedReviews: Schema.optional(
    Schema.Array(
      Schema.Struct({
        reviewId: Accounting.Identifier,
        digest: Accounting.Digest,
      }),
    ).check(
      Schema.isMaxLength(workGroupSelectionLimit),
      Schema.makeFilter(
        (reviews) =>
          new Set(reviews.map((review) => review.reviewId)).size === reviews.length ||
          "Retained excluded reviews must contain unique review IDs",
      ),
    ),
  ),
  entries: Schema.Array(
    Schema.Struct({
      reviewId: Accounting.Identifier,
      digest: Accounting.Digest,
      approvalKey: Accounting.IdempotencyHeaders.fields["idempotency-key"],
      executionKey: Accounting.IdempotencyHeaders.fields["idempotency-key"],
    }),
  ).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(workGroupSelectionLimit),
    Schema.makeFilter(
      (entries) =>
        new Set(entries.map((entry) => entry.reviewId)).size === entries.length ||
        "A retained group must contain unique review IDs",
    ),
  ),
});

export function supplierGroupRoutine(view: typeof Acceptance.SupplierAcceptanceView.Type) {
  return (
    view.priorReviewedAcceptanceReceiptId !== null &&
    view.plan.profile === "swedish-purchase-v1" &&
    view.plan.originalLines !== undefined &&
    view.plan.originalLines.length > 0 &&
    view.plan.originalLines.every(
      (line) =>
        line.treatment.basis === "full_deduction" &&
        line.treatment.acceptancePolicy === "exact_match" &&
        line.treatment.toleranceMinor === "0",
    )
  );
}

export function supplierGroupEligible(
  view: typeof Acceptance.SupplierAcceptanceView.Type,
  approvalKey?: string,
) {
  return (
    supplierGroupRoutine(view) &&
    view.dependenciesCurrent &&
    view.blockers.length === 0 &&
    view.acceptance === null &&
    (view.approval === null || (view.approvalUsable && view.approval.receipt.key === approvalKey))
  );
}

export async function readGroupReview(book: typeof Accounting.Book.Type, reviewId: string) {
  const view = await readAccounting(
    (client) =>
      client.supplierAcceptance.getSupplierAcceptanceReview({
        params: { ...bookScope(book), id: reviewId },
      }),
    Acceptance.SupplierAcceptanceView,
  );

  assertSupplierReviewIdentity(book, view.plan.draftSnapshot.id, reviewId, view);

  return view;
}

export async function postGroupEntry(
  book: typeof Accounting.Book.Type,
  entry: (typeof WorkGroupRequest.Type)["entries"][number],
) {
  const view = await readGroupReview(book, entry.reviewId);

  if (view.plan.digest !== entry.digest) throw new Error("Selected proposal changed");

  if (view.acceptance) return view.acceptance;

  if (!supplierGroupEligible(view, entry.approvalKey))
    throw new Error("Proposal requires individual review");

  const input = { version: 1, digest: entry.digest, acknowledgeSyntheticOnly: true };

  const approval = await readAccounting(
    (client, requestOptions) =>
      client.supplierAcceptance.approveSupplierAcceptance(
        httpRequest(
          Api.groups.supplierAcceptance.endpoints.approveSupplierAcceptance,
          { params: { ...bookScope(book), id: entry.reviewId } },
          requestOptions,
        ),
      ),
    Acceptance.SupplierAcceptanceApproval,
    {
      method: "POST",
      body: JSON.stringify(input),
      headers: { "Idempotency-Key": entry.approvalKey },
    },
  );

  checkScope(book, approval.scope);

  if (approval.reviewId !== entry.reviewId || approval.digest !== entry.digest)
    throw new Error("Group approval identity mismatch");

  const receipt = await readAccounting(
    (client, requestOptions) =>
      client.supplierAcceptance.executeSupplierAcceptance(
        httpRequest(
          Api.groups.supplierAcceptance.endpoints.executeSupplierAcceptance,
          { params: { ...bookScope(book), id: entry.reviewId } },
          requestOptions,
        ),
      ),
    Acceptance.SupplierAcceptanceReceipt,
    {
      method: "POST",
      body: JSON.stringify({ ...input, approvalId: approval.id }),
      headers: { "Idempotency-Key": entry.executionKey },
    },
  );

  checkScope(book, receipt.scope);

  if (
    receipt.reviewId !== entry.reviewId ||
    receipt.reviewDigest !== entry.digest ||
    receipt.approvalId !== approval.id
  )
    throw new Error("Group receipt identity mismatch");

  return receipt;
}
