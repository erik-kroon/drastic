import { useForm } from "@tanstack/react-form";
import * as Schema from "effect/Schema";
import * as Sie from "@open-erp/contracts/sie-import";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { InputField, SelectField } from "@open-erp/ui/components/field";
import { Text } from "@open-erp/ui/components/typography";
import { useBookWorkspace } from "@/lib/book-context";

type Item = typeof Sie.HistoricalOpenItem.Type;
type Control = typeof Sie.OpenItemControl.Type;
function emptyItem(): Item {
  return {
    sourceIdentity: "",
    sourceAccount: "",
    currency: "",
    originalMinor: "",
    outstandingMinor: "",
    asOf: "",
    assertedState: "unknown",
    detailAvailability: "unreconstructable",
    basis: "",
  };
}
function emptyControl(): Control {
  return { sourceAccount: "", currency: "", independentOutstandingMinor: "", basis: "" };
}
type Props<T> = {
  disabled: boolean;
  sourceAccounts: string[];
  onAdd: (value: T) => void;
  onDraftChange: (dirty: boolean) => void;
};

export function SavedOpenItems({ plan }: { plan: typeof Sie.SiePlan.Type }) {
  const { locale } = useBookWorkspace();
  const sv = locale === "sv";
  return (
    <details>
      <summary>
        {sv ? "Sparade öppna poster" : "Saved open items"} ({plan.input.openItems.length})
      </summary>
      <Box display="grid" gap="lg" paddingBlock="md">
        {plan.input.openItems.map((item) => (
          <Box key={item.sourceIdentity} display="grid" gap="sm">
            <Text>
              {item.sourceIdentity} · {item.sourceAccount} · {item.asOf}
            </Text>
            <Text>
              {sv ? "Ursprungligt / återstående" : "Original / outstanding"}: {item.originalMinor} /{" "}
              {item.outstandingMinor} {item.currency} {sv ? "minsta valutaenheter" : "minor units"}
            </Text>
            <Text>
              {item.assertedState === "unknown"
                ? sv
                  ? "Betalningsstatus okänd"
                  : "Payment status unknown"
                : item.assertedState === "unpaid"
                  ? sv
                    ? "Obetald enligt källan"
                    : "Unpaid according to source"
                  : sv
                    ? "Delbetald enligt källan"
                    : "Partly paid according to source"}
            </Text>
            <Text>
              {item.detailAvailability === "unreconstructable"
                ? sv
                  ? "Detaljer kan inte återskapas"
                  : "Details cannot be reconstructed"
                : sv
                  ? "Detaljer enligt källan"
                  : "Details asserted by source"}
            </Text>
            <Text>{item.basis}</Text>
          </Box>
        ))}
        {plan.input.openItemControls.map((control) => (
          <Text key={`${control.sourceAccount}:${control.currency}`}>
            {sv ? "Oberoende kontroll" : "Independent control"}: {control.sourceAccount} ·{" "}
            {control.independentOutstandingMinor} {control.currency}{" "}
            {sv ? "minsta valutaenheter" : "minor units"} · {control.basis}
          </Text>
        ))}
        <Text tone="muted">
          {sv
            ? "Att spara importplanen för inte över poster till historikregistret."
            : "Saving the import plan does not admit items to the historical register."}
        </Text>
      </Box>
    </details>
  );
}

export function OpenItemEntry({ disabled, sourceAccounts, onAdd, onDraftChange }: Props<Item>) {
  const { locale } = useBookWorkspace();
  const sv = locale === "sv";
  const form = useForm({
    defaultValues: emptyItem(),
    listeners: { onChange: ({ formApi }) => onDraftChange(formApi.state.isDirty) },
    validators: { onSubmit: Schema.toStandardSchemaV1(Sie.HistoricalOpenItem) },
    onSubmit: ({ value, formApi }) => {
      onAdd(value);
      formApi.reset(emptyItem());
      onDraftChange(false);
    },
  });
  const fields = [
    {
      name: "sourceIdentity",
      label: sv ? "Fakturanummer eller källreferens" : "Invoice number or source reference",
    },
    { name: "currency", label: sv ? "Valuta (tre bokstäver)" : "Currency (three letters)" },
    {
      name: "originalMinor",
      label: sv ? "Ursprungligt belopp i minsta valutaenheter" : "Original amount in minor units",
    },
    {
      name: "outstandingMinor",
      label: sv ? "Återstående belopp i minsta valutaenheter" : "Outstanding amount in minor units",
    },
    { name: "asOf", label: sv ? "Saldodatum (ÅÅÅÅ-MM-DD)" : "Balance date (YYYY-MM-DD)" },
    { name: "basis", label: sv ? "Underlag för posten" : "Item source" },
  ] satisfies Array<{
    name: "sourceIdentity" | "currency" | "originalMinor" | "outstandingMinor" | "asOf" | "basis";
    label: string;
  }>;
  return (
    <details>
      <summary>{sv ? "Lägg till en öppen post" : "Add an open item"}</summary>
      <Box
        display="grid"
        gap="md"
        paddingBlock="md"
        onKeyDown={(event) => {
          if (event.key === "Enter" && event.target instanceof HTMLInputElement) {
            event.preventDefault();
            event.stopPropagation();
            void form.handleSubmit();
          }
        }}
      >
        <Text>
          {sv
            ? "För SEK betyder 100 öre 1,00 SEK. Behåll källans tecken."
            : "For SEK, 100 minor units means SEK 1.00. Preserve the source’s sign."}
        </Text>
        <form.Field name="sourceAccount">
          {(field) => (
            <SelectField
              label={sv ? "Källkonto" : "Source account"}
              value={field.state.value}
              disabled={disabled}
              options={[
                { value: "", label: sv ? "Välj konto" : "Select account" },
                ...sourceAccounts.map((code) => ({ value: code, label: code })),
              ]}
              onValueChange={(value) => {
                field.handleChange(value ?? "");
                field.handleBlur();
              }}
            />
          )}
        </form.Field>
        {fields.map(({ name, label }) => (
          <form.Field key={name} name={name}>
            {(field) => (
              <Box display="grid" gap="sm">
                <InputField
                  label={label}
                  value={field.state.value}
                  disabled={disabled}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                  aria-invalid={field.state.meta.errors.length > 0}
                />
                <Text role="alert">
                  {field.state.meta.errors.map((error) => error?.message).join(" ")}
                </Text>
              </Box>
            )}
          </form.Field>
        ))}
        <form.Field name="assertedState">
          {(field) => (
            <SelectField
              label={sv ? "Status enligt källan" : "Status asserted by source"}
              value={field.state.value}
              disabled={disabled}
              options={[
                { value: "unknown", label: sv ? "Okänd" : "Unknown" },
                { value: "unpaid", label: sv ? "Obetald" : "Unpaid" },
                { value: "partly_paid", label: sv ? "Delbetald" : "Partly paid" },
              ]}
              onValueChange={(value) => {
                field.handleChange(
                  Schema.decodeUnknownSync(Sie.HistoricalOpenItem.fields.assertedState)(value),
                );
                field.handleBlur();
              }}
            />
          )}
        </form.Field>
        <form.Field name="detailAvailability">
          {(field) => (
            <SelectField
              label={sv ? "Detaljernas tillgänglighet" : "Detail availability"}
              value={field.state.value}
              disabled={disabled}
              options={[
                {
                  value: "unreconstructable",
                  label: sv ? "Kan inte återskapas" : "Cannot be reconstructed",
                },
                { value: "source_asserted", label: sv ? "Finns i källan" : "Asserted by source" },
              ]}
              onValueChange={(value) => {
                field.handleChange(
                  Schema.decodeUnknownSync(Sie.HistoricalOpenItem.fields.detailAvailability)(value),
                );
                field.handleBlur();
              }}
            />
          )}
        </form.Field>
        <form.Subscribe selector={(state) => state.isValid}>
          {(valid) =>
            valid ? null : (
              <Text role="alert">
                {sv ? "Kontrollera postens uppgifter." : "Check the item details."}
              </Text>
            )
          }
        </form.Subscribe>
        <Box>
          <Button
            type="button"
            disabled={disabled}
            onClick={() => {
              void form.handleSubmit();
            }}
          >
            {sv ? "Lägg till post i planen" : "Add item to plan"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={disabled}
            onClick={() => {
              form.reset(emptyItem());
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

export function OpenItemControlEntry({
  disabled,
  sourceAccounts,
  onAdd,
  onDraftChange,
}: Props<Control>) {
  const { locale } = useBookWorkspace();
  const sv = locale === "sv";
  const form = useForm({
    defaultValues: emptyControl(),
    listeners: { onChange: ({ formApi }) => onDraftChange(formApi.state.isDirty) },
    validators: { onSubmit: Schema.toStandardSchemaV1(Sie.OpenItemControl) },
    onSubmit: ({ value, formApi }) => {
      onAdd(value);
      formApi.reset(emptyControl());
      onDraftChange(false);
    },
  });
  const fields = [
    { name: "currency", label: sv ? "Kontrollvaluta" : "Control currency" },
    {
      name: "independentOutstandingMinor",
      label: sv
        ? "Oberoende återstående total i minsta valutaenheter"
        : "Independent outstanding total in minor units",
    },
    { name: "basis", label: sv ? "Oberoende kontrollunderlag" : "Independent control source" },
  ] satisfies Array<{ name: "currency" | "independentOutstandingMinor" | "basis"; label: string }>;
  return (
    <details>
      <summary>
        {sv ? "Lägg till en oberoende totalsumma" : "Add an independent control total"}
      </summary>
      <Box
        display="grid"
        gap="md"
        paddingBlock="md"
        onKeyDown={(event) => {
          if (event.key === "Enter" && event.target instanceof HTMLInputElement) {
            event.preventDefault();
            event.stopPropagation();
            void form.handleSubmit();
          }
        }}
      >
        <Text>
          {sv
            ? "Varje kombination av konto och valuta behöver en oberoende totalsumma."
            : "Each account and currency combination needs an independent total."}
        </Text>
        <form.Field name="sourceAccount">
          {(field) => (
            <SelectField
              label={sv ? "Kontrollkonto" : "Control account"}
              value={field.state.value}
              disabled={disabled}
              options={[
                { value: "", label: sv ? "Välj konto" : "Select account" },
                ...sourceAccounts.map((code) => ({ value: code, label: code })),
              ]}
              onValueChange={(value) => {
                field.handleChange(value ?? "");
                field.handleBlur();
              }}
            />
          )}
        </form.Field>
        {fields.map(({ name, label }) => (
          <form.Field key={name} name={name}>
            {(field) => (
              <Box display="grid" gap="sm">
                <InputField
                  label={label}
                  value={field.state.value}
                  disabled={disabled}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                  aria-invalid={field.state.meta.errors.length > 0}
                />
                <Text role="alert">
                  {field.state.meta.errors.map((error) => error?.message).join(" ")}
                </Text>
              </Box>
            )}
          </form.Field>
        ))}
        <form.Subscribe selector={(state) => state.isValid}>
          {(valid) =>
            valid ? null : (
              <Text role="alert">
                {sv ? "Kontrollera totalsummans uppgifter." : "Check the control details."}
              </Text>
            )
          }
        </form.Subscribe>
        <Box>
          <Button
            type="button"
            disabled={disabled}
            onClick={() => {
              void form.handleSubmit();
            }}
          >
            {sv ? "Lägg till kontroll i planen" : "Add control to plan"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={disabled}
            onClick={() => {
              form.reset(emptyControl());
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
