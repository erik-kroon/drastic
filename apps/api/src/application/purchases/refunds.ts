import { runBookCommand } from "../book-commands";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Credits from "@open-erp/contracts/supplier-credits";
import * as Refunds from "@open-erp/contracts/supplier-refunds";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import type * as Schema from "effect/Schema";
import { derivePaidPosition } from "@open-erp/domain/supplier-refunds";
import { failure } from "../failures";
import * as CreditDb from "../../db/purchases/credits";
import * as RefundDb from "../../db/purchases/refunds";
import { liveInvoice } from "../commerce/register";
import { digest } from "../json";
import { isoNow } from "../command-receipts";
import { newId } from "../identifiers";
import {
  prepareJournalInTransaction,
  approveChangeInTransaction,
  executeChangeInTransaction,
} from "../posting";
import { validatePlan } from "../posting-validation";
import * as Shared from "./shared";
import * as Recognition from "./recognition";
import { checkedPaidCredit, paidCreditSnapshot } from "./credit-basis";

type Scope = typeof Accounting.Scope.Type;

type Json = Schema.Json;

type PaidSnapshot = typeof Refunds.PaidSupplierCreditSnapshot.Type;

type JournalLine = {
  readonly accountId: string;
  readonly debitMinor: string;
  readonly creditMinor: string;
  readonly description: string;
};

// A paid credit posts the exact line releases its compiler produced, split
// across the payable release and the explicit refund receivable. No zero
// line is manufactured; a fully refundable credit carries no payable line.
function paidJournalLines(snapshot: PaidSnapshot) {
  const lines: Array<JournalLine> = [];

  if (BigInt(snapshot.paid.apReleaseMinor) > 0n) {
    lines.push({
      accountId: snapshot.invoice.controlAccountId,
      debitMinor: snapshot.paid.apReleaseMinor,
      creditMinor: "0",
      description: "Reduce supplier payable",
    });
  }

  if (BigInt(snapshot.paid.refundPrincipalIncreaseMinor) > 0n) {
    lines.push({
      accountId: snapshot.paid.refundReceivableAccountId,
      debitMinor: snapshot.paid.refundPrincipalIncreaseMinor,
      creditMinor: "0",
      description: "Supplier refund receivable",
    });
  }

  for (const release of snapshot.lineReleases ?? []) {
    lines.push({
      accountId: release.expenseAccountId,
      debitMinor: "0",
      creditMinor: release.expenseMinor,
      description: `Supplier credit ${release.sourceLineId}`,
    });

    if (BigInt(release.releasedDeductionMinor) > 0n && release.inputVatAccountId !== null) {
      lines.push({
        accountId: release.inputVatAccountId,
        debitMinor: "0",
        creditMinor: release.releasedDeductionMinor,
        description: `Input VAT credit ${release.sourceLineId}`,
      });
    }
  }

  return lines;
}

const maximumReviews = 50;

const maximumApprovals = 50;

const maximumReviewBytes = 262144;

const maximumHistory = 200;

const approvalWindowMs = 60 * 60 * 1000;

type Position = {
  readonly invoice: Effect.Success<ReturnType<typeof liveInvoice>>;
  readonly grossMinor: string;
  readonly creditedMinor: string;
  readonly paidMinor: string;
  readonly refundedMinor: string;
  readonly refundAccountId: string | null;
};

// G/K/P/Q from the retained rows: original gross, every credit, every
// effective payment leg and owner discharge, every allocated refund.
const readPosition = Effect.fn("purchases.refunds.position")(function* (
  tx: import("../../db/transaction").Transaction,
  scope: Scope,
  invoiceId: string,
) {
  const invoice = yield* liveInvoice(tx, scope.bookId, invoiceId);

  if (invoice.recognition === null) return yield* failure("UnsupportedProfile");

  if (invoice.direction !== "supplier") return yield* failure("NotFound");

  const row = (yield* RefundDb.readPaidPosition(tx, scope.bookId, invoiceId))[0];

  if (!row) return yield* failure("NotFound");

  return {
    invoice,
    grossMinor: row.grossMinor,
    creditedMinor: row.creditedMinor,
    paidMinor: (BigInt(row.allocatedLegsMinor) + BigInt(row.ownerDischargeMinor)).toString(),
    refundedMinor: row.refundedMinor,
    refundAccountId: row.refundAccountId,
  } satisfies Position;
});

const derivedPosition = Effect.fn("purchases.refunds.derived")(function* (
  scope: Scope,
  invoiceId: string,
  position: Position,
  currency: string,
) {
  const derived = derivePaidPosition({
    originalGrossMinor: position.grossMinor,
    creditedMinor: position.creditedMinor,
    paidMinor: position.paidMinor,
    refundedMinor: position.refundedMinor,
  });

  if (Result.isFailure(derived)) return yield* failure("StaleDependency");

  return yield* Shared.decode(Refunds.SupplierRefundPosition, {
    scope,
    invoiceId,
    currency,
    originalGrossMinor: position.grossMinor,
    creditedMinor: position.creditedMinor,
    paidMinor: position.paidMinor,
    refundedMinor: position.refundedMinor,
    unpaidMinor: derived.success.unpaidMinor,
    refundPrincipalMinor: derived.success.refundPrincipalMinor,
    refundDueMinor: derived.success.refundDueMinor,
    refundReceivableAccountId: position.refundAccountId,
    invoiceRevision: position.invoice.currentRevision.revision,
    allocationVersion: position.invoice.allocationVersion,
  });
});

export const getSupplierRefundPosition = Effect.fn("purchases.refunds.getPosition")(function* (
  token: string,
  command: { readonly scope: Scope; readonly invoiceId: string },
) {
  return yield* Shared.withBook(token, command.scope, false, "share", (transaction) =>
    Effect.gen(function* () {
      yield* Shared.requireTables(transaction, RefundDb.refundTables);

      const book = (yield* Shared.PurchaseDb.lockBook(
        transaction,
        command.scope.bookId,
        "share",
      ))[0];

      if (!book) return yield* failure("Forbidden");

      const position = yield* readPosition(transaction, command.scope, command.invoiceId);

      return yield* derivedPosition(
        command.scope,
        command.invoiceId,
        position,
        position.invoice.currency,
      );
    }),
  );
});

export const supplierRefundHistory = Effect.fn("purchases.refunds.history")(function* (
  token: string,
  command: { readonly scope: Scope; readonly invoiceId: string },
) {
  return yield* Shared.withBook(token, command.scope, false, "share", (transaction) =>
    Effect.gen(function* () {
      yield* Shared.requireTables(transaction, RefundDb.refundTables);

      const book = (yield* Shared.PurchaseDb.lockBook(
        transaction,
        command.scope.bookId,
        "share",
      ))[0];

      if (!book) return yield* failure("Forbidden");

      const position = yield* readPosition(transaction, command.scope, command.invoiceId);

      const live = yield* derivedPosition(
        command.scope,
        command.invoiceId,
        position,
        position.invoice.currency,
      );

      const items: Array<typeof Refunds.SupplierRefundHistoryItem.Type> = [];

      for (const row of yield* CreditDb.listCredits(
        transaction,
        command.scope.bookId,
        command.invoiceId,
      )) {
        const credit = yield* Shared.decode(Credits.SupplierCreditReceipt, row.body);

        items.push({
          kind: "credit",
          id: credit.id,
          amountMinor: credit.amountMinor,
          accountingOn: credit.creditDate,
          recordedAt: credit.createdAt,
          body: yield* Shared.toJson(credit),
        });
      }

      for (const leg of yield* RefundDb.listPaymentLegs(
        transaction,
        command.scope.bookId,
        command.invoiceId,
      )) {
        items.push({
          kind: "payment",
          id: leg.receiptId,
          amountMinor: leg.amountMinor,
          accountingOn: leg.postingOn,
          recordedAt: leg.recordedAt ?? leg.postingOn,
          body: yield* Shared.toJson(leg),
        });
      }

      for (const discharge of yield* RefundDb.listOwnerDischarges(
        transaction,
        command.scope.bookId,
        command.invoiceId,
      )) {
        items.push({
          kind: "payment",
          id: discharge.id,
          amountMinor: discharge.amountMinor,
          accountingOn: discharge.postingOn,
          recordedAt: discharge.recordedAt,
          body: yield* Shared.toJson(discharge),
        });
      }

      for (const increase of yield* RefundDb.readIncreases(
        transaction,
        command.scope.bookId,
        command.invoiceId,
      )) {
        const created = Shared.textField(increase.body, "createdAt") ?? "";
        const creditOn = Shared.textField(increase.body, "creditDate") ?? "";

        items.push({
          kind: "principal_increase",
          id: increase.id,
          amountMinor: increase.refundIncreaseMinor,
          accountingOn: creditOn,
          recordedAt: created,
          body: yield* Shared.toJson(increase.body),
        });
      }

      for (const row of yield* RefundDb.listRefunds(
        transaction,
        command.scope.bookId,
        command.invoiceId,
      )) {
        const refund = yield* Shared.decode(Refunds.SupplierRefundReceipt, row.body);

        items.push({
          kind: "refund",
          id: refund.id,
          amountMinor: refund.amountMinor,
          accountingOn: refund.refundDate,
          recordedAt: refund.createdAt,
          body: yield* Shared.toJson(refund),
        });
      }

      if (items.length > maximumHistory) return yield* failure("InvalidJournal");

      return yield* Shared.decode(Refunds.SupplierRefundHistory, {
        scope: command.scope,
        invoiceId: command.invoiceId,
        position: live,
        count: items.length,
        items,
      });
    }),
  );
});

export const getPaidSupplierCreditReview = Effect.fn("purchases.refunds.getPaidReview")(function* (
  token: string,
  command: { readonly scope: Scope; readonly reviewId: string },
) {
  return yield* Shared.withBook(token, command.scope, false, "share", (transaction) =>
    Effect.gen(function* () {
      yield* Shared.requireTables(transaction, RefundDb.refundTables);

      const book = (yield* Shared.PurchaseDb.lockBook(
        transaction,
        command.scope.bookId,
        "share",
      ))[0];

      if (!book) return yield* failure("Forbidden");

      const review = (yield* RefundDb.readPaidReview(
        transaction,
        command.scope.bookId,
        command.reviewId,
      ))[0];

      if (!review) return yield* failure("NotFound");

      const approval = (yield* RefundDb.readPaidApprovals(
        transaction,
        command.scope.bookId,
        command.reviewId,
      ))[0];

      const credit = (yield* CreditDb.readCreditByReview(
        transaction,
        command.scope.bookId,
        command.reviewId,
      ))[0];

      return yield* Shared.decode(Refunds.PaidSupplierCreditView, {
        review: review.body,
        approval: approval?.body ?? null,
        credit: credit?.body ?? null,
        dependenciesCurrent: yield* checkedPaidCredit(
          transaction,
          command.scope,
          command.reviewId,
          Shared.textField(review.body, "digest") ?? "",
        ).pipe(
          Effect.as(true),
          Effect.catch((error) =>
            [
              "StaleDependency",
              "AlreadyPosted",
              "UnsupportedProfile",
              "InvalidJournal",
              "NotFound",
            ].includes(error instanceof Accounting.AccountingError ? error.code : "")
              ? Effect.succeed(false)
              : Effect.fail(error),
          ),
        ),
      });
    }),
  );
});

export const preparePaidSupplierCredit = Effect.fn("purchases.refunds.preparePaid")(function* (
  token: string,
  command: {
    readonly scope: Scope;
    readonly idempotencyKey: string;
    readonly input: typeof Refunds.PreparePaidSupplierCredit.Type;
  },
) {
  return yield* Shared.withBook(token, command.scope, true, "update", (tx, principal) =>
    Effect.gen(function* () {
      const { scope, input, idempotencyKey } = command,
        operation = "prepare_paid_supplier_credit";

      return yield* runBookCommand(
        tx,
        {
          scope: scope,
          idempotencyKey: idempotencyKey,
          operation: operation,
          actorId: principal.actorId,
          input: input,
        },
        Refunds.PaidSupplierCreditReview,
        Effect.gen(function* () {
          const reviewCount =
            (yield* CreditDb.countReviews(tx, scope.bookId, input.invoiceId))[0]?.total ??
            maximumReviews;

          if (reviewCount >= maximumReviews) return yield* failure("InvalidJournal");

          const snapshot = yield* paidCreditSnapshot(tx, scope, input);
          const id = newId("paid_supplier_credit_review");
          const lines = paidJournalLines(snapshot);

          if (lines.length < 2) return yield* failure("InvalidJournal");

          const postingPlan = yield* prepareJournalInTransaction(tx, principal, {
            scope,
            idempotencyKey: newId("paid_supplier_credit_prepare"),
            input: {
              kind: "manual_journal",
              evidenceId: input.creditEvidenceId,
              eventKey: `paid_credit_${id}`,
              accountingPeriodId: input.accountingPeriodId,
              postingDate: input.creditDate,
              series: input.series,
              description: `Paid supplier credit ${input.supplierCreditNumber}`,
              rationale: input.reason,
              taxAssessment: "not_applicable",
              lines: lines.map((line) => ({
                accountId: line.accountId,
                debitMinor: line.debitMinor,
                creditMinor: line.creditMinor,
                description: line.description,
              })),
            },
          });

          const body = {
            id,
            scope,
            profile: input.profile,
            input,
            snapshot,
            postingPlan,
            taxMinor: snapshot.taxMinor,
            createdAt: yield* isoNow(tx),
            receipt: Shared.receipt(idempotencyKey, operation, principal.actorId),
          };

          const result = yield* Shared.decode(Refunds.PaidSupplierCreditReview, {
            ...body,
            digest: yield* digest(body),
          });

          if (Shared.byteLength(JSON.stringify(result)) > maximumReviewBytes)
            return yield* failure("InvalidJournal");
          const action = postingPlan.groups[0]?.actions[0];

          if (!action) return yield* failure("InternalError");
          yield* RefundDb.insertPaidReview(
            tx,
            scope.bookId,
            yield* Shared.toJsonObject(result),
            result.id,
            input.invoiceId,
            postingPlan.id,
            action.eventId,
            input.creditEvidenceId,
          );

          return result;
        }),
      );
    }),
  );
});

export const approvePaidSupplierCreditInTransaction = Effect.fn(
  "purchases.refunds.approvePaidInTransaction",
)(function* (
  tx: import("../../db/transaction").Transaction,
  principal: Shared.Principal,
  command: {
    readonly scope: Scope;
    readonly reviewId: string;
    readonly idempotencyKey: string;
    readonly input: typeof Refunds.ApprovePaidSupplierCredit.Type;
  },
) {
  return yield* Effect.gen(function* () {
    const { scope, reviewId, input, idempotencyKey } = command,
      operation = "approve_paid_supplier_credit";

    return yield* runBookCommand(
      tx,
      {
        scope: scope,
        idempotencyKey: idempotencyKey,
        operation: operation,
        actorId: principal.actorId,
        input: { reviewId, input },
      },
      Refunds.PaidSupplierCreditApproval,
      Effect.gen(function* () {
        const review = yield* checkedPaidCredit(tx, scope, reviewId, input.digest);

        if (
          (yield* RefundDb.readPaidApprovals(tx, scope.bookId, reviewId)).length >= maximumApprovals
        )
          return yield* failure("InvalidJournal");
        const now = yield* isoNow(tx);

        const result = yield* Shared.decode(Refunds.PaidSupplierCreditApproval, {
          id: newId("paid_credit_approval"),
          scope,
          reviewId,
          digest: review.digest,
          actorId: principal.actorId,
          expiresAt: new Date(Date.parse(now) + approvalWindowMs).toISOString(),
          createdAt: now,
          receipt: Shared.receipt(idempotencyKey, operation, principal.actorId),
        });

        yield* RefundDb.insertPaidApproval(
          tx,
          scope.bookId,
          yield* Shared.toJsonObject(result),
          result.id,
          reviewId,
          result.actorId,
          result.digest,
          result.expiresAt,
        );

        return result;
      }),
    );
  });
});

export const approvePaidSupplierCredit = Effect.fn("purchases.refunds.approvePaid")(function* (
  token: string,
  command: Parameters<typeof approvePaidSupplierCreditInTransaction>[2],
) {
  return yield* Shared.withBook(token, command.scope, true, "update", (tx, principal) =>
    approvePaidSupplierCreditInTransaction(tx, principal, command),
  );
});

// The journal line the shared credit row points at: the payable release
// when one exists, otherwise the refund-receivable line. A fully
// refundable credit carries no payable line at all.
function findPaidControlLine(review: typeof Refunds.PaidSupplierCreditReview.Type) {
  const planLines = review.postingPlan.groups[0]?.actions[0]?.lines ?? [];
  const invoice = review.snapshot.invoice;

  return (
    planLines.find(
      (line) =>
        line.accountId === invoice.controlAccountId &&
        line.debitMinor === review.snapshot.paid.apReleaseMinor &&
        line.creditMinor === "0",
    ) ??
    planLines.find(
      (line) =>
        line.accountId === review.snapshot.paid.refundReceivableAccountId &&
        line.debitMinor === review.snapshot.paid.refundPrincipalIncreaseMinor &&
        line.creditMinor === "0",
    ) ??
    null
  );
}

const recordPaidRecognition = Effect.fn("purchases.refunds.recordPaid")(function* (
  tx: import("../../db/transaction").Transaction,
  scope: Scope,
  principal: Shared.Principal,
  review: typeof Refunds.PaidSupplierCreditReview.Type,
  approval: typeof Refunds.PaidSupplierCreditApproval.Type,
  context: {
    readonly postingReceipt: { readonly voucherId: string };
    readonly idempotencyKey: string;
    readonly operation: string;
    readonly reviewId: string;
  },
) {
  const invoice = review.snapshot.invoice;

  const creditRecognitionId =
    invoice.counterpartyId === null
      ? null
      : yield* Recognition.creditRecognitionId(
          Recognition.creditEconomicKey(invoice.counterpartyId, review.input.supplierCreditNumber),
        );

  const owned =
    review.snapshot.recognitionId === undefined ||
    review.snapshot.lineReleases === undefined ||
    review.snapshot.taxAdjustments === undefined ||
    creditRecognitionId === null
      ? null
      : yield* Recognition.recordCreditRecognitionInTransaction(tx, {
          scope,
          bookId: scope.bookId,
          actorId: principal.actorId,
          receipt: Shared.receipt(context.idempotencyKey, context.operation, principal.actorId),
          recognitionId: creditRecognitionId,
          originalRecognitionId: review.snapshot.recognitionId,
          invoiceId: invoice.id,
          supplierCreditNumber: review.input.supplierCreditNumber,
          reviewId: context.reviewId,
          approvalId: approval.id,
          changeSetId: review.postingPlan.id,
          voucherId: context.postingReceipt.voucherId,
          counterpartyId: invoice.counterpartyId,
          creditDate: review.input.creditDate,
          taxPoint: {
            taxPointOn: review.input.creditDate,
            basis: "document_date",
          },
          currency: invoice.currency,
          currencyScale: invoice.currencyScale,
          creditGrossMinor: review.input.amountMinor,
          releasedDeductionMinor: review.snapshot.lineReleases
            .reduce((sum, release) => sum + BigInt(release.releasedDeductionMinor), 0n)
            .toString(),
          lineReleases: review.snapshot.lineReleases,
          taxAdjustments: review.snapshot.taxAdjustments,
          creditEvidence: review.snapshot.creditEvidence,
          witness: review.snapshot.profileWitness ?? null,
          gaps: [],
        });

  if (owned !== null) {
    yield* Recognition.consumeLineCapacities(tx, {
      bookId: scope.bookId,
      recognitionId: review.snapshot.recognitionId ?? "",
      recordedAt: owned.recordedAt,
      releases: review.snapshot.lineReleases ?? [],
    });
  }

  return owned;
});

// Conservation: the live paid position must equal the sealed position-after,
// or a concurrent payment, credit or refund moved it.
const checkPaidConservation = Effect.fn("purchases.refunds.paidConservation")(function* (
  tx: import("../../db/transaction").Transaction,
  scope: Scope,
  review: typeof Refunds.PaidSupplierCreditReview.Type,
) {
  const current = yield* readPosition(tx, scope, review.input.invoiceId);

  const after = {
    originalGrossMinor: current.grossMinor,
    creditedMinor: current.creditedMinor,
    paidMinor: current.paidMinor,
    refundedMinor: current.refundedMinor,
  };

  if (
    after.originalGrossMinor !== review.snapshot.paid.positionAfter.originalGrossMinor ||
    after.creditedMinor !== review.snapshot.paid.positionAfter.creditedMinor ||
    after.paidMinor !== review.snapshot.paid.positionAfter.paidMinor ||
    after.refundedMinor !== review.snapshot.paid.positionAfter.refundedMinor
  )
    return yield* failure("InvalidJournal");
});

export const executePaidSupplierCredit = Effect.fn("purchases.refunds.executePaid")(function* (
  token: string,
  command: {
    readonly scope: Scope;
    readonly reviewId: string;
    readonly idempotencyKey: string;
    readonly input: typeof Refunds.ExecutePaidSupplierCredit.Type;
  },
) {
  return yield* Shared.withBook(token, command.scope, true, "update", (tx, principal) =>
    Effect.gen(function* () {
      const { scope, reviewId, input, idempotencyKey } = command,
        operation = "execute_paid_supplier_credit";

      return yield* runBookCommand(
        tx,
        {
          scope: scope,
          idempotencyKey: idempotencyKey,
          operation: operation,
          actorId: principal.actorId,
          input: { reviewId, input },
        },
        Refunds.PaidSupplierCreditReceipt,
        Effect.gen(function* () {
          const review = yield* checkedPaidCredit(tx, scope, reviewId, input.digest);

          const row = (yield* RefundDb.readPaidApprovals(tx, scope.bookId, reviewId)).find(
            (candidate) => candidate.id === input.approvalId,
          );

          if (!row) return yield* failure("ApprovalRequired");
          const approval = yield* Shared.decode(Refunds.PaidSupplierCreditApproval, row.body);

          if (
            approval.actorId !== principal.actorId ||
            approval.digest !== review.digest ||
            Date.parse(approval.expiresAt) <= Date.parse(yield* isoNow(tx))
          )
            return yield* failure("ApprovalRequired");

          const kernel = yield* approveChangeInTransaction(tx, principal, {
            scope,
            changeSetId: review.postingPlan.id,
            idempotencyKey: newId("paid_credit_approve"),
            input: { version: 1, planDigest: review.postingPlan.planDigest },
          });

          const postingReceipt = yield* executeChangeInTransaction(tx, principal, {
            scope,
            changeSetId: review.postingPlan.id,
            idempotencyKey: newId("paid_credit_post"),
            input: { version: 1, planDigest: review.postingPlan.planDigest, approvalId: kernel.id },
            owner: { kind: "supplier_credit", id: reviewId },
          });

          const invoice = review.snapshot.invoice;

          const controlLine = findPaidControlLine(review);

          if (!controlLine) return yield* failure("InternalError");

          const owned = yield* recordPaidRecognition(tx, scope, principal, review, approval, {
            postingReceipt,
            idempotencyKey,
            operation,
            reviewId,
          });

          const createdAt = yield* isoNow(tx);

          const body = {
            id: newId("paid_supplier_credit"),
            scope,
            reviewId,
            reviewDigest: review.digest,
            approvalId: approval.id,
            invoiceId: review.input.invoiceId,
            supplierCreditNumber: review.input.supplierCreditNumber,
            creditDate: review.input.creditDate,
            amountMinor: review.input.amountMinor,
            taxMinor: review.taxMinor,
            recognitionId: owned?.id ?? null,
            taxFactIds: owned?.taxFactIds ?? [],
            originalAllocatedMinor: review.snapshot.paid.positionBefore.paidMinor,
            outstandingAfterMinor: review.snapshot.paid.unpaidAfterMinor,
            postingReceipt,
            creditEvidence: review.snapshot.creditEvidence,
            status: "credited",
            paid: true,
            apReleaseMinor: review.snapshot.paid.apReleaseMinor,
            refundPrincipalIncreaseMinor: review.snapshot.paid.refundPrincipalIncreaseMinor,
            refundReceivableAccountId: review.snapshot.paid.refundReceivableAccountId,
            unpaidAfterMinor: review.snapshot.paid.unpaidAfterMinor,
            refundPrincipalAfterMinor: review.snapshot.paid.refundPrincipalAfterMinor,
            createdAt,
            receipt: Shared.receipt(idempotencyKey, operation, principal.actorId),
          };

          const result = yield* Shared.decode(Refunds.PaidSupplierCreditReceipt, {
            ...body,
            digest: yield* digest(body),
          });

          yield* CreditDb.insertCredit(
            tx,
            scope.bookId,
            result,
            invoice.counterpartyId,
            controlLine.lineId,
          );

          const increaseBody = {
            id: newId("refund_principal_increase"),
            scope,
            creditId: result.id,
            invoiceId: review.input.invoiceId,
            apReleaseMinor: review.snapshot.paid.apReleaseMinor,
            refundIncreaseMinor: review.snapshot.paid.refundPrincipalIncreaseMinor,
            refundReceivableAccountId: review.snapshot.paid.refundReceivableAccountId,
            creditDate: review.input.creditDate,
            createdAt,
            receipt: Shared.receipt(idempotencyKey, operation, principal.actorId),
          };

          const increaseDigest = yield* digest(increaseBody);

          yield* RefundDb.insertPrincipalIncrease(
            tx,
            scope.bookId,
            increaseBody.id,
            result.id,
            review.input.invoiceId,
            review.snapshot.paid.apReleaseMinor,
            review.snapshot.paid.refundPrincipalIncreaseMinor,
            review.snapshot.paid.refundReceivableAccountId,
            yield* Shared.toJsonObject({ ...increaseBody, digest: increaseDigest }),
            increaseDigest,
            createdAt,
          );

          // Conservation: the live paid position must equal the sealed
          // position-after, or a concurrent payment, credit or refund moved it.
          yield* checkPaidConservation(tx, scope, review);

          return result;
        }),
      );
    }),
  );
});

type RefundPlan = {
  readonly snapshot: Omit<typeof Refunds.SupplierRefundSnapshot.Type, "adoptedRef"> & {
    readonly adoptedRef: string | null;
  };
  readonly journal: ReadonlyArray<JournalLine> | null;
  readonly adoptedRemainingMinor: string | null;
};

// The pure refund plan: no journal is prepared here, so staleness checks can
// recompute it without side effects. A cash receipt carries its two legs; an
// adoption carries the exact remaining capacity it consumes.
// Refund allocations settle the refund due exactly: unique legs, every leg
// positive, legs totalling the receipt within the live due. Anything else
// refuses whole, never posts partially.
const checkRefundAllocations = Effect.fn("purchases.refunds.allocations")(function* (
  input: typeof Refunds.PrepareSupplierRefund.Type,
  refundDueMinor: string,
) {
  const amount = BigInt(input.amountMinor);

  if (amount <= 0n) return yield* failure("InvalidJournal");

  const seen = new Set<string>();
  let allocated = 0n;

  for (const allocation of input.allocations) {
    if (seen.has(allocation.allocationId)) return yield* failure("InvalidJournal");

    seen.add(allocation.allocationId);

    if (BigInt(allocation.amountMinor) <= 0n) return yield* failure("InvalidJournal");

    allocated += BigInt(allocation.amountMinor);
  }

  if (allocated !== amount) return yield* failure("InvalidJournal");

  if (amount > BigInt(refundDueMinor)) return yield* failure("StaleDependency");

  return amount;
});

// An adopted source settles against an already posted compatible
// refund-control credit with exact remaining capacity. No new journal posts.
const validatePostedSource = Effect.fn("purchases.refunds.postedSource")(function* (
  tx: import("../../db/transaction").Transaction,
  scope: Scope,
  source: { readonly voucherId: string; readonly lineId: string },
  refundReceivableAccountId: string,
  amount: bigint,
) {
  const line = (yield* RefundDb.readPostedRefundLine(
    tx,
    scope.bookId,
    source.voucherId,
    source.lineId,
  ))[0];

  if (
    !line ||
    !line.current ||
    line.accountId !== refundReceivableAccountId ||
    line.debitMinor !== "0" ||
    BigInt(line.creditMinor) <= 0n
  )
    return yield* failure("UnsupportedProfile");

  const adopted = (yield* RefundDb.readAdoptedSum(
    tx,
    scope.bookId,
    `${source.voucherId}:${source.lineId}`,
  ))[0];

  const remaining = BigInt(line.creditMinor) - BigInt(adopted?.total ?? "0");

  if (remaining < amount) return yield* failure("StaleDependency");

  return {
    adoptedRef: `${source.voucherId}:${source.lineId}`,
    remainingMinor: remaining.toString(),
  };
});

// An unposted source is evidenced same-currency cash from the supplier on an
// active account that is not a reserved control, tax or VAT account. The
// packet asks for evidenced cash, not an imported bank statement, so a book
// that has never imported one can still settle a refund it posted itself.
const validateCashSource = Effect.fn("purchases.refunds.cashSource")(function* (
  tx: import("../../db/transaction").Transaction,
  scope: Scope,
  source: { readonly bankAccountId: string; readonly evidenceId: string },
  refundReceivableAccountId: string,
) {
  const cash = (yield* RefundDb.readActiveAccount(tx, scope.bookId, source.bankAccountId))[0];

  if (!cash || !cash.active) return yield* failure("StaleDependency");

  if (
    source.bankAccountId === refundReceivableAccountId ||
    (yield* RefundDb.readReservedAccounts(tx, scope.bookId)).some(
      (reserved) => reserved.id === source.bankAccountId,
    )
  )
    return yield* failure("StaleDependency");

  yield* Shared.readEvidenceReference(tx, scope.bookId, source.evidenceId);
});

const refundPlan = Effect.fn("purchases.refunds.plan")(function* (
  tx: import("../../db/transaction").Transaction,
  scope: Scope,
  input: typeof Refunds.PrepareSupplierRefund.Type,
) {
  const book = yield* Shared.readBook(tx, scope.bookId);

  if (book.profile !== "synthetic-core-v1" || book.authority !== "native")
    return yield* failure("UnsupportedProfile");

  const invoice = yield* liveInvoice(tx, scope.bookId, input.invoiceId);

  if (invoice.recognition === null) return yield* failure("UnsupportedProfile");

  if (invoice.direction !== "supplier") return yield* failure("NotFound");

  if (invoice.status === "cancelled") return yield* failure("StaleDependency");

  if (invoice.currency !== book.currency) return yield* failure("UnsupportedProfile");

  if (
    invoice.blockers.length ||
    invoice.allocationVersion !== input.expectedAllocationVersion ||
    invoice.currentRevision.revision !== input.expectedInvoiceRevision
  )
    return yield* failure("StaleDependency");

  const position = yield* readPosition(tx, scope, input.invoiceId);

  const derived = derivePaidPosition({
    originalGrossMinor: position.grossMinor,
    creditedMinor: position.creditedMinor,
    paidMinor: position.paidMinor,
    refundedMinor: position.refundedMinor,
  });

  if (Result.isFailure(derived)) return yield* failure("StaleDependency");

  if (
    derived.success.refundDueMinor !== input.expectedRefundDueMinor ||
    position.refundedMinor !== input.expectedRefundedMinor
  )
    return yield* failure("StaleDependency");

  const amount = yield* checkRefundAllocations(input, derived.success.refundDueMinor);

  if (
    position.refundAccountId === null ||
    position.refundAccountId !== input.refundReceivableAccountId
  )
    return yield* failure("StaleDependency");

  if (!Accounting.isCalendarDate(input.refundDate)) return yield* failure("InvalidJournal");

  if (input.refundDate < invoice.issuedOn) return yield* failure("InvalidJournal");

  const evidence = yield* Shared.readEvidenceReference(tx, scope.bookId, input.refundEvidenceId);

  if (input.source.kind === "posted_credit") {
    const adopted = yield* validatePostedSource(
      tx,
      scope,
      input.source,
      input.refundReceivableAccountId,
      amount,
    );

    return {
      snapshot: {
        invoice,
        refundDueMinor: derived.success.refundDueMinor,
        refundedMinor: position.refundedMinor,
        currency: invoice.currency,
        refundReceivableAccountId: input.refundReceivableAccountId,
        refundEvidence: { evidenceId: evidence.evidenceId, sha256: evidence.sha256 },
        amountMinor: input.amountMinor,
        allocations: [...input.allocations],
        adoptedRef: adopted.adoptedRef,
        refundDate: input.refundDate,
      },
      journal: null,
      adoptedRemainingMinor: adopted.remainingMinor,
    } satisfies RefundPlan;
  }

  if (input.source.kind === "unposted_cash") {
    yield* validateCashSource(tx, scope, input.source, input.refundReceivableAccountId);
  } else {
    return yield* failure("UnsupportedProfile");
  }

  return {
    snapshot: {
      invoice,
      refundDueMinor: derived.success.refundDueMinor,
      refundedMinor: position.refundedMinor,
      currency: invoice.currency,
      refundReceivableAccountId: input.refundReceivableAccountId,
      refundEvidence: { evidenceId: evidence.evidenceId, sha256: evidence.sha256 },
      amountMinor: input.amountMinor,
      allocations: [...input.allocations],
      adoptedRef: null,
      refundDate: input.refundDate,
    },
    journal: [
      {
        accountId: input.source.bankAccountId,
        debitMinor: input.amountMinor,
        creditMinor: "0",
        description: "Supplier refund cash receipt",
      },
      {
        accountId: input.refundReceivableAccountId,
        debitMinor: "0",
        creditMinor: input.amountMinor,
        description: "Settle supplier refund receivable",
      },
    ],
    adoptedRemainingMinor: null,
  } satisfies RefundPlan;
});

export const prepareSupplierRefund = Effect.fn("purchases.refunds.prepareRefund")(function* (
  token: string,
  command: {
    readonly scope: Scope;
    readonly idempotencyKey: string;
    readonly input: typeof Refunds.PrepareSupplierRefund.Type;
  },
) {
  return yield* Shared.withBook(token, command.scope, true, "update", (tx, principal) =>
    Effect.gen(function* () {
      const { scope, input, idempotencyKey } = command,
        operation = "prepare_supplier_refund";

      return yield* runBookCommand(
        tx,
        {
          scope: scope,
          idempotencyKey: idempotencyKey,
          operation: operation,
          actorId: principal.actorId,
          input: input,
        },
        Refunds.SupplierRefundReview,
        Effect.gen(function* () {
          const reviewCount =
            (yield* RefundDb.readRefundReviewCount(tx, scope.bookId, input.invoiceId))[0]?.total ??
            maximumReviews;

          if (reviewCount >= maximumReviews) return yield* failure("InvalidJournal");

          const plan = yield* refundPlan(tx, scope, input);
          const id = newId("supplier_refund_review");

          const postingPlan =
            plan.journal === null
              ? null
              : yield* prepareJournalInTransaction(tx, principal, {
                  scope,
                  idempotencyKey: newId("supplier_refund_prepare"),
                  input: {
                    kind: "manual_journal",
                    evidenceId: input.refundEvidenceId,
                    eventKey: `supplier_refund_${id}`,
                    accountingPeriodId: input.accountingPeriodId,
                    postingDate: input.refundDate,
                    series: input.series,
                    description: `Supplier refund ${input.amountMinor}`,
                    rationale: input.reason,
                    taxAssessment: "not_applicable",
                    lines: plan.journal.map((line) => ({
                      accountId: line.accountId,
                      debitMinor: line.debitMinor,
                      creditMinor: line.creditMinor,
                      description: line.description,
                    })),
                  },
                });

          const body = {
            id,
            scope,
            input,
            snapshot: plan.snapshot,
            postingPlan,
            createdAt: yield* isoNow(tx),
            receipt: Shared.receipt(idempotencyKey, operation, principal.actorId),
          };

          const result = yield* Shared.decode(Refunds.SupplierRefundReview, {
            ...body,
            digest: yield* digest(body),
          });

          if (Shared.byteLength(JSON.stringify(result)) > maximumReviewBytes)
            return yield* failure("InvalidJournal");

          const action = postingPlan?.groups[0]?.actions[0];

          if (postingPlan !== null && !action) return yield* failure("InternalError");

          yield* RefundDb.insertRefundReview(
            tx,
            scope.bookId,
            yield* Shared.toJsonObject(result),
            result.id,
            input.invoiceId,
            postingPlan?.id ?? null,
            action?.eventId ?? null,
            input.refundEvidenceId,
          );

          return result;
        }),
      );
    }),
  );
});

export const approveSupplierRefundInTransaction = Effect.fn(
  "purchases.refunds.approveRefundInTransaction",
)(function* (
  tx: import("../../db/transaction").Transaction,
  principal: Shared.Principal,
  command: {
    readonly scope: Scope;
    readonly reviewId: string;
    readonly idempotencyKey: string;
    readonly input: typeof Refunds.ApproveSupplierRefund.Type;
  },
) {
  return yield* Effect.gen(function* () {
    const { scope, reviewId, input, idempotencyKey } = command,
      operation = "approve_supplier_refund";

    return yield* runBookCommand(
      tx,
      {
        scope: scope,
        idempotencyKey: idempotencyKey,
        operation: operation,
        actorId: principal.actorId,
        input: { reviewId, input },
      },
      Refunds.SupplierRefundApproval,
      Effect.gen(function* () {
        const review = yield* checkedRefund(tx, scope, reviewId, input.digest);

        if (
          (yield* RefundDb.readRefundApprovals(tx, scope.bookId, reviewId)).length >=
          maximumApprovals
        )
          return yield* failure("InvalidJournal");
        const now = yield* isoNow(tx);

        const result = yield* Shared.decode(Refunds.SupplierRefundApproval, {
          id: newId("supplier_refund_approval"),
          scope,
          reviewId,
          digest: review.digest,
          actorId: principal.actorId,
          expiresAt: new Date(Date.parse(now) + approvalWindowMs).toISOString(),
          createdAt: now,
          receipt: Shared.receipt(idempotencyKey, operation, principal.actorId),
        });

        yield* RefundDb.insertRefundApproval(
          tx,
          scope.bookId,
          yield* Shared.toJsonObject(result),
          result.id,
          reviewId,
          result.actorId,
          result.digest,
          result.expiresAt,
        );

        return result;
      }),
    );
  });
});

export const approveSupplierRefund = Effect.fn("purchases.refunds.approveRefund")(function* (
  token: string,
  command: Parameters<typeof approveSupplierRefundInTransaction>[2],
) {
  return yield* Shared.withBook(token, command.scope, true, "update", (tx, principal) =>
    approveSupplierRefundInTransaction(tx, principal, command),
  );
});

export const checkedRefund = Effect.fn("purchases.refunds.checked")(function* (
  tx: import("../../db/transaction").Transaction,
  scope: Scope,
  id: string,
  expected: string,
) {
  const row = (yield* RefundDb.readRefundReview(tx, scope.bookId, id))[0];

  if (!row) return yield* failure("NotFound");
  const review = yield* Shared.decode(Refunds.SupplierRefundReview, row.body);
  const body = Object.fromEntries(Object.entries(review).filter(([name]) => name !== "digest"));
  const saved = review.digest;

  if (
    saved !== expected ||
    (yield* digest(body)) !== saved ||
    (yield* RefundDb.readRefundByReview(tx, scope.bookId, id)).length
  )
    return yield* failure("StaleDependency");
  const plan = yield* refundPlan(tx, scope, review.input);

  if ((yield* digest(plan.snapshot)) !== (yield* digest(review.snapshot)))
    return yield* failure("StaleDependency");

  if (review.postingPlan !== null) {
    if (plan.journal === null) return yield* failure("StaleDependency");
    yield* validatePlan(tx, scope, review.postingPlan);
  } else if (plan.journal !== null) {
    return yield* failure("StaleDependency");
  }

  return review;
});

export const executeSupplierRefund = Effect.fn("purchases.refunds.executeRefund")(function* (
  token: string,
  command: {
    readonly scope: Scope;
    readonly reviewId: string;
    readonly idempotencyKey: string;
    readonly input: typeof Refunds.ExecuteSupplierRefund.Type;
  },
) {
  return yield* Shared.withBook(token, command.scope, true, "update", (tx, principal) =>
    Effect.gen(function* () {
      const { scope, reviewId, input, idempotencyKey } = command,
        operation = "execute_supplier_refund";

      return yield* runBookCommand(
        tx,
        {
          scope: scope,
          idempotencyKey: idempotencyKey,
          operation: operation,
          actorId: principal.actorId,
          input: { reviewId, input },
        },
        Refunds.SupplierRefundReceipt,
        Effect.gen(function* () {
          const review = yield* checkedRefund(tx, scope, reviewId, input.digest);

          const row = (yield* RefundDb.readRefundApprovals(tx, scope.bookId, reviewId)).find(
            (candidate) => candidate.id === input.approvalId,
          );

          if (!row) return yield* failure("ApprovalRequired");
          const approval = yield* Shared.decode(Refunds.SupplierRefundApproval, row.body);

          if (
            approval.actorId !== principal.actorId ||
            approval.digest !== review.digest ||
            Date.parse(approval.expiresAt) <= Date.parse(yield* isoNow(tx))
          )
            return yield* failure("ApprovalRequired");

          // A refund receipt posts no expense reversal and no additional VAT
          // credit: cash against the refund receivable, or nothing when the
          // receipt adopts an already posted refund-control credit.
          const plan = review.postingPlan;

          const postingReceipt =
            plan === null
              ? null
              : yield* Effect.gen(function* () {
                  const kernel = yield* approveChangeInTransaction(tx, principal, {
                    scope,
                    changeSetId: plan.id,
                    idempotencyKey: newId("supplier_refund_approve"),
                    input: { version: 1, planDigest: plan.planDigest },
                  });

                  return yield* executeChangeInTransaction(tx, principal, {
                    scope,
                    changeSetId: plan.id,
                    idempotencyKey: newId("supplier_refund_post"),
                    input: {
                      version: 1,
                      planDigest: plan.planDigest,
                      approvalId: kernel.id,
                    },
                    owner: { kind: "supplier_refund", id: reviewId },
                  });
                });

          const createdAt = yield* isoNow(tx);

          const body = {
            id: newId("supplier_refund"),
            scope,
            reviewId,
            reviewDigest: review.digest,
            approvalId: approval.id,
            invoiceId: review.input.invoiceId,
            refundDate: review.input.refundDate,
            amountMinor: review.input.amountMinor,
            sourceKind: review.input.source.kind,
            voucherId: postingReceipt?.voucherId ?? null,
            adoptedRef: review.snapshot.adoptedRef,
            postingReceipt,
            refundEvidence: review.snapshot.refundEvidence,
            createdAt,
            receipt: Shared.receipt(idempotencyKey, operation, principal.actorId),
          };

          const result = yield* Shared.decode(Refunds.SupplierRefundReceipt, {
            ...body,
            digest: yield* digest(body),
          });

          yield* RefundDb.insertRefund(
            tx,
            scope.bookId,
            yield* Shared.toJsonObject(result),
            result.id,
            reviewId,
            approval.id,
            review.input.invoiceId,
            review.input.amountMinor,
            review.input.refundDate,
            postingReceipt?.voucherId ?? null,
            review.snapshot.adoptedRef,
            review.input.source.kind,
            review.input.refundEvidenceId,
            result.digest,
            result.createdAt,
          );

          let ordinal = 0;

          for (const allocation of review.input.allocations) {
            ordinal += 1;
            yield* RefundDb.insertRefundAllocation(
              tx,
              scope.bookId,
              result.id,
              ordinal,
              allocation.allocationId,
              allocation.amountMinor,
            );
          }

          yield* RefundDb.insertSourceUsage(
            tx,
            scope.bookId,
            result.id,
            review.input.source.kind,
            review.input.source.kind === "unposted_cash" ? review.input.source.bankAccountId : null,
            review.input.source.kind === "unposted_cash" ? review.input.source.evidenceId : null,
            review.snapshot.adoptedRef,
            review.input.amountMinor,
          );

          return result;
        }),
      );
    }),
  );
});

export const getSupplierRefundReview = Effect.fn("purchases.refunds.getRefundReview")(function* (
  token: string,
  command: { readonly scope: Scope; readonly reviewId: string },
) {
  return yield* Shared.withBook(token, command.scope, false, "share", (transaction) =>
    Effect.gen(function* () {
      yield* Shared.requireTables(transaction, RefundDb.refundTables);

      const book = (yield* Shared.PurchaseDb.lockBook(
        transaction,
        command.scope.bookId,
        "share",
      ))[0];

      if (!book) return yield* failure("Forbidden");

      const review = (yield* RefundDb.readRefundReview(
        transaction,
        command.scope.bookId,
        command.reviewId,
      ))[0];

      if (!review) return yield* failure("NotFound");

      const approval = (yield* RefundDb.readRefundApprovals(
        transaction,
        command.scope.bookId,
        command.reviewId,
      ))[0];

      const refund = (yield* RefundDb.readRefundByReview(
        transaction,
        command.scope.bookId,
        command.reviewId,
      ))[0];

      return yield* Shared.decode(Refunds.SupplierRefundView, {
        review: review.body,
        approval: approval?.body ?? null,
        refund: refund?.body ?? null,
        dependenciesCurrent: yield* checkedRefund(
          transaction,
          command.scope,
          command.reviewId,
          Shared.textField(review.body, "digest") ?? "",
        ).pipe(
          Effect.as(true),
          Effect.catch((error) =>
            [
              "StaleDependency",
              "AlreadyPosted",
              "UnsupportedProfile",
              "InvalidJournal",
              "NotFound",
            ].includes(error instanceof Accounting.AccountingError ? error.code : "")
              ? Effect.succeed(false)
              : Effect.fail(error),
          ),
        ),
      });
    }),
  );
});

export type { Json as RefundJson };
