import { useId, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import * as Schema from "effect/Schema";
import type * as Accounting from "@open-erp/contracts/accounting";
import * as Subledgers from "@open-erp/contracts/subledgers";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { InputField, SelectField } from "@open-erp/ui/components/field";
import { Text } from "@open-erp/ui/components/typography";
import { AccountingStatus } from "@/components/accounting-status";
import { bookPath, mutationOptions, readAccounting } from "@/lib/accounting-api";
import type { Locale } from "@/paraglide/runtime";
import { subledgerCopy } from "./copy";

export function ScheduleForm(props: {
  book: typeof Accounting.Book.Type;
  setup: typeof Accounting.BookSetup.Type;
  locale: Locale;
  current?: typeof Subledgers.ScheduleRevision.Type;
  onSaved: (id: string) => void;
}) {
  const { book, setup, locale, current } = props;
  const copy = subledgerCopy(locale);
  const terms = current?.terms;
  const policyId = useId();
  const keys = useRef(new Map<string, string>());
  const [count, setCount] = useState(terms?.usefulPeriods ?? 1);
  const [invalid, setInvalid] = useState(false);
  const save = useMutation({
    mutationFn: async (input: typeof Subledgers.CreateSchedule.Type) => {
      const path = current
        ? `${bookPath(book)}/schedules/${current.scheduleId}/revisions`
        : `${bookPath(book)}/schedules`;
      const payload = current ? { expectedDigest: current.digest, terms: input.terms } : input;
      const result = await readAccounting(
        path,
        Subledgers.ScheduleRevision,
        mutationOptions(path, JSON.stringify(payload), keys.current),
      );
      if (
        result.scope.bookId !== book.id ||
        result.scope.entityId !== book.entityId ||
        result.sourceKey !== input.sourceKey ||
        (current && result.scheduleId !== current.scheduleId)
      ) {
        throw new Error("Schedule revision identity or scope mismatch");
      }
      return result;
    },
    onSuccess: (revision) => props.onSaved(revision.scheduleId),
  });
  const accounts = [
    { value: "", label: "—" },
    ...setup.accounts.map((account) => ({
      value: account.id,
      label: `${account.code} · ${account.name}`,
      disabled: !account.active,
    })),
  ];
  const periods = [
    { value: "", label: "—" },
    ...setup.periods.map((period) => ({
      value: period.id,
      label: `${period.id} · ${period.startsOn} – ${period.endsOn}`,
      disabled: period.locked,
    })),
  ];
  return (
    <Box
      as="form"
      display="grid"
      gap="lg"
      minWidth="zero"
      onSubmit={(event) => {
        event.preventDefault();
        const fields = new FormData(event.currentTarget);
        const decoded = Schema.decodeUnknownOption(Subledgers.CreateSchedule)({
          sourceKey: current?.sourceKey ?? fields.get("sourceKey"),
          terms: {
            kind: fields.get("kind"),
            name: fields.get("name"),
            evidenceId: fields.get("evidenceId"),
            rationale: fields.get("rationale"),
            costMinor: fields.get("costMinor"),
            residualMinor: fields.get("residualMinor"),
            usefulPeriods: count,
            allocationPolicy: fields.get("allocationPolicy"),
            debitAccountId: fields.get("debitAccountId"),
            creditAccountId: fields.get("creditAccountId"),
            series: fields.get("series"),
            taxAssessment: "not_applicable",
            periods: Array.from({ length: count }, (_, index) => ({
              postingDate: fields.get(`date_${index}`),
              accountingPeriodId: fields.get(`period_${index}`),
            })),
          },
        });
        if (
          decoded._tag === "None" ||
          decoded.value.terms.debitAccountId === decoded.value.terms.creditAccountId
        ) {
          setInvalid(true);
          return;
        }
        setInvalid(false);
        save.mutate(decoded.value);
      }}
    >
      <Text>{copy.policyHelp}</Text>
      <Text>{copy.limit}</Text>
      <Box
        as="fieldset"
        disabled={save.isPending || save.isSuccess}
        display="grid"
        gap="lg"
        minWidth="zero"
        borderWidth="none"
        padding="none"
        margin="none"
      >
        {!current ? (
          <>
            <InputField
              label={copy.sourceKey}
              name="sourceKey"
              required
              pattern="[a-zA-Z0-9_\-]{1,128}"
              maxLength={128}
            />
            <Text>{copy.sourceKeyHelp}</Text>
          </>
        ) : null}
        <InputField
          label={copy.name}
          name="name"
          required
          maxLength={2000}
          defaultValue={terms?.name}
        />
        <SelectField
          label={copy.kind}
          name="kind"
          required
          defaultValue={terms?.kind ?? ""}
          options={[
            { value: "", label: "—" },
            { value: "asset", label: copy.asset },
            { value: "deferral", label: copy.deferral },
          ]}
        />
        <InputField
          label={copy.evidence}
          name="evidenceId"
          required
          pattern="[a-z][a-z0-9_\-]{2,127}"
          defaultValue={terms?.evidenceId}
        />
        <InputField
          label={copy.rationale}
          name="rationale"
          required
          maxLength={2000}
          defaultValue={terms?.rationale}
        />
        <InputField
          label={copy.cost}
          name="costMinor"
          inputMode="numeric"
          required
          pattern="(0|[1-9][0-9]{0,37})"
          defaultValue={terms?.costMinor}
        />
        <InputField
          label={copy.residual}
          name="residualMinor"
          inputMode="numeric"
          required
          pattern="(0|[1-9][0-9]{0,37})"
          defaultValue={terms?.residualMinor}
        />
        <SelectField
          label={copy.debit}
          name="debitAccountId"
          required
          options={accounts}
          defaultValue={terms?.debitAccountId ?? ""}
        />
        <SelectField
          label={copy.credit}
          name="creditAccountId"
          required
          options={accounts}
          defaultValue={terms?.creditAccountId ?? ""}
        />
        <InputField
          label={copy.series}
          name="series"
          required
          pattern="[A-Z0-9]{1,16}"
          defaultValue={terms?.series}
        />
        {Array.from({ length: count }, (_, index) => (
          <Box
            key={index}
            as="fieldset"
            display="grid"
            gap="md"
            minWidth="zero"
            padding="md"
            borderWidth="thin"
            borderColor="default"
            borderRadius="control"
          >
            <legend>
              {copy.occurrence} {index + 1}
            </legend>
            <InputField
              label={copy.date}
              name={`date_${index}`}
              type="date"
              required
              defaultValue={terms?.periods[index]?.postingDate}
            />
            <SelectField
              label={copy.period}
              name={`period_${index}`}
              required
              options={periods}
              defaultValue={terms?.periods[index]?.accountingPeriodId ?? ""}
            />
          </Box>
        ))}
        <Box display="flex" flexWrap="wrap" gap="md">
          <Button
            type="button"
            size="xl"
            variant="outline"
            disabled={count >= 120}
            onClick={() => setCount(count + 1)}
          >
            {copy.add}
          </Button>
          <Button
            type="button"
            size="xl"
            variant="ghost"
            disabled={count <= 1}
            onClick={() => setCount(count - 1)}
          >
            {copy.remove}
          </Button>
        </Box>
        <Box
          as="label"
          htmlFor={policyId}
          display="flex"
          alignItems="center"
          gap="md"
          paddingBlock="md"
        >
          <input
            id={policyId}
            type="checkbox"
            name="allocationPolicy"
            value="equal_minor_final_remainder_v1"
            required
          />
          {copy.policy}
        </Box>
        <Box>
          <Button type="submit" size="xl">
            {current ? copy.revise : copy.create}
          </Button>
        </Box>
      </Box>
      <Text role="status">{invalid ? copy.invalid : save.isSuccess ? copy.saved : ""}</Text>
      <AccountingStatus locale={locale} write pending={save.isPending} error={save.error} />
      {!current && save.isSuccess ? (
        <Box>
          <Button
            type="button"
            size="xl"
            variant="ghost"
            onClick={() => {
              save.reset();
              keys.current.clear();
            }}
          >
            {copy.newSchedule}
          </Button>
        </Box>
      ) : null}
    </Box>
  );
}
