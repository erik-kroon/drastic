import { bookScope, httpQuery } from "@/lib/contract-client";
import { Api } from "@open-erp/contracts/api";
import { useQuery } from "@tanstack/react-query";
import * as Commerce from "@open-erp/contracts/commerce";
import { RegisterDetailLines } from "@open-erp/ui/components/register-workspace";
import { PageCaption } from "@open-erp/ui/components/accounting-page";
import { AccountingStatus } from "@/components/accounting-status";
import { readAccounting } from "@/lib/accounting-api";
import { workspacePath } from "@/lib/book-context";
import { formatMinorAmount } from "@/lib/workspace-api";
import { useBusinessDate } from "@/lib/use-business-date";
import { checkScope, commerceKey, type CommerceProps } from "./shared";

export function CustomerInvoicesPreview(props: CommerceProps & { partyId: string }) {
  const sv = props.locale === "sv";
  const today = useBusinessDate();

  const page = useQuery({
    queryKey: [...commerceKey(props.book), "customer-invoice-preview", props.partyId],
    queryFn: async ({ signal }) => {
      const result = await readAccounting(
        (client) =>
          client.commerce.commerceListInvoices({
            params: { ...bookScope(props.book) },
            query: httpQuery(Api.groups.commerce.endpoints.commerceListInvoices, ``),
          }),
        Commerce.InvoicePage,
        { signal },
      );

      result.items.forEach((invoice) => checkScope(props.book, invoice.scope));

      return result;
    },
    retry: false,
  });

  const items = page.isError
    ? []
    : (page.data?.items.filter(
        (item) => item.direction === "customer" && item.counterpartyId === props.partyId,
      ) ?? []);

  return (
    <>
      <AccountingStatus locale={props.locale} pending={page.isPending} error={page.error} />
      {page.isSuccess ? (
        <RegisterDetailLines
          title={sv ? "Fakturor" : "Invoices"}
          lines={items.map((invoice) => {
            const date = new Intl.DateTimeFormat(props.locale, {
              month: "short",
              day: "numeric",
              timeZone: "UTC",
            }).format(new Date(invoice.currentRevision.dueOn));

            const due =
              invoice.currentRevision.dueOn < today
                ? sv
                  ? "förföll"
                  : "was due"
                : sv
                  ? "förfaller"
                  : "due";

            const amount = formatMinorAmount(
              invoice.amountMinor,
              invoice.currencyScale,
              props.locale,
            );

            return {
              id: invoice.id,
              description: `${invoice.documentNumber}, ${due} ${date}`,
              amount:
                invoice.currency === props.book.currency ? amount : `${amount} ${invoice.currency}`,
              href: `${workspacePath(props.book)}/sales?record=${encodeURIComponent(invoice.id)}&kind=invoice`,
            };
          })}
        />
      ) : null}
      {page.data?.next ? (
        <PageCaption>
          {sv ? "Fler fakturor finns i Försäljning." : "More invoices are available in Sales."}
        </PageCaption>
      ) : null}
    </>
  );
}
