import { createFileRoute } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import * as Sales from "@open-erp/contracts/sales-register";
import { SalesWorkspace } from "@/components/commerce/sales-workspace";
export const Route = createFileRoute("/entities/$entityId/books/$bookId/sales")({
  validateSearch: Schema.decodeUnknownSync(
    Schema.Struct({
      ...Sales.SalesQuery.fields,
      page: Schema.optional(
        Schema.Union([
          Sales.SalesQuery.fields.page,
          Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 999999 })),
        ]),
      ),
      view: Schema.optional(Schema.String),
      record: Schema.optional(Schema.String),
      kind: Schema.optional(Schema.Literals(["draft", "invoice"])),
      stage: Schema.optional(Schema.Literals(["review", "payments"])),
      review: Schema.optional(Schema.String),
      allocation: Schema.optional(Schema.String),
      release: Schema.optional(Schema.String),
      paymentPage: Schema.optional(
        Schema.Union([
          Schema.String.check(Schema.isPattern(/^[1-9][0-9]{0,5}$/)),
          Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 999999 })),
        ]),
      ),
      paymentHistoryPage: Schema.optional(
        Schema.Union([
          Schema.String.check(Schema.isPattern(/^[1-9][0-9]{0,5}$/)),
          Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 999999 })),
        ]),
      ),
    }),
  ),
  component: Page,
});
function Page() {
  const search = Route.useSearch();
  return (
    <SalesWorkspace
      search={{
        ...search,
        page: search.page === undefined ? undefined : String(search.page),
        paymentPage: search.paymentPage === undefined ? undefined : String(search.paymentPage),
        paymentHistoryPage:
          search.paymentHistoryPage === undefined ? undefined : String(search.paymentHistoryPage),
      }}
    />
  );
}
