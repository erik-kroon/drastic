import { createFileRoute } from "@tanstack/react-router";
import { AccountingAccess } from "@/components/accounting-access";
import { CompanyDirectory } from "@/components/company-directory";
import { usePageLocale } from "@/lib/use-page-locale";
export const Route = createFileRoute("/companies")({ component: Companies });
function Companies() {
  const locale = usePageLocale();
  return (
    <AccountingAccess locale={locale}>
      {(books) => <CompanyDirectory books={books} locale={locale} />}
    </AccountingAccess>
  );
}
