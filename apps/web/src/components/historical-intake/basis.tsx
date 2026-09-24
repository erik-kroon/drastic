import { FinancialImport } from "./financial";
import { RefreshOpening } from "./refresh-opening";
import { SelectHistoricalBasis } from "./select-basis";
import * as Sie from "@open-erp/contracts/sie-import";
import { useQuery } from "@tanstack/react-query";
import * as Historical from "@open-erp/contracts/historical-migration";
import { Box } from "@open-erp/ui/components/box";
import { Text } from "@open-erp/ui/components/typography";
import { Button } from "@open-erp/ui/components/button";
import { AccountingStatus } from "@/components/accounting-status";
import { reviewPath, useBookWorkspace } from "@/lib/book-context";
import { bookKey, bookPath, readAccounting } from "@/lib/accounting-api";
import { checkScope } from "@/components/commerce/shared";

export function HistoricalBases({
  plan,
  staged,
  sourceRunId,
}: {
  plan: typeof Sie.SiePlan.Type;
  staged: boolean;
  sourceRunId: string;
}) {
  const { book, locale } = useBookWorkspace();
  const sv = locale === "sv";
  const query = useQuery({
    queryKey: [...bookKey(book), "historical-bases"],
    retry: false,
    queryFn: async ({ signal }) => {
      const result = await readAccounting(
        `${bookPath(book)}/historical-bases`,
        Historical.BasisInventory,
        { signal },
      );
      checkScope(book, result.scope);
      return result;
    },
  });
  return (
    <Box display="grid" gap="sm">
      <Text>{sv ? "Historik per räkenskapsår" : "Historical basis by fiscal year"}</Text>
      <AccountingStatus locale={locale} pending={query.isPending} error={query.error} />
      {query.data?.years.length === 0 ? (
        <Text>
          {sv
            ? "Inga räkenskapsår har skapats. Slutför kontoplan och perioder före historikval."
            : "No fiscal years have been created. Set up the chart and periods before choosing a historical basis."}
        </Text>
      ) : null}
      {query.data?.years.map((year) => (
        <Box key={year.id} display="grid" gap="sm">
          <Text>
            {year.startsOn} – {year.endsOn}
          </Text>
          <Text>
            {year.basis
              ? year.basis.mode === "full_history"
                ? sv
                  ? "Fullständig historik vald"
                  : "Full history selected"
                : sv
                  ? "Ingående saldon valda"
                  : "Opening balances selected"
              : sv
                ? "Historikval saknas"
                : "Historical basis not selected"}
          </Text>
          {year.basis ? (
            <>
              <Text>
                {sv ? "Övergångsdatum" : "Cutover date"}: {year.basis.cutoverOn}
              </Text>
              <Text>{year.basis.rationale}</Text>
              {year.basis.mode === "opening_set" &&
              year.basis.changeSetId &&
              !year.basis.voucherId ? (
                <>
                  <a href={reviewPath(book, year.basis.changeSetId)}>
                    {sv ? "Granska och bokför ingående saldon" : "Review and post opening balances"}
                  </a>
                  <RefreshOpening
                    key={year.basis.changeSetId}
                    basis={year.basis}
                    onSaved={() => {
                      void query.refetch();
                    }}
                  />
                </>
              ) : null}
              {year.basis.mode === "opening_set" ? (
                <Text>
                  {year.basis.voucherId
                    ? sv
                      ? "Ingående saldon bokförda"
                      : "Opening balances posted"
                    : sv
                      ? "Ingående saldon väntar på bokföring"
                      : "Opening balances await posting"}
                </Text>
              ) : null}
            </>
          ) : null}
          {year.basis?.mode === "full_history" && year.basis.sourcePlanId === plan.id ? (
            <FinancialImport sourceRunId={sourceRunId} plan={plan} yearId={year.id} />
          ) : null}
          {!year.basis && staged ? (
            <>
              <SelectHistoricalBasis
                mode="full_history"
                plan={plan}
                year={year}
                onSaved={() => {
                  void query.refetch();
                }}
              />
              <SelectHistoricalBasis
                mode="opening_set"
                plan={plan}
                year={year}
                onSaved={() => {
                  void query.refetch();
                }}
              />
            </>
          ) : null}
        </Box>
      ))}
      <Box>
        <Button
          variant="outline"
          disabled={query.isFetching}
          onClick={() => {
            void query.refetch();
          }}
        >
          {sv ? "Läs in historikval" : "Refresh historical bases"}
        </Button>
      </Box>
    </Box>
  );
}
