import { useRef, useState, type ReactNode } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { FormDialog } from "@open-erp/ui/components/form-dialog";
import { ContactRegister } from "@open-erp/ui/components/contact-register";
import { RegisterWorkspace } from "@open-erp/ui/components/register-workspace";
import { PageCaption, PageEmpty, RegisterSearch } from "@open-erp/ui/components/accounting-page";
import { AccountingStatus } from "@/components/accounting-status";
import {
  ContactDetail,
  counterpartyRegisterOptions,
  counterpartyExportOptions,
} from "./counterparties";
import { downloadIntake } from "@/components/source-intake/download";
import { ContactEditor } from "./contact-editor";
import type { CommerceProps } from "./shared";

export function CounterpartyRegister(
  props: CommerceProps & {
    title: string;
    navigation: ReactNode;
    role: "customer" | "supplier";
    recordId?: string;
    onOpen: (id: string) => void;
  },
) {
  const sv = props.locale === "sv";

  const roles = sv
    ? { customer: "Kund", supplier: "Leverantör", both: "Kund och leverantör" }
    : { customer: "Customer", supplier: "Supplier", both: "Customer & supplier" };

  const newContactRef = useRef<HTMLButtonElement>(null);
  const [draft, setDraft] = useState("");
  const [search, setSearch] = useState("");

  const [lastSelection, setLastSelection] = useState(
    props.recordId !== "new" ? props.recordId : undefined,
  );

  const page = useInfiniteQuery(counterpartyRegisterOptions(props.book, search, props.role));
  const directoryExport = useQuery(counterpartyExportOptions(props.book, search, props.role));
  const items = page.isError ? [] : (page.data?.pages.flatMap((batch) => batch.items) ?? []);

  const selected =
    props.recordId && props.recordId !== "new"
      ? props.recordId
      : (lastSelection ?? items[0]?.party.id);

  const creating = props.recordId === "new";

  const newLabel = (
    sv
      ? { customer: "Ny kund", supplier: "Ny leverantör" }
      : { customer: "New customer", supplier: "New supplier" }
  )[props.role];

  return (
    <RegisterWorkspace
      title={props.title}
      tabs={props.navigation}
      action={
        <Button
          ref={newContactRef}
          disabled={props.book.role !== "operator"}
          onClick={() => {
            setLastSelection(selected);
            props.onOpen("new");
          }}
        >
          {newLabel}
        </Button>
      }
      filters={
        <Box
          as="form"
          display="flex"
          alignItems="center"
          gap="sm"
          flexWrap="wrap"
          onSubmit={(event) => {
            event.preventDefault();
            setSearch(draft.trim());
            setLastSelection(undefined);
            props.onOpen("");
          }}
        >
          <RegisterSearch
            compact
            aria-label={sv ? "Sök kontakter" : "Search contacts"}
            placeholder={sv ? "Sök namn eller referens" : "Search name or reference"}
            value={draft}
            maxLength={200}
            onChange={(event) => setDraft(event.target.value)}
          />
          <Button variant="outline" type="submit">
            {sv ? "Sök" : "Search"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={directoryExport.isFetching}
            onClick={() =>
              void directoryExport.refetch().then((result) => {
                if (result.isSuccess)
                  downloadIntake(
                    new Blob([JSON.stringify(result.data, null, 2)], { type: "application/json" }),
                    `crm-directory-${props.book.id}.json`,
                  );
              })
            }
          >
            {sv ? "Exportera katalog" : "Export directory"}
          </Button>
        </Box>
      }
      detail={
        selected ? (
          <ContactDetail
            compact
            key={selected}
            book={props.book}
            locale={props.locale}
            id={selected}
          />
        ) : (
          <PageCaption>
            {sv
              ? "Välj en kontakt för att se uppgifterna."
              : "Select a contact to see its details."}
          </PageCaption>
        )
      }
    >
      <AccountingStatus locale={props.locale} pending={page.isPending} error={page.error} />
      <AccountingStatus
        locale={props.locale}
        pending={directoryExport.isFetching}
        error={directoryExport.error}
      />
      <ContactRegister
        labels={{
          name: roles[props.role],
          role: sv ? "Typ" : "Type",
          reference: sv ? "Referens" : "Reference",
        }}
        rows={items.map(({ party }) => ({
          id: party.id,
          name: party.displayName,
          role: roles[party.role],
          reference: party.externalKey,
        }))}
        selected={selected}
        onSelect={(id) => {
          setLastSelection(id);
          props.onOpen(id);
        }}
      />
      {page.isSuccess && !items.length ? (
        <Box padding="lg">
          <PageEmpty
            title={sv ? "Inga matchande kontakter" : "No matching contacts"}
            detail={
              sv
                ? "Ändra sökningen eller lägg till en kontakt."
                : "Change your search or add a contact."
            }
          />
        </Box>
      ) : null}
      {page.hasNextPage ? (
        <Box padding="lg">
          <Button
            variant="outline"
            disabled={page.isFetchingNextPage}
            onClick={() => void page.fetchNextPage()}
          >
            {sv ? "Läs in fler kontakter" : "Load more contacts"}
          </Button>
        </Box>
      ) : null}
      {creating ? (
        <FormDialog
          finalFocus={newContactRef}
          size="compact"
          title={newLabel}
          closeLabel={sv ? "Stäng" : "Close"}
          onClose={() => props.onOpen(selected ?? "")}
          onEscape={() => props.onOpen(selected ?? "")}
        >
          <ContactEditor
            book={props.book}
            locale={props.locale}
            defaultRole={props.role}
            onSaved={(party) => props.onOpen(party.id)}
          />
        </FormDialog>
      ) : null}
    </RegisterWorkspace>
  );
}
