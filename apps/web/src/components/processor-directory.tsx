import { Api } from "@open-erp/contracts/api";
import { bookScope, httpQuery } from "@/lib/contract-client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import * as Processor from "@open-erp/contracts/processor-clearing";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { Link } from "@open-erp/ui/components/link";
import { AccountingStatus } from "./accounting-status";
import { checkScope } from "./commerce/shared";
import { bookKey, readAccounting } from "@/lib/accounting-api";
import { useBookWorkspace, workspacePath } from "@/lib/book-context";

export function ProcessorDirectory({ accountId }: { accountId?: string }) {
  const { book, locale, setup } = useBookWorkspace();
  const [after, setAfter] = useState<string>();

  const query = useQuery({
    queryKey: [...bookKey(book), "processors-directory", accountId, after],
    retry: false,
    queryFn: async ({ signal }) => {
      const cursor = after ? `?after=${encodeURIComponent(after)}` : "";
      const href = `${workspacePath(book)}/accounts?view=processors`;

      if (accountId) {
        const page = await readAccounting(
          (client) =>
            client.processorClearing.listProcessorReviews({
              params: { ...bookScope(book), id: accountId },
              query: httpQuery(Api.groups.processorClearing.endpoints.listProcessorReviews, cursor),
            }),
          Processor.ReviewPage,
          { signal },
        );

        checkScope(book, page.scope);

        if (
          page.accountId !== accountId ||
          page.items.some((item) => item.input.accountId !== accountId)
        )
          throw new Error("Processor directory identity mismatch");

        return {
          next: page.next,
          items: page.items
            .filter((item) => item.input.kind === "bank_receipt")
            .map((item) => {
              checkScope(book, item.scope);

              return {
                id: item.id,
                label: `Utbetalning ${item.input.date}`,
                href: `${href}&account=${encodeURIComponent(accountId)}&record=${encodeURIComponent(item.id)}`,
              };
            }),
        };
      }

      const page = await readAccounting(
        (client) =>
          client.processorClearing.listProcessorAccounts({
            params: bookScope(book),
            query: httpQuery(Api.groups.processorClearing.endpoints.listProcessorAccounts, cursor),
          }),
        Processor.AccountPage,
        { signal },
      );

      checkScope(book, page.scope);

      return {
        next: page.next,
        items: page.items.map((item) => {
          const account = setup.accounts.find(
            (candidate) => candidate.id === item.processorControlAccountId,
          );

          return {
            id: item.id,
            label: account ? `${account.code} ${account.name}` : item.id,
            href: `${href}&account=${encodeURIComponent(item.id)}`,
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
