import { useQuery } from "@tanstack/react-query";
import * as Historical from "@open-erp/contracts/historical-migration";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { Text } from "@open-erp/ui/components/typography";
import { AccountingStatus } from "@/components/accounting-status";
import { useBookWorkspace } from "@/lib/book-context";
import { bookKey, bookPath, readAccounting } from "@/lib/accounting-api";
import { checkScope } from "@/components/commerce/shared";

export function ClosingComparison({
  sourceRunId,
  planId,
}: {
  sourceRunId: string;
  planId: string;
}) {
  const { book, locale } = useBookWorkspace();
  const sv = locale === "sv";
  const comparison = useQuery({
    queryKey: [...bookKey(book), "sie-closing", sourceRunId],
    retry: false,
    queryFn: async ({ signal }) => {
      const result = await readAccounting(
        `${bookPath(book)}/sie-runs/${encodeURIComponent(sourceRunId)}/closing-comparison`,
        Historical.ClosingComparison,
        { signal },
      );
      checkScope(book, result.scope);
      if (result.sourceRunId !== sourceRunId || result.sourcePlanId !== planId)
        throw new Error("Closing comparison identity mismatch");
      return result;
    },
  });
  return (
    <Box display="grid" gap="sm">
      <Text>
        {sv ? "Avstämning mot källans utgående saldon" : "Compare source closing balances"}
      </Text>
      <AccountingStatus locale={locale} pending={comparison.isPending} error={comparison.error} />
      {comparison.data ? (
        <>
          <Text>
            {comparison.data.postingComplete && comparison.data.balanced
              ? sv
                ? "Bokförda saldon stämmer med de granskade källkontrollerna."
                : "Posted balances match the reviewed source controls."
              : sv
                ? "Importen eller saldoavstämningen är inte klar."
                : "The import or balance comparison is incomplete."}
          </Text>
          <Text>
            {sv ? "Till och med" : "Through"} {comparison.data.asOf} ·{" "}
            {sv ? "Bokföringsversion" : "Ledger sequence"} {comparison.data.bookSequence}
          </Text>
          {comparison.data.items.map((item) => (
            <Box key={item.accountId} display="grid" gap="sm">
              <Text>
                {item.code} · {sv ? "Källa" : "Source"}: {item.expectedMinor} ·{" "}
                {sv ? "Bokfört" : "Ledger"}: {item.actualMinor} · {sv ? "Skillnad" : "Difference"}:{" "}
                {item.differenceMinor}
              </Text>
            </Box>
          ))}
          <Text>
            {sv
              ? `Beloppen anges i minsta valutaenhet (${book.currency}). Jämförelsen verifierar saldon, inte fullständighet i underlag eller skattebehandling.`
              : `Amounts are in minor units (${book.currency}). This compares balances; it does not establish source completeness or tax treatment.`}
          </Text>
        </>
      ) : null}
      <Box>
        <Button
          variant="outline"
          disabled={comparison.isFetching}
          onClick={() => {
            void comparison.refetch();
          }}
        >
          {sv ? "Jämför aktuella saldon" : "Compare current balances"}
        </Button>
      </Box>
    </Box>
  );
}
