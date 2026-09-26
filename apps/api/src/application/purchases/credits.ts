import * as Accounting from "@open-erp/contracts/accounting";
import * as Credits from "@open-erp/contracts/supplier-credits";
import * as Effect from "effect/Effect";
import type * as Schema from "effect/Schema";
import { failure } from "../failures";
import * as CreditDb from "../../db/purchases/credits";
import * as Shared from "./shared";

type Scope = typeof Accounting.Scope.Type;
type Json = Schema.Json;

const ViewSchema = Credits.SupplierCreditView;
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
        review,
        approval: approval?.body ?? null,
        credit: credit?.body ?? null,
        dependenciesCurrent: false,
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
  return yield* Shared.withBook(token, command.scope, true, "update", (transaction) =>
    Effect.gen(function* () {
      yield* Shared.requireTables(transaction, creditTables, [
        "supplier_credit_reviews",
        "change_sets",
        "events",
        "command_receipts",
      ]);
      yield* Shared.readBook(transaction, command.scope.bookId);
      void command;
      return yield* Shared.unsupported();
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
  return yield* Shared.withBook(token, command.scope, true, "update", (transaction) =>
    Effect.gen(function* () {
      yield* Shared.requireTables(transaction, creditTables, [
        "supplier_credit_approvals",
        "command_receipts",
      ]);
      yield* Shared.readBook(transaction, command.scope.bookId);
      void command;
      return yield* Shared.unsupported();
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
  return yield* Shared.withBook(token, command.scope, true, "update", (transaction) =>
    Effect.gen(function* () {
      yield* Shared.requireTables(transaction, creditTables, [
        "supplier_credits",
        "supplier_credit_approvals",
        "vouchers",
        "journal_lines",
        "command_receipts",
      ]);
      yield* Shared.readBook(transaction, command.scope.bookId);
      void command;
      return yield* Shared.unsupported();
    }),
  );
});

export type { Json as CreditJson };
