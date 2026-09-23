import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import * as Schema from "effect/Schema";
import type * as Accounting from "@open-erp/contracts/accounting";
import * as Rates from "@open-erp/contracts/exchange-rates";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { Heading, Text } from "@open-erp/ui/components/typography";
import { AccountingStatus } from "@/components/accounting-status";
import { EvidenceInspector } from "@/components/evidence-inspector";
import { bookKey, bookPath, readAccounting } from "@/lib/accounting-api";
import type { Locale } from "@/paraglide/runtime";
import { exchangeRateCopy } from "./copy";
import { ConversionForm, RateForm } from "./forms";

type Props = { book: typeof Accounting.Book.Type; locale: Locale; id: string };
export function RateInspector({ book, locale, id, onRateSaved, onConversionSaved }: Props & {
  onRateSaved: (id: string) => void; onConversionSaved: (id: string) => void;
}) {
  const copy = exchangeRateCopy(locale);
  const [conversionRate, setConversionRate] = useState<typeof Rates.ExchangeRateRevision.Type | null>(null);
  const [editingRate, setEditingRate] = useState<typeof Rates.ExchangeRateRevision.Type | null>(null);
  const saved = useQuery({
    queryKey: [...bookKey(book), "exchange-rates", "rate", id],
    queryFn: async ({ signal }) => {
      const result = await readAccounting(`${bookPath(book)}/exchange-rates/${encodeURIComponent(id)}`, Rates.ExchangeRateView, { signal });
      if ([result.current, ...result.revisions].some((rate) => rate.observationId !== id || rate.scope.bookId !== book.id || rate.scope.entityId !== book.entityId)) {
        throw new Error("Exchange-rate response scope mismatch");
      }
      return result;
    }, retry: false,
  });
  return <Box display="grid" gap="lg" minWidth="zero">
    <Heading>{copy.rateId}: {id}</Heading>
    <Button variant="outline" disabled={saved.isFetching} onClick={() => { void saved.refetch(); }}>{copy.refresh}</Button>
    <AccountingStatus locale={locale} pending={saved.isPending} error={saved.error} />
    {saved.data ? <>
      <Heading>{copy.history}</Heading>
      {saved.data.revisions.map((rate) => <Box key={rate.digest} display="grid" gap="md" minWidth="zero">
        <RateDetails book={book} locale={locale} rate={rate} />
        <Button variant="outline" disabled={conversionRate !== null} onClick={() => setConversionRate((selected) => selected ?? rate)}>{copy.select} · {rate.revision}</Button>
      </Box>)}
      {book.role === "operator" && saved.data.current.revision < 20 ? (
        <Button variant="outline" disabled={editingRate !== null} onClick={() => {
          const revision = saved.data?.current;
          if (revision) setEditingRate((selected) => selected ?? revision);
        }}>{copy.revise}</Button>
      ) : null}
    </> : null}
    {conversionRate ? <Box display="grid" gap="md" minWidth="zero">
      <DraftStatus rate={conversionRate} current={saved.data?.current} locale={locale} />
      <ConversionForm book={book} locale={locale} rate={conversionRate} onSaved={onConversionSaved} onDiscard={() => setConversionRate(null)} />
    </Box> : null}
    {editingRate ? <Box display="grid" gap="md" minWidth="zero">
      <DraftStatus rate={editingRate} current={saved.data?.current} locale={locale} />
      <RateForm book={book} locale={locale} current={editingRate} onSaved={onRateSaved} onDiscard={() => setEditingRate(null)} />
    </Box> : null}
  </Box>;
}
function DraftStatus({ rate, current, locale }: {
  rate: typeof Rates.ExchangeRateRevision.Type;
  current: typeof Rates.ExchangeRateRevision.Type | undefined;
  locale: Locale;
}) {
  const copy = exchangeRateCopy(locale);
  let status = copy.draftPinned;
  if (!current || current.observationId !== rate.observationId) status = copy.draftStatusUnknown;
  else if (current.digest !== rate.digest) status = copy.stale;
  return <Text role="status">{status}</Text>;
}
function RateDetails({ book, locale, rate }: {
  book: typeof Accounting.Book.Type; locale: Locale; rate: typeof Rates.ExchangeRateRevision.Type;
}) {
  const copy = exchangeRateCopy(locale);
  return <Box display="grid" gap="sm" minWidth="zero">
    <Text>{rate.sourceKey} · {copy.revision}: {rate.revision} · {rate.createdAt} · {rate.receipt.actorId}</Text>
    <Text>{rate.terms.fromCurrency} → {rate.terms.toCurrency} · {rate.terms.rateNumerator}/{rate.terms.rateDenominator}</Text>
    <Text>{copy.effectiveOn}: {rate.terms.effectiveOn} · {copy.retrievedOn}: {rate.terms.retrievedOn}</Text>
    <Text>{copy.digest}: {rate.digest}</Text><Text>{rate.terms.rationale}</Text>
    <EvidenceInspector book={book} locale={locale} reference={{ evidenceId: rate.terms.evidenceId, sha256: rate.sourceSha256, locator: rate.terms.sourceLocator }} />
    <Text>{copy.reviewEvidence}: {rate.terms.reviewEvidenceId}</Text>
    <EvidenceInspector book={book} locale={locale} reference={{ evidenceId: rate.terms.reviewEvidenceId, sha256: rate.reviewSha256, locator: rate.terms.sourceLocator }} />
  </Box>;
}
export function ConversionInspector({ book, locale, id }: Props) {
  const copy = exchangeRateCopy(locale);
  const saved = useQuery({
    queryKey: [...bookKey(book), "exchange-rates", "review", id],
    queryFn: async ({ signal }) => {
      const result = await readAccounting(`${bookPath(book)}/exchange-rates/reviews/${encodeURIComponent(id)}`, Rates.ConversionReviewView, { signal });
      const bytes = new TextEncoder().encode(result.artifact.content);
      const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((value) => value.toString(16).padStart(2, "0")).join("");
      const stored = Schema.decodeUnknownSync(Rates.ConversionReview)(JSON.parse(result.artifact.content));
      if (result.review.id !== id || result.review.scope.bookId !== book.id || result.review.scope.entityId !== book.entityId
        || stored.id !== id || stored.scope.bookId !== book.id || stored.scope.entityId !== book.entityId
        || stored.rate.scope.bookId !== book.id || stored.rate.scope.entityId !== book.entityId
        || stored.input.observationId !== stored.rate.observationId || stored.input.revisionDigest !== stored.rate.digest
        || stored.digest !== result.review.digest || bytes.length !== result.artifact.byteLength || hash !== result.artifact.sha256) {
        throw new Error(copy.artifactError);
      }
      return { ...result, review: stored };
    }, retry: false,
  });
  return <Box display="grid" gap="lg" minWidth="zero">
    <Heading>{copy.reviewId}: {id}</Heading>
    <Button variant="outline" disabled={saved.isFetching} onClick={() => { void saved.refetch(); }}>{copy.refresh}</Button>
    <AccountingStatus locale={locale} pending={saved.isPending} error={saved.error} />
    {saved.data ? <ConversionDetails book={book} locale={locale} value={saved.data} /> : null}
  </Box>;
}
function ConversionDetails({ book, locale, value }: {
  book: typeof Accounting.Book.Type; locale: Locale; value: typeof Rates.ConversionReviewView.Type;
}) {
  const copy = exchangeRateCopy(locale);
  const review = value.review;
  const calculation = review.calculation;
  return <Box display="grid" gap="md" minWidth="zero">
    <Text role="status">{value.dependenciesCurrent ? copy.current : copy.historical}</Text>
    <Text>{copy.warning}</Text><Text>{review.createdAt} · {review.receipt.actorId} · {review.digest}</Text>
    <Text>{copy.amount}: {review.input.originalMinor} {review.input.fromCurrency} · {copy.sourceScale}: {review.input.sourceScale}</Text>
    <Text>{copy.conversionDate}: {review.input.conversionDate}</Text><Text>{review.input.rationale}</Text>
    <EvidenceInspector book={book} locale={locale} reference={{ evidenceId: review.input.evidenceId, sha256: review.sourceSha256, locator: review.input.sourceLocator }} />
    <RateDetails book={book} locale={locale} rate={review.rate} />
    <Text>{review.input.roundingPolicy}</Text><Text>{copy.roundingHelp}</Text>
    <Text>{copy.exact}: {calculation.exactNumerator}/{calculation.exactDenominator}</Text>
    <Text>{copy.quotient}: {calculation.quotientMinor} · {copy.remainder}: {calculation.remainderNumerator}</Text>
    <Text>{copy.rounded}: {calculation.roundedMinor} {review.bookBasis.currency} · {review.bookBasis.currencyScale}</Text>
    <Text>{copy.residual}: {calculation.residualNumerator}/{calculation.residualDenominator}</Text>
    <Text>{review.formula}</Text>
    <Button variant="outline" onClick={() => {
      const url = URL.createObjectURL(new Blob([value.artifact.content], { type: value.artifact.mediaType }));
      const link = document.createElement("a"); link.href = url; link.download = `${review.id}.json`;
      document.body.append(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 0);
    }}>{copy.download}</Button>
  </Box>;
}
