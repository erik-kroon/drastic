import { createFileRoute } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import { FinanceArea } from "@/components/finance-area";
export const Route = createFileRoute("/entities/$entityId/books/$bookId/closing")({
  validateSearch: Schema.decodeUnknownSync(Schema.Struct({ view: Schema.optional(Schema.String) })),
  component: Page,
});
function Page() {
  return <FinanceArea area="closing" view={Route.useSearch().view} />;
}
