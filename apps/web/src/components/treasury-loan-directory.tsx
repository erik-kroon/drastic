import { Api } from "@open-erp/contracts/api";
import { bookScope, httpQuery } from "@/lib/contract-client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import * as Loans from "@open-erp/contracts/treasury-loans";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { Link } from "@open-erp/ui/components/link";
import { formatMinorAmount } from "@/lib/workspace-api";
import { AccountingStatus } from "@/components/accounting-status";
import { checkScope } from "@/components/commerce/shared";
import { bookKey, readAccounting } from "@/lib/accounting-api";
import { useBookWorkspace, workspacePath } from "@/lib/book-context";

export function TreasuryLoanDirectory({ loanId }: { loanId?: string }) {
  const { book, locale, setup } = useBookWorkspace();

  const [after, setAfter] = useState<string>();

  const query = useQuery({
    queryKey: [...bookKey(book), "treasury-loans", "directory", loanId, after],
    retry: false,
    queryFn: async ({ signal }) => {
      const cursor = after ? `?after=${encodeURIComponent(after)}` : "";

      if (loanId) {
        const value = await readAccounting(
          (client) =>
            client.treasuryLoan.listLoanReviews({
              params: { ...bookScope(book), id: loanId },
              query: httpQuery(Api.groups.treasuryLoan.endpoints.listLoanReviews, cursor),
            }),
          Loans.LoanReviewPage,
          { signal },
        );

        checkScope(book, value.scope);

        if (value.loanId !== loanId || value.items.some((review) => review.loanId !== loanId))
          throw new Error("Loan review directory identity mismatch");

        return {
          next: value.next,
          items: value.items.map((review) => ({
            id: review.id,
            label: `Förbered ränta, ${review.input.postingDate}${review.calculation ? `, skillnad ${formatMinorAmount(review.calculation.deltaMinor, 2, locale)}` : ""}`,
            href: `${workspacePath(book)}/books?view=accounts&loan=${encodeURIComponent(loanId)}&loanReview=${encodeURIComponent(review.id)}`,
          })),
        };
      }

      const value = await readAccounting(
        (client) =>
          client.treasuryLoan.listLoans({
            params: bookScope(book),
            query: httpQuery(Api.groups.treasuryLoan.endpoints.listLoans, cursor),
          }),
        Loans.LoanPage,
        { signal },
      );

      checkScope(book, value.scope);

      return {
        next: value.next,
        items: value.items.map((loan) => {
          checkScope(book, loan.scope);
          const account = setup.accounts.find((item) => item.id === loan.principal.accountId);

          return {
            id: loan.id,
            label: account ? `${account.code} ${account.name}` : loan.principal.accountId,
            href: `${workspacePath(book)}/books?view=accounts&loan=${encodeURIComponent(loan.id)}`,
          };
        }),
      };
    },
  });

  return (
    <Box display="grid" gap="md">
      <AccountingStatus locale={locale} pending={query.isPending} error={query.error} />
      {query.isError ? (
        <Button variant="outline" onClick={() => void query.refetch()}>
          Försök igen
        </Button>
      ) : null}
      {!query.isError
        ? query.data?.items.map((item) => (
            <Link key={item.id} href={item.href}>
              {item.label}
            </Link>
          ))
        : null}
      {!query.isError && query.data?.next ? (
        <Button variant="outline" onClick={() => setAfter(query.data?.next ?? undefined)}>
          Visa fler
        </Button>
      ) : null}
      {after ? (
        <Button variant="ghost" onClick={() => setAfter(undefined)}>
          Tillbaka
        </Button>
      ) : null}
    </Box>
  );
}
