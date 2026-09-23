import { createFileRoute, Navigate } from "@tanstack/react-router";
import { AccountingAccess } from "@/components/accounting-access";
import { CompanyDirectory } from "@/components/company-directory";
import { usePageLocale } from "@/lib/use-page-locale";

export const Route = createFileRoute("/")({ component: HomePage });

function HomePage() {
  const locale = usePageLocale();
  return (
    <AccountingAccess locale={locale}>
      {(books) => {
        const single = books.length === 1 ? books[0] : undefined;
        if (single)
          return (
            <Navigate
              to="/entities/$entityId/books/$bookId"
              params={{ entityId: single.entityId, bookId: single.id }}
              replace
            />
          );
        return <CompanyDirectory books={books} locale={locale} />;
      }}
    </AccountingAccess>
  );
}
