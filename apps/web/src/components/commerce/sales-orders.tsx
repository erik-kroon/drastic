import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import * as Sales from "@open-erp/contracts/sales-orders";
import * as Drafts from "@open-erp/contracts/invoice-drafts";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { Link } from "@open-erp/ui/components/link";
import { InputField, SelectField } from "@open-erp/ui/components/field";
import { Text } from "@open-erp/ui/components/typography";
import { AccountingStatus } from "@/components/accounting-status";
import { readAccounting } from "@/lib/accounting-api";
import { decimalToMinor, formatMinorAmount } from "@/lib/workspace-api";
import {
  InvoiceEditorLines,
  editableInvoiceLine,
  invoiceQuantity,
  type EditableInvoiceLine,
} from "./invoice-editor-lines";
import { workspacePath } from "@/lib/book-context";
import { CommandForm, checkScope, commerceKey, commercePath, type CommerceProps } from "./shared";

const quantityUnit = 1_000_000n;

function quantityUnits(value: string) {
  const [whole = "0", fraction = ""] = value.split(".");

  return BigInt(whole) * quantityUnit + BigInt(fraction.padEnd(6, "0"));
}

function quantityString(value: bigint) {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const fraction = (absolute % quantityUnit).toString().padStart(6, "0").replace(/0+$/, "");

  return `${negative ? "-" : ""}${absolute / quantityUnit}${fraction ? `.${fraction}` : ""}`;
}

function formText(fields: FormData, name: string) {
  const value = fields.get(name);

  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function formMinor(fields: FormData, name: string, scale: number, optional = false) {
  const value = formText(fields, name);

  if (optional && value === null) return null;

  return decimalToMinor(value ?? "", scale) ?? "invalid";
}

function salesLineInput(fields: FormData, line: EditableInvoiceLine, scale: number) {
  const catalogSelection = line.defaults?.catalogSelection;
  const taxMinor = formMinor(fields, `${line.id}_tax`, scale, true);

  return {
    id: line.id,
    description: catalogSelection
      ? (line.defaults?.description ?? null)
      : formText(fields, `${line.id}_description`),
    quantity: invoiceQuantity(formText(fields, `${line.id}_quantity`)),
    unitPriceMinor: catalogSelection
      ? (line.defaults?.unitPriceMinor ?? null)
      : formMinor(fields, `${line.id}_unitPrice`, scale, true),
    baseMinor: formMinor(fields, `${line.id}_amount`, scale),
    discountMinor: line.defaults?.discountMinor ?? "0",
    chargeMinor: line.defaults?.chargeMinor ?? "0",
    taxMinor,
    taxDescription: catalogSelection
      ? (line.defaults?.taxDescription ?? null)
      : formText(fields, `${line.id}_taxDescription`),
    taxEvidenceId:
      taxMinor !== null && taxMinor === line.defaults?.taxMinor
        ? (line.defaults?.taxEvidenceId ?? null)
        : null,
    sourceGrossMinor: formMinor(fields, `${line.id}_sourceGross`, scale, true),
    catalogSelection,
  };
}

export function SalesOrders({ book, locale }: CommerceProps) {
  const sv = locale === "sv";
  const path = `${commercePath(book)}/sales-documents`;
  const [sourceId, setSourceId] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [source, setSource] = useState<typeof Drafts.InvoiceDraftRevision.Type | null>(null);
  const [sourceLines, setSourceLines] = useState<EditableInvoiceLine[]>([]);
  const [sourceError, setSourceError] = useState<Error | null>(null);
  const [documentKind, setDocumentKind] = useState<"quote" | "order">("quote");
  const creationKeys = useRef(new Map<string, string>());

  const list = useQuery({
    queryKey: [...commerceKey(book), "sales-documents"],
    queryFn: async ({ signal }) => {
      const result = await readAccounting(path, Sales.SalesDocumentList, { signal });
      checkScope(book, result.scope);

      return result;
    },
    retry: false,
  });

  const record = list.data?.items.find((item) => item.id === selectedId);

  const detail = useQuery({
    queryKey: [...commerceKey(book), "sales-document", selectedId],
    queryFn: async ({ signal }) =>
      readAccounting(`${path}/${encodeURIComponent(selectedId)}`, Sales.SalesDocumentView, {
        signal,
      }),
    enabled: !!selectedId,
    retry: false,
  });

  return (
    <Box display="grid" gap="xl" minWidth="zero">
      <h2>{sv ? "Offerter och order" : "Quotes and orders"}</h2>
      <Text tone="muted">
        {sv
          ? "En accepterad order kan delas upp i granskade fakturautkast. Ingen faktura skapas vid accept."
          : "Split an accepted order into reviewed invoice drafts. Acceptance does not issue an invoice."}
      </Text>
      <Box
        as="form"
        display="grid"
        gap="md"
        onSubmit={(event) => {
          event.preventDefault();
          setSourceError(null);
          setSource(null);
          setSourceLines([]);
          void readAccounting(
            `${commercePath(book)}/invoice-drafts/${encodeURIComponent(sourceId)}`,
            Drafts.InvoiceDraftView,
          )
            .then((result) => {
              checkScope(book, result.record.scope);
              setSource(result.record);
              setSourceLines(
                result.record.content.lines.map((line) =>
                  editableInvoiceLine(result.record.content.currencyScale, line),
                ),
              );
            })
            .catch((error: unknown) =>
              setSourceError(
                error instanceof Error ? error : new Error("Unable to load source draft"),
              ),
            );
        }}
      >
        <InputField
          label={sv ? "Befintligt fakturautkast-ID" : "Existing invoice draft ID"}
          name="draftId"
          required
          value={sourceId}
          onChange={(event) => setSourceId(event.target.value)}
        />
        <Button type="submit" variant="outline">
          {sv ? "Hämta underlag" : "Review source draft"}
        </Button>
        <AccountingStatus locale={locale} error={sourceError} />
      </Box>
      {source ? (
        <Box display="grid" gap="md">
          <Text>
            {source.content.title} · {source.content.customer.legalName}
          </Text>
          <SelectField
            label={sv ? "Dokumenttyp" : "Document type"}
            value={documentKind}
            options={[
              { value: "quote", label: sv ? "Offert" : "Quote" },
              { value: "order", label: sv ? "Order" : "Order" },
            ]}
            onValueChange={(value) => {
              if (value === "quote" || value === "order") setDocumentKind(value);
            }}
          />
          <Text tone="muted">
            {documentKind === "quote"
              ? sv
                ? "Kopierar underlaget och de valda artikelraderna som en ny offert. Källutkastet ändras inte."
                : "Copies the source envelope and selected article lines into a new quote. The source draft remains unchanged."
              : sv
                ? "Kopierar underlaget och de valda artikelraderna som en ny order. Källutkastet ändras inte."
                : "Copies the source envelope and selected article lines into a new order. The source draft remains unchanged."}
          </Text>
          <InvoiceEditorLines
            book={book}
            lines={sourceLines}
            onChange={setSourceLines}
            scale={source.content.currencyScale}
            currency={source.content.currency}
            locale={locale}
          />
          <CommandForm
            book={book}
            locale={locale}
            path={path}
            schema={Sales.CreateSalesDocument}
            output={Sales.SalesDocument}
            input={(fields) => ({
              kind: documentKind,
              content: {
                ...source.content,
                sourceTotalMinor: null,
                lines: sourceLines.map((line) =>
                  salesLineInput(fields, line, source.content.currencyScale),
                ),
              },
            })}
            label={
              documentKind === "quote"
                ? sv
                  ? "Skapa offert"
                  : "Create quote"
                : sv
                  ? "Skapa order"
                  : "Create order"
            }
            allowed={book.role === "operator"}
            keys={creationKeys.current}
            onSuccess={(result) => setSelectedId(result.id)}
            onNewCommand={() => creationKeys.current.clear()}
          />
        </Box>
      ) : null}
      <AccountingStatus locale={locale} pending={list.isPending} error={list.error} />
      {list.data?.items.map((item) => (
        <Button
          key={item.id}
          variant={selectedId === item.id ? "secondary" : "ghost"}
          onClick={() => setSelectedId(item.id)}
        >
          {item.kind === "quote" ? (sv ? "Offert" : "Quote") : sv ? "Order" : "Order"}:{" "}
          {item.content.title} · {item.state}
        </Button>
      ))}
      {record ? (
        <SalesOrderDetail
          book={book}
          locale={locale}
          record={record}
          detail={detail}
          path={path}
          source={source}
        />
      ) : null}
    </Box>
  );
}

function SalesOrderDetail(
  props: CommerceProps & {
    record: typeof Sales.SalesDocument.Type;
    detail: ReturnType<typeof useQuery<typeof Sales.SalesDocumentView.Type>>;
    path: string;
    source: typeof Drafts.InvoiceDraftRevision.Type | null;
  },
) {
  const { book, locale, record, detail } = props;
  const source = props.source;
  const path = props.path;
  const sv = locale === "sv";
  const converted = detail.data?.conversions ?? [];

  return (
    <Box display="grid" gap="lg">
      <h3>
        {record.content.title} · {record.kind} · {record.state}
      </h3>
      <Text tone="muted">
        {sv ? "Källa och revision" : "Source and revision"}: {record.sourceQuoteId ?? "—"} ·{" "}
        {record.revision}
      </Text>
      <AccountingStatus locale={locale} pending={detail.isPending} error={detail.error} />
      {detail.isError ? (
        <Button variant="outline" onClick={() => void detail.refetch()}>
          {sv ? "Försök läsa orderdetaljer igen" : "Retry order details"}
        </Button>
      ) : null}
      {record.state === "draft" && record.kind === "quote" && source ? (
        <ReviseQuote book={book} locale={locale} record={record} source={source} path={path} />
      ) : null}

      {record.state === "draft" ||
      (record.state === "accepted" && record.kind === "quote") ||
      (record.state === "accepted" && record.kind === "order" && converted.length === 0) ? (
        <CommandForm
          book={book}
          locale={locale}
          path={`${path}/${record.id}/transitions`}
          recoveryId={record.id}
          schema={Sales.TransitionSalesDocument}
          output={Sales.SalesDocument}
          allowed={book.role === "operator"}
          input={(fields) => ({
            expectedRevision: record.revision,
            expectedDigest: record.digest,
            action: fields.get("action"),
          })}
          label={sv ? "Spara beslut" : "Save decision"}
        >
          <Box as="label" display="grid" gap="sm">
            {sv ? "Beslut" : "Decision"}
            <select name="action" required>
              {record.state === "draft" ? (
                <option value="accept">{sv ? "Acceptera" : "Accept"}</option>
              ) : null}
              {record.kind === "quote" && record.state === "accepted" ? (
                <option value="order_from_quote">
                  {sv ? "Skapa order från offert" : "Create order from quote"}
                </option>
              ) : null}
              <option value="cancel">{sv ? "Avbryt" : "Cancel"}</option>
            </select>
          </Box>
        </CommandForm>
      ) : null}
      {record.kind === "order" && record.state === "accepted" && detail.isSuccess ? (
        <OrderConversionForm
          book={book}
          locale={locale}
          record={record}
          converted={converted}
          onConverted={() => void detail.refetch()}
        />
      ) : null}
    </Box>
  );
}

function OrderConversionForm(
  props: CommerceProps & {
    record: typeof Sales.SalesDocument.Type;
    converted: (typeof Sales.SalesDocumentView.Type)["conversions"];
    onConverted: () => void;
  },
) {
  const { book, locale, record, converted } = props;
  const sv = locale === "sv";
  const conversionKeys = useRef(new Map<string, string>());

  const remaining = record.content.lines.map((line) => {
    const used = converted
      .flatMap((conversion) => conversion.portions)
      .reduce(
        (total, portion) =>
          portion.id === line.id ? total + quantityUnits(portion.quantity) : total,
        0n,
      );

    return { line, available: quantityString(quantityUnits(line.quantity) - used) };
  });

  return (
    <>
      <h3>{sv ? "Konvertera del av order" : "Convert part of order"}</h3>
      <Text tone="muted">
        {sv
          ? "Välj återstående antal per rad. Beloppen delas exakt och fakturan sparas bara som utkast."
          : "Choose remaining quantities per line. Amounts must split exactly; this saves only an invoice draft."}
      </Text>
      <CommandForm
        key={`${record.id}-${converted.length}`}
        book={book}
        locale={locale}
        path={`${commercePath(book)}/sales-documents/${record.id}/conversions`}
        recoveryId={record.id}
        schema={Sales.ConvertSalesOrder}
        output={Sales.OrderConversion}
        allowed={book.role === "operator"}
        keys={conversionKeys.current}
        onNewCommand={() => conversionKeys.current.clear()}
        onSuccess={props.onConverted}
        input={(fields) => ({
          expectedRevision: record.revision,
          expectedDigest: record.digest,
          draftKey: fields.get("draftKey"),
          lines: remaining.flatMap(({ line }) => {
            const raw = fields.get(`quantity_${line.id}`);
            const quantity = typeof raw === "string" ? raw.trim() : "";

            return quantity ? [{ id: line.id, quantity }] : [];
          }),
        })}
        label={sv ? "Skapa fakturautkast" : "Create invoice draft"}
      >
        <InputField
          name="draftKey"
          label={sv ? "Unik utkastnyckel" : "Unique draft key"}
          required
        />
        {remaining.map(({ line, available }) => (
          <InputField
            key={line.id}
            name={`quantity_${line.id}`}
            label={`${line.description} (${sv ? "återstår" : "remaining"} ${available})`}
            disabled={quantityUnits(available) <= 0n}
            maxLength={20}
          />
        ))}
      </CommandForm>
      <OrderConversionHistory book={book} locale={locale} record={record} converted={converted} />
    </>
  );
}

function OrderConversionHistory(
  props: CommerceProps & {
    record: typeof Sales.SalesDocument.Type;
    converted: (typeof Sales.SalesDocumentView.Type)["conversions"];
  },
) {
  const { book, locale, record, converted } = props;
  const sv = locale === "sv";

  const amount = (value: string | null | undefined) =>
    value == null
      ? "—"
      : `${formatMinorAmount(value, record.content.currencyScale, locale)} ${record.content.currency}`;

  if (converted.length === 0) return null;

  return (
    <Box display="grid" gap="sm">
      {converted.map((item) => (
        <Box key={item.draftId} display="grid" gap="sm">
          <Link
            href={`${workspacePath(book)}/sales?record=${encodeURIComponent(item.draftId)}&kind=draft`}
          >
            {sv ? "Granska fakturautkast" : "Review invoice draft"}: {item.draftId}
          </Link>
          <Text tone="muted">
            {sv ? "Orderrevision" : "Order revision"}: {item.orderRevision}
          </Text>
          {item.portions.map((portion) => {
            const line = record.content.lines.find((candidate) => candidate.id === portion.id);

            return (
              <Text key={portion.id}>
                {line?.description ?? portion.id} · {sv ? "antal" : "quantity"}: {portion.quantity}{" "}
                · {sv ? "bas" : "base"}: {amount(portion.baseMinor)} · {sv ? "rabatt" : "discount"}:{" "}
                {amount(portion.discountMinor)} · {sv ? "avgift" : "charge"}:{" "}
                {amount(portion.chargeMinor)} · {sv ? "moms" : "tax"}: {amount(portion.taxMinor)} ·{" "}
                {sv ? "källbrutto" : "source gross"}: {amount(portion.sourceGrossMinor)}
              </Text>
            );
          })}
        </Box>
      ))}
    </Box>
  );
}

function ReviseQuote(
  props: CommerceProps & {
    record: typeof Sales.SalesDocument.Type;
    source: typeof Drafts.InvoiceDraftRevision.Type;
    path: string;
  },
) {
  const { book, locale, record, source } = props;
  const path = props.path;

  return (
    <CommandForm
      key={`${record.id}-${source.id}`}
      book={book}
      locale={locale}
      path={`${path}/${record.id}/revisions`}
      recoveryId={record.id}
      schema={Sales.ReviseSalesDocument}
      output={Sales.SalesDocument}
      input={(fields) => ({
        expectedRevision: record.revision,
        expectedDigest: record.digest,
        content: source.content,
        reason: fields.get("reason"),
      })}
      allowed={book.role === "operator"}
      label={locale === "sv" ? "Spara ny offertrevision" : "Save new quote revision"}
    >
      <Text tone="muted">
        {locale === "sv"
          ? "Ersätt innehållet med det hämtade utkastet. Tidigare revision sparas."
          : "Replace the content with the reviewed source draft. The previous revision remains."}
      </Text>
      <InputField
        name="reason"
        label={locale === "sv" ? "Skäl till ändring" : "Reason for change"}
        required
      />
    </CommandForm>
  );
}
