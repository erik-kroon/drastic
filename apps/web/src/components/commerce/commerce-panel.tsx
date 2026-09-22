import { Box } from "@open-erp/ui/components/box";
import { Heading, Text } from "@open-erp/ui/components/typography";
import { Allocations } from "./allocations";
import { Counterparties } from "./counterparties";
import { Invoices } from "./invoices";
import { InvoiceDrafts } from "./invoice-drafts";
import { invoiceDraftCopy } from "./invoice-draft-copy";
import { RegisterReports } from "./register-reports";
import { commerceCopy } from "./copy";
import { Details, type CommerceProps } from "./shared";

/** Lazy-mount from the workspace; all local state resets when the scoped book changes. */
export function CommercePanel(props: CommerceProps) {
  return <CommerceWorkspace key={`${props.book.entityId}:${props.book.id}`} {...props} />;
}
function CommerceWorkspace(props: CommerceProps) {
  const copy = commerceCopy(props.locale);
  return (
    <Box display="grid" gap="xl" minWidth="zero">
      <Heading>{copy.title}</Heading>
      <Text>{copy.limit}</Text>
      <Details title={copy.parties} open>
        <Counterparties {...props} />
      </Details>
      <Details title={invoiceDraftCopy(props.locale).title}>
        <InvoiceDrafts {...props} />
      </Details>
      <Details title={copy.invoices}>
        <Invoices {...props} />
      </Details>
      <Details title={copy.allocations}>
        <Allocations {...props} />
      </Details>
      <Details title={copy.registerReports}>
        <RegisterReports {...props} />
      </Details>
    </Box>
  );
}
