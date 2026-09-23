import { useState, type ReactNode } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import * as Drafts from "@open-erp/contracts/invoice-drafts";
import * as Commerce from "@open-erp/contracts/commerce";
import { Plus, ArrowLeft } from "lucide-react";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { InputField, SelectField } from "@open-erp/ui/components/field";
import { DataTable } from "@open-erp/ui/components/data-table";
import { Text } from "@open-erp/ui/components/typography";
import { Badge } from "@open-erp/ui/components/badge";
import { InvoiceDraftParty } from "./invoice-draft-party";
import { InvoiceDraftDocument } from "./invoice-draft-document";
import { FormDialog } from "@open-erp/ui/components/form-dialog";
import {
  PageEmpty,
  RegisterFilters,
  RegisterSearch,
  RecordToggle,
  PageCaption,
} from "@open-erp/ui/components/accounting-page";
import {
  DocumentPaper,
  DocumentTitleField,
  RecordHeading,
  RecordColumns,
  RecordSection,
  RecordSplit,
} from "@open-erp/ui/components/record-layout";
import { AccountingStatus } from "@/components/accounting-status";
import { InvoiceDraftSave } from "./invoice-draft-save";
import {
  InvoiceDraftSession,
  restoredField,
  selectDraftCustomer,
  type DraftSession,
} from "./invoice-draft-session";
import { readAccounting } from "@/lib/accounting-api";
import { decimalToMinor, formatMinorAmount, workQueryOptions } from "@/lib/workspace-api";
import {
  InvoiceEditorLines,
  invoiceEditorTotals,
  invoiceQuantity,
  type EditableInvoiceLine,
} from "./invoice-editor-lines";
import { ContactEditor } from "./contact-editor";
import { invoiceDraftBlocker } from "./invoice-draft-copy";
import {
  Details,
  Evidence,
  Facts,
  checkScope,
  commerceKey,
  commercePath,
  type CommerceProps,
} from "./shared";

type Draft = typeof Drafts.InvoiceDraftRevision.Type;
type DraftActions = { issueAction?: ReactNode; issueStatus?: ReactNode; contextual?: boolean };
export function NewInvoiceDraft(
  props: CommerceProps & { onSaved: (id: string) => void; onClose: () => void },
) {
  return (
    <InvoiceDraftSession {...props} onSaved={(record) => props.onSaved(record.id)}>
      {(session) => <DraftEditor book={props.book} locale={props.locale} session={session} />}
    </InvoiceDraftSession>
  );
}
export function InvoiceDrafts(
  props: CommerceProps & DraftActions & { recordId?: string; onOpen?: (id: string) => void },
) {
  const sv = props.locale === "sv";
  const labels = sv ? swedish : english;
  const [local, setLocal] = useState("");
  const [search, setSearch] = useState("");
  const selected = props.recordId ?? local;
  const select = props.onOpen ?? setLocal;
  const list = useQuery({
    queryKey: [...commerceKey(props.book), "invoice-drafts"],
    queryFn: async ({ signal }) => {
      const result = await readAccounting(
        `${commercePath(props.book)}/invoice-drafts`,
        Drafts.InvoiceDraftList,
        { signal },
      );
      checkScope(props.book, result.scope);
      return result;
    },
    retry: false,
  });
  if (selected && selected !== "new")
    return (
      <Box display="grid" gap="xl">
        {!props.contextual ? (
          <Box>
            <Button variant="ghost" onClick={() => select("")}>
              <ArrowLeft size={14} />
              {labels.allDrafts}
            </Button>
          </Box>
        ) : null}
        <DraftDetail {...props} id={selected} />
      </Box>
    );
  const items =
    list.data?.items.filter((record) =>
      `${record.title} ${record.customerName}`
        .toLocaleLowerCase(props.locale)
        .includes(search.toLocaleLowerCase(props.locale)),
    ) ?? [];
  return (
    <Box display="grid" gap="xl">
      <RecordHeading
        title={labels.invoiceDrafts}
        subtitle={labels.prepareYourInvoiceAndReview}
        action={
          <Button disabled={props.book.role !== "operator"} onClick={() => select("new")}>
            <Plus size={14} />
            {labels.newInvoice}
          </Button>
        }
      />
      <RegisterFilters>
        <RegisterSearch
          aria-label={labels.searchInvoiceDrafts}
          placeholder={labels.searchCustomerOrDescription}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </RegisterFilters>
      <AccountingStatus locale={props.locale} pending={list.isPending} error={list.error} />
      {list.isSuccess ? (
        <>
          {items.length ? (
            <DataTable
              title={labels.drafts}
              narrow="stack"
              columns={[
                { id: "title", label: labels.invoice },
                { id: "customer", label: labels.customer },
                { id: "date", label: labels.updated },
                { id: "status", label: "Status" },
                { id: "total", label: labels.amount, numeric: true },
              ]}
              rows={items.map((record) => ({
                id: record.id,
                cells: [
                  <RecordToggle key="open" expanded={false} onClick={() => select(record.id)}>
                    {record.title}
                  </RecordToggle>,
                  record.customerName,
                  new Intl.DateTimeFormat(props.locale, { dateStyle: "medium" }).format(
                    new Date(record.createdAt),
                  ),
                  <Badge key="status" variant={record.blockerCount ? "warning" : "secondary"}>
                    {record.blockerCount ? labels.needsDetails : labels.draft}
                  </Badge>,
                  record.grossMinor === null
                    ? "—"
                    : `${formatMinorAmount(record.grossMinor, record.currencyScale, props.locale)} ${record.currency}`,
                ],
              }))}
            />
          ) : (
            <PageEmpty
              title={search ? labels.noMatchingInvoices : labels.yourNextInvoiceStartsHere}
              detail={labels.chooseACustomerAddYour}
            />
          )}
          <PageCaption>{labels.draftsHaveNotBeenIssued}</PageCaption>
        </>
      ) : null}
      {selected === "new" ? (
        <NewInvoiceDraft {...props} onClose={() => select("")} onSaved={select} />
      ) : null}
    </Box>
  );
}
function inputText(fields: FormData, name: string) {
  const value = fields.get(name);
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
function decimalField(fields: FormData, name: string, scale: number, optional = false) {
  const value = inputText(fields, name);
  if (optional && value === null) return null;
  return decimalToMinor(value ?? "", scale) ?? "invalid";
}
function editAmount(value: string | null | undefined, scale: number) {
  if (value == null) return "";
  const padded = value.padStart(scale + 1, "0");
  return scale ? `${padded.slice(0, -scale)}.${padded.slice(-scale)}` : padded;
}
function DraftEditor(props: CommerceProps & { session: DraftSession }) {
  const sv = props.locale === "sv";
  const labels = sv ? swedish : english;
  const session = props.session;
  const baseline = session.state.baseline;
  const content = baseline?.content;
  const customer = session.state.customer;
  const draftKey = session.state.draftKey;
  const lines = session.state.lines;
  const metadata = useQuery(workQueryOptions(props.book, {}));
  const scale = content?.currencyScale ?? metadata.data?.currencyScale;
  if (scale === undefined)
    return (
      <AccountingStatus locale={props.locale} pending={metadata.isPending} error={metadata.error} />
    );
  return (
    <InvoiceDraftSave
      {...props}
      footerSummary={
        <DraftFooter
          lines={lines}
          scale={scale}
          content={content}
          bookCurrency={props.book.currency}
          locale={props.locale}
        />
      }
      source={(fields) => ({
        title: inputText(fields, "title") ?? labels.invoiceDrafts,
        origin: "Invoice details entered in OpenERP",
        mediaType: "application/json",
        content: JSON.stringify({ kind: "invoice_entry_v1", fields: Object.fromEntries(fields) }),
      })}
      input={(fields, evidence) => {
        const evidenceId = evidence.id;
        const next = {
          title: inputText(fields, "title"),
          counterpartyId: customer?.id,
          counterpartyRevision: customer?.revision,
          seller: {
            legalName: inputText(fields, "seller"),
            registrationId: inputText(fields, "registration"),
            taxId: content?.seller.taxId ?? null,
            address: inputText(fields, "sellerAddress"),
            countryCode: inputText(fields, "sellerCountry"),
            evidenceId,
          },
          customer: {
            legalName: inputText(fields, "customerName"),
            registrationId: inputText(fields, "customerRegistration"),
            taxId: content?.customer.taxId ?? null,
            address: inputText(fields, "customerAddress"),
            countryCode: inputText(fields, "customerCountry"),
            evidenceId,
          },
          currency: content?.currency ?? props.book.currency,
          currencyScale: scale,
          plannedIssueDate: inputText(fields, "issueDate"),
          supplyDate: inputText(fields, "supplyDate"),
          dueDate: inputText(fields, "dueDate"),
          paymentTerms: inputText(fields, "terms"),
          sourceTotalMinor: decimalField(fields, "sourceTotal", scale, true),
          lines: lines.map((line) => ({
            id: line.id,
            description: inputText(fields, `${line.id}_description`),
            quantity: invoiceQuantity(inputText(fields, `${line.id}_quantity`)),
            unitPriceMinor: decimalField(fields, `${line.id}_unitPrice`, scale, true),
            baseMinor: decimalField(fields, `${line.id}_amount`, scale),
            discountMinor: line.defaults?.discountMinor ?? "0",
            chargeMinor: line.defaults?.chargeMinor ?? "0",
            taxMinor: decimalField(fields, `${line.id}_tax`, scale, true),
            taxDescription: inputText(fields, `${line.id}_taxDescription`),
            taxEvidenceId: inputText(fields, `${line.id}_tax`) === null ? null : evidenceId,
            sourceGrossMinor: decimalField(fields, `${line.id}_sourceGross`, scale, true),
          })),
        };
        return baseline
          ? {
              expectedRevision: session.state.expected?.revision ?? baseline.revision,
              expectedDigest: session.state.expected?.digest ?? baseline.digest,
              reason: inputText(fields, "reason"),
              content: next,
            }
          : { draftKey, content: next };
      }}
    >
      <DocumentPaper compact>
        <DraftDates content={content} locale={props.locale} session={session} />
        <RecordColumns>
          <DraftCustomerPicker
            book={props.book}
            locale={props.locale}
            content={content}
            customer={customer}
            session={session}
            onChange={(party) => selectDraftCustomer(session, party)}
          />
          <InvoiceDraftParty
            title={labels.from}
            prefix="seller"
            locale={props.locale}
            party={{
              legalName: restoredField(
                session,
                "seller",
                content?.seller.legalName ?? props.book.name,
              ),
              registrationId: restoredField(
                session,
                "registration",
                content?.seller.registrationId ?? "",
              ),
              address: restoredField(session, "sellerAddress", content?.seller.address ?? ""),
              countryCode: restoredField(
                session,
                "sellerCountry",
                content?.seller.countryCode ?? "",
              ),
            }}
          />
        </RecordColumns>
        <RecordSection title={`${labels.lineItems} · ${content?.currency ?? props.book.currency}`}>
          <InvoiceEditorLines
            lines={lines}
            fields={session.state.fields}
            onChange={(next) => session.update({ lines: next })}
            scale={scale}
            currency={content?.currency ?? props.book.currency}
            locale={props.locale}
            footer={
              <Box display="grid" gap="lg">
                <InputField
                  name="terms"
                  label={labels.paymentTerms}
                  maxLength={1000}
                  defaultValue={restoredField(session, "terms", content?.paymentTerms ?? "")}
                  placeholder={sv ? "Till exempel 30 dagar" : "For example, 30 days"}
                />
                <Box display="grid" gap="sm">
                  <InputField
                    name="sourceTotal"
                    label={sv ? "Avtalat totalbelopp (valfritt)" : "Agreed total (optional)"}
                    inputMode="decimal"
                    defaultValue={restoredField(
                      session,
                      "sourceTotal",
                      editAmount(content?.sourceTotalMinor, scale),
                    )}
                    placeholder="—"
                  />
                  <PageCaption>
                    {sv
                      ? "Totalsumman från avtalet eller beställningen."
                      : "The total from your agreement or order."}
                  </PageCaption>
                </Box>
              </Box>
            }
          />
        </RecordSection>
        {baseline ? (
          <InputField
            name="reason"
            label={labels.whatChanged}
            required
            defaultValue={restoredField(session, "reason")}
          />
        ) : null}
      </DocumentPaper>
    </InvoiceDraftSave>
  );
}
function DraftFooter(props: {
  lines: readonly EditableInvoiceLine[];
  scale: number;
  content?: DraftContent;
  bookCurrency: string;
  locale: CommerceProps["locale"];
}) {
  const labels = props.locale === "sv" ? swedish : english;
  const gross = invoiceEditorTotals(props.lines, props.scale).gross;
  const currency = props.content?.currency ?? props.bookCurrency;
  return (
    <Box display="grid" gap="xs">
      <Text>
        <strong>
          {labels.total}:{" "}
          {gross === null
            ? "—"
            : `${formatMinorAmount(gross.toString(), props.scale, props.locale)} ${currency}`}
        </strong>
      </Text>
      <PageCaption>{labels.savedAsADraftNo}</PageCaption>
    </Box>
  );
}

function DraftDetail(props: CommerceProps & DraftActions & { id: string }) {
  const sv = props.locale === "sv";
  const labels = sv ? swedish : english;
  const [revision, setRevision] = useState("");
  const [editing, setEditing] = useState<Draft | null>(null);
  const view = useQuery({
    queryKey: [...commerceKey(props.book), "invoice-draft", props.id, revision],
    queryFn: async ({ signal }) => {
      const result = await readAccounting(
        `${commercePath(props.book)}/invoice-drafts/${encodeURIComponent(props.id)}${revision ? `?revision=${encodeURIComponent(revision)}` : ""}`,
        Drafts.InvoiceDraftView,
        { signal },
      );
      checkScope(props.book, result.record.scope);
      if (result.record.id !== props.id) throw new Error("Invoice draft identity mismatch");
      return result;
    },
    retry: false,
  });
  const history = useQuery({
    queryKey: [...commerceKey(props.book), "invoice-draft-history", props.id],
    queryFn: async ({ signal }) => {
      const result = await readAccounting(
        `${commercePath(props.book)}/invoice-drafts/${encodeURIComponent(props.id)}/revisions`,
        Drafts.InvoiceDraftHistory,
        { signal },
      );
      checkScope(props.book, result.scope);
      if (result.id !== props.id) throw new Error("Invoice history identity mismatch");
      return result;
    },
    retry: false,
  });
  const record = view.data?.record;
  return (
    <Box display="grid" gap="xl">
      <AccountingStatus locale={props.locale} pending={view.isPending} error={view.error} />
      {record && !view.isError ? (
        <>
          <RecordHeading
            title={record.content.title}
            subtitle={record.content.customer.legalName}
            action={
              <Box display="flex" gap="md" alignItems="center">
                {props.issueAction}
                <Button
                  variant="outline"
                  disabled={
                    props.book.role !== "operator" ||
                    view.isFetching ||
                    record.revision !== view.data?.currentRevision
                  }
                  onClick={() => setEditing(record)}
                >
                  {labels.editDraft}
                </Button>
              </Box>
            }
          />
          <RecordSplit
            aside={
              <>
                <RecordSection title={labels.status}>
                  <Box>
                    <Badge variant="secondary">{labels.draft}</Badge>
                  </Box>
                  {props.issueStatus ?? <Text tone="muted">{labels.notIssuedSentOrPosted}</Text>}
                </RecordSection>
                <DraftReadiness record={record} locale={props.locale} />
                <Details title={labels.sourceRecords}>
                  <Evidence {...props} reference={record.sellerEvidence} />
                  <Evidence {...props} reference={record.customerEvidence} />
                </Details>
                <Details title={labels.revisionHistory}>
                  <AccountingStatus
                    locale={props.locale}
                    pending={history.isPending}
                    error={history.error}
                  />
                  {history.data?.items.map((item) => (
                    <Button
                      key={item.revision}
                      variant="ghost"
                      onClick={() => setRevision(item.revision)}
                    >
                      {labels.revision} {item.revision} ·{" "}
                      {new Intl.DateTimeFormat(props.locale, { dateStyle: "medium" }).format(
                        new Date(item.createdAt),
                      )}
                    </Button>
                  ))}
                  {revision ? (
                    <Button variant="outline" onClick={() => setRevision("")}>
                      {labels.showLatest}
                    </Button>
                  ) : null}
                </Details>
                <Facts title={labels.technicalReferences} value={record} />
              </>
            }
          >
            <InvoiceDraftDocument record={record} locale={props.locale} />
          </RecordSplit>
          {editing ? (
            <InvoiceDraftSession
              {...props}
              baseline={editing}
              onClose={() => setEditing(null)}
              onSaved={() => {
                setEditing(null);
                setRevision("");
              }}
            >
              {(session) => (
                <DraftEditor book={props.book} locale={props.locale} session={session} />
              )}
            </InvoiceDraftSession>
          ) : null}
        </>
      ) : null}
    </Box>
  );
}

function DraftReadiness({ record, locale }: { record: Draft; locale: CommerceProps["locale"] }) {
  const labels = locale === "sv" ? swedish : english;
  const setupCodes = new Set([
    "issuance_not_implemented",
    "legal_identity_not_verified",
    "tax_profile_not_activated",
  ]);
  const details = record.blockers.filter((item) => !setupCodes.has(item.code));
  const setup = record.blockers.filter((item) => setupCodes.has(item.code));
  const rows = (items: Draft["blockers"]) =>
    items.map((blocker, index) => (
      <Text key={`${blocker.code}:${blocker.lineId}:${index}`}>
        {invoiceDraftBlocker(blocker.code, locale)}
      </Text>
    ));
  return (
    <>
      {details.length ? (
        <RecordSection title={labels.needsAttention}>{rows(details)}</RecordSection>
      ) : null}
      {setup.length ? <Details title={labels.beforeLiveInvoicing}>{rows(setup)}</Details> : null}
    </>
  );
}

type DraftContent = typeof Drafts.DraftContent.Type;
function DraftDates({
  content,
  locale,
  session,
}: {
  content?: DraftContent;
  locale: CommerceProps["locale"];
  session: DraftSession;
}) {
  const labels = locale === "sv" ? swedish : english;
  return (
    <Box display="grid" gap="lg">
      <DocumentTitleField
        name="title"
        label={labels.invoiceDraft}
        required
        maxLength={200}
        defaultValue={restoredField(session, "title", content?.title ?? "")}
        placeholder={
          locale === "sv"
            ? "Till exempel designarbete, september"
            : "For example, September design work"
        }
      />
      <Box display="grid" columns={3} gap="lg">
        <InputField
          name="issueDate"
          label={labels.invoiceDate}
          type="date"
          defaultValue={restoredField(session, "issueDate", content?.plannedIssueDate ?? "")}
        />
        <InputField
          name="dueDate"
          label={labels.dueDate}
          type="date"
          defaultValue={restoredField(session, "dueDate", content?.dueDate ?? "")}
        />
        <InputField
          name="supplyDate"
          label={labels.supplyDate}
          type="date"
          defaultValue={restoredField(session, "supplyDate", content?.supplyDate ?? "")}
        />
      </Box>
    </Box>
  );
}

const english = {
  beforeLiveInvoicing: "Before live invoicing",
  countryCode: "Country code",
  unitPrice: "Unit price (optional)",
  allDrafts: "All drafts",
  invoiceDrafts: "Invoice drafts",
  prepareYourInvoiceAndReview: "Prepare your invoice and review the details before the next step.",
  newInvoice: "New invoice",
  searchInvoiceDrafts: "Search invoice drafts",
  searchCustomerOrDescription: "Search customer or description…",
  drafts: "Drafts",
  invoice: "Invoice",
  customer: "Customer",
  updated: "Updated",
  amount: "Amount",
  needsDetails: "Needs details",
  draft: "Draft",
  noMatchingInvoices: "No matching invoices",
  yourNextInvoiceStartsHere: "Your next invoice starts here",
  chooseACustomerAddYour: "Choose a customer, add your line items and save a draft.",
  draftsHaveNotBeenIssued:
    "Saving a draft does not send or post an invoice. Open the record to see its issue history.",
  close: "Close",
  saveDraft: "Save draft",
  invoiceDetails: "Invoice details",
  description: "Description",
  invoiceDate: "Invoice date",
  dueDate: "Due date",
  supplyDate: "Supply date",
  paymentTerms: "Payment terms",
  savedAsADraftNo: "Saved as a draft. No invoice is sent or posted.",
  chooseCustomer: "Choose customer",
  selectACustomer: "Select a customer…",
  loadMoreCustomers: "Load more customers",
  addACustomerFirst: "Add a customer first",
  billingName: "Billing name",
  billingAddress: "Billing address",
  from: "From",
  businessName: "Business name",
  registrationNumber: "Registration number",
  address: "Address",
  lineItems: "Line items",
  quantity: "Quantity",
  lineAmountBeforeTax: "Line amount before tax",
  taxAmount: "Tax amount",
  taxTreatment: "Tax treatment",
  asStatedInTheSource: "As stated in the source",
  remove: "Remove",
  retainedDiscountCharge: "Retained discount / charge:",
  addLine: "Add line",
  enterTheFullLineAmount:
    "Enter the full line amount and tax from the source. Leave tax blank if it has not been determined.",
  whatChanged: "What changed?",
  editDraft: "Edit draft",
  status: "Status",
  notIssuedSentOrPosted: "Not issued, sent or posted.",
  needsAttention: "Needs attention",
  sourceRecords: "Source records",
  revisionHistory: "Revision history",
  revision: "Revision",
  showLatest: "Show latest",
  technicalReferences: "Technical references",
  invoiceDraft: "Invoice · Draft",
  billTo: "Bill to",
  dates: "Dates",
  invoiceLines: "Invoice lines",
  qty: "Qty",
  net: "Net",
  tax: "Tax",
  subtotal: "Subtotal",
  total: "Total",
  editInvoice: "Edit invoice",
};
const swedish: typeof english = {
  beforeLiveInvoicing: "Inför riktig fakturering",
  countryCode: "Landskod",
  unitPrice: "Enhetspris (valfritt)",
  allDrafts: "Alla utkast",
  invoiceDrafts: "Fakturautkast",
  prepareYourInvoiceAndReview: "Förbered fakturan och granska beloppen innan nästa steg.",
  newInvoice: "Ny faktura",
  searchInvoiceDrafts: "Sök fakturautkast",
  searchCustomerOrDescription: "Sök kund eller beskrivning…",
  drafts: "Utkast",
  invoice: "Faktura",
  customer: "Kund",
  updated: "Uppdaterad",
  amount: "Belopp",
  needsDetails: "Behöver kompletteras",
  draft: "Utkast",
  noMatchingInvoices: "Inga matchande fakturor",
  yourNextInvoiceStartsHere: "Din nästa faktura börjar här",
  chooseACustomerAddYour: "Välj en kund, lägg till rader och spara ett utkast.",
  draftsHaveNotBeenIssued: "Utkast är inte utfärdade, skickade eller bokförda fakturor.",
  close: "Stäng",
  saveDraft: "Spara utkast",
  invoiceDetails: "Fakturadetaljer",
  description: "Beskrivning",
  invoiceDate: "Fakturadatum",
  dueDate: "Förfallodatum",
  supplyDate: "Leveransdatum",
  paymentTerms: "Betalningsvillkor",
  savedAsADraftNo: "Sparas som utkast. Ingen faktura skickas eller bokförs.",
  chooseCustomer: "Välj kund",
  selectACustomer: "Välj en kund…",
  loadMoreCustomers: "Läs in fler kunder",
  addACustomerFirst: "Lägg till en kund först",
  billingName: "Fakturanamn",
  billingAddress: "Fakturaadress",
  from: "Avsändare",
  businessName: "Företagsnamn",
  registrationNumber: "Organisationsnummer",
  address: "Adress",
  lineItems: "Fakturarader",
  quantity: "Antal",
  lineAmountBeforeTax: "Radbelopp exkl. moms",
  taxAmount: "Momsbelopp",
  taxTreatment: "Momsbehandling",
  asStatedInTheSource: "Enligt underlaget",
  remove: "Ta bort",
  retainedDiscountCharge: "Sparad rabatt / tillägg:",
  addLine: "Lägg till rad",
  enterTheFullLineAmount:
    "Ange hela radbeloppet och momsen från underlaget. Tom moms betyder att den inte är fastställd.",
  whatChanged: "Vad har ändrats?",
  editDraft: "Redigera utkast",
  status: "Status",
  notIssuedSentOrPosted: "Inte utfärdad, skickad eller bokförd.",
  needsAttention: "Behöver kompletteras",
  sourceRecords: "Underlag",
  revisionHistory: "Versionshistorik",
  revision: "Version",
  showLatest: "Visa senaste",
  technicalReferences: "Tekniska referenser",
  invoiceDraft: "Faktura · Utkast",
  billTo: "Faktureras till",
  dates: "Datum",
  invoiceLines: "Fakturarader",
  qty: "Antal",
  net: "Exkl. moms",
  tax: "Moms",
  subtotal: "Exkl. moms",
  total: "Totalt",
  editInvoice: "Redigera faktura",
};

function DraftCustomerPicker(
  props: CommerceProps & {
    content?: DraftContent;
    session: DraftSession;
    customer: typeof Commerce.CounterpartyRevision.Type | null;
    onChange: (customer: typeof Commerce.CounterpartyRevision.Type) => void;
  },
) {
  const sv = props.locale === "sv";
  const labels = sv ? swedish : english;
  const [adding, setAdding] = useState(false);
  const customers = useInfiniteQuery({
    queryKey: [...commerceKey(props.book), "contact-options"],
    initialPageParam: "",
    queryFn: async ({ pageParam, signal }) => {
      const page = await readAccounting(
        `${commercePath(props.book)}/counterparties${pageParam ? `?after=${encodeURIComponent(pageParam)}` : ""}`,
        Commerce.CounterpartyPage,
        { signal },
      );
      page.items.forEach((party) => checkScope(props.book, party.scope));
      return page;
    },
    getNextPageParam: (last) => last.next ?? undefined,
    retry: false,
  });
  const parties =
    customers.data?.pages
      .flatMap((page) => page.items)
      .filter((party) => party.role !== "supplier") ?? [];
  if (props.customer && !parties.some((party) => party.id === props.customer?.id))
    parties.unshift(props.customer);
  const picker = (
    <Box display="grid" gap="md">
      <SelectField
        label={labels.chooseCustomer}
        value={props.customer?.id ?? ""}
        onValueChange={(id) => {
          const party = parties.find((item) => item.id === id);
          if (party) props.onChange(party);
        }}
        options={[
          { value: "", label: labels.selectACustomer },
          ...parties.map((party) => ({ value: party.id, label: party.displayName })),
        ]}
      />
      <Box display="flex" gap="md">
        <Button type="button" variant="ghost" onClick={() => setAdding(true)}>
          <Plus size={14} strokeWidth={1.5} />
          {sv ? "Lägg till kund" : "Add customer"}
        </Button>
        {customers.hasNextPage ? (
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              void customers.fetchNextPage();
            }}
          >
            {labels.loadMoreCustomers}
          </Button>
        ) : null}
      </Box>
    </Box>
  );
  return (
    <Box display="grid" gap="sm">
      <AccountingStatus
        locale={props.locale}
        pending={customers.isPending}
        error={customers.error}
      />
      {props.customer ? (
        <InvoiceDraftParty
          key={props.customer.id}
          title={labels.billTo}
          prefix="customer"
          locale={props.locale}
          party={{
            legalName: restoredField(
              props.session,
              "customerName",
              props.customer.id === props.content?.counterpartyId
                ? props.content.customer.legalName
                : props.customer.displayName,
            ),
            registrationId: restoredField(
              props.session,
              "customerRegistration",
              props.customer.id === props.content?.counterpartyId
                ? (props.content.customer.registrationId ?? "")
                : "",
            ),
            address: restoredField(
              props.session,
              "customerAddress",
              props.customer.id === props.content?.counterpartyId
                ? (props.content.customer.address ?? "")
                : "",
            ),
            countryCode: restoredField(
              props.session,
              "customerCountry",
              props.customer.id === props.content?.counterpartyId
                ? (props.content.customer.countryCode ?? "")
                : "",
            ),
          }}
        >
          {picker}
        </InvoiceDraftParty>
      ) : (
        <RecordSection title={labels.billTo}>{picker}</RecordSection>
      )}
      {adding ? (
        <FormDialog
          size="compact"
          title={sv ? "Ny kund" : "New customer"}
          closeLabel={labels.close}
          onClose={() => setAdding(false)}
        >
          <ContactEditor
            book={props.book}
            locale={props.locale}
            customerOnly
            onSaved={(party) => {
              props.onChange(party);
              setAdding(false);
            }}
          />
        </FormDialog>
      ) : null}
    </Box>
  );
}
