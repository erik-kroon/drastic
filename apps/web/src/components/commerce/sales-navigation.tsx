import { defaultStringifySearch } from "@tanstack/react-router";
import { BarTab } from "@open-erp/ui/kanon/layouts";
import { NavigationLink } from "@open-erp/ui/kanon/form";
import { useBookWorkspace, workspacePath } from "@/lib/book-context";
import type { SalesSearch } from "./sales-workspace";

export function SalesNavigation(props: {
  view?: string;
  work?: string;
  returnTo?: string;
  search?: SalesSearch;
  preloadInvoices?: () => void;
  preloadCustomers?: () => void;
}) {
  const { view, work, returnTo, search } = props;
  const { book, locale } = useBookWorkspace();
  const sv = locale === "sv";

  const destinations = [
    { view: undefined, label: sv ? "Fakturor" : "Invoices" },
    { view: "parties", label: sv ? "Kunder" : "Customers" },
    { view: "recurring", label: sv ? "Återkommande" : "Recurring" },
    { view: "orders", label: sv ? "Offerter" : "Quotes" },
    { view: "articles", label: sv ? "Artiklar" : "Articles" },
    { view: "collections", label: sv ? "Krav" : "Collections" },
  ];

  return (
    <>
      {destinations.map((destination) => (
        <BarTab
          key={destination.label}
          label={destination.label}
          active={destination.view === view}
          render={
            <NavigationLink
              href={`${workspacePath(book)}/sales${defaultStringifySearch({ ...search, view: destination.view, work: work ?? search?.work, returnTo: returnTo ?? search?.returnTo })}`}
            />
          }
        />
      ))}
    </>
  );
}
