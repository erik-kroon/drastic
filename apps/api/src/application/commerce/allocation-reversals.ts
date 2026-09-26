import { admitLineOwner } from "../resource-admission";
import { digest as digestNative, canonicalText as canonicalNative } from "../json";
import * as Commerce from "@open-erp/contracts/commerce";
import * as Reversal from "@open-erp/contracts/commerce-allocation-reversals";
import * as Effect from "effect/Effect";
import { readInstant } from "../../db/commerce/access";
import * as AllocationDb from "../../db/commerce/allocations";
import * as InvoiceDb from "../../db/commerce/invoices";
import { lockBookForUpdate, readAccounts } from "../../db/posting";
import type { Transaction } from "../../db/transaction";
import * as Accounting from "@open-erp/contracts/accounting";
import { failure } from "../failures";
import { newId, replay, saveCommand } from "../posting";
import { approvalExpiry } from "./approval";
import {
  commandReceipt,
  decode,
  isJsonArray,
  exactKeys,
  objectField,
  readEvidenceReference,
  requireInsertAccess,
  requireTableAccess,
  requireText,
  textField,
  toJsonObject,
  unsupported,
  withBook,
  type JsonObject,
  type Scope,
} from "./support";

const PlanSchema = Reversal.CommerceAllocationReversalPlan;

const PrepareSchema = Reversal.PrepareCommerceAllocationReversal;

const ApproveInputSchema = Reversal.ApproveCommerceAllocationReversal;

const ExecuteInputSchema = Reversal.ExecuteCommerceAllocationReversal;

const ApprovalSchema = Reversal.CommerceAllocationReversalApproval;

const ExecutionSchema = Reversal.CommerceAllocationReversalExecution;

const RevokeInputSchema = Reversal.RevokeCommerceAllocationReversalApproval;

const RevocationSchema = Reversal.CommerceAllocationReversalRevocation;

const ViewSchema = Reversal.CommerceAllocationReversalView;

const ListSchema = Reversal.CommerceAllocationReversalList;

const StatusSchema = Reversal.CommerceAllocationStatus;

const RegisterStatusSchema = Reversal.CommerceRegisterAllocationStatus;

const AllocationPlanSchema = Commerce.AllocationPlan;

const AllocationReceiptSchema = Commerce.AllocationReceipt;

const PaymentCapacitySchema = Commerce.PaymentCapacity;

const AllocationApprovalSchema = Commerce.AllocationApproval;

const ApproveAllocationInputSchema = Commerce.ApproveAllocation;

const InvoiceSchema = Commerce.Invoice;

const PrepareAllocationSchema = Commerce.PrepareAllocation;

const ApplyAllocationSchema = Commerce.ApplyAllocation;

const AllocationViewSchema = Commerce.AllocationView;

const planBound = 50;

const approvalBound = 50;

const pageSize = 25;

const identifier = /^[a-z][a-z0-9_-]{2,127}$/u;

const expectedDependencies = new Set([
  "StaleDependency",
  "PeriodLocked",
  "UnsupportedProfile",
  "NotFound",
]);

const snapshotBytes = 262144;

const prepareFields = ["receiptId", "reason"] as const;

const approveFields = ["digest", "version"] as const;

const executeFields = ["approvalId", "digest", "version"] as const;

const revokeFields = ["reason"] as const;

const prepareAllocationFields = [
  "allocations",
  "evidenceId",
  "lineId",
  "rationale",
  "voucherId",
] as const;

const applyAllocationFields = ["approvalId", "planDigest", "version"] as const;

const allocationLegFields = ["amountMinor", "invoiceId"] as const;

const syntheticProfile = "synthetic-core-v1";

const nativeAuthority = "native";

type AllocationPlan = typeof Commerce.AllocationPlan.Type;

function sameJson(left: JsonObject, right: JsonObject) {
  return Effect.all([canonicalNative(left), canonicalNative(right)]).pipe(
    Effect.map(([first, second]) => first === second),
  );
}

function planSelection(plan: AllocationPlan) {
  return {
    profileVersion: plan.profileVersion,
    writerEpoch: plan.writerEpoch,
    accountVersion: plan.accountVersion,
    paymentPeriodVersion: plan.paymentPeriodVersion,
    payment: plan.payment,
    evidence: plan.evidence,
    rationale: plan.rationale,
    legs: plan.legs,
    totalMinor: plan.totalMinor,
    paymentRemainingAfterMinor: plan.paymentRemainingAfterMinor,
  };
}

function planBody(plan: AllocationPlan) {
  return {
    ...planSelection(plan),
    id: plan.id,
    scope: plan.scope,
    version: plan.version,
    createdAt: plan.createdAt,
    receipt: plan.receipt,
  };
}

function retainedNow(transaction: Transaction) {
  return readInstant(transaction).pipe(
    Effect.flatMap((rows) => {
      const instant = rows[0]?.instant;

      return instant === undefined ? failure("InternalError") : Effect.succeed(instant);
    }),
  );
}

function requireBook(book: AllocationDb.BookAuthorityRow) {
  if (book.profile !== syntheticProfile || book.authority !== nativeAuthority) {
    return unsupported();
  }

  return Effect.void;
}

function requirePaymentCapacity(payment: AllocationDb.PaymentRow) {
  if (
    payment.direction === null ||
    !payment.current ||
    payment.recognition ||
    (payment.direction === "customer" && payment.creditMinor === "0") ||
    (payment.direction === "supplier" && payment.debitMinor === "0")
  ) {
    return failure("InvalidJournal");
  }

  if (payment.reserved) return failure("StaleDependency");
  const amount = BigInt(payment.debitMinor) + BigInt(payment.creditMinor);

  if (BigInt(payment.allocatedMinor) > amount) return failure("StaleDependency");

  return Effect.succeed({
    voucherId: payment.voucherId,
    lineId: payment.lineId,
    amountMinor: amount.toString(),
    allocatedMinor: payment.allocatedMinor,
    remainingMinor: (amount - BigInt(payment.allocatedMinor)).toString(),
    capacityVersion: payment.capacityVersion,
  });
}

function paymentCapacityView(
  book: AllocationDb.BookAuthorityRow,
  scope: Scope,
  payment: AllocationDb.PaymentRow,
) {
  return Effect.gen(function* () {
    const totals = yield* requirePaymentCapacity(payment);

    if (payment.direction === null) return yield* failure("InvalidJournal");

    return yield* decode(PaymentCapacitySchema, {
      scope,
      direction: payment.direction,
      accountId: payment.accountId,
      postingDate: payment.postingDate,
      currency: book.currency,
      currencyScale: book.currencyScale,
      ...totals,
    });
  });
}

function requireAppliedAllocation(
  row: AllocationDb.AllocationReceiptRow,
  legs: ReadonlyArray<AllocationDb.AllocationLegRow>,
  approval: AllocationDb.AllocationApprovalRow,
  paymentVoucherId: string,
  paymentLineId: string,
) {
  return Effect.gen(function* () {
    const receipt = yield* decode(AllocationReceiptSchema, row.body);
    const plan = yield* decode(AllocationPlanSchema, row.plan);
    yield* decode(AllocationApprovalSchema, approval.body);
    const planned = plan.legs;

    if (
      legs.length === 0 ||
      legs.length > planBound ||
      legs.length !== planned.length ||
      approval.planId !== receipt.planId ||
      approval.digest !== plan.digest ||
      receipt.planDigest !== plan.digest ||
      receipt.totalMinor !== plan.totalMinor
    ) {
      return yield* failure("InvalidJournal");
    }

    for (const [index, leg] of legs.entries()) {
      const plannedLeg = planned[index];

      if (
        !plannedLeg ||
        plannedLeg.invoiceId !== leg.invoiceId ||
        plannedLeg.amountMinor !== leg.amountMinor ||
        paymentVoucherId !== leg.paymentVoucherId ||
        paymentLineId !== leg.paymentLineId ||
        leg.ordinal !== index + 1
      ) {
        return yield* failure("InvalidJournal");
      }
    }

    return { receipt, plan };
  });
}

function reversalSnapshot(
  transaction: Transaction,
  scope: Scope,
  book: AllocationDb.BookAuthorityRow,
  receiptId: string,
) {
  return Effect.gen(function* () {
    const receipts = yield* AllocationDb.readAllocationReceipt(
      transaction,
      scope.bookId,
      receiptId,
    );

    const row = receipts[0];

    if (!row) return yield* failure("NotFound");
    const reversed = yield* AllocationDb.readReversedReceipt(transaction, scope.bookId, receiptId);

    if (reversed[0]?.present === true) return yield* failure("StaleDependency");
    const legs = yield* AllocationDb.readAllocationLegs(transaction, scope.bookId, receiptId);

    const approvals = yield* AllocationDb.readAllocationApproval(
      transaction,
      scope.bookId,
      row.approvalId,
    );

    const approval = approvals[0];

    if (!approval) return yield* failure("NotFound");
    const plan = yield* decode(AllocationPlanSchema, row.plan);

    const paymentRows = yield* AllocationDb.readPaymentCapacity(
      transaction,
      scope.bookId,
      plan.payment.voucherId,
      plan.payment.lineId,
    );

    const applied = yield* requireAppliedAllocation(
      row,
      legs,
      approval,
      plan.payment.voucherId,
      plan.payment.lineId,
    );

    const paymentRow = paymentRows[0];

    if (!paymentRow) return yield* failure("NotFound");
    const payment = yield* paymentCapacityView(book, scope, paymentRow);

    const invoices = yield* Effect.forEach(legs, (leg) =>
      Effect.gen(function* () {
        const live = (yield* InvoiceDb.readLiveInvoice(
          transaction,
          scope.bookId,
          leg.invoiceId,
        ))[0];

        if (!live) return yield* failure("NotFound");

        if (live.status === "blocked" || BigInt(live.allocatedMinor) < BigInt(leg.amountMinor)) {
          return yield* failure("StaleDependency");
        }

        return {
          invoice: yield* decode(InvoiceSchema, live.body),
          releasedMinor: leg.amountMinor,
          outstandingAfterMinor: (
            BigInt(live.outstandingMinor ?? "0") + BigInt(leg.amountMinor)
          ).toString(),
        };
      }),
    );

    const periodRows = yield* AllocationDb.readAffectedPeriods(
      transaction,
      scope.bookId,
      receiptId,
      applied.plan.payment.voucherId,
    );

    const periods = periodRows;

    if (periods.length === 0 || periods.some((period) => period.locked)) {
      return yield* failure("PeriodLocked");
    }

    const account = (yield* AllocationDb.readAccountAuthority(
      transaction,
      scope.bookId,
      payment.accountId,
    ))[0];

    if (!account?.active) return yield* failure("StaleDependency");

    const overallocated = yield* AllocationDb.readOverAllocatedInvoice(
      transaction,
      scope.bookId,
      legs.map((leg) => leg.invoiceId),
    );

    if (overallocated[0]?.present === true) return yield* failure("InvalidJournal");

    return {
      original: applied.receipt,
      originalPlan: applied.plan,
      legs: legs.map((leg) => ({
        ordinal: leg.ordinal,
        invoiceId: leg.invoiceId,
        paymentVoucherId: leg.paymentVoucherId,
        paymentLineId: leg.paymentLineId,
        amountMinor: leg.amountMinor,
      })),
      invoices,
      payment,
      paymentRemainingAfterMinor: (
        BigInt(payment.remainingMinor) + BigInt(applied.receipt.totalMinor)
      ).toString(),
      periods: periods.map((period) => ({
        id: period.id,
        version: period.version,
        locked: false,
      })),
      account: { id: account.id, version: account.version },
      profileVersion: book.profileVersion,
      writerEpoch: book.writerEpoch,
    };
  });
}

function currentReversalPlan(
  transaction: Transaction,
  scope: Scope,
  id: string,
  input: { digest: string },
) {
  return Effect.gen(function* () {
    const rows = yield* AllocationDb.readReversalPlan(transaction, scope.bookId, id);
    const row = rows[0];

    if (!row) return yield* failure("NotFound");
    const plan = yield* decode(PlanSchema, row.body);

    if (input.digest !== plan.digest) return yield* failure("StaleDependency");
    const books = yield* AllocationDb.readBookAuthority(transaction, scope.bookId);
    const book = books[0];

    if (!book) return yield* failure("Forbidden");
    yield* requireBook(book);
    const snapshot = yield* reversalSnapshot(transaction, scope, book, row.receiptId);

    const unchanged = yield* sameJson(
      yield* toJsonObject(snapshot),
      yield* toJsonObject(plan.snapshot),
    );

    if (!unchanged) return yield* failure("StaleDependency");

    return { row, plan, book };
  });
}

export const approveAllocation = Effect.fn("commerce.allocation.approve")(function* (
  token: string,
  command: {
    scope: Scope;
    id: string;
    idempotencyKey: string;
    input: typeof Commerce.ApproveAllocation.Type;
  },
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (transaction, principal) {
      const replayInput = { id: command.id, input: command.input } satisfies JsonObject;

      const request = yield* replay(
        transaction,
        command.scope,
        command.idempotencyKey,
        "commerce_approve_allocation",
        principal.actorId,
        replayInput,
        AllocationApprovalSchema,
      );

      if (request.previous) return request.previous;
      yield* requireTableAccess(transaction, AllocationDb.allocationTables, false);
      yield* requireInsertAccess(transaction, ["commerce_allocation_approvals"]);
      yield* lockBookForUpdate(transaction, command.scope);
      yield* exactKeys(yield* toJsonObject(command.input), approveFields);
      const input = yield* decode(ApproveAllocationInputSchema, command.input);

      const plans = yield* AllocationDb.readPlanForReceipt(
        transaction,
        command.scope.bookId,
        command.id,
      );

      const plan = plans[0];

      if (!plan) return yield* failure("NotFound");

      if (input.planDigest !== textField(plan.body, "digest"))
        return yield* failure("StaleDependency");
      const books = yield* AllocationDb.readBookAuthority(transaction, command.scope.bookId);
      const book = books[0];

      if (!book) return yield* failure("Forbidden");
      yield* requireBook(book);

      const accounts = yield* readAccounts(transaction, command.scope.bookId, [
        textField(objectField(plan.body, "payment"), "accountId") ?? "",
      ]);

      if (accounts[0]?.active !== true) return yield* failure("StaleDependency");

      const applied = yield* AllocationDb.readAllocationApplication(
        transaction,
        command.scope.bookId,
        command.id,
      );

      if (applied[0]?.present === true) return yield* failure("IdempotencyConflict");
      const expiresAt = yield* approvalExpiry(transaction);

      const result = yield* decode(AllocationApprovalSchema, {
        id: newId("allocation_approval"),
        planId: command.id,
        planDigest: input.planDigest,
        actorId: principal.actorId,
        expiresAt,
        receipt: commandReceipt(
          command.idempotencyKey,
          "commerce_approve_allocation",
          principal.actorId,
        ),
      });

      yield* AllocationDb.insertAllocationApproval(transaction, {
        bookId: command.scope.bookId,
        id: result.id,
        planId: command.id,
        actorId: principal.actorId,
        digest: input.planDigest,
        expiresAt,
        body: yield* toJsonObject(result),
      });
      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        request.expected,
        "commerce_approve_allocation",
        principal.actorId,
        yield* toJsonObject(result),
      );

      return result;
    },
    "update",
  );
});

export const prepareAllocationReversal = Effect.fn("commerce.allocationReversal.prepare")(
  function* (
    token: string,
    command: {
      scope: Scope;
      idempotencyKey: string;
      input: typeof Reversal.PrepareCommerceAllocationReversal.Type;
    },
  ) {
    return yield* withBook(
      token,
      command.scope,
      false,
      function* (transaction, principal) {
        const request = yield* replay(
          transaction,
          command.scope,
          command.idempotencyKey,
          "prepare_commerce_allocation_reversal",
          principal.actorId,
          command.input,
          PlanSchema,
        );

        if (request.previous) return request.previous;
        yield* requireTableAccess(transaction, AllocationDb.allocationTables, false);
        yield* requireInsertAccess(transaction, ["commerce_allocation_reversal_plans"]);
        const books = yield* AllocationDb.readBookAuthority(transaction, command.scope.bookId);
        const book = books[0];

        if (!book) return yield* failure("Forbidden");
        yield* requireBook(book);
        yield* lockBookForUpdate(transaction, command.scope);
        yield* exactKeys(yield* toJsonObject(command.input), prepareFields);
        const input = yield* decode(PrepareSchema, command.input);

        const counts = yield* AllocationDb.readReversalPlanCount(
          transaction,
          command.scope.bookId,
          input.receiptId,
        );

        if ((counts[0]?.count ?? 0) >= planBound) return yield* unsupported();
        const snapshot = yield* reversalSnapshot(transaction, command.scope, book, input.receiptId);

        const withoutDigest: JsonObject = {
          id: newId("unallocation"),
          version: 1,
          scope: command.scope,
          input,
          snapshot: yield* toJsonObject(snapshot),
          currency: book.currency,
          currencyScale: book.currencyScale,
          createdBy: principal.actorId,
          createdAt: yield* retainedNow(transaction),
          digest: "",
          receipt: commandReceipt(
            command.idempotencyKey,
            "prepare_commerce_allocation_reversal",
            principal.actorId,
          ),
        };

        const digest = yield* digestNative(withoutDigest);
        const body: JsonObject = Object.assign({}, withoutDigest, { digest });

        if (JSON.stringify(body).length > snapshotBytes) return yield* unsupported();
        const result = yield* decode(PlanSchema, body);
        yield* AllocationDb.insertReversalPlan(transaction, {
          bookId: command.scope.bookId,
          id: result.id,
          receiptId: input.receiptId,
          body,
        });
        yield* saveCommand(
          transaction,
          command.scope,
          command.idempotencyKey,
          request.expected,
          "prepare_commerce_allocation_reversal",
          principal.actorId,
          result,
        );

        return result;
      },
      "update",
    );
  },
);

export const approveAllocationReversal = Effect.fn("commerce.allocationReversal.approve")(
  function* (
    token: string,
    command: {
      scope: Scope;
      id: string;
      idempotencyKey: string;
      input: typeof Reversal.ApproveCommerceAllocationReversal.Type;
    },
  ) {
    return yield* withBook(
      token,
      command.scope,
      true,
      function* (transaction, principal) {
        const replayInput = { id: command.id, input: command.input } satisfies JsonObject;

        const request = yield* replay(
          transaction,
          command.scope,
          command.idempotencyKey,
          "approve_commerce_allocation_reversal",
          principal.actorId,
          replayInput,
          ApprovalSchema,
        );

        if (request.previous) return request.previous;
        yield* requireTableAccess(transaction, AllocationDb.allocationTables, false);
        yield* requireInsertAccess(transaction, ["commerce_allocation_reversal_approvals"]);
        yield* lockBookForUpdate(transaction, command.scope);
        yield* exactKeys(yield* toJsonObject(command.input), approveFields);
        const input = yield* decode(ApproveInputSchema, command.input);
        yield* currentReversalPlan(transaction, command.scope, command.id, input);

        const counts = yield* AllocationDb.readReversalApprovalCount(
          transaction,
          command.scope.bookId,
          command.id,
        );

        if ((counts[0]?.count ?? 0) >= approvalBound) return yield* unsupported();
        const expiresAt = yield* approvalExpiry(transaction);

        const result = yield* decode(ApprovalSchema, {
          ...input,
          id: newId("unallocationapproval"),
          planId: command.id,
          actorId: principal.actorId,
          expiresAt,
          receipt: commandReceipt(
            command.idempotencyKey,
            "approve_commerce_allocation_reversal",
            principal.actorId,
          ),
        });

        yield* AllocationDb.insertReversalApproval(transaction, {
          bookId: command.scope.bookId,
          id: result.id,
          planId: command.id,
          actorId: principal.actorId,
          expiresAt,
          body: yield* toJsonObject(result),
        });
        yield* saveCommand(
          transaction,
          command.scope,
          command.idempotencyKey,
          request.expected,
          "approve_commerce_allocation_reversal",
          principal.actorId,
          yield* toJsonObject(result),
        );

        return result;
      },
      "update",
    );
  },
);

export const executeAllocationReversal = Effect.fn("commerce.allocationReversal.execute")(
  function* (
    token: string,
    command: {
      scope: Scope;
      id: string;
      idempotencyKey: string;
      input: typeof Reversal.ExecuteCommerceAllocationReversal.Type;
    },
  ) {
    return yield* withBook(
      token,
      command.scope,
      false,
      function* (transaction, principal) {
        const replayInput = { id: command.id, input: command.input } satisfies JsonObject;

        const request = yield* replay(
          transaction,
          command.scope,
          command.idempotencyKey,
          "execute_commerce_allocation_reversal",
          principal.actorId,
          replayInput,
          ExecutionSchema,
        );

        if (request.previous) return request.previous;
        yield* requireTableAccess(transaction, AllocationDb.allocationTables, false);
        yield* requireInsertAccess(transaction, ["commerce_allocation_reversals"]);
        yield* lockBookForUpdate(transaction, command.scope);
        yield* exactKeys(yield* toJsonObject(command.input), executeFields);
        const input = yield* decode(ExecuteInputSchema, command.input);

        const plans = yield* AllocationDb.readReversalPlan(
          transaction,
          command.scope.bookId,
          command.id,
        );

        const planRow = plans[0];

        if (!planRow) return yield* failure("NotFound");
        const plan = yield* decode(PlanSchema, planRow.body);

        if (input.digest !== plan.digest) return yield* failure("StaleDependency");

        const executed = (yield* AllocationDb.readExecutionForPlan(
          transaction,
          command.scope.bookId,
          command.id,
        ))[0];

        if (executed) {
          if (textField(executed.body, "approvalId") !== input.approvalId) {
            return yield* failure("ApprovalRequired");
          }

          const recovered = yield* decode(ExecutionSchema, executed.body);
          yield* saveCommand(
            transaction,
            command.scope,
            command.idempotencyKey,
            request.expected,
            "execute_commerce_allocation_reversal",
            principal.actorId,
            yield* toJsonObject(recovered),
          );

          return recovered;
        }

        yield* currentReversalPlan(transaction, command.scope, command.id, input);

        const approval = (yield* AllocationDb.readUsableReversalApproval(
          transaction,
          command.scope.bookId,
          command.id,
          input.approvalId,
        ))[0];

        const now = yield* retainedNow(transaction);

        if (
          !approval ||
          approval.expiresAt <= now ||
          approval.digest !== input.digest ||
          approval.revoked === true ||
          approval.operator !== true
        ) {
          return yield* failure("ApprovalRequired");
        }

        const result = yield* decode(ExecutionSchema, {
          version: 1,
          digest: input.digest,
          approvalId: approval.id,
          planId: command.id,
          scope: command.scope,
          receiptId: planRow.receiptId,
          reason: plan.input.reason,
          releasedLegs: plan.snapshot.legs,
          totalMinor: plan.snapshot.original.totalMinor,
          ledgerChanged: false,
          paymentInitiated: false,
          executedAt: now,
          receipt: commandReceipt(
            command.idempotencyKey,
            "execute_commerce_allocation_reversal",
            principal.actorId,
          ),
        });

        yield* AllocationDb.insertExecution(transaction, {
          bookId: command.scope.bookId,
          planId: command.id,
          approvalId: approval.id,
          receiptId: planRow.receiptId,
          body: yield* toJsonObject(result),
        });
        yield* saveCommand(
          transaction,
          command.scope,
          command.idempotencyKey,
          request.expected,
          "execute_commerce_allocation_reversal",
          principal.actorId,
          yield* toJsonObject(result),
        );

        return result;
      },
      "update",
    );
  },
);

export const revokeAllocationReversalApproval = Effect.fn("commerce.allocationReversal.revoke")(
  function* (
    token: string,
    command: {
      scope: Scope;
      id: string;
      idempotencyKey: string;
      input: typeof Reversal.RevokeCommerceAllocationReversalApproval.Type;
    },
  ) {
    return yield* withBook(
      token,
      command.scope,
      true,
      function* (transaction, principal) {
        const replayInput = { id: command.id, input: command.input } satisfies JsonObject;

        const request = yield* replay(
          transaction,
          command.scope,
          command.idempotencyKey,
          "revoke_commerce_allocation_reversal_approval",
          principal.actorId,
          replayInput,
          RevocationSchema,
        );

        if (request.previous) return request.previous;
        yield* requireTableAccess(transaction, AllocationDb.allocationTables, false);
        yield* requireInsertAccess(transaction, ["commerce_allocation_reversal_revocations"]);
        yield* lockBookForUpdate(transaction, command.scope);
        yield* exactKeys(yield* toJsonObject(command.input), revokeFields);
        const input = yield* decode(RevokeInputSchema, command.input);

        const approval = (yield* AllocationDb.readReversalApprovalById(
          transaction,
          command.scope.bookId,
          command.id,
        ))[0];

        if (!approval) return yield* failure("NotFound");

        const executed = yield* AllocationDb.readExecutionForApproval(
          transaction,
          command.scope.bookId,
          command.id,
        );

        if (executed[0]?.present === true || approval.revoked === true) {
          return yield* failure("ApprovalRequired");
        }

        const result = yield* decode(RevocationSchema, {
          approvalId: command.id,
          reason: input.reason,
          actorId: principal.actorId,
          revokedAt: yield* retainedNow(transaction),
          receipt: commandReceipt(
            command.idempotencyKey,
            "revoke_commerce_allocation_reversal_approval",
            principal.actorId,
          ),
        });

        yield* AllocationDb.insertRevocation(transaction, {
          bookId: command.scope.bookId,
          approvalId: command.id,
          body: yield* toJsonObject(result),
        });
        yield* saveCommand(
          transaction,
          command.scope,
          command.idempotencyKey,
          request.expected,
          "revoke_commerce_allocation_reversal_approval",
          principal.actorId,
          yield* toJsonObject(result),
        );

        return result;
      },
      "update",
    );
  },
);

export const getAllocationReversal = Effect.fn("commerce.allocationReversal.get")(function* (
  token: string,
  input: { scope: Scope; id: string },
) {
  return yield* withBook(token, input.scope, false, function* (transaction) {
    yield* requireTableAccess(transaction, AllocationDb.allocationTables, false);
    const rows = yield* AllocationDb.readReversalPlan(transaction, input.scope.bookId, input.id);
    const row = rows[0];

    if (!row) return yield* failure("NotFound");
    const plan = yield* decode(PlanSchema, row.body);

    const execution = (yield* AllocationDb.readExecutionForPlan(
      transaction,
      input.scope.bookId,
      input.id,
    ))[0];

    const approvals = yield* AllocationDb.readReversalApprovals(
      transaction,
      input.scope.bookId,
      input.id,
    );

    const now = yield* retainedNow(transaction);

    const decodedApprovals = yield* Effect.forEach(approvals, (approval) =>
      Effect.gen(function* () {
        const revocation = yield* AllocationDb.readRevocation(
          transaction,
          input.scope.bookId,
          approval.id,
        );

        return {
          approval: yield* decode(ApprovalSchema, approval.body),
          revocation:
            revocation[0] === undefined
              ? null
              : yield* decode(RevocationSchema, revocation[0].body),
        };
      }),
    );

    const usable = approvals.filter(
      (approval) =>
        approval.operator === true &&
        approval.revoked !== true &&
        approval.expiresAt > now &&
        execution === undefined,
    );

    const dependenciesCurrent =
      execution === undefined
        ? yield* Effect.gen(function* () {
            const book = (yield* AllocationDb.readBookAuthority(
              transaction,
              input.scope.bookId,
            ))[0];

            if (!book) return false;
            const snapshot = yield* reversalSnapshot(transaction, input.scope, book, row.receiptId);

            return yield* sameJson(
              yield* toJsonObject(snapshot),
              yield* toJsonObject(plan.snapshot),
            );
          }).pipe(
            Effect.catch((error) =>
              Effect.succeed(
                error instanceof Accounting.AccountingError && expectedDependencies.has(error.code),
              ),
            ),
          )
        : false;

    return yield* decode(ViewSchema, {
      plan,
      approval:
        execution === undefined && usable[0] !== undefined
          ? yield* decode(ApprovalSchema, usable[0].body)
          : null,
      execution: execution === undefined ? null : yield* decode(ExecutionSchema, execution.body),
      dependenciesCurrent,
      approvals: decodedApprovals,
    });
  });
});

export const listAllocationReversals = Effect.fn("commerce.allocationReversal.list")(function* (
  token: string,
  input: { scope: Scope; after: string },
) {
  return yield* withBook(token, input.scope, false, function* (transaction) {
    yield* requireTableAccess(transaction, AllocationDb.allocationTables, false);

    if (input.after !== "" && !identifier.test(input.after)) {
      return yield* failure("InvalidJournal");
    }

    const rows = yield* AllocationDb.readReversalPage(
      transaction,
      input.scope.bookId,
      input.after,
      pageSize + 1,
    );

    const page = rows.slice(0, pageSize);

    return yield* decode(ListSchema, {
      items: yield* Effect.forEach(page, (row) =>
        Effect.gen(function* () {
          const plan = yield* decode(PlanSchema, row.body);

          return {
            id: plan.id,
            receiptId: row.receiptId,
            reason: plan.input.reason,
            createdAt: plan.createdAt,
            execution:
              row.execution === null ? null : yield* decode(ExecutionSchema, row.execution),
          };
        }),
      ),
      next: rows.length > pageSize ? (page[page.length - 1]?.id ?? null) : null,
    });
  });
});

export const getAllocationStatus = Effect.fn("commerce.allocationReversal.status")(function* (
  token: string,
  input: { scope: Scope; id: string },
) {
  return yield* withBook(token, input.scope, false, function* (transaction) {
    yield* requireTableAccess(transaction, AllocationDb.allocationTables, false);

    const receipts = yield* AllocationDb.readAllocationReceipt(
      transaction,
      input.scope.bookId,
      input.id,
    );

    const row = receipts[0];

    if (!row) return yield* failure("NotFound");

    const plans = yield* AllocationDb.readReversalPlanSummaries(
      transaction,
      input.scope.bookId,
      input.id,
    );

    const decoded = yield* Effect.forEach(plans, (entry) =>
      decode(PlanSchema, entry.body).pipe(
        Effect.map((plan) => ({
          id: plan.id,
          createdAt: plan.createdAt,
          reason: plan.input.reason,
        })),
      ),
    );

    const execution = (yield* AllocationDb.readExecutionForReceipt(
      transaction,
      input.scope.bookId,
      input.id,
    ))[0];

    return yield* decode(StatusSchema, {
      original: yield* decode(AllocationReceiptSchema, row.body),
      active: execution === undefined,
      reversal: execution === undefined ? null : yield* decode(ExecutionSchema, execution.body),
      plans: decoded,
    });
  });
});

export const getRegisterAllocationStatus = Effect.fn("commerce.allocationReversal.registerStatus")(
  function* (token: string, input: { scope: Scope; id: string }) {
    return yield* withBook(token, input.scope, false, function* (transaction) {
      yield* requireTableAccess(
        transaction,
        [
          ...AllocationDb.allocationTables,
          "commerce_register_snapshots",
          "commerce_register_allocation_dependencies",
        ],
        false,
      );

      const reports = yield* AllocationDb.readRegisterSnapshot(
        transaction,
        input.scope.bookId,
        input.id,
      );

      const report = reports[0];

      if (!report) return yield* failure("NotFound");
      const asOf = textField(report.body, "asOfDate");

      if (asOf === undefined) return yield* failure("InvalidJournal");
      const captured = isJsonArray(report.body.allocations) ? report.body.allocations : [];

      const agreement = yield* AllocationDb.readRegisterAllocationAgreement(
        transaction,
        input.scope.bookId,
        asOf,
        captured,
      );

      let basisCurrent: boolean;

      if (report.historyVersion !== null) {
        const history = yield* AllocationDb.readAllocationHistoryVersion(
          transaction,
          input.scope.bookId,
          asOf,
        );

        basisCurrent = history[0]?.version === report.historyVersion;
      } else {
        const untouched = yield* AllocationDb.readPreCaptureReversalAgreement(
          transaction,
          input.scope.bookId,
          asOf,
        );

        basisCurrent = untouched[0]?.untouched === true;
      }

      return yield* decode(RegisterStatusSchema, {
        reportId: input.id,
        allocationDependenciesCurrent: basisCurrent && agreement[0]?.current === true,
        historicalSnapshotUnchanged: true,
        otherDependenciesChecked: false,
      });
    });
  },
);

export const getPaymentCapacity = Effect.fn("commerce.allocation.capacity")(function* (
  token: string,
  input: { scope: Scope; voucherId: string; lineId: string },
) {
  return yield* withBook(token, input.scope, false, function* (transaction) {
    yield* requireTableAccess(transaction, AllocationDb.allocationTables, false);

    const rows = yield* AllocationDb.readPaymentCapacity(
      transaction,
      input.scope.bookId,
      input.voucherId,
      input.lineId,
    );

    const payment = rows[0];

    if (!payment) return yield* failure("NotFound");
    const books = yield* AllocationDb.readBookAuthority(transaction, input.scope.bookId);
    const book = books[0];

    if (!book) return yield* failure("Forbidden");

    return yield* paymentCapacityView(book, input.scope, payment);
  });
});

function allocationSelection(
  transaction: Transaction,
  scope: Scope,
  book: AllocationDb.BookAuthorityRow,
  input: typeof Commerce.PrepareAllocation.Type,
) {
  return Effect.gen(function* () {
    yield* requireBook(book);

    const rows = yield* AllocationDb.readPaymentCapacity(
      transaction,
      scope.bookId,
      input.voucherId,
      input.lineId,
    );

    const row = rows[0];

    if (!row) return yield* failure("NotFound");
    const payment = yield* paymentCapacityView(book, scope, row);
    const evidence = yield* readEvidenceReference(transaction, scope.bookId, input.evidenceId);

    const accounts = yield* AllocationDb.readAccountAuthority(
      transaction,
      scope.bookId,
      payment.accountId,
    );

    const account = accounts[0];

    if (!account?.active) return yield* failure("StaleDependency");

    const vouchers = yield* AllocationDb.readPaymentVoucher(
      transaction,
      scope.bookId,
      payment.voucherId,
    );

    const voucher = vouchers[0];

    if (!voucher || voucher.periodLocked) return yield* failure("PeriodLocked");
    let counterpartyId: string | null = null;
    let total = 0n;
    const legs: Array<JsonObject> = [];

    for (const allocation of input.allocations) {
      yield* exactKeys(yield* toJsonObject(allocation), allocationLegFields);
      const amount = BigInt(allocation.amountMinor);

      const live = (yield* InvoiceDb.readLiveInvoice(
        transaction,
        scope.bookId,
        allocation.invoiceId,
      ))[0];

      if (!live) return yield* failure("NotFound");
      const invoice = yield* decode(InvoiceSchema, live.body);
      const outstanding = invoice.outstandingMinor;

      if (outstanding === null) return yield* failure("InvalidJournal");

      if (
        invoice.status === "blocked" ||
        invoice.direction !== payment.direction ||
        invoice.controlAccountId !== payment.accountId ||
        invoice.currency !== payment.currency ||
        invoice.recognition.eventId === voucher.eventId ||
        invoice.recognition.postingDate > payment.postingDate
      ) {
        return yield* failure("InvalidJournal");
      }

      if (counterpartyId === null) counterpartyId = invoice.counterpartyId;

      if (counterpartyId !== invoice.counterpartyId) return yield* failure("InvalidJournal");

      if (amount > BigInt(outstanding)) return yield* failure("StaleDependency");
      total += amount;
      legs.push({
        invoiceId: invoice.id,
        revision: invoice.currentRevision.revision,
        allocationVersion: invoice.allocationVersion,
        documentNumber: invoice.documentNumber,
        counterpartyId,
        counterpartyName: invoice.counterpartyName,
        recognition: yield* toJsonObject(invoice.recognition),
        evidence: yield* toJsonObject(invoice.evidence),
        outstandingBeforeMinor: outstanding,
        amountMinor: allocation.amountMinor,
        outstandingAfterMinor: (BigInt(outstanding) - amount).toString(),
      });
    }

    if (total > BigInt(payment.remainingMinor)) return yield* failure("StaleDependency");

    return {
      profileVersion: book.profileVersion,
      writerEpoch: book.writerEpoch,
      accountVersion: account.version,
      paymentPeriodVersion: voucher.periodVersion,
      payment: yield* toJsonObject(payment),
      evidence,
      rationale: input.rationale,
      legs,
      totalMinor: total.toString(),
      paymentRemainingAfterMinor: (BigInt(payment.remainingMinor) - total).toString(),
    } satisfies JsonObject;
  });
}

function currentAllocation(
  transaction: Transaction,
  scope: Scope,
  book: AllocationDb.BookAuthorityRow,
  plan: AllocationPlan,
) {
  return Effect.gen(function* () {
    const digests = yield* digestNative(yield* toJsonObject(planBody(plan)));

    if (digests !== plan.digest) return false;

    const current = yield* allocationSelection(transaction, scope, book, {
      voucherId: plan.payment.voucherId,
      lineId: plan.payment.lineId,
      evidenceId: plan.evidence.evidenceId,
      rationale: plan.rationale,
      allocations: plan.legs.map((leg) => ({
        invoiceId: leg.invoiceId,
        amountMinor: leg.amountMinor,
      })),
    });

    return yield* sameJson(current, yield* toJsonObject(planSelection(plan)));
  });
}

export const prepareAllocation = Effect.fn("commerce.allocation.prepare")(function* (
  token: string,
  command: {
    scope: Scope;
    idempotencyKey: string;
    input: typeof Commerce.PrepareAllocation.Type;
  },
) {
  return yield* withBook(
    token,
    command.scope,
    false,
    function* (transaction, principal) {
      const request = yield* replay(
        transaction,
        command.scope,
        command.idempotencyKey,
        "commerce_prepare_allocation",
        principal.actorId,
        command.input,
        AllocationPlanSchema,
      );

      if (request.previous) return request.previous;
      yield* requireTableAccess(transaction, AllocationDb.allocationTables, false);
      yield* requireInsertAccess(transaction, ["commerce_allocation_plans"]);
      const books = yield* AllocationDb.readBookAuthority(transaction, command.scope.bookId);
      const book = books[0];

      if (!book) return yield* failure("Forbidden");
      yield* lockBookForUpdate(transaction, command.scope);
      yield* exactKeys(yield* toJsonObject(command.input), prepareAllocationFields);
      const input = yield* decode(PrepareAllocationSchema, command.input);
      yield* requireText(input.rationale, 2000);
      const selection = yield* allocationSelection(transaction, command.scope, book, input);

      const withoutDigest: JsonObject = {
        ...selection,
        id: newId("allocation"),
        scope: command.scope,
        version: 1,
        createdAt: yield* retainedNow(transaction),
        receipt: commandReceipt(
          command.idempotencyKey,
          "commerce_prepare_allocation",
          principal.actorId,
        ),
      };

      const digest = yield* digestNative(withoutDigest);

      const result = yield* decode(
        AllocationPlanSchema,
        Object.assign({}, withoutDigest, { digest }),
      );

      yield* AllocationDb.insertAllocationPlan(transaction, {
        bookId: command.scope.bookId,
        id: result.id,
        body: yield* toJsonObject(result),
      });
      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        request.expected,
        "commerce_prepare_allocation",
        principal.actorId,
        result,
      );

      return result;
    },
    "update",
  );
});

export const getAllocation = Effect.fn("commerce.allocation.get")(function* (
  token: string,
  input: { scope: Scope; id: string },
) {
  return yield* withBook(token, input.scope, false, function* (transaction) {
    yield* requireTableAccess(transaction, AllocationDb.allocationTables, false);
    const plans = yield* AllocationDb.readPlanForReceipt(transaction, input.scope.bookId, input.id);
    const stored = plans[0]?.body;

    if (stored === undefined) return yield* failure("NotFound");
    const plan = yield* decode(AllocationPlanSchema, stored);
    const books = yield* AllocationDb.readBookAuthority(transaction, input.scope.bookId);
    const book = books[0];

    if (!book) return yield* failure("Forbidden");

    const dependenciesCurrent = yield* currentAllocation(transaction, input.scope, book, plan).pipe(
      Effect.catch((error) =>
        error instanceof Accounting.AccountingError ? Effect.succeed(false) : Effect.fail(error),
      ),
    );

    const approvals = yield* AllocationDb.readLatestAllocationApproval(
      transaction,
      input.scope.bookId,
      input.id,
    );

    const receipts = yield* AllocationDb.readAllocationReceiptForPlan(
      transaction,
      input.scope.bookId,
      input.id,
    );

    return yield* decode(AllocationViewSchema, {
      plan,
      dependenciesCurrent,
      approval:
        approvals[0] === undefined
          ? null
          : yield* decode(AllocationApprovalSchema, approvals[0].body),
      application:
        receipts[0] === undefined ? null : yield* decode(AllocationReceiptSchema, receipts[0].body),
    });
  });
});

export const applyAllocation = Effect.fn("commerce.allocation.apply")(function* (
  token: string,
  command: {
    scope: Scope;
    id: string;
    idempotencyKey: string;
    input: typeof Commerce.ApplyAllocation.Type;
  },
) {
  return yield* withBook(
    token,
    command.scope,
    false,
    function* (transaction, principal) {
      const replayInput = { id: command.id, input: command.input } satisfies JsonObject;

      const request = yield* replay(
        transaction,
        command.scope,
        command.idempotencyKey,
        "commerce_apply_allocation",
        principal.actorId,
        replayInput,
        AllocationReceiptSchema,
      );

      if (request.previous) return request.previous;
      yield* requireTableAccess(transaction, AllocationDb.allocationTables, false);
      yield* requireInsertAccess(transaction, [
        "commerce_allocation_receipts",
        "commerce_allocation_legs",
      ]);
      yield* lockBookForUpdate(transaction, command.scope);
      yield* exactKeys(yield* toJsonObject(command.input), applyAllocationFields);
      const input = yield* decode(ApplyAllocationSchema, command.input);

      const plans = yield* AllocationDb.readPlanForReceipt(
        transaction,
        command.scope.bookId,
        command.id,
      );

      const stored = plans[0]?.body;

      if (stored === undefined) return yield* failure("NotFound");

      const applied = yield* AllocationDb.readAllocationApplication(
        transaction,
        command.scope.bookId,
        command.id,
      );

      if (applied[0]?.present === true) return yield* failure("IdempotencyConflict");
      const plan = yield* decode(AllocationPlanSchema, stored);
      const books = yield* AllocationDb.readBookAuthority(transaction, command.scope.bookId);
      const book = books[0];

      if (!book) return yield* failure("Forbidden");

      if (input.planDigest !== plan.digest) return yield* failure("StaleDependency");

      if (!(yield* currentAllocation(transaction, command.scope, book, plan))) {
        return yield* failure("StaleDependency");
      }

      const approvals = yield* AllocationDb.readAllocationApproval(
        transaction,
        command.scope.bookId,
        input.approvalId,
      );

      const approval = approvals[0];

      const consumed = yield* AllocationDb.readAllocationReceiptForApproval(
        transaction,
        command.scope.bookId,
        input.approvalId,
      );

      if (
        !approval ||
        approval.planId !== command.id ||
        approval.digest !== plan.digest ||
        approval.expiresAt <= (yield* retainedNow(transaction)) ||
        consumed[0]?.present === true
      ) {
        return yield* failure("ApprovalRequired");
      }

      const operator = yield* AllocationDb.readOperatorMembership(
        transaction,
        command.scope.bookId,
        approval.actorId,
      );

      if (operator[0]?.present !== true) return yield* failure("ApprovalRequired");
      const id = newId("allocation_receipt");

      const result = yield* decode(AllocationReceiptSchema, {
        id,
        scope: command.scope,
        planId: command.id,
        planDigest: plan.digest,
        approvalId: approval.id,
        totalMinor: plan.totalMinor,
        paymentRemainingMinor: plan.paymentRemainingAfterMinor,
        committedAt: yield* retainedNow(transaction),
        receipt: commandReceipt(
          command.idempotencyKey,
          "commerce_apply_allocation",
          principal.actorId,
        ),
      });

      yield* admitLineOwner(
        transaction,
        command.scope.bookId,
        plan.payment.voucherId,
        plan.payment.lineId,
        "commerce",
      );
      yield* AllocationDb.insertAllocationReceipt(transaction, {
        bookId: command.scope.bookId,
        id,
        planId: command.id,
        approvalId: approval.id,
        body: yield* toJsonObject(result),
      });
      yield* Effect.forEach(plan.legs, (leg, index) =>
        AllocationDb.insertAllocationLeg(transaction, {
          bookId: command.scope.bookId,
          receiptId: id,
          ordinal: index + 1,
          invoiceId: leg.invoiceId,
          paymentVoucherId: plan.payment.voucherId,
          paymentLineId: plan.payment.lineId,
          amountMinor: leg.amountMinor,
        }),
      );
      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        request.expected,
        "commerce_apply_allocation",
        principal.actorId,
        result,
      );

      return result;
    },
    "update",
  );
});
