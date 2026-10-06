import * as Effect from "effect/Effect";
import * as Mileage from "@open-erp/contracts/mileage-corrections";
import * as Settlement from "@open-erp/contracts/payroll-settlements";
import * as Db from "../../db/payroll/mileage-corrections";
import type { Transaction } from "../../db/transaction";
import { decode, type Scope } from "../commerce/support";
import { failure } from "../failures";
import { readMileageRecord } from "./mileage-correction-records";

export const mileageLifecycle = Effect.fn("mileage.lifecycle")(function* (
  tx: Transaction,
  scope: Scope,
  proposalId: string,
) {
  const links = yield* Db.related(
    tx,
    scope.bookId,
    "payroll_mileage_correction_review_links",
    proposalId,
  );

  const submitted = yield* Db.related(
    tx,
    scope.bookId,
    "payroll_mileage_correction_submissions",
    proposalId,
  );

  const cancelled = yield* Db.related(
    tx,
    scope.bookId,
    "payroll_mileage_correction_cancellations",
    proposalId,
  );

  if ([links, submitted, cancelled].some((rows) => rows.length > 1))
    return yield* failure("StaleDependency");

  const link = links[0] ? yield* decode(Mileage.MileageCorrectionReviewLink, links[0].body) : null;

  const submission = submitted[0]
    ? yield* decode(Mileage.MileageCorrectionSubmission, submitted[0].body)
    : null;

  const cancellation = cancelled[0]
    ? yield* decode(Mileage.MileageCorrectionCancellation, cancelled[0].body)
    : null;

  return { link, submission, cancellation };
});

export const requireMileageSubmission = Effect.fn("mileage.requireSubmission")(function* (
  tx: Transaction,
  scope: Scope,
  review: typeof Settlement.SettlementReview.Type,
  approverId?: string,
) {
  if (review.input.kind !== "gross_recovery" || !review.input.mileageSource) return;

  const reference = review.input.mileageSource;

  const proposal = yield* readMileageRecord(
    tx,
    scope,
    "payroll_mileage_correction_proposals",
    reference.proposalId,
    Mileage.MileageCorrectionProposal,
  );

  const state = yield* mileageLifecycle(tx, scope, proposal.id);

  if (
    proposal.digest !== reference.proposalDigest ||
    state.cancellation ||
    state.link?.reviewId !== review.id ||
    state.submission?.reviewId !== review.id ||
    state.submission.reviewDigest !== review.digest
  )
    return yield* failure("ApprovalRequired");

  if (
    approverId !== undefined &&
    (approverId === proposal.createdBy ||
      approverId === state.submission.createdBy ||
      approverId === review.createdBy)
  )
    return yield* failure("ApprovalRequired");
});

export const recordMileageSuccessor = Effect.fn("mileage.recordSuccessor")(function* (
  tx: Transaction,
  scope: Scope,
  review: typeof Settlement.SettlementReview.Type,
  executionId: string,
) {
  if (review.input.kind !== "gross_recovery" || !review.input.mileageSource) return;

  const proposal = yield* readMileageRecord(
    tx,
    scope,
    "payroll_mileage_correction_proposals",
    review.input.mileageSource.proposalId,
    Mileage.MileageCorrectionProposal,
  );

  yield* Db.insertSuccessor(
    tx,
    scope.bookId,
    proposal.input.originalInputId,
    proposal.input.previousCorrectionExecutionId,
    executionId,
    proposal.id,
  );
});
