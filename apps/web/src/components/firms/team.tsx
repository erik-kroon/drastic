import { useState } from "react";
import * as Firms from "@open-erp/contracts/firms";
import { Button } from "@open-erp/ui/components/button";
import { Badge } from "@open-erp/ui/components/badge";
import { Box } from "@open-erp/ui/components/box";
import { DataTable } from "@open-erp/ui/components/data-table";
import { InputField, SelectField } from "@open-erp/ui/components/field";
import { RecordHeading } from "@open-erp/ui/components/record-layout";
import { PageCaption } from "@open-erp/ui/components/accounting-page";
import { FirmForm } from "./form";
import type { Locale } from "@/paraglide/runtime";

export function FirmTeam({
  workspace,
  locale,
}: {
  workspace: typeof Firms.Workspace.Type;
  locale: Locale;
}) {
  const sv = locale === "sv";
  const [editing, setEditing] = useState<{ member: typeof Firms.Member.Type | null } | null>(null);
  const admin = workspace.firm.role === "admin";
  return (
    <Box display="grid" gap="lg">
      <RecordHeading
        title={sv ? "Team" : "Team"}
        subtitle={
          sv
            ? "Personerna som arbetar med byråns klienter."
            : "The people working with your firm's clients."
        }
        action={
          admin ? (
            <Button onClick={() => setEditing({ member: null })}>
              {sv ? "Lägg till person" : "Add person"}
            </Button>
          ) : null
        }
      />
      <DataTable
        title={sv ? "Byråteam" : "Firm team"}
        narrow="stack"
        columns={[
          { id: "name", label: sv ? "Namn" : "Name" },
          { id: "role", label: sv ? "Byråroll" : "Firm role" },
          { id: "status", label: "Status" },
          { id: "actions", label: sv ? "Hantera" : "Manage" },
        ]}
        rows={workspace.members.map((member) => ({
          id: member.actorId,
          cells: [
            <Box key="person" display="grid" gap="sm">
              <span>
                {member.name}
                {member.actorId === workspace.actorId ? (sv ? " (du)" : " (you)") : ""}
              </span>
              <PageCaption>{member.email}</PageCaption>
            </Box>,
            member.role === "admin"
              ? sv
                ? "Administratör"
                : "Administrator"
              : sv
                ? "Redovisningskonsult"
                : "Accountant",
            <Badge key="status" variant="secondary">
              {member.active ? (sv ? "Aktiv" : "Active") : sv ? "Borttagen" : "Removed"}
            </Badge>,
            admin ? (
              <Button key="edit" static variant="ghost" onClick={() => setEditing({ member })}>
                {sv ? "Redigera" : "Edit"}
              </Button>
            ) : (
              "—"
            ),
          ],
        }))}
      />
      <PageCaption>
        {sv
          ? "Byråroller styr klientlistan och teamet. Åtkomst till varje företags bokföring tilldelas separat."
          : "Firm roles control the client list and team. Access to each company's books is granted separately."}
      </PageCaption>
      {editing ? (
        <FirmForm
          title={editing.member?.name ?? (sv ? "Lägg till person" : "Add person")}
          label={sv ? "Spara medlem" : "Save member"}
          path={`/api/v1/firms/${workspace.firm.id}/members`}
          schema={Firms.SaveMember}
          locale={locale}
          onClose={() => setEditing(null)}
          input={(fields) => ({
            email: editing.member?.email ?? String(fields.get("email")).trim().toLowerCase(),
            role: fields.get("role"),
            active: fields.get("active") === "true",
            expectedRevision: editing.member?.revision ?? 0,
          })}
        >
          {!editing.member ? (
            <InputField
              name="email"
              type="email"
              label={sv ? "E-postadress" : "Email address"}
              required
              maxLength={254}
              autoComplete="off"
            />
          ) : null}
          <SelectField
            name="role"
            label={sv ? "Byråroll" : "Firm role"}
            defaultValue={editing.member?.role ?? "accountant"}
            options={[
              { value: "accountant", label: sv ? "Redovisningskonsult" : "Accountant" },
              { value: "admin", label: sv ? "Administratör" : "Administrator" },
            ]}
          />
          <SelectField
            name="active"
            label={sv ? "Medlemskap" : "Membership"}
            defaultValue={String(editing.member?.active ?? true)}
            options={[
              { value: "true", label: sv ? "Aktiv" : "Active" },
              { value: "false", label: sv ? "Ta bort från byrån" : "Remove from firm" },
            ]}
          />
          <PageCaption>
            {sv
              ? "Personen behöver ett befintligt inloggningskonto. Administratörer kan hantera team och klientkopplingar. Företagens bokbehörigheter ändras inte."
              : "This person needs an existing sign-in account. Administrators can manage the team and client links. Company book permissions do not change."}
          </PageCaption>
        </FirmForm>
      ) : null}
    </Box>
  );
}
