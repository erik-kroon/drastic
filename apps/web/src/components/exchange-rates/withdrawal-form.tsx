import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import * as Schema from "effect/Schema";
import type * as Accounting from "@open-erp/contracts/accounting";
import * as Rates from "@open-erp/contracts/exchange-rates";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { InputField } from "@open-erp/ui/components/field";
import { Text } from "@open-erp/ui/components/typography";
import { AccountingStatus } from "@/components/accounting-status";
import { bookPath, mutationOptions, readAccounting } from "@/lib/accounting-api";
import type { Locale } from "@/paraglide/runtime";
import { exchangeRateCopy } from "./copy";

export function WithdrawalForm(props: {
  book: typeof Accounting.Book.Type;
  locale: Locale;
  rate: typeof Rates.ExchangeRateRevision.Type;
  onSaved: (id: string) => void;
  onDiscard: () => void;
}) {
  const { book, locale, rate, onSaved } = props;
  const onDiscard = props.onDiscard;
  const copy = exchangeRateCopy(locale);
  const keys = useRef(new Map<string, string>());
  const [invalid, setInvalid] = useState(false);
  const save = useMutation({
    mutationFn: async (input: typeof Rates.WithdrawExchangeRate.Type) => {
      const path = `${bookPath(book)}/exchange-rates/${rate.observationId}/withdrawals`;
      const result = await readAccounting(path, Rates.ExchangeRateWithdrawal, mutationOptions(path, JSON.stringify(input), keys.current));
      if (result.scope.bookId !== book.id || result.scope.entityId !== book.entityId
        || result.observationId !== rate.observationId || result.revisionDigest !== rate.digest
        || result.input.evidenceId !== input.evidenceId || result.input.rationale !== input.rationale) {
        throw new Error("Withdrawal response identity mismatch");
      }
      return result;
    },
    onSuccess: (result) => onSaved(result.observationId),
  });
  return <Box as="form" display="grid" gap="lg" minWidth="zero" onSubmit={(event) => {
    event.preventDefault();
    if (save.isPending || save.isSuccess || book.role !== "operator") return;
    const fields = new FormData(event.currentTarget);
    const decoded = Schema.decodeUnknownOption(Rates.WithdrawExchangeRate)({
      expectedDigest: rate.digest, evidenceId: fields.get("evidenceId"), rationale: fields.get("rationale"),
    });
    if (decoded._tag === "None" || fields.get("acknowledge") !== "permanent") { setInvalid(true); return; }
    setInvalid(false); save.mutate(decoded.value);
  }}>
    <Text>{copy.withdrawalHelp}</Text><Text>{rate.observationId} · {rate.revision} · {rate.digest}</Text>
    <Text>{copy.retry}</Text>
    <Box as="fieldset" disabled={save.isPending || save.isSuccess || book.role !== "operator"} display="grid" gap="md" minWidth="zero" padding="none" margin="none" borderWidth="none">
      <InputField name="evidenceId" label={copy.withdrawalEvidence} required />
      <InputField name="rationale" label={copy.rationale} required maxLength={2000} />
      <Box as="label" display="flex" gap="md" alignItems="center">
        <input type="checkbox" name="acknowledge" value="permanent" required /><Text>{copy.withdrawalAcknowledge}</Text>
      </Box>
      <Button type="submit" variant="destructive">{copy.withdraw}</Button>
    </Box>
    <Text role="status">{invalid ? copy.invalid : save.isSuccess ? copy.withdrawn : ""}</Text>
    {save.data ? <Text>{save.data.id} · {save.data.digest}</Text> : null}
    <AccountingStatus locale={locale} write pending={save.isPending} error={save.error} />
    <Button type="button" variant="ghost" disabled={save.isPending} onClick={() => { if (!save.isPending) onDiscard(); }}>{copy.discardDraft}</Button>
  </Box>;
}
