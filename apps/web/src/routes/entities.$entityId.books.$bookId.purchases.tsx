import { createFileRoute } from "@tanstack/react-router";
import { Identifier } from "@open-erp/contracts/accounting";
import * as Schema from "effect/Schema";
import { FinanceArea } from "@/components/finance-area";
import { WorkReturnSearch, OwnerReturnSearch, DocumentQuery } from "@/lib/work-return";

export const Route = createFileRoute("/entities/$entityId/books/$bookId/purchases")({
  validateSearch: Schema.decodeUnknownSync(
    Schema.Struct({
      ...DocumentQuery.fields,
      returnTo: OwnerReturnSearch,
      work: WorkReturnSearch,
      review: Schema.optional(Identifier),
      // The open supplier occurrence, addressed separately from `record`, which the
      // supplier draft panel owns.
      occurrence: Schema.optional(Identifier),
    }),
  ),
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
