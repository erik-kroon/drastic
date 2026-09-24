import * as Drafts from "@open-erp/contracts/invoice-drafts";
import { InvoicePreview } from "@open-erp/ui/components/invoice-preview";
import { formatMinorAmount } from "@/lib/workspace-api";
import type { CommerceProps } from "./shared";

export function InvoiceDraftDocument({
  record,
  locale,
  title,
  issued = false,
}: {
  record: typeof Drafts.InvoiceDraftRevision.Type;
  locale: CommerceProps["locale"];
  title?: string;
  issued?: boolean;
}) {
  const labels = locale === "sv" ? swedish : english;
  const amount = (value: string | null) =>
    value === null
      ? "—"
      : `${formatMinorAmount(value, record.content.currencyScale, locale)} ${record.content.currency}`;
  return (
    <InvoicePreview
      title={title ?? record.content.title}
      seller={record.content.seller.legalName}
      sellerAddress={record.content.seller.address}
      customer={record.content.customer.legalName}
      address={record.content.customer.address}
      dates={[
        {
          label: issued ? labels.issueDate : labels.plannedIssueDate,
          value: record.content.plannedIssueDate ?? "—",
        },
        { label: labels.dueDate, value: record.content.dueDate ?? "—" },
      ]}
      lines={record.content.lines.map((line) => ({
        id: line.id,
        description: line.description,
        quantity: line.quantity,
        net: amount(record.calculatedLines.find((item) => item.id === line.id)?.netMinor ?? null),
        tax: amount(line.taxMinor),
      }))}
      totals={[
        { label: labels.subtotal, value: amount(record.totals.netMinor) },
        { label: labels.tax, value: amount(record.totals.taxMinor) },
        { label: labels.total, value: amount(record.totals.grossMinor), total: true },
      ]}
      terms={record.content.paymentTerms}
      labels={{
        state: issued ? labels.issuedPreview : labels.draftPreview,
        from: labels.from,
        billTo: labels.billTo,
        invoiceLines: labels.invoiceLines,
        description: labels.description,
        qty: labels.qty,
        net: labels.net,
        tax: labels.tax,
        paymentTerms: labels.paymentTerms,
      }}
    />
  );
}
const english = {
  draftPreview: "Draft · Not issued",
  issuedPreview: "Issued demo · Not sent",
  from: "From",
  billTo: "Bill to",
  plannedIssueDate: "Planned issue date",
  issueDate: "Planned date on saved draft",
  dueDate: "Due date",
  invoiceLines: "Invoice lines",
  description: "Description",
  qty: "Qty",
  net: "Before tax",
  tax: "Tax",
  subtotal: "Subtotal",
  total: "Total",
  paymentTerms: "Payment terms",
};
const swedish: typeof english = {
  draftPreview: "Utkast · Inte utfärdad",
  issuedPreview: "Utfärdad demo · Inte skickad",
  from: "Från",
  billTo: "Faktureras till",
  plannedIssueDate: "Planerat fakturadatum",
  issueDate: "Planerat datum i sparat utkast",
  dueDate: "Förfallodatum",
  invoiceLines: "Fakturarader",
  description: "Beskrivning",
  qty: "Antal",
  net: "Exkl. moms",
  tax: "Moms",
  subtotal: "Exkl. moms",
  total: "Totalt",
  paymentTerms: "Betalningsvillkor",
};
