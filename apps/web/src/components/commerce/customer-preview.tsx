import { useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import type * as Commerce from "@open-erp/contracts/commerce";
import { Box } from "@open-erp/ui/components/box";
import { ContactFacts, ContactPreviewLayout } from "@open-erp/ui/components/contact-register";
import { RegisterDetailHeading } from "@open-erp/ui/components/register-workspace";
import { Disclosure } from "@open-erp/ui/components/workflow";
import { AccountingStatus } from "@/components/accounting-status";
import { WorkReviewAction, WorkReviewFooter } from "@open-erp/ui/components/work-controls";
import { workspacePath } from "@/lib/book-context";
import { NewInvoiceDraft } from "./invoice-drafts";
import { CustomerInvoicesPreview } from "./customer-invoices-preview";
import { customerDefaultsQuery } from "./customer-invoice-defaults";
import type { CommerceProps } from "./shared";

export function CustomerPreview(
  props: CommerceProps & { party: typeof Commerce.CounterpartyRevision.Type; children: ReactNode },
) {
  const sv = props.locale === "sv";
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);

  const defaults = useQuery({
    ...customerDefaultsQuery(props.book, props.party.id),
    enabled: props.party.role !== "supplier",
  });

  const current = defaults.isError ? undefined : defaults.data;

  return (
    <ContactPreviewLayout>
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
      <CustomerInvoicesPreview book={props.book} locale={props.locale} partyId={props.party.id} />
      <WorkReviewFooter>
        <Box display="grid" gap="sm">
          <WorkReviewAction
            disabled={props.book.role !== "operator"}
            onClick={() => setCreating(true)}
          >
            {sv ? "Ny faktura till kunden" : "New invoice for customer"}
          </WorkReviewAction>
          <Disclosure compact title={sv ? "Redigera uppgifter" : "Edit details"}>
            {props.children}
          </Disclosure>
        </Box>
      </WorkReviewFooter>
      {creating ? (
        <NewInvoiceDraft
          book={props.book}
          locale={props.locale}
          initialCustomer={props.party}
          onClose={() => setCreating(false)}
          onSaved={(id) => {
            setCreating(false);
            void navigate({
              to: `${workspacePath(props.book)}/sales`,
              search: { record: id, kind: "draft" },
            });
          }}
        />
      ) : null}
    </ContactPreviewLayout>
  );
}
