import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as Schema from "effect/Schema";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Commerce from "@open-erp/contracts/commerce";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { InputField, TextareaField } from "@open-erp/ui/components/field";
import { ChoiceField } from "@open-erp/ui/components/choice-field";
import { PageCaption } from "@open-erp/ui/components/accounting-page";
import { AccountingStatus } from "@/components/accounting-status";
import { useSavedPostingRequests } from "@/components/posting-recovery/saved-requests";
import { sendSavedPostingCommand } from "@/components/posting-recovery/request";
import { readAccounting } from "@/lib/accounting-api";
import { checkScope, commerceKey, commercePath, type CommerceProps } from "./shared";

type Party = typeof Commerce.CounterpartyRevision.Type;
const ContactInput = Schema.Struct({
  displayName: Commerce.CreateCounterparty.fields.displayName,
  externalKey: Commerce.CreateCounterparty.fields.externalKey,
  role: Commerce.CreateCounterparty.fields.role,
  reason: Commerce.CreateCounterparty.fields.reason,
});
export function ContactEditor(
  props: CommerceProps & {
    baseline?: Party;
    customerOnly?: boolean;
    defaultRole?: "customer" | "supplier";
    onSaved: (party: Party) => void;
  },
) {
  const { book, locale, baseline, onSaved } = props;
  const sv = locale === "sv";
  const client = useQueryClient();
  const requests = useSavedPostingRequests(book);
  const [key] = useState(() => crypto.randomUUID());
  const [invalid, setInvalid] = useState(false);
  const save = useMutation({
    mutationFn: async (input: typeof ContactInput.Type) => {
      if (!requests.data || requests.isError)
        throw new Error(sv ? "Behörigheten kunde inte läsas." : "Your access could not be loaded.");
      const source = await sendSavedPostingCommand({
        book,
        actorId: requests.data.actorId,
        command: {
          operation: "create_evidence",
          input: {
            title: input.displayName,
            origin: "Contact entered in OpenERP",
            mediaType: "application/json",
            content: JSON.stringify(input),
          },
        },
        storageMessage: sv
          ? "Tillåt lokal lagring för att spara kontakten."
          : "Allow local storage to save the contact.",
      });
      if (
        source.outcome?.state !== "committed" ||
        !Schema.is(Accounting.Evidence)(source.outcome.result)
      )
        throw new Error(
          sv
            ? "Underlaget är inte bekräftat. Försök igen."
            : "The source is not confirmed. Retry the save.",
        );
      const evidenceId = source.outcome.result.id;
      const payload = baseline
        ? Schema.decodeSync(Commerce.ReviseCounterparty)({
            expectedRevision: baseline.revision,
            displayName: input.displayName,
            evidenceId,
            reason: input.reason,
          })
        : Schema.decodeSync(Commerce.CreateCounterparty)({
            kind: "synthetic_counterparty_v1",
            ...input,
            evidenceId,
          });
      const path = `${commercePath(book)}/counterparties${baseline ? `/${encodeURIComponent(baseline.id)}/revisions` : ""}`;
      const result = await readAccounting(path, Commerce.CounterpartyRevision, {
        method: "POST",
        body: JSON.stringify(payload),
        headers: { "Idempotency-Key": key },
      });
      checkScope(book, result.scope);
      return result;
    },
    onSuccess: (party) => {
      void client.invalidateQueries({ queryKey: commerceKey(book) });
      onSaved(party);
    },
    retry: false,
  });
  return (
    <Box
      as="form"
      display="grid"
      gap="lg"
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (save.variables || book.role !== "operator") return;
        const fields = new FormData(event.currentTarget);
        const parsed = Schema.decodeUnknownOption(ContactInput)({
          displayName: fields.get("displayName"),
          externalKey: baseline?.externalKey ?? (fields.get("externalKey") || `contact_${key}`),
          role: baseline?.role ?? (props.customerOnly ? "customer" : fields.get("role")),
          reason: fields.get("reason") || (sv ? "Kontakt tillagd" : "Contact added"),
        });
        setInvalid(parsed._tag === "None");
        if (parsed._tag === "Some") save.mutate(parsed.value);
      }}
    >
      <Box
        as="fieldset"
        disabled={!!save.variables || book.role !== "operator"}
        display="grid"
        gap="lg"
        borderWidth="none"
        margin="none"
        padding="none"
      >
        <InputField
          name="displayName"
          label={sv ? "Namn" : "Name"}
          required
          maxLength={200}
          defaultValue={baseline?.displayName}
        />
        {!baseline ? (
          <Box display="grid" gap="lg">
            {!props.customerOnly ? (
              <ChoiceField
                name="role"
                label={sv ? "Kontakttyp" : "Contact type"}
                defaultValue={props.defaultRole ?? "customer"}
                options={[
                  { value: "customer", label: sv ? "Kund" : "Customer" },
                  { value: "supplier", label: sv ? "Leverantör" : "Supplier" },
                  { value: "both", label: sv ? "Kund och leverantör" : "Customer & supplier" },
                ]}
              />
            ) : null}
            <InputField
              name="externalKey"
              label={
                sv ? "Kontaktnummer / referens (valfritt)" : "Contact number / reference (optional)"
              }
              maxLength={200}
            />
          </Box>
        ) : null}
        <TextareaField
          name="reason"
          label={
            baseline
              ? sv
                ? "Vad ändrades?"
                : "What changed?"
              : sv
                ? "Anteckning (valfritt)"
                : "Note (optional)"
          }
          required={!!baseline}
          maxLength={2000}
          rows={3}
        />
        <PageCaption>
          {sv
            ? "Uppgifterna du anger sparas med kontakten och dess historik."
            : "The details you enter are retained with the contact and its history."}
        </PageCaption>
        <Box>
          <Button type="submit" disabled={requests.isPending || requests.isError}>
            {sv ? "Spara kontakt" : "Save contact"}
          </Button>
        </Box>
      </Box>
      {invalid ? (
        <PageCaption>
          {sv ? "Kontrollera kontaktuppgifterna." : "Check the contact details."}
        </PageCaption>
      ) : null}
      <AccountingStatus
        locale={locale}
        write
        pending={save.isPending}
        error={save.error ?? requests.error}
      />
      {save.isError && save.variables ? (
        <Box>
          <Button
            variant="outline"
            onClick={() => {
              if (save.variables) save.mutate(save.variables);
            }}
          >
            {sv ? "Försök spara igen" : "Retry save"}
          </Button>
        </Box>
      ) : null}
    </Box>
  );
}
