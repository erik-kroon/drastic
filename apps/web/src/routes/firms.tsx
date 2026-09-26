import * as Schema from "effect/Schema";
import { FirmSearch } from "@open-erp/contracts/firms";
import { createFileRoute } from "@tanstack/react-router";
import { AccountingAccess } from "@/components/accounting-access";
import { FirmsWorkspace } from "@/components/firms";
import { usePageLocale } from "@/lib/use-page-locale";

export const Route = createFileRoute("/firms")({
  validateSearch: Schema.decodeUnknownSync(
    Schema.Struct({
      ...FirmSearch.fields,
      q: Schema.optional(Schema.String.check(Schema.isMaxLength(200))),
      view: Schema.optional(Schema.Literals(["all", "mine", "due", "unassigned"])),
      page: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
    }),
  ),
  component: Firms,
});

function Firms() {
  const locale = usePageLocale();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();

  return (
    <AccountingAccess locale={locale}>
      {(books) => (
        <FirmsWorkspace
          books={books}
          locale={locale}
          filters={search}
          onFilters={(filters) =>
            void navigate({ search: { ...search, ...filters }, replace: true, resetScroll: false })
          }
          firmId={search.firm}
          tab={search.tab ?? "clients"}
          onNavigate={(firm, tab) => {
            void navigate({
              search:
                !search.firm || search.firm === firm ? { ...search, firm, tab } : { firm, tab },
            });
          }}
        />
      )}
    </AccountingAccess>
  );
}
