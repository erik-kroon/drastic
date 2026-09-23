import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type * as Accounting from "@open-erp/contracts/accounting";
import * as Rates from "@open-erp/contracts/exchange-rates";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { Heading, Text } from "@open-erp/ui/components/typography";
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
  const client = useQueryClient();
  const [selectedRate, setSelectedRate] = useState<string | null>(null);
  const [selectedReview, setSelectedReview] = useState<string | null>(null);
  const [createVersion, setCreateVersion] = useState(0);
  const rates = useQuery({
    queryKey: [...bookKey(book), "exchange-rates", "rates"],
    queryFn: async ({ signal }) => {
      const result = await readAccounting(`${bookPath(book)}/exchange-rates`, Rates.ExchangeRateList, { signal });
      if (result.scope.bookId !== book.id || result.scope.entityId !== book.entityId || result.items.some((rate) => rate.scope.bookId !== book.id || rate.scope.entityId !== book.entityId)) {
        throw new Error("Exchange-rate inventory scope mismatch");
      }
      if (result.statuses && (result.statuses.length !== result.items.length
        || new Set(result.statuses.map((status) => status.observationId)).size !== result.statuses.length)) {
        throw new Error("Exchange-rate status inventory mismatch");
      }
      for (const status of result.statuses ?? []) {
        const rate = result.items.find((item) => item.observationId === status.observationId);
        const withdrawal = status.usability.withdrawal;
        if (!rate || (withdrawal && (withdrawal.observationId !== rate.observationId || withdrawal.revisionDigest !== rate.digest
          || withdrawal.scope.bookId !== book.id || withdrawal.scope.entityId !== book.entityId))) {
          throw new Error("Exchange-rate withdrawal inventory mismatch");
        }
      }
      return result;
    }, retry: false,
  });
  const reviews = useQuery({
    queryKey: [...bookKey(book), "exchange-rates", "reviews"],
    queryFn: async ({ signal }) => {
      const result = await readAccounting(`${bookPath(book)}/exchange-rates/reviews`, Rates.ConversionReviewList, { signal });
      if (result.scope.bookId !== book.id || result.scope.entityId !== book.entityId) throw new Error("Conversion inventory scope mismatch");
      return result;
    }, retry: false,
  });
  const rateSaved = (id: string) => {
    setSelectedRate(id);
    void client.invalidateQueries({ queryKey: [...bookKey(book), "exchange-rates"] });
  };
  const conversionSaved = (id: string) => {
    setSelectedReview(id);
    void client.invalidateQueries({ queryKey: [...bookKey(book), "exchange-rates", "reviews"] });
  };
  return <Box display="grid" gap="2xl" minWidth="zero">
    <Heading>{copy.title}</Heading><Text>{copy.warning}</Text><Text>{copy.policyHelp}</Text>
    <ScheduleEvidence book={book} locale={locale} />
    {book.role === "operator" ? <details><summary>{copy.create}</summary><Box display="grid" gap="lg" paddingBlock="lg">
      <RateForm key={createVersion} book={book} locale={locale} onSaved={rateSaved} onNew={() => setCreateVersion((value) => value + 1)} />
    </Box></details> : <Text>{copy.operator}</Text>}
    <Button variant="outline" disabled={rates.isFetching || reviews.isFetching} onClick={() => { void rates.refetch(); void reviews.refetch(); }}>{copy.refresh}</Button>
    <Heading>{copy.rates}</Heading><AccountingStatus locale={locale} pending={rates.isPending} error={rates.error} />
    {rates.data?.items.length === 0 ? <Text>{copy.empty}</Text> : null}
    {rates.data?.items.map((rate) => <Box key={rate.observationId} display="grid" gap="sm" minWidth="zero">
      <Text>{rate.sourceKey} · {rate.observationId} · {copy.revision}: {rate.revision}</Text>
      <Text>{rate.terms.fromCurrency} → {rate.terms.toCurrency} · {rate.terms.effectiveOn} · {rate.terms.rateNumerator}/{rate.terms.rateDenominator}</Text>
      <RateUsabilityStatus locale={locale} usability={rates.data?.statuses?.find((status) => status.observationId === rate.observationId)?.usability}
        known={rates.isSuccess && rates.fetchStatus === "idle" && rates.isFetchedAfterMount} />
      <Button variant="outline" onClick={() => setSelectedRate(rate.observationId)}>{copy.open} · {rate.sourceKey}</Button>
    </Box>)}
    {selectedRate ? <RateInspector book={book} locale={locale} id={selectedRate} onRateSaved={rateSaved} onConversionSaved={conversionSaved} /> : null}
    <Heading>{copy.reviews}</Heading><AccountingStatus locale={locale} pending={reviews.isPending} error={reviews.error} />
    {reviews.data?.items.length === 0 ? <Text>{copy.empty}</Text> : null}
    {reviews.data?.items.map((review) => <Box key={review.id} display="grid" gap="sm" minWidth="zero">
      <Text>{review.id} · {review.conversionDate} · {review.originalMinor} {review.fromCurrency} ({review.sourceScale}) → {review.roundedMinor} {review.bookCurrency} ({review.bookScale})</Text>
      <Button variant="outline" onClick={() => setSelectedReview(review.id)}>{copy.open} · {review.id}</Button>
    </Box>)}
    {selectedReview ? <ConversionInspector key={selectedReview} book={book} locale={locale} id={selectedReview} /> : null}
  </Box>;
}
