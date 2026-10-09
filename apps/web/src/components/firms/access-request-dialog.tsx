import { useState } from "react";
import * as Firms from "@open-erp/contracts/firms";
import { InputField, SelectField } from "@open-erp/ui/components/field";
import { PageCaption } from "@open-erp/ui/components/accounting-page";
import { FirmForm, formText } from "./form";
import type { ActiveRequest, RequestWorkspace } from "./portfolio-model";
import type { Locale } from "@/paraglide/runtime";

export type RequestEditor =
  | { kind: "create" }
  | { kind: "edit" | "revoke"; request: ActiveRequest };

export function AccessRequestDialog(props: {
  workspace: RequestWorkspace;
  editor: RequestEditor;
  locale: Locale;
  onClose: () => void;
}) {
  const { workspace, editor, locale } = props;
  const sv = locale === "sv";

  const [id] = useState(() => `request_${crypto.randomUUID()}`);
  const request = editor.kind === "create" ? null : editor.request;
  const revoke = editor.kind === "revoke";

  const label = revoke
    ? sv
      ? "Återkalla förfrågan"
      : "Revoke request"
    : request
      ? sv
        ? "Spara förfrågan"
        : "Save request"
      : sv
        ? "Begär åtkomst"
        : "Request access";

  return (
    <FirmForm
      title={revoke ? label : request ? (sv ? "Ändra förfrågan" : "Edit request") : label}
      label={label}
      path={`/api/v1/firms/${workspace.firm.id}/access-requests`}
      schema={Firms.SaveAccessRequest}
      input={(fields) => ({
        id: request?.id ?? id,
        clientName: revoke ? request?.clientName : formText(fields, "name").trim(),
        organizationNumber: revoke
          ? request?.organizationNumber
          : formText(fields, "organization").trim() || null,
        leadId: revoke ? request?.leadId : formText(fields, "lead") || null,
        state: revoke ? "revoked" : "requested",
        expectedRevision: request?.revision ?? 0,
      })}
      locale={locale}
      onClose={props.onClose}
    >
      {revoke ? (
        <PageCaption>
          {sv
            ? `Återkalla den lokala förfrågan för ${request?.clientName}.`
            : `Revoke the local request for ${request?.clientName}.`}
        </PageCaption>
      ) : (
        <>
          <InputField
            name="name"
            label={sv ? "Klientens namn" : "Client name"}
            required
            maxLength={200}
            defaultValue={request?.clientName ?? ""}
          />
          <InputField
            name="organization"
            label={sv ? "Organisationsnummer (valfritt)" : "Organization number (optional)"}
            inputMode="numeric"
            pattern="[0-9]{10}"
            maxLength={10}
            defaultValue={request?.organizationNumber ?? ""}
          />
          <SelectField
            name="lead"
            label={sv ? "Klientansvarig" : "Responsible accountant"}
            defaultValue={request?.leadAvailable ? (request.leadId ?? "") : ""}
            options={[
              { value: "", label: sv ? "Ingen ansvarig" : "Unassigned" },
              ...workspace.members
                .filter((member) => member.active && member.signInEnabled)
                .map((member) => ({ value: member.actorId, label: member.name })),
            ]}
          />
        </>
      )}
      <PageCaption>
        {sv
          ? "Förfrågan sparas i byrån. Ingen inbjudan skickas och ingen bokbehörighet ändras."
          : "The request is saved in the firm. No invitation is sent and book permissions stay unchanged."}
      </PageCaption>
    </FirmForm>
  );
}
