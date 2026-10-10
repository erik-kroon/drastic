import { bookScope, httpQuery } from "@/lib/contract-client";
import { Api } from "@open-erp/contracts/api";
import { useInfiniteQuery } from "@tanstack/react-query";
import { defaultStringifySearch } from "@tanstack/react-router";
import * as Recurring from "@open-erp/contracts/recurring-invoices";
import { Button } from "@open-erp/ui/components/button";
import { DataTable } from "@open-erp/ui/components/data-table";
import { Link } from "@open-erp/ui/components/link";
import { PageEmpty } from "@open-erp/ui/components/accounting-page";
import { RegisterWorkspace } from "@open-erp/ui/components/register-workspace";
import { AccountingStatus } from "@/components/accounting-status";
import { useBookWorkspace, workspacePath } from "@/lib/book-context";
import { readAccounting } from "@/lib/accounting-api";
import { checkScope, commerceKey } from "./shared";
import { SalesNavigation } from "./sales-navigation";

export function RecurringRegister({ work, returnTo }: { work?: string; returnTo?: string }) {
  const { book, locale } = useBookWorkspace();
  const sv = locale === "sv";

  const agreements = useInfiniteQuery({
    queryKey: [...commerceKey(book), "recurring-agreements"],
    initialPageParam: "",
    queryFn: async ({ pageParam, signal }) => {
      const query = new URLSearchParams();

      if (pageParam) query.set("after", pageParam);

      const result = await readAccounting(
        (client) =>
          client.recurringInvoices.listRecurringAgreements({
            params: { ...bookScope(book) },
            query: httpQuery(
              Api.groups.recurringInvoices.endpoints.listRecurringAgreements,
              `${query}`,
            ),
          }),
        Recurring.RecurringAgreementPage,
        { signal },
      );

      checkScope(book, result.scope);

      return result;
    },
    getNextPageParam: (page) => page.continuation ?? undefined,
    retry: false,
  });

  const items = agreements.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <RegisterWorkspace
      title={sv ? "Försäljning" : "Sales"}
      tabs={<SalesNavigation view="recurring" work={work} returnTo={returnTo} />}
    >
      <AccountingStatus pending={agreements.isPending} error={agreements.error} locale={locale} />
      {agreements.isSuccess && items.length === 0 ? (
        <PageEmpty
          title={sv ? "Inga återkommande avtal" : "No recurring agreements"}
          detail={sv ? "Sparade avtal visas här." : "Saved agreements appear here."}
        />
      ) : null}
      {items.length > 0 ? (
        <DataTable
          title={sv ? "Återkommande avtal" : "Recurring agreements"}
          narrow="stack"
          columns={[
            { id: "title", label: sv ? "Avtal" : "Agreement", width: "fill" },
            { id: "interval", label: sv ? "Intervall" : "Interval", width: 130 },
            { id: "anchor", label: sv ? "Startdatum" : "Anchor date", width: 150 },
          ]}
          rows={items.map((agreement) => ({
            id: agreement.id,
            cells: [
              <Link
                key="title"
                href={`${workspacePath(book)}/sales${defaultStringifySearch({ view: "recurring", record: agreement.id, work, returnTo })}`}
              >
                {agreement.title}
              </Link>,
              cadenceLabel(agreement.schedule.cadence, sv),
              agreement.schedule.anchorLocalDate,
            ],
          }))}
        />
      ) : null}
      {agreements.hasNextPage ? (
        <Button
          variant="outline"
          disabled={agreements.isFetchingNextPage}
          onClick={() => void agreements.fetchNextPage()}
        >
          {sv ? "Läs in fler avtal" : "Load more agreements"}
        </Button>
      ) : null}
    </RegisterWorkspace>
  );
}

function cadenceLabel(cadence: Recurring.RecurrenceCadence, sv: boolean) {
  if (cadence.kind === "monthly") {
    if (cadence.monthInterval === "1") return sv ? "Varje månad" : "Every month";

    if (cadence.monthInterval === "3") return sv ? "Varje kvartal" : "Every quarter";

    return sv ? `Var ${cadence.monthInterval}:e månad` : `Every ${cadence.monthInterval} months`;
  }

  return sv ? `Var ${cadence.dayInterval}:e dag` : `Every ${cadence.dayInterval} days`;
}
