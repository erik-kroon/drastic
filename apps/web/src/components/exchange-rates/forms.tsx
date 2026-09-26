import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import * as Schema from "effect/Schema";
import type * as Accounting from "@open-erp/contracts/accounting";
import * as Rates from "@open-erp/contracts/exchange-rates";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { InputField, SelectField } from "@open-erp/ui/components/field";
import { Text } from "@open-erp/ui/components/typography";
import { AccountingStatus } from "@/components/accounting-status";
import { bookPath, mutationOptions, readAccounting } from "@/lib/accounting-api";
import type { Locale } from "@/paraglide/runtime";
import { exchangeRateCopy } from "./copy";

type Props = { book: typeof Accounting.Book.Type; locale: Locale };

export function RateForm(
  props: Props & {
    current?: typeof Rates.ExchangeRateRevision.Type;
    onSaved: (id: string) => void;
    onNew?: () => void;
    onDiscard?: () => void;
  },
) {
  const { book, locale, current, onSaved } = props;
  const onNew = props.onNew;
  const onDiscard = props.onDiscard;
  const copy = exchangeRateCopy(locale);
  const [invalid, setInvalid] = useState(false);
  const keys = useRef(new Map<string, string>());

  const save = useMutation({
    mutationFn: async (input: typeof Rates.CreateExchangeRate.Type) => {
      const path = current
        ? `${bookPath(book)}/exchange-rates/${current.observationId}/revisions`
        : `${bookPath(book)}/exchange-rates`;

      const payload = current ? { expectedDigest: current.digest, terms: input.terms } : input;

      const result = await readAccounting(
        path,
        Rates.ExchangeRateRevision,
        mutationOptions(path, JSON.stringify(payload), keys.current),
      );

      if (
        result.scope.bookId !== book.id ||
        result.scope.entityId !== book.entityId ||
        result.sourceKey !== input.sourceKey ||
        (current &&
          (result.observationId !== current.observationId ||
            result.previousDigest !== current.digest))
      ) {
        throw new Error("Exchange-rate response identity mismatch");
      }

      return result;
    },
    onSuccess: (result) => onSaved(result.observationId),
  });

  const terms = current?.terms;

  return (
    <Box
      as="form"
      display="grid"
      gap="lg"
      minWidth="zero"
      onSubmit={(event) => {
        event.preventDefault();
        const fields = new FormData(event.currentTarget);

        const decoded = Schema.decodeUnknownOption(Rates.CreateExchangeRate)({
          sourceKey: current?.sourceKey ?? fields.get("sourceKey"),
          terms: {
            fromCurrency: fields.get("fromCurrency"),
            toCurrency: fields.get("toCurrency"),
            effectiveOn: fields.get("effectiveOn"),
            retrievedOn: fields.get("retrievedOn"),
            rateNumerator: fields.get("rateNumerator"),
            rateDenominator: fields.get("rateDenominator"),
            evidenceId: fields.get("evidenceId"),
            sourceLocator: fields.get("sourceLocator"),
            reviewEvidenceId: fields.get("reviewEvidenceId"),
            rationale: fields.get("rationale"),
          },
        });

        if (decoded._tag === "None") {
          setInvalid(true);

          return;
        }

        setInvalid(false);
        save.mutate(decoded.value);
      }}
    >
      <Text>{copy.policyHelp}</Text>
      <Text>{copy.retry}</Text>
      <Box
        as="fieldset"
        disabled={save.isPending || save.isSuccess || book.role !== "operator"}
        display="grid"
        gap="md"
        borderWidth="none"
        padding="none"
        margin="none"
        minWidth="zero"
      >
        {!current ? (
          <InputField
            name="sourceKey"
            label={copy.sourceKey}
            required
            maxLength={128}
            pattern="[a-zA-Z0-9_-]+"
          />
        ) : (
          <Text>
            {current.sourceKey} · {current.digest}
          </Text>
        )}
        <InputField
          name="fromCurrency"
          label={copy.fromCurrency}
          required
          pattern="[A-Z]{3}"
          maxLength={3}
          defaultValue={terms?.fromCurrency}
        />
        <InputField
          name="toCurrency"
          label={copy.toCurrency}
          required
          readOnly
          value={terms?.toCurrency ?? book.currency}
        />
        <InputField
          name="effectiveOn"
          label={copy.effectiveOn}
          required
          type="date"
          defaultValue={terms?.effectiveOn}
        />
        <InputField
          name="retrievedOn"
          label={copy.retrievedOn}
          required
          type="date"
          defaultValue={terms?.retrievedOn}
        />
        <InputField
          name="rateNumerator"
          label={copy.numerator}
          required
          inputMode="numeric"
          pattern="[1-9][0-9]{0,37}"
          defaultValue={terms?.rateNumerator}
        />
        <InputField
          name="rateDenominator"
          label={copy.denominator}
          required
          inputMode="numeric"
          pattern="[1-9][0-9]{0,37}"
          defaultValue={terms?.rateDenominator}
        />
        <InputField
          name="evidenceId"
          label={copy.evidence}
          required
          defaultValue={terms?.evidenceId}
        />
        <InputField
          name="sourceLocator"
          label={copy.locator}
          required
          maxLength={256}
          defaultValue={terms?.sourceLocator}
        />
        <InputField
          name="reviewEvidenceId"
          label={copy.reviewEvidence}
          required
          defaultValue={terms?.reviewEvidenceId}
        />
        <InputField
          name="rationale"
          label={copy.rationale}
          required
          maxLength={2000}
          defaultValue={terms?.rationale}
        />
        <Button type="submit">{current ? copy.revise : copy.create}</Button>
      </Box>
      <Text role="status">{invalid ? copy.invalid : save.isSuccess ? copy.saved : ""}</Text>
      {save.isSuccess && onNew ? (
        <Button type="button" variant="ghost" onClick={onNew}>
          {copy.newRate}
        </Button>
      ) : null}
      {onDiscard ? (
        <Button
          type="button"
          variant="ghost"
          disabled={save.isPending}
          onClick={() => {
            if (!save.isPending) onDiscard();
          }}
        >
          {copy.discardDraft}
        </Button>
      ) : null}
      <AccountingStatus locale={locale} write pending={save.isPending} error={save.error} />
    </Box>
  );
}

export function ConversionForm(
  props: Props & {
    rate: typeof Rates.ExchangeRateRevision.Type;
    onSaved: (id: string) => void;
    onDiscard: () => void;
  },
) {
  const { book, locale, rate, onSaved } = props;
  const onDiscard = props.onDiscard;
  const copy = exchangeRateCopy(locale);
  const [invalid, setInvalid] = useState(false);
  const keys = useRef(new Map<string, string>());

  const save = useMutation({
    mutationFn: async (input: typeof Rates.CaptureConversionReview.Type) => {
      const path = `${bookPath(book)}/exchange-rates/reviews`;

      const result = await readAccounting(
        path,
        Rates.ConversionReview,
        mutationOptions(path, JSON.stringify(input), keys.current),
      );

      if (
        result.scope.bookId !== book.id ||
        result.scope.entityId !== book.entityId ||
        result.rate.observationId !== rate.observationId ||
        result.rate.digest !== rate.digest ||
        result.input.originalMinor !== input.originalMinor ||
        result.input.sourceScale !== input.sourceScale ||
        result.input.evidenceId !== input.evidenceId ||
        result.input.sourceLocator !== input.sourceLocator ||
        result.input.conversionDate !== input.conversionDate ||
        result.input.fromCurrency !== input.fromCurrency
      ) {
        throw new Error("Conversion response identity mismatch");
      }

      return result;
    },
    onSuccess: (result) => onSaved(result.id),
  });

  return (
    <Box
      as="form"
      display="grid"
      gap="lg"
      minWidth="zero"
      onSubmit={(event) => {
        event.preventDefault();
        const fields = new FormData(event.currentTarget);

        const decoded = Schema.decodeUnknownOption(Rates.CaptureConversionReview)({
          observationId: rate.observationId,
          revisionDigest: rate.digest,
          conversionDate: fields.get("conversionDate"),
          fromCurrency: rate.terms.fromCurrency,
          sourceScale: Number(fields.get("sourceScale") || NaN),
          originalMinor: fields.get("originalMinor"),
          roundingPolicy: fields.get("roundingPolicy"),
          evidenceId: fields.get("evidenceId"),
          sourceLocator: fields.get("sourceLocator"),
          rationale: fields.get("rationale"),
        });

        if (decoded._tag === "None") {
          setInvalid(true);

          return;
        }

        setInvalid(false);
        save.mutate(decoded.value);
      }}
    >
      <Text>
        {copy.selected}: {rate.observationId} · {rate.revision} · {rate.digest}
      </Text>
      <Text>
        {rate.terms.fromCurrency} → {rate.terms.toCurrency} · {rate.terms.rateNumerator}/
        {rate.terms.rateDenominator} · {rate.terms.effectiveOn}
      </Text>
      <Text>{copy.roundingHelp}</Text>
      <Text>{copy.retry}</Text>
      <Box
        as="fieldset"
        disabled={save.isPending || save.isSuccess}
        display="grid"
        gap="md"
        borderWidth="none"
        padding="none"
        margin="none"
        minWidth="zero"
      >
        <InputField name="conversionDate" label={copy.conversionDate} required type="date" />
        <InputField
          name="originalMinor"
          label={copy.amount}
          required
          inputMode="numeric"
          pattern="(0|[1-9][0-9]{0,37})"
        />
        <SelectField
          name="sourceScale"
          label={copy.sourceScale}
          required
          options={[
            { value: "", label: "—" },
            ...[0, 1, 2, 3, 4, 5, 6].map((scale) => ({
              value: String(scale),
              label: String(scale),
            })),
          ]}
        />
        <InputField name="evidenceId" label={copy.amountEvidence} required />
        <InputField name="sourceLocator" label={copy.locator} required maxLength={256} />
        <InputField name="rationale" label={copy.rationale} required maxLength={2000} />
        <Box as="label" display="flex" gap="md" alignItems="center">
          <input
            type="checkbox"
            name="roundingPolicy"
            value="synthetic_half_up_nonnegative_v1"
            required
          />
          <Text>{copy.policy}</Text>
        </Box>
        <Button type="submit">{copy.capture}</Button>
      </Box>
      <Text role="status">{invalid ? copy.invalid : save.isSuccess ? copy.saved : ""}</Text>
      {save.isSuccess ? (
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            keys.current.clear();
            save.reset();
          }}
        >
          {copy.newConversion}
        </Button>
      ) : null}
      <Button
        type="button"
        variant="ghost"
        disabled={save.isPending}
        onClick={() => {
          if (!save.isPending) onDiscard();
        }}
      >
        {copy.discardDraft}
      </Button>
      <AccountingStatus locale={locale} write pending={save.isPending} error={save.error} />
    </Box>
  );
}
