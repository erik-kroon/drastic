import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Mileage from "@open-erp/contracts/mileage-corrections";
import * as Settlement from "@open-erp/contracts/payroll-settlements";
import * as Db from "../../db/payroll/mileage-corrections";
import * as SettlementDb from "../../db/payroll/settlements";
import * as Ledger from "../../db/posting";
import * as Foundation from "../../db/payroll-foundation";
import type { Transaction } from "../../db/transaction";
import { decode, toJsonObject, withBook, type Scope } from "../commerce/support";
import { failure } from "../failures";
import { newId, replay, saveCommand, isoNow } from "../posting";
import {
  requireMileageAccess,
  readMileageRecord,
  persistMileageRecord,
} from "./mileage-correction-records";
import {
  captureMileageCorrection,
  prepareMileageComparison,
  mileageJournal,
  currentMileageProposal,
} from "./settlement-mileage-basis";
import { mileageLifecycle } from "./mileage-correction-lifecycle";
import { readRetained, seal, claimBalance } from "./settlement-support";
import { prepareSettlementInTransaction } from "./settlements";
import { validateComparison } from "./paid-comparison-basis";

type Command<I> = { readonly scope: Scope; readonly idempotencyKey: string; readonly input: I };

type ProposalCommand<I> = Command<I> & { readonly proposalId: string };

const proposal = Effect.fn("mileage.proposal")(function* (
  tx: Transaction,
  scope: Scope,
  id: string,
  expectedDigest?: string,
) {
  const retained = yield* readMileageRecord(
    tx,
    scope,
    "payroll_mileage_correction_proposals",
    id,
    Mileage.MileageCorrectionProposal,
  );

  if (expectedDigest !== undefined && retained.digest !== expectedDigest)
    return yield* failure("StaleDependency");

  return retained;
});

const approvalUsable = Effect.fn("mileage.approvalUsable")(function* (
  tx: Transaction,
  scope: Scope,
  approval: typeof Settlement.SettlementApproval.Type,
  review: typeof Settlement.SettlementReview.Type,
) {
  if (
    approval.reviewDigest !== review.digest ||
    Date.parse(approval.expiresAt) <= Date.parse(yield* isoNow(tx)) ||
    !approval.kernelApprovalId
  )
    return false;

  const kernel = (yield* Ledger.readApproval(tx, scope.bookId, approval.kernelApprovalId))[0];

  if (
    !kernel ||
    kernel.changeSetId !== review.postingPlan?.id ||
    kernel.digest !== review.postingPlan?.planDigest ||
    kernel.actorId !== approval.actorId ||
    kernel.consumedAt !== null ||
    Date.parse(kernel.expiresAt) <= Date.parse(yield* isoNow(tx)) ||
    (yield* Ledger.readApprovalRevocation(tx, scope.bookId, kernel.id)).length
  )
    return false;

  return (
    (yield* Ledger.readOperatorMembership(tx, scope.bookId, approval.actorId)).length === 1 &&
    (yield* Foundation.readPayrollAccess(tx, scope.bookId, approval.actorId)).length === 1 &&
    (yield* Ledger.readActorAdmission(tx, approval.actorId))[0]?.enabled !== false
  );
});

type ViewContext = {
  readonly state: Effect.Success<ReturnType<typeof mileageLifecycle>>;
  readonly review: typeof Settlement.SettlementReview.Type | null;
  readonly execution: typeof Settlement.SettlementExecution.Type | null;
  readonly approvals: ReadonlyArray<typeof Settlement.SettlementApproval.Type>;
  readonly captured: Effect.Success<ReturnType<typeof captureMileageCorrection>>;
  readonly sourceCurrent: boolean;
  readonly usable: boolean;
  readonly balance: Effect.Success<ReturnType<typeof claimBalance>> | null;
  readonly blockers: ReadonlyArray<typeof Mileage.MileageCorrectionBlocker.Type>;
};

function viewFields(retained: typeof Mileage.MileageCorrectionProposal.Type, context: ViewContext) {
  const { state, review, execution, usable } = context;

  const claim = execution?.recoveryClaim;

  const status = execution
    ? "executed"
    : state.cancellation
      ? "cancelled"
      : context.blockers.length
        ? "blocked"
        : usable
          ? "approved"
          : state.submission
            ? "submitted"
            : "proposal";

  return {
    proposal: retained,
    employee: retained.employee,
    original: retained.original,
    sources: {
      ...retained.sources,
      lawfulBasisId: review?.lawfulBasis?.id ?? null,
      lawfulBasisDigest: review?.lawfulBasis?.digest ?? null,
      lawfulBasisReviewedBy: review?.lawfulBasis?.createdBy ?? null,
    },
    comparison: retained.comparison,
    journal: retained.journal,
    settlementReview: review,
    submissions: state.submission ? [state.submission] : [],
    cancellation: state.cancellation,
    approvals: context.approvals,
    execution,
    current: {
      status,
      dependencyDigest: context.captured.dependencyDigest,
      sourceCurrent: context.sourceCurrent,
      approvalUsable: usable,
      canSubmit:
        context.sourceCurrent && !!review && !state.submission && !state.cancellation && !execution,
      canCancel: !state.cancellation && !execution,
      blockers: context.blockers,
      remainingReceivableMinor: context.balance?.remaining ?? "0",
      recoveryClaimId: claim?.id ?? null,
    },
  };
}

export const mileageViewInTransaction = Effect.fn("mileage.view")(function* (
  tx: Transaction,
  scope: Scope,
  retained: typeof Mileage.MileageCorrectionProposal.Type,
) {
  const state = yield* mileageLifecycle(tx, scope, retained.id);

  const review = state.link
    ? yield* readRetained(
        tx,
        scope,
        "payroll_settlement_reviews",
        state.link.reviewId,
        Settlement.SettlementReview,
      )
    : null;

  const executionRow = review
    ? (yield* SettlementDb.readReviewExecution(tx, scope.bookId, review.id))[0]
    : null;

  const execution = executionRow
    ? yield* decode(Settlement.SettlementExecution, executionRow.body)
    : null;

  const approvals = [];

  if (review)
    for (const row of yield* SettlementDb.readApprovalRows(tx, scope.bookId, review.id))
      approvals.push(yield* decode(Settlement.SettlementApproval, row.body));

  const captured = yield* captureMileageCorrection(tx, scope, retained.input);

  let sourceCurrent =
    captured.dependencyDigest === retained.dependencyDigest && captured.blockers.length === 0;

  if (sourceCurrent && retained.comparison && !execution) {
    const comparison = yield* Effect.result(
      validateComparison(tx, scope, retained.comparison.paidComparisonId),
    );

    if (Result.isFailure(comparison)) {
      if (!("code" in comparison.failure)) return yield* comparison.failure;

      sourceCurrent = false;
    }
  }

  const blockers = [...retained.blockers];

  if (!sourceCurrent && blockers.length === 0 && !execution)
    blockers.push({
      code: "StaleDependency",
      message: "Prepare a new proposal from the current retained source and correction history.",
      sourceRef: retained.id,
    });

  if (!review && blockers.length === 0)
    blockers.push({
      code: "IndependentRecoveryReviewRequired",
      message:
        "Independently review the retained lawful recovery basis before financial preparation.",
      sourceRef: retained.id,
    });

  let usable = false;

  if (sourceCurrent && state.submission && !state.cancellation && !execution && review) {
    for (const approval of approvals)
      if (yield* approvalUsable(tx, scope, approval, review)) usable = true;
  }

  const claim = execution?.recoveryClaim;
  const balance = claim ? yield* claimBalance(tx, scope, claim.id) : null;

  const fields = viewFields(retained, {
    state,
    review,
    execution,
    approvals,
    captured,
    sourceCurrent,
    usable,
    balance,
    blockers,
  });

  return yield* decode(Mileage.MileageCorrectionView, yield* toJsonObject(fields));
});

export const prepareMileageCorrection = Effect.fn("mileage.prepare")(function* (
  token: string,
  command: Command<typeof Mileage.PrepareMileageCorrection.Type>,
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (tx, principal) {
      yield* requireMileageAccess(tx, command.scope, principal.actorId, true);

      const operation = "payroll_prepare_mileage_correction";

      const request = yield* replay(
        tx,
        command.scope,
        command.idempotencyKey,
        operation,
        principal.actorId,
        command.input,
        Mileage.MileageCorrectionView,
      );

      if (request.previous) return request.previous;

      const captured = yield* captureMileageCorrection(tx, command.scope, command.input);

      const comparison = yield* prepareMileageComparison(
        tx,
        command.scope,
        principal,
        command.idempotencyKey,
        captured,
      );

      const retained = yield* seal(
        tx,
        command.scope,
        principal,
        operation,
        command.idempotencyKey,
        Mileage.MileageCorrectionProposal,
        {
          id: newId("mileage_correction"),
          input: command.input,
          employee: captured.employee,
          original: captured.original,
          sources: captured.sources,
          comparison,
          journal: mileageJournal(command.input, captured, comparison),
          dependencyDigest: captured.dependencyDigest,
          blockers: captured.blockers,
        },
      );

      yield* persistMileageRecord(tx, "payroll_mileage_correction_proposals", retained);

      const view = yield* mileageViewInTransaction(tx, command.scope, retained);

      yield* saveCommand(
        tx,
        command.scope,
        command.idempotencyKey,
        request.expected,
        operation,
        principal.actorId,
        yield* toJsonObject(view),
      );

      return view;
    },
    "update",
  );
});

export const reviewMileageCorrection = Effect.fn("mileage.review")(function* (
  token: string,
  command: ProposalCommand<typeof Mileage.ReviewMileageCorrection.Type>,
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (tx, principal) {
      yield* requireMileageAccess(tx, command.scope, principal.actorId, true);

      const operation = "payroll_review_mileage_correction";

      const request = yield* replay(
        tx,
        command.scope,
        command.idempotencyKey,
        operation,
        principal.actorId,
        { proposalId: command.proposalId, input: command.input },
        Mileage.MileageCorrectionView,
      );

      if (request.previous) return request.previous;

      const retained = yield* proposal(
        tx,
        command.scope,
        command.proposalId,
        command.input.proposalDigest,
      );

      const state = yield* mileageLifecycle(tx, command.scope, retained.id);

      if (state.cancellation) return yield* failure("ApprovalRequired");

      if (state.link) return yield* failure("AlreadyPosted");

      yield* currentMileageProposal(tx, command.scope, retained);

      if (
        !retained.comparison ||
        !retained.sources.recoveryBasis ||
        !retained.sources.recoveryReason
      )
        return yield* failure("MissingEvidence");

      const lawful = yield* readRetained(
        tx,
        command.scope,
        "payroll_adjustment_bases",
        command.input.lawfulBasisId,
        Settlement.AdjustmentBasis,
      );

      if (
        lawful.createdBy === retained.createdBy ||
        lawful.comparisonDigest !== retained.comparison.paidComparisonDigest ||
        lawful.evidence.sha256 !== retained.sources.recoveryBasis.sha256.slice(7) ||
        lawful.input.reason !== retained.sources.recoveryReason
      )
        return yield* failure("ApprovalRequired");

      const review = yield* prepareSettlementInTransaction(tx, principal, {
        scope: command.scope,
        idempotencyKey: `${command.idempotencyKey}_settlement`,
        input: {
          kind: "gross_recovery",
          mileageSource: { proposalId: retained.id, proposalDigest: retained.digest },
          comparisonId: retained.comparison.paidComparisonId,
          lawfulBasisId: lawful.id,
          recoveryReceivableAccountId: retained.input.recoveryReceivableAccountId,
          futureMonth: null,
          evidenceId: lawful.evidence.evidenceId,
          accountingPeriodId: retained.input.accountingPeriodId,
          postingDate: retained.input.postingDate,
          series: retained.input.series,
          reason: retained.sources.recoveryReason,
        },
      });

      const link = yield* seal(
        tx,
        command.scope,
        principal,
        operation,
        command.idempotencyKey,
        Mileage.MileageCorrectionReviewLink,
        {
          id: newId("mileage_review_link"),
          proposalId: retained.id,
          proposalDigest: retained.digest,
          reviewId: review.id,
        },
      );

      yield* persistMileageRecord(tx, "payroll_mileage_correction_review_links", link);

      const view = yield* mileageViewInTransaction(tx, command.scope, retained);

      yield* saveCommand(
        tx,
        command.scope,
        command.idempotencyKey,
        request.expected,
        operation,
        principal.actorId,
        yield* toJsonObject(view),
      );

      return view;
    },
    "update",
  );
});

export const submitMileageCorrection = Effect.fn("mileage.submit")(function* (
  token: string,
  command: ProposalCommand<typeof Mileage.SubmitMileageCorrection.Type>,
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (tx, principal) {
      yield* requireMileageAccess(tx, command.scope, principal.actorId, true);

      const operation = "payroll_submit_mileage_correction";

      const request = yield* replay(
        tx,
        command.scope,
        command.idempotencyKey,
        operation,
        principal.actorId,
        { proposalId: command.proposalId, input: command.input },
        Mileage.MileageCorrectionView,
      );

      if (request.previous) return request.previous;

      const retained = yield* proposal(
        tx,
        command.scope,
        command.proposalId,
        command.input.proposalDigest,
      );

      const view = yield* mileageViewInTransaction(tx, command.scope, retained);

      if (
        !view.current.canSubmit ||
        !view.settlementReview ||
        view.settlementReview.digest !== command.input.reviewDigest
      )
        return yield* failure("ApprovalRequired");

      const submitted = yield* seal(
        tx,
        command.scope,
        principal,
        operation,
        command.idempotencyKey,
        Mileage.MileageCorrectionSubmission,
        {
          id: newId("mileage_submission"),
          proposalId: retained.id,
          proposalDigest: retained.digest,
          reviewId: view.settlementReview.id,
          reviewDigest: view.settlementReview.digest,
        },
      );

      yield* persistMileageRecord(tx, "payroll_mileage_correction_submissions", submitted);

      const result = yield* mileageViewInTransaction(tx, command.scope, retained);

      yield* saveCommand(
        tx,
        command.scope,
        command.idempotencyKey,
        request.expected,
        operation,
        principal.actorId,
        yield* toJsonObject(result),
      );

      return result;
    },
    "update",
  );
});

export const cancelMileageCorrection = Effect.fn("mileage.cancel")(function* (
  token: string,
  command: ProposalCommand<typeof Mileage.CancelMileageCorrection.Type>,
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (tx, principal) {
      yield* requireMileageAccess(tx, command.scope, principal.actorId, true);

      const operation = "payroll_cancel_mileage_correction";

      const request = yield* replay(
        tx,
        command.scope,
        command.idempotencyKey,
        operation,
        principal.actorId,
        { proposalId: command.proposalId, input: command.input },
        Mileage.MileageCorrectionView,
      );

      if (request.previous) return request.previous;

      const retained = yield* proposal(
        tx,
        command.scope,
        command.proposalId,
        command.input.proposalDigest,
      );

      const view = yield* mileageViewInTransaction(tx, command.scope, retained);

      if (!view.current.canCancel) return yield* failure("AlreadyPosted");

      const cancelled = yield* seal(
        tx,
        command.scope,
        principal,
        operation,
        command.idempotencyKey,
        Mileage.MileageCorrectionCancellation,
        {
          id: newId("mileage_cancellation"),
          proposalId: retained.id,
          proposalDigest: retained.digest,
        },
      );

      yield* persistMileageRecord(tx, "payroll_mileage_correction_cancellations", cancelled);

      const result = yield* mileageViewInTransaction(tx, command.scope, retained);

      yield* saveCommand(
        tx,
        command.scope,
        command.idempotencyKey,
        request.expected,
        operation,
        principal.actorId,
        yield* toJsonObject(result),
      );

      return result;
    },
    "update",
  );
});

export const getMileageCorrection = Effect.fn("mileage.get")(function* (
  token: string,
  command: { readonly scope: Scope; readonly proposalId: string },
) {
  return yield* withBook(token, command.scope, false, function* (tx, principal) {
    yield* requireMileageAccess(tx, command.scope, principal.actorId, false);

    return yield* mileageViewInTransaction(
      tx,
      command.scope,
      yield* proposal(tx, command.scope, command.proposalId),
    );
  });
});

export const listMileageCorrections = Effect.fn("mileage.list")(function* (
  token: string,
  command: { readonly scope: Scope; readonly input: typeof Mileage.ListMileageCorrections.Type },
) {
  return yield* withBook(token, command.scope, false, function* (tx, principal) {
    yield* requireMileageAccess(tx, command.scope, principal.actorId, false);

    const rows = yield* Db.list(tx, command.scope.bookId, command.input);
    const limit = command.input.limit ?? 20;
    const items = [];

    for (const row of rows.slice(0, limit)) {
      const retained = yield* decode(Mileage.MileageCorrectionProposal, row.body);
      const view = yield* mileageViewInTransaction(tx, command.scope, retained);

      items.push({
        id: retained.id,
        digest: retained.digest,
        employee: retained.employee,
        originalReference: retained.original.reference,
        paidOn: retained.original.paidOn,
        revisedDistanceMeters: retained.input.revisedTrip.distanceInMeters,
        entitlementDeltaMinor: retained.comparison?.entitlementDeltaMinor ?? null,
        status: view.current.status,
      });
    }

    return { items, next: rows.length > limit ? (items.at(-1)?.id ?? null) : null };
  });
});
