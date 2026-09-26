import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as Workspace from "@open-erp/contracts/workspace";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { InputField, SelectField } from "@open-erp/ui/components/field";
import { ChoiceField } from "@open-erp/ui/components/choice-field";
import { FormDialog } from "@open-erp/ui/components/form-dialog";
import { PageCaption } from "@open-erp/ui/components/accounting-page";
import { AccountingStatus } from "./accounting-status";
import { CommandForm } from "./commerce/shared";
import { useBookWorkspace } from "@/lib/book-context";
import { bookKey, bookPath } from "@/lib/accounting-api";
import { coordinationOptions, savedFilters } from "@/lib/workspace-coordination";

export function SavedWorkViews(props: {
  filters: typeof Workspace.AttentionQuery.Type;
  onSelect: (filters: typeof Workspace.AttentionQuery.Type) => void;
}) {
  const context = useBookWorkspace();
  const { book, locale } = context;
  const sv = locale === "sv";
  const query = useQuery(coordinationOptions(book));
  const client = useQueryClient();
  const [dialog, setDialog] = useState<"save" | "remove" | null>(null);
  const current = savedFilters(props.filters);
  const views = query.isError ? [] : (query.data?.views ?? []);

  const selected = views.find(
    (view) => JSON.stringify(savedFilters(view.filters)) === JSON.stringify(current),
  );

  const close = () => setDialog(null);

  const saved = () => {
    void client.invalidateQueries({ queryKey: bookKey(book) });
    close();
  };

  return (
    <Box display="grid" gap="md">
      <Box display="flex" alignItems="end" flexWrap="wrap" gap="md">
        {views.length ? (
          <Box width="fit" flexShrink={false}>
            <SelectField
              label={sv ? "Sparade vyer" : "Saved views"}
              value={selected?.id ?? ""}
              disabled={!query.isSuccess}
              onValueChange={(value) => {
                const view = views.find((item) => item.id === value);

                if (view) props.onSelect(view.filters);
              }}
              options={[
                { value: "", label: sv ? "Aktuella filter" : "Current filters" },
                ...views.map((view) => ({
                  value: view.id,
                  label: `${view.name}${view.visibility === "team" ? " · Team" : ""}`,
                })),
              ]}
            />
          </Box>
        ) : null}
        <Button
          static
          variant="ghost"
          disabled={!query.isSuccess}
          onClick={() => setDialog("save")}
        >
          {sv ? "Spara vy" : "Save view"}
        </Button>
        {selected?.ownerId === query.data?.actorId && selected ? (
          <Button static variant="ghost" onClick={() => setDialog("remove")}>
            {sv ? "Ta bort vy" : "Remove view"}
          </Button>
        ) : null}
      </Box>
      <AccountingStatus locale={locale} pending={query.isPending} error={query.error} />
      {query.isError ? (
        <Button
          variant="outline"
          onClick={() => {
            void query.refetch();
          }}
        >
          {sv ? "Försök igen" : "Retry saved views"}
        </Button>
      ) : null}
      {dialog === "save" ? (
        <FormDialog
          size="compact"
          title={sv ? "Spara den här vyn" : "Save this view"}
          closeLabel={sv ? "Stäng" : "Close"}
          onClose={close}
        >
          <CommandForm
            {...context}
            path={`${bookPath(book)}/workspace/views`}
            schema={Workspace.SaveView}
            output={Workspace.SavedViewResult}
            label={sv ? "Spara vy" : "Save view"}
            input={(fields) => ({
              name: fields.get("name"),
              visibility: fields.get("visibility"),
              filters: current,
            })}
            onSuccess={saved}
          >
            <ViewFields sv={sv} operator={book.role === "operator"} />
          </CommandForm>
        </FormDialog>
      ) : null}
      {dialog === "remove" && selected ? (
        <FormDialog
          size="compact"
          title={selected.name}
          closeLabel={sv ? "Stäng" : "Close"}
          onClose={close}
        >
          <CommandForm
            {...context}
            path={`${bookPath(book)}/workspace/views/remove`}
            schema={Workspace.DeleteView}
            output={Workspace.DeletedView}
            label={sv ? "Ta bort sparad vy" : "Remove saved view"}
            input={() => ({ id: selected.id })}
            onSuccess={saved}
          >
            <PageCaption>
              {sv
                ? "Tar bort den sparade vyn. Posterna och deras historik finns kvar."
                : "Removes this saved view. Its records and their history remain available."}
            </PageCaption>
          </CommandForm>
        </FormDialog>
      ) : null}
    </Box>
  );
}

function ViewFields({ sv, operator }: { sv: boolean; operator: boolean }) {
  return (
    <>
      {" "}
      <InputField
        name="name"
        label={sv ? "Namn" : "Name"}
        required
        maxLength={80}
        placeholder={sv ? "Till exempel Utgifter att granska" : "For example, Expenses to review"}
      />
      <ChoiceField
        name="visibility"
        label={sv ? "Synlig för" : "Visible to"}
        defaultValue="personal"
        options={[
          { value: "personal", label: sv ? "Bara mig" : "Only me" },
          ...(operator
            ? [
                {
                  value: "team",
                  label: sv ? "Alla i den här boken" : "Everyone in this book",
                },
              ]
            : []),
        ]}
      />
      <PageCaption>
        {sv
          ? "Sparar dina sök-, period-, status- och sorteringsfilter. Nya poster visas när de matchar."
          : "Saves your search, period, status and sort filters. New records appear when they match."}
      </PageCaption>
    </>
  );
}
