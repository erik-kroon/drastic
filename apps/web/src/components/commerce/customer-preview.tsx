import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import type * as Commerce from "@open-erp/contracts/commerce";
import { Box } from "@open-erp/ui/components/box";
import { ContactFacts } from "@open-erp/ui/components/contact-register";
import { RegisterDetailHeading } from "@open-erp/ui/components/register-workspace";
import { Disclosure } from "@open-erp/ui/components/workflow";
import { AccountingStatus } from "@/components/accounting-status";
import { customerDefaultsQuery } from "./customer-invoice-defaults";
import type { CommerceProps } from "./shared";

export function CustomerPreview(
  props: CommerceProps & { party: typeof Commerce.CounterpartyRevision.Type; children: ReactNode },
) {
  const sv = props.locale === "sv";

  const defaults = useQuery({
    ...customerDefaultsQuery(props.book, props.party.id),
    enabled: props.party.role !== "supplier",
  });

  const current = defaults.isError ? undefined : defaults.data;

  return (
    <Box display="grid" gap="md" minWidth="zero">
      <RegisterDetailHeading title={props.party.displayName} />
      <ContactFacts
        rows={[
          { label: sv ? "Organisationsnummer" : "Registration number", value: "—" },
          {
            label: sv ? "Betalningsvillkor" : "Payment terms",
            value: current ? `${current.terms.days} ${sv ? "dagar" : "days"}` : "—",
          },
          {
            label: sv ? "Momsnummer" : "VAT number",
            value: sv ? "Ej kontrollerat" : "Not verified",
          },
        ]}
      />
      <AccountingStatus
        locale={props.locale}
        pending={props.party.role !== "supplier" && defaults.isPending}
        error={defaults.error}
      />
      <Disclosure title={sv ? "Redigera uppgifter" : "Edit details"}>{props.children}</Disclosure>
    </Box>
  );
}
