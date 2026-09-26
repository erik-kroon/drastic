import * as Accounting from "@open-erp/contracts/accounting";
import * as Credits from "@open-erp/contracts/supplier-credits";
import * as Effect from "effect/Effect";
import type * as Schema from "effect/Schema";
import { failure } from "../failures";
import * as CreditDb from "../../db/purchases/credits";
import { creditSnapshot, checkedCredit } from "./credit-basis";
import { liveInvoice } from "../commerce/register";
import {
  digest,
  isoNow,
  newId,
  replay,
  saveCommand,
  prepareJournalInTransaction,
  approveChangeInTransaction,
  executeChangeInTransaction,
} from "../posting";
import * as Shared from "./shared";
import * as Recognition from "./recognition";

type Scope = typeof Accounting.Scope.Type;

type Json = Schema.Json;

const ViewSchema = Credits.SupplierCreditView;

type CreditSnapshot = typeof Credits.SupplierCreditSnapshot.Type;

type JournalLine = {
  readonly accountId: string;
  readonly debitMinor: string;
  readonly creditMinor: string;
  readonly description: string;
};

// A synthetic credit is one explicit expense reversal. A purchase credit posts
// the exact line releases its compiler produced.
function creditJournalLines(snapshot: CreditSnapshot) {
  if (snapshot.expenseAccountId) {
    return [
      {
        accountId: snapshot.invoice.controlAccountId,
        debitMinor: snapshot.amountMinor,
        creditMinor: "0",
        description: "Reduce supplier payable",
      },
      {
        accountId: snapshot.expenseAccountId,
        debitMinor: "0",
        creditMinor: snapshot.amountMinor,
        description: "Supplier credit expense",
      },
    ] satisfies ReadonlyArray<JournalLine>;
  }

  const payableDebit: JournalLine = {
    accountId: snapshot.invoice.controlAccountId,
    debitMinor: snapshot.amountMinor,
    creditMinor: "0",
    description: "Reduce supplier payable",
  };

  return [
    payableDebit,
    ...(snapshot.lineReleases ?? []).flatMap((release) => {
      const lines: Array<JournalLine> = [
        {
          accountId: release.expenseAccountId,
          debitMinor: "0",
          creditMinor: release.expenseMinor,
          description: `Supplier credit ${release.sourceLineId}`,
        },
      ];

      if (BigInt(release.releasedDeductionMinor) > 0n && release.inputVatAccountId !== null) {
        lines.push({
          accountId: release.inputVatAccountId,
          debitMinor: "0",
          creditMinor: release.releasedDeductionMinor,
          description: `Input VAT credit ${release.sourceLineId}`,
        });
      }

      return lines;
    }),
  ];
}

const HistorySchema = Credits.SupplierCreditHistory;

const creditTables = [
  "books",
  "accounts",
  "periods",
  "evidence",
  "events",
  "vouchers",
  "journal_lines",
  "change_sets",
  "execution_receipts",
  "command_receipts",
  "commerce_invoices",
  "commerce_active_allocation_legs",
  "supplier_acceptances",
  "supplier_acceptance_reviews",
  "supplier_credit_reviews",
  "supplier_credit_approvals",
  "supplier_credits",
  "supplier_payment_batch_items",
  "purchase_recognitions",
  "purchase_tax_facts",
  "purchase_line_capacities",
];

const maximumHistory = 50;

export const getSupplierCreditReview = Effect.fn("purchases.credits.get")(function* (
  token: string,
  command: { readonly scope: Scope; readonly reviewId: string },
) {
  return yield* Shared.withBook(token, command.scope, false, "share", (transaction) =>
    Effect.gen(function* () {
      yield* Shared.requireTables(transaction, creditTables);

      const book = (yield* Shared.PurchaseDb.lockBook(
        transaction,
        command.scope.bookId,
        "share",
      ))[0];

      if (!book) return yield* failure("Forbidden");

      const review = (yield* CreditDb.readCreditReview(
        transaction,
        command.scope.bookId,
        command.reviewId,
      ))[0];

      if (!review) return yield* failure("NotFound");

      const approval = (yield* CreditDb.readLatestCreditApproval(
        transaction,
        command.scope.bookId,
        command.reviewId,
      ))[0];

      const credit = (yield* CreditDb.readCreditByReview(
        transaction,
        command.scope.bookId,
        command.reviewId,
      ))[0];

      return yield* Shared.decode(ViewSchema, {
        review: review.body,
        approval: approval?.body ?? null,
        credit: credit?.body ?? null,
        dependenciesCurrent: yield* checkedCredit(
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

export const supplierCreditHistory = Effect.fn("purchases.credits.history")(function* (
  token: string,
  command: { readonly scope: Scope; readonly invoiceId: string },
) {
  return yield* Shared.withBook(token, command.scope, false, "share", (transaction) =>
    Effect.gen(function* () {
      yield* Shared.requireTables(transaction, creditTables);

      const book = (yield* Shared.PurchaseDb.lockBook(
        transaction,
        command.scope.bookId,
        "share",
      ))[0];

      if (!book) return yield* failure("Forbidden");

      if (
        (yield* CreditDb.readSupplierInvoiceExists(
          transaction,
          command.scope.bookId,
          command.invoiceId,
        ))[0]?.present !== true
      ) {
        return yield* failure("NotFound");
      }

      const rows = yield* CreditDb.listCredits(
        transaction,
        command.scope.bookId,
        command.invoiceId,
      );

      if (rows.length > maximumHistory) return yield* failure("InvalidJournal");

      return yield* Shared.decode(HistorySchema, {
        scope: command.scope,
        invoiceId: command.invoiceId,
        count: rows.length,
        items: rows.map((row) => row.body),
      });
    }),
  );
});

export const prepareSupplierCredit = Effect.fn("purchases.credits.prepare")(function* (
  token: string,
  command: {
    readonly scope: Scope;
    readonly idempotencyKey: string;
    readonly input: typeof Credits.PrepareSupplierCredit.Type;
  },
) {
  return yield* Shared.withBook(token, command.scope, true, "update", (tx, principal) =>
    Effect.gen(function* () {
      const { scope, input, idempotencyKey } = command,
        operation = "prepare_supplier_credit";

      const request = yield* replay(
        tx,
        scope,
        idempotencyKey,
        operation,
        principal.actorId,
        input,
        Credits.SupplierCreditReview,
      );

      if (request.previous) return request.previous;

      if (((yield* CreditDb.countReviews(tx, scope.bookId, input.invoiceId))[0]?.total ?? 50) >= 50)
        return yield* failure("InvalidJournal");
      const snapshot = yield* creditSnapshot(tx, scope, input);
      const id = newId("supplier_credit_review");
      const lines = creditJournalLines(snapshot);

      if (lines.length < 2) return yield* failure("InvalidJournal");

      const postingPlan = yield* prepareJournalInTransaction(tx, principal, {
        scope,
        idempotencyKey: newId("supplier_credit_prepare"),
        input: {
          kind: "manual_journal",
          evidenceId: input.creditEvidenceId,
          eventKey: `credit_${id}`,
          accountingPeriodId: input.accountingPeriodId,
          postingDate: input.creditDate,
          series: input.series,
          description: `Supplier credit ${input.supplierCreditNumber}`,
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

      const result = yield* Shared.decode(Credits.SupplierCreditReview, {
        ...body,
        digest: yield* digest(body),
      });

      if (Shared.byteLength(JSON.stringify(result)) > 262144)
        return yield* failure("InvalidJournal");
      const action = postingPlan.groups[0]?.actions[0];

      if (!action) return yield* failure("InternalError");
      yield* CreditDb.insertReview(tx, scope.bookId, result, action.eventId);
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
    }),
  );
});

export const approveSupplierCredit = Effect.fn("purchases.credits.approve")(function* (
  token: string,
  command: {
    readonly scope: Scope;
    readonly reviewId: string;
    readonly idempotencyKey: string;
    readonly input: typeof Credits.ApproveSupplierCredit.Type;
  },
) {
  return yield* Shared.withBook(token, command.scope, true, "update", (tx, principal) =>
    Effect.gen(function* () {
      const { scope, reviewId, input, idempotencyKey } = command,
        operation = "approve_supplier_credit";

      const request = yield* replay(
        tx,
        scope,
        idempotencyKey,
        operation,
        principal.actorId,
        { reviewId, input },
        Credits.SupplierCreditApproval,
      );

      if (request.previous) return request.previous;
      const review = yield* checkedCredit(tx, scope, reviewId, input.digest);

      if ((yield* CreditDb.readApprovals(tx, scope.bookId, reviewId)).length >= 50)
        return yield* failure("InvalidJournal");
      const now = yield* isoNow(tx);

      const result = yield* Shared.decode(Credits.SupplierCreditApproval, {
        id: newId("credit_approval"),
        scope,
        reviewId,
        digest: review.digest,
        actorId: principal.actorId,
        expiresAt: new Date(Date.parse(now) + 3600000).toISOString(),
        createdAt: now,
        receipt: Shared.receipt(idempotencyKey, operation, principal.actorId),
      });

      yield* CreditDb.insertApproval(tx, scope.bookId, result);
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
    }),
  );
});

export const executeSupplierCredit = Effect.fn("purchases.credits.execute")(function* (
  token: string,
  command: {
    readonly scope: Scope;
    readonly reviewId: string;
    readonly idempotencyKey: string;
    readonly input: typeof Credits.ExecuteSupplierCredit.Type;
  },
) {
  return yield* Shared.withBook(token, command.scope, true, "update", (tx, principal) =>
    Effect.gen(function* () {
      const { scope, reviewId, input, idempotencyKey } = command,
        operation = "execute_supplier_credit";

      const request = yield* replay(
        tx,
        scope,
        idempotencyKey,
        operation,
        principal.actorId,
        { reviewId, input },
        Credits.SupplierCreditReceipt,
      );

      if (request.previous) return request.previous;
      const review = yield* checkedCredit(tx, scope, reviewId, input.digest);

      const row = (yield* CreditDb.readApprovals(tx, scope.bookId, reviewId)).find(
        (row) => row.id === input.approvalId,
      );

      if (!row) return yield* failure("ApprovalRequired");
      const approval = yield* Shared.decode(Credits.SupplierCreditApproval, row.body);

      if (
        approval.actorId !== principal.actorId ||
        approval.digest !== review.digest ||
        Date.parse(approval.expiresAt) <= Date.parse(yield* isoNow(tx))
      )
        return yield* failure("ApprovalRequired");

      const kernel = yield* approveChangeInTransaction(tx, principal, {
        scope,
        changeSetId: review.postingPlan.id,
        idempotencyKey: newId("credit_approve"),
        input: { version: 1, planDigest: review.postingPlan.planDigest },
      });

      const postingReceipt = yield* executeChangeInTransaction(tx, principal, {
        scope,
        changeSetId: review.postingPlan.id,
        idempotencyKey: newId("credit_post"),
        input: { version: 1, planDigest: review.postingPlan.planDigest, approvalId: kernel.id },
        owner: { kind: "supplier_credit", id: reviewId },
      });

      const invoice = review.snapshot.invoice;

      if (invoice.outstandingMinor === null) return yield* failure("StaleDependency");

      const owned =
        review.snapshot.recognitionId === undefined ||
        review.snapshot.lineReleases === undefined ||
        review.snapshot.taxAdjustments === undefined ||
        invoice.counterpartyId === null
          ? null
          : yield* Recognition.recordCreditRecognitionInTransaction(tx, {
              scope,
              bookId: scope.bookId,
              actorId: principal.actorId,
              receipt: Shared.receipt(idempotencyKey, operation, principal.actorId),
              recognitionId: review.snapshot.recognitionId,
              originalRecognitionId: review.snapshot.recognitionId,
              invoiceId: invoice.id,
              supplierCreditNumber: review.input.supplierCreditNumber,
              reviewId,
              approvalId: approval.id,
              changeSetId: review.postingPlan.id,
              voucherId: postingReceipt.voucherId,
              counterpartyId: invoice.counterpartyId,
              creditDate: review.input.creditDate,
              taxPoint: {
                taxPointOn: review.input.creditDate,
                basis: "document_date",
              },
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

      const body = {
        id: newId("supplier_credit"),
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
        originalAllocatedMinor: invoice.recordedAllocatedMinor,
        outstandingAfterMinor: (
          BigInt(invoice.outstandingMinor) - BigInt(review.input.amountMinor)
        ).toString(),
        postingReceipt,
        creditEvidence: review.snapshot.creditEvidence,
        status: "credited",
        paid: false,
        createdAt: yield* isoNow(tx),
        receipt: Shared.receipt(idempotencyKey, operation, principal.actorId),
      };

      const result = yield* Shared.decode(Credits.SupplierCreditReceipt, {
        ...body,
        digest: yield* digest(body),
      });

      const line = review.postingPlan.groups[0]?.actions[0]?.lines[0];

      if (!line) return yield* failure("InternalError");
      yield* CreditDb.insertCredit(tx, scope.bookId, result, invoice.counterpartyId, line.lineId);

      if (
        (yield* liveInvoice(tx, scope.bookId, invoice.id)).outstandingMinor !==
        result.outstandingAfterMinor
      )
        return yield* failure("InvalidJournal");
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
    }),
  );
});

export type { Json as CreditJson };
