import type * as Drafts from "@open-erp/contracts/invoice-drafts";
import { InvoicePreview } from "@open-erp/ui/components/invoice-preview";
import { decimalToMinor, formatMinorAmount } from "@/lib/workspace-api";
import { invoiceEditorTotals } from "./invoice-editor-lines";
import { restoredField, type DraftSession } from "./invoice-draft-session";
import type { CommerceProps } from "./shared";

export function InvoiceEditingPreview(
  props: CommerceProps & {
    session: DraftSession;
    scale: number;
    commercial: boolean;
    calculation?: typeof Drafts.CommercialDraftCalculation.Type;
  },
) {
  const { session, scale, locale, book } = props;
  const sv = locale === "sv";
  const content = session.state.baseline?.content;
  const totals = invoiceEditorTotals(session.state.lines, scale);
  const currency = content?.currency ?? book.currency;

  const amount = (value: string | bigint | null | undefined) =>
    value == null ? "—" : `${formatMinorAmount(value.toString(), scale, locale)} ${currency}`;

  const net = props.commercial ? props.calculation?.totals.netMinor : totals.net;
  const tax = props.commercial ? props.calculation?.totals.taxMinor : totals.tax;
  const gross = props.commercial ? props.calculation?.totals.grossMinor : totals.gross;

  return (
    <InvoicePreview
      {...previewIdentity(props)}
      lines={session.state.lines.map((line) => {
        const calculated = props.calculation?.calculatedLines.find((item) => item.id === line.id);
        const entered = invoiceEditorTotals([line], scale);

        return {
          id: line.id,
          description: restoredField(
            session,
            `${line.id}_description`,
            line.defaults?.description ?? "—",
          ),
          quantity: line.quantity,
          net: amount(props.commercial ? calculated?.netMinor : entered.net),
          tax: amount(
            props.commercial
              ? props.calculation?.content.lines.find((item) => item.id === line.id)?.taxMinor
              : decimalToMinor(line.tax, scale),
          ),
        };
      })}
      totals={[
        { label: sv ? "Exkl. moms" : "Subtotal", value: amount(net) },
        { label: sv ? "Moms" : "Tax", value: amount(tax) },
        { label: sv ? "Totalt" : "Total", value: amount(gross), total: true },
      ]}
      terms={restoredField(session, "terms", content?.paymentTerms ?? "")}
      labels={{
        state: sv ? "Förhandsvisning, Utkast" : "Preview, Draft",
        from: sv ? "Från" : "From",
        billTo: sv ? "Kund" : "Customer",
        invoiceLines: sv ? "Fakturarader" : "Invoice lines",
        description: sv ? "Beskrivning" : "Description",
        qty: sv ? "Antal" : "Qty",
        net: sv ? "Exkl. moms" : "Subtotal",
        tax: sv ? "Moms" : "Tax",
        paymentTerms: sv ? "Betalningsvillkor" : "Payment terms",
      }}
    />
  );
}

function previewIdentity(props: {
  session: DraftSession;
  book: CommerceProps["book"];
  locale: CommerceProps["locale"];
}) {
  const { session, book, locale } = props;
  const sv = locale === "sv";
  const content = session.state.baseline?.content;
  const customer = session.state.customer;

  return {
    title: restoredField(session, "title", content?.title ?? (sv ? "Faktura" : "Invoice")),
    seller: restoredField(session, "seller", content?.seller.legalName ?? book.name),
    sellerAddress: restoredField(session, "sellerAddress", content?.seller.address ?? ""),
    customer: restoredField(
      session,
      "customerName",
      (customer && customer.id === content?.counterpartyId
        ? content.customer.legalName
        : customer?.displayName) ?? "—",
    ),
    address: restoredField(
      session,
      "customerAddress",
      customer && customer.id === content?.counterpartyId ? (content.customer.address ?? "") : "",
    ),
    dates: [
      ...(restoredField(session, "buyerReference", content?.buyerReference ?? "")
        ? [
            {
              label: sv ? "Kundens referens" : "Buyer reference",
              value: restoredField(session, "buyerReference", content?.buyerReference ?? ""),
            },
          ]
        : []),
      {
        label: sv ? "Fakturadatum" : "Invoice date",
        value: restoredField(session, "issueDate", content?.plannedIssueDate ?? "—"),
      },
      {
        label: sv ? "Förfallodatum" : "Due date",
        value: restoredField(session, "dueDate", content?.dueDate ?? "—"),
      },
    ],
  };
}
