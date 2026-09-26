import { PaymentHistoryEntry, type EntryKind } from "./payment-entry";
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
  chronology: Historical.AdmitItems.fields.chronology,
  payments: Historical.AdmitItems.fields.payments,
  matches: Historical.AdmitItems.fields.matches,
  paymentControls: Historical.AdmitItems.fields.paymentControls,
  matchControls: Historical.AdmitItems.fields.matchControls,
  drafts: Schema.Struct({
    payments: Schema.Literal(false),
    matches: Schema.Literal(false),
    paymentControls: Schema.Literal(false),
    matchControls: Schema.Literal(false),
  }),
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
    defaultValues: {
      rationale: "",
      confirmed: false,
      chronology: "unknown",
      payments: [...Schema.decodeSync(Historical.AdmitItems.fields.payments)([])],
      matches: [...Schema.decodeSync(Historical.AdmitItems.fields.matches)([])],
      paymentControls: [...Schema.decodeSync(Historical.AdmitItems.fields.paymentControls)([])],
      matchControls: [...Schema.decodeSync(Historical.AdmitItems.fields.matchControls)([])],
      drafts: { payments: false, matches: false, paymentControls: false, matchControls: false },
    },
    validators: {
      onSubmit: ({ value }) =>
        Schema.is(review)(value)
          ? undefined
          : "Complete the register, add or clear drafts, and confirm the scope.",
    },
    onSubmit: async ({ value }) => {
      await save
        .mutateAsync({
          planDigest: plan.digest,
          payments: value.payments,
          matches: value.matches,
          paymentControls: value.paymentControls,
          matchControls: value.matchControls,
          chronology: Schema.decodeUnknownSync(Historical.AdmitItems.fields.chronology)(
            value.chronology,
          ),
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
          ? "Spara planens öppna poster och eventuell tillgänglig betalningshistorik. Lägg bara till belagda betalningar och matchningar, med oberoende kontrollsummor per konto och valuta. Registret kan inte ändras efteråt och skapar inga bokföringsposter."
          : "Save the plan’s open items and any supplied payment history. Add only evidenced payments and matches, with independent control totals per account and currency. The register cannot be amended afterward and creates no ledger postings."}
      </Text>
      {(["payments", "matches", "paymentControls", "matchControls"] satisfies EntryKind[]).map(
        (kind) => (
          <Box key={kind} display="grid" gap="sm">
            <PaymentHistoryEntry
              kind={kind}
              disabled={disabled}
              onDraftChange={(dirty) => form.setFieldValue(`drafts.${kind}`, dirty)}
              onAdd={(entry) => {
                if (entry.kind === "payments") form.pushFieldValue("payments", entry.value);
                else if (entry.kind === "matches") form.pushFieldValue("matches", entry.value);
                else if (entry.kind === "paymentControls")
                  form.pushFieldValue("paymentControls", entry.value);
                else form.pushFieldValue("matchControls", entry.value);
              }}
            />
            <form.Field name={kind} mode="array">
              {(field) => (
                <Box display="grid" gap="sm">
                  {field.state.value.map((entry, index) => (
                    <Box key={index} display="grid" gap="sm">
                      <Text>
                        {"sourceIdentity" in entry
                          ? entry.sourceIdentity
                          : `${entry.sourceAccount} · ${entry.currency}`}{" "}
                        · {"amountMinor" in entry ? entry.amountMinor : entry.independentTotalMinor}{" "}
                        · {entry.basis}
                      </Text>
                      {"sourceIdentity" in entry ? (
                        <Text>
                          {"paymentIdentity" in entry
                            ? `${entry.paymentIdentity} → ${entry.itemIdentity}`
                            : `${entry.sourceAccount} · ${entry.currency}`}{" "}
                          · {entry.sourceDate ?? (sv ? "Okänt datum" : "Unknown date")}
                        </Text>
                      ) : null}
                      <Box>
                        <Button
                          type="button"
                          variant="ghost"
                          disabled={disabled}
                          onClick={() => field.removeValue(index)}
                        >
                          {sv ? "Ta bort från utkastet" : "Remove from draft"}
                        </Button>
                      </Box>
                    </Box>
                  ))}
                </Box>
              )}
            </form.Field>
          </Box>
        ),
      )}
      <form.Field name="chronology">
        {(field) => (
          <SelectField
            label={sv ? "Betalningskronologi" : "Payment chronology"}
            value={field.state.value}
            disabled={disabled}
            options={[
              {
                value: "unknown",
                label: sv ? "Okänd eller ofullständig" : "Unknown or incomplete",
              },
              {
                value: "dated_source",
                label: sv
                  ? "Källdatum för alla betalningar och matchningar"
                  : "Source dates for every payment and match",
              },
            ]}
            onValueChange={(value) => field.handleChange(value ?? "unknown")}
          />
        )}
      </form.Field>
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
                  ? "Tillagda poster och saknad historik granskade"
                  : "Added records and missing history reviewed",
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
                ? "Ange grund, lägg till eller rensa utkast och bekräfta omfattningen."
                : "Enter a rationale, add or clear drafts, and confirm the scope."}
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
