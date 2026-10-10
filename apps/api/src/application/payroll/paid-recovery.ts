import * as Recovery from "@open-erp/contracts/paid-payroll-recovery";
import * as Runs from "@open-erp/contracts/payroll-runs";
import * as Settlement from "@open-erp/contracts/payroll-settlements";
import * as Effect from "effect/Effect";
import * as Db from "../../db/payroll/paid-recovery";
import * as RunDb from "../../db/payroll/runs";
import type { Transaction } from "../../db/transaction";
import {
  decode,
  readEvidenceReference,
  toJsonObject,
  withBook,
  type Scope,
  type Principal,
} from "../commerce/support";
import { failure } from "../failures";
import { newId, replay, saveCommand } from "../posting";
import { currentCalculation } from "./run-basis";
import { validateComparison } from "./paid-comparison-basis";
import { seal } from "./settlement-support";
import { recordAdjustmentBasisInTransaction, prepareSettlementInTransaction } from "./settlements";
import { paidRecoveryView, currentPaidRecoveryAssessment } from "./paid-recovery-view";
import {
  requirePaidRecoveryAccess,
  persistPaidRecoveryRecord,
  readPaidRecoveryRecord,
  LegRecord,
  ClaimReviewLink,
} from "./paid-recovery-records";

type Command<I> = { readonly scope: Scope; readonly idempotencyKey: string; readonly input: I };

type Selected<I> = Command<I> & { readonly recoveryId: string };

type AdjustmentBasisInput = typeof Settlement.RecordAdjustmentBasis.Type;

type MutableAdjustmentBasisInput = {
  -readonly [Field in keyof AdjustmentBasisInput]: AdjustmentBasisInput[Field];
};

export const preparePaidRecovery = Effect.fn("payroll.preparePaidRecovery")(function* (
  token: string,
  command: Command<typeof Recovery.PreparePaidRecovery.Type>,
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (tx, principal) {
      yield* requirePaidRecoveryAccess(tx, command.scope, principal.actorId, true);
      const operation = "payroll_prepare_paid_recovery";

      const request = yield* replay(
        tx,
        command.scope,
        command.idempotencyKey,
        operation,
        principal.actorId,
        command.input,
        Recovery.PaidRecoveryView,
      );

      if (request.previous) return request.previous;

      const { comparison, paid } = yield* validateComparison(
        tx,
        command.scope,
        command.input.comparisonId,
      );

      const { calculation, personRef } = yield* currentCalculation(
        tx,
        command.scope,
        command.input.calculationId,
      );

      const target = -BigInt(comparison.grossDeltaMinor);
      const month = calculation.calculation.earningsPeriod.startsOn.slice(0, 7);

      if (calculation.employeeId !== paid.employeeId) return yield* failure("StaleDependency");

      if (target <= 0n || month <= paid.reportingPeriod)
        return yield* failure("UnsupportedProfile");

      const available = BigInt(calculation.calculation.payableMinor);

      const originalExecutionRow = (yield* RunDb.readExecution(
        tx,
        command.scope.bookId,
        paid.runId,
      ))[0];

      if (!originalExecutionRow) return yield* failure("StaleDependency");
      const originalExecution = yield* decode(Runs.PayrollRunExecution, originalExecutionRow.body);
      const shortfall = target > available ? target - available : 0n;

      const blockers: Array<"missing_lawful_basis" | "insufficient_net_capacity"> = [
        "missing_lawful_basis",
      ];

      if (shortfall > 0n) blockers.push("insufficient_net_capacity");

      const assessment = yield* seal(
        tx,
        command.scope,
        principal,
        operation,
        command.idempotencyKey,
        Recovery.PaidRecoveryAssessment,
        {
          id: newId("paid_recovery"),
          comparisonId: comparison.id,
          comparisonDigest: comparison.digest,
          paidEventId: paid.id,
          paidEventDigest: paid.digest,
          employee: { id: paid.employeeId, name: personRef },
          original: {
            runId: paid.runId,
            voucherId: originalExecution.postingReceipt.voucherId,
            reportingPeriod: paid.reportingPeriod,
            paidOn: paid.paidOn,
            grossMinor: paid.grossCashMinor,
            payableMinor: paid.paidMinor,
          },
          targetMinor: target.toString(),
          contributionDeltaMinor: comparison.contributionDeltaMinor,
          capacity: {
            calculationId: calculation.id,
            digest: calculation.planDigest,
            month,
            availableNetMinor: available.toString(),
            paymentOn: calculation.basis.expectedPaymentOn,
            context: calculation.basis.reviewedInput.reason,
          },
          shortfallMinor: shortfall.toString(),
          blockers,
        },
      );

      yield* persistPaidRecoveryRecord(tx, "payroll_paid_recovery_assessments", assessment);
      const result = yield* paidRecoveryView(tx, command.scope, assessment.id);
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

type Mutation =
  | { readonly kind: "split"; readonly input: typeof Recovery.SplitPaidRecovery.Type }
  | { readonly kind: "attach"; readonly input: typeof Recovery.AttachPaidRecovery.Type }
  | { readonly kind: "qualify"; readonly input: typeof Recovery.QualifyPaidRecovery.Type }
  | { readonly kind: "claim"; readonly input: typeof Recovery.PreparePaidRecoveryClaim.Type }
  | { readonly kind: "cancel"; readonly input: typeof Recovery.CancelPaidRecovery.Type };

const operations = {
  split: "payroll_split_paid_recovery",
  attach: "payroll_attach_paid_recovery",
  qualify: "payroll_qualify_paid_recovery",
  claim: "payroll_prepare_paid_recovery_claim",
  cancel: "payroll_cancel_paid_recovery",
} as const;

const qualifyAttachment = Effect.fn("payroll.qualifyPaidRecoveryAttachment")(function* (
  tx: Transaction,
  scope: Scope,
  principal: Principal,
  view: typeof Recovery.PaidRecoveryView.Type,
  input: typeof Recovery.QualifyPaidRecovery.Type,
  key: string,
) {
  if (principal.kind !== "betterAuthSession") return yield* failure("ApprovalRequired");

  const assessment = view.assessment;

  const attachment = yield* readPaidRecoveryRecord(
    tx,
    scope,
    "payroll_paid_recovery_attachments",
    input.attachmentId,
    Recovery.PaidRecoveryAttachment,
  );

  if (
    attachment.assessmentId !== assessment.id ||
    attachment.digest !== input.attachmentDigest ||
    attachment.assessmentDigest !== assessment.digest
  )
    return yield* failure("StaleDependency");

  if (principal.actorId === attachment.createdBy || principal.actorId === assessment.createdBy)
    return yield* failure("ApprovalRequired");

  if (
    view.qualifications.some(
      (row) => row.attachmentId === attachment.id && row.purpose === input.purpose,
    )
  )
    return yield* failure("AlreadyPosted");

  const basisInput: MutableAdjustmentBasisInput = {
    comparisonId: assessment.comparisonId,
    kind: input.purpose === "gross_claim" ? "gross_recovery" : "future_pay",
    evidenceId: attachment.evidence.evidenceId,
    reason: attachment.reason,
  };

  if (input.purpose === "net_offset") {
    const recoveryClaimId = view.claimExecution?.recoveryClaim?.id;

    if (!recoveryClaimId) return yield* failure("ApprovalRequired");

    basisInput.recoveryClaimId = recoveryClaimId;
  } else {
    if (view.claimExecution) return yield* failure("AlreadyPosted");

    yield* currentPaidRecoveryAssessment(tx, scope, assessment);
  }

  const adjustmentBasis = yield* recordAdjustmentBasisInTransaction(
    tx,
    scope,
    principal,
    basisInput,
    key,
  );

  const qualification = yield* seal(
    tx,
    scope,
    principal,
    operations.qualify,
    key,
    Recovery.PaidRecoveryQualification,
    {
      id: newId("paid_recovery_qualification"),
      assessmentId: assessment.id,
      assessmentDigest: assessment.digest,
      attachmentId: attachment.id,
      attachmentDigest: attachment.digest,
      purpose: input.purpose,
      adjustmentBasis,
    },
  );

  yield* persistPaidRecoveryRecord(tx, "payroll_paid_recovery_qualifications", qualification);
});

const mutatePaidRecovery = Effect.fn("payroll.mutatePaidRecovery")(function* (
  token: string,
  command: {
    readonly scope: Scope;
    readonly idempotencyKey: string;
    readonly recoveryId: string;
  } & Mutation,
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (tx, principal) {
      yield* requirePaidRecoveryAccess(tx, command.scope, principal.actorId, true);
      const operation = operations[command.kind];

      const request = yield* replay(
        tx,
        command.scope,
        command.idempotencyKey,
        operation,
        principal.actorId,
        { recoveryId: command.recoveryId, input: command.input },
        Recovery.PaidRecoveryView,
      );

      if (request.previous) return request.previous;
      const view = yield* paidRecoveryView(tx, command.scope, command.recoveryId);
      const assessment = view.assessment;

      if (view.cancellation) return yield* failure("AlreadyPosted");

      if (command.kind !== "qualify") {
        if (command.input.assessmentDigest !== assessment.digest)
          return yield* failure("StaleDependency");

        if (view.claimExecution) return yield* failure("AlreadyPosted");
        yield* currentPaidRecoveryAssessment(tx, command.scope, assessment);
      }

      if (command.kind === "split") {
        if (view.drafts.length) return yield* failure("AlreadyPosted");
        const draftId = newId("paid_recovery_draft");
        const target = BigInt(assessment.targetMinor);
        const capacity = BigInt(assessment.capacity.availableNetMinor);
        const firstAmount = target < capacity ? target : capacity;
        const legs = [];

        if (firstAmount > 0n)
          legs.push({
            id: newId("paid_recovery_leg"),
            month: assessment.capacity.month,
            amountMinor: firstAmount.toString(),
            capacityCalculationId: assessment.capacity.calculationId,
            capacityDigest: assessment.capacity.digest,
          });

        if (target > firstAmount) {
          const next = new Date(`${assessment.capacity.month}-01T00:00:00Z`);
          next.setUTCMonth(next.getUTCMonth() + 1);
          legs.push({
            id: newId("paid_recovery_leg"),
            month: next.toISOString().slice(0, 7),
            amountMinor: (target - firstAmount).toString(),
            capacityCalculationId: null,
            capacityDigest: null,
          });
        }

        const retained = yield* seal(
          tx,
          command.scope,
          principal,
          operation,
          command.idempotencyKey,
          Recovery.PaidRecoveryDraft,
          { id: draftId, assessmentId: assessment.id, assessmentDigest: assessment.digest, legs },
        );

        yield* persistPaidRecoveryRecord(tx, "payroll_paid_recovery_drafts", retained);

        for (const leg of legs) {
          const row = yield* seal(
            tx,
            command.scope,
            principal,
            operation,
            command.idempotencyKey,
            LegRecord,
            { ...leg, assessmentId: assessment.id, draftId },
          );

          yield* persistPaidRecoveryRecord(tx, "payroll_paid_recovery_legs", row);
        }
      } else if (command.kind === "attach") {
        if (view.attachments.length >= 100) return yield* failure("UnsupportedProfile");

        const evidence = yield* readEvidenceReference(
          tx,
          command.scope.bookId,
          command.input.evidenceId,
        );

        const attachment = yield* seal(
          tx,
          command.scope,
          principal,
          operation,
          command.idempotencyKey,
          Recovery.PaidRecoveryAttachment,
          {
            id: newId("paid_recovery_attachment"),
            assessmentId: assessment.id,
            assessmentDigest: assessment.digest,
            evidence,
            reason: command.input.reason,
          },
        );

        yield* persistPaidRecoveryRecord(tx, "payroll_paid_recovery_attachments", attachment);
      } else if (command.kind === "qualify") {
        yield* qualifyAttachment(
          tx,
          command.scope,
          principal,
          view,
          command.input,
          command.idempotencyKey,
        );
      } else if (command.kind === "claim") {
        if (view.claimReview) return yield* failure("AlreadyPosted");

        const qualification = yield* readPaidRecoveryRecord(
          tx,
          command.scope,
          "payroll_paid_recovery_qualifications",
          command.input.qualificationId,
          Recovery.PaidRecoveryQualification,
        );

        if (
          qualification.assessmentId !== assessment.id ||
          qualification.assessmentDigest !== assessment.digest ||
          qualification.purpose !== "gross_claim"
        )
          return yield* failure("StaleDependency");

        const review = yield* prepareSettlementInTransaction(tx, principal, {
          scope: command.scope,
          idempotencyKey: `${command.idempotencyKey}_review`,
          input: {
            kind: "gross_recovery",
            comparisonId: assessment.comparisonId,
            lawfulBasisId: qualification.adjustmentBasis.id,
            recoveryReceivableAccountId: command.input.recoveryReceivableAccountId,
            futureMonth: null,
            evidenceId: qualification.adjustmentBasis.evidence.evidenceId,
            accountingPeriodId: command.input.accountingPeriodId,
            postingDate: command.input.postingDate,
            series: command.input.series,
            reason: qualification.adjustmentBasis.input.reason,
          },
        });

        if (
          review.outputs.amountMinor !== assessment.targetMinor ||
          review.outputs.contributionCorrectionMinor !== assessment.contributionDeltaMinor
        )
          return yield* failure("StaleDependency");

        const link = yield* seal(
          tx,
          command.scope,
          principal,
          operation,
          command.idempotencyKey,
          ClaimReviewLink,
          {
            id: newId("paid_recovery_claim_review"),
            assessmentId: assessment.id,
            qualificationId: qualification.id,
            reviewId: review.id,
          },
        );

        yield* persistPaidRecoveryRecord(tx, "payroll_paid_recovery_claim_reviews", link);
      } else {
        const cancellation = yield* seal(
          tx,
          command.scope,
          principal,
          operation,
          command.idempotencyKey,
          Recovery.PaidRecoveryCancellation,
          {
            id: newId("paid_recovery_cancellation"),
            assessmentId: assessment.id,
            ...command.input,
          },
        );

        yield* persistPaidRecoveryRecord(tx, "payroll_paid_recovery_cancellations", cancellation);
      }

      const result = yield* paidRecoveryView(tx, command.scope, assessment.id);
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

export function splitPaidRecovery(
  token: string,
  command: Selected<typeof Recovery.SplitPaidRecovery.Type>,
) {
  return mutatePaidRecovery(token, { ...command, kind: "split" });
}

export function attachPaidRecovery(
  token: string,
  command: Selected<typeof Recovery.AttachPaidRecovery.Type>,
) {
  return mutatePaidRecovery(token, { ...command, kind: "attach" });
}

export function qualifyPaidRecovery(
  token: string,
  command: Selected<typeof Recovery.QualifyPaidRecovery.Type>,
) {
  return mutatePaidRecovery(token, { ...command, kind: "qualify" });
}

export function preparePaidRecoveryClaim(
  token: string,
  command: Selected<typeof Recovery.PreparePaidRecoveryClaim.Type>,
) {
  return mutatePaidRecovery(token, { ...command, kind: "claim" });
}

export function cancelPaidRecovery(
  token: string,
  command: Selected<typeof Recovery.CancelPaidRecovery.Type>,
) {
  return mutatePaidRecovery(token, { ...command, kind: "cancel" });
}

export const getPaidRecovery = Effect.fn("payroll.getPaidRecovery")(function* (
  token: string,
  command: { readonly scope: Scope; readonly recoveryId: string },
) {
  return yield* withBook(token, command.scope, false, function* (tx, principal) {
    yield* requirePaidRecoveryAccess(tx, command.scope, principal.actorId, false);

    return yield* paidRecoveryView(tx, command.scope, command.recoveryId);
  });
});

export const listPaidRecoveries = Effect.fn("payroll.listPaidRecoveries")(function* (
  token: string,
  command: { readonly scope: Scope; readonly cursor?: string },
) {
  return yield* withBook(token, command.scope, false, function* (tx, principal) {
    yield* requirePaidRecoveryAccess(tx, command.scope, principal.actorId, false);

    if (command.cursor)
      yield* readPaidRecoveryRecord(
        tx,
        command.scope,
        "payroll_paid_recovery_assessments",
        command.cursor,
        Recovery.PaidRecoveryAssessment,
      );
    const rows = yield* Db.list(tx, command.scope.bookId, command.cursor);
    const items = [];

    for (const row of rows.slice(0, 20)) {
      const assessment = yield* decode(Recovery.PaidRecoveryAssessment, row.body);
      items.push(yield* paidRecoveryView(tx, command.scope, assessment.id));
    }

    return { items, next: rows.length > 20 ? (items.at(-1)?.assessment.id ?? null) : null };
  });
});

export const listPaidRecoveryBasisSources = Effect.fn("payroll.listPaidRecoveryBasisSources")(
  function* (token: string, command: { readonly scope: Scope; readonly cursor?: string }) {
    return yield* withBook(token, command.scope, false, function* (tx, principal) {
      yield* requirePaidRecoveryAccess(tx, command.scope, principal.actorId, false);

      if (command.cursor) yield* readEvidenceReference(tx, command.scope.bookId, command.cursor);
      const rows = yield* Db.basisSources(tx, command.scope.bookId, command.cursor);

      return yield* decode(Recovery.PaidRecoveryBasisSources, {
        scope: command.scope,
        items: rows.slice(0, 20),
        next: rows.length > 20 ? (rows[19]?.id ?? null) : null,
      });
    });
  },
);
