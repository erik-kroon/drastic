import { useRef } from "react";
import { useForm } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import * as Schema from "effect/Schema";
import * as Historical from "@open-erp/contracts/historical-migration";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { InputField, SelectField, TextareaField } from "@open-erp/ui/components/field";
import { Text } from "@open-erp/ui/components/typography";
import { AccountingStatus } from "@/components/accounting-status";
import { useBookWorkspace } from "@/lib/book-context";
import {
  bookPath,
  mutationOptions,
  readAccounting,
  isUncertainWriteError,
} from "@/lib/accounting-api";

export function RefreshOpening({
  basis,
  onSaved,
}: {
  basis: typeof Historical.Basis.Type;
  onSaved: () => void;
}) {
  const { book, setup, locale } = useBookWorkspace();
  const sv = locale === "sv";
  const keys = useRef(new Map<string, string>());
  const path = `${bookPath(book)}/historical-bases/${encodeURIComponent(basis.fiscalYearId)}/proposals`;
  const save = useMutation({
    mutationFn: async (input: typeof Historical.RefreshOpening.Type) => {
      const result = await readAccounting(
        path,
        Historical.OpeningPreparation,
        mutationOptions(path, JSON.stringify(input), keys.current),
      );
      if (
        result.basis.fiscalYearId !== basis.fiscalYearId ||
        result.basis.sourcePlanId !== basis.sourcePlanId ||
        result.basis.sourceDigest !== basis.sourceDigest
      )
        throw new Error("Historical opening identity mismatch");
      return result;
    },
    onSuccess: onSaved,
  });
  const uncertain = isUncertainWriteError(save.error);
  const disabled = book.role !== "operator" || save.isPending || uncertain || save.isSuccess;
  const form = useForm({
    defaultValues: {
      expectedChangeSetId: basis.changeSetId ?? "",
      accountingPeriodId: "",
      series: "",
      rationale: "",
    },
    validators: {
      onSubmit: ({ value }) =>
        Schema.is(Historical.RefreshOpening)(value)
          ? undefined
          : "Choose a period, series, and reason.",
    },
    onSubmit: async ({ value }) => {
      await save.mutateAsync(value).catch(() => undefined);
    },
  });
  return (
    <details>
      <summary>{sv ? "Förbered ingående saldon igen" : "Prepare opening balances again"}</summary>
      <Box
        as="form"
        display="grid"
        gap="md"
        onSubmit={(event) => {
          event.preventDefault();
          void form.handleSubmit();
        }}
      >
        <Text>
          {sv
            ? "Om konton eller perioder har ändrats kan du ersätta det obokförda förslaget. Sparade saldon och övergångsdatum behålls. Det nya förslaget kräver ny granskning och nytt godkännande."
            : "If accounts or periods have changed, replace the unposted proposal. Saved balances and the cutover date are retained. The new proposal requires a fresh review and approval."}
        </Text>
        <form.Field name="accountingPeriodId">
          {(field) => (
            <SelectField
              label={sv ? "Bokföringsperiod" : "Accounting period"}
              value={field.state.value}
              disabled={disabled}
              options={[
                { value: "", label: sv ? "Välj period" : "Select period" },
                ...setup.periods
                  .filter(
                    (period) =>
                      !period.locked &&
                      period.startsOn <= basis.cutoverOn &&
                      period.endsOn >= basis.cutoverOn,
                  )
                  .map((period) => ({
                    value: period.id,
                    label: `${period.startsOn} – ${period.endsOn}`,
                  })),
              ]}
              onValueChange={(value) => {
                field.handleChange(value ?? "");
                field.handleBlur();
              }}
            />
          )}
        </form.Field>
        <form.Field name="series">
          {(field) => (
            <InputField
              label={sv ? "Verifikationsserie" : "Voucher series"}
              value={field.state.value}
              required
              maxLength={16}
              disabled={disabled}
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.target.value)}
            />
          )}
        </form.Field>
        <form.Field name="rationale">
          {(field) => (
            <TextareaField
              label={sv ? "Skäl till nytt förslag" : "Reason for replacement"}
              value={field.state.value}
              required
              maxLength={2000}
              disabled={disabled}
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.target.value)}
            />
          )}
        </form.Field>
        <form.Subscribe selector={(state) => state.submissionAttempts > 0 && !state.isValid}>
          {(invalid) =>
            invalid ? (
              <Text role="alert">
                {sv ? "Välj period, serie och skäl." : "Choose a period, series, and reason."}
              </Text>
            ) : null
          }
        </form.Subscribe>
        <AccountingStatus locale={locale} pending={save.isPending} error={save.error} write />
        <Box>
          {uncertain ? (
            <Button
              type="button"
              disabled={save.isPending || book.role !== "operator"}
              onClick={() => {
                if (save.variables) save.mutate(save.variables);
              }}
            >
              {sv ? "Återförsök samma ersättning" : "Retry same replacement"}
            </Button>
          ) : (
            <Button type="submit" disabled={disabled}>
              {sv ? "Ersätt obokfört förslag" : "Replace unposted proposal"}
            </Button>
          )}
        </Box>
      </Box>
    </details>
  );
}
