import type * as Accounting from "@open-erp/contracts/accounting";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type { Transaction } from "../db/transaction";
import type { BasisDependencies, CaptureProviderRows } from "../db/accountant-review";
import * as OwnerDb from "../db/owner-register/register";
import * as ExpenseDb from "../db/vat/expense-tax";
import * as Dependencies from "./closing/dependencies";
import { controlBody } from "./subledger/owners";
import { assessSource } from "./vat/expense-tax";
import { failure } from "./failures";

type Scope = typeof Accounting.Scope.Type;

export const readBasisDependencies = Effect.fn("accountantReview.dependencies")(function* (
  transaction: Transaction,
  scope: Scope,
  startsOn: string,
  endsOn: string,
) {
  return {
    owners: yield* Dependencies.ownerPeriodStatus(transaction, scope.bookId, startsOn, endsOn),
    expenseTax: yield* Dependencies.expenseTaxDependencies(transaction, scope.bookId),
    vatReturns: yield* Dependencies.vatReturnDependencies(transaction, scope.bookId),
    subledgerControls: yield* Dependencies.subledgerControlDependencies(transaction, scope.bookId),
    bank: yield* Dependencies.bankCloseDependencies(transaction, scope.bookId, startsOn, endsOn),
    commerce: yield* Dependencies.commercePeriodStatus(transaction, scope.bookId, startsOn, endsOn),
    schedules: yield* Dependencies.subledgerCloseDependencies(transaction, scope.bookId, endsOn),
  } satisfies BasisDependencies;
});

function object(value: Schema.Json | undefined) {
  return Schema.decodeUnknownEffect(Schema.JsonObject)(value).pipe(
    Effect.mapError(() => failure("InternalError")),
  );
}

export const readCaptureProviders = Effect.fn("accountantReview.captureProviders")(function* (
  transaction: Transaction,
  scope: Scope,
  startsOn: string,
  endsOn: string,
) {
  const owners = yield* OwnerDb.listOwners(transaction, scope.bookId, "", 101);
  const expenses = yield* ExpenseDb.readCurrentInventory(transaction, scope.bookId);

  if (owners.length > 100 || expenses.length > 200) return yield* failure("UnsupportedProfile");

  const ownerControls = yield* Effect.forEach(owners, (owner) =>
    controlBody(transaction, scope, owner.id, startsOn, endsOn).pipe(
      Effect.map((body) => ({ ...body, section: "owner_controls" })),
    ),
  );

  const expenseTax = yield* Effect.forEach(expenses, (row) =>
    Effect.gen(function* () {
      const source = yield* object(row.item.current);
      const review = row.item.latestReview === null ? null : yield* object(row.item.latestReview);

      const assessment = yield* assessSource(transaction, scope, source, review, {
        mode: "actual_review",
        startsOn,
        endsOn,
      });

      return {
        section: "expense_tax",
        assessmentMode: "actual_review",
        source,
        review,
        assessment,
      };
    }),
  );

  return { ownerControls, expenseTax } satisfies CaptureProviderRows;
});
