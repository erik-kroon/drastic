import { useState, type ReactNode } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import * as Drafts from "@open-erp/contracts/invoice-drafts";
import * as Commerce from "@open-erp/contracts/commerce";
import { Plus, ArrowLeft, Trash2 } from "lucide-react";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { InputField, SelectField } from "@open-erp/ui/components/field";
import { DataTable } from "@open-erp/ui/components/data-table";
import { Text } from "@open-erp/ui/components/typography";
import { Badge } from "@open-erp/ui/components/badge";
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
  RecordHeading,
  RecordSection,
  RecordSummary,
  RecordFact,
  RecordSplit,
} from "@open-erp/ui/components/record-layout";
import { AccountingStatus } from "@/components/accounting-status";
import { EvidenceCommandForm } from "@/components/evidence-command-form";
import { readAccounting } from "@/lib/accounting-api";
import { decimalToMinor, formatMinorAmount, workQueryOptions } from "@/lib/workspace-api";
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
type DraftActions = { issueAction?: ReactNode; issueStatus?: ReactNode };
type EditableLine = { id: string; defaults?: typeof Drafts.DraftLine.Type };
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
        <Box>
          <Button variant="ghost" onClick={() => select("")}>
            <ArrowLeft size={14} />
            {labels.allDrafts}
          </Button>
        </Box>
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
        <FormDialog title={labels.newInvoice} closeLabel={labels.close} onClose={() => select("")}>
          <DraftEditor {...props} onSaved={(record) => select(record.id)} />
        </FormDialog>
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
function DraftEditor(
  props: CommerceProps & { baseline?: Draft; onSaved: (record: Draft) => void },
) {
  const sv = props.locale === "sv";
  const labels = sv ? swedish : english;
  const baseline = props.baseline;
  const content = baseline?.content;
  const [addingCustomer, setAddingCustomer] = useState(false);
  const [addedCustomer, setAddedCustomer] = useState<
    typeof Commerce.CounterpartyRevision.Type | null
  >(null);
  const [customerId, setCustomerId] = useState(content?.counterpartyId ?? "");
  const [draftKey] = useState(() => `draft_${crypto.randomUUID().replaceAll("-", "")}`);
  const [lines, setLines] = useState<EditableLine[]>(() =>
    content ? content.lines.map((line) => ({ id: line.id, defaults: line })) : [{ id: "line_1" }],
  );
  const metadata = useQuery(workQueryOptions(props.book, {}));
  const scale = content?.currencyScale ?? metadata.data?.currencyScale;
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
  const customer = selectedCustomer(addedCustomer, parties, baseline, customerId);
  if (scale === undefined)
    return (
      <AccountingStatus locale={props.locale} pending={metadata.isPending} error={metadata.error} />
    );
  return (
    <EvidenceCommandForm
      {...props}
      path={`${commercePath(props.book)}/invoice-drafts${baseline ? `/${encodeURIComponent(baseline.id)}/revisions` : ""}`}
      schema={baseline ? Drafts.ReviseInvoiceDraft : Drafts.CreateInvoiceDraft}
      output={Drafts.InvoiceDraftRevision}
      label={labels.saveDraft}
      canSubmit={!!customer}
      onSuccess={props.onSaved}
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
            quantity: inputText(fields, `${line.id}_quantity`),
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
              expectedRevision: baseline.revision,
              expectedDigest: baseline.digest,
              reason: inputText(fields, "reason"),
              content: next,
            }
          : { draftKey, content: next };
      }}
    >
      <RecordSplit
        aside={
          <>
            <DraftDates content={content} locale={props.locale} />
            <InputField
              name="sourceTotal"
              label={sv ? "Avtalat totalbelopp (valfritt)" : "Agreed total (optional)"}
              inputMode="decimal"
              defaultValue={editAmount(content?.sourceTotalMinor, scale)}
            />
            <PageCaption>
              {sv
                ? "Ange totalsumman från avtalet eller beställningen, om den finns."
                : "Enter the total stated in the agreement or order, if available."}
            </PageCaption>
            <PageCaption>{labels.savedAsADraftNo}</PageCaption>
          </>
        }
      >
        <RecordSection title={labels.customer}>
          <SelectField
            label={labels.chooseCustomer}
            value={customerId}
            onValueChange={(value) => setCustomerId(value ?? "")}
            options={[
              { value: "", label: labels.selectACustomer },
              ...(addedCustomer && !parties.some((party) => party.id === addedCustomer.id)
                ? [{ value: addedCustomer.id, label: addedCustomer.displayName }]
                : []),
              ...parties.map((party) => ({ value: party.id, label: party.displayName })),
            ]}
          />
          <AccountingStatus
            locale={props.locale}
            pending={customers.isPending}
            error={customers.error}
          />
          {customers.hasNextPage ? (
            <Box>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  void customers.fetchNextPage();
                }}
              >
                {labels.loadMoreCustomers}
              </Button>
            </Box>
          ) : null}
          <Box>
            <Button type="button" variant="ghost" onClick={() => setAddingCustomer(true)}>
              <Plus size={14} strokeWidth={1.5} />
              {sv ? "Lägg till kund" : "Add customer"}
            </Button>
          </Box>
          {addingCustomer ? (
            <FormDialog
              size="compact"
              title={sv ? "Ny kund" : "New customer"}
              closeLabel={labels.close}
              onClose={() => setAddingCustomer(false)}
            >
              <ContactEditor
                book={props.book}
                locale={props.locale}
                customerOnly
                onSaved={(party) => {
                  setAddedCustomer(party);
                  setCustomerId(party.id);
                  setAddingCustomer(false);
                }}
              />
            </FormDialog>
          ) : null}
          {customer ? (
            <CustomerFields
              key={customer.id}
              customer={customer}
              content={content}
              locale={props.locale}
            />
          ) : null}
        </RecordSection>
        <SellerFields content={content} bookName={props.book.name} locale={props.locale} />
        <RecordSection title={`${labels.lineItems} · ${content?.currency ?? props.book.currency}`}>
          {lines.map((line, index) => (
            <Box key={line.id} display="grid" gap="md" paddingBlock="md">
              <InputField
                name={`${line.id}_description`}
                label={`${labels.description} ${index + 1}`}
                required
                maxLength={200}
                defaultValue={line.defaults?.description}
              />
              <Box display="grid" columns={4} gap="md">
                <InputField
                  name={`${line.id}_quantity`}
                  label={labels.quantity}
                  required
                  defaultValue={line.defaults?.quantity ?? "1"}
                  inputMode="decimal"
                />
                <InputField
                  name={`${line.id}_unitPrice`}
                  label={labels.unitPrice}
                  inputMode="decimal"
                  defaultValue={editAmount(line.defaults?.unitPriceMinor, scale)}
                />
                <InputField
                  name={`${line.id}_amount`}
                  label={labels.lineAmountBeforeTax}
                  required
                  inputMode="decimal"
                  defaultValue={editAmount(line.defaults?.baseMinor, scale)}
                />
                <InputField
                  name={`${line.id}_tax`}
                  label={labels.taxAmount}
                  inputMode="decimal"
                  defaultValue={editAmount(line.defaults?.taxMinor, scale)}
                />
              </Box>
              <Box display="flex" gap="md" alignItems="end">
                <InputField
                  name={`${line.id}_taxDescription`}
                  label={labels.taxTreatment}
                  placeholder={labels.asStatedInTheSource}
                  maxLength={200}
                  defaultValue={line.defaults?.taxDescription ?? ""}
                />
                <Button
                  type="button"
                  variant="ghost"
                  disabled={lines.length === 1}
                  onClick={() =>
                    setLines((current) => current.filter((item) => item.id !== line.id))
                  }
                >
                  <Trash2 size={14} />
                  {labels.remove}
                </Button>
              </Box>
              <InputField
                name={`${line.id}_sourceGross`}
                label={
                  sv
                    ? "Avtalat radbelopp inkl. moms (valfritt)"
                    : "Agreed line total including tax (optional)"
                }
                inputMode="decimal"
                defaultValue={editAmount(line.defaults?.sourceGrossMinor, scale)}
              />
              {line.defaults &&
              (line.defaults.discountMinor !== "0" || line.defaults.chargeMinor !== "0") ? (
                <PageCaption>
                  {labels.retainedDiscountCharge} {editAmount(line.defaults.discountMinor, scale)} /{" "}
                  {editAmount(line.defaults.chargeMinor, scale)}
                </PageCaption>
              ) : null}
            </Box>
          ))}
          <Box>
            <Button
              type="button"
              variant="outline"
              disabled={lines.length >= 50}
              onClick={() =>
                setLines((current) => [
                  ...current,
                  { id: `line_${crypto.randomUUID().replaceAll("-", "")}` },
                ])
              }
            >
              <Plus size={14} />
              {labels.addLine}
            </Button>
          </Box>
          <PageCaption>{labels.enterTheFullLineAmount}</PageCaption>
        </RecordSection>
        {baseline ? <InputField name="reason" label={labels.whatChanged} required /> : null}
      </RecordSplit>
    </EvidenceCommandForm>
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
  const amount = (value: string | null) =>
    value === null || !record
      ? "—"
      : `${formatMinorAmount(value, record.content.currencyScale, props.locale)} ${record.content.currency}`;
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
            <DocumentPaper>
              <RecordHeading
                title={labels.invoiceDraft}
                subtitle={record.content.seller.legalName}
              />
              <Box display="grid" columns={2} gap="xl">
                <RecordSection title={labels.billTo}>
                  <Text>{record.content.customer.legalName}</Text>
                  <Text tone="muted">{record.content.customer.address ?? "—"}</Text>
                </RecordSection>
                <RecordSection title={labels.dates}>
                  <Text>
                    {labels.invoiceDate}: {record.content.plannedIssueDate ?? "—"}
                  </Text>
                  <Text>
                    {labels.dueDate}: {record.content.dueDate ?? "—"}
                  </Text>
                </RecordSection>
              </Box>
              <DataTable
                title={labels.invoiceLines}
                narrow="stack"
                columns={[
                  { id: "description", label: labels.description },
                  { id: "quantity", label: labels.qty, numeric: true },
                  { id: "net", label: labels.net, numeric: true },
                  { id: "tax", label: labels.tax, numeric: true },
                ]}
                rows={record.content.lines.map((line) => ({
                  id: line.id,
                  cells: [
                    line.description,
                    line.quantity,
                    amount(
                      record.calculatedLines.find((item) => item.id === line.id)?.netMinor ?? null,
                    ),
                    amount(line.taxMinor),
                  ],
                }))}
              />
              <RecordSummary>
                <RecordFact label={labels.subtotal}>{amount(record.totals.netMinor)}</RecordFact>
                <RecordFact label={labels.tax}>{amount(record.totals.taxMinor)}</RecordFact>
                <RecordFact label={labels.total}>{amount(record.totals.grossMinor)}</RecordFact>
              </RecordSummary>
              {record.content.paymentTerms ? (
                <Text tone="muted">{record.content.paymentTerms}</Text>
              ) : null}
            </DocumentPaper>
          </RecordSplit>
          {editing ? (
            <FormDialog
              title={labels.editInvoice}
              closeLabel={labels.close}
              onClose={() => setEditing(null)}
            >
              <DraftEditor
                {...props}
                baseline={editing}
                onSaved={() => {
                  setEditing(null);
                  setRevision("");
                }}
              />
            </FormDialog>
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
}: {
  content?: DraftContent;
  locale: CommerceProps["locale"];
}) {
  const labels = locale === "sv" ? swedish : english;
  return (
    <RecordSection title={labels.invoiceDetails}>
      <InputField
        name="title"
        label={labels.description}
        required
        maxLength={200}
        defaultValue={content?.title}
      />
      <InputField
        name="issueDate"
        label={labels.invoiceDate}
        type="date"
        defaultValue={content?.plannedIssueDate ?? ""}
      />
      <InputField
        name="dueDate"
        label={labels.dueDate}
        type="date"
        defaultValue={content?.dueDate ?? ""}
      />
      <InputField
        name="supplyDate"
        label={labels.supplyDate}
        type="date"
        defaultValue={content?.supplyDate ?? ""}
      />
      <InputField
        name="terms"
        label={labels.paymentTerms}
        maxLength={1000}
        defaultValue={content?.paymentTerms ?? ""}
      />
    </RecordSection>
  );
}
function SellerFields({
  content,
  bookName,
  locale,
}: {
  content?: DraftContent;
  bookName: string;
  locale: CommerceProps["locale"];
}) {
  const labels = locale === "sv" ? swedish : english;
  return (
    <RecordSection title={labels.from}>
      <Box display="grid" columns={2} gap="lg">
        <InputField
          name="seller"
          label={labels.businessName}
          required
          maxLength={200}
          defaultValue={content?.seller.legalName ?? bookName}
        />
        <InputField
          name="registration"
          label={labels.registrationNumber}
          maxLength={200}
          defaultValue={content?.seller.registrationId ?? ""}
        />
      </Box>
      <InputField
        name="sellerCountry"
        label={labels.countryCode}
        pattern="[A-Z]{2}"
        maxLength={2}
        placeholder="SE"
        defaultValue={content?.seller.countryCode ?? ""}
      />
      <InputField
        name="sellerAddress"
        label={labels.address}
        maxLength={1000}
        defaultValue={content?.seller.address ?? ""}
      />
    </RecordSection>
  );
}
function CustomerFields({
  customer,
  content,
  locale,
}: {
  customer: typeof Commerce.CounterpartyRevision.Type;
  content?: DraftContent;
  locale: CommerceProps["locale"];
}) {
  const labels = locale === "sv" ? swedish : english;
  return (
    <Box key={customer.id} display="grid" columns={2} gap="lg">
      <InputField
        name="customerName"
        label={labels.billingName}
        required
        maxLength={200}
        defaultValue={
          customer.id === content?.counterpartyId
            ? content.customer.legalName
            : customer.displayName
        }
      />
      <InputField
        name="customerRegistration"
        label={labels.registrationNumber}
        maxLength={200}
        defaultValue={
          customer.id === content?.counterpartyId ? (content.customer.registrationId ?? "") : ""
        }
      />
      <InputField
        name="customerCountry"
        label={labels.countryCode}
        pattern="[A-Z]{2}"
        maxLength={2}
        placeholder="SE"
        defaultValue={
          customer.id === content?.counterpartyId ? (content.customer.countryCode ?? "") : ""
        }
      />
      <InputField
        name="customerAddress"
        label={labels.billingAddress}
        maxLength={1000}
        defaultValue={
          customer.id === content?.counterpartyId ? (content.customer.address ?? "") : ""
        }
      />
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

function selectedCustomer(
  added: typeof Commerce.CounterpartyRevision.Type | null,
  parties: ReadonlyArray<typeof Commerce.CounterpartyRevision.Type>,
  baseline: Draft | undefined,
  id: string,
) {
  if (added?.id === id) return added;
  return (
    parties.find((party) => party.id === id) ??
    (baseline?.counterparty.id === id ? baseline.counterparty : undefined)
  );
}
