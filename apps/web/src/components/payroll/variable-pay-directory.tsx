import { useInfiniteQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import * as Variable from "@open-erp/contracts/variable-pay-review";
import { Button } from "@open-erp/ui/components/button";
import { RegisterGroup, RegisterRow } from "@open-erp/ui/components/register-workspace";
import { AccountingStatus } from "@/components/accounting-status";
import { bookKey, bookPath, readAccounting } from "@/lib/accounting-api";
import { useBookWorkspace, workspacePath } from "@/lib/book-context";
import { variableMonth } from "./variable-pay-presentation";

const states = {
  blocked: "Kan inte godkännas",
  ready: "Redo för granskning",
  returned: "Skickat tillbaka",
  removed: "Borttagen ur körningen",
  recognized: "Bokförd",
} as const;

export function VariablePayDirectory() {
  const { book, locale } = useBookWorkspace();
  const navigate = useNavigate();

  const list = useInfiniteQuery({
    queryKey: [...bookKey(book), "payroll", "variable-pay", "directory"],
    initialPageParam: "",
    retry: false,
    gcTime: 0,
    queryFn: async ({ pageParam, signal }) => {
      const page = await readAccounting(
        `${bookPath(book)}/payroll/variable-pay${pageParam ? `?cursor=${encodeURIComponent(pageParam)}` : ""}`,
        Variable.VariablePayReviewPage,
        { signal },
      );

      if (
        page.items.some(
          ({ assessment }) =>
            assessment.scope.entityId !== book.entityId || assessment.scope.bookId !== book.id,
        )
      )
        throw new Error("Variable-pay directory scope mismatch");

      return page;
    },
    getNextPageParam: (page) => page.next ?? undefined,
  });

  return (
    <>
      <RegisterGroup title="Rörlig lön" />
      <AccountingStatus locale={locale} pending={list.isPending} error={list.error} />
      {list.isSuccess
        ? list.data.pages
            .flatMap((page) => page.items)
            .map((view) => (
              <RegisterRow
                key={view.assessment.id}
                id={view.assessment.id}
                title={`${view.assessment.employee.personRef}, ${variableMonth(view.assessment.sourceProfile.month, locale)}`}
                status={view.recognition ? "completed" : "draft"}
                state={view.financialApproval?.usable ? "Godkänd" : states[view.current.status]}
                amount=""
                selected={false}
                onSelect={() =>
                  void navigate({
                    to: `${workspacePath(book)}/tax`,
                    search: { view: "variable", record: view.assessment.id },
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
