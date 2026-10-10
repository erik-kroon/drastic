import { runBookCommandWithReceipt } from "../book-commands";
import * as Close from "@open-erp/contracts/financial-close";
import * as Effect from "effect/Effect";
import * as Db from "../../db/closing/financial-close";
import * as Ledger from "../../db/posting";
import type { Transaction } from "../../db/transaction";
import { commandReceipt, decode, toJsonObject, withBook, type Scope } from "../commerce/support";
import { failure } from "../failures";
import { digest } from "../json";
import { isoNow } from "../command-receipts";
import { newId } from "../identifiers";
import { reviewerIsCurrent, withFinancialApproval } from "./financial-authority";

const proposal = Effect.fn("closing.readReopenProposal")(function* (
  tx: Transaction,
  scope: Scope,
  id: string,
) {
  const row = (yield* Db.readReopenProposal(tx, scope.bookId, id))[0];

  if (!row) return yield* failure("NotFound");

  return yield* decode(Close.FinancialReopenProposal, row.body);
});

export const approveYearReopen = Effect.fn("closing.approveYearReopen")(function* (
  token: string,
  command: {
    readonly scope: Scope;
    readonly proposalId: string;
    readonly idempotencyKey: string;
    readonly input: typeof Close.ApproveFinalProposal.Type;
  },
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (tx, principal) {
      const operation = "approve_financial_reopen";

      return yield* runBookCommandWithReceipt(
        tx,
        {
          scope: command.scope,
          idempotencyKey: command.idempotencyKey,
          operation: operation,
          actorId: principal.actorId,
          input: yield* toJsonObject({ proposalId: command.proposalId, input: command.input }),
        },
        Close.FinalProposalApproval,
        Effect.gen(function* () {
          const plan = yield* proposal(tx, command.scope, command.proposalId);

          if (plan.digest !== command.input.digest || plan.createdBy === principal.actorId)
            return yield* failure("ApprovalRequired");

          const periods = yield* Db.lockYearPeriods(tx, command.scope.bookId, plan.fiscalYearId);

          if ((yield* digest(periods)) !== plan.periodDigest)
            return yield* failure("StaleDependency");

          const now = yield* isoNow(tx);

          const result = yield* decode(Close.FinalProposalApproval, {
            id: newId("reopen_approval"),
            scope: command.scope,
            proposalId: plan.id,
            digest: plan.digest,
            version: 1,
            actorId: principal.actorId,
            ordinal: 1,
            expiresAt: new Date(Date.parse(now) + 3600000).toISOString(),
            createdAt: now,
            receipt: commandReceipt(command.idempotencyKey, operation, principal.actorId),
          });

          yield* Db.insertReopenApproval(
            tx,
            command.scope.bookId,
            result.id,
            plan.id,
            principal.actorId,
            yield* toJsonObject(result),
          );

          return { receipt: yield* toJsonObject(result), result: result };
        }),
      );
    },
    "update",
  );
});

export const executeYearReopen = Effect.fn("closing.executeYearReopen")(function* (
  token: string,
  command: {
    readonly scope: Scope;
    readonly proposalId: string;
    readonly idempotencyKey: string;
    readonly input: typeof Close.ExecuteYearReopen.Type;
  },
) {
  return yield* withFinancialApproval(
    token,
    command.scope,
    command.proposalId,
    command.input.approvalId,
    function* (tx, principal) {
      const operation = "execute_financial_reopen";

      return yield* runBookCommandWithReceipt(
        tx,
        {
          scope: command.scope,
          idempotencyKey: command.idempotencyKey,
          operation: operation,
          actorId: principal.actorId,
          input: yield* toJsonObject({ proposalId: command.proposalId, input: command.input }),
        },
        Close.FinancialReopenEvent,
        Effect.gen(function* () {
          const plan = yield* proposal(tx, command.scope, command.proposalId);

          const year = (yield* Ledger.readFiscalYear(
            tx,
            command.scope.bookId,
            plan.fiscalYearId,
          ))[0];

          if (!year || plan.digest !== command.input.digest)
            return yield* failure("StaleDependency");

          const periods = yield* Db.lockYearPeriods(tx, command.scope.bookId, year.id);

          if ((yield* digest(periods)) !== plan.periodDigest)
            return yield* failure("StaleDependency");

          if (
            (yield* Db.readReopenForCertificate(tx, command.scope.bookId, plan.certificateId))
              .length ||
            (yield* Db.readReopenOutcome(tx, command.scope.bookId, plan.id)).length
          )
            return yield* failure("AlreadyPosted");

          const row = (yield* Db.readReopenApproval(
            tx,
            command.scope.bookId,
            command.input.approvalId,
          ))[0];

          if (!row) return yield* failure("ApprovalRequired");

          const approval = yield* decode(Close.FinalProposalApproval, row.body);
          const now = yield* isoNow(tx);

          if (
            approval.proposalId !== plan.id ||
            approval.digest !== plan.digest ||
            Date.parse(approval.expiresAt) <= Date.parse(now) ||
            approval.actorId === principal.actorId ||
            !(yield* reviewerIsCurrent(tx, command.scope.bookId, approval.actorId))
          )
            return yield* failure("ApprovalRequired");

          const refusals = (yield* Db.readDownstreamConsumers(
            tx,
            command.scope.bookId,
            plan.certificateId,
            year.endsOn,
          )).map((consumer) => consumer.id);

          const unlocked = refusals.length
            ? []
            : (yield* Db.setYearPeriodLocks(tx, command.scope.bookId, year.id, false)).map(
                (period) => period.id,
              );

          const body = {
            id: newId("close_reopen"),
            scope: command.scope,
            version: 1,
            certificateId: plan.certificateId,
            fiscalYearId: year.id,
            proposalId: plan.id,
            approvalId: approval.id,
            status: refusals.length ? "refused" : "executed",
            reason: plan.reason,
            downstreamRefusals: refusals,
            unlockedPeriodIds: unlocked,
            createdAt: now,
            receipt: commandReceipt(command.idempotencyKey, operation, principal.actorId),
          };

          const result = yield* decode(Close.FinancialReopenEvent, {
            ...body,
            digest: yield* digest(body),
          });

          yield* Db.insertReopenEvent(tx, {
            bookId: command.scope.bookId,
            id: result.id,
            certificateId: plan.certificateId,
            fiscalYearId: year.id,
            body: yield* toJsonObject(result),
            digest: result.digest,
            recordedAt: now,
          });

          return { receipt: yield* toJsonObject(result), result: result };
        }),
      );
    },
  );
});
