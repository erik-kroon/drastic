import { useState, type ReactNode } from "react";
import * as Drafts from "@open-erp/contracts/invoice-drafts";
import { Box } from "@open-erp/ui/components/box";
import { InputField } from "@open-erp/ui/components/field";
import { Text } from "@open-erp/ui/components/typography";
import { RecordEditor } from "@open-erp/ui/components/record-layout";
import type { CommerceProps } from "./shared";

type Party = typeof Drafts.DraftContent.Type.customer;

export function InvoiceDraftParty(props: {
  title: string;
  party: Pick<Party, "legalName" | "registrationId" | "countryCode" | "address">;
  prefix: "seller" | "customer";
  locale: CommerceProps["locale"];
  children?: ReactNode;
}) {
  const { party, prefix, locale } = props;
  const [details, setDetails] = useState(party);
  const sv = locale === "sv";

  return (
    <RecordEditor
      title={props.title}
      editLabel={sv ? "Redigera" : "Edit"}
      doneLabel={sv ? "Klart" : "Done"}
      summary={
        <Box display="grid" gap="xs">
          <Text>
            <strong>{details.legalName || (sv ? "Namn saknas" : "Name missing")}</strong>
          </Text>
          <Text tone="muted">{details.address || (sv ? "Adress saknas" : "Address missing")}</Text>
          {details.registrationId ? <Text tone="muted">{details.registrationId}</Text> : null}
        </Box>
      }
    >
      {props.children}
      <InputField
        name={prefix === "seller" ? "seller" : "customerName"}
        label={sv ? "Fakturanamn" : "Billing name"}
        required
        maxLength={200}
        value={details.legalName}
        onChange={(event) => setDetails({ ...details, legalName: event.target.value })}
      />
      <InputField
        name={`${prefix}Address`}
        label={sv ? "Fakturaadress" : "Billing address"}
        maxLength={1000}
        value={details.address ?? ""}
        onChange={(event) => setDetails({ ...details, address: event.target.value })}
      />
      <Box display="grid" columns={2} gap="md">
        <InputField
          name={prefix === "seller" ? "registration" : "customerRegistration"}
          label={sv ? "Organisationsnummer" : "Registration number"}
          maxLength={200}
          value={details.registrationId ?? ""}
          onChange={(event) => setDetails({ ...details, registrationId: event.target.value })}
        />
        <InputField
          name={`${prefix}Country`}
          label={sv ? "Landskod" : "Country code"}
          pattern="[A-Z]{2}"
          maxLength={2}
          placeholder="SE"
          value={details.countryCode ?? ""}
          onChange={(event) => setDetails({ ...details, countryCode: event.target.value })}
        />
      </Box>
    </RecordEditor>
  );
}
