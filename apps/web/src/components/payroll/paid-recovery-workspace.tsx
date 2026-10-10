import { useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import * as Recovery from "@open-erp/contracts/paid-payroll-recovery";
import { AreaBar, BarTab, ListDetailPage } from "@open-erp/ui/kanon/layouts";
import { Action } from "@open-erp/ui/kanon/action";
import { NavigationLink, FormText } from "@open-erp/ui/kanon/form";
import { RegisterSearch } from "@open-erp/ui/kanon/register";
import { WorkList, WorkGroup, WorkRow } from "@open-erp/ui/kanon/work-list";
import { AccountingStatus } from "@/components/accounting-status";
import { bookKey, bookPath, readAccounting } from "@/lib/accounting-api";
import { useBookWorkspace, workspacePath } from "@/lib/book-context";
import { formatMinorAmount } from "@/lib/workspace-api";
import { payrollMonth } from "./paid-recovery-presentation";
import { PaidRecoveryPanel } from "./paid-recovery-panel";

export function PaidRecoveryWorkspace({ recordId }: { recordId?: string }) {
  const { book, locale } = useBookWorkspace();
  const sv = locale === "sv";
  const navigate = useNavigate();
  const [filter, setFilter] = useState("");

  const list = useInfiniteQuery({
    queryKey: [...bookKey(book), "payroll", "paid-recoveries", "directory"],
    initialPageParam: "",
    retry: false,
    queryFn: async ({ pageParam, signal }) => {
      const page = await readAccounting(
        `${bookPath(book)}/payroll/paid-recoveries${pageParam ? `?cursor=${encodeURIComponent(pageParam)}` : ""}`,
        Recovery.PaidRecoveryList,
        { signal },
      );

      for (const item of page.items) {
        if (
          item.assessment.scope.entityId !== book.entityId ||
          item.assessment.scope.bookId !== book.id
        )
          throw new Error("Paid recovery directory scope mismatch");
      }

      return page;
    },
    getNextPageParam: (page) => page.next ?? undefined,
  });

  const items = list.data?.pages.flatMap((page) => page.items) ?? [];

  const filtered = items.filter((item) =>
    `${item.assessment.employee.name} ${item.assessment.original.reportingPeriod}`
      .toLocaleLowerCase()
      .includes(filter.toLocaleLowerCase()),
  );

  return (
    <ListDetailPage
      bar={
        <AreaBar
          title={sv ? "Löner" : "Payroll"}
          tabs={
            <BarTab
              active={false}
              label={sv ? "Återkrav" : "Recovery"}
              render={<NavigationLink href={`${workspacePath(book)}/tax?view=paid-recovery`} />}
            />
          }
          action={
            <NavigationLink href={`${workspacePath(book)}/tax?view=payroll`}>
              {sv ? "Historik" : "History"}
            </NavigationLink>
          }
        />
      }
      list={
        <>
          <RegisterSearch
            label={sv ? "Sök återkrav" : "Search recoveries"}
            value={filter}
            onChange={setFilter}
          />
          <AccountingStatus locale={locale} pending={list.isPending} error={list.error} />
          {list.isSuccess && !items.length ? (
            <FormText>{sv ? "Inga sparade återkrav" : "No saved recovery attempts"}</FormText>
          ) : null}
          <WorkList>
            <WorkGroup
              recovery
              title={
                filtered.every((item) => item.attachments.length === 0)
                  ? sv
                    ? "Behöver underlag"
                    : "Needs evidence"
                  : sv
                    ? "Sparade återkrav"
                    : "Saved recoveries"
              }
              count={filtered.length}
              first
            >
              {filtered.map((item) => (
                <WorkRow
                  key={item.assessment.id}
                  recovery
                  status={item.cancellation ? "done" : "needsYou"}
                  title={item.assessment.employee.name}
                  state={payrollMonth(item.assessment.original.reportingPeriod, locale, true)}
                  amount={formatMinorAmount(
                    item.assessment.targetMinor,
                    item.originalPaidEvent.originalEmployee.calculation.calculation.currencyScale,
                    locale,
                  )}
                  selected={item.assessment.id === recordId}
                  onSelect={() =>
                    void navigate({
                      to: `${workspacePath(book)}/tax`,
                      search: { view: "paid-recovery", record: item.assessment.id },
                    })
                  }
                />
              ))}
            </WorkGroup>
          </WorkList>
          {list.hasNextPage ? (
            <Action
              kind="secondary"
              disabled={list.isFetchingNextPage}
              onClick={() => void list.fetchNextPage()}
            >
              {sv ? "Fler återkrav" : "More recoveries"}
            </Action>
          ) : null}
        </>
      }
      panel={
        recordId ? <PaidRecoveryPanel key={`${book.id}:${recordId}`} recoveryId={recordId} /> : null
      }
    />
  );
}
