import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type * as Accounting from "@open-erp/contracts/accounting";
import * as Sales from "@open-erp/contracts/sales-register";
import { Box } from "@open-erp/ui/components/box";
import { CommandSearch } from "@open-erp/ui/components/command-search";
import { PageCaption } from "@open-erp/ui/components/accounting-page";
import { AccountingStatus } from "@/components/accounting-status";
import { readAccounting } from "@/lib/accounting-api";
import { workspacePath } from "@/lib/book-context";
import { formatMinorAmount } from "@/lib/workspace-api";
import { checkScope, commerceKey, commercePath } from "@/components/commerce/shared";
import type { Locale } from "@/paraglide/runtime";

export function BookSearch({
  book,
  locale,
}: {
  book: typeof Accounting.Book.Type;
  locale: Locale;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const sv = locale === "sv";
  const base = workspacePath(book);
  const term = query.trim();
  const params = new URLSearchParams({ status: "all", sort: "newest", page: "1", q: term });

  const invoices = useQuery({
    queryKey: [...commerceKey(book), "sales-register", params.toString()],
    enabled: open && term.length >= 2,
    queryFn: async ({ signal }) => {
      const result = await readAccounting(
        `${commercePath(book)}/sales-register?${params}`,
        Sales.SalesPage,
        { signal },
      );

      checkScope(book, result.scope);

      return result;
    },
    retry: false,
  });

  const pages = [
    { title: sv ? "Att göra" : "To do", href: `${base}/` },
    { title: sv ? "Översikt" : "Overview", href: `${base}/overview` },
    { title: "Bank", href: `${base}/accounts` },
    { title: sv ? "Försäljning" : "Sales", href: `${base}/sales` },
    { title: sv ? "Inköp" : "Purchases", href: `${base}/purchases` },
    { title: sv ? "Dokument" : "Documents", href: `${base}/purchases?view=documents` },
    { title: sv ? "Bokföring" : "Bookkeeping", href: `${base}/books` },
    { title: sv ? "Skatt och löner" : "Tax and payroll", href: `${base}/tax` },
    { title: sv ? "Rapporter" : "Reports", href: `${base}/reports` },
    { title: sv ? "Bokslut" : "Year-end", href: `${base}/closing` },
    { title: sv ? "Inställningar" : "Settings", href: `${base}/settings` },
  ].filter((item) => item.title.toLocaleLowerCase(locale).includes(term.toLocaleLowerCase(locale)));

  const result = term.length >= 2 && invoices.isSuccess ? invoices.data : undefined;

  const items = (result?.items ?? []).map((item) => ({
    title: `${item.customer}${item.number ? ` · ${item.number}` : ""}`,
    detail:
      item.amountMinor === null
        ? undefined
        : `${formatMinorAmount(item.amountMinor, item.currencyScale, locale)} ${item.currency}`,
    href: `${base}/sales?kind=${item.kind}&record=${encodeURIComponent(item.id)}`,
  }));

  return (
    <CommandSearch
      label={sv ? "Sök" : "Search"}
      open={open}
      onOpenChange={setOpen}
      query={query}
      onQueryChange={setQuery}
      groups={[
        { title: sv ? "Sidor" : "Pages", items: pages },
        { title: sv ? "Kundfakturor och utkast" : "Customer invoices and drafts", items },
      ]}
      status={
        <Box padding="md">
          {term.length >= 2 ? (
            <AccountingStatus locale={locale} pending={invoices.isPending} error={invoices.error} />
          ) : null}
          {result && result.total > result.items.length ? (
            <PageCaption>
              {sv
                ? `Visar ${result.items.length} av ${result.total} fakturor.`
                : `Showing ${result.items.length} of ${result.total} invoices.`}
            </PageCaption>
          ) : null}
          {term.length >= 2 && result?.total === 0 && !pages.length ? (
            <PageCaption>
              {sv
                ? "Inga sidor eller kundfakturor matchar sökningen."
                : "No pages or customer invoices match your search."}
            </PageCaption>
          ) : null}
        </Box>
      }
    />
  );
}
