import * as Accounting from "@open-erp/contracts/accounting";
import * as Workspace from "@open-erp/contracts/bank-workspace";
import * as Effect from "effect/Effect";
import type * as Schema from "effect/Schema";
import { failure } from "../failures";
import * as WorkspaceDb from "../../db/banking/workspace";
import * as BankDb from "../../db/banking/shared";
import * as Shared from "./shared";

type Scope = typeof Accounting.Scope.Type;
type JsonObject = Schema.JsonObject;

const WorkspaceSchema = Workspace.BankWorkspace;

const workspaceTables = [
  "books",
  "accounts",
  "bank_sources",
  "bank_statements",
  "bank_observations",
  "bank_matches",
  "bank_active_matches",
  "bank_active_allocation_legs",
  "bank_allocation_plans",
  "bank_allocation_executions",
  "vouchers",
  "journal_lines",
];

const views = ["unmatched", "all", "matched", "ledger"] as const;

export const bankWorkspace = Effect.fn("banking.workspace")(function* (
  token: string,
  command: { readonly scope: Scope; readonly input: typeof Workspace.BankWorkspaceQuery.Type },
) {
  return yield* Shared.withBook(token, command.scope, false, "share", (transaction) =>
    Effect.gen(function* () {
      yield* Shared.requireTables(transaction, workspaceTables);
      const book = (yield* BankDb.lockBook(transaction, command.scope.bookId, "share"))[0];
      if (!book) return yield* failure("Forbidden");

      const { startsOn, endsOn } = command.input;
      if (startsOn > endsOn) return yield* failure("InvalidJournal");
      const view = command.input.view ?? "unmatched";
      if (!views.includes(view)) return yield* failure("InvalidJournal");
      const search = (command.input.q ?? "").toLowerCase();
      if (search.length > 200) return yield* failure("InvalidJournal");
      const page = Number.parseInt(command.input.page ?? "1", 10);
      if (!Number.isSafeInteger(page) || page < 1 || page > 999999) {
        return yield* failure("InvalidJournal");
      }

      const accountId = command.input.accountId;
      if (
        accountId !== undefined &&
        (yield* WorkspaceDb.readBankSourceExists(transaction, command.scope.bookId, accountId))[0]
          ?.present !== true
      ) {
        return yield* failure("NotFound");
      }

      const accounts = (yield* WorkspaceDb.readWorkspaceAccounts(
        transaction,
        command.scope.bookId,
        book.committedSequence,
        startsOn,
        endsOn,
      ))[0];
      const activity =
        accountId === undefined
          ? { total: 0, counts: { all: 0, unmatched: 0, matched: 0, ledger: 0 }, rows: [] }
          : (yield* WorkspaceDb.readWorkspaceActivity(
              transaction,
              command.scope.bookId,
              book.committedSequence,
              accountId,
              startsOn,
              endsOn,
              view,
              search,
              page,
            ))[0];
      const reviews =
        accountId === undefined
          ? []
          : ((yield* WorkspaceDb.readWorkspaceReviews(
              transaction,
              command.scope.bookId,
              accountId,
              startsOn,
              endsOn,
            ))[0]?.reviews ?? []);
      const checkedAt = (yield* WorkspaceDb.readDatabaseTime(transaction))[0]?.now;

      if (checkedAt === undefined) return yield* failure("InternalError");
      return yield* Shared.decode(WorkspaceSchema, {
        scope: command.scope,
        currency: book.currency,
        currencyScale: book.currencyScale,
        startsOn,
        endsOn,
        checkedAt,
        accounts: Array.isArray(accounts?.accounts) ? accounts.accounts : [],
        total: activity?.total ?? 0,
        page,
        pageSize: 50,
        counts: activity?.counts ?? { all: 0, unmatched: 0, matched: 0, ledger: 0 },
        rows: Array.isArray(activity?.rows) ? activity.rows : [],
        reviews: Array.isArray(reviews) ? reviews : [],
      } satisfies JsonObject);
    }),
  );
});
