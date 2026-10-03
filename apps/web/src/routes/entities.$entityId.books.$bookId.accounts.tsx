import { createFileRoute } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import { FinanceArea } from "@/components/finance-area";
import { BankAccountWorkspace } from "@/components/bank-account-workspace";
import { BankOwnerQuery, OwnerReturnSearch } from "@/lib/work-return";

export const Route = createFileRoute("/entities/$entityId/books/$bookId/accounts")({
  validateSearch: Schema.decodeUnknownSync(
    Schema.Struct({
      ...BankOwnerQuery.fields,
      returnTo: OwnerReturnSearch,
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

  return (
    <FinanceArea
      area="accounts"
      view={search.view}
      record={search.record}
      account={search.account}
      bankSearch={search}
      returnTo={search.returnTo}
    />
  );
}
