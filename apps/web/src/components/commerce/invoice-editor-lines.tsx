import { useState, type ReactNode } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import * as Catalog from "@open-erp/contracts/catalog";
import * as Drafts from "@open-erp/contracts/invoice-drafts";
import { Plus, Trash2 } from "lucide-react";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { RecordColumns } from "@open-erp/ui/components/record-layout";
import { Input } from "@open-erp/ui/components/input";
import { InputField, SelectField } from "@open-erp/ui/components/field";
import {
  InvoiceLines,
  InvoiceLine,
  InvoiceTotals,
  InvoiceAmountInput,
} from "@open-erp/ui/components/invoice-lines";
import { PageCaption } from "@open-erp/ui/components/accounting-page";
import { AccountingStatus } from "@/components/accounting-status";
import { readAccounting } from "@/lib/accounting-api";
import { decimalToMinor, minorToDecimal, formatMinorAmount } from "@/lib/workspace-api";
import { commerceKey, commercePath, type CommerceProps } from "./shared";

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
  book?: CommerceProps["book"];
  lines: readonly EditableInvoiceLine[];
  onChange: (lines: EditableInvoiceLine[], changedLineId?: string) => void;
  scale: number;
  currency: string;
  locale: CommerceProps["locale"];
  footer?: ReactNode;
  fields?: Readonly<Record<string, string>>;
}) {
  const { lines, onChange, scale, locale } = props;
  const [showDetails, setShowDetails] = useState(false);
  const sv = locale === "sv";

  const labels = sv
    ? ["Beskrivning", "Antal", "Enhetspris", "Exkl. moms", "Momsbelopp"]
    : ["Description", "Qty", "Unit price", "Before tax", "Tax amount"];

  const catalog = useInfiniteQuery({
    queryKey: props.book
      ? [...commerceKey(props.book), "catalog-articles"]
      : ["catalog-articles", "disabled"],
    enabled: !!props.book,
    initialPageParam: "",
    queryFn: async ({ pageParam, signal }) => {
      if (!props.book) throw new Error("Catalog article query requires a book");

      return readAccounting(
        `${commercePath(props.book)}/articles${pageParam ? `?after=${encodeURIComponent(pageParam)}` : ""}`,
        Catalog.ArticlePage,
        { signal },
      );
    },
    getNextPageParam: (page) => page.next ?? undefined,
    retry: false,
  });

  const articles = catalog.data?.pages.flatMap((page) => page.items) ?? [];
  const totals = invoiceEditorTotals(lines, props.scale);

  const amount = (value: bigint | null) =>
    value === null
      ? "—"
      : `${formatMinorAmount(value.toString(), props.scale, locale)} ${props.currency}`;

  return (
    <Box display="grid" gap="md">
      {props.book ? (
        <AccountingStatus locale={locale} pending={catalog.isPending} error={catalog.error} />
      ) : null}
      {props.book && catalog.hasNextPage ? (
        <Box>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={catalog.isFetchingNextPage}
            onClick={() => void catalog.fetchNextPage()}
          >
            {sv ? "Läs in fler artiklar" : "Load more articles"}
          </Button>
        </Box>
      ) : null}
      {articles.some((article) => article.description.length > 200) ? (
        <PageCaption>
          {sv
            ? "Artiklar med beskrivningar över 200 tecken kan inte användas på fakturarader."
            : "Articles with descriptions over 200 characters cannot be used on invoice lines."}
        </PageCaption>
      ) : null}
      <InvoiceLines labels={labels}>
        {lines.map((line, index) => (
          <EditorLine
            key={line.id}
            book={props.book}
            line={line}
            articles={articles}
            index={index}
            scale={scale}
            locale={locale}
            labels={labels}
            showDetails={showDetails}
            fields={props.fields}
            onChange={(next, changedLineId) =>
              onChange(
                lines.map((current) => (current.id === line.id ? next : current)),
                changedLineId,
              )
            }
            onRemove={
              lines.length === 1
                ? undefined
                : () => onChange(lines.filter((current) => current.id !== line.id))
            }
          />
        ))}
      </InvoiceLines>
      <Box display="flex" alignItems="center" justifyContent="between" gap="lg">
        <Button
          type="button"
          variant="ghost"
          disabled={lines.length >= 50}
          onClick={() => onChange([...lines, editableInvoiceLine(scale)])}
        >
          <Plus size={14} strokeWidth={1.5} />
          {sv ? "Lägg till rad" : "Add line"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          static
          aria-expanded={showDetails}
          onClick={() => setShowDetails(!showDetails)}
        >
          {showDetails
            ? sv
              ? "Dölj moms och underlag"
              : "Hide tax and source details"
            : sv
              ? "Moms och underlag"
              : "Tax and source details"}
        </Button>
      </Box>
      <RecordColumns>
        {props.footer ?? <Box />}
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
      </RecordColumns>
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
  book?: CommerceProps["book"];
  line: EditableInvoiceLine;
  articles: readonly (typeof Catalog.Article.Type)[];
  index: number;
  scale: number;
  locale: CommerceProps["locale"];
  labels: string[];
  showDetails: boolean;
  fields?: Readonly<Record<string, string>>;
  onChange: (line: EditableInvoiceLine, changedLineId?: string) => void;
  onRemove?: () => void;
}) {
  const { line, index, scale, locale } = props;
  const sv = locale === "sv";
  const calculated = exactLineAmount(line.quantity, enteredMinor(line.price, scale));
  const catalogSelection = line.defaults?.catalogSelection;

  const description = (
    <Box display="grid" gap="sm">
      <Input
        name={`${line.id}_description`}
        aria-label={`${props.labels[0]} ${index + 1}`}
        placeholder={sv ? "Produkt eller tjänst" : "Product or service"}
        required
        maxLength={200}
        disabled={!!catalogSelection}
        defaultValue={props.fields?.[`${line.id}_description`] ?? line.defaults?.description}
      />
      {props.book ? (
        <CatalogArticleSelect
          line={line}
          articles={props.articles}
          scale={scale}
          locale={locale}
          onChange={props.onChange}
        />
      ) : null}
    </Box>
  );

  const controls = (["quantity", "price", "amount", "tax"] as const).map((field, fieldIndex) => (
    <InvoiceAmountInput
      key={field}
      name={`${line.id}_${field === "price" ? "unitPrice" : field}`}
      aria-label={`${props.labels[fieldIndex + 1]} ${index + 1}`}
      inputMode="decimal"
      required={field === "quantity" || field === "amount"}
      disabled={field === "price" && !!catalogSelection}
      value={line[field]}
      placeholder={field === "tax" ? "—" : "0"}
      onChange={(event) => props.onChange(changedLine(line, field, event.target.value, scale))}
    />
  ));

  return (
    <InvoiceLine
      labels={props.labels}
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
          <Box display={props.showDetails ? "grid" : "none"}>
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
                  disabled={!!catalogSelection}
                  defaultValue={
                    props.fields?.[`${line.id}_taxDescription`] ??
                    line.defaults?.taxDescription ??
                    ""
                  }
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
                    props.fields?.[`${line.id}_sourceGross`] ??
                    (line.defaults?.sourceGrossMinor == null
                      ? ""
                      : minorToDecimal(line.defaults.sourceGrossMinor, scale))
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
          </Box>
        </Box>
      }
    />
  );
}

function CatalogArticleSelect(props: {
  line: EditableInvoiceLine;
  articles: readonly (typeof Catalog.Article.Type)[];
  scale: number;
  locale: CommerceProps["locale"];
  onChange: (line: EditableInvoiceLine, changedLineId?: string) => void;
}) {
  const { line, articles, scale, locale } = props;
  const sv = locale === "sv";
  const selection = line.defaults?.catalogSelection;
  const selectedValue = selection ? `${selection.code}:${selection.revision}` : "";

  const selectedIsListed = articles.some(
    (article) => `${article.code}:${article.revision}` === selectedValue,
  );

  const option = (article: typeof Catalog.Article.Type) => ({
    value: `${article.code}:${article.revision}`,
    label: `${article.code} · ${article.revision} — ${article.description}`,
    disabled: article.description.length > 200,
  });

  const clearSelection = () => {
    if (!line.defaults) return;
    const defaults = { ...line.defaults };
    delete defaults.catalogSelection;
    props.onChange({ ...line, defaults }, line.id);
  };

  return (
    <Box display="grid" gap="xs">
      <SelectField
        label={sv ? "Sparad artikel" : "Saved article"}
        value={selectedValue}
        options={[
          { value: "", label: sv ? "Välj artikel…" : "Select article…" },
          ...(selection && !selectedIsListed
            ? [
                {
                  value: selectedValue,
                  label: `${selection.code} · ${selection.revision} — ${line.defaults?.description ?? ""}`,
                },
              ]
            : []),
          ...articles.map(option),
        ]}
        onValueChange={(value) => {
          if (!value) {
            clearSelection();

            return;
          }

          const article = articles.find((item) => `${item.code}:${item.revision}` === value);

          if (!article) return;

          const defaults: DraftLine = {
            id: line.id,
            description: article.description,
            quantity: line.quantity || "1",
            unitPriceMinor: article.unitPriceMinor,
            baseMinor: article.unitPriceMinor ?? "0",
            discountMinor: line.defaults?.discountMinor ?? "0",
            chargeMinor: line.defaults?.chargeMinor ?? "0",
            taxMinor: null,
            taxDescription: article.taxDescription,
            taxEvidenceId: null,
            sourceGrossMinor: null,
            catalogSelection: {
              code: article.code,
              revision: article.revision,
              unit: article.unit,
            },
          };

          props.onChange(
            {
              ...line,
              defaults,
              price: article.unitPriceMinor ? minorToDecimal(article.unitPriceMinor, scale) : "",
              amount: article.unitPriceMinor ? minorToDecimal(article.unitPriceMinor, scale) : "",
              tax: "",
              explicitAmount: false,
            },
            line.id,
          );
        }}
      />
      {selection ? (
        <Box display="flex" flexWrap="wrap" alignItems="center" gap="sm">
          <PageCaption>
            {selection.code} · {selection.revision} · {selection.unit}
          </PageCaption>
          <Button type="button" variant="ghost" size="sm" onClick={clearSelection}>
            {sv ? "Ta bort val" : "Clear selection"}
          </Button>
        </Box>
      ) : null}
      {selection && line.defaults?.unitPriceMinor == null ? (
        <PageCaption>
          {sv
            ? "Artikeln saknar pris. Ange ett explicit radbelopp."
            : "This article has no price. Enter an explicit line amount."}
        </PageCaption>
      ) : null}
    </Box>
  );
}
