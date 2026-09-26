import { useForm } from "@tanstack/react-form";
import * as Schema from "effect/Schema";
import * as Historical from "@open-erp/contracts/historical-migration";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { InputField } from "@open-erp/ui/components/field";
import { Text } from "@open-erp/ui/components/typography";
import { useBookWorkspace } from "@/lib/book-context";

export type EntryKind = "payments" | "matches" | "paymentControls" | "matchControls";

export type HistoryEntry =
  | { kind: "payments"; value: typeof Historical.Payment.Type }
  | { kind: "matches"; value: typeof Historical.HistoricalMatch.Type }
  | { kind: "paymentControls" | "matchControls"; value: typeof Historical.AmountControl.Type };

const empty = () => ({
  sourceIdentity: "",
  sourceAccount: "",
  currency: "",
  amountMinor: "",
  sourceDate: "",
  basis: "",
  itemIdentity: "",
  paymentIdentity: "",
  independentTotalMinor: "",
});

type Draft = ReturnType<typeof empty>;

function decodeEntry(kind: EntryKind, draft: Draft): HistoryEntry | null {
  if (kind === "payments") {
    const value = {
      sourceIdentity: draft.sourceIdentity,
      sourceAccount: draft.sourceAccount,
      currency: draft.currency,
      amountMinor: draft.amountMinor,
      sourceDate: draft.sourceDate || null,
      basis: draft.basis,
    };

    return Schema.is(Historical.Payment)(value) ? { kind, value } : null;
  }

  if (kind === "matches") {
    const value = {
      sourceIdentity: draft.sourceIdentity,
      itemIdentity: draft.itemIdentity,
      paymentIdentity: draft.paymentIdentity,
      amountMinor: draft.amountMinor,
      sourceDate: draft.sourceDate || null,
      basis: draft.basis,
    };

    return Schema.is(Historical.HistoricalMatch)(value) ? { kind, value } : null;
  }

  const value = {
    sourceAccount: draft.sourceAccount,
    currency: draft.currency,
    independentTotalMinor: draft.independentTotalMinor,
    basis: draft.basis,
  };

  return Schema.is(Historical.AmountControl)(value) ? { kind, value } : null;
}

export function PaymentHistoryEntry({
  kind,
  disabled,
  onAdd,
  onDraftChange,
}: {
  kind: EntryKind;
  disabled: boolean;
  onAdd: (entry: HistoryEntry) => void;
  onDraftChange: (dirty: boolean) => void;
}) {
  const { locale } = useBookWorkspace();
  const sv = locale === "sv";

  const titles = sv
    ? {
        payments: "Lägg till källbetalning",
        matches: "Lägg till källmatchning",
        paymentControls: "Lägg till betalningskontroll",
        matchControls: "Lägg till matchningskontroll",
      }
    : {
        payments: "Add source payment",
        matches: "Add source match",
        paymentControls: "Add payment control",
        matchControls: "Add match control",
      };

  const labels = sv
    ? {
        sourceIdentity: "Källidentitet",
        sourceAccount: "Källkonto",
        currency: "Valuta (ISO-kod)",
        amountMinor: "Belopp i minsta valutaenhet",
        sourceDate: "Källdatum (ÅÅÅÅ-MM-DD, tomt om okänt)",
        basis: "Oberoende källa eller underlag",
        itemIdentity: "Öppen posts källidentitet",
        paymentIdentity: "Betalningens källidentitet",
        independentTotalMinor: "Oberoende totalsumma i minsta valutaenhet",
      }
    : {
        sourceIdentity: "Source identity",
        sourceAccount: "Source account",
        currency: "Currency (ISO code)",
        amountMinor: "Amount in minor units",
        sourceDate: "Source date (YYYY-MM-DD, blank if unknown)",
        basis: "Independent source or evidence",
        itemIdentity: "Open item source identity",
        paymentIdentity: "Payment source identity",
        independentTotalMinor: "Independent total in minor units",
      };

  const fields: (keyof Draft)[] =
    kind === "payments"
      ? ["sourceIdentity", "sourceAccount", "currency", "amountMinor", "sourceDate", "basis"]
      : kind === "matches"
        ? [
            "sourceIdentity",
            "itemIdentity",
            "paymentIdentity",
            "amountMinor",
            "sourceDate",
            "basis",
          ]
        : ["sourceAccount", "currency", "independentTotalMinor", "basis"];

  const form = useForm({
    defaultValues: empty(),
    validators: {
      onSubmit: ({ value }) =>
        decodeEntry(kind, value)
          ? undefined
          : sv
            ? "Kontrollera postens uppgifter."
            : "Check the entry details.",
    },
    onSubmit: ({ value }) => {
      const entry = decodeEntry(kind, value);

      if (entry) {
        onAdd(entry);
        form.reset(empty());
        onDraftChange(false);
      }
    },
  });

  return (
    <details>
      <summary>{titles[kind]}</summary>
      <Box
        display="grid"
        gap="sm"
        onKeyDown={(event) => {
          if (event.key === "Enter" && event.target instanceof HTMLInputElement) {
            event.preventDefault();
            void form.handleSubmit();
          }
        }}
      >
        {fields.map((name) => (
          <form.Field key={name} name={name}>
            {(field) => (
              <InputField
                label={labels[name]}
                value={field.state.value}
                disabled={disabled}
                maxLength={name === "basis" ? 2000 : 200}
                onBlur={field.handleBlur}
                onChange={(event) => {
                  field.handleChange(event.target.value);
                  onDraftChange(true);
                }}
              />
            )}
          </form.Field>
        ))}
        <form.Subscribe selector={(state) => state.errors}>
          {(errors) => <Text role="alert">{errors.join(" ")}</Text>}
        </form.Subscribe>
        <Box display="flex" flexWrap="wrap" gap="sm">
          <Button
            type="button"
            disabled={disabled}
            onClick={() => {
              void form.handleSubmit();
            }}
          >
            {sv ? "Lägg till i registret" : "Add to register"}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            onClick={() => {
              form.reset(empty());
              onDraftChange(false);
            }}
          >
            {sv ? "Rensa utkast" : "Clear draft"}
          </Button>
        </Box>
      </Box>
    </details>
  );
}
