import { createFileRoute } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import { FinanceArea } from "@/components/finance-area";
import { WorkReturnSearch } from "@/lib/work-return";

export const Route = createFileRoute("/entities/$entityId/books/$bookId/purchases")({
  validateSearch: Schema.decodeUnknownSync(
    Schema.Struct({
      view: Schema.optional(Schema.String),
      record: Schema.optional(Schema.String),
      work: WorkReturnSearch,
    }),
  ),
  component: Page,
});

function Page() {
  const search = Route.useSearch();

  return (
    <FinanceArea area="purchases" view={search.view} record={search.record} work={search.work} />
  );
}
