import { createFileRoute } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import { FinanceArea } from "@/components/finance-area";
export const Route = createFileRoute("/entities/$entityId/books/$bookId/sales")({
  validateSearch: Schema.decodeUnknownSync(
    Schema.Struct({ view: Schema.optional(Schema.String), record: Schema.optional(Schema.String) }),
  ),
  component: Page,
});
function Page() {
  return (
    <FinanceArea area="sales" view={Route.useSearch().view} record={Route.useSearch().record} />
  );
}
