import { useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import * as Commerce from "@open-erp/contracts/commerce";
import * as Sources from "@open-erp/contracts/source-intake";
import { Plus, Upload } from "lucide-react";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { FormDialog } from "@open-erp/ui/components/form-dialog";
import {
  PageCaption,
  PageEmpty,
  RecordOpen,
  RegisterSearch,
} from "@open-erp/ui/components/accounting-page";
import { AccountingStatus } from "@/components/accounting-status";
import { DocumentUpload } from "@/components/document-inbox";
import { bookKey, bookPath, readAccounting } from "@/lib/accounting-api";
import { ContactEditor } from "./contact-editor";
import { checkScope, commerceKey, commercePath, type CommerceProps } from "./shared";

export function SupplierPicker(
  props: CommerceProps & {
    selected?: typeof Commerce.CounterpartyRevision.Type;
    onSelect: (party: typeof Commerce.CounterpartyRevision.Type) => void;
  },
) {
  const sv = props.locale === "sv";
  const [search, setSearch] = useState("");
  const [choosing, setChoosing] = useState(!props.selected);
  const [creating, setCreating] = useState(false);
  const contacts = useInfiniteQuery({
    queryKey: [...commerceKey(props.book), "contact-options"],
    initialPageParam: "",
    queryFn: async ({ pageParam, signal }) => {
      const page = await readAccounting(
        `${commercePath(props.book)}/counterparties${pageParam ? `?after=${encodeURIComponent(pageParam)}` : ""}`,
        Commerce.CounterpartyPage,
        { signal },
      );
      page.items.forEach((party) => checkScope(props.book, party.scope));
      return page;
    },
    getNextPageParam: (page) => page.next ?? undefined,
    retry: false,
  });
  const matches =
    contacts.data?.pages
      .flatMap((page) => page.items)
      .filter(
        (party) =>
          (party.role === "supplier" || party.role === "both") &&
          `${party.displayName} ${party.externalKey}`
            .toLocaleLowerCase(props.locale)
            .includes(search.toLocaleLowerCase(props.locale)),
      ) ?? [];
  return (
    <Box display="grid" gap="md">
      {choosing ? (
        <>
          <RegisterSearch
            aria-label={sv ? "Sök leverantör" : "Search suppliers"}
            placeholder={sv ? "Sök namn eller referens…" : "Search name or reference…"}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <AccountingStatus
            locale={props.locale}
            pending={contacts.isPending}
            error={contacts.error}
          />
          {contacts.isSuccess ? (
            <Box display="grid" gap="xs">
              {matches.slice(0, 6).map((party) => (
                <RecordOpen
                  key={party.id}
                  onClick={() => {
                    props.onSelect(party);
                    setChoosing(false);
                  }}
                >
                  {party.displayName}
                </RecordOpen>
              ))}
              {!matches.length ? (
                <PageCaption>
                  {sv
                    ? "Ingen leverantör matchar bland inlästa kontakter."
                    : "No suppliers match among loaded contacts."}
                </PageCaption>
              ) : null}
              {matches.length > 6 ? (
                <PageCaption>
                  {sv
                    ? "Förfina sökningen för fler träffar."
                    : "Refine your search to find more matches."}
                </PageCaption>
              ) : null}
            </Box>
          ) : null}
          <Box display="flex" gap="md" flexWrap="wrap">
            <Button type="button" variant="ghost" onClick={() => setCreating(true)}>
              <Plus size={14} />
              {sv ? "Ny leverantör" : "New supplier"}
            </Button>
            {contacts.hasNextPage ? (
              <Button
                type="button"
                variant="ghost"
                disabled={contacts.isFetching}
                onClick={() => {
                  void contacts.fetchNextPage();
                }}
              >
                {sv ? "Läs in fler kontakter" : "Load more contacts"}
              </Button>
            ) : null}
            {props.selected ? (
              <Button type="button" variant="ghost" onClick={() => setChoosing(false)}>
                {sv ? "Avbryt byte" : "Cancel change"}
              </Button>
            ) : null}
            {contacts.isError ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  void contacts.refetch();
                }}
              >
                {sv ? "Försök igen" : "Retry"}
              </Button>
            ) : null}
          </Box>
        </>
      ) : (
        <Box display="flex" alignItems="center" justifyContent="between" gap="md">
          <strong>{props.selected?.displayName}</strong>
          <Button type="button" variant="ghost" onClick={() => setChoosing(true)}>
            {sv ? "Byt leverantör" : "Change supplier"}
          </Button>
        </Box>
      )}
      {creating ? (
        <FormDialog
          title={sv ? "Ny leverantör" : "New supplier"}
          closeLabel={sv ? "Stäng" : "Close"}
          size="compact"
          onClose={() => setCreating(false)}
        >
          <ContactEditor
            {...props}
            defaultRole="supplier"
            onSaved={(party) => {
              if (party.role !== "customer") {
                props.onSelect(party);
                setChoosing(false);
              }
              setCreating(false);
            }}
          />
        </FormDialog>
      ) : null}
    </Box>
  );
}

export function SupplierDocumentPicker(props: CommerceProps & { onSelect: (id: string) => void }) {
  const sv = props.locale === "sv";
  const [search, setSearch] = useState("");
  const [uploading, setUploading] = useState(false);
  const documents = useInfiniteQuery({
    queryKey: [...bookKey(props.book), "document-inbox"],
    initialPageParam: "",
    queryFn: async ({ pageParam, signal }) => {
      const page = await readAccounting(
        `${bookPath(props.book)}/source-occurrences${pageParam ? `?cursor=${encodeURIComponent(pageParam)}` : ""}`,
        Sources.SourceInventory,
        { signal },
      );
      page.items.forEach((item) => checkScope(props.book, item.occurrence.scope));
      return page;
    },
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    retry: false,
  });
  const matches =
    documents.data?.pages
      .flatMap((page) => page.items)
      .filter(({ occurrence }) =>
        occurrence.filename
          .toLocaleLowerCase(props.locale)
          .includes(search.toLocaleLowerCase(props.locale)),
      ) ?? [];
  return (
    <Box display="grid" gap="lg">
      <PageCaption>
        {sv
          ? "Välj originalfakturan. Den visas bredvid uppgifterna du granskar."
          : "Choose the original invoice. It stays beside the details you review."}
      </PageCaption>
      <Box>
        <Button type="button" onClick={() => setUploading(true)}>
          <Upload size={14} />
          {sv ? "Ladda upp faktura" : "Upload invoice"}
        </Button>
      </Box>
      <RegisterSearch
        aria-label={sv ? "Sök original" : "Search originals"}
        placeholder={sv ? "Sök bland sparade dokument…" : "Search saved documents…"}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <AccountingStatus
        locale={props.locale}
        pending={documents.isPending}
        error={documents.error}
      />
      {documents.isSuccess ? (
        <Box display="grid" gap="sm">
          {matches.slice(0, 12).map(({ occurrence }) => (
            <RecordOpen key={occurrence.id} onClick={() => props.onSelect(occurrence.id)}>
              {occurrence.filename}
            </RecordOpen>
          ))}
          {!matches.length ? (
            <PageEmpty
              title={sv ? "Inga matchande dokument" : "No matching documents"}
              detail={
                sv
                  ? "Ladda upp originalet eller sök på ett annat filnamn."
                  : "Upload the original or search for another filename."
              }
            />
          ) : null}
          {matches.length > 12 ? (
            <PageCaption>
              {sv
                ? "Förfina sökningen för fler träffar."
                : "Refine your search to find more matches."}
            </PageCaption>
          ) : null}
        </Box>
      ) : null}
      {documents.hasNextPage ? (
        <Box>
          <Button
            type="button"
            variant="outline"
            disabled={documents.isFetching}
            onClick={() => {
              void documents.fetchNextPage();
            }}
          >
            {sv ? "Läs in fler dokument" : "Load more documents"}
          </Button>
        </Box>
      ) : null}
      {documents.isError ? (
        <Box>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              void documents.refetch();
            }}
          >
            {sv ? "Försök igen" : "Retry"}
          </Button>
        </Box>
      ) : null}
      {uploading ? (
        <FormDialog
          title={sv ? "Ladda upp faktura" : "Upload invoice"}
          closeLabel={sv ? "Stäng" : "Close"}
          size="compact"
          onClose={() => setUploading(false)}
        >
          <DocumentUpload onSaved={props.onSelect} />
        </FormDialog>
      ) : null}
    </Box>
  );
}
