import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Crm from "@open-erp/contracts/crm-master";
import * as Commerce from "@open-erp/contracts/commerce";
import * as Schema from "effect/Schema";
import * as Option from "effect/Option";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { InputField, SelectField } from "@open-erp/ui/components/field";
import { Text } from "@open-erp/ui/components/typography";
import { RecordSection } from "@open-erp/ui/components/record-layout";
import { AccountingStatus } from "@/components/accounting-status";
import { mutationOptions, readAccounting } from "@/lib/accounting-api";
import { checkScope, commerceKey, commercePath, type CommerceProps } from "./shared";
import { restoredField, type DraftSession } from "./invoice-draft-session";

export function customerDefaultsQuery(book: CommerceProps["book"], partyId: string) {
  return {
    queryKey: [...commerceKey(book), "customer-invoice-defaults", partyId],
    queryFn: async ({ signal }: { signal: AbortSignal }) => {
      try {
        const record = await readAccounting(
          `${commercePath(book)}/directory/${encodeURIComponent(partyId)}/invoice-defaults`,
          Crm.CustomerInvoiceDefaults,
          { signal },
        );

        checkScope(book, record.scope);

        if (record.partyId !== partyId) throw new Error("Customer defaults identity mismatch");

        return record;
      } catch (error) {
        if (error instanceof Accounting.AccountingError && error.code === "NotFound") return null;
        throw error;
      }
    },
    retry: false,
  };
}

export function InvoiceDefaultsSelection(props: CommerceProps & { session: DraftSession }) {
  const { session, book, locale } = props;
  const partyId = session.state.customer?.id ?? "";
  const sv = locale === "sv";
  const defaults = useQuery({ ...customerDefaultsQuery(book, partyId), enabled: partyId !== "" });
  const [superseded, setSuperseded] = useState(false);

  const apply = useMutation({
    mutationFn: async () => {
      const record = defaults.data;

      if (!record) throw new Error("Choose retained invoice defaults");

      const invoiceDate = restoredField(
        session,
        "issueDate",
        session.state.baseline?.content.plannedIssueDate ?? "",
      );

      const input = Schema.decodeSync(Crm.ApplyCustomerInvoiceDefaults)({
        reference: { partyId: record.partyId, revision: record.revision, digest: record.digest },
        invoiceDate,
      });

      const copy = await readAccounting(
        `${commercePath(book)}/directory/${encodeURIComponent(partyId)}/invoice-defaults/apply`,
        Crm.CopiedCustomerInvoiceDefaults,
        { method: "POST", body: JSON.stringify(input) },
      );

      checkScope(book, copy.scope);

      if (
        copy.reference.partyId !== partyId ||
        copy.reference.revision !== input.reference.revision ||
        copy.reference.digest !== input.reference.digest ||
        copy.invoiceDate !== input.invoiceDate
      )
        throw new Error("Copied defaults identity mismatch");

      return copy;
    },
    onSuccess: (copy) => {
      const invoiceDate = restoredField(
        session,
        "issueDate",
        session.state.baseline?.content.plannedIssueDate ?? "",
      );

      const changed =
        session.state.customer?.id !== copy.reference.partyId || invoiceDate !== copy.invoiceDate;

      setSuperseded(changed);

      if (changed) return;
      session.update({
        customerDefaultsSelection: copy.reference,
        dueDateOrigin: "customer_default",
        copiedCustomerDefaults: copy,
        fields: { ...session.state.fields, dueDate: copy.dueDate, terms: copy.paymentTerms },
      });
    },
    retry: false,
  });

  if (!partyId) return null;
  const selection = session.state.customerDefaultsSelection;

  return (
    <Box display="grid" gap="sm">
      <AccountingStatus
        locale={locale}
        pending={defaults.isPending || apply.isPending}
        error={defaults.error ?? apply.error}
      />
      {defaults.data ? (
        <Button
          type="button"
          variant="outline"
          disabled={apply.isPending}
          onClick={() => apply.mutate()}
        >
          {selection
            ? sv
              ? "Ersätt fakturastandardvärden"
              : "Replace invoice defaults"
            : sv
              ? "Använd fakturastandardvärden"
              : "Apply invoice defaults"}
        </Button>
      ) : null}
      {superseded ? (
        <Text role="status">
          {sv
            ? "Fakturan ändrades. Använd standardvärdena igen."
            : "The invoice changed. Apply the defaults again."}
        </Text>
      ) : null}
      {selection ? (
        <Text tone="muted">
          {sv ? "Kopierade standardvärden" : "Copied defaults"} · {selection.revision} ·{" "}
          {session.state.copiedCustomerDefaults?.language} ·{" "}
          {session.state.copiedCustomerDefaults?.currency}
        </Text>
      ) : null}
    </Box>
  );
}

export function CustomerInvoiceDefaults(
  props: CommerceProps & { party: typeof Commerce.CounterpartyRevision.Type },
) {
  const { book, locale, party } = props;
  const sv = locale === "sv";
  const client = useQueryClient();
  const [keys] = useState(() => new Map<string, string>());
  const defaults = useQuery(customerDefaultsQuery(book, party.id));

  const recipient = useQuery({
    queryKey: [...commerceKey(book), "customer-recipient", party.id],
    queryFn: async ({ signal }) => {
      try {
        const record = await readAccounting(
          `${commercePath(book)}/directory/${encodeURIComponent(party.id)}/recipient`,
          Crm.ReviewedCustomerRecipient,
          { signal },
        );

        checkScope(book, record.scope);

        if (record.partyId !== party.id) throw new Error("Reviewed recipient identity mismatch");

        return record;
      } catch (error) {
        if (error instanceof Accounting.AccountingError && error.code === "NotFound") return null;
        throw error;
      }
    },
    retry: false,
  });

  const saveRecipient = useMutation({
    mutationFn: (input: typeof Crm.SaveCustomerRecipient.Type) => {
      const path = `${commercePath(book)}/directory/${encodeURIComponent(party.id)}/recipient`;

      return readAccounting(
        path,
        Crm.ReviewedCustomerRecipient,
        mutationOptions(path, JSON.stringify(input), keys),
      );
    },
    onSuccess: () => {
      void client.invalidateQueries({
        queryKey: [...commerceKey(book), "customer-recipient", party.id],
      });
    },
    retry: false,
  });

  const saveDefaults = useMutation({
    mutationFn: (input: typeof Crm.SaveCustomerInvoiceDefaults.Type) => {
      const path = `${commercePath(book)}/directory/${encodeURIComponent(party.id)}/invoice-defaults`;

      return readAccounting(
        path,
        Crm.CustomerInvoiceDefaults,
        mutationOptions(path, JSON.stringify(input), keys),
      );
    },
    onSuccess: () => {
      void client.invalidateQueries({
        queryKey: [...commerceKey(book), "customer-invoice-defaults", party.id],
      });
    },
    retry: false,
  });

  return (
    <Box display="grid" gap="lg">
      <RecordSection title={sv ? "Granskad fakturamottagare" : "Reviewed invoice recipient"}>
        <AccountingStatus locale={locale} pending={recipient.isPending} error={recipient.error} />
        <Text tone="muted">
          {sv
            ? "Granskningen behåller kundens underlag. Den verifierar inte e-postägande och skickar inget meddelande."
            : "Review retains the customer's evidence. It does not verify mailbox ownership or send a message."}
        </Text>
        {recipient.isSuccess ? (
          <RecipientForm
            {...props}
            recipient={recipient.data}
            save={saveRecipient.mutate}
            pending={saveRecipient.isPending}
            error={saveRecipient.error}
          />
        ) : null}
      </RecordSection>
      <RecordSection title={sv ? "Fakturastandardvärden" : "Invoice defaults"}>
        <AccountingStatus locale={locale} pending={defaults.isPending} error={defaults.error} />
        {defaults.isSuccess ? (
          <DefaultsForm
            {...props}
            defaults={defaults.data}
            recipient={recipient.data}
            save={saveDefaults.mutate}
            pending={saveDefaults.isPending}
            error={saveDefaults.error}
          />
        ) : null}
      </RecordSection>
    </Box>
  );
}

function RecipientForm(
  props: CommerceProps & {
    party: typeof Commerce.CounterpartyRevision.Type;
    recipient: typeof Crm.ReviewedCustomerRecipient.Type | null;
    save: (input: typeof Crm.SaveCustomerRecipient.Type) => void;
    pending: boolean;
    error: Error | null;
  },
) {
  const { book, locale, party } = props;
  const sv = locale === "sv";
  const [invalid, setInvalid] = useState(false);

  return (
    <Box
      key={props.recipient?.revision ?? "new"}
      as="form"
      display="grid"
      gap="md"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);

        const parsed = Schema.decodeUnknownOption(Crm.SaveCustomerRecipient)({
          expectedRevision: props.recipient?.revision ?? "0",
          expectedDigest: props.recipient?.digest ?? null,
          channel: "email",
          destination: form.get("destination"),
          purposes:
            form.get("purpose") === "both"
              ? ["invoice_delivery", "payment_reminder"]
              : [form.get("purpose")],
          status: form.get("status"),
          reviewEvidence: party.evidence,
          reason: form.get("reason"),
          acknowledgeReviewedRecipient: form.get("reviewed") === "on",
        });

        setInvalid(Option.isNone(parsed));

        if (Option.isSome(parsed)) props.save(parsed.value);
      }}
    >
      <InputField
        name="destination"
        type="email"
        label={sv ? "E-postadress" : "Email destination"}
        required
        maxLength={254}
        defaultValue={props.recipient?.destination ?? ""}
      />
      <SelectField
        name="purpose"
        label={sv ? "Användning" : "Purpose"}
        defaultValue={
          props.recipient?.purposes.length === 2
            ? "both"
            : (props.recipient?.purposes[0] ?? "invoice_delivery")
        }
        options={[
          { value: "invoice_delivery", label: sv ? "Fakturaleverans" : "Invoice delivery" },
          {
            value: "payment_reminder",
            label: sv ? "Betalningspåminnelse" : "Payment reminder",
          },
          { value: "both", label: sv ? "Båda" : "Both" },
        ]}
      />
      <SelectField
        name="status"
        label={sv ? "Status" : "Status"}
        defaultValue={props.recipient?.status ?? "reviewed"}
        options={[
          { value: "reviewed", label: sv ? "Granskad" : "Reviewed" },
          { value: "withdrawn", label: sv ? "Återkallad" : "Withdrawn" },
        ]}
      />
      <InputField
        name="reason"
        label={sv ? "Granskningsorsak" : "Review reason"}
        required
        maxLength={1000}
      />
      <InputField
        name="reviewed"
        type="checkbox"
        label={
          sv
            ? "Jag har granskat mottagaren mot kundens underlag"
            : "I reviewed the recipient against the customer's evidence"
        }
        required
      />
      <Text tone="muted">{party.evidence.evidenceId}</Text>
      <Button type="submit" disabled={book.role !== "operator" || props.pending}>
        {sv ? "Spara mottagarrevision" : "Save recipient revision"}
      </Button>
      <AccountingStatus locale={locale} write pending={props.pending} error={props.error} />
      {invalid ? (
        <Text role="alert">
          {sv
            ? "Kontrollera mottagare, granskning och orsak."
            : "Check the recipient, review and reason."}
        </Text>
      ) : null}
    </Box>
  );
}

function DefaultsForm(
  props: CommerceProps & {
    party: typeof Commerce.CounterpartyRevision.Type;
    defaults: typeof Crm.CustomerInvoiceDefaults.Type | null;
    recipient: typeof Crm.ReviewedCustomerRecipient.Type | null | undefined;
    save: (input: typeof Crm.SaveCustomerInvoiceDefaults.Type) => void;
    pending: boolean;
    error: Error | null;
  },
) {
  const { book, locale, party } = props;
  const sv = locale === "sv";
  const [invalid, setInvalid] = useState(false);

  return (
    <Box
      key={props.defaults?.revision ?? "new"}
      as="form"
      display="grid"
      gap="md"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);

        const selected =
          form.get("recipient") === "reviewed" && props.recipient?.status === "reviewed"
            ? props.recipient
            : null;

        const parsed = Schema.decodeUnknownOption(Crm.SaveCustomerInvoiceDefaults)({
          expectedRevision: props.defaults?.revision ?? "0",
          expectedDigest: props.defaults?.digest ?? null,
          terms: { kind: "calendar_days_v1", days: Number(form.get("days")) },
          currency: book.currency,
          language: form.get("language"),
          recipient:
            selected === null
              ? null
              : {
                  partyId: selected.partyId,
                  revision: selected.revision,
                  digest: selected.digest,
                },
          reviewEvidence: party.evidence,
          reason: form.get("reason"),
        });

        setInvalid(Option.isNone(parsed));

        if (Option.isSome(parsed)) props.save(parsed.value);
      }}
    >
      <InputField
        name="days"
        type="number"
        label={sv ? "Kalenderdagar" : "Calendar days"}
        min={0}
        max={365}
        required
        defaultValue={props.defaults?.terms.days ?? 14}
      />
      <SelectField
        name="language"
        label={sv ? "Språk för betalningsvillkor" : "Payment terms language"}
        defaultValue={props.defaults?.language ?? locale}
        options={[
          { value: "en", label: "English" },
          { value: "sv", label: "Svenska" },
        ]}
      />
      <SelectField
        name="recipient"
        label={sv ? "Mottagarreferens" : "Recipient reference"}
        defaultValue={props.defaults?.recipient === null || !props.defaults ? "none" : "reviewed"}
        options={[
          { value: "none", label: sv ? "Ingen" : "None" },
          ...(props.recipient?.status === "reviewed" &&
          props.recipient.purposes.includes("invoice_delivery")
            ? [
                {
                  value: "reviewed",
                  label: `${props.recipient.destination} · ${props.recipient.revision}`,
                },
              ]
            : []),
        ]}
      />
      <Text>{book.currency}</Text>
      <InputField
        name="reason"
        label={sv ? "Ändringsorsak" : "Change reason"}
        required
        maxLength={1000}
      />
      <Button type="submit" disabled={book.role !== "operator" || props.pending}>
        {sv ? "Spara standardrevision" : "Save defaults revision"}
      </Button>
      <AccountingStatus locale={locale} write pending={props.pending} error={props.error} />
      {invalid ? (
        <Text role="alert">
          {sv ? "Kontrollera standardvärden och orsak." : "Check the defaults and reason."}
        </Text>
      ) : null}
    </Box>
  );
}
