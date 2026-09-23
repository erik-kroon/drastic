import * as Drafts from "@open-erp/contracts/invoice-drafts";
import { Box } from "@open-erp/ui/components/box";
import { Text } from "@open-erp/ui/components/typography";
import { DataTable } from "@open-erp/ui/components/data-table";
import { InvoiceTotals } from "@open-erp/ui/components/invoice-lines";
import { DocumentPaper, RecordHeading, RecordSection } from "@open-erp/ui/components/record-layout";
import { formatMinorAmount } from "@/lib/workspace-api";
import type { CommerceProps } from "./shared";
export function InvoiceDraftDocument({
  record,
  locale,
  title,
}: {
  record: typeof Drafts.InvoiceDraftRevision.Type;
  locale: CommerceProps["locale"];
  title?: string;
}) {
  const labels = locale === "sv" ? swedish : english;
  const amount = (value: string | null) =>
    value === null
      ? "—"
      : `${formatMinorAmount(value, record.content.currencyScale, locale)} ${record.content.currency}`;
  return (
    <DocumentPaper>
      <RecordHeading
        title={title ?? labels.invoiceDraft}
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
        minWidth="fit"
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
            amount(record.calculatedLines.find((item) => item.id === line.id)?.netMinor ?? null),
            amount(line.taxMinor),
          ],
        }))}
      />
      <InvoiceTotals
        rows={[
          { label: labels.subtotal, value: amount(record.totals.netMinor) },
          { label: labels.tax, value: amount(record.totals.taxMinor) },
          { label: labels.total, value: amount(record.totals.grossMinor), total: true },
        ]}
      />
      {record.content.paymentTerms ? <Text tone="muted">{record.content.paymentTerms}</Text> : null}
    </DocumentPaper>
  );
}
const english = {
  invoiceDraft: "Invoice · Draft",
  billTo: "Bill to",
  dates: "Dates",
  invoiceDate: "Invoice date",
  dueDate: "Due date",
  invoiceLines: "Invoice lines",
  description: "Description",
  qty: "Qty",
  net: "Net",
  tax: "Tax",
  subtotal: "Subtotal",
  total: "Total",
};
const swedish: typeof english = {
  invoiceDraft: "Faktura · Utkast",
  billTo: "Faktureras till",
  dates: "Datum",
  invoiceDate: "Fakturadatum",
  dueDate: "Förfallodatum",
  invoiceLines: "Fakturarader",
  description: "Beskrivning",
  qty: "Antal",
  net: "Exkl. moms",
  tax: "Moms",
  subtotal: "Exkl. moms",
  total: "Totalt",
};
