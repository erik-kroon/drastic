import { createFileRoute } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import { FinanceArea } from "@/components/finance-area";
import { WorkReturnSearch, OwnerReturnSearch } from "@/lib/work-return";

export const Route = createFileRoute("/entities/$entityId/books/$bookId/closing")({
  validateSearch: Schema.decodeUnknownSync(
    Schema.Struct({
      view: Schema.optional(Schema.String),
      record: Schema.optional(Schema.String),
      work: WorkReturnSearch,
      returnTo: OwnerReturnSearch,
    }),
  ),
  component: Page,
});

function Page() {
  const search = Route.useSearch();

  return (
    <FinanceArea
      area="closing"
      view={search.view}
      record={search.record}
      work={search.work}
      returnTo={search.returnTo}
    />
  );
}
