import { useRef, useState, type ReactNode, type RefObject } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import * as Sales from "@open-erp/contracts/sales-orders";
import * as SalesRegister from "@open-erp/contracts/sales-register";
import * as Schema from "effect/Schema";
import * as Option from "effect/Option";
import * as Drafts from "@open-erp/contracts/invoice-drafts";
import { Box } from "@open-erp/ui/components/box";
import { DataTable } from "@open-erp/ui/components/data-table";
import { FormDialog } from "@open-erp/ui/components/form-dialog";
import { PageEmpty, RecordOpen } from "@open-erp/ui/components/accounting-page";
import { Button } from "@open-erp/ui/components/button";
import { Link } from "@open-erp/ui/components/link";
import { InputField, SelectField } from "@open-erp/ui/components/field";
import { Heading, Text } from "@open-erp/ui/components/typography";
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

import { AreaBar, ListDetailPage } from "@open-erp/ui/kanon/layouts";
import { RegisterSearch, RegisterTable } from "@open-erp/ui/kanon/register";
import { DetailPanelSurface } from "@open-erp/ui/kanon/detail-panel";
import {
  FormColumn,
  FormTitle,
  FormText,
  FormNote,
  PlainFacts,
  FactDisclosure,
  RecordHeader,
  RecordSection,
  SelectField as KanonSelectField,
  InputField as KanonInputField,
} from "@open-erp/ui/kanon/form";
import { Action } from "@open-erp/ui/kanon/action";

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

export function SalesOrders({
  book,
  locale,
  navigation,
}: CommerceProps & { navigation: ReactNode }) {
  const sv = locale === "sv";
  const path = `${commercePath(book)}/sales-documents`;
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState("");
  const opener = useRef<HTMLButtonElement | null>(null);
  const newQuoteButton = useRef<HTMLButtonElement>(null);
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
    queryFn: async ({ signal }) => {
      const result = await readAccounting(
        `${path}/${encodeURIComponent(selectedId)}`,
        Sales.SalesDocumentView,
        {
          signal,
        },
      );

      checkScope(book, result.record.scope);

      if (result.record.id !== selectedId) throw new Error("Sales document identity mismatch");

      return result;
    },
    enabled: !!selectedId,
    retry: false,
  });

  return (
    <>
      <ListDetailPage
        onKeyDown={(event) => {
          if (event.key !== "Escape" || event.defaultPrevented || creating) return;
          setSelectedId("");
          opener.current?.focus();
        }}
        bar={
          <AreaBar
            title={sv ? "Försäljning" : "Sales"}
            tabs={navigation}
            action={
              <Action
                kind="secondary"
                compact
                ref={newQuoteButton}
                disabled={book.role !== "operator"}
                onClick={() => {
                  setSourceId("");
                  setSource(null);
                  setSourceLines([]);
                  setSourceError(null);
                  creationKeys.current.clear();
                  setCreating(true);
                }}
              >
                {sv ? "Ny offert" : "New quote"}
              </Action>
            }
          />
        }
        list={
          <>
            <RegisterSearch
              label={sv ? "Sök offerter och order" : "Search quotes and orders"}
              value={filter}
              onChange={setFilter}
            />
            <AccountingStatus locale={locale} pending={list.isPending} error={list.error} />
            <SalesDocumentRegister
              items={list.data?.items?.filter((item) =>
                `${item.content.title} ${item.content.customer.legalName}`
                  .toLocaleLowerCase()
                  .includes(filter.toLocaleLowerCase()),
              )}
              locale={locale}
              onOpen={setSelectedId}
              selectedId={selectedId}
              opener={opener}
            />
          </>
        }
        panel={
          record ? (
            <DetailPanelSurface label={sv ? "Vald offert eller order" : "Selected quote or order"}>
              <SalesOrderDetail
                key={record.id}
                book={book}
                locale={locale}
                record={record}
                detail={detail}
                path={path}
              />
            </DetailPanelSurface>
          ) : null
        }
      />
      {creating ? (
        <FormDialog
          title={sv ? "Ny offert eller order" : "New quote or order"}
          closeLabel={sv ? "Stäng" : "Close"}
          onClose={() => setCreating(false)}
          onEscape={() => setCreating(false)}
          finalFocus={newQuoteButton}
        >
          <Box display="grid" gap="lg">
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
              <SalesSourceDraft
                book={book}
                locale={locale}
                value={sourceId}
                onChange={(id) => {
                  setSourceId(id);
                  setSource(null);
                  setSourceLines([]);
                  setSourceError(null);
                }}
              />
              <Button type="submit" variant="outline" disabled={!sourceId}>
                {sv ? "Hämta underlag" : "Review source draft"}
              </Button>
              <AccountingStatus locale={locale} error={sourceError} />
            </Box>
            {source ? (
              <Box display="grid" gap="md">
                <Text>
                  {source.content.title}, {source.content.customer.legalName}
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
                  onSuccess={(result) => {
                    setSelectedId(result.id);
                    setCreating(false);
                  }}
                  onNewCommand={() => creationKeys.current.clear()}
                >
                  <InvoiceEditorLines
                    book={book}
                    lines={sourceLines}
                    onChange={setSourceLines}
                    scale={source.content.currencyScale}
                    currency={source.content.currency}
                    locale={locale}
                  />
                </CommandForm>
              </Box>
            ) : null}
          </Box>
        </FormDialog>
      ) : null}
    </>
  );
}

function SalesSourceDraft(
  props: CommerceProps & {
    value: string;
    onChange: (id: string) => void;
    canonical?: boolean;
  },
) {
  const { book, locale, value, onChange } = props;
  const sv = locale === "sv";

  const drafts = useInfiniteQuery({
    queryKey: [...commerceKey(book), "sales-source-drafts"],
    initialPageParam: 1,
    queryFn: async ({ pageParam, signal }) => {
      const result = await readAccounting(
        `${commercePath(book)}/sales-register?status=draft&sort=newest&page=${pageParam}`,
        SalesRegister.SalesPage,
        { signal },
      );

      checkScope(book, result.scope);

      return result;
    },
    getNextPageParam: (page, _pages, pageParam) =>
      pageParam * page.pageSize < page.total ? pageParam + 1 : undefined,
    retry: false,
  });

  const items = drafts.data?.pages.flatMap((page) => page.items) ?? [];
  const Select = props.canonical ? KanonSelectField : SelectField;

  return (
    <Box display="grid" gap="sm">
      <Select
        {...(props.canonical ? { record: true } : {})}
        label={sv ? "Fakturaunderlag" : "Invoice source"}
        value={value}
        onValueChange={(id) => onChange(id ?? "")}
        options={[
          { value: "", label: sv ? "Välj sparat fakturaunderlag" : "Choose a saved draft…" },
          ...items.map((draft) => ({
            value: draft.id,
            label: `${draft.customer}, ${draft.title}`,
          })),
        ]}
      />
      <AccountingStatus locale={locale} pending={drafts.isPending} error={drafts.error} />
      {drafts.hasNextPage ? (
        <Button
          variant="ghost"
          disabled={drafts.isFetchingNextPage}
          onClick={() => void drafts.fetchNextPage()}
        >
          {sv ? "Läs in fler underlag" : "Load more sources"}
        </Button>
      ) : null}
    </Box>
  );
}

function SalesDocumentRegister(props: {
  items: readonly (typeof Sales.SalesDocument.Type)[] | undefined;
  locale: "en" | "sv";
  onOpen: (id: string) => void;
  selectedId: string;
  opener: RefObject<HTMLButtonElement | null>;
}) {
  const sv = props.locale === "sv";

  if (props.items?.length === 0)
    return (
      <PageEmpty
        title={sv ? "Inga offerter eller order" : "No quotes or orders"}
        detail={
          sv
            ? "Skapa en offert från ett granskat fakturaunderlag."
            : "Create a quote from a reviewed invoice source."
        }
      />
    );

  return (
    <RegisterTable
      label={sv ? "Offerter och order" : "Quotes and orders"}
      selected={props.selectedId}
      columns={[
        { label: sv ? "Titel" : "Title", width: "quoteTitle" },
        { label: sv ? "Kund" : "Customer" },
        { label: sv ? "Giltighet" : "Validity", width: "account" },
        { label: sv ? "Belopp" : "Amount", width: "amount", numeric: true },
        { label: "Status", width: "state" },
      ]}
      rows={(props.items ?? []).map((item) => ({
        id: item.id,
        cells: [
          <RecordOpen
            key="title"
            presentation="register"
            onClick={(event) => {
              props.opener.current = event.currentTarget;
              props.onOpen(item.id);
            }}
          >
            {item.content.title}
          </RecordOpen>,
          item.content.customer.legalName,
          sv ? "Okänd" : "Unknown",
          documentAmount(item, props.locale),
          documentStatus(item, sv),
        ],
      }))}
    />
  );
}

function documentTotals(item: typeof Sales.SalesDocument.Type) {
  const calculation = Schema.decodeUnknownOption(Schema.Struct({ totals: Drafts.DraftTotals }))(
    item.calculation,
  );

  return Option.isSome(calculation) ? calculation.value.totals : undefined;
}

function documentAmount(item: typeof Sales.SalesDocument.Type, locale: "en" | "sv") {
  const totals = documentTotals(item);

  if (totals?.grossMinor === undefined || totals.grossMinor === null) return "—";

  return formatMinorAmount(totals.grossMinor, item.content.currencyScale, locale);
}

function documentStatus(item: typeof Sales.SalesDocument.Type, sv: boolean) {
  if (item.state === "cancelled") return sv ? "Avbruten" : "Cancelled";

  if (item.state === "accepted") return sv ? "Accepterad" : "Accepted";

  return sv ? "Utkast" : "Draft";
}

function SalesOrderDetail(
  props: CommerceProps & {
    record: typeof Sales.SalesDocument.Type;
    detail: ReturnType<typeof useQuery<typeof Sales.SalesDocumentView.Type>>;
    path: string;
  },
) {
  const { book, locale, detail } = props;
  const record = detail.data?.record ?? props.record;
  const path = props.path;
  const sv = locale === "sv";
  const converted = detail.data?.conversions ?? [];
  const current = detail.isSuccess && !detail.isFetching;

  return (
    <>
      <RecordHeader>
        <FormNote compact record>
          {record.kind === "quote" ? (sv ? "Offert" : "Quote") : "Order"},{" "}
          {documentStatus(record, sv).toLocaleLowerCase()}
        </FormNote>
        <FormTitle record>{record.content.title}</FormTitle>
        <FormText record>
          {record.content.customer.legalName}, {sv ? "revision" : "revision"} {record.revision}
        </FormText>
      </RecordHeader>
      <AccountingStatus locale={locale} pending={detail.isPending} error={detail.error} />
      {detail.isError ? (
        <Action kind="secondary" onClick={() => void detail.refetch()}>
          {sv ? "Försök läsa orderdetaljer igen" : "Retry order details"}
        </Action>
      ) : null}
      <RecordSection compact label={sv ? "Sparade uppgifter" : "Saved facts"}>
        <PlainFacts
          align="end"
          presentation="record"
          compact
          facts={[
            { label: sv ? "Belopp" : "Amount", value: documentAmount(record, locale) },
            {
              label: sv ? "Dokumentnummer" : "Document number",
              value: (
                <FactDisclosure
                  summary={sv ? "Saknas" : "Missing"}
                  label={sv ? "Visa sparat offertinnehåll" : "Show saved quote content"}
                >
                  <SalesContentReview
                    locale={locale}
                    label={sv ? "Sparat offertinnehåll" : "Saved quote content"}
                    content={record.content}
                    totals={documentTotals(record)}
                  />
                </FactDisclosure>
              ),
            },
            { label: sv ? "Giltighet" : "Validity", value: sv ? "Okänd" : "Unknown" },
            { label: sv ? "Skickad" : "Sent", value: sv ? "Ej registrerat" : "Not recorded" },
          ]}
        />
      </RecordSection>
      <Box display="flex" flexDirection="column" flexGrow gap="sm" minWidth="zero">
        {record.kind === "quote" ? (
          <ReviseQuote
            key={`${book.entityId}-${book.id}-${record.id}-${record.revision}`}
            book={book}
            locale={locale}
            record={record}
            current={current}
            path={path}
          />
        ) : null}
        <SalesDocumentDecisions
          book={book}
          locale={locale}
          record={record}
          current={current}
          path={path}
          converted={converted}
        />
      </Box>
      {record.kind === "order" && record.state === "accepted" && current ? (
        <OrderConversionForm
          book={book}
          locale={locale}
          record={record}
          converted={converted}
          onConverted={() => void detail.refetch()}
        />
      ) : null}
    </>
  );
}

function SalesDocumentDecisions(
  props: CommerceProps & {
    record: typeof Sales.SalesDocument.Type;
    current: boolean;
    path: string;
    converted: (typeof Sales.SalesDocumentView.Type)["conversions"];
  },
) {
  const { book, locale, record, current } = props;
  const sv = locale === "sv";

  const canDecide =
    record.state === "draft" ||
    (record.state === "accepted" && record.kind === "quote") ||
    (record.state === "accepted" && record.kind === "order" && props.converted.length === 0);

  if (!canDecide) return null;

  const actions =
    record.state === "draft"
      ? (["accept", "cancel"] as const)
      : record.kind === "quote"
        ? (["order_from_quote", "cancel"] as const)
        : (["cancel"] as const);

  return (
    <FormColumn compact>
      {actions.map((action) => (
        <CommandForm
          key={`${record.id}:${record.revision}:${action}`}
          presentation="kanon"
          inputRequired={false}
          fullWidthSubmit
          book={book}
          locale={locale}
          path={`${props.path}/${record.id}/transitions`}
          recoveryId={`${record.id}:${action}`}
          schema={Sales.TransitionSalesDocument}
          output={Sales.SalesDocument}
          allowed={book.role === "operator" && current}
          input={() => ({
            expectedRevision: record.revision,
            expectedDigest: record.digest,
            action,
          })}
          variant="outline"
          actionKind={action === "cancel" ? "quiet" : "secondary"}
          label={salesDecisionLabel(action, record.kind, sv)}
        />
      ))}
    </FormColumn>
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
                {line?.description ?? portion.id}, {sv ? "antal" : "quantity"}: {portion.quantity} ,{" "}
                {sv ? "bas" : "base"}: {amount(portion.baseMinor)}, {sv ? "rabatt" : "discount"}:{" "}
                {amount(portion.discountMinor)}, {sv ? "avgift" : "charge"}:{" "}
                {amount(portion.chargeMinor)}, {sv ? "moms" : "tax"}: {amount(portion.taxMinor)},{" "}
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
    current: boolean;
    path: string;
  },
) {
  const { book, locale, record, current } = props;
  const path = props.path;
  const sv = locale === "sv";
  const [sourceId, setSourceId] = useState("");
  const allowed = book.role === "operator" && record.state === "draft" && current;

  const source = useQuery({
    queryKey: [...commerceKey(book), "quote-revision-source", sourceId],
    queryFn: async ({ signal }) => {
      const result = await readAccounting(
        `${commercePath(book)}/invoice-drafts/${encodeURIComponent(sourceId)}`,
        Drafts.InvoiceDraftView,
        { signal },
      );

      checkScope(book, result.record.scope);

      if (result.record.id !== sourceId) throw new Error("Quote source identity mismatch");

      if (result.lifecycle.kind !== "editable")
        throw new Error("Quote source is no longer a draft");

      return result;
    },
    enabled: allowed && !!sourceId,
    retry: false,
  });

  const reviewed =
    allowed && source.isSuccess && !source.isFetching && source.data.record.id === sourceId
      ? source.data.record
      : null;

  return (
    <CommandForm
      presentation="kanon"
      fillAvailable
      fullWidthSubmit
      variant="outline"
      book={book}
      locale={locale}
      path={`${path}/${record.id}/revisions`}
      recoveryId={record.id}
      schema={Sales.ReviseSalesDocument}
      output={Sales.SalesDocument}
      validate={(result) => {
        if (result.id !== record.id || result.kind !== "quote")
          throw new Error("Quote revision identity mismatch");
      }}
      input={(fields) => ({
        expectedRevision: record.revision,
        expectedDigest: record.digest,
        content: reviewed?.content,
        reason: fields.get("reason"),
      })}
      compact
      allowed={allowed}
      canSubmit={reviewed !== null}
      onNewCommand={() => setSourceId("")}
      label={sv ? "Spara ny offertrevision" : "Save new quote revision"}
    >
      <SalesSourceDraft
        canonical
        book={book}
        locale={locale}
        value={sourceId}
        onChange={setSourceId}
      />
      <FormText record>
        {sv
          ? "Granska ersättningsunderlaget innan du sparar en ny offertrevision."
          : "Review the replacement before saving a new quote revision."}
      </FormText>
      <AccountingStatus
        locale={locale}
        pending={!!sourceId && source.isFetching}
        error={source.error}
      />
      {reviewed ? (
        <SalesContentReview
          locale={locale}
          label={sv ? "Granskat ersättningsunderlag" : "Reviewed replacement source"}
          content={reviewed.content}
          totals={reviewed.totals}
        />
      ) : null}
      {reviewed ? (
        <KanonInputField
          name="reason"
          label={sv ? "Skäl till ändring" : "Reason for change"}
          required
        />
      ) : null}
    </CommandForm>
  );
}

function SalesContentReview({
  locale,
  label,
  content,
  totals,
}: {
  locale: "en" | "sv";
  label: string;
  content: typeof Drafts.DraftContent.Type;
  totals: typeof Drafts.DraftTotals.Type | undefined;
}) {
  const sv = locale === "sv";

  const amount = (minor: string | null | undefined) =>
    minor == null ? "—" : formatMinorAmount(minor, content.currencyScale, locale);

  return (
    <Box as="section" aria-label={label} display="grid" gap="md" minWidth="zero">
      <Heading size="section">{label}</Heading>
      <Text weight="semibold">{content.title}</Text>
      <Text>
        {sv ? "Kund" : "Customer"}: {content.customer.legalName}
      </Text>
      <Text>
        {sv ? "Säljare" : "Seller"}: {content.seller.legalName}
      </Text>
      <Text>
        {sv ? "Valuta" : "Currency"}: {content.currency}
      </Text>
      <DataTable
        title={sv ? "Sparade rader" : "Saved lines"}
        narrow="stack"
        minWidth="fit"
        presentation="register"
        columns={[
          { id: "description", label: sv ? "Beskrivning" : "Description", width: "fill" },
          { id: "quantity", label: sv ? "Antal" : "Quantity", width: 70, numeric: true },
          { id: "price", label: sv ? "Styckpris" : "Unit price", width: 90, numeric: true },
          { id: "base", label: sv ? "Basbelopp" : "Base amount", width: 100, numeric: true },
          { id: "discount", label: sv ? "Rabatt" : "Discount", width: 90, numeric: true },
          { id: "charge", label: sv ? "Avgift" : "Charge", width: 90, numeric: true },
          { id: "tax", label: sv ? "Moms" : "Tax", width: 90, numeric: true },
          { id: "gross", label: sv ? "Källbrutto" : "Source gross", width: 100, numeric: true },
        ]}
        rows={content.lines.map((line) => ({
          id: line.id,
          cells: [
            <Box key="description" display="grid" gap="xs">
              <Text>{line.description}</Text>
              {line.taxDescription ? <Text tone="muted">{line.taxDescription}</Text> : null}
            </Box>,
            line.quantity,
            amount(line.unitPriceMinor),
            amount(line.baseMinor),
            amount(line.discountMinor),
            amount(line.chargeMinor),
            amount(line.taxMinor),
            amount(line.sourceGrossMinor),
          ],
        }))}
      />
      <SalesContentTerms locale={locale} content={content} totals={totals} />
    </Box>
  );
}

function SalesContentTerms({
  locale,
  content,
  totals,
}: {
  locale: "en" | "sv";
  content: typeof Drafts.DraftContent.Type;
  totals: typeof Drafts.DraftTotals.Type | undefined;
}) {
  const sv = locale === "sv";

  const amount = (minor: string | null | undefined) =>
    minor == null ? "—" : formatMinorAmount(minor, content.currencyScale, locale);

  return (
    <>
      <Box display="grid" columns={1} columnsAtSm={2} gap="sm">
        <Text>
          {sv ? "Beräknat netto" : "Calculated net"}: {amount(totals?.netMinor)}
        </Text>
        <Text>
          {sv ? "Beräknad moms" : "Calculated tax"}: {amount(totals?.taxMinor)}
        </Text>
        <Text weight="semibold">
          {sv ? "Beräknat brutto" : "Calculated gross"}: {amount(totals?.grossMinor)}{" "}
          {content.currency}
        </Text>
        <Text>
          {sv ? "Källtotal" : "Source total"}: {amount(content.sourceTotalMinor)}
        </Text>
        <Text>
          {sv ? "Planerat fakturadatum" : "Planned invoice date"}: {content.plannedIssueDate ?? "—"}
        </Text>
        <Text>
          {sv ? "Leveransdatum" : "Supply date"}: {content.supplyDate ?? "—"}
        </Text>
        <Text>
          {sv ? "Förfallodatum för underlaget" : "Source due date"}: {content.dueDate ?? "—"}
        </Text>
        <Text>
          {sv ? "Betalningsvillkor" : "Payment terms"}: {content.paymentTerms ?? "—"}
        </Text>
      </Box>
      {content.buyerReference ? (
        <Text>
          {sv ? "Kundreferens" : "Buyer reference"}: {content.buyerReference}
        </Text>
      ) : null}
      {content.orderReference ? (
        <Text>
          {sv ? "Orderreferens" : "Order reference"}: {content.orderReference}
        </Text>
      ) : null}
      {content.note ? (
        <Text>
          {sv ? "Anteckning" : "Note"}: {content.note}
        </Text>
      ) : null}
    </>
  );
}

function salesDecisionLabel(
  action: "accept" | "cancel" | "order_from_quote",
  kind: "quote" | "order",
  sv: boolean,
) {
  if (action === "order_from_quote")
    return sv ? "Skapa order från offert" : "Create order from quote";

  if (action === "accept")
    return kind === "quote"
      ? sv
        ? "Acceptera offert"
        : "Accept quote"
      : sv
        ? "Acceptera order"
        : "Accept order";

  return kind === "quote"
    ? sv
      ? "Avbryt offert"
      : "Cancel quote"
    : sv
      ? "Avbryt order"
      : "Cancel order";
}
