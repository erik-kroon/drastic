import { createFileRoute } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import { Identifier } from "@open-erp/contracts/accounting";
import { HistoricalIntake } from "@/components/historical-intake/panel";

export const Route = createFileRoute("/entities/$entityId/books/$bookId/history")({
  validateSearch: Schema.decodeUnknownSync(
    Schema.Struct({
      source: Schema.optional(Identifier),
      preview: Schema.optional(Identifier),
      plan: Schema.optional(Identifier),
    }),
  ),
  component: Page,
});

function Page() {
  return <HistoricalIntake {...Route.useSearch()} />;
}
