import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type * as Accounting from "@open-erp/contracts/accounting";
import * as Rates from "@open-erp/contracts/exchange-rates";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { Text } from "@open-erp/ui/components/typography";
import { ArrowLeft, Plus } from "lucide-react";
import { DataTable } from "@open-erp/ui/components/data-table";
import { FormDialog } from "@open-erp/ui/components/form-dialog";
import { RecordHeading, RecordSection } from "@open-erp/ui/components/record-layout";
import { PageCaption, PageEmpty, RecordOpen } from "@open-erp/ui/components/accounting-page";
import { Disclosure } from "@open-erp/ui/components/workflow";
import { formatMinorAmount } from "@/lib/workspace-api";
import { AccountingStatus } from "@/components/accounting-status";
import { ScheduleEvidence } from "@/components/subledgers/schedule-evidence";
import { bookKey, bookPath, readAccounting } from "@/lib/accounting-api";
import type { Locale } from "@/paraglide/runtime";
import { exchangeRateCopy } from "./copy";
import { RateForm } from "./forms";
import { ConversionInspector, RateInspector, RateUsabilityStatus } from "./views";

type Props = { book: typeof Accounting.Book.Type; locale: Locale };
export function ExchangeRateReviewsPanel(props: Props) {
  return <Panel key={JSON.stringify(bookKey(props.book))} {...props} />;
}
function Panel({ book, locale }: Props) {
  const copy = exchangeRateCopy(locale);
  const labels = locale === "sv" ? swedish : english;
  const client = useQueryClient();
  const [selectedRate, setSelectedRate] = useState<string | null>(null);
  const [selectedReview, setSelectedReview] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const rates = useQuery({
    queryKey: [...bookKey(book), "exchange-rates", "rates"],
    queryFn: async ({ signal }) => {
      const result = await readAccounting(
        `${bookPath(book)}/exchange-rates`,
        Rates.ExchangeRateList,
        { signal },
      );
      if (
        result.scope.bookId !== book.id ||
        result.scope.entityId !== book.entityId ||
        result.items.some(
          (rate) => rate.scope.bookId !== book.id || rate.scope.entityId !== book.entityId,
        )
      ) {
        throw new Error("Exchange-rate inventory scope mismatch");
      }
      if (
        result.statuses &&
        (result.statuses.length !== result.items.length ||
          new Set(result.statuses.map((status) => status.observationId)).size !==
            result.statuses.length)
      ) {
        throw new Error("Exchange-rate status inventory mismatch");
      }
      for (const status of result.statuses ?? []) {
        const rate = result.items.find((item) => item.observationId === status.observationId);
        const withdrawal = status.usability.withdrawal;
        if (
          !rate ||
          (withdrawal &&
            (withdrawal.observationId !== rate.observationId ||
              withdrawal.revisionDigest !== rate.digest ||
              withdrawal.scope.bookId !== book.id ||
              withdrawal.scope.entityId !== book.entityId))
        ) {
          throw new Error("Exchange-rate withdrawal inventory mismatch");
        }
      }
      return result;
    },
    retry: false,
  });
  const reviews = useQuery({
    queryKey: [...bookKey(book), "exchange-rates", "reviews"],
    queryFn: async ({ signal }) => {
      const result = await readAccounting(
        `${bookPath(book)}/exchange-rates/reviews`,
        Rates.ConversionReviewList,
        { signal },
      );
      if (result.scope.bookId !== book.id || result.scope.entityId !== book.entityId)
        throw new Error("Conversion inventory scope mismatch");
      return result;
    },
    retry: false,
  });
  const rateSaved = (id: string) => {
    setSelectedRate(id);
    setCreating(false);
    void client.invalidateQueries({ queryKey: [...bookKey(book), "exchange-rates"] });
  };
  const conversionSaved = (id: string) => {
    setSelectedReview(id);
    setSelectedRate(null);
    void client.invalidateQueries({ queryKey: [...bookKey(book), "exchange-rates", "reviews"] });
  };
  if (selectedRate || selectedReview)
    return (
      <Box display="grid" gap="xl">
        <Box>
          <Button
            variant="ghost"
            onClick={() => {
              setSelectedRate(null);
              setSelectedReview(null);
            }}
          >
            <ArrowLeft size={14} />
            {labels.back}
          </Button>
        </Box>
        {selectedRate ? (
          <RateInspector
            book={book}
            locale={locale}
            id={selectedRate}
            onRateSaved={rateSaved}
            onConversionSaved={conversionSaved}
          />
        ) : null}
        {selectedReview ? (
          <ConversionInspector
            key={selectedReview}
            book={book}
            locale={locale}
            id={selectedReview}
          />
        ) : null}
      </Box>
    );
  return (
    <Box display="grid" gap="xl" minWidth="zero">
      <RecordHeading
        title={labels.title}
        subtitle={labels.intro}
        action={
          book.role === "operator" ? (
            <Button onClick={() => setCreating(true)}>
              <Plus size={14} />
              {labels.add}
            </Button>
          ) : undefined
        }
      />
      <RecordSection title={copy.rates}>
        <AccountingStatus locale={locale} pending={rates.isPending} error={rates.error} />
        {rates.isSuccess && !rates.data.items.length ? (
          <PageEmpty title={labels.empty} detail={labels.emptyDetail} />
        ) : null}
        {rates.isSuccess && rates.data.items.length ? (
          <DataTable
            title={copy.rates}
            columns={[
              { id: "pair", label: labels.currencies },
              { id: "date", label: copy.effectiveOn },
              { id: "rate", label: labels.rate, numeric: true },
              { id: "revision", label: copy.revision, numeric: true },
              { id: "status", label: "Status" },
            ]}
            rows={rates.data.items.map((rate) => ({
              id: rate.observationId,
              cells: [
                <RecordOpen key="open" onClick={() => setSelectedRate(rate.observationId)}>
                  {rate.terms.fromCurrency} → {rate.terms.toCurrency}
                </RecordOpen>,
                rate.terms.effectiveOn,
                `${rate.terms.rateNumerator} / ${rate.terms.rateDenominator}`,
                rate.revision,
                <RateUsabilityStatus
                  key="status"
                  usability={
                    rates.data.statuses?.find(
                      (status) => status.observationId === rate.observationId,
                    )?.usability
                  }
                  known={rates.data.statuses !== undefined}
                  locale={locale}
                />,
              ],
            }))}
          />
        ) : null}
      </RecordSection>
      <RecordSection title={copy.reviews}>
        <AccountingStatus locale={locale} pending={reviews.isPending} error={reviews.error} />
        {reviews.isSuccess && !reviews.data.items.length ? (
          <PageCaption>{labels.conversionsHelp}</PageCaption>
        ) : null}
        {reviews.isSuccess && reviews.data.items.length ? (
          <DataTable
            title={copy.reviews}
            columns={[
              { id: "date", label: labels.date },
              {
                id: "source",
                label: labels.original,
                numeric: true,
              },
              {
                id: "result",
                label: labels.converted,
                numeric: true,
              },
            ]}
            rows={reviews.data.items.map((review) => ({
              id: review.id,
              cells: [
                <RecordOpen key="open" onClick={() => setSelectedReview(review.id)}>
                  {review.conversionDate}
                </RecordOpen>,
                `${formatMinorAmount(review.originalMinor, review.sourceScale, locale)} ${review.fromCurrency}`,
                `${formatMinorAmount(review.roundedMinor, review.bookScale, locale)} ${review.bookCurrency}`,
              ],
            }))}
          />
        ) : null}
      </RecordSection>
      <Box>
        <Button
          variant="ghost"
          disabled={rates.isFetching || reviews.isFetching}
          onClick={() => {
            void rates.refetch();
            void reviews.refetch();
          }}
        >
          {copy.refresh}
        </Button>
      </Box>
      <Disclosure title={labels.scope}>
        <Box display="grid" gap="md">
          <Text>{copy.warning}</Text>
          <Text>{copy.policyHelp}</Text>
        </Box>
      </Disclosure>
      {creating ? (
        <FormDialog
          size="compact"
          title={labels.add}
          closeLabel={labels.close}
          onClose={() => setCreating(false)}
        >
          <Box display="grid" gap="lg">
            <RateForm book={book} locale={locale} onSaved={rateSaved} />
            <ScheduleEvidence book={book} locale={locale} />
          </Box>
        </FormDialog>
      ) : null}
    </Box>
  );
}

const english = {
  back: "All rates and conversions",
  title: "Exchange rates",
  intro: "Reviewed rates and saved conversions.",
  add: "Add rate",
  empty: "No saved rates",
  emptyDetail: "Add a rate and its source to prepare a conversion.",
  currencies: "Currencies",
  rate: "Exact rate",
  conversionsHelp: "Saved conversions appear here after you review a rate.",
  date: "Date",
  original: "Original amount",
  converted: "Converted amount",
  scope: "Scope and calculation rules",
  close: "Close",
};
const swedish: typeof english = {
  back: "Alla kurser och omräkningar",
  title: "Valutakurser",
  intro: "Granskade kurser och sparade omräkningar.",
  add: "Lägg till kurs",
  empty: "Inga sparade kurser",
  emptyDetail: "Lägg till en kurs och dess källa för att förbereda en omräkning.",
  currencies: "Valutor",
  rate: "Exakt kurs",
  conversionsHelp: "Sparade omräkningar visas här när du har granskat en kurs.",
  date: "Datum",
  original: "Ursprungligt belopp",
  converted: "Omräknat belopp",
  scope: "Omfattning och beräkningsregler",
  close: "Stäng",
};
