import * as Schema from "effect/Schema";
import { FirmSearch } from "@open-erp/contracts/firms";
import { createFileRoute } from "@tanstack/react-router";
import { AccountingAccess } from "@/components/accounting-access";
import { FirmsWorkspace } from "@/components/firms";
import { usePageLocale } from "@/lib/use-page-locale";
export const Route = createFileRoute("/firms")({
  validateSearch: Schema.decodeUnknownSync(FirmSearch),
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
          firmId={search.firm}
          tab={search.tab ?? "clients"}
          onNavigate={(firm, tab) => {
            void navigate({ search: { firm, tab } });
          }}
        />
      )}
    </AccountingAccess>
  );
}
