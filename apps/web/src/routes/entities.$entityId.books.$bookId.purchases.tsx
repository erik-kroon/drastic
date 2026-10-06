import { createFileRoute } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import { FinanceArea } from "@/components/finance-area";
import { PurchasesOwnerQuery } from "@/lib/work-return";

export const Route = createFileRoute("/entities/$entityId/books/$bookId/purchases")({
  validateSearch: Schema.decodeUnknownSync(PurchasesOwnerQuery),
  component: Page,
});

function Page() {
  const search = Route.useSearch();

  return (
    <FinanceArea
      area="purchases"
      view={search.view}
      record={search.record}
      work={search.work}
      occurrence={search.occurrence}
      archive={search}
      returnTo={search.returnTo}
    />
  );
}
