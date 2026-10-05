import { createFileRoute } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import { Identifier } from "@open-erp/contracts/accounting";
import { HistoricalIntake } from "@/components/historical-intake/panel";
import { HistoricalAdoptionWorkspace } from "@/components/historical-intake/adoption-workspace";

export const Route = createFileRoute("/entities/$entityId/books/$bookId/history")({
  validateSearch: Schema.decodeUnknownSync(
    Schema.Struct({
      source: Schema.optional(Identifier),
      preview: Schema.optional(Identifier),
      plan: Schema.optional(Identifier),
      adoption: Schema.optional(Identifier),
    }),
  ),
  component: Page,
});

function Page() {
  const search = Route.useSearch();

  return search.adoption ? (
    <HistoricalAdoptionWorkspace planId={search.adoption} />
  ) : (
    <HistoricalIntake {...search} />
  );
}
