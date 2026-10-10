import * as Contracts from "@open-erp/contracts/historical-adoptions";
import * as Domain from "@open-erp/domain/historical-adoptions";
import * as Effect from "effect/Effect";
import * as Db from "../../db/commerce/historical-settlements";
import * as AllocationDb from "../../db/commerce/allocations";
import * as Ledger from "../../db/posting";
import type { Transaction } from "../../db/transaction";
import { decode, withBook, type Scope } from "./support";
import { approvalExpiry } from "./approval";
import { readHistoricalObligation } from "./historical-obligations";
import { readPool, assertPoolBasis, checkedAdoption } from "../sie/adoption-basis";
import { admitLineOwner, admitAccountRole } from "../resource-admission";
import { failure } from "../failures";
import { digest } from "../json";
import { isoNow, replay, saveCommand } from "../command-receipts";
import { newId } from "../identifiers";
import { authorize } from "../authority";

type Command = { scope: Scope; id: string; idempotencyKey: string };

const readSettlementPlan = Effect.fn("commerce.readHistoricalSettlementPlan")(function* (
  tx: Transaction,
  scope: Scope,
  id: string,
) {
  const row = (yield* Db.readPlan(tx, scope.bookId, id))[0];

  if (!row) return yield* failure("NotFound");

  return yield* decode(Contracts.SettlementPlan, row.body);
});

const settlementBasis = Effect.fn("commerce.historicalSettlementBasis")(function* (
  tx: Transaction,
  scope: Scope,
  input: typeof Contracts.PrepareSettlement.Type,
) {
  const obligation = yield* readHistoricalObligation(tx, scope, input.adoptionId);
  const pool = yield* readPool(tx, scope, obligation.adoption.poolId);
  yield* assertPoolBasis(tx, scope, pool);

  if (obligation.version !== input.expectedVersion) return yield* failure("StaleDependency");
  yield* admitLineOwner(tx, scope.bookId, input.paymentVoucherId, input.paymentLineId, "commerce");
  yield* admitAccountRole(tx, scope.bookId, pool.controlAccountId, "commerce");

  const payment = (yield* AllocationDb.readPaymentCapacity(
    tx,
    scope.bookId,
    input.paymentVoucherId,
    input.paymentLineId,
  ))[0];

  if (!payment) return yield* failure("NotFound");
  const direction = pool.input.direction === "AR" ? "customer" : "supplier";

  if (
    !payment.current ||
    payment.recognition ||
    payment.reserved ||
    payment.accountId !== pool.controlAccountId ||
    payment.direction !== direction ||
    payment.postingDate <= pool.input.cutoverOn ||
    (direction === "customer"
      ? BigInt(payment.debitMinor) !== 0n
      : BigInt(payment.creditMinor) !== 0n)
  )
    return yield* failure("InvalidJournal");

  const remaining =
    BigInt(payment.debitMinor) + BigInt(payment.creditMinor) - BigInt(payment.allocatedMinor);

  if (BigInt(input.amountMinor) > remaining) return yield* failure("InvalidJournal");

  const period = (yield* AllocationDb.readPaymentVoucher(
    tx,
    scope.bookId,
    input.paymentVoucherId,
  ))[0];

  if (!period) return yield* failure("NotFound");
  const currentPeriod = (yield* Ledger.readPeriod(tx, scope.bookId, period.periodId))[0];

  if (!currentPeriod || currentPeriod.locked) return yield* failure("PeriodLocked");

  const remainingAfterMinor = yield* checkedAdoption(
    Domain.prepareSettlement({
      remainingMinor: obligation.remainingMinor,
      paymentMinor: input.amountMinor,
    }),
  );

  return { pool, payment, remainingAfterMinor, adoptionId: obligation.adoption.id };
});

export const prepareHistoricalSettlement = Effect.fn("commerce.prepareHistoricalSettlement")(
  function* (
    token: string,
    command: {
      scope: Scope;
      idempotencyKey: string;
      input: typeof Contracts.PrepareSettlement.Type;
    },
  ) {
    return yield* withBook(
      token,
      command.scope,
      true,
      function* (tx, principal) {
        const { scope, input, idempotencyKey } = command,
          operation = "prepare_historical_settlement";

        const request = yield* replay(
          tx,
          scope,
          idempotencyKey,
          operation,
          principal.actorId,
          input,
          Contracts.SettlementPlan,
        );

        if (request.previous) return request.previous;
        const basis = yield* settlementBasis(tx, scope, input);

        const body = {
          id: newId("historicalsettlementplan"),
          scope,
          input: { ...input, adoptionId: basis.adoptionId },
          controlAccountId: basis.pool.controlAccountId,
          direction: basis.pool.input.direction,
          paymentCapacityVersion: basis.payment.capacityVersion,
          remainingAfterMinor: basis.remainingAfterMinor,
          createdBy: principal.actorId,
          createdAt: yield* isoNow(tx),
        };

        const result = yield* decode(Contracts.SettlementPlan, {
          ...body,
          digest: yield* digest(body),
        });

        yield* Db.insertPlan(tx, scope.bookId, result);
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
  },
);

export const getHistoricalSettlementPlan = Effect.fn("commerce.getHistoricalSettlementPlan")(
  function* (token: string, command: { scope: Scope; id: string }) {
    return yield* withBook(token, command.scope, false, function* (tx) {
      return yield* readSettlementPlan(tx, command.scope, command.id);
    });
  },
);

export const approveHistoricalSettlement = Effect.fn("commerce.approveHistoricalSettlement")(
  function* (token: string, command: Command & { input: typeof Contracts.Approve.Type }) {
    return yield* withBook(
      token,
      command.scope,
      true,
      function* (tx, principal) {
        const { scope, id, input, idempotencyKey } = command,
          operation = "approve_historical_settlement";

        const request = yield* replay(
          tx,
          scope,
          idempotencyKey,
          operation,
          principal.actorId,
          { planId: id, input },
          Contracts.Approval,
        );

        if (request.previous) return request.previous;

        yield* authorize(principal, "approve_historical_settlement");
        const plan = yield* readSettlementPlan(tx, scope, id);

        if (plan.digest !== input.digest) return yield* failure("StaleDependency");
        const basis = yield* settlementBasis(tx, scope, plan.input);

        if (basis.payment.capacityVersion !== plan.paymentCapacityVersion)
          return yield* failure("StaleDependency");

        const result = yield* decode(Contracts.Approval, {
          id: newId("historicalsettlementapproval"),
          planId: id,
          planDigest: plan.digest,
          actorId: principal.actorId,
          expiresAt: yield* approvalExpiry(tx),
          createdAt: yield* isoNow(tx),
        });

        yield* Db.insertApproval(tx, scope.bookId, result);
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
  },
);

export const executeHistoricalSettlement = Effect.fn("commerce.executeHistoricalSettlement")(
  function* (token: string, command: Command & { input: typeof Contracts.Execute.Type }) {
    return yield* withBook(
      token,
      command.scope,
      true,
      function* (tx, principal) {
        const { scope, id, input, idempotencyKey } = command,
          operation = "execute_historical_settlement";

        const request = yield* replay(
          tx,
          scope,
          idempotencyKey,
          operation,
          principal.actorId,
          { planId: id, input },
          Contracts.Settlement,
        );

        if (request.previous) return request.previous;
        const plan = yield* readSettlementPlan(tx, scope, id);

        if (plan.digest !== input.digest) return yield* failure("StaleDependency");

        if ((yield* Db.readSettlementForPlan(tx, scope.bookId, id)).length)
          return yield* failure("AlreadyPosted");
        const basis = yield* settlementBasis(tx, scope, plan.input);

        if (
          basis.payment.capacityVersion !== plan.paymentCapacityVersion ||
          basis.remainingAfterMinor !== plan.remainingAfterMinor
        )
          return yield* failure("StaleDependency");
        const row = (yield* Db.readApproval(tx, scope.bookId, input.approvalId))[0];

        if (!row) return yield* failure("ApprovalRequired");
        const approval = yield* decode(Contracts.Approval, row.body);

        if (approval.planId !== plan.id || approval.planDigest !== plan.digest)
          return yield* failure("ApprovalRequired");

        const result = yield* decode(Contracts.Settlement, {
          id: newId("historicalsettlement"),
          scope,
          planId: id,
          adoptionId: plan.input.adoptionId,
          paymentVoucherId: plan.input.paymentVoucherId,
          paymentLineId: plan.input.paymentLineId,
          amountMinor: plan.input.amountMinor,
          remainingMinor: basis.remainingAfterMinor,
          approvalId: approval.id,
          journalIds: [],
          createdAt: yield* isoNow(tx),
        });

        yield* Db.insertSettlement(tx, scope.bookId, result);
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
  },
);
