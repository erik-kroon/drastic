import { Api } from "@open-erp/contracts/api";
import { bookScope, httpQuery } from "@/lib/contract-client";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import * as Mileage from "@open-erp/contracts/mileage-corrections";
import { Button } from "@open-erp/ui/components/button";
import { RegisterGroup, RegisterRow } from "@open-erp/ui/components/register-workspace";
import { AccountingStatus } from "@/components/accounting-status";
import { bookKey, readAccounting } from "@/lib/accounting-api";
import { useBookWorkspace, workspacePath } from "@/lib/book-context";
import { formatMinorAmount } from "@/lib/workspace-api";
import { mileageStatuses } from "./mileage-status";

export function MileageCorrectionDirectory() {
  const { book, locale } = useBookWorkspace();
  const navigate = useNavigate();

  const list = useInfiniteQuery({
    queryKey: [...bookKey(book), "payroll", "mileage-corrections", "directory"],
    initialPageParam: "",
    retry: false,
    gcTime: 0,
    queryFn: ({ pageParam, signal }) =>
      readAccounting(
        (client) =>
          client.mileageCorrections.listMileageCorrections({
            params: { ...bookScope(book) },
            query: httpQuery(
              Api.groups.mileageCorrections.endpoints.listMileageCorrections,
              `${pageParam ? `?cursor=${encodeURIComponent(pageParam)}` : ""}`,
            ),
          }),
        Mileage.MileageCorrectionPage,
        { signal },
      ),
    getNextPageParam: (page) => page.next ?? undefined,
  });

  return (
    <>
      <RegisterGroup title="Milersättning" />
      <AccountingStatus locale={locale} pending={list.isPending} error={list.error} />
      {list.isSuccess
        ? list.data.pages
            .flatMap((page) => page.items)
            .map((item) => (
              <RegisterRow
                key={item.id}
                id={item.id}
                title={`${item.originalReference}, ${item.employee.personRef}`}
                status={item.status === "executed" ? "completed" : "draft"}
                state={mileageStatuses[item.status]}
                amount={
                  item.entitlementDeltaMinor === null
                    ? ""
                    : formatMinorAmount(item.entitlementDeltaMinor, 2, locale)
                }
                selected={false}
                onSelect={() =>
                  void navigate({
                    to: `${workspacePath(book)}/tax`,
                    search: { view: "mileage", record: item.id },
                  })
                }
              />
            ))
        : null}
      {list.isSuccess && list.hasNextPage ? (
        <Button
          variant="outline"
          disabled={list.isFetchingNextPage}
          onClick={() => void list.fetchNextPage()}
        >
          Läs in fler
        </Button>
      ) : null}
      {list.isError ? (
        <Button variant="outline" disabled={list.isFetching} onClick={() => void list.refetch()}>
          Försök igen
        </Button>
      ) : null}
    </>
  );
}
