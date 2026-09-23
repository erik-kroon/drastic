import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as Workspace from "@open-erp/contracts/workspace";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { InputField, SelectField, TextareaField } from "@open-erp/ui/components/field";
import { FormDialog } from "@open-erp/ui/components/form-dialog";
import { PageCaption } from "@open-erp/ui/components/accounting-page";
import { AccountingStatus } from "./accounting-status";
import { CommandForm } from "./commerce/shared";
import { useBookWorkspace } from "@/lib/book-context";
import { bookKey, bookPath } from "@/lib/accounting-api";
import { coordinationOptions } from "@/lib/workspace-coordination";

export function WorkHandoff(props: { item: typeof Workspace.AttentionItem.Type }) {
  const context = useBookWorkspace();
  const { book, locale } = context;
  const sv = locale === "sv";
  const team = useQuery(coordinationOptions(book));
  const client = useQueryClient();
  const [editing, setEditing] = useState<typeof Workspace.AttentionItem.Type | null>(null);
  const current = props.item.assignment;
  const members = team.isError ? [] : (team.data?.members ?? []);
  const member = members.find((item) => item.id === current?.assigneeId);
  const label = !team.isSuccess
    ? sv
      ? "Läs ansvarig"
      : "View assignment"
    : current?.assigneeId
      ? (member?.name ?? (sv ? "Ej längre medlem" : "Member unavailable"))
      : sv
        ? "Tilldela"
        : "Assign";
  return (
    <>
      <Box display="grid" gap="sm">
        <Button static variant="ghost" onClick={() => setEditing(props.item)}>
          {label}
        </Button>
        {current?.dueOn ? (
          <PageCaption>
            {sv ? "Senast" : "Due"} {current.dueOn}
          </PageCaption>
        ) : null}
      </Box>
      {editing ? (
        <FormDialog
          size="compact"
          title={editing.title}
          closeLabel={sv ? "Stäng" : "Close"}
          onClose={() => setEditing(null)}
        >
          <AccountingStatus locale={locale} pending={team.isPending} error={team.error} />
          {team.isError ? (
            <Button
              variant="outline"
              onClick={() => {
                void team.refetch();
              }}
            >
              {sv ? "Försök igen" : "Retry team"}
            </Button>
          ) : null}
          {team.isSuccess ? (
            <CommandForm
              {...context}
              path={`${bookPath(book)}/workspace/assignments`}
              schema={Workspace.AssignWork}
              output={Workspace.AssignmentResult}
              label={sv ? "Spara överlämning" : "Save handoff"}
              allowed={book.role === "operator"}
              input={(fields) => ({
                kind: editing.kind,
                recordId: editing.id,
                assigneeId: fields.get("assignee") || null,
                dueOn: fields.get("dueOn") || null,
                note: fields.get("note"),
                expectedRevision: editing.assignment?.revision ?? 0,
              })}
              onSuccess={() => {
                void client.invalidateQueries({ queryKey: bookKey(book) });
                setEditing(null);
              }}
            >
              <HandoffFields
                current={editing.assignment}
                members={members}
                actorId={team.data.actorId}
                locale={locale}
              />
            </CommandForm>
          ) : null}
        </FormDialog>
      ) : null}
    </>
  );
}

function HandoffFields(props: {
  current: typeof Workspace.Assignment.Type | null;
  members: (typeof Workspace.Coordination.Type)["members"];
  actorId: string;
  locale: "en" | "sv";
}) {
  const { current, members, locale } = props;
  const sv = locale === "sv";
  const member = members.find((item) => item.id === current?.assigneeId);
  return (
    <>
      {" "}
      <SelectField
        name="assignee"
        label={sv ? "Ansvarig" : "Assigned to"}
        defaultValue={current?.assigneeId ?? ""}
        options={[
          { value: "", label: sv ? "Ingen tilldelning" : "Unassigned" },
          ...(current?.assigneeId && !member
            ? [
                {
                  value: current.assigneeId,
                  label: sv
                    ? "Ej längre medlem — välj en annan"
                    : "Member unavailable — choose someone else",
                },
              ]
            : []),
          ...members.map((item) => ({
            value: item.id,
            label: `${item.name}${item.id === props.actorId ? (sv ? " (jag)" : " (me)") : ""}`,
          })),
        ]}
      />
      <InputField
        name="dueOn"
        type="date"
        label={sv ? "Klart senast (valfritt)" : "Due date (optional)"}
        defaultValue={current?.dueOn ?? ""}
      />
      <TextareaField
        name="note"
        label={sv ? "Överlämningsanteckning" : "Handoff note"}
        defaultValue={current?.note ?? ""}
        rows={4}
        maxLength={2000}
      />
      <PageCaption>
        {sv
          ? "Synligt för dem som har tillgång till boken. Tilldelning ändrar inga behörigheter eller bokföringsbeslut."
          : "Visible to people with access to this book. Assignment changes no permissions or accounting decisions."}
      </PageCaption>
      {current ? (
        <PageCaption>
          {sv ? "Senast ändrad" : "Last updated"}{" "}
          {new Intl.DateTimeFormat(locale, {
            dateStyle: "medium",
            timeStyle: "short",
          }).format(new Date(current.updatedAt))}
        </PageCaption>
      ) : null}
    </>
  );
}
