import { useQuery } from "@tanstack/react-query";
import { BankStatementView } from "@open-erp/contracts/reconciliation";
import { Box } from "@open-erp/ui/components/box";
import { Text } from "@open-erp/ui/components/typography";
import { bookKey, bookPath, readAccounting } from "@/lib/accounting-api";
import type { CommerceProps } from "@/components/commerce/shared";

export function BankReviewContext({
  book,
  locale,
  statementId,
}: CommerceProps & { statementId?: string }) {
  const statement = useQuery({
    queryKey: [...bookKey(book), "bank-review-context", statementId],
    enabled: !!statementId,
    retry: false,
    queryFn: async ({ signal }) => {
      if (!statementId) throw new Error("Bank review statement is missing");

      const view = await readAccounting(
        `${bookPath(book)}/bank-statements/${encodeURIComponent(statementId)}`,
        BankStatementView,
        { signal },
      );

      if (view.statement.id !== statementId)
        throw new Error("Bank review statement identity mismatch");

      return view.statement;
    },
  });

  return (
    <Box display="flex" gap="lg" alignItems="center">
      {statement.data ? (
        <Text variant="control" tone="muted">
          {locale === "sv" ? "Exempeldata" : "Example data"}
        </Text>
      ) : null}
      <Text variant="control" tone="muted">
        {book.name}
      </Text>
    </Box>
  );
}
