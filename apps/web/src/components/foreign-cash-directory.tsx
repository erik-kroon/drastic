import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import * as Cash from "@open-erp/contracts/foreign-cash";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { Link } from "@open-erp/ui/components/link";
import { AccountingStatus } from "./accounting-status";
import { checkScope } from "./commerce/shared";
import { bookKey, bookPath, readAccounting } from "@/lib/accounting-api";
import { useBookWorkspace, workspacePath } from "@/lib/book-context";

export function ForeignCashDirectory({ accountId }: { accountId?: string }) {
  const { book, locale, setup } = useBookWorkspace();
  const [after, setAfter] = useState<string>();

  const query = useQuery({
    queryKey: [...bookKey(book), "foreign-cash-directory", accountId, after],
    retry: false,
    queryFn: async ({ signal }) => {
      const base = `${bookPath(book)}/banking/foreign-cash/accounts`;
      const cursor = after ? `?after=${encodeURIComponent(after)}` : "";
      const href = `${workspacePath(book)}/accounts?view=foreign-cash`;

      if (accountId) {
        const page = await readAccounting(
          `${base}/${encodeURIComponent(accountId)}/reviews${cursor}`,
          Cash.ReviewPage,
          { signal },
        );

        checkScope(book, page.scope);

        if (
          page.accountId !== accountId ||
          page.items.some((item) => item.input.accountId !== accountId)
        )
          throw new Error("Foreign cash directory identity mismatch");

        return {
          next: page.next,
          items: page.items
            .filter((item) => item.input.kind === "exchange")
            .map((item) => {
              checkScope(book, item.scope);

              return {
                id: item.id,
                label: `Växla till ${item.bookCurrency}, ${item.input.date}`,
                href: `${href}&account=${encodeURIComponent(accountId)}&record=${encodeURIComponent(item.id)}`,
              };
            }),
        };
      }

      const page = await readAccounting(`${base}${cursor}`, Cash.HoldingPage, { signal });

      checkScope(book, page.scope);

      return {
        next: page.next,
        items: page.items.map((item) => {
          const account = setup.accounts.find((candidate) => candidate.id === item.accountId);

          return {
            id: item.accountId,
            label: account ? `${account.code} ${account.name}` : item.accountId,
            href: `${href}&account=${encodeURIComponent(item.accountId)}`,
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
      ) : (
        query.data?.items.map((item) => (
          <Link key={item.id} href={item.href}>
            {item.label}
          </Link>
        ))
      )}
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
