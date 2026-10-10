import { Api } from "@open-erp/contracts/api";
import { bookScope, httpQuery } from "@/lib/contract-client";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import * as Claims from "@open-erp/contracts/employee-claims";
import { Button } from "@open-erp/ui/components/button";
import { RegisterGroup, RegisterRow } from "@open-erp/ui/components/register-workspace";
import { AccountingStatus } from "@/components/accounting-status";
import { bookKey, readAccounting } from "@/lib/accounting-api";
import { useBookWorkspace, workspacePath } from "@/lib/book-context";
import { formatMinorAmount } from "@/lib/workspace-api";

export function EmployeeClaimDirectory() {
  const { book, locale } = useBookWorkspace();
  const navigate = useNavigate();

  const list = useInfiniteQuery({
    queryKey: [...bookKey(book), "payroll", "claims", "directory"],
    initialPageParam: "",
    retry: false,
    gcTime: 0,
    queryFn: async ({ pageParam, signal }) => {
      const page = await readAccounting(
        (client) =>
          client.employeeClaims.listEmployeeClaims({
            params: { ...bookScope(book) },
            query: httpQuery(
              Api.groups.employeeClaims.endpoints.listEmployeeClaims,
              `${pageParam ? `?after=${encodeURIComponent(pageParam)}` : ""}`,
            ),
          }),
        Claims.EmployeeClaimDirectory,
        { signal },
      );

      if (page.scope.entityId !== book.entityId || page.scope.bookId !== book.id)
        throw new Error("Employee claim directory scope mismatch");

      if (
        page.claims.some(
          ({ current }) =>
            current.scope.entityId !== book.entityId || current.scope.bookId !== book.id,
        )
      )
        throw new Error("Employee claim scope mismatch");

      return page;
    },
    getNextPageParam: (page) => page.next ?? undefined,
  });

  return (
    <>
      <RegisterGroup title={locale === "sv" ? "Utlägg" : "Employee claims"} />
      <AccountingStatus locale={locale} pending={list.isPending} error={list.error} />
      {list.isSuccess
        ? list.data.pages
            .flatMap((page) => page.claims)
            .map((claim) => (
              <RegisterRow
                key={claim.claimId}
                id={claim.claimId}
                title={claim.employeeName}
                status={claim.recognition ? "completed" : "draft"}
                state={claim.recognition ? "Bokförd" : "Väntar på granskning"}
                amount={formatMinorAmount(
                  claim.currentReview?.liabilityMinor ??
                    claim.current.items
                      .reduce((sum, item) => sum + BigInt(item.reimbursementMinor), 0n)
                      .toString(),
                  2,
                  locale,
                )}
                selected={false}
                onSelect={() =>
                  void navigate({
                    to: `${workspacePath(book)}/tax`,
                    search: { view: "claims", record: claim.claimId },
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
          {locale === "sv" ? "Läs in fler" : "Load more"}
        </Button>
      ) : null}
      {list.isError ? (
        <Button variant="outline" disabled={list.isFetching} onClick={() => void list.refetch()}>
          {locale === "sv" ? "Försök igen" : "Retry"}
        </Button>
      ) : null}
    </>
  );
}
