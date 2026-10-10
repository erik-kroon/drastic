import { createFileRoute } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import { FinanceArea } from "@/components/finance-area";
import { BankAccountWorkspace } from "@/components/bank-account-workspace";
import { ProcessorWorkspace } from "@/components/processor-workspace";
import { ForeignCashWorkspace } from "@/components/foreign-cash-workspace";
import { BankOwnerQuery, OwnerReturnSearch, WorkReturnSearch } from "@/lib/work-return";

export const Route = createFileRoute("/entities/$entityId/books/$bookId/accounts")({
  validateSearch: Schema.decodeUnknownSync(
    Schema.Struct({
      ...BankOwnerQuery.fields,
      cashApproval: Schema.optional(Schema.Boolean),
      returnTo: OwnerReturnSearch,
      work: WorkReturnSearch,
    }),
  ),
  component: Page,
});

function Page() {
  const search = Route.useSearch();

  if (search.view === "processors")
    return <ProcessorWorkspace accountId={search.account} reviewId={search.record} />;

  if (search.view === "foreign-cash")
    return (
      <ForeignCashWorkspace
        accountId={search.account}
        reviewId={search.record}
        approval={search.cashApproval}
      />
    );

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
