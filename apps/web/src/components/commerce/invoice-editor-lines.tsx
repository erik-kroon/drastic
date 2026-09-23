import * as Drafts from "@open-erp/contracts/invoice-drafts";
import { Plus, Trash2 } from "lucide-react";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { Input } from "@open-erp/ui/components/input";
import { InputField } from "@open-erp/ui/components/field";
import { Disclosure } from "@open-erp/ui/components/disclosure";
import { InvoiceLines, InvoiceLine, InvoiceTotals } from "@open-erp/ui/components/invoice-lines";
import { PageCaption } from "@open-erp/ui/components/accounting-page";
import { decimalToMinor, minorToDecimal, formatMinorAmount } from "@/lib/workspace-api";
import type { CommerceProps } from "./shared";

type DraftLine = typeof Drafts.DraftLine.Type;
export type EditableInvoiceLine = {
  id: string;
  defaults?: DraftLine;
  quantity: string;
  price: string;
  amount: string;
  tax: string;
  explicitAmount: boolean;
};
export function editableInvoiceLine(scale: number, defaults?: DraftLine): EditableInvoiceLine {
  return {
    id: defaults?.id ?? `line_${crypto.randomUUID().replaceAll("-", "")}`,
    defaults,
    quantity: defaults?.quantity ?? "1",
    price: defaults?.unitPriceMinor == null ? "" : minorToDecimal(defaults.unitPriceMinor, scale),
    amount: defaults ? minorToDecimal(defaults.baseMinor, scale) : "",
    tax: defaults?.taxMinor == null ? "" : minorToDecimal(defaults.taxMinor, scale),
    explicitAmount: defaults
      ? exactLineAmount(defaults.quantity, defaults.unitPriceMinor) !== defaults.baseMinor
      : false,
  };
}
function enteredMinor(value: string, scale: number) {
  return value.trim() ? decimalToMinor(value, scale) : null;
}
function canonicalQuantity(value: string) {
  return value
    .trim()
    .replace(",", ".")
    .replace(/(\.\d*?)0+$/, "$1")
    .replace(/\.$/, "");
}
function exactLineAmount(quantity: string, price: string | null) {
  const normalized = canonicalQuantity(quantity);
  if (
    price === null ||
    !/^(?:[1-9][0-9]{0,11}|(?:0|[1-9][0-9]{0,11})\.[0-9]{0,5}[1-9])$/.test(normalized)
  )
    return null;
  const [whole = "", fraction = ""] = normalized.split(".");
  const divisor = 10n ** BigInt(fraction.length);
  const product = BigInt(`${whole}${fraction}`) * BigInt(price);
  return product % divisor === 0n ? (product / divisor).toString() : null;
}
export function invoiceQuantity(value: string | null) {
  return value === null ? null : canonicalQuantity(value);
}
function changedLine(
  line: EditableInvoiceLine,
  field: "quantity" | "price" | "amount" | "tax",
  value: string,
  scale: number,
) {
  const next = { ...line, [field]: value };
  if (field === "amount") return { ...next, explicitAmount: true };
  if ((field === "quantity" || field === "price") && !line.explicitAmount) {
    const calculated = exactLineAmount(next.quantity, enteredMinor(next.price, scale));
    next.amount = calculated === null ? "" : minorToDecimal(calculated, scale);
  }
  return next;
}

export function invoiceEditorTotals(lines: readonly EditableInvoiceLine[], scale: number) {
  const totals = lines.reduce<{ net: bigint | null; tax: bigint | null }>(
    (sum, line) => {
      const base = enteredMinor(line.amount, scale);
      const tax = enteredMinor(line.tax, scale);
      return {
        net:
          sum.net === null || base === null
            ? null
            : sum.net +
              BigInt(base) -
              BigInt(line.defaults?.discountMinor ?? "0") +
              BigInt(line.defaults?.chargeMinor ?? "0"),
        tax: sum.tax === null || tax === null ? null : sum.tax + BigInt(tax),
      };
    },
    { net: 0n, tax: 0n },
  );
  return {
    ...totals,
    gross: totals.net === null || totals.tax === null ? null : totals.net + totals.tax,
  };
}

export function InvoiceEditorLines(props: {
  lines: EditableInvoiceLine[];
  onChange: (lines: EditableInvoiceLine[]) => void;
  scale: number;
  currency: string;
  locale: CommerceProps["locale"];
}) {
  const { lines, onChange, scale, locale } = props;
  const sv = locale === "sv";
  const labels = sv
    ? ["Beskrivning", "Antal", "Enhetspris", "Exkl. moms", "Momsbelopp"]
    : ["Description", "Qty", "Unit price", "Before tax", "Tax amount"];
  const totals = invoiceEditorTotals(lines, scale);
  const amount = (value: bigint | null) =>
    value === null
      ? "—"
      : `${formatMinorAmount(value.toString(), scale, locale)} ${props.currency}`;
  return (
    <Box display="grid" gap="md">
      <InvoiceLines labels={labels}>
        {lines.map((line, index) => (
          <EditorLine
            key={line.id}
            line={line}
            index={index}
            scale={scale}
            locale={locale}
            labels={labels}
            onChange={(next) =>
              onChange(lines.map((current) => (current.id === line.id ? next : current)))
            }
            onRemove={
              lines.length === 1
                ? undefined
                : () => onChange(lines.filter((current) => current.id !== line.id))
            }
          />
        ))}
      </InvoiceLines>
      <Box>
        <Button
          type="button"
          variant="ghost"
          disabled={lines.length >= 50}
          onClick={() => onChange([...lines, editableInvoiceLine(scale)])}
        >
          <Plus size={14} strokeWidth={1.5} />
          {sv ? "Lägg till rad" : "Add line"}
        </Button>
      </Box>
      <InvoiceTotals
        rows={[
          { label: sv ? "Exkl. moms" : "Subtotal", value: amount(totals.net) },
          { label: sv ? "Moms" : "Tax", value: amount(totals.tax) },
          {
            label: sv ? "Totalt" : "Total",
            value: amount(
              totals.net === null || totals.tax === null ? null : totals.net + totals.tax,
            ),
            total: true,
          },
        ]}
      />
      {totals.tax === null ? (
        <PageCaption>
          {sv
            ? "Ange momsbelopp per rad för att beräkna totalen. Tom moms betyder att den inte är fastställd."
            : "Enter tax for each line to calculate the total. Blank tax means it has not been determined."}
        </PageCaption>
      ) : null}
    </Box>
  );
}
function EditorLine(props: {
  line: EditableInvoiceLine;
  index: number;
  scale: number;
  locale: CommerceProps["locale"];
  labels: string[];
  onChange: (line: EditableInvoiceLine) => void;
  onRemove?: () => void;
}) {
  const { line, index, scale, locale } = props;
  const sv = locale === "sv";
  const calculated = exactLineAmount(line.quantity, enteredMinor(line.price, scale));
  const description = (
    <Input
      name={`${line.id}_description`}
      aria-label={`${props.labels[0]} ${index + 1}`}
      placeholder={sv ? "Produkt eller tjänst" : "Product or service"}
      required
      maxLength={200}
      defaultValue={line.defaults?.description}
    />
  );
  const controls = (["quantity", "price", "amount", "tax"] as const).map((field, fieldIndex) => (
    <Input
      key={field}
      name={`${line.id}_${field === "price" ? "unitPrice" : field}`}
      aria-label={`${props.labels[fieldIndex + 1]} ${index + 1}`}
      inputMode="decimal"
      required={field === "quantity" || field === "amount"}
      value={line[field]}
      placeholder={field === "tax" ? "—" : "0"}
      onChange={(event) => props.onChange(changedLine(line, field, event.target.value, scale))}
    />
  ));
  return (
    <InvoiceLine
      cells={[
        description,
        ...controls,
        <Button
          key="remove"
          type="button"
          size="icon"
          variant="ghost"
          aria-label={`${sv ? "Ta bort rad" : "Remove line"} ${index + 1}`}
          disabled={!props.onRemove}
          onClick={props.onRemove}
        >
          <Trash2 size={14} strokeWidth={1.5} />
        </Button>,
      ]}
      details={
        <Box display="grid" gap="sm">
          {line.price && calculated === null ? (
            <PageCaption>
              {sv
                ? "Antal × enhetspris ger inte ett exakt belopp. Justera värdena eller ange radbeloppet."
                : "Quantity × unit price does not give an exact amount. Adjust the values or enter the line amount."}
            </PageCaption>
          ) : null}
          <Disclosure
            variant="inline"
            label={sv ? "Radens moms och underlag" : "Line tax and source details"}
          >
            <Box display="grid" gap="md">
              {line.explicitAmount && calculated !== null ? (
                <Box>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() =>
                      props.onChange({
                        ...line,
                        explicitAmount: false,
                        amount: minorToDecimal(calculated, scale),
                      })
                    }
                  >
                    {sv ? "Använd antal × enhetspris" : "Use quantity × unit price"}
                  </Button>
                </Box>
              ) : null}
              <Box display="grid" columns={2} gap="md">
                <InputField
                  name={`${line.id}_taxDescription`}
                  label={sv ? "Momsbehandling" : "Tax treatment"}
                  placeholder={
                    sv ? "Enligt avtalet eller underlaget" : "As stated in the agreement or source"
                  }
                  maxLength={200}
                  defaultValue={line.defaults?.taxDescription ?? ""}
                />
                <InputField
                  name={`${line.id}_sourceGross`}
                  label={
                    sv
                      ? "Avtalat radbelopp inkl. moms (valfritt)"
                      : "Agreed line total incl. tax (optional)"
                  }
                  inputMode="decimal"
                  defaultValue={
                    line.defaults?.sourceGrossMinor == null
                      ? ""
                      : minorToDecimal(line.defaults.sourceGrossMinor, scale)
                  }
                />
              </Box>
              {line.defaults &&
              (line.defaults.discountMinor !== "0" || line.defaults.chargeMinor !== "0") ? (
                <PageCaption>
                  {sv ? "Sparad rabatt / tillägg:" : "Retained discount / charge:"}{" "}
                  {minorToDecimal(line.defaults.discountMinor, scale)} /{" "}
                  {minorToDecimal(line.defaults.chargeMinor, scale)}
                </PageCaption>
              ) : null}
            </Box>
          </Disclosure>
        </Box>
      }
    />
  );
}
