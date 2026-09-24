import { createFileRoute } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import { FinanceArea } from "@/components/finance-area";
import { BankAccountWorkspace } from "@/components/bank-account-workspace";
import { AccountingDate, Identifier } from "@open-erp/contracts/accounting";
export const Route = createFileRoute("/entities/$entityId/books/$bookId/accounts")({
  validateSearch: Schema.decodeUnknownSync(
    Schema.Struct({
      view: Schema.optional(Schema.String),
      record: Schema.optional(Schema.String),
      account: Schema.optional(Identifier),
      from: Schema.optional(AccountingDate),
      to: Schema.optional(AccountingDate),
      tab: Schema.optional(Schema.Literals(["unmatched", "all", "matched", "ledger"])),
      q: Schema.optional(Schema.String.check(Schema.isMaxLength(200))),
      page: Schema.optional(Schema.Union([Schema.String, Schema.Int])),
      statement: Schema.optional(Identifier),
      row: Schema.optional(Schema.Union([Schema.String, Schema.Int])),
      plan: Schema.optional(Identifier),
      undo: Schema.optional(Identifier),
      report: Schema.optional(Identifier),
    }),
  ),
  component: Page,
});
function Page() {
  const search = Route.useSearch();
  if (!search.view || search.view === "imports")
    return (
      <BankAccountWorkspace
        search={{
          ...search,
          page: search.page === undefined ? undefined : String(search.page),
          row: search.row === undefined ? undefined : String(search.row),
        }}
      />
    );
  return <FinanceArea area="accounts" view={search.view} record={search.record} />;
}
