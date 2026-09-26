import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as Schema from "effect/Schema";
import * as Accounting from "@open-erp/contracts/accounting";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { InputField, SelectField } from "@open-erp/ui/components/field";
import { Heading, Text } from "@open-erp/ui/components/typography";
import { AccountingStatus } from "@/components/accounting-status";
import { bookKey, bookPath, mutationOptions, readAccounting } from "@/lib/accounting-api";
import { accountingCopy } from "@/lib/accounting-copy";
import type { Locale } from "@/paraglide/runtime";

export function JournalCorrection(props: {
  book: typeof Accounting.Book.Type;
  voucherId: string;
  periods: (typeof Accounting.BookSetup.Type)["periods"];
  locale: Locale;
  onPrepared: (id: string) => void;
}) {
  const { book, voucherId, locale, onPrepared } = props;
  const copy = accountingCopy(locale);
  const client = useQueryClient();
  const keys = useRef(new Map<string, string>());
  const [inputError, setInputError] = useState("");

  const correction = useMutation({
    mutationFn: (payload: typeof Accounting.PrepareCorrection.Type) => {
      const path = `${bookPath(book)}/vouchers/${encodeURIComponent(voucherId)}/correction-proposals`;

      return readAccounting(
        path,
        Accounting.ChangeSet,
        mutationOptions(path, JSON.stringify(payload), keys.current),
      );
    },
    onSuccess: (plan) => {
      client.setQueryData([...bookKey(book), "change-set", plan.id], plan);
      onPrepared(plan.id);
    },
  });

  return (
    <Box
      as="form"
      display="grid"
      gap="lg"
      onSubmit={(event) => {
        event.preventDefault();
        const fields = new FormData(event.currentTarget);

        const decoded = Schema.decodeUnknownOption(Accounting.PrepareCorrection)({
          accountingPeriodId: fields.get("period"),
          postingDate: fields.get("date"),
          rationale: fields.get("rationale"),
        });

        if (decoded._tag === "None") {
          setInputError(copy.journal_invalid);

          return;
        }

        setInputError("");
        correction.mutate(decoded.value);
      }}
    >
      <Heading>{copy.journal_correction}</Heading>
      <Text tone="muted">{copy.journal_correction_help}</Text>
      <Box
        as="fieldset"
        disabled={correction.isPending || correction.isSuccess}
        borderWidth="none"
        padding="none"
        margin="none"
        minWidth="zero"
        display="grid"
        gap="lg"
      >
        <Box display="grid" columns={1} columnsAtSm={2} gap="lg">
          <SelectField
            label={copy.journal_period}
            name="period"
            required
            options={props.periods.map((period) => ({
              value: period.id,
              label: `${period.startsOn} – ${period.endsOn}${period.locked ? ` · ${copy.journal_locked}` : ""}`,
              disabled: period.locked,
            }))}
          />
          <InputField label={copy.journal_date} name="date" type="date" required />
        </Box>
        <InputField label={copy.journal_rationale} name="rationale" required maxLength={2000} />
        <Box>
          <Button type="submit" size="xl" variant="outline">
            {copy.journal_correction}
          </Button>
        </Box>
      </Box>
      <Text role="status">{inputError}</Text>
      <AccountingStatus
        write
        locale={locale}
        pending={correction.isPending}
        error={correction.error}
      />
      {correction.data ? (
        <Box role="status" display="grid" gap="md">
          <Text>{copy.journal_correction_ready}</Text>
          <Text>
            {copy.journal_plan_id}: {correction.data.id}
          </Text>
          <Box>
            <Button
              size="xl"
              variant="outline"
              onClick={() => {
                if (correction.data) onPrepared(correction.data.id);
                requestAnimationFrame(() => document.getElementById("journal-review")?.focus());
              }}
            >
              {copy.journal_open_review}
            </Button>
          </Box>
          <Box>
            <Button
              size="xl"
              variant="ghost"
              onClick={() => {
                correction.reset();
                keys.current.clear();
              }}
            >
              {copy.journal_new}
            </Button>
          </Box>
        </Box>
      ) : null}
    </Box>
  );
}
