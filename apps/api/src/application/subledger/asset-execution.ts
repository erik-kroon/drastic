import * as Controls from "@open-erp/contracts/subledger-controls";
import * as Subledgers from "@open-erp/contracts/subledgers";
import * as Effect from "effect/Effect";
import * as Db from "../../db/subledger/assets";
import * as Schedules from "../../db/subledger/schedules";
import type { Transaction } from "../../db/transaction";
import { decode, withBook, type Scope, type Principal } from "../commerce/support";
import { failure } from "../failures";
import {
  approveChangeInTransaction,
  executeChangeInTransaction,
  digest,
  isoNow,
  newId,
  replay,
  saveCommand,
} from "../posting";
import { checkedReview, type ReviewCommand } from "./asset-reviews";

type ExecuteCommand = ReviewCommand & { readonly input: typeof Controls.ExecuteAssetDisposal.Type };

const approve = Effect.fn("subledger.approveAssetDecision")(function* (
  token: string,
  command: ReviewCommand,
  kind: Db.Kind,
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (tx, principal) {
      const operation = `approve_subledger_${kind}`;

      const request = yield* replay(
        tx,
        command.scope,
        command.idempotencyKey,
        operation,
        principal.actorId,
        { id: command.id, input: command.input },
        Controls.AssetDisposalApproval,
      );

      if (request.previous) return request.previous;
      const review = yield* checkedReview(tx, command.scope, kind, command.id, command.input);

      const ordinal =
        (yield* Db.listApprovals(tx, command.scope.bookId, kind, command.id)).length + 1;

      if (ordinal > 20) return yield* failure("UnsupportedProfile");
      const now = yield* isoNow(tx);

      const body = {
        id: newId(`asset_${kind}_approval`),
        scope: command.scope,
        reviewId: command.id,
        reviewDigest: review.digest,
        actorId: principal.actorId,
        expiresAt: new Date(Date.parse(now) + 3600000).toISOString(),
        legalPolicyApproved: false,
        createdAt: now,
        receipt: { key: command.idempotencyKey, operation, actorId: principal.actorId },
      };

      const result = yield* decode(Controls.AssetDisposalApproval, {
        ...body,
        digest: yield* digest(body),
      });

      yield* Db.insertApproval(tx, command.scope.bookId, kind, result, ordinal);
      yield* saveCommand(
        tx,
        command.scope,
        command.idempotencyKey,
        request.expected,
        operation,
        principal.actorId,
        result,
      );

      return result;
    },
    "update",
  );
});

export const approveDisposal = (token: string, command: ReviewCommand) =>
  approve(token, command, "disposal");

export const approveImpairment = (token: string, command: ReviewCommand) =>
  approve(token, command, "impairment");

const post = Effect.fn("subledger.postAssetDecision")(function* (
  tx: Transaction,
  principal: Principal,
  scope: Scope,
  kind: Db.Kind,
  approvalId: string,
  review: typeof Controls.AssetDisposalReview.Type | typeof Controls.AssetImpairmentReview.Type,
) {
  const row = (yield* Db.listApprovals(tx, scope.bookId, kind, review.id)).find(
    (a) => a.body.id === approvalId,
  );

  if (!row) return yield* failure("ApprovalRequired");
  const approval = yield* decode(Controls.AssetDisposalApproval, row.body);
  const now = yield* isoNow(tx);

  if (
    approval.actorId !== principal.actorId ||
    approval.reviewDigest !== review.digest ||
    Date.parse(approval.expiresAt) <= Date.parse(now) ||
    (yield* Db.listEffects(tx, scope.bookId, kind, review.input.scheduleId)).some(
      (e) => e.body.approvalId === approvalId,
    )
  )
    return yield* failure("ApprovalRequired");

  const approved = yield* approveChangeInTransaction(tx, principal, {
    scope,
    changeSetId: review.postingPlan.id,
    idempotencyKey: `${approvalId}_approve`,
    input: { version: 1, planDigest: review.postingPlan.planDigest },
  });

  return yield* executeChangeInTransaction(tx, principal, {
    scope,
    changeSetId: review.postingPlan.id,
    idempotencyKey: `${approvalId}_post`,
    owner: { kind: kind === "disposal" ? "asset_disposal" : "asset_impairment", id: review.id },
    input: { version: 1, planDigest: review.postingPlan.planDigest, approvalId: approved.id },
  });
});

export const executeDisposal = Effect.fn("subledger.executeDisposal")(function* (
  token: string,
  command: ExecuteCommand,
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (tx, principal) {
      const { scope, id, idempotencyKey, input } = command,
        operation = "execute_subledger_disposal";

      const request = yield* replay(
        tx,
        scope,
        idempotencyKey,
        operation,
        principal.actorId,
        { id, input },
        Subledgers.AssetDisposal,
      );

      if (request.previous) return request.previous;
      const checked = yield* checkedReview(tx, scope, "disposal", id, input);
      const review = yield* decode(Controls.AssetDisposalReview, checked);

      const postingReceipt = yield* post(
        tx,
        principal,
        scope,
        "disposal",
        input.approvalId,
        review,
      );

      const body = {
        id: newId("asset_disposal"),
        scope,
        scheduleId: review.input.scheduleId,
        reviewId: id,
        reviewDigest: review.digest,
        approvalId: input.approvalId,
        postingDate: review.input.postingDate,
        scheduleDigest: review.input.expectedDigest,
        basisDigest: review.input.expectedBasisDigest,
        originalCostMinor: review.basis.originalCostMinor,
        openingAccumulatedMinor: review.basis.openingAccumulatedMinor,
        recognizedMinor: review.basis.recognizedMinor,
        impairmentMinorReleased: review.basis.impairmentMinor ?? "0",
        totalAccumulatedMinor: review.basis.totalAccumulatedMinor,
        carryingMinorReleased: review.basis.carryingMinor,
        carryingMinor: "0",
        status: "synthetic_disposed",
        futureRecognitionBlocked: true,
        postingReceipt,
        coverage: "not_established",
        legalPolicyApproved: false,
        createdAt: yield* isoNow(tx),
        receipt: { key: idempotencyKey, operation, actorId: principal.actorId },
      };

      const result = yield* decode(Subledgers.AssetDisposal, {
        ...body,
        digest: yield* digest(body),
      });

      yield* Db.insertDisposal(tx, scope.bookId, result);
      yield* saveCommand(
        tx,
        scope,
        idempotencyKey,
        request.expected,
        operation,
        principal.actorId,
        result,
      );

      return result;
    },
    "update",
  );
});

export const executeImpairment = Effect.fn("subledger.executeImpairment")(function* (
  token: string,
  command: ExecuteCommand,
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (tx, principal) {
      const { scope, id, idempotencyKey, input } = command,
        operation = "execute_subledger_impairment";

      const request = yield* replay(
        tx,
        scope,
        idempotencyKey,
        operation,
        principal.actorId,
        { id, input },
        Subledgers.AssetImpairment,
      );

      if (request.previous) return request.previous;
      const checked = yield* checkedReview(tx, scope, "impairment", id, input);
      const review = yield* decode(Controls.AssetImpairmentReview, checked);

      const postingReceipt = yield* post(
        tx,
        principal,
        scope,
        "impairment",
        input.approvalId,
        review,
      );

      const revision = review.proposedRevision;
      yield* Schedules.insertRevision(tx, {
        bookId: scope.bookId,
        scheduleId: review.input.scheduleId,
        revision: revision.revision,
        evidenceId: revision.terms.evidenceId,
        body: revision,
      });

      const ordinal =
        (yield* Db.listEffects(tx, scope.bookId, "impairment", review.input.scheduleId)).length + 1;

      const body = {
        id: newId("asset_impairment"),
        scope,
        scheduleId: review.input.scheduleId,
        reviewId: id,
        reviewDigest: review.digest,
        approvalId: input.approvalId,
        ordinal,
        decisionKey: review.input.decisionKey,
        postingDate: review.input.postingDate,
        scheduleRevision: revision.revision,
        scheduleDigest: revision.digest,
        basisDigest: review.input.expectedBasisDigest,
        originalCostMinor: review.basis.originalCostMinor,
        openingAccumulatedMinor: review.basis.openingAccumulatedMinor,
        recognizedMinor: review.basis.recognizedMinor,
        reversedMinor: review.basis.reversedMinor,
        priorImpairmentMinor: review.basis.priorImpairmentMinor,
        impairmentMinor: review.input.impairmentMinor,
        netImpairmentMinor: (
          BigInt(review.basis.priorImpairmentMinor) + BigInt(review.input.impairmentMinor)
        ).toString(),
        postImpairmentCarryingMinor: review.basis.postImpairmentCarryingMinor,
        futureMinor: review.basis.futureMinor,
        residualMinor: review.input.residualMinor,
        lossAccountId: review.input.lossAccountId,
        accumulatedImpairmentAccountId: review.input.accumulatedImpairmentAccountId,
        postingReceipt,
        status: "synthetic_impairment",
        futureRecognitionBlocked: false,
        coverage: "not_established",
        legalPolicyApproved: false,
        createdAt: yield* isoNow(tx),
        receipt: { key: idempotencyKey, operation, actorId: principal.actorId },
      };

      const result = yield* decode(Subledgers.AssetImpairment, {
        ...body,
        digest: yield* digest(body),
      });

      const action = review.postingPlan.groups[0]?.actions[0],
        loss = action?.lines[0],
        contra = action?.lines[1];

      if (!action || !loss || !contra) return yield* failure("InternalError");
      yield* Db.insertImpairment(
        tx,
        scope.bookId,
        result,
        action.eventId,
        loss.lineId,
        contra.lineId,
      );
      yield* saveCommand(
        tx,
        scope,
        idempotencyKey,
        request.expected,
        operation,
        principal.actorId,
        result,
      );

      return result;
    },
    "update",
  );
});
