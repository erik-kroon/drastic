import type * as Commerce from "@open-erp/contracts/commerce";
import { InvoiceProgress } from "@open-erp/ui/components/invoice-preview";
import type { CommerceProps } from "./shared";

export function SupplierPaymentState({
  locale,
  invoice,
}: {
  locale: CommerceProps["locale"];
  invoice?: typeof Commerce.Invoice.Type;
}) {
  const sv = locale === "sv";
  const match = invoice
    ? invoice.status === "allocated"
      ? sv
        ? "Helt matchad i reskontran"
        : "Fully matched in the register"
      : invoice.status === "partially_allocated"
        ? sv
          ? "Delvis matchad i reskontran"
          : "Partly matched in the register"
        : invoice.status === "cancelled"
          ? sv
            ? "Makulerad"
            : "Cancelled"
          : sv
            ? "Ingen fullständig matchning"
            : "Not fully matched"
    : sv
      ? "Inget betalningsunderlag skapas här"
      : "No payment instruction from this draft";
  return (
    <InvoiceProgress
      title={sv ? "Betalningsläge" : "Payment status"}
      items={[
        {
          label: "Export",
          value: sv ? "Inte fastställd i denna vy" : "Not established in this view",
        },
        {
          label: sv ? "Bankens godkännande" : "Bank acceptance",
          value: sv ? "Inte verifierat" : "Not verified",
        },
        { label: sv ? "Betalning" : "Payment", value: match },
      ]}
      note={
        sv
          ? "En exporterad fil bevisar inte att banken har godkänt eller betalat. En matchning gäller en redan bokförd betalning, inte en bankbekräftelse."
          : "An exported file does not prove bank acceptance or payment. A register match links an existing posted payment; it is not a bank confirmation."
      }
    />
  );
}
