import { useRef, useState } from "react";
import { infiniteQueryOptions, useInfiniteQuery, useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import * as Commerce from "@open-erp/contracts/commerce";
import * as Crm from "@open-erp/contracts/crm-master";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Schema from "effect/Schema";
import { Plus, ArrowLeft } from "lucide-react";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { DataTable } from "@open-erp/ui/components/data-table";
import { Text } from "@open-erp/ui/components/typography";
import { Badge } from "@open-erp/ui/components/badge";
import { InputField, TextareaField } from "@open-erp/ui/components/field";
import { ChoiceField } from "@open-erp/ui/components/choice-field";
import { useSavedPostingRequests } from "@/components/posting-recovery/saved-requests";
import { sendSavedPostingCommand } from "@/components/posting-recovery/request";
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

export function counterpartyRegisterOptions(book: CommerceProps["book"], search = "", role = "") {
  return infiniteQueryOptions({
    queryKey: [...commerceKey(book), "crm-directory", search, role],
    initialPageParam: "",
    queryFn: async ({ signal, pageParam }) => {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (role) params.set("role", role);
      if (pageParam) params.set("after", pageParam);
      const result = await readAccounting(
        `${commercePath(book)}/directory?${params}`,
        Crm.DirectoryPage,
        { signal },
      );
      result.items.forEach(({ party }) => checkScope(book, party.scope));
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
  const [draft, setDraft] = useState("");
  const [role, setRole] = useState(props.defaultRole ?? "");
  const selected = props.recordId ?? local;
  const select = props.onOpen ?? setLocal;
  const page = useInfiniteQuery({
    ...counterpartyRegisterOptions(book, search, role),
    enabled: !selected || selected === "new",
  });
  const roles = {
    customer: labels.customer,
    supplier: labels.supplier,
    both: labels.customerSupplier,
  };
  const items = page.data?.pages.flatMap((batch) => batch.items) ?? [];
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
          value={draft}
          maxLength={200}
          onChange={(e) => setDraft(e.target.value)}
        />
        <Button size="sm" variant="outline" onClick={() => setSearch(draft.trim())}>{sv ? "Sök" : "Search"}</Button>
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
              rows={items.map(({ party }) => ({
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
          <Annotations {...props} partyId={props.id} partyName={party.data.displayName} />
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

function Annotations({ book, locale, partyId, partyName }: CommerceProps & { partyId: string; partyName: string }) {
  const sv = locale === "sv";
  const client = useQueryClient();
  const requests = useSavedPostingRequests(book);
  const [key, setKey] = useState(() => crypto.randomUUID());
  const evidenceId = useRef<string | null>(null);
  const [open, setOpen] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const directory = useQuery({
    queryKey: [...commerceKey(book), "crm-directory", "detail", partyId, partyName],
    queryFn: async ({ signal }) => {
      let after: string | null = null;
      do {
        const params = new URLSearchParams({ search: partyName });
        if (after) params.set("after", after);
        const result = await readAccounting(`${commercePath(book)}/directory?${params}`, Crm.DirectoryPage, { signal });
        const entry = result.items.find((item) => item.party.id === partyId);
        if (entry) return entry.annotations;
        after = result.next;
      } while (after);
      throw new Error(sv ? "Kontakten finns inte i katalogen." : "Contact not found in directory.");
    },
    retry: false,
  });
  const save = useMutation({
    mutationFn: async (input: { kind: "contact" | "alias" | "registry_provenance"; label: string; detail: string }) => {
      if (!requests.data || requests.isError) throw new Error(sv ? "Behörigheten kunde inte läsas." : "Your access could not be loaded.");
      const source = evidenceId.current ? null : await sendSavedPostingCommand({
        book, actorId: requests.data.actorId,
        command: { operation: "create_evidence", input: {
          title: input.label, origin: "Directory annotation entered in OpenERP",
          mediaType: "application/json", content: JSON.stringify(input),
        } },
        storageMessage: sv ? "Tillåt lokal lagring för att spara uppgiften." : "Allow local storage to save this detail.",
      });
      if (source) {
        if (source.outcome?.state !== "committed" || !Schema.is(Accounting.Evidence)(source.outcome.result))
          throw new Error(sv ? "Underlaget är inte bekräftat. Försök igen." : "The source is not confirmed. Retry the save.");
        evidenceId.current = source.outcome.result.id;
      }
      if (!evidenceId.current) throw new Error(sv ? "Underlag saknas." : "Evidence is missing.");
      return readAccounting(`${commercePath(book)}/directory/annotations`, Crm.Annotation, {
        method: "POST", headers: { "Idempotency-Key": key },
        body: JSON.stringify(Schema.decodeSync(Crm.AddAnnotation)({ ...input, partyId, evidenceId: evidenceId.current })),
      });
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: [...commerceKey(book), "crm-directory"] });
      setKey(crypto.randomUUID());
      evidenceId.current = null;
      setOpen(false);
    }, retry: false,
  });
  return <RecordSection title={sv ? "Kontakter, alias och ursprung" : "Contacts, aliases & provenance"}>
    <PageCaption>{sv ? "Anteckningar är operatörens uppgifter med sparat underlag. Registeridentitet är inte verifierad." : "These are operator-supplied notes with retained evidence. Registry identity is not verified."}</PageCaption>
    <AccountingStatus locale={locale} pending={directory.isPending} error={directory.error} />
    {directory.data?.map((note) => <Box key={note.id} display="grid" gap="xs">
      <Text>{note.label} — {note.kind === "contact" ? (sv ? "Kontakt" : "Contact") : note.kind === "alias" ? (sv ? "Alias" : "Alias") : (sv ? "Registeruppgift" : "Registry provenance")}</Text>
      <Text tone="muted">{note.detail}</Text>
      <PageCaption>{sv ? "Underlag" : "Evidence"}: {note.evidenceId} · {note.recordedAt}</PageCaption>
    </Box>)}
    {directory.isSuccess && !directory.data.length ? <PageCaption>{sv ? "Inga uppgifter tillagda." : "No details added."}</PageCaption> : null}
    {book.role === "operator" ? <Box><Button variant="outline" onClick={() => setOpen(true)}>{sv ? "Lägg till uppgift" : "Add detail"}</Button></Box> : null}
    {open ? <FormDialog title={sv ? "Lägg till uppgift" : "Add detail"} size="compact" closeLabel={sv ? "Stäng" : "Close"} onClose={() => setOpen(false)}>
      <Box as="form" display="grid" gap="lg" onSubmit={(event) => {
        event.preventDefault();
        if (save.isPending || save.isSuccess) return;
        const fields = new FormData(event.currentTarget);
        const parsed = Schema.decodeUnknownOption(Crm.AddAnnotation)({ partyId, kind: fields.get("kind"), label: fields.get("label"), detail: fields.get("detail"), evidenceId: "pending" });
        setInvalid(parsed._tag === "None");
        if (parsed._tag === "Some") save.mutate({ kind: parsed.value.kind, label: parsed.value.label, detail: parsed.value.detail });
      }}>
        <Box as="fieldset" disabled={save.isPending || save.isError} display="grid" gap="lg" borderWidth="none" margin="none" padding="none">
        <ChoiceField name="kind" label={sv ? "Typ" : "Type"} defaultValue="contact" options={[
          { value: "contact", label: sv ? "Kontakt" : "Contact" },
          { value: "alias", label: "Alias" },
          { value: "registry_provenance", label: sv ? "Registeruppgift" : "Registry provenance" },
        ]} />
        <InputField name="label" label={sv ? "Rubrik" : "Label"} required maxLength={200} />
        <TextareaField name="detail" label={sv ? "Detaljer" : "Details"} required maxLength={2000} rows={3} />
        </Box>
        {invalid ? <PageCaption>{sv ? "Kontrollera uppgifterna." : "Check the details."}</PageCaption> : null}
        <AccountingStatus locale={locale} write pending={save.isPending} error={save.error ?? requests.error} />
        {save.isError && save.variables ? <Button type="button" variant="outline" onClick={() => save.mutate(save.variables)}>{sv ? "Försök igen" : "Retry save"}</Button> :
          <Button type="submit" disabled={requests.isPending || requests.isError || save.isPending}>{sv ? "Spara uppgift" : "Save detail"}</Button>}
      </Box>
    </FormDialog> : null}
  </RecordSection>;
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
