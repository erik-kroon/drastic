import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { defaultStringifySearch } from "@tanstack/react-router";
import * as Recurring from "@open-erp/contracts/recurring-invoices";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { Link } from "@open-erp/ui/components/link";
import { PageEmpty, PageCaption } from "@open-erp/ui/components/accounting-page";
import { RecordSection } from "@open-erp/ui/components/record-layout";
import { Text } from "@open-erp/ui/components/typography";
import { AccountingStatus } from "@/components/accounting-status";
import { readAccounting } from "@/lib/accounting-api";
import { workspacePath } from "@/lib/book-context";
import { checkScope, commerceKey, commercePath, type CommerceProps } from "./shared";
import { RecurringAgreementControls } from "./recurring-agreement-controls";
import { RecurringDraftRecovery } from "./recurring-draft-recovery";

type Props = CommerceProps & {
  agreementId: string;
  cycleOrdinal?: string;
  jobId?: string;
  work?: string;
  returnTo?: string;
};

export function RecurringDetail(props: Props) {
  const { book, locale, agreementId, cycleOrdinal } = props;
  const { work, returnTo } = props;
  const sv = locale === "sv";
  const path = `${commercePath(book)}/recurring-invoices/${encodeURIComponent(agreementId)}`;
  const sales = `${workspacePath(book)}/sales`;

  const occurrences = useInfiniteQuery({
    queryKey: [...commerceKey(book), "recurring-occurrences", agreementId],
    initialPageParam: "",
    queryFn: async ({ pageParam, signal }) => {
      const query = new URLSearchParams();

      if (pageParam) query.set("after", pageParam);

      const result = await readAccounting(
        `${path}/occurrences?${query}`,
        Recurring.RecurringOccurrenceList,
        { signal },
      );

      checkScope(book, result.scope);

      if (result.agreementId !== agreementId)
        throw new Error("Recurring occurrence agreement mismatch");

      return result;
    },
    getNextPageParam: (page) => page.continuation ?? undefined,
    retry: false,
  });

  const occurrence = useQuery({
    queryKey: [...commerceKey(book), "recurring-occurrence", agreementId, cycleOrdinal],
    enabled: cycleOrdinal !== undefined,
    queryFn: async ({ signal }) => {
      const result = await readAccounting(
        `${path}/occurrences/${encodeURIComponent(cycleOrdinal ?? "")}`,
        Recurring.RecurringOccurrenceView,
        { signal },
      );

      checkScope(book, result.occurrence.scope);

      if (
        result.occurrence.agreementId !== agreementId ||
        result.occurrence.cycleOrdinal !== cycleOrdinal
      )
        throw new Error("Recurring occurrence identity mismatch");

      for (const coverage of result.coverage) {
        checkScope(book, coverage.scope);

        if (
          coverage.agreementId !== agreementId ||
          coverage.occurrenceId !== result.occurrence.id ||
          coverage.draftId !== result.occurrence.draftId
        )
          throw new Error("Recurring coverage identity mismatch");
      }

      return result;
    },
    retry: false,
  });

  const items = occurrences.data?.pages.flatMap((page) => page.items) ?? [];
  const selected = occurrence.isError ? undefined : occurrence.data;
  const yesNo = (value: boolean) => (value ? (sv ? "Ja" : "Yes") : sv ? "Nej" : "No");

  return (
    <Box display="grid" gap="xl" minWidth="zero">
      <Link href={`${sales}${defaultStringifySearch({ view: "recurring", work, returnTo })}`}>
        {sv ? "Alla återkommande avtal" : "All recurring agreements"}
      </Link>
      <RecurringDraftRecovery {...props} />
      <RecurringAgreementControls {...props} />
      <RecordSection title={sv ? "Fakturacykler" : "Invoice cycles"}>
        <PageCaption>
          {sv
            ? "Förberedelse, godkännande och utfärdande är sparad historik. Granska fakturan för aktuell giltighet. Ingen av dessa uppgifter bevisar leverans."
            : "Preparation, approval and issuance are saved history. Review the invoice for current validity. None of these facts proves delivery."}
        </PageCaption>
        <Button
          variant="outline"
          disabled={occurrences.isFetching}
          onClick={() => void occurrences.refetch()}
        >
          {sv ? "Uppdatera fakturacykler" : "Refresh invoice cycles"}
        </Button>
        <AccountingStatus
          locale={locale}
          pending={occurrences.isPending}
          error={occurrences.error}
        />
        {occurrences.isSuccess && items.length === 0 ? (
          <PageEmpty
            title={sv ? "Inga skapade fakturacykler" : "No materialized invoice cycles"}
            detail={
              sv
                ? "Schemaläggning skapar utkast för separat granskning."
                : "Scheduling creates drafts for separate review."
            }
          />
        ) : null}
        {items.map((item) => (
          <Box key={item.occurrenceId} display="grid" gap="sm">
            <Link
              href={`${sales}${defaultStringifySearch({ view: "recurring", record: agreementId, cycle: item.cycleOrdinal, work, returnTo })}`}
            >
              {sv ? "Fakturacykel" : "Invoice cycle"} {item.cycleOrdinal}, {item.cycleDate}
            </Link>
            <Text>
              {item.serviceInterval.serviceStartsOn} – {item.serviceInterval.serviceEndsOn}
            </Text>
            <Text>
              {sv ? "Förberedd" : "Prepared"}: {yesNo(item.prepared)}
            </Text>
            <Text>
              {sv ? "Godkänd" : "Approved"}: {yesNo(item.approved)}
            </Text>
            <Text>
              {sv ? "Utfärdad" : "Issued"}: {yesNo(item.issued)}
            </Text>
            {item.documentNumber ? (
              <Text>
                {sv ? "Fakturanummer" : "Invoice number"}: {item.documentNumber}
              </Text>
            ) : null}
          </Box>
        ))}
        {occurrences.hasNextPage ? (
          <Button
            variant="outline"
            disabled={occurrences.isFetchingNextPage}
            onClick={() => void occurrences.fetchNextPage()}
          >
            {sv ? "Fler fakturacykler" : "More invoice cycles"}
          </Button>
        ) : null}
      </RecordSection>
      {cycleOrdinal !== undefined ? (
        <RecordSection title={sv ? "Vald fakturacykel" : "Selected invoice cycle"}>
          <AccountingStatus
            locale={locale}
            pending={occurrence.isPending}
            error={occurrence.error}
          />
          {selected ? (
            <>
              <Text>
                {selected.occurrence.serviceInterval.serviceStartsOn} –{" "}
                {selected.occurrence.serviceInterval.serviceEndsOn}
              </Text>
              <Link
                href={`${sales}${defaultStringifySearch({ view: "drafts", record: selected.occurrence.draftId, work, returnTo })}`}
              >
                {sv ? "Öppna cykelns faktura" : "Open the cycle invoice"}
              </Link>
              {selected.coverage.length === 0 ? (
                <Text>
                  {sv
                    ? "Ingen fakturerad täckning för denna cykel."
                    : "No billed coverage for this cycle."}
                </Text>
              ) : null}
              {selected.coverage.map((coverage) => (
                <Box key={coverage.id} display="grid" gap="sm">
                  <Text>
                    {coverage.chargeComponentKey}, {coverage.documentNumber}
                  </Text>
                  <Link
                    href={`${sales}${defaultStringifySearch({ record: coverage.registerInvoiceId, kind: "invoice", stage: "payments", work, returnTo })}`}
                  >
                    {sv ? "Granska fakturans betalningar" : "Review invoice payments"}
                  </Link>
                </Box>
              ))}
            </>
          ) : (
            <Button
              variant="outline"
              disabled={occurrence.isFetching}
              onClick={() => void occurrence.refetch()}
            >
              {sv ? "Försök läsa cykeln igen" : "Retry reading the cycle"}
            </Button>
          )}
        </RecordSection>
      ) : null}
    </Box>
  );
}
