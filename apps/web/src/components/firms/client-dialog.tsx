import { useState } from "react";
import * as Firms from "@open-erp/contracts/firms";
import { Button } from "@open-erp/ui/components/button";
import { InputField, SelectField, TextareaField } from "@open-erp/ui/components/field";
import { PageCaption } from "@open-erp/ui/components/accounting-page";
import { FirmForm } from "./form";
import type { Books } from "@/lib/accounting-api";
import type { Locale } from "@/paraglide/runtime";

export function ClientDialog(props: {
  workspace: typeof Firms.Workspace.Type;
  books: typeof Books.Type;
  client: typeof Firms.Client.Type | null;
  locale: Locale;
  onClose: () => void;
}) {
  const { workspace, client, locale } = props;
  const sv = locale === "sv";
  const [removing, setRemoving] = useState(false);
  const available = props.books.filter(
    (book) =>
      book.role === "operator" && !workspace.clients.some((item) => item.book.id === book.id),
  );
  const base = `/api/v1/firms/${workspace.firm.id}/clients`;
  if (removing && client)
    return (
      <FirmForm
        title={sv ? "Ta bort klientkoppling" : "Unlink client"}
        label={sv ? "Ta bort koppling" : "Unlink client"}
        path={`${base}/remove`}
        schema={Firms.RemoveClient}
        input={() => ({
          scope: { entityId: client.book.entityId, bookId: client.book.id },
          expectedRevision: client.revision,
        })}
        locale={locale}
        onClose={props.onClose}
      >
        <PageCaption>
          {sv
            ? `${client.book.name} tas bort från byråns klientlista. Bokföring och bokbehörigheter finns kvar.`
            : `${client.book.name} will leave this firm's client list. Accounting records and book access stay in place.`}
        </PageCaption>
      </FirmForm>
    );
  return (
    <FirmForm
      title={client ? client.book.name : sv ? "Lägg till klient" : "Add client"}
      label={
        client ? (sv ? "Spara klient" : "Save client") : sv ? "Lägg till klient" : "Add client"
      }
      path={base}
      schema={Firms.SaveClient}
      locale={locale}
      onClose={props.onClose}
      input={(fields) => {
        const book = client?.book ?? available.find((item) => item.id === fields.get("book"));
        return {
          scope: { entityId: book?.entityId, bookId: book?.id },
          leadId: fields.get("lead") || null,
          nextReviewOn: fields.get("review") || null,
          note: fields.get("note"),
          expectedRevision: client?.revision ?? 0,
        };
      }}
    >
      {!client ? (
        <SelectField
          name="book"
          label={sv ? "Företag" : "Company"}
          defaultValue={available[0]?.id ?? ""}
          options={available.map((book) => ({
            value: book.id,
            label: `${book.name} · ${book.currency}`,
          }))}
        />
      ) : null}
      {client ? (
        <SelectField
          name="lead"
          label={sv ? "Klientansvarig" : "Responsible accountant"}
          defaultValue={client.leadAvailable ? (client.leadId ?? "") : ""}
          options={[
            { value: "", label: sv ? "Ingen ansvarig" : "Unassigned" },
            ...workspace.members
              .filter((member) => client.eligibleLeadIds.includes(member.actorId))
              .map((member) => ({ value: member.actorId, label: member.name })),
          ]}
        />
      ) : null}
      {client?.leadId && !client.leadAvailable ? (
        <PageCaption>
          {sv
            ? "Tidigare ansvarig saknar nu behörighet. Välj en ny ansvarig."
            : "The previous accountant no longer has access. Choose a new responsible person."}
        </PageCaption>
      ) : null}
      <InputField
        name="review"
        type="date"
        label={sv ? "Nästa avstämning (valfritt)" : "Next review (optional)"}
        defaultValue={client?.nextReviewOn ?? ""}
      />
      <TextareaField
        name="note"
        label={sv ? "Klientanteckning" : "Client note"}
        rows={4}
        maxLength={2000}
        defaultValue={client?.note ?? ""}
      />
      <PageCaption>
        {sv
          ? "Anteckningen delas med byråmedlemmar som har åtkomst till företagets bokföring."
          : "Shared with firm members who have access to this company's books."}
      </PageCaption>
      {client ? (
        <Button type="button" static variant="ghost" onClick={() => setRemoving(true)}>
          {sv ? "Ta bort klientkoppling…" : "Unlink client…"}
        </Button>
      ) : (
        <PageCaption>
          {sv
            ? "Du kan lägga till företag som du har operatörsbehörighet till. Välj klientansvarig efter att kopplingen sparats."
            : "You can link companies where you have operator access. Assign a responsible accountant after adding the client."}
        </PageCaption>
      )}
    </FirmForm>
  );
}
