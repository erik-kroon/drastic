import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import * as Collections from "@open-erp/contracts/collections";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { Link } from "@open-erp/ui/components/link";
import { Text } from "@open-erp/ui/components/typography";
import { AccountingStatus } from "@/components/accounting-status";
import { readAccounting } from "@/lib/accounting-api";
import { useBookWorkspace, workspacePath } from "@/lib/book-context";
import { checkScope, commerceKey, commercePath } from "./shared";

export function ReminderHistoryWorkspace({ invoiceId }: { invoiceId: string }) {
  const { book, locale } = useBookWorkspace();
  const [after, setAfter] = useState<string | null>(null);

  const history = useQuery({
    queryKey: [...commerceKey(book), "reminder-history", invoiceId, after],
    retry: false,
    queryFn: async ({ signal }) => {
      const query = new URLSearchParams({ invoiceId });

      if (after) query.set("after", after);

      const page = await readAccounting(
        `${commercePath(book)}/collections/reminders?${query.toString()}`,
        Collections.ReminderHistoryPage,
        { signal },
      );

      checkScope(book, page.scope);

      if (page.invoiceId !== invoiceId) throw new Error("Reminder history identity mismatch.");

      return page;
    },
  });

  return (
    <Box display="grid" gap="md">
      <Link
        href={`${workspacePath(book)}/sales?view=invoices&record=${encodeURIComponent(invoiceId)}&kind=invoice`}
      >
        Till fakturan
      </Link>
      <AccountingStatus locale={locale} pending={history.isPending} error={history.error} />
      {!history.isError
        ? history.data?.items.map((message) => (
            <Link
              key={message.id}
              href={`${workspacePath(book)}/sales?view=collections&reminder=${encodeURIComponent(message.id)}`}
            >
              {message.invoiceNumber}, påminnelse {message.preparedAt}
            </Link>
          ))
        : null}
      {history.data?.items.length === 0 && !history.isError ? (
        <Text>Ingen sparad påminnelse.</Text>
      ) : null}
      {history.data?.next && !history.isError ? (
        <Button variant="outline" onClick={() => setAfter(history.data?.next ?? null)}>
          Nästa
        </Button>
      ) : null}
      {history.isError ? (
        <Button
          variant="outline"
          onClick={() => {
            void history.refetch();
          }}
        >
          Försök igen
        </Button>
      ) : null}
    </Box>
  );
}
