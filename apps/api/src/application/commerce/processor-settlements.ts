import * as Accounting from "@open-erp/contracts/accounting";
import * as Commerce from "@open-erp/contracts/commerce";
import * as Processor from "@open-erp/contracts/processor-clearing";
import * as Effect from "effect/Effect";
import { equalJson } from "@open-erp/domain/canonicalization";
import * as ProcessorDb from "../../db/banking/processor-clearing";
import * as AllocationDb from "../../db/commerce/allocations";
import * as CreditDb from "../../db/commerce/customer-receipts";
import * as Ledger from "../../db/posting";
import type { Transaction } from "../../db/transaction";
import { digest } from "../json";
import { failure } from "../failures";
import { isoNow } from "../command-receipts";
import { newId } from "../identifiers";
import { liveInvoice } from "./register";
import { allocationSelection, applyAllocationInTransaction } from "./allocation-reversals";
import { commandReceipt, decode, toJsonObject, type Principal, type Scope } from "./support";

type Consumption = {
  readonly ownerId: string;
  readonly ownerApprovalId: string;
  readonly capacityVersion: string;
  readonly sourceIdentity: string;
  readonly voucherId: string;
  readonly lineId: string;
  readonly principalMinor: string;
};

export const readProcessorReceivableCapacity = Effect.fn(
  "commerce.readProcessorReceivableCapacity",
)(function* (tx: Transaction, scope: Scope, input: { readonly invoiceId: string }) {
  const invoice = yield* liveInvoice(tx, scope.bookId, input.invoiceId);

  if (
    invoice.direction !== "customer" ||
    invoice.recognition === null ||
    invoice.outstandingMinor === null ||
    invoice.status === "blocked" ||
    invoice.status === "cancelled"
  )
    return yield* failure("UnsupportedProfile");

  return {
    invoiceId: invoice.id,
    customerId: invoice.counterpartyId,
    currency: invoice.currency,
    currencyScale: invoice.currencyScale,
    receivableAccountId: invoice.controlAccountId,
    recognitionVoucherId: invoice.recognition.voucherId,
    remainingMinor: invoice.outstandingMinor,
    version: yield* digest(invoice),
  };
});

export const readProcessorRefundCapacity = Effect.fn("commerce.readProcessorRefundCapacity")(
  function* (tx: Transaction, scope: Scope, input: { readonly originId: string }) {
    const origin = (yield* CreditDb.readOrigin(tx, scope.bookId, input.originId))[0];

    if (!origin) return yield* failure("NotFound");

    const effects = yield* CreditDb.readEffectsForOrigin(tx, scope.bookId, origin.id);

    const remaining =
      BigInt(origin.originalMinor) -
      effects.reduce((total, effect) => total + BigInt(effect.signedConsumedMinor), 0n);

    if (remaining < 0n) return yield* failure("StaleDependency");

    const nativeRow = (yield* ProcessorDb.readNativeCreditBasis(tx, scope.bookId, origin.id))[0];

    const nativeBasis = nativeRow
      ? yield* decode(Processor.NativeCreditOrigin, nativeRow.body)
      : null;

    if (
      nativeBasis &&
      (nativeBasis.currency !== origin.currency ||
        nativeBasis.liabilityAccountId !== origin.creditLiabilityAccountId ||
        nativeBasis.originalNativeMinor !== origin.originalMinor ||
        effects.some((effect) => effect.kind !== "cash_refund"))
    )
      return yield* failure("StaleDependency");

    const consumedNativeMinor = (BigInt(origin.originalMinor) - remaining).toString();

    const releasedCarrying = nativeBasis
      ? (BigInt(nativeBasis.originalCarryingMinor) * BigInt(consumedNativeMinor) * 2n +
          BigInt(nativeBasis.originalNativeMinor)) /
        (BigInt(nativeBasis.originalNativeMinor) * 2n)
      : null;

    return {
      originId: origin.id,
      customerId: origin.customerId,
      currency: origin.currency,
      liabilityAccountId: origin.creditLiabilityAccountId,
      remainingMinor: remaining.toString(),
      nativeBasis,
      consumedNativeMinor,
      carryingRemainingMinor:
        nativeBasis && releasedCarrying !== null
          ? (BigInt(nativeBasis.originalCarryingMinor) - releasedCarrying).toString()
          : null,
      version: yield* digest({ origin, effects, nativeBasis }),
    };
  },
);

const consumptionAuthority = Effect.fn("commerce.processorConsumptionAuthority")(function* (
  tx: Transaction,
  scope: Scope,
  input: Consumption,
) {
  const retained = (yield* ProcessorDb.readReview(tx, scope.bookId, input.ownerId))[0];

  const approvalRow = (yield* ProcessorDb.readApproval(
    tx,
    scope.bookId,
    input.ownerId,
    input.ownerApprovalId,
  ))[0];

  const owned = (yield* ProcessorDb.readOwnedVoucher(tx, scope.bookId, input.voucherId))[0];

  if (
    !retained ||
    !approvalRow ||
    !owned ||
    owned.reviewId !== input.ownerId ||
    owned.sourceIdentity !== input.sourceIdentity
  )
    return yield* failure("ApprovalRequired");

  const review = yield* decode(Processor.Review, retained.body);
  const approval = yield* decode(Processor.Approval, approvalRow.body);
  const now = yield* isoNow(tx);

  const operator = (yield* AllocationDb.readOperatorMembership(
    tx,
    scope.bookId,
    approval.actorId,
  ))[0];

  const admission = (yield* Ledger.readActorAdmission(tx, approval.actorId))[0];

  if (
    review.sourceIdentity !== input.sourceIdentity ||
    approval.digest !== review.digest ||
    approval.expiresAt <= now ||
    !operator?.present ||
    admission?.enabled === false
  )
    return yield* failure("ApprovalRequired");

  const voucher = (yield* Ledger.readVoucher(tx, scope.bookId, input.voucherId))[0];

  if (!voucher || review.postingAction === null || !equalJson(voucher.action, review.postingAction))
    return yield* failure("StaleDependency");

  const action = yield* decode(Accounting.VoucherPostingAction, voucher.action);
  const line = action.lines.find((candidate) => candidate.lineId === input.lineId);

  if (!line || BigInt(input.principalMinor) <= 0n) return yield* failure("InvalidJournal");

  return { review, approval, line };
});

export const consumeProcessorReceivableInTransaction = Effect.fn(
  "commerce.consumeProcessorReceivable",
)(function* (
  tx: Transaction,
  principal: Principal,
  scope: Scope,
  input: Consumption & { readonly invoiceId: string },
) {
  const authority = yield* consumptionAuthority(tx, scope, input);
  const capacity = yield* readProcessorReceivableCapacity(tx, scope, input);

  if (
    authority.review.input.kind !== "observation" ||
    authority.review.input.invoiceId !== input.invoiceId ||
    capacity.version !== input.capacityVersion ||
    authority.line.accountId !== capacity.receivableAccountId ||
    authority.line.debitMinor !== "0" ||
    authority.line.creditMinor !== input.principalMinor ||
    BigInt(input.principalMinor) > BigInt(capacity.remainingMinor)
  )
    return yield* failure("StaleDependency");

  const book = (yield* AllocationDb.readBookAuthority(tx, scope.bookId))[0];

  if (!book || book.currency !== capacity.currency) return yield* failure("UnsupportedProfile");

  const selection = yield* allocationSelection(tx, scope, book, {
    voucherId: input.voucherId,
    lineId: input.lineId,
    evidenceId: authority.review.input.evidenceId,
    rationale: "Approved processor charge consumes the retained receivable.",
    allocations: [{ invoiceId: input.invoiceId, amountMinor: input.principalMinor }],
  });

  if (selection.cashEffect !== undefined) return yield* failure("UnsupportedProfile");

  const key = `processor_allocation_${input.ownerId}`;

  const selectedBody = yield* toJsonObject(selection);

  const body = {
    ...selectedBody,
    id: newId("allocation"),
    scope,
    version: 1,
    createdAt: yield* isoNow(tx),
    receipt: commandReceipt(key, "commerce_processor_allocation", principal.actorId),
  };

  const plan = yield* decode(Commerce.AllocationPlan, { ...body, digest: yield* digest(body) });

  yield* AllocationDb.insertAllocationPlan(tx, {
    bookId: scope.bookId,
    id: plan.id,
    body: yield* toJsonObject(plan),
  });

  const approval = yield* decode(Commerce.AllocationApproval, {
    id: newId("allocation_approval"),
    planId: plan.id,
    planDigest: plan.digest,
    actorId: authority.approval.actorId,
    expiresAt: authority.approval.expiresAt,
    receipt: commandReceipt(
      key,
      "commerce_processor_approval_consequence",
      authority.approval.actorId,
    ),
  });

  yield* AllocationDb.insertProcessorAllocationApproval(tx, {
    bookId: scope.bookId,
    id: approval.id,
    planId: plan.id,
    actorId: approval.actorId,
    digest: plan.digest,
    expiresAt: approval.expiresAt,
    body: yield* toJsonObject(approval),
    ownerReviewId: input.ownerId,
    ownerApprovalId: input.ownerApprovalId,
  });

  return yield* applyAllocationInTransaction(
    tx,
    principal,
    {
      scope,
      id: plan.id,
      idempotencyKey: key,
      input: { version: 1, planDigest: plan.digest, approvalId: approval.id },
    },
    input.ownerId,
  );
});

export const consumeProcessorRefundInTransaction = Effect.fn("commerce.consumeProcessorRefund")(
  function* (
    tx: Transaction,
    _principal: Principal,
    scope: Scope,
    input: Consumption & { readonly originId: string; readonly bookPrincipalMinor?: string },
  ) {
    const authority = yield* consumptionAuthority(tx, scope, input);
    const capacity = yield* readProcessorRefundCapacity(tx, scope, input);

    const bookPrincipalMinor = capacity.nativeBasis
      ? (
          (BigInt(capacity.nativeBasis.originalCarryingMinor) *
            (BigInt(capacity.consumedNativeMinor) + BigInt(input.principalMinor)) *
            2n +
            BigInt(capacity.nativeBasis.originalNativeMinor)) /
            (BigInt(capacity.nativeBasis.originalNativeMinor) * 2n) -
          (BigInt(capacity.nativeBasis.originalCarryingMinor) *
            BigInt(capacity.consumedNativeMinor) *
            2n +
            BigInt(capacity.nativeBasis.originalNativeMinor)) /
            (BigInt(capacity.nativeBasis.originalNativeMinor) * 2n)
        ).toString()
      : input.principalMinor;

    if (input.bookPrincipalMinor !== undefined && input.bookPrincipalMinor !== bookPrincipalMinor)
      return yield* failure("StaleDependency");

    if (
      authority.review.input.kind !== "observation" ||
      authority.review.input.creditOriginId !== input.originId ||
      capacity.version !== input.capacityVersion ||
      authority.line.accountId !== capacity.liabilityAccountId ||
      authority.line.creditMinor !== "0" ||
      authority.line.debitMinor !== bookPrincipalMinor ||
      BigInt(input.principalMinor) > BigInt(capacity.remainingMinor)
    )
      return yield* failure("StaleDependency");

    const id = newId("customer_credit_effect");

    const body = {
      id,
      originId: input.originId,
      consumedMinor: input.principalMinor,
      bookConsumedMinor: bookPrincipalMinor,
      receiptId: input.voucherId,
      sourceIdentity: input.sourceIdentity,
      ownerReviewId: input.ownerId,
      ownerApprovalId: input.ownerApprovalId,
    };

    yield* CreditDb.insertEffect(tx, {
      bookId: scope.bookId,
      id,
      originId: input.originId,
      kind: "cash_refund",
      signedConsumedMinor: input.principalMinor,
      destinationIdentity: input.sourceIdentity,
      receiptId: input.voucherId,
      digest: yield* digest(body),
    });

    return body;
  },
);
