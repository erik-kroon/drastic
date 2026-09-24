import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import * as Suppliers from "@open-erp/contracts/supplier-invoice-drafts";
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
import { commercePath, type CommerceProps } from "./shared";

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
  props: CommerceProps & { sourceId?: string; baseline?: Draft; onSaved: (id: string) => void },
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
function SupplierEditorForm(
  props: CommerceProps & {
    baseline?: Draft;
    sourceId?: string;
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
  const [party, setParty] = useState<typeof Commerce.CounterpartyRevision.Type | undefined>(
    baseline?.counterparty,
  );
  const [lines, setLines] = useState(
    () =>
      content?.lines.map((line) => editableInvoiceLine(props.scale, line)) ?? [
        editableInvoiceLine(props.scale),
      ],
  );
  const [draftKey] = useState(() => `supplier_${crypto.randomUUID().replaceAll("-", "")}`);
  const source = useQuery({
    ...sourceDocumentOptions(props.book, props.documentId),
    enabled: !!props.documentId && props.documentId !== "select",
  });
  const original = source.isError ? undefined : source.data?.occurrence;
  const currency = content?.currency ?? props.book.currency;
  return (
    <EvidenceCommandForm
      {...props}
      path={`${commercePath(props.book)}/supplier-invoice-drafts${baseline ? `/${encodeURIComponent(baseline.id)}/revisions` : ""}`}
      schema={
        baseline ? Suppliers.ReviseSupplierInvoiceDraft : Suppliers.CreateSupplierInvoiceDraft
      }
      output={Suppliers.SupplierInvoiceDraftRevision}
      label={sv ? "Spara utkast" : "Save draft"}
      canSubmit={!!party && (props.documentId ? !!original : !!baseline)}
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
      onSuccess={(record) => props.onSaved(record.id)}
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
          : { draftKey, content: next };
      }}
    >
      <RecordColumns>
        <RecordSection title={sv ? "Originalfaktura" : "Original invoice"} sticky>
          {baseline && !props.documentId ? (
            <>
              <EvidenceInspector
                {...props}
                expanded
                compact
                reference={{ ...baseline.sourceEvidence, locator: baseline.content.title }}
              />
              <Button
                type="button"
                variant="ghost"
                onClick={() => props.onSelectDocument("select")}
              >
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
              <AccountingStatus
                locale={props.locale}
                pending={source.isPending}
                error={source.error}
              />
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
        <SupplierInvoiceFields
          {...props}
          content={content}
          party={party}
          onPartySelect={setParty}
          currency={currency}
        />
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
      {baseline ? (
        <InputField
          name="reason"
          label={sv ? "Vad ändrades?" : "What changed?"}
          required
          maxLength={2000}
        />
      ) : null}
    </EvidenceCommandForm>
  );
}
function SupplierInvoiceFields(
  props: CommerceProps & {
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
            defaultValue={props.content?.supplierDocumentNumber ?? ""}
          />
          <InputField
            name="sourceTotal"
            label={`${sv ? "Total enligt fakturan" : "Total on invoice"} · ${currency}`}
            inputMode="decimal"
            defaultValue={
              props.content?.sourceTotalMinor == null
                ? ""
                : minorToDecimal(props.content.sourceTotalMinor, props.scale)
            }
          />
          <InputField
            name="documentDate"
            label={sv ? "Fakturadatum" : "Invoice date"}
            type="date"
            defaultValue={props.content?.documentDate ?? ""}
          />
          <InputField
            name="dueDate"
            label={sv ? "Förfallodatum" : "Due date"}
            type="date"
            defaultValue={props.content?.dueDate ?? ""}
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
