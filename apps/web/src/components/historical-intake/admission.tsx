import { useRef } from "react";
import { useForm } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import * as Schema from "effect/Schema";
import * as Historical from "@open-erp/contracts/historical-migration";
import * as Sie from "@open-erp/contracts/sie-import";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { SelectField, TextareaField } from "@open-erp/ui/components/field";
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
  rationale: Historical.AdmitItems.fields.rationale,
  confirmed: Schema.Literal(true),
});

export function AdmitOpenItems({
  plan,
  onSaved,
}: {
  plan: typeof Sie.SiePlan.Type;
  onSaved: (result: typeof Historical.ItemAdmission.Type) => void;
}) {
  const { book, locale } = useBookWorkspace();
  const sv = locale === "sv";
  const keys = useRef(new Map<string, string>());
  const path = `${bookPath(book)}/sie-plans/${encodeURIComponent(plan.id)}/historical-items`;
  const save = useMutation({
    mutationFn: async (input: typeof Historical.AdmitItems.Type) => {
      const result = await readAccounting(
        path,
        Historical.ItemAdmission,
        mutationOptions(path, JSON.stringify(input), keys.current),
      );
      if (result.sourcePlanId !== plan.id || result.planDigest !== plan.digest)
        throw new Error("Historical admission identity mismatch");
      return result;
    },
    onSuccess: onSaved,
  });
  const uncertain = isUncertainWriteError(save.error);
  const disabled = book.role !== "operator" || save.isPending || uncertain;
  const form = useForm({
    defaultValues: { rationale: "", confirmed: false },
    validators: { onSubmit: Schema.toStandardSchemaV1(review) },
    onSubmit: async ({ value }) => {
      await save
        .mutateAsync({
          planDigest: plan.digest,
          payments: [],
          matches: [],
          paymentControls: [],
          matchControls: [],
          chronology: "unknown",
          rationale: value.rationale,
        })
        .catch(() => undefined);
    },
  });
  return (
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
          ? "Spara planens öppna poster utan betalnings- eller matchningshistorik. Betalningskronologin förblir okänd. Registret kan inte ändras efteråt och skapar inga bokföringsposter."
          : "Save the plan’s open items without payment or matching history. Payment chronology remains unknown. The register cannot be amended afterward and creates no ledger postings."}
      </Text>
      <form.Field name="rationale">
        {(field) => (
          <TextareaField
            label={sv ? "Grund för registerimporten" : "Register import rationale"}
            name={field.name}
            value={field.state.value}
            required
            maxLength={2000}
            disabled={disabled}
            onBlur={field.handleBlur}
            onChange={(event) => field.handleChange(event.target.value)}
          />
        )}
      </form.Field>
      <form.Field name="confirmed">
        {(field) => (
          <SelectField
            label={sv ? "Importens omfattning" : "Register scope"}
            name={field.name}
            value={field.state.value ? "confirmed" : ""}
            disabled={disabled}
            options={[
              { value: "", label: sv ? "Välj efter granskning" : "Choose after review" },
              {
                value: "confirmed",
                label: sv
                  ? "Endast öppna poster; ingen betalningshistorik"
                  : "Open items only; no payment history",
              },
            ]}
            onValueChange={(value) => {
              field.handleChange(value === "confirmed");
              field.handleBlur();
            }}
          />
        )}
      </form.Field>
      <form.Subscribe selector={(state) => state.submissionAttempts > 0 && !state.isValid}>
        {(invalid) =>
          invalid ? (
            <Text role="alert">
              {sv
                ? "Ange grund och bekräfta omfattningen."
                : "Enter a rationale and confirm the scope."}
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
            {sv ? "Återförsök samma registerimport" : "Retry same register import"}
          </Button>
        ) : (
          <Button type="submit" disabled={disabled}>
            {sv ? "Spara historiskt register" : "Save historical register"}
          </Button>
        )}
      </Box>
    </Box>
  );
}
