import { useInfiniteQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import * as Runs from "@open-erp/contracts/payroll-runs";
import { Button } from "@open-erp/ui/components/button";
import {
  RegisterGroup,
  RegisterNavigation,
  RegisterRow,
  RegisterWorkspace,
} from "@open-erp/ui/components/register-workspace";
import { AccountingStatus } from "@/components/accounting-status";
import { bookKey, bookPath, readAccounting } from "@/lib/accounting-api";
import { useBookWorkspace, workspacePath } from "@/lib/book-context";
import { formatMinorAmount } from "@/lib/workspace-api";
import { PayrollRunReview } from "./run-review";
import { EmployeeClaimDirectory } from "./employee-claim-directory";
import { MileageCorrectionDirectory } from "./mileage-correction-directory";
import { VariablePayDirectory } from "./variable-pay-directory";

export function PayrollWorkspace({ recordId }: { recordId?: string }) {
  const { book, locale } = useBookWorkspace();
  const navigate = useNavigate();
  const sv = locale === "sv";
  const base = `${workspacePath(book)}/tax`;

  const list = useInfiniteQuery({
    queryKey: [...bookKey(book), "payroll", "runs", "directory"],
    initialPageParam: "",
    retry: false,
    queryFn: async ({ pageParam, signal }) => {
      const page = await readAccounting(
        `${bookPath(book)}/payroll/runs${pageParam ? `?after=${encodeURIComponent(pageParam)}` : ""}`,
        Runs.PayrollRunPage,
        { signal },
      );

      if (
        page.items.some(
          ({ run }) => run.scope.entityId !== book.entityId || run.scope.bookId !== book.id,
        )
      )
        throw new Error("Payroll directory scope mismatch");

      return page;
    },
    getNextPageParam: (page) => page.next ?? undefined,
  });

  if (recordId)
    return (
      <PayrollRunReview
        key={`${book.entityId}:${book.id}:${recordId}`}
        book={book}
        locale={locale}
        runId={recordId}
      />
    );

  return (
    <RegisterWorkspace
      title={sv ? "Skatt och löner" : "Tax and payroll"}
      tabs={
        <RegisterNavigation
          label={sv ? "Skatt och löner" : "Tax and payroll"}
          options={[
            { label: sv ? "Moms" : "VAT", href: base, active: false },
            { label: sv ? "Löner" : "Payroll", href: `${base}?view=payroll`, active: true },
          ]}
        />
      }
    >
      <EmployeeClaimDirectory key={`${book.entityId}:${book.id}`} />
      <MileageCorrectionDirectory key={`mileage:${book.entityId}:${book.id}`} />
      <VariablePayDirectory key={`variable:${book.entityId}:${book.id}`} />
      <AccountingStatus locale={locale} pending={list.isPending} error={list.error} />
      {list.isSuccess ? (
        <>
          <RegisterGroup title={sv ? "Lönekörningar" : "Payroll runs"} />
          {list.data.pages
            .flatMap((page) => page.items)
            .map(({ run, execution }) => {
              const first = run.employees[0];

              if (!first) throw new Error("Payroll run has no retained employees");
              const calculation = first.calculation.calculation;

              const net = run.employeeObligations
                .reduce((total, row) => total + BigInt(row.payableMinor), 0n)
                .toString();

              return (
                <RegisterRow
                  key={run.id}
                  id={run.id}
                  title={`${calculation.earningsPeriod.startsOn} — ${calculation.earningsPeriod.endsOn}`}
                  status={execution ? "completed" : "draft"}
                  state={execution ? (sv ? "Bokförd" : "Posted") : sv ? "Förberedd" : "Prepared"}
                  amount={formatMinorAmount(net, calculation.currencyScale, locale)}
                  selected={false}
                  onSelect={() =>
                    void navigate({ to: base, search: { view: "payroll", record: run.id } })
                  }
                />
              );
            })}
          {list.hasNextPage ? (
            <Button
              variant="outline"
              disabled={list.isFetchingNextPage}
              onClick={() => void list.fetchNextPage()}
            >
              {sv ? "Läs in fler" : "Load more"}
            </Button>
          ) : null}
        </>
      ) : null}
    </RegisterWorkspace>
  );
}
