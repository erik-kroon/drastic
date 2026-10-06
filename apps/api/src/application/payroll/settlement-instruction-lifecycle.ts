import * as Settlement from "@open-erp/contracts/payroll-settlements";
import * as Effect from "effect/Effect";
import * as Db from "../../db/payroll/settlements";
import type { Transaction } from "../../db/transaction";
import { withBook, decode, toJsonObject, type Scope } from "../commerce/support";
import { failure } from "../failures";
import { readOnboardingResponsibility } from "../onboarding-policy";
import { newId, replay, saveCommand } from "../posting";
import {
  InstructionRecord,
  claimBalance,
  persist,
  readRetained,
  requireSettlementAccess,
  seal,
} from "./settlement-support";

export const requireInstructionAuthority = Effect.fn("payroll.requireInstructionAuthority")(
  function* (
    tx: Transaction,
    scope: Scope,
    review: typeof Settlement.SettlementReview.Type,
    actorId: string,
  ) {
    const responsibility = yield* readOnboardingResponsibility(tx, scope);

    if (
      !responsibility ||
      actorId === review.createdBy ||
      actorId === review.lawfulBasis?.createdBy ||
      responsibility.assignments.bookkeepingApproverId !== actorId
    )
      return yield* failure("ApprovalRequired");
  },
);

export const netInstructionState = Effect.fn("payroll.netInstructionState")(function* (
  tx: Transaction,
  scope: Scope,
  instructionId: string,
) {
  const instruction = yield* readRetained(
    tx,
    scope,
    "payroll_adjustment_instructions",
    instructionId,
    InstructionRecord,
  );

  if (!instruction.netRecovery) return null;
  const balance = yield* claimBalance(tx, scope, instruction.netRecovery.claimId);
  const cancellation = (yield* Db.readInstructionCancellation(tx, scope.bookId, instruction.id))[0];
  const reservation = (yield* Db.readInstructionReservations(tx, scope.bookId, instruction.id))[0];
  const consumption = (yield* Db.readInstructionConsumption(tx, scope.bookId, instruction.id))[0];

  return {
    instruction: yield* decode(Settlement.AdjustmentSnapshot, instruction),
    cancellation: cancellation
      ? yield* decode(Settlement.AdjustmentInstructionCancellation, cancellation.body)
      : null,
    claimBalanceDigest: balance.digest,
    remainingReceivableMinor: balance.remaining,
    reservedRunId: reservation?.runId ?? null,
    consumedRunId: consumption?.runId ?? null,
  };
});

export const cancelAdjustmentInstruction = Effect.fn("payroll.cancelAdjustmentInstruction")(
  function* (
    token: string,
    command: {
      readonly scope: Scope;
      readonly instructionId: string;
      readonly idempotencyKey: string;
      readonly input: typeof Settlement.CancelAdjustmentInstruction.Type;
    },
  ) {
    return yield* withBook(
      token,
      command.scope,
      true,
      function* (tx, principal) {
        yield* requireSettlementAccess(tx, command.scope, principal.actorId, true);
        const operation = "payroll_cancel_adjustment_instruction";

        const request = yield* replay(
          tx,
          command.scope,
          command.idempotencyKey,
          operation,
          principal.actorId,
          { instructionId: command.instructionId, input: command.input },
          Settlement.AdjustmentInstructionCancellation,
        );

        if (request.previous) return request.previous;

        if (principal.kind !== "betterAuthSession") return yield* failure("ApprovalRequired");

        const instruction = yield* readRetained(
          tx,
          command.scope,
          "payroll_adjustment_instructions",
          command.instructionId,
          InstructionRecord,
        );

        const state = yield* netInstructionState(tx, command.scope, instruction.id);

        if (
          !state ||
          instruction.digest !== command.input.instructionDigest ||
          state.claimBalanceDigest !== command.input.claimBalanceDigest
        )
          return yield* failure("StaleDependency");

        const execution = yield* readRetained(
          tx,
          command.scope,
          "payroll_settlement_executions",
          instruction.executionId,
          Settlement.SettlementExecution,
        );

        const review = yield* readRetained(
          tx,
          command.scope,
          "payroll_settlement_reviews",
          execution.reviewId,
          Settlement.SettlementReview,
        );

        yield* requireInstructionAuthority(tx, command.scope, review, principal.actorId);

        if (state.cancellation || state.reservedRunId || state.consumedRunId)
          return yield* failure("AlreadyPosted");

        const result = yield* seal(
          tx,
          command.scope,
          principal,
          operation,
          command.idempotencyKey,
          Settlement.AdjustmentInstructionCancellation,
          {
            id: newId("payroll_instruction_cancellation"),
            instructionId: instruction.id,
            ...command.input,
          },
        );

        yield* persist(tx, "payroll_adjustment_instruction_cancellations", result);
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
  },
);
