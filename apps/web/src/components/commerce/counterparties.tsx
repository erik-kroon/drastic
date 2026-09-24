import { useState } from "react";
import { infiniteQueryOptions, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import * as Commerce from "@open-erp/contracts/commerce";
import { Plus, ArrowLeft } from "lucide-react";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { DataTable } from "@open-erp/ui/components/data-table";
import { Text } from "@open-erp/ui/components/typography";
import { Badge } from "@open-erp/ui/components/badge";
import { FormDialog } from "@open-erp/ui/components/form-dialog";
import {
  PageEmpty,
  RegisterFilters,
  RegisterChoices,
  RegisterSearch,
  RecordOpen,
  PageCaption,
} from "@open-erp/ui/components/accounting-page";
import {
  RecordHeading,
  RecordSection,
  RecordSummary,
  RecordFact,
} from "@open-erp/ui/components/record-layout";
import { AccountingStatus } from "@/components/accounting-status";
import { ContactEditor } from "./contact-editor";
import { readAccounting } from "@/lib/accounting-api";
import {
  Details,
  Evidence,
  Facts,
  checkScope,
  commerceKey,
  commercePath,
  type CommerceProps,
} from "./shared";

export function counterpartyRegisterOptions(book: CommerceProps["book"]) {
  return infiniteQueryOptions({
    queryKey: [...commerceKey(book), "counterparty-register"],
    initialPageParam: "",
    queryFn: async ({ signal, pageParam }) => {
      const result = await readAccounting(
        `${commercePath(book)}/counterparties${pageParam ? `?after=${encodeURIComponent(pageParam)}` : ""}`,
        Commerce.CounterpartyPage,
        { signal },
      );
      result.items.forEach((party) => checkScope(book, party.scope));
      return result;
    },
    getNextPageParam: (last) => last.next ?? undefined,
    retry: false,
  });
}

export function Counterparties(
  props: CommerceProps & {
    recordId?: string;
    onOpen?: (id: string) => void;
    defaultRole?: "customer" | "supplier";
  },
) {
  const { book, locale } = props;
  const sv = locale === "sv";
  const labels = sv ? swedish : english;
  const [local, setLocal] = useState("");
  const [search, setSearch] = useState("");
  const [role, setRole] = useState(props.defaultRole ?? "");
  const selected = props.recordId ?? local;
  const select = props.onOpen ?? setLocal;
  const page = useInfiniteQuery({
    ...counterpartyRegisterOptions(book),
    enabled: !selected || selected === "new",
  });
  const roles = {
    customer: labels.customer,
    supplier: labels.supplier,
    both: labels.customerSupplier,
  };
  const items =
    page.data?.pages
      .flatMap((batch) => batch.items)
      .filter(
        (party) =>
          (!role || party.role === role || party.role === "both") &&
          `${party.displayName} ${party.externalKey}`
            .toLocaleLowerCase(locale)
            .includes(search.toLocaleLowerCase(locale)),
      )
      .toSorted((a, b) => a.displayName.localeCompare(b.displayName, locale)) ?? [];
  if (selected && selected !== "new")
    return (
      <Box display="grid" gap="xl">
        <Box>
          <Button variant="ghost" onClick={() => select("")}>
            <ArrowLeft size={14} />
            {labels.allContacts}
          </Button>
        </Box>
        <ContactDetail {...props} id={selected} />
      </Box>
    );
  return (
    <Box display="grid" gap="xl">
      <RecordHeading
        title={
          role === "customer"
            ? sv
              ? "Kunder"
              : "Customers"
            : role === "supplier"
              ? sv
                ? "Leverantörer"
                : "Suppliers"
              : labels.customersSuppliers
        }
        subtitle={labels.yourContactsAndTheirSource}
        action={
          <Button onClick={() => select("new")}>
            <Plus size={14} />
            {labels.newContact}
          </Button>
        }
      />
      <RegisterFilters>
        <RegisterSearch
          aria-label={labels.searchContacts}
          placeholder={labels.searchNameOrReference}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <RegisterChoices
          label={labels.contactType}
          value={role}
          onValueChange={(value) => setRole(value ?? "")}
          options={[
            { value: "", label: labels.allContacts },
            { value: "customer", label: roles.customer },
            { value: "supplier", label: roles.supplier },
          ]}
        />
      </RegisterFilters>
      <AccountingStatus locale={locale} pending={page.isPending} error={page.error} />
      {page.isSuccess ? (
        <>
          {items.length ? (
            <DataTable
              title={labels.contacts}
              narrow="stack"
              columns={[
                { id: "name", label: labels.name },
                { id: "type", label: labels.type },
                { id: "reference", label: labels.reference },
              ]}
              rows={items.map((party) => ({
                id: party.id,
                cells: [
                  <RecordOpen key="name" onClick={() => select(party.id)}>
                    {party.displayName}
                  </RecordOpen>,
                  <Badge key="role" variant="secondary">
                    {roles[party.role]}
                  </Badge>,
                  party.externalKey,
                ],
              }))}
            />
          ) : (
            <PageEmpty
              title={search || role ? labels.noMatchingContacts : labels.yourContactsStartHere}
              detail={labels.addCustomersAndSuppliersTo}
            />
          )}
          {page.hasNextPage ? (
            <Box display="grid" gap="sm">
              <PageCaption>
                {sv
                  ? "Sökningen gäller inlästa kontakter. Läs in fler för att utöka sökningen."
                  : "Search covers loaded contacts. Load more to extend the search."}
              </PageCaption>
              <Box>
                <Button
                  variant="outline"
                  disabled={page.isFetchingNextPage}
                  onClick={() => void page.fetchNextPage()}
                >
                  {sv ? "Läs in fler kontakter" : "Load more contacts"}
                </Button>
              </Box>
            </Box>
          ) : null}
        </>
      ) : null}
      {selected === "new" ? (
        <FormDialog
          size="compact"
          title={labels.newContact}
          closeLabel={labels.close}
          onClose={() => select("")}
        >
          <ContactEditor
            {...props}
            defaultRole={role === "supplier" ? "supplier" : "customer"}
            onSaved={(party) => select(party.id)}
          />
        </FormDialog>
      ) : null}
    </Box>
  );
}
function ContactDetail(props: CommerceProps & { id: string }) {
  const sv = props.locale === "sv";
  const labels = sv ? swedish : english;
  const [editing, setEditing] = useState(false);
  const party = useQuery({
    queryKey: [...commerceKey(props.book), "counterparty", props.id, ""],
    queryFn: async ({ signal }) => {
      const result = await readAccounting(
        `${commercePath(props.book)}/counterparties/${encodeURIComponent(props.id)}`,
        Commerce.CounterpartyRevision,
        { signal },
      );
      checkScope(props.book, result.scope);
      if (result.id !== props.id) throw new Error("Contact identity mismatch");
      return result;
    },
    retry: false,
  });
  return (
    <Box display="grid" gap="xl">
      <AccountingStatus locale={props.locale} pending={party.isPending} error={party.error} />
      {party.isSuccess ? (
        <>
          <RecordHeading
            title={party.data.displayName}
            subtitle={party.data.externalKey}
            action={
              <Button variant="outline" onClick={() => setEditing(true)}>
                {labels.editContact}
              </Button>
            }
          />
          <RecordSummary>
            <RecordFact label={labels.type}>
              {party.data.role === "customer"
                ? labels.customer
                : party.data.role === "supplier"
                  ? labels.supplier
                  : labels.customerSupplier2}
            </RecordFact>
            <RecordFact label={labels.updated}>
              {new Intl.DateTimeFormat(props.locale, { dateStyle: "medium" }).format(
                new Date(party.data.createdAt),
              )}
            </RecordFact>
          </RecordSummary>
          <Text>{party.data.reason}</Text>
          <RecordSection title={labels.source}>
            <Evidence {...props} reference={party.data.evidence} />
          </RecordSection>
          <Details title={labels.historyReferences}>
            <Facts title={labels.savedDetails} value={party.data} />
            <PageCaption>{labels.changesAreRetainedAsNew}</PageCaption>
          </Details>
          {editing ? (
            <FormDialog
              title={labels.editContact}
              size="compact"
              closeLabel={labels.close}
              onClose={() => setEditing(false)}
            >
              <ContactEditor {...props} baseline={party.data} onSaved={() => setEditing(false)} />
            </FormDialog>
          ) : null}
        </>
      ) : null}
    </Box>
  );
}

const english = {
  customer: "Customer",
  supplier: "Supplier",
  customerSupplier: "Customer & supplier",
  allContacts: "All contacts",
  customersSuppliers: "Customers & suppliers",
  yourContactsAndTheirSource: "Your contacts and their source records, in one place.",
  newContact: "New contact",
  searchContacts: "Search contacts",
  searchNameOrReference: "Search name or reference…",
  contactType: "Contact type",
  contacts: "Contacts",
  name: "Name",
  type: "Type",
  reference: "Reference",
  noMatchingContacts: "No matching contacts",
  yourContactsStartHere: "Your contacts start here",
  addCustomersAndSuppliersTo: "Add customers and suppliers to use them on invoices.",
  close: "Close",
  saveContact: "Save contact",
  contactDetails: "Contact details",
  both: "Both",
  customerNumberReferenceOptional: "Customer number / reference (optional)",
  note: "Note",
  sourceSaved: "Source saved:",
  editContact: "Edit contact",
  customerSupplier2: "Customer & supplier",
  updated: "Updated",
  source: "Source",
  historyReferences: "History & references",
  savedDetails: "Saved details",
  changesAreRetainedAsNew:
    "Changes are retained as new revisions. Legal identity has not been verified.",
};
const swedish: typeof english = {
  customer: "Kund",
  supplier: "Leverantör",
  customerSupplier: "Kund och leverantör",
  allContacts: "Alla kontakter",
  customersSuppliers: "Kunder & leverantörer",
  yourContactsAndTheirSource: "Kontaktuppgifter och källunderlag på ett ställe.",
  newContact: "Ny kontakt",
  searchContacts: "Sök kontakter",
  searchNameOrReference: "Sök namn eller referens…",
  contactType: "Kontakttyp",
  contacts: "Kontakter",
  name: "Namn",
  type: "Typ",
  reference: "Referens",
  noMatchingContacts: "Inga matchande kontakter",
  yourContactsStartHere: "Dina kontakter börjar här",
  addCustomersAndSuppliersTo: "Lägg till kunder och leverantörer för att använda dem i fakturor.",
  close: "Stäng",
  saveContact: "Spara kontakt",
  contactDetails: "Kontaktuppgifter",
  both: "Båda",
  customerNumberReferenceOptional: "Kundnummer / referens (valfritt)",
  note: "Anteckning",
  sourceSaved: "Underlag sparat:",
  editContact: "Redigera kontakt",
  customerSupplier2: "Kund & leverantör",
  updated: "Uppdaterad",
  source: "Underlag",
  historyReferences: "Historik & referenser",
  savedDetails: "Sparade uppgifter",
  changesAreRetainedAsNew:
    "Ändringar sparas som nya versioner. Juridisk identitet är inte verifierad.",
};
