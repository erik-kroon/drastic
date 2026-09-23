import { ArrowLeft, Plus } from "lucide-react";
import { Badge } from "@open-erp/ui/components/badge";
import { FormDialog } from "@open-erp/ui/components/form-dialog";
import {
  PageEmpty,
  RegisterFilters,
  RegisterSearch,
  RecordToggle,
} from "@open-erp/ui/components/accounting-page";
import { RecordHeading, RecordSummary, RecordFact } from "@open-erp/ui/components/record-layout";
import { formatMinorAmount } from "@/lib/workspace-api";
import { IssuedInvoiceDocument } from "./issued-invoice-document";
import { InvoicePaymentsWorkspace, type InvoicePaymentNavigation } from "./invoice-payments";
import { invoicePaymentCopy } from "./invoice-payment-copy";
import { InvoiceRegistration } from "./invoice-registration";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import * as Commerce from "@open-erp/contracts/commerce";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { SelectField } from "@open-erp/ui/components/field";
import { DataTable } from "@open-erp/ui/components/data-table";
import { Text } from "@open-erp/ui/components/typography";
import { AccountingStatus } from "@/components/accounting-status";
import { readAccounting } from "@/lib/accounting-api";
import { commerceCopy } from "./copy";
import {
  CommandForm,
  Details,
  Evidence,
  Facts,
  Field,
  Pager,
  checkScope,
  commerceKey,
  commercePath,
  type CommerceProps,
} from "./shared";

export function Invoices(
  props: CommerceProps & {
    direction?: "customer" | "supplier";
    recordId?: string;
    onOpen?: (id: string) => void;
    contextual?: boolean;
    onPayments?: () => void;
    paymentView?: InvoicePaymentNavigation;
  },
) {
  const { book, locale } = props;
  const sv = locale === "sv";
  const labels = sv ? swedish : english;
  const copy = commerceCopy(locale);
  const [after, setAfter] = useState("");
  const [local, setLocal] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const selected = props.recordId ?? local;
  const select = props.onOpen ?? setLocal;
  const page = useQuery({
    queryKey: [...commerceKey(book), "invoices", after],
    queryFn: async ({ signal }) => {
      const result = await readAccounting(
        `${commercePath(book)}/invoices${after ? `?after=${encodeURIComponent(after)}` : ""}`,
        Commerce.InvoicePage,
        { signal },
      );
      result.items.forEach((invoice) => checkScope(book, invoice.scope));
      return result;
    },
    retry: false,
  });
  const statuses = {
    open: labels.open,
    partially_allocated: labels.partlyAllocated,
    allocated: labels.allocated,
    blocked: labels.needsReview,
    cancelled: labels.cancelled,
  };
  const invoices =
    page.data?.items.filter(
      (item) =>
        (!props.direction || item.direction === props.direction) &&
        (!status || item.status === status) &&
        `${item.documentNumber} ${item.counterpartyName}`
          .toLocaleLowerCase(locale)
          .includes(search.toLocaleLowerCase(locale)),
    ) ?? [];
  if (selected && selected !== "new")
    return (
      <Box display="grid" gap="xl">
        {!props.contextual ? (
          <Box>
            <Button variant="ghost" onClick={() => select("")}>
              <ArrowLeft size={14} />
              {labels.allInvoices}
            </Button>
          </Box>
        ) : null}
        <InvoiceDetail {...props} id={selected} />
      </Box>
    );
  return (
    <Box display="grid" gap="xl">
      <RecordHeading
        title={props.direction === "supplier" ? labels.supplierInvoices : labels.registeredInvoices}
        subtitle={labels.invoicesLinkedToYourBooks}
        action={
          <Button variant="outline" onClick={() => select("new")}>
            <Plus size={14} />
            {labels.registerInvoice}
          </Button>
        }
      />
      <RegisterFilters>
        <RegisterSearch
          aria-label={labels.searchInvoices}
          placeholder={labels.searchNumberOrName}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <SelectField
          label="Status"
          value={status}
          onValueChange={(value) => setStatus(value ?? "")}
          options={[
            { value: "", label: labels.allStatuses },
            ...Object.entries(statuses).map(([value, label]) => ({ value, label })),
          ]}
        />
      </RegisterFilters>
      <AccountingStatus locale={locale} pending={page.isPending} error={page.error} />
      {page.isSuccess ? (
        <>
          {invoices.length ? (
            <DataTable
              title={copy.invoices}
              narrow="stack"
              columns={[
                { id: "document", label: labels.invoice },
                { id: "party", label: labels.contact },
                { id: "due", label: labels.dueDate },
                { id: "status", label: "Status" },
                { id: "amount", label: labels.outstanding, numeric: true },
              ]}
              rows={invoices.map((invoice) => ({
                id: invoice.id,
                cells: [
                  <RecordToggle key="open" expanded={false} onClick={() => select(invoice.id)}>
                    {invoice.documentNumber}
                  </RecordToggle>,
                  invoice.counterpartyName,
                  invoice.currentRevision.dueOn,
                  <Badge
                    key="status"
                    variant={
                      invoice.status === "blocked"
                        ? "warning"
                        : invoice.status === "allocated"
                          ? "success"
                          : "secondary"
                    }
                  >
                    {statuses[invoice.status]}
                  </Badge>,
                  invoice.outstandingMinor === null
                    ? "—"
                    : `${formatMinorAmount(invoice.outstandingMinor, invoice.currencyScale, locale)} ${invoice.currency}`,
                ],
              }))}
            />
          ) : (
            <PageEmpty
              title={search || status ? labels.noMatchingInvoices : labels.noRegisteredInvoicesYet}
              detail={labels.registerAnInvoiceOnceIts}
            />
          )}
          <Pager locale={locale} first={!after} next={page.data.next} onPage={setAfter} />
        </>
      ) : null}
      {selected === "new" ? (
        <FormDialog
          title={labels.registerInvoice}
          closeLabel={labels.close}
          onClose={() => select("")}
        >
          <InvoiceRegistration
            {...props}
            direction={props.direction ?? "customer"}
            onSaved={(invoice) => select(invoice.id)}
          />
        </FormDialog>
      ) : null}
    </Box>
  );
}
export function InvoiceDetail(
  props: CommerceProps & {
    id: string;
    onPayments?: () => void;
    paymentView?: InvoicePaymentNavigation;
  },
) {
  const { book, locale, id } = props;
  const copy = commerceCopy(locale);
  const invoice = useQuery({
    queryKey: [...commerceKey(book), "invoice", id],
    queryFn: async ({ signal }) => {
      const result = await readAccounting(
        `${commercePath(book)}/invoices/${encodeURIComponent(id)}`,
        Commerce.Invoice,
        { signal },
      );
      checkScope(book, result.scope);
      if (result.id !== id) throw new Error("Invoice identity mismatch");
      return result;
    },
    retry: false,
  });
  const ready = invoice.isSuccess && !invoice.isFetching;
  if (props.paymentView && invoice.data && !invoice.isError)
    return (
      <InvoicePaymentsWorkspace {...props} invoice={invoice.data} navigation={props.paymentView} />
    );
  return (
    <Box display="grid" gap="lg" minWidth="zero">
      <AccountingStatus locale={locale} pending={invoice.isPending} error={invoice.error} />
      {!ready ? <Text>{copy.waiting}</Text> : null}
      {invoice.data ? (
        <>
          <RecordHeading
            title={invoice.data.documentNumber}
            subtitle={invoice.data.counterpartyName}
            action={
              <Box display="flex" gap="sm">
                {props.onPayments ? (
                  <Button variant="outline" onClick={props.onPayments}>
                    {invoicePaymentCopy(locale).title}
                  </Button>
                ) : null}
                <Button
                  variant="ghost"
                  disabled={invoice.isFetching}
                  onClick={() => {
                    void invoice.refetch();
                  }}
                >
                  {copy.refresh}
                </Button>
              </Box>
            }
          />
          <Box>
            <Badge
              variant={
                invoice.data.status === "cancelled"
                  ? "secondary"
                  : invoice.data.status === "allocated"
                    ? "success"
                    : "warning"
              }
            >
              {
                (locale === "sv" ? swedish : english)[
                  invoice.data.status === "partially_allocated"
                    ? "partlyAllocated"
                    : invoice.data.status === "blocked"
                      ? "needsReview"
                      : invoice.data.status
                ]
              }
            </Badge>
          </Box>
          <RecordSummary>
            <RecordFact label={locale === "sv" ? "Belopp" : "Amount"}>
              {formatMinorAmount(invoice.data.amountMinor, invoice.data.currencyScale, locale)}{" "}
              {invoice.data.currency}
            </RecordFact>
            <RecordFact label={locale === "sv" ? "Avstämt" : "Allocated"}>
              {formatMinorAmount(
                invoice.data.recordedAllocatedMinor,
                invoice.data.currencyScale,
                locale,
              )}{" "}
              {invoice.data.currency}
            </RecordFact>
            <RecordFact label={locale === "sv" ? "Kvarstående" : "Outstanding"}>
              {invoice.data.outstandingMinor === null
                ? "—"
                : formatMinorAmount(
                    invoice.data.outstandingMinor,
                    invoice.data.currencyScale,
                    locale,
                  )}{" "}
              {invoice.data.currency}
            </RecordFact>
            <RecordFact label={copy.due}>{invoice.data.currentRevision.dueOn}</RecordFact>
          </RecordSummary>
          {invoice.data.cancellation ? (
            <Box display="grid" gap="sm">
              <Text role="status">
                {locale === "sv"
                  ? "Den syntetiska fakturan har makulerats. Originalbeloppet och historiken bevaras. Detta är inte en juridisk kreditfaktura."
                  : "This synthetic invoice was cancelled. Its original amount and history are retained. This is not a legal credit note."}
              </Text>
              <Text tone="muted">
                {locale === "sv" ? "Makuleringen bokfördes" : "Cancellation posted"}{" "}
                {invoice.data.cancellation.postingDate}
              </Text>
            </Box>
          ) : null}
          <Text>{invoice.data.currentRevision.description}</Text>
          {invoice.data.blockers.map((blocker) => (
            <Text key={blocker} role="alert">
              {blocker}
            </Text>
          ))}
          {invoice.data.issueOrigin ? (
            <IssuedInvoiceDocument
              book={book}
              locale={locale}
              invoice={invoice.data}
              reviewId={invoice.data.issueOrigin.reviewId}
            />
          ) : null}
          <Facts title={copy.facts} value={invoice.data} />
          <Evidence {...props} reference={invoice.data.evidence} />
          <Details title={copy.reviseInvoice}>
            <InvoiceRevisionForm
              {...props}
              invoice={invoice.data}
              allowed={ready && invoice.data.status !== "cancelled"}
            />
          </Details>
        </>
      ) : null}
      <Details title={copy.history}>
        <InvoiceHistory {...props} />
      </Details>
    </Box>
  );
}
function InvoiceRevisionForm(
  props: CommerceProps & { id: string; invoice: typeof Commerce.Invoice.Type; allowed: boolean },
) {
  const { invoice, allowed } = props;
  const [baseline, setBaseline] = useState(invoice);
  const copy = commerceCopy(props.locale);
  return (
    <CommandForm
      {...props}
      path={`${commercePath(props.book)}/invoices/${encodeURIComponent(invoice.id)}/revisions`}
      schema={Commerce.ReviseInvoice}
      output={Commerce.Invoice}
      label={copy.reviseInvoice}
      allowed={allowed}
      onNewCommand={() => setBaseline(invoice)}
      input={(fields) => ({
        expectedRevision: fields.get("expectedRevision"),
        dueOn: fields.get("dueOn"),
        description: fields.get("description"),
        evidenceId: fields.get("evidenceId"),
        reason: fields.get("reason"),
      })}
    >
      <Text>{copy.recognitionHelp}</Text>
      <Text>
        {copy.revision}: {baseline.currentRevision.revision}
      </Text>
      <Field
        name="expectedRevision"
        label={copy.revision}
        value={baseline.currentRevision.revision}
        maxLength={18}
      />
      <Field name="dueOn" label={copy.due} type="date" value={baseline.currentRevision.dueOn} />
      <Field
        name="description"
        label={copy.description}
        value={baseline.currentRevision.description}
      />
      <Field name="evidenceId" label={copy.evidenceId} maxLength={128} />
      <Field name="reason" label={copy.reason} />
    </CommandForm>
  );
}
function InvoiceHistory(props: CommerceProps & { id: string }) {
  const { book, locale, id } = props;
  const copy = commerceCopy(locale);
  const [after, setAfter] = useState("");
  const history = useQuery({
    queryKey: [...commerceKey(book), "invoice-history", id, after],
    queryFn: async ({ signal }) => {
      const result = await readAccounting(
        `${commercePath(book)}/invoices/${encodeURIComponent(id)}/revisions${after ? `?after=${encodeURIComponent(after)}` : ""}`,
        Commerce.InvoiceHistory,
        { signal },
      );
      result.items.forEach((revision) => {
        checkScope(book, revision.scope);
        if (revision.id !== id) throw new Error("Invoice history mismatch");
      });
      return result;
    },
    retry: false,
  });
  return (
    <Box display="grid" gap="lg">
      <AccountingStatus locale={locale} pending={history.isPending} error={history.error} />
      <Box>
        <Button
          size="xl"
          variant="outline"
          disabled={history.isFetching}
          onClick={() => {
            void history.refetch();
          }}
        >
          {copy.refresh}
        </Button>
      </Box>
      {history.data ? (
        <>
          {history.data.items.map((revision) => (
            <Details
              key={revision.revision}
              title={`${copy.revision} ${revision.revision} · ${revision.dueOn}`}
            >
              <Text>{revision.description}</Text>
              <Text>
                {copy.reason}: {revision.reason}
              </Text>
              <Facts title={copy.facts} value={revision} />
              <Evidence {...props} reference={revision.evidence} />
            </Details>
          ))}
          <Pager
            locale={locale}
            first={!after}
            next={history.isSuccess && !history.isFetching ? history.data.next : null}
            onPage={setAfter}
          />
        </>
      ) : null}
    </Box>
  );
}

const english = {
  open: "Open",
  partlyAllocated: "Partly allocated",
  allocated: "Allocated",
  needsReview: "Needs review",
  cancelled: "Cancelled (synthetic)",
  allInvoices: "All invoices",
  supplierInvoices: "Supplier invoices",
  registeredInvoices: "Registered invoices",
  invoicesLinkedToYourBooks: "Invoices linked to your books, with their outstanding balances.",
  registerInvoice: "Register invoice",
  searchInvoices: "Search invoices",
  searchNumberOrName: "Search number or name…",
  allStatuses: "All statuses",
  invoice: "Invoice",
  contact: "Contact",
  dueDate: "Due date",
  outstanding: "Outstanding",
  noMatchingInvoices: "No matching invoices",
  noRegisteredInvoicesYet: "No registered invoices yet",
  registerAnInvoiceOnceIts: "Register an invoice once its amount is recorded in the books.",
  close: "Close",
};
const swedish: typeof english = {
  open: "Utestående",
  partlyAllocated: "Delvis avstämd",
  allocated: "Avstämd",
  needsReview: "Behöver granskas",
  cancelled: "Makulerad (syntetisk)",
  allInvoices: "Alla fakturor",
  supplierInvoices: "Leverantörsfakturor",
  registeredInvoices: "Bokförda fakturor",
  invoicesLinkedToYourBooks: "Fakturor kopplade till bokföringen och deras kvarvarande belopp.",
  registerInvoice: "Registrera faktura",
  searchInvoices: "Sök fakturor",
  searchNumberOrName: "Sök nummer eller namn…",
  allStatuses: "Alla",
  invoice: "Faktura",
  contact: "Kontakt",
  dueDate: "Förfallodatum",
  outstanding: "Kvar att stämma av",
  noMatchingInvoices: "Inga matchande fakturor",
  noRegisteredInvoicesYet: "Inga registrerade fakturor än",
  registerAnInvoiceOnceIts: "Registrera en faktura när dess belopp finns i bokföringen.",
  close: "Stäng",
};
