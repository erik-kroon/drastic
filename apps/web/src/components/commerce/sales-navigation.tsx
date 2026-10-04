import { defaultStringifySearch } from "@tanstack/react-router";
import { RegisterNavigation } from "@open-erp/ui/components/register-workspace";
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
    { view: "recurring", label: sv ? "Återkommande" : "Recurring" },
    { view: "orders", label: sv ? "Offerter och order" : "Quotes and orders" },
    { view: "parties", label: sv ? "Kunder" : "Customers" },
    { view: "articles", label: sv ? "Artiklar" : "Articles" },
    { view: "collections", label: sv ? "Krav" : "Collections" },
  ];

  return (
    <RegisterNavigation
      label={sv ? "Försäljning" : "Sales"}
      options={destinations.map((destination) => ({
        label: destination.label,
        href: `${workspacePath(book)}/sales${defaultStringifySearch({ ...search, view: destination.view, work: work ?? search?.work, returnTo: returnTo ?? search?.returnTo })}`,
        active: destination.view === view,
        preload:
          destination.view === undefined
            ? props.preloadInvoices
            : destination.view === "parties"
              ? props.preloadCustomers
              : undefined,
      }))}
    />
  );
}
