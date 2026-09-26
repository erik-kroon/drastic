import { useRef } from "react";
import { useForm } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import * as Schema from "effect/Schema";
import * as Historical from "@open-erp/contracts/historical-migration";
import * as Sie from "@open-erp/contracts/sie-import";
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

const review = Schema.Struct({
  cutoverOn: Historical.SelectBasis.fields.cutoverOn,
  controls: Historical.SelectBasis.fields.controls,
  rationale: Historical.SelectBasis.fields.rationale,
});

export function SelectHistoricalBasis({
  plan,
  year,
  onSaved,
  mode,
}: {
  plan: typeof Sie.SiePlan.Type;
  year: (typeof Historical.BasisInventory.Type.years)[number];
  onSaved: () => void;
  mode: "full_history" | "opening_set";
}) {
  const { book, setup, locale } = useBookWorkspace();
  const sv = locale === "sv";
  const keys = useRef(new Map<string, string>());
  const opening = mode === "opening_set";
  const path = `${bookPath(book)}/${opening ? "historical-openings" : "historical-bases"}`;

  const accountIds = [
    ...new Set(
      plan.input.openingControls.flatMap((control) =>
        plan.input.mappings
          .filter((mapping) => mapping.sourceAccount === control.sourceAccount)
          .map((mapping) => mapping.accountId),
      ),
    ),
  ];

  const save = useMutation({
    mutationFn: async (
      input: typeof Historical.SelectBasis.Type | typeof Historical.PrepareOpening.Type,
    ) => {
      const options = mutationOptions(path, JSON.stringify(input), keys.current);

      const result = opening
        ? (await readAccounting(path, Historical.OpeningPreparation, options)).basis
        : await readAccounting(path, Historical.Basis, options);

      if (
        result.fiscalYearId !== year.id ||
        result.sourcePlanId !== plan.id ||
        result.sourceDigest !== plan.digest
      )
        throw new Error("Historical basis identity mismatch");

      return result;
    },
    onSuccess: onSaved,
  });

  const uncertain = isUncertainWriteError(save.error);
  const disabled = book.role !== "operator" || save.isPending || uncertain || save.isSuccess;

  const form = useForm({
    defaultValues: {
      cutoverOn: "",
      rationale: "",
      accountingPeriodId: "",
      series: "",
      controls: accountIds.map((accountId) => ({ accountId, signedMinor: "", basis: "" })),
    },
    validators: {
      onSubmit: ({ value }) =>
        Schema.is(review)(value) &&
        (!opening ||
          Schema.is(
            Schema.Struct({
              accountingPeriodId: Historical.PrepareOpening.fields.accountingPeriodId,
              series: Historical.PrepareOpening.fields.series,
            }),
          )(value))
          ? undefined
          : "Check the date, balances, sources, period and series.",
    },
    onSubmit: async ({ value }) => {
      const input = {
        cutoverOn: value.cutoverOn,
        rationale: value.rationale,
        fiscalYearId: year.id,
        sourcePlanId: plan.id,
        sourceDigest: plan.digest,
        controls: value.controls,
      };

      await save
        .mutateAsync(
          opening
            ? {
                ...input,
                controls: input.controls.filter((control) => control.signedMinor !== "0"),
                accountingPeriodId: value.accountingPeriodId,
                series: value.series,
              }
            : { ...input, mode: "full_history", changeSetId: null },
        )
        .catch(() => undefined);
    },
  });

  return (
    <details>
      <summary>
        {opening
          ? sv
            ? "Välj ingående saldon vid övergången"
            : "Select opening balances at cutover"
          : sv
            ? "Välj fullständig historik från denna import"
            : "Select full history from this import"}
      </summary>
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
          {opening
            ? sv
              ? "Ange oberoende saldon vid övergångsdatumet. Nollsaldon utelämnas från bokföringsförslaget. Valet sparas med förslaget; granskning och godkännande krävs före bokföring. Detta återskapar inte tidigare verifikationer."
              : "Enter independent balances at the cutover date. Zero balances are omitted from the posting proposal. The choice is saved with the proposal; review and approval are required before posting. This does not reconstruct previous vouchers."
            : sv
              ? "Valet sparas för räkenskapsåret och kan inte ändras här. Ange oberoende ingående saldon för samtliga konton. Källan måste omfatta ett år. Verifikationer kräver separat godkännande och bokföring."
              : "This choice is retained for the fiscal year and cannot be changed here. Enter independent opening balances for every account. The source must cover one year. Vouchers require separate approval and posting."}
        </Text>
        <form.Field name="cutoverOn">
          {(field) => (
            <InputField
              type="date"
              label={sv ? "Övergångsdatum" : "Cutover date"}
              min={year.startsOn}
              max={year.endsOn}
              value={field.state.value}
              required
              disabled={disabled}
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.target.value)}
            />
          )}
        </form.Field>
        {opening ? (
          <>
            <form.Field name="accountingPeriodId">
              {(field) => (
                <SelectField
                  label={sv ? "Bokföringsperiod" : "Accounting period"}
                  value={field.state.value}
                  disabled={disabled}
                  options={[
                    { value: "", label: sv ? "Välj period" : "Select period" },
                    ...setup.periods
                      .filter((period) => !period.locked)
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
                  disabled={disabled}
                  maxLength={16}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
              )}
            </form.Field>
          </>
        ) : null}
        {accountIds.map((accountId, index) => (
          <Box key={accountId} display="grid" gap="sm">
            <Text>
              {setup.accounts.find((account) => account.id === accountId)?.code ?? accountId}
            </Text>
            <form.Field name={`controls[${index}].signedMinor`}>
              {(field) => (
                <InputField
                  label={
                    sv
                      ? `Ingående saldo i minsta valutaenhet (${book.currency})`
                      : `Opening balance in minor units (${book.currency})`
                  }
                  value={field.state.value}
                  required
                  disabled={disabled}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
              )}
            </form.Field>
            <form.Field name={`controls[${index}].basis`}>
              {(field) => (
                <InputField
                  label={sv ? "Oberoende källa" : "Independent source"}
                  value={field.state.value}
                  required
                  maxLength={2000}
                  disabled={disabled}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
              )}
            </form.Field>
          </Box>
        ))}
        <form.Field name="rationale">
          {(field) => (
            <TextareaField
              label={sv ? "Grund för historikvalet" : "Historical basis rationale"}
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
                {sv
                  ? "Kontrollera datum, saldon och källor."
                  : "Check the date, balances, and sources."}
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
              {sv ? "Återförsök samma historikval" : "Retry same basis selection"}
            </Button>
          ) : (
            <Button type="submit" disabled={disabled}>
              {opening
                ? sv
                  ? "Förbered ingående saldon"
                  : "Prepare opening balances"
                : sv
                  ? "Spara fullständig historik som grund"
                  : "Save full-history basis"}
            </Button>
          )}
        </Box>
      </Box>
    </details>
  );
}
