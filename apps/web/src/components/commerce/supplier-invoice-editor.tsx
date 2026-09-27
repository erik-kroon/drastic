import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import * as Suppliers from "@open-erp/contracts/supplier-invoice-drafts";
import * as Inbox from "@open-erp/contracts/supplier-inbox";
import * as Extraction from "@open-erp/contracts/supplier-extraction";
import * as Commerce from "@open-erp/contracts/commerce";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { InputField } from "@open-erp/ui/components/field";
import { PageCaption } from "@open-erp/ui/components/accounting-page";
import { Text } from "@open-erp/ui/components/typography";
import { RecordColumns, RecordSection } from "@open-erp/ui/components/record-layout";
import { EvidenceCommandForm } from "@/components/evidence-command-form";
import { EvidenceInspector } from "@/components/evidence-inspector";
import { AccountingStatus } from "@/components/accounting-status";
import { OriginalDocument } from "@/components/original-document";
import { sourceDocumentOptions } from "@/lib/source-documents";
import { readAccounting } from "@/lib/accounting-api";
import {
  decimalToMinor,
  formatMinorAmount,
  minorToDecimal,
  workQueryOptions,
} from "@/lib/workspace-api";
import { InvoiceDraftParty } from "./invoice-draft-party";
import {
  InvoiceEditorLines,
  editableInvoiceLine,
  invoiceEditorTotals,
  invoiceQuantity,
  type EditableInvoiceLine,
} from "./invoice-editor-lines";
import { SupplierPicker, SupplierDocumentPicker } from "./supplier-invoice-pickers";
import { checkScope, commerceKey, commercePath, type CommerceProps } from "./shared";

type Draft = typeof Suppliers.SupplierInvoiceDraftRevision.Type;

function draftTotal(
  lines: readonly EditableInvoiceLine[],
  scale: number,
  locale: CommerceProps["locale"],
  currency: string,
) {
  const totals = invoiceEditorTotals(lines, scale);

  if (totals.net === null || totals.tax === null) return `— ${currency}`;

  return `${formatMinorAmount((totals.net + totals.tax).toString(), scale, locale)} ${currency}`;
}

export function SupplierInvoiceEditor(
  props: CommerceProps & {
    sourceId?: string;
    inboxId?: string;
    baseline?: Draft;
    onSaved: (id: string) => void;
  },
) {
  const [documentId, setDocumentId] = useState(props.sourceId ?? "");
  const metadata = useQuery(workQueryOptions(props.book, {}));
  const scale = props.baseline?.content.currencyScale ?? metadata.data?.currencyScale;

  if (!documentId && !props.baseline)
    return <SupplierDocumentPicker {...props} onSelect={setDocumentId} />;

  if (scale === undefined)
    return (
      <AccountingStatus locale={props.locale} pending={metadata.isPending} error={metadata.error} />
    );

  return (
    <SupplierEditorForm
      {...props}
      scale={scale}
      documentId={documentId}
      onChangeDocument={() => setDocumentId("select")}
      onSelectDocument={setDocumentId}
    />
  );
}

function invoiceHeaders(content: Draft["content"] | undefined, scale: number) {
  return {
    number: content?.supplierDocumentNumber ?? "",
    sourceTotal:
      content?.sourceTotalMinor == null ? "" : minorToDecimal(content.sourceTotalMinor, scale),
    documentDate: content?.documentDate ?? "",
    dueDate: content?.dueDate ?? "",
  };
}

function initialLines(content: Draft["content"] | undefined, scale: number, fromInbox: boolean) {
  return (
    content?.lines.map((line) => editableInvoiceLine(scale, line)) ?? [
      { ...editableInvoiceLine(scale), quantity: fromInbox ? "" : "1" },
    ]
  );
}

function inboxReviewAttempt(
  inboxId: string | undefined,
  inbox: typeof Inbox.SupplierInboxView.Type | undefined,
) {
  return inboxId ? (inbox?.attempts.at(-1)?.id ?? null) : null;
}

function SupplierEditorForm(
  props: CommerceProps & {
    baseline?: Draft;
    sourceId?: string;
    inboxId?: string;
    documentId: string;
    scale: number;
    onChangeDocument: () => void;
    onSelectDocument: (id: string) => void;
    onSaved: (id: string) => void;
  },
) {
  const sv = props.locale === "sv";
  const [baseline] = useState(props.baseline);
  const content = baseline?.content;
  const [headers, setHeaders] = useState(() => invoiceHeaders(content, props.scale));

  const [party, setParty] = useState<typeof Commerce.CounterpartyRevision.Type | undefined>(
    baseline?.counterparty,
  );

  const [lines, setLines] = useState(() => initialLines(content, props.scale, !!props.inboxId));

  const [draftKey] = useState(() => `supplier_${crypto.randomUUID().replaceAll("-", "")}`);
  const { source, original } = useSupplierSource(props.book, props.documentId);
  const inbox = useSupplierInboxReview(props.book, props.inboxId);
  const [selectedAttemptId, setSelectedAttemptId] = useState<string | null>(null);
  const reviewAttemptId = selectedAttemptId ?? inboxReviewAttempt(props.inboxId, inbox.data);
  const currency = content?.currency ?? props.book.currency;

  return (
    <>
      {props.inboxId ? (
        <AccountingStatus locale={props.locale} pending={inbox.isPending} error={inbox.error} />
      ) : null}
      {props.inboxId && reviewAttemptId ? (
        <PageCaption>
          {sv ? "Granskningsunderlag" : "Review extraction"}: {reviewAttemptId}
        </PageCaption>
      ) : null}
      <EvidenceCommandForm
        {...props}
        path={
          props.inboxId
            ? `${commercePath(props.book)}/supplier-inbox/${encodeURIComponent(props.inboxId)}/review`
            : `${commercePath(props.book)}/supplier-invoice-drafts${baseline ? `/${encodeURIComponent(baseline.id)}/revisions` : ""}`
        }
        schema={
          props.inboxId
            ? Inbox.ReviewSupplierInbox
            : baseline
              ? Suppliers.ReviseSupplierInvoiceDraft
              : Suppliers.CreateSupplierInvoiceDraft
        }
        output={props.inboxId ? Inbox.SupplierInboxReview : Suppliers.SupplierInvoiceDraftRevision}
        label={sv ? "Spara utkast" : "Save draft"}
        canSubmit={
          !!party &&
          (props.documentId ? !!original : !!baseline) &&
          (!props.inboxId || inbox.isSuccess)
        }

        stickyFooter
        footerSummary={
          <Box display="grid" gap="xs">
            <Text>
              {sv ? "Totalt" : "Total"}: {draftTotal(lines, props.scale, props.locale, currency)}
            </Text>
            <PageCaption>
              {sv
                ? "Sparar ett utkast. Attest och bokföring sker efter granskning; betalningsfiler hanteras separat."
                : "Saves a draft. Approval and posting follow review; payment files are separate."}
            </PageCaption>
          </Box>
        }
        onSuccess={(record) => props.onSaved("draft" in record ? record.draft.id : record.id)}
        source={(fields) => ({
          title: original?.filename ?? content?.title ?? "Supplier invoice",
          origin: original
            ? `Original document: ${original.filename}`
            : "Supplier invoice details revised in OpenERP",
          mediaType: "application/json",
          content: JSON.stringify(
            original
              ? {
                  kind: "supplier_invoice_source_v1",
                  source: {
                    occurrenceId: original.id,
                    sha256: original.sha256,
                    filename: original.filename,
                  },
                }
              : {
                  kind: "supplier_invoice_revision_v1",
                  sourceEvidenceId: baseline?.sourceEvidence.evidenceId,
                  fields: Object.fromEntries(fields),
                },
          ),
        })}
        input={(fields, evidence) => {
          const next = supplierContent(fields, {
            party,
            baseline,
            evidenceId: evidence.id,
            lines,
            scale: props.scale,
            currency,
            sourceEvidenceId: original ? evidence.id : baseline?.sourceEvidence.evidenceId,
          });

          return baseline
            ? {
                expectedRevision: baseline.revision,
                expectedDigest: baseline.digest,
                reason: textField(fields, "reason"),
                content: next,
              }
            : props.inboxId
              ? {
                  draft: { draftKey, content: next },
                  reviewReason: textField(fields, "reviewReason"),
                  reviewAttemptId,
                }
              : { draftKey, content: next };
        }}
      >
        <RecordColumns>
          <SupplierOriginalDocument
            {...props}
            baseline={baseline}
            source={source}
            original={original}
          />
          <Box display="grid" gap="lg">
            <NewInvoiceSuggestions
              {...props}
              onUse={(name, value, attemptId) => {
                setHeaders((current) => ({ ...current, [name]: value }));
                setSelectedAttemptId(attemptId);
              }}
            />
            <SupplierInvoiceFields
              {...props}
              headers={headers}
              onHeader={(name, value) => setHeaders((current) => ({ ...current, [name]: value }))}
              content={content}
              party={party}
              onPartySelect={setParty}
              currency={currency}
            />
          </Box>
        </RecordColumns>
        <RecordSection title={`${sv ? "Fakturarader" : "Invoice lines"} · ${currency}`}>
          <InvoiceEditorLines
            locale={props.locale}
            currency={currency}
            scale={props.scale}
            lines={lines}
            onChange={setLines}
          />
        </RecordSection>
        {props.inboxId ? (
          <InputField
            name="reviewReason"
            label={
              sv ? "Vad granskades mot originalet?" : "What was reviewed against the original?"
            }
            required
            maxLength={2000}
          />
        ) : null}
        {baseline ? (
          <InputField
            name="reason"
            label={sv ? "Vad ändrades?" : "What changed?"}
            required
            maxLength={2000}
          />
        ) : null}
      </EvidenceCommandForm>
    </>
  );
}

function useSupplierInboxReview(book: CommerceProps["book"], inboxId?: string) {
  return useQuery({
    queryKey: [...commerceKey(book), "supplier-inbox", "review", inboxId ?? ""],
    enabled: !!inboxId,
    queryFn: async ({ signal }) => {
      const result = await readAccounting(
        `${commercePath(book)}/supplier-inbox/${encodeURIComponent(inboxId ?? "")}`,
        Inbox.SupplierInboxView,
        { signal },
      );

      checkScope(book, result.occurrence.occurrence.scope);

      if (result.occurrence.occurrence.id !== inboxId) throw new Error("Inbox identity mismatch");

      return result;
    },
    retry: false,
  });
}

function useSupplierSource(book: CommerceProps["book"], documentId: string) {
  const source = useQuery({
    ...sourceDocumentOptions(book, documentId),
    enabled: !!documentId && documentId !== "select",
  });

  const original = source.isError ? undefined : source.data?.occurrence;

  return { source, original };
}

function SupplierOriginalDocument(
  props: CommerceProps & {
    baseline?: Draft;
    source: ReturnType<typeof useSupplierSource>["source"];
    original: ReturnType<typeof useSupplierSource>["original"];
    sourceId?: string;
    documentId: string;
    onChangeDocument: () => void;
    onSelectDocument: (id: string) => void;
  },
) {
  const sv = props.locale === "sv";
  const { baseline } = props;
  const { source, original } = props;

  return (
    <RecordSection title={sv ? "Originalfaktura" : "Original invoice"} sticky>
      {baseline && !props.documentId ? (
        <>
          <EvidenceInspector
            {...props}
            expanded
            compact
            reference={{ ...baseline.sourceEvidence, locator: baseline.content.title }}
          />
          <Button type="button" variant="ghost" onClick={() => props.onSelectDocument("select")}>
            {sv ? "Byt original" : "Replace original"}
          </Button>
        </>
      ) : props.documentId === "select" ? (
        <Box display="grid" gap="md">
          <SupplierDocumentPicker {...props} onSelect={props.onSelectDocument} />
          <Button
            type="button"
            variant="ghost"
            onClick={() => props.onSelectDocument(baseline ? "" : (props.sourceId ?? ""))}
          >
            {sv ? "Avbryt byte" : "Cancel replacement"}
          </Button>
        </Box>
      ) : (
        <>
          <AccountingStatus locale={props.locale} pending={source.isPending} error={source.error} />
          {original ? (
            <OriginalDocument {...props} id={original.id} sha256={original.sha256} />
          ) : null}
          {source.isError ? (
            <Button type="button" variant="outline" onClick={() => void source.refetch()}>
              {sv ? "Försök läsa originalet igen" : "Retry original"}
            </Button>
          ) : null}
          <Box>
            <Button type="button" variant="ghost" onClick={props.onChangeDocument}>
              {sv ? "Välj ett annat dokument" : "Choose another document"}
            </Button>
          </Box>
        </>
      )}
    </RecordSection>
  );
}

type InvoiceHeaders = {
  number: string;
  sourceTotal: string;
  documentDate: string;
  dueDate: string;
};

function NewInvoiceSuggestions(
  props: CommerceProps & {
    inboxId?: string;
    baseline?: Draft;
    scale: number;
    onUse: (name: keyof InvoiceHeaders, value: string, attemptId: string) => void;
  },
) {
  return props.inboxId && !props.baseline ? (
    <ReadingSuggestions {...props} inboxId={props.inboxId} />
  ) : null;
}

function ReadingSuggestions(
  props: CommerceProps & {
    inboxId: string;
    scale: number;
    onUse: (name: keyof InvoiceHeaders, value: string, attemptId: string) => void;
  },
) {
  const sv = props.locale === "sv";

  const reading = useQuery<typeof Extraction.SupplierExtractionState.Type>({
    queryKey: [...commerceKey(props.book), "supplier-inbox", props.inboxId, "extraction"],
    queryFn: ({ signal }) =>
      readAccounting(
        `${commercePath(props.book)}/supplier-inbox/${encodeURIComponent(props.inboxId)}/extraction`,
        Extraction.SupplierExtractionState,
        { signal },
      ),
    retry: false,
    refetchInterval: (query) => (query.state.data?.requests[0]?.state === "ready" ? 2000 : false),
  });

  const attempt = reading.data?.attempt;

  const names = [
    {
      field: "supplierDocumentNumber",
      name: "number",
      label: sv ? "Fakturanummer" : "Invoice number",
    },
    {
      field: "sourceTotalMinor",
      name: "sourceTotal",
      label: sv ? "Total enligt fakturan" : "Invoice total",
    },
    { field: "documentDate", name: "documentDate", label: sv ? "Fakturadatum" : "Invoice date" },
    { field: "dueDate", name: "dueDate", label: sv ? "Förfallodatum" : "Due date" },
  ] as const;

  return (
    <RecordSection title={sv ? "Förslag från originalet" : "Suggestions from the original"}>
      <AccountingStatus locale={props.locale} pending={reading.isPending} error={reading.error} />
      <Text>
        {sv
          ? "Kontrollera varje förslag mot originalet innan du använder det. Fyll i saknade uppgifter själv."
          : "Check each suggestion against the original before using it. Complete missing details yourself."}
      </Text>
      {attempt?.document?.coverage === "partial" ? (
        <Text>
          {sv
            ? "Sidor saknas i läsningen. Granska hela originalet."
            : "Pages are missing from the reading. Review the whole original."}
        </Text>
      ) : null}
      {attempt?.result === "succeeded" && reading.data?.requests[0]?.state === "completed" ? (
        attempt.fields.map((field) => {
          const name = names.find((item) => item.field === field.fieldKey);

          if (!name || field.proposedValue === null) return null;

          const value =
            field.fieldKey === "sourceTotalMinor"
              ? minorToDecimal(field.proposedValue, props.scale)
              : field.proposedValue;

          return (
            <Box key={field.fieldKey} display="grid" gap="sm">
              <Text>
                {name.label}: {value}
                {field.fieldKey === "sourceTotalMinor" ? ` ${props.book.currency}` : ""}
              </Text>
              <Text>
                {field.sourceLocators
                  .map((locator) =>
                    typeof locator === "string"
                      ? locator
                      : `${sv ? "Sida" : "Page"} ${locator.page}: “${locator.quote}”`,
                  )
                  .join(" · ")}
              </Text>
              <Button
                type="button"
                variant="outline"
                onClick={() => props.onUse(name.name, value, attempt.attemptId)}
              >
                {sv ? "Använd" : "Use"} {name.label.toLocaleLowerCase(props.locale)}
              </Button>
            </Box>
          );
        })
      ) : (
        <Text>
          {sv
            ? "Inga färdiga förslag finns. Du kan fylla i utkastet manuellt."
            : "No completed suggestions are available. You can complete the draft manually."}
        </Text>
      )}
    </RecordSection>
  );
}

function SupplierInvoiceFields(
  props: CommerceProps & {
    headers: InvoiceHeaders;
    onHeader: (name: keyof InvoiceHeaders, value: string) => void;
    content?: Draft["content"];
    party?: typeof Commerce.CounterpartyRevision.Type;
    onPartySelect: (party: typeof Commerce.CounterpartyRevision.Type) => void;
    currency: string;
    scale: number;
  },
) {
  const sv = props.locale === "sv";
  const currency = props.currency;

  return (
    <Box display="grid" gap="xl">
      <SupplierPartyFields {...props} />
      <RecordSection title={sv ? "Fakturauppgifter" : "Invoice details"}>
        <InputField
          name="title"
          label={sv ? "Beskrivning" : "Description"}
          required
          maxLength={200}
          defaultValue={props.content?.title}
          placeholder={sv ? "Vad gäller fakturan?" : "What is this invoice for?"}
        />
        <Box display="grid" columns={2} gap="md">
          <InputField
            name="number"
            label={sv ? "Leverantörens fakturanummer" : "Supplier invoice number"}
            maxLength={128}
            value={props.headers.number}
            onChange={(event) => props.onHeader("number", event.target.value)}
          />
          <InputField
            name="sourceTotal"
            label={`${sv ? "Total enligt fakturan" : "Total on invoice"} · ${currency}`}
            inputMode="decimal"
            value={props.headers.sourceTotal}
            onChange={(event) => props.onHeader("sourceTotal", event.target.value)}
          />
          <InputField
            name="documentDate"
            label={sv ? "Fakturadatum" : "Invoice date"}
            type="date"
            value={props.headers.documentDate}
            onChange={(event) => props.onHeader("documentDate", event.target.value)}
          />
          <InputField
            name="dueDate"
            label={sv ? "Förfallodatum" : "Due date"}
            type="date"
            value={props.headers.dueDate}
            onChange={(event) => props.onHeader("dueDate", event.target.value)}
          />
          <InputField
            name="supplyDate"
            label={sv ? "Leveransdatum" : "Supply date"}
            type="date"
            defaultValue={props.content?.supplyDate ?? ""}
          />
          <InputField
            name="terms"
            label={sv ? "Betalningsvillkor" : "Payment terms"}
            maxLength={1000}
            defaultValue={props.content?.paymentTerms ?? ""}
          />
        </Box>
        <PageCaption>
          {sv
            ? "Lämna okända uppgifter tomma. Belopp anges i bokföringens valuta; valutaväxling stöds inte här."
            : "Leave unknown details blank. Amounts use the book currency; currency conversion is not supported here."}
        </PageCaption>
      </RecordSection>
      <InvoiceDraftParty
        locale={props.locale}
        title={sv ? "Fakturamottagare" : "Billed to"}
        prefix="customer"
        party={
          props.content?.buyer ?? {
            legalName: props.book.name,
            address: null,
            registrationId: null,
            countryCode: null,
          }
        }
      />
    </Box>
  );
}

function SupplierPartyFields(
  props: CommerceProps & {
    content?: Draft["content"];
    party?: typeof Commerce.CounterpartyRevision.Type;
    onPartySelect: (party: typeof Commerce.CounterpartyRevision.Type) => void;
  },
) {
  const sv = props.locale === "sv";

  return (
    <RecordSection title={sv ? "Leverantör" : "Supplier"}>
      <SupplierPicker {...props} selected={props.party} onSelect={props.onPartySelect} />
      {props.party ? (
        <InvoiceDraftParty
          key={`${props.party.id}:${props.party.revision}`}
          locale={props.locale}
          title={sv ? "Leverantörens fakturauppgifter" : "Supplier billing details"}
          prefix="seller"
          party={
            props.content && props.content.counterpartyId === props.party.id
              ? props.content.supplier
              : {
                  legalName: props.party.displayName,
                  address: null,
                  registrationId: null,
                  countryCode: null,
                }
          }
        />
      ) : null}
    </RecordSection>
  );
}

function textField(fields: FormData, name: string) {
  const value = fields.get(name);

  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function amount(fields: FormData, name: string, scale: number, optional = true) {
  const text = textField(fields, name);

  return optional && text === null ? null : (decimalToMinor(text ?? "", scale) ?? "invalid");
}

function identity(
  fields: FormData,
  prefix: "seller" | "customer",
  evidenceId: string,
  previous?: typeof Suppliers.SupplierDraftContent.Type.supplier,
) {
  return {
    legalName: textField(fields, prefix === "seller" ? "seller" : "customerName"),
    registrationId: textField(
      fields,
      prefix === "seller" ? "registration" : "customerRegistration",
    ),
    taxId: previous?.taxId ?? null,
    address: textField(fields, `${prefix}Address`),
    countryCode: textField(fields, `${prefix}Country`),
    evidenceId,
  };
}

function supplierContent(
  fields: FormData,
  state: {
    party: typeof Commerce.CounterpartyRevision.Type | undefined;
    baseline?: Draft;
    evidenceId: string;
    lines: readonly EditableInvoiceLine[];
    scale: number;
    currency: string;
    sourceEvidenceId?: string;
  },
) {
  const content = state.baseline?.content;

  return {
    title: textField(fields, "title"),
    counterpartyId: state.party?.id,
    counterpartyRevision: state.party?.revision,
    supplier: identity(
      fields,
      "seller",
      state.evidenceId,
      content?.counterpartyId === state.party?.id ? content?.supplier : undefined,
    ),
    buyer: identity(fields, "customer", state.evidenceId, content?.buyer),
    sourceEvidenceId: state.sourceEvidenceId ?? state.evidenceId,
    supplierDocumentNumber: textField(fields, "number"),
    currency: state.currency,
    currencyScale: state.scale,
    documentDate: textField(fields, "documentDate"),
    supplyDate: textField(fields, "supplyDate"),
    dueDate: textField(fields, "dueDate"),
    paymentTerms: textField(fields, "terms"),
    sourceTotalMinor: amount(fields, "sourceTotal", state.scale),
    lines: state.lines.map((line) => ({
      id: line.id,
      description: textField(fields, `${line.id}_description`),
      quantity: invoiceQuantity(textField(fields, `${line.id}_quantity`)),
      unitPriceMinor: amount(fields, `${line.id}_unitPrice`, state.scale),
      baseMinor: amount(fields, `${line.id}_amount`, state.scale, false),
      discountMinor: line.defaults?.discountMinor ?? "0",
      chargeMinor: line.defaults?.chargeMinor ?? "0",
      taxMinor: amount(fields, `${line.id}_tax`, state.scale),
      taxDescription: textField(fields, `${line.id}_taxDescription`),
      taxEvidenceId: textField(fields, `${line.id}_tax`) === null ? null : state.evidenceId,
      sourceGrossMinor: amount(fields, `${line.id}_sourceGross`, state.scale),
    })),
  };
}
