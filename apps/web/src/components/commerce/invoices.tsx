import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import * as Commerce from "@open-erp/contracts/commerce";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { SelectField } from "@open-erp/ui/components/field";
import { DataTable } from "@open-erp/ui/components/data-table";
import { Heading, Text } from "@open-erp/ui/components/typography";
import { AccountingStatus } from "@/components/accounting-status";
import { readAccounting } from "@/lib/accounting-api";
import { commerceCopy } from "./copy";
import {
  CommandForm,
  Details,
  Evidence,
  Facts,
  Field,
  Lookup,
  Pager,
  checkScope,
  commerceKey,
  commercePath,
  type CommerceProps,
} from "./shared";

export function Invoices(props: CommerceProps) {
  const { book, locale } = props;
  const copy = commerceCopy(locale);
  const [after, setAfter] = useState("");
  const [selected, setSelected] = useState("");
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
    open: copy.openStatus,
    partially_allocated: copy.partialStatus,
    allocated: copy.allocatedStatus,
    blocked: copy.blockedStatus,
  };
  return (
    <Box as="section" display="grid" gap="lg" minWidth="zero">
      <Heading>{copy.invoices}</Heading>
      <Text tone="muted">{copy.recognitionHelp}</Text>
      <Text>
        {copy.units} {book.currency}
      </Text>
      <Details title={copy.registerInvoice}>
        <CommandForm
          {...props}
          path={`${commercePath(book)}/invoices`}
          schema={Commerce.CreateInvoice}
          output={Commerce.Invoice}
          label={copy.registerInvoice}
          input={(fields) => ({
            kind: "synthetic_invoice_v1",
            direction: fields.get("direction"),
            counterpartyId: fields.get("counterpartyId"),
            counterpartyRevision: fields.get("counterpartyRevision"),
            documentNumber: fields.get("documentNumber"),
            issuedOn: fields.get("issuedOn"),
            dueOn: fields.get("dueOn"),
            currency: book.currency,
            amountMinor: fields.get("amountMinor"),
            controlAccountId: fields.get("controlAccountId"),
            recognitionVoucherId: fields.get("recognitionVoucherId"),
            recognitionLineId: fields.get("recognitionLineId"),
            evidenceId: fields.get("evidenceId"),
            description: fields.get("description"),
          })}
          onSuccess={(invoice) => setSelected(invoice.id)}
        >
          <Box display="grid" columns={1} columnsAtSm={2} gap="lg">
            <SelectField
              name="direction"
              label={copy.role}
              required
              defaultValue="customer"
              options={[
                { value: "customer", label: copy.customer },
                { value: "supplier", label: copy.supplier },
              ]}
            />
            <Field name="counterpartyId" label={copy.partyId} maxLength={128} />
            <Field name="counterpartyRevision" label={copy.partyRevision} maxLength={18} />
            <Field name="documentNumber" label={copy.document} maxLength={200} />
            <Field name="issuedOn" label={copy.issued} type="date" />
            <Field name="dueOn" label={copy.due} type="date" />
            <Field name="amountMinor" label={copy.amount} maxLength={38} />
            <Field name="controlAccountId" label={copy.account} maxLength={128} />
            <Field name="recognitionVoucherId" label={copy.voucher} maxLength={128} />
            <Field name="recognitionLineId" label={copy.line} maxLength={128} />
            <Field name="evidenceId" label={copy.evidenceId} maxLength={128} />
          </Box>
          <Field name="description" label={copy.description} />
        </CommandForm>
      </Details>
      <Lookup label={copy.open} onOpen={setSelected} />
      <Box>
        <Button
          size="xl"
          variant="outline"
          disabled={page.isFetching}
          onClick={() => {
            void page.refetch();
          }}
        >
          {copy.refresh}
        </Button>
      </Box>
      <AccountingStatus locale={locale} pending={page.isPending} error={page.error} />
      {page.data ? (
        <>
          <DataTable
            title={copy.invoices}
            narrow="stack"
            columns={[
              { id: "document", label: copy.document },
              { id: "party", label: copy.name },
              { id: "due", label: copy.due },
              { id: "amount", label: copy.outstanding, numeric: true },
              { id: "status", label: copy.status },
              { id: "open", label: copy.id },
            ]}
            rows={page.data.items.map((invoice) => ({
              id: invoice.id,
              cells: [
                invoice.documentNumber,
                invoice.counterpartyName,
                invoice.currentRevision.dueOn,
                invoice.outstandingMinor ?? copy.blockedAmount,
                statuses[invoice.status],
                <Box key="open" display="grid" gap="sm">
                  <Text>{invoice.id}</Text>
                  <Button size="xl" variant="outline" onClick={() => setSelected(invoice.id)}>
                    {copy.open}
                  </Button>
                </Box>,
              ],
            }))}
          />
          {page.data.items.length === 0 ? <Text>{copy.empty}</Text> : null}
          <Pager
            locale={locale}
            first={!after}
            next={page.isSuccess && !page.isFetching ? page.data.next : null}
            onPage={setAfter}
          />
        </>
      ) : null}
      {selected ? <InvoiceDetail {...props} key={selected} id={selected} /> : null}
    </Box>
  );
}
export function InvoiceDetail(props: CommerceProps & { id: string }) {
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
  return (
    <Box display="grid" gap="lg" minWidth="zero">
      <Heading>{copy.invoices}</Heading>
      <Text>
        {copy.id}: {id}
      </Text>
      <Box>
        <Button
          size="xl"
          variant="outline"
          disabled={invoice.isFetching}
          onClick={() => {
            void invoice.refetch();
          }}
        >
          {copy.refresh}
        </Button>
      </Box>
      <AccountingStatus locale={locale} pending={invoice.isPending} error={invoice.error} />
      {!ready ? <Text>{copy.waiting}</Text> : null}
      {invoice.data ? (
        <>
          <Text>
            {invoice.data.documentNumber} · {invoice.data.counterpartyName}
          </Text>
          <Text>
            {copy.units} {invoice.data.currency} · {copy.scale}: {invoice.data.currencyScale}
          </Text>
          <Text>
            {copy.amount}: {invoice.data.amountMinor} · {copy.recordedAllocated}:{" "}
            {invoice.data.recordedAllocatedMinor} · {copy.outstanding}:{" "}
            {invoice.data.outstandingMinor ?? copy.blockedAmount}
          </Text>
          {invoice.data.blockers.map((blocker) => (
            <Text key={blocker} role="alert">
              {blocker}
            </Text>
          ))}
          <Facts title={copy.facts} value={invoice.data} />
          <Evidence {...props} reference={invoice.data.evidence} />
          <Details title={copy.reviseInvoice}>
            <InvoiceRevisionForm {...props} invoice={invoice.data} allowed={ready} />
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
