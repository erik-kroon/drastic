import { useRef } from "react";
import { useForm } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import * as Schema from "effect/Schema";
import * as Connector from "@open-erp/contracts/bank-connector";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { InputField, SelectField } from "@open-erp/ui/components/field";
import { Text } from "@open-erp/ui/components/typography";
import { AccountingStatus } from "@/components/accounting-status";
import { useBookWorkspace } from "@/lib/book-context";
import {
  bookPath,
  mutationOptions,
  readAccounting,
  isUncertainWriteError,
} from "@/lib/accounting-api";
import { checkScope } from "@/components/commerce/shared";

const review = Schema.Struct({
  ...Connector.SaveConnectorConsent.fields,
  confirmed: Schema.Literal(true),
});

export function ConsentForm({ onSaved }: { onSaved: (id: string) => void }) {
  const { book, setup, locale } = useBookWorkspace();
  const sv = locale === "sv";
  const keys = useRef(new Map<string, string>());
  const path = `${bookPath(book)}/bank-connector-consents`;

  const save = useMutation({
    mutationFn: async (input: typeof Connector.SaveConnectorConsent.Type) => {
      const result = await readAccounting(
        path,
        Connector.ConnectorConsent,
        mutationOptions(path, JSON.stringify(input), keys.current),
      );

      checkScope(book, result.scope);

      return result;
    },
    onSuccess: (result) => onSaved(result.id),
  });

  const uncertain = isUncertainWriteError(save.error);
  const disabled = book.role !== "operator" || save.isPending || uncertain || save.isSuccess;

  const form = useForm({
    defaultValues: {
      providerId: "",
      externalAccountId: "",
      sourceAccountId: "",
      accountId: "",
      consentReference: "",
      rationale: "",
      confirmed: false,
    },
    validators: {
      onSubmit: ({ value }) =>
        Schema.is(review)(value)
          ? undefined
          : "Complete the mapping and confirm the retained consent.",
    },
    onSubmit: async ({ value }) => {
      await save
        .mutateAsync({
          providerId: value.providerId,
          externalAccountId: value.externalAccountId,
          sourceAccountId: value.sourceAccountId,
          accountId: value.accountId,
          consentReference: value.consentReference,
          rationale: value.rationale,
        })
        .catch(() => undefined);
    },
  });

  const fields = [
    {
      name: "providerId",
      label: sv ? "Leverantörens kod" : "Provider code",
      hint: sv
        ? "Leverantörens identifierare, med små bokstäver, exempelvis plaid."
        : "The provider identifier in lowercase, for example plaid.",
    },
    {
      name: "externalAccountId",
      label: sv ? "Kontoreferens hos leverantören" : "Provider account reference",
      hint: sv
        ? "Referensen för det konto som samtycket gäller."
        : "The account reference covered by the retained consent.",
    },
    {
      name: "sourceAccountId",
      label: sv ? "Kontoreferens i kontoutdrag" : "Statement account reference",
      hint: sv
        ? "Använd samma referens som i tidigare importer, exempelvis bank_main."
        : "Use the same reference as previous statement imports, for example bank_main.",
    },
    {
      name: "consentReference",
      label: sv ? "Samtyckets underlag" : "Consent evidence reference",
      hint: sv
        ? "Referens till det sparade samtycket hos leverantören."
        : "Reference to the consent already retained with the provider.",
    },
    { name: "rationale", label: sv ? "Grund för kontokopplingen" : "Mapping rationale", hint: "" },
  ] satisfies {
    name: "providerId" | "externalAccountId" | "sourceAccountId" | "consentReference" | "rationale";
    label: string;
    hint: string;
  }[];

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
          ? "Registrera ett befintligt samtycke och det konto som ska användas i bokföringen. Detta ger inte OpenERP åtkomst till banken."
          : "Record existing consent and its ledger account mapping. This does not grant OpenERP access to the bank."}
      </Text>
      {fields.map(({ name, label, hint }) => (
        <Box key={name} display="grid" gap="xs">
          <form.Field name={name}>
            {(field) => (
              <InputField
                label={label}
                value={field.state.value}
                maxLength={200}
                required
                disabled={disabled}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
              />
            )}
          </form.Field>
          {hint ? <Text tone="muted">{hint}</Text> : null}
        </Box>
      ))}
      <form.Field name="accountId">
        {(field) => (
          <SelectField
            label={sv ? "Bokföringskonto" : "Ledger account"}
            value={field.state.value}
            disabled={disabled}
            options={[
              { value: "", label: sv ? "Välj konto" : "Select account" },
              ...setup.accounts
                .filter((account) => account.active)
                .map((account) => ({
                  value: account.id,
                  label: `${account.code} · ${account.name}`,
                })),
            ]}
            onValueChange={(value) => {
              field.handleChange(value ?? "");
              field.handleBlur();
            }}
          />
        )}
      </form.Field>
      {setup.accounts.length === 0 ? (
        <Text>
          {sv
            ? "Kontoplanen behöver skapas innan ett konto kan kopplas."
            : "The chart of accounts must be set up before an account can be mapped."}
        </Text>
      ) : null}
      <form.Field name="confirmed">
        {(field) => (
          <SelectField
            label={sv ? "Granska samtycke och konto" : "Review consent and account"}
            value={field.state.value ? "confirmed" : ""}
            disabled={disabled}
            options={[
              { value: "", label: sv ? "Välj efter granskning" : "Choose after review" },
              {
                value: "confirmed",
                label: sv
                  ? "Befintligt samtycke och kontokoppling granskade"
                  : "Existing consent and account mapping reviewed",
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
                ? "Kontrollera referenserna, välj konto och bekräfta granskningen."
                : "Check the references, select an account and confirm the review."}
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
            {sv ? "Återförsök samma registrering" : "Retry same consent record"}
          </Button>
        ) : (
          <Button type="submit" disabled={disabled || setup.accounts.length === 0}>
            {sv ? "Spara samtycke och konto" : "Save consent and mapping"}
          </Button>
        )}
      </Box>
    </Box>
  );
}
