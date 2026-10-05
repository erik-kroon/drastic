import { createFileRoute } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import { FinanceArea } from "@/components/finance-area";
import { WorkReturnSearch, DocumentQuery } from "@/lib/work-return";

export const Route = createFileRoute("/entities/$entityId/books/$bookId/tax")({
  validateSearch: Schema.decodeUnknownSync(
    Schema.Struct({
      view: Schema.optional(Schema.String),
      record: Schema.optional(Schema.String),
      occurrence: Schema.optional(Schema.String),
      work: WorkReturnSearch,
      expenseRevision: DocumentQuery.fields.expenseRevision,
      expenseReviewId: DocumentQuery.fields.expenseReviewId,
    }),
  ),
  component: Page,
});

function Page() {
  const search = Route.useSearch();

  return (
    <FinanceArea
      area="tax"
      view={search.view}
      record={search.record}
      occurrence={search.occurrence}
      work={search.work}
    />
  );
}
