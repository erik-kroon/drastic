import { useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Commerce from "@open-erp/contracts/commerce";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { InputField, SelectField } from "@open-erp/ui/components/field";
import { PageCaption } from "@open-erp/ui/components/accounting-page";
import { RecordFact, RecordSummary } from "@open-erp/ui/components/record-layout";
import { AccountingStatus } from "@/components/accounting-status";
import { bookKey, bookPath, readAccounting } from "@/lib/accounting-api";
import { workQueryOptions, formatMinorAmount } from "@/lib/workspace-api";
import { CommandForm, commerceKey, commercePath, checkScope, type CommerceProps } from "./shared";

export function InvoiceRegistration(
  props: CommerceProps & {
    direction: "customer" | "supplier";
    onSaved: (invoice: typeof Commerce.Invoice.Type) => void;
  },
) {
  const sv = props.locale === "sv";
  const labels = sv ? swedish : english;
  const [partyId, setPartyId] = useState("");
  const [lineId, setLineId] = useState("");
  const [evidenceId, setEvidenceId] = useState("");
  const metadata = useQuery(workQueryOptions(props.book, {}));
  const scale = metadata.data?.currencyScale;
  const contacts = useInfiniteQuery({
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
  const vouchers = useInfiniteQuery({
    queryKey: [...bookKey(props.book), "vouchers"],
    initialPageParam: "0",
    queryFn: ({ pageParam, signal }) =>
      readAccounting(
        `${bookPath(props.book)}/vouchers?after=${encodeURIComponent(pageParam)}`,
        Accounting.VoucherPage,
        { signal },
      ),
    getNextPageParam: (last) => last.next,
    retry: false,
  });
  const parties =
    contacts.data?.pages
      .flatMap((page) => page.items)
      .filter((party) => party.role === props.direction || party.role === "both") ?? [];
  const party = parties.find((item) => item.id === partyId);
  const candidates =
    vouchers.data?.pages
      .flatMap((page) => page.items)
      .flatMap((voucher) =>
        voucher.action.lines
          .filter(
            (line) =>
              BigInt(props.direction === "customer" ? line.debitMinor : line.creditMinor) > 0n,
          )
          .map((line) => ({ voucher, line })),
      ) ?? [];
  const selected = candidates.find((item) => `${item.voucher.id}:${item.line.lineId}` === lineId);
  const amount = selected
    ? props.direction === "customer"
      ? selected.line.debitMinor
      : selected.line.creditMinor
    : null;
  const source =
    selected?.voucher.action.evidenceRefs.find((item) => item.evidenceId === evidenceId) ??
    (selected?.voucher.action.evidenceRefs.length === 1
      ? selected.voucher.action.evidenceRefs[0]
      : undefined);
  return (
    <CommandForm
      {...props}
      path={`${commercePath(props.book)}/invoices`}
      schema={Commerce.CreateInvoice}
      output={Commerce.Invoice}
      label={labels.registerInvoice}
      allowed={props.book.role === "operator"}
      canSubmit={!!party && !!selected && !!source && scale !== undefined}
      onSuccess={props.onSaved}
      input={(fields) => ({
        kind: "synthetic_invoice_v1",
        direction: props.direction,
        counterpartyId: party?.id,
        counterpartyRevision: party?.revision,
        documentNumber: fields.get("documentNumber"),
        issuedOn: fields.get("issuedOn"),
        dueOn: fields.get("dueOn"),
        currency: props.book.currency,
        amountMinor: amount,
        controlAccountId: selected?.line.accountId,
        recognitionVoucherId: selected?.voucher.id,
        recognitionLineId: selected?.line.lineId,
        evidenceId: source?.evidenceId,
        description: fields.get("description"),
      })}
    >
      <PageCaption>{labels.linkTheOriginalInvoiceTo}</PageCaption>
      <SelectField
        label={labels.contact}
        value={partyId}
        onValueChange={(value) => setPartyId(value ?? "")}
        options={[
          { value: "", label: labels.chooseContact },
          ...parties.map((item) => ({ value: item.id, label: item.displayName })),
        ]}
      />
      {contacts.hasNextPage ? (
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            void contacts.fetchNextPage();
          }}
        >
          {labels.loadMoreContacts}
        </Button>
      ) : null}
      <SelectField
        label={labels.postedInvoiceLine}
        value={lineId}
        onValueChange={(value) => {
          setLineId(value ?? "");
          setEvidenceId("");
        }}
        options={[
          { value: "", label: labels.chooseAPostedLine },
          ...candidates.map(({ voucher, line }) => ({
            value: `${voucher.id}:${line.lineId}`,
            label: `${voucher.action.series}${voucher.number} · ${line.description} · ${scale === undefined ? "—" : formatMinorAmount(props.direction === "customer" ? line.debitMinor : line.creditMinor, scale, props.locale)} ${props.book.currency}`,
          })),
        ]}
      />
      {vouchers.hasNextPage ? (
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            void vouchers.fetchNextPage();
          }}
        >
          {labels.loadMoreVouchers}
        </Button>
      ) : null}
      {selected && selected.voucher.action.evidenceRefs.length > 1 ? (
        <SelectField
          label={labels.originalSource}
          value={evidenceId}
          onValueChange={(value) => setEvidenceId(value ?? "")}
          options={[
            { value: "", label: labels.chooseSource },
            ...selected.voucher.action.evidenceRefs.map((item) => ({
              value: item.evidenceId,
              label: item.locator,
            })),
          ]}
        />
      ) : null}
      <AccountingStatus
        locale={props.locale}
        pending={contacts.isPending || vouchers.isPending}
        error={contacts.error ?? vouchers.error ?? metadata.error}
      />
      {amount !== null && scale !== undefined ? (
        <RecordSummary>
          <RecordFact label={labels.invoiceAmount}>
            {formatMinorAmount(amount, scale, props.locale)} {props.book.currency}
          </RecordFact>
        </RecordSummary>
      ) : null}
      <Box display="grid" columns={2} gap="lg">
        <InputField name="documentNumber" label={labels.invoiceNumber} required maxLength={200} />
        <InputField name="description" label={labels.description} required maxLength={2000} />
        <InputField name="issuedOn" label={labels.invoiceDate} type="date" required />
        <InputField name="dueOn" label={labels.dueDate} type="date" required />
      </Box>
    </CommandForm>
  );
}

const english = {
  registerInvoice: "Register invoice",
  linkTheOriginalInvoiceTo:
    "Link the original invoice to an existing posted line. This does not create a new posting or payment.",
  contact: "Contact",
  chooseContact: "Choose contact…",
  loadMoreContacts: "Load more contacts",
  postedInvoiceLine: "Posted invoice line",
  chooseAPostedLine: "Choose a posted line…",
  loadMoreVouchers: "Load more vouchers",
  originalSource: "Original source",
  chooseSource: "Choose source…",
  invoiceAmount: "Invoice amount",
  invoiceNumber: "Invoice number",
  description: "Description",
  invoiceDate: "Invoice date",
  dueDate: "Due date",
};
const swedish: typeof english = {
  registerInvoice: "Registrera faktura",
  linkTheOriginalInvoiceTo:
    "Koppla originalfakturan till en redan bokförd rad. Detta skapar ingen ny bokföring eller betalning.",
  contact: "Kontakt",
  chooseContact: "Välj kontakt…",
  loadMoreContacts: "Läs in fler kontakter",
  postedInvoiceLine: "Bokförd fakturarad",
  chooseAPostedLine: "Välj bokförd rad…",
  loadMoreVouchers: "Läs in fler verifikat",
  originalSource: "Originalunderlag",
  chooseSource: "Välj underlag…",
  invoiceAmount: "Fakturabelopp",
  invoiceNumber: "Fakturanummer",
  description: "Beskrivning",
  invoiceDate: "Fakturadatum",
  dueDate: "Förfallodatum",
};
