import { useState } from "react";
import { Action } from "@open-erp/ui/kanon/action";
import { FormLink, FormText } from "@open-erp/ui/kanon/form";
import { AreaBar, FocusPage, ListDetailPage } from "@open-erp/ui/kanon/layouts";
import { RegisterSearch, RegisterTable } from "@open-erp/ui/kanon/register";
import { DetailPanelSurface } from "@open-erp/ui/kanon/detail-panel";
import { RecurringDetail } from "./recurring-detail";
import { useInfiniteQuery } from "@tanstack/react-query";
import { defaultStringifySearch, useNavigate } from "@tanstack/react-router";
import * as Recurring from "@open-erp/contracts/recurring-invoices";
import { AccountingStatus } from "@/components/accounting-status";
import { useBookWorkspace, workspacePath } from "@/lib/book-context";
import { readAccounting } from "@/lib/accounting-api";
import { checkScope, commerceKey, commercePath } from "./shared";
import {
  CreateRecurringAgreement,
  RecurringAgreementControls,
} from "./recurring-agreement-controls";
import { SalesNavigation } from "./sales-navigation";

export function RecurringRegister(props: {
  work?: string;
  returnTo?: string;
  record?: string;
  cycle?: string;
  job?: string;
  form?: "create" | "schedule" | "template";
}) {
  const { work, returnTo } = props;
  const { book, locale } = useBookWorkspace();
  const sv = locale === "sv";

  const agreements = useInfiniteQuery({
    queryKey: [...commerceKey(book), "recurring-agreements"],
    initialPageParam: "",
    queryFn: async ({ pageParam, signal }) => {
      const query = new URLSearchParams();

      if (pageParam) query.set("after", pageParam);

      const result = await readAccounting(
        `${commercePath(book)}/recurring-invoices?${query}`,
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

  const [filter, setFilter] = useState("");
  const navigate = useNavigate({ from: "/entities/$entityId/books/$bookId/sales" });

  const openForm = (recurringForm?: "create" | "schedule" | "template") => {
    void navigate({ search: (previous) => ({ ...previous, recurringForm }) });
  };

  const bar = (
    <AreaBar
      title={sv ? "Försäljning" : "Sales"}
      tabs={<SalesNavigation view="recurring" work={work} returnTo={returnTo} />}
      action={
        <Action
          kind="secondary"
          compact
          onClick={() => openForm(props.form ? undefined : "create")}
        >
          {props.form
            ? sv
              ? "Alla avtal"
              : "All agreements"
            : sv
              ? "Nytt avtal"
              : "New agreement"}
        </Action>
      }
    />
  );

  if (props.form === "create")
    return (
      <FocusPage bar={bar}>
        <CreateRecurringAgreement
          book={book}
          locale={locale}
          work={work}
          returnTo={returnTo}
          onClose={() => openForm()}
        />
      </FocusPage>
    );

  if (props.record && (props.form === "schedule" || props.form === "template"))
    return (
      <FocusPage bar={bar}>
        <RecurringAgreementControls
          book={book}
          locale={locale}
          agreementId={props.record}
          mode={props.form}
          onClose={() => openForm()}
        />
      </FocusPage>
    );

  return (
    <ListDetailPage
      bar={bar}
      list={
        <>
          <RegisterSearch
            label={sv ? "Sök avtal" : "Search agreements"}
            value={filter}
            onChange={setFilter}
          />
          <AccountingStatus
            pending={agreements.isPending}
            error={agreements.error}
            locale={locale}
          />
          {agreements.isSuccess && items.length === 0 ? (
            <FormText>{sv ? "Inga återkommande avtal" : "No recurring agreements"}</FormText>
          ) : null}
          <RegisterTable
            label={sv ? "Återkommande avtal" : "Recurring agreements"}
            columns={[
              { label: sv ? "Avtal" : "Agreement" },
              { label: sv ? "Intervall" : "Interval", width: "interval" },
              { label: sv ? "Startdatum" : "Anchor date", width: "date" },
            ]}
            selected={props.record}
            rows={items
              .filter((item) => item.title.toLocaleLowerCase().includes(filter.toLocaleLowerCase()))
              .map((agreement) => ({
                id: agreement.id,
                cells: [
                  <FormLink
                    href={`${workspacePath(book)}/sales${defaultStringifySearch({ view: "recurring", record: agreement.id, work, returnTo })}`}
                  >
                    {agreement.title}
                  </FormLink>,
                  cadenceLabel(agreement.schedule.cadence, sv),
                  agreement.schedule.anchorLocalDate,
                ],
              }))}
          />
          {agreements.hasNextPage ? (
            <Action
              kind="secondary"
              disabled={agreements.isFetchingNextPage}
              onClick={() => void agreements.fetchNextPage()}
            >
              {sv ? "Läs in fler avtal" : "Load more agreements"}
            </Action>
          ) : null}
        </>
      }
      panel={
        props.record ? (
          <DetailPanelSurface label={sv ? "Valt avtal" : "Selected agreement"}>
            <RecurringDetail
              key={props.record}
              book={book}
              locale={locale}
              agreementId={props.record}
              cycleOrdinal={props.cycle}
              jobId={props.job}
              work={work}
              returnTo={returnTo}
              onEdit={openForm}
            />
          </DetailPanelSurface>
        ) : null
      }
    />
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
