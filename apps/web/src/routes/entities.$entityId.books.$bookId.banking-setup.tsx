import { createFileRoute } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import { Identifier } from "@open-erp/contracts/accounting";
import { OwnerReturnSearch } from "@/lib/work-return";
import { BankingSetup } from "@/components/banking-setup/panel";

export const Route = createFileRoute("/entities/$entityId/books/$bookId/banking-setup")({
  validateSearch: Schema.decodeUnknownSync(
    Schema.Struct({ consent: Schema.optional(Identifier), returnTo: OwnerReturnSearch }),
  ),
  component: Page,
});

function Page() {
  return <BankingSetup {...Route.useSearch()} />;
}
