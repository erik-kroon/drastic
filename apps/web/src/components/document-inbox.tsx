import { useRef, useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Schema from "effect/Schema";
import * as Sources from "@open-erp/contracts/source-intake";
import { ArrowLeft, Upload, Download, FileText } from "lucide-react";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { InputField } from "@open-erp/ui/components/field";
import { DataTable } from "@open-erp/ui/components/data-table";
import { FormDialog } from "@open-erp/ui/components/form-dialog";
import { DocumentPreview } from "@open-erp/ui/components/document-preview";
import { RecordHeading, RecordSplit, RecordSection } from "@open-erp/ui/components/record-layout";
import {
  PageEmpty,
  PageAction,
  PageCaption,
  RecordOpen,
} from "@open-erp/ui/components/accounting-page";
import { Text } from "@open-erp/ui/components/typography";
import { AccountingStatus } from "@/components/accounting-status";
import { useBookWorkspace, workspacePath } from "@/lib/book-context";
import { bookKey, bookPath, mutationOptions, readAccounting } from "@/lib/accounting-api";
import { downloadIntake } from "@/components/source-intake/download";

export function DocumentInbox({
  recordId,
  onOpen,
}: {
  recordId?: string;
  onOpen: (id: string) => void;
}) {
  const { book, locale } = useBookWorkspace();
  const sv = locale === "sv";
  const labels = sv ? swedish : english;
  const [filters, setFilters] = useState<typeof Sources.ArchiveFilters.Type>({});
  const [filterError, setFilterError] = useState<string | null>(null);
  const sources = useInfiniteQuery({
    queryKey: [...bookKey(book), "document-inbox", filters],
    initialPageParam: "",
    queryFn: async ({ pageParam, signal }) => {
      const result = await readAccounting(
        archivePath(`${bookPath(book)}/source-archive`, filters, pageParam),
        Sources.ArchiveSearch,
        { signal },
      );
       result.items.forEach((occurrence) => {
         if (occurrence.scope.bookId !== book.id || occurrence.scope.entityId !== book.entityId)
           throw new Error("Archive scope mismatch");
       });

      return result;
    },
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    retry: false,
  });
  const archiveExport = useMutation({
    mutationFn: async (applied: typeof Sources.ArchiveFilters.Type) => {
      const result = await readAccounting(
        archivePath(`${bookPath(book)}/source-archive/export`, applied),
        Sources.ArchiveExport,
      );
       if (result.scope.bookId !== book.id || result.scope.entityId !== book.entityId)
         throw new Error("Archive export scope mismatch");
       result.items.forEach(({ occurrence }) => {
         if (occurrence.scope.bookId !== book.id || occurrence.scope.entityId !== book.entityId)
           throw new Error("Archive export item scope mismatch");
       });

      return result;
    },
    onSuccess: (result) => {
      downloadIntake(
        new Blob([JSON.stringify(result, null, 2)], { type: "application/json" }),
        "source-archive-page.json",
      );
    },
  });
  const items = sources.data?.pages.flatMap((page) => page.items) ?? [];
  const hasFilters = Object.keys(filters).length > 0;
  if (recordId && recordId !== "new")
    return (
      <Box display="grid" gap="xl">
        <Box>
          <Button variant="ghost" onClick={() => onOpen("")}>
            <ArrowLeft size={14} />
            {labels.allDocuments}
          </Button>
        </Box>
        <DocumentDetail id={recordId} />
      </Box>
    );
  return (
    <Box display="grid" gap="xl">
      <RecordHeading
        title={labels.documents}
        subtitle={labels.receiptsInvoicesAndStatementsOriginal}
        action={
          <Box display="flex" flexWrap="wrap" gap="md">
            <Button
              type="submit"
              form="document-archive-filters"
              value="export"
              variant="outline"
              disabled={archiveExport.isPending}
            >
              <Download size={14} />
              {archiveExport.isPending ? labels.exportingArchive : labels.exportArchivePage}
            </Button>
            <Button onClick={() => onOpen("new")}>
              <Upload size={14} />
              {labels.uploadDocument}
            </Button>
          </Box>
        }
      />
      <Box
        id="document-archive-filters"
        as="form"
        display="grid"
        gap="md"
        onSubmit={(event) => {
          event.preventDefault();
          const fields = new FormData(event.currentTarget);
          const submitter =
            event.nativeEvent instanceof SubmitEvent ? event.nativeEvent.submitter : null;
          const intent = submitter instanceof HTMLButtonElement ? submitter.value : null;
          const decoded = Schema.decodeUnknownOption(Sources.ArchiveFilters)({
            filename: fields.get("filename") || undefined,
            sourceSystem: fields.get("sourceSystem") || undefined,
            retainedFrom: fields.get("retainedFrom") || undefined,
            retainedTo: fields.get("retainedTo") || undefined,
          });
          if (
            decoded._tag === "None" ||
            (decoded.value.retainedFrom &&
              decoded.value.retainedTo &&
              decoded.value.retainedFrom > decoded.value.retainedTo)
          ) {
            setFilterError(labels.invalidArchiveFilters);
            return;
          }
          setFilterError(null);
          setFilters(decoded.value);
          if (intent === "export") archiveExport.mutate(decoded.value);
          else archiveExport.reset();
        }}
      >
        <Box key={JSON.stringify(filters)} display="flex" flexWrap="wrap" alignItems="end" gap="md">
          <InputField
            name="filename"
            label={labels.exactFilename}
            defaultValue={filters.filename}
            maxLength={200}
            autoComplete="off"
            disabled={archiveExport.isPending}
          />
          <InputField
            name="sourceSystem"
            label={labels.sourceSystem}
            defaultValue={filters.sourceSystem}
            maxLength={200}
            autoComplete="off"
            disabled={archiveExport.isPending}
          />
          <InputField
            name="retainedFrom"
            type="date"
            label={labels.retainedFrom}
            defaultValue={filters.retainedFrom}
            disabled={archiveExport.isPending}
          />
          <InputField
            name="retainedTo"
            type="date"
            label={labels.retainedTo}
            defaultValue={filters.retainedTo}
            disabled={archiveExport.isPending}
          />
        </Box>
        <Box display="flex" flexWrap="wrap" gap="md">
          <Button type="submit" value="search" variant="outline" disabled={archiveExport.isPending}>
            {labels.applyArchiveFilters}
          </Button>
          {hasFilters ? (
            <Button
              type="button"
              variant="ghost"
              disabled={archiveExport.isPending}
              onClick={() => {
                setFilters({});
                setFilterError(null);
                archiveExport.reset();
              }}
            >
              {labels.clearArchiveFilters}
            </Button>
          ) : null}
        </Box>
        {filterError ? <Text role="alert">{filterError}</Text> : null}
      </Box>
      <PageCaption>{labels.archiveExportHelp}</PageCaption>
      <AccountingStatus
        locale={locale}
        pending={archiveExport.isPending}
        error={archiveExport.error}
      />
      <AccountingStatus locale={locale} pending={sources.isPending} error={sources.error} />
      {sources.isError ? (
        <Box>
          <Button
            variant="outline"
            disabled={sources.isFetching}
            onClick={() => {
              void sources.refetch();
            }}
          >
            {labels.retryArchiveSearch}
          </Button>
        </Box>
      ) : null}
      {sources.isSuccess ? (
        items.length ? (
          <DataTable
            title={labels.documents}
            narrow="stack"
            columns={[
              { id: "name", label: labels.document },
              { id: "source", label: labels.sourceSystem },
              { id: "date", label: labels.uploaded },
              { id: "type", label: labels.fileType },
            ]}
            rows={items.map((occurrence) => ({
              id: occurrence.id,
              cells: [
                <RecordOpen key="open" onClick={() => onOpen(occurrence.id)}>
                  <FileText size={14} />
                  {occurrence.filename}
                </RecordOpen>,
                occurrence.sourceSystem,
                new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
                  new Date(occurrence.retainedAt),
                ),
                occurrence.mediaType.split("/").at(-1)?.toUpperCase(),
              ],
            }))}
          />
        ) : (
          <PageEmpty
            title={hasFilters ? labels.noMatchingDocuments : labels.aHomeForYourSource}
            detail={hasFilters ? labels.adjustArchiveFilters : labels.uploadAPdfImageOr}
          />
        )
      ) : null}
      {sources.hasNextPage ? (
        <Box>
          <Button
            variant="outline"
            disabled={sources.isFetchingNextPage}
            onClick={() => {
              void sources.fetchNextPage();
            }}
          >
            {sources.isFetchingNextPage ? labels.loadingDocuments : labels.loadMoreDocuments}
          </Button>
        </Box>
      ) : null}
      <PageCaption>{labels.uploadingRetainsTheOriginalIt}</PageCaption>
      {recordId === "new" ? (
        <FormDialog
          title={labels.uploadDocument}
          size="compact"
          closeLabel={labels.close}
          onClose={() => onOpen("")}
        >
          <DocumentUpload onSaved={onOpen} />
        </FormDialog>
      ) : null}
    </Box>
  );
}
export function DocumentUpload({
  onSaved,
  statement = false,
  sie = false,
}: {
  onSaved: (id: string) => void;
  statement?: boolean;
  sie?: boolean;
}) {
  const { book, locale } = useBookWorkspace();
  const sv = locale === "sv";
  const labels = sv ? swedish : english;
  const client = useQueryClient();
  const keys = useRef(new Map<string, string>());
  const [occurrenceKey] = useState(() => crypto.randomUUID());
  const [fileError, setFileError] = useState<string | null>(null);
  const sizeLimit = sie ? 524288 : statement ? 65536 : Sources.maxSourceBytes;
  const fileHelp = sie
    ? sv
      ? "SIE 4, högst 512 KiB, 2 000 poster och 200 verifikationer."
      : "SIE 4, up to 512 KiB, 2,000 records and 200 vouchers."
    : statement
      ? sv
        ? "CSV i UTF-8, högst 64 kB och 200 rader."
        : "UTF-8 CSV, up to 64 KB and 200 rows."
      : labels.pdfImagesCsvTextJson;
  const upload = useMutation({
    mutationFn: async (file: File) => {
      if (file.size === 0 || file.size > sizeLimit) throw new Error(labels.chooseAFileBetween1);
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      for (let offset = 0; offset < bytes.length; offset += 8192)
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
      const input = Schema.decodeSync(Sources.RetainSource)({
        sourceSystem: "manual-upload",
        sourceAccountId: book.id,
        occurrenceKey,
        sourceRevision: "1",
        filename: file.name,
        mediaType: file.name.toLowerCase().endsWith(".csv")
          ? "text/csv"
          : Schema.is(Sources.SourceMediaType)(file.type)
            ? file.type
            : "application/octet-stream",
        contentBase64: btoa(binary),
      });
      const path = `${bookPath(book)}/source-occurrences`;
      return readAccounting(
        path,
        Sources.SourceOccurrence,
        mutationOptions(path, JSON.stringify(input), keys.current),
      );
    },
    onSuccess: (source) => {
      void client.invalidateQueries({ queryKey: bookKey(book) });
      onSaved(source.id);
    },
  });
  return (
    <Box
      as="form"
      display="grid"
      gap="xl"
      onSubmit={(event) => {
        event.preventDefault();
        const file = new FormData(event.currentTarget).get("file");
        if (!(file instanceof File)) return;
        if (
          file.size === 0 ||
          file.size > sizeLimit ||
          file.name.length > 200 ||
          (statement && !file.name.toLowerCase().endsWith(".csv"))
        ) {
          setFileError(fileHelp);
          return;
        }
        setFileError(null);
        upload.mutate(file);
      }}
    >
      <InputField
        name="file"
        type="file"
        label={labels.document}
        required
        disabled={upload.isPending || upload.isError}
        accept={
          sie
            ? ".se,.si,.sie,.txt"
            : statement
              ? ".csv"
              : ".pdf,.png,.jpg,.jpeg,.csv,.txt,.json,.xml"
        }
      />
      <PageCaption>{fileError ?? fileHelp}</PageCaption>
      <Box>
        <Button
          type={upload.isError ? "button" : "submit"}
          disabled={upload.isPending}
          onClick={
            upload.isError
              ? () => {
                  if (upload.variables) upload.mutate(upload.variables);
                }
              : undefined
          }
        >
          <Upload size={14} />
          {upload.isError ? labels.retryUpload : labels.saveOriginal}
        </Button>
      </Box>
      <AccountingStatus locale={locale} pending={upload.isPending} error={upload.error} />
    </Box>
  );
}
function DocumentDetail({ id }: { id: string }) {
  const { book, locale } = useBookWorkspace();
  const sv = locale === "sv";
  const labels = sv ? swedish : english;
  const document = useQuery({
    queryKey: [...bookKey(book), "source-occurrence", id],
    gcTime: 0,
    queryFn: async ({ signal }) => {
      const result = await readAccounting(
        `${bookPath(book)}/source-occurrences/${encodeURIComponent(id)}`,
        Sources.SourceOccurrenceView,
        { signal },
      );
      if (
        result.occurrence.id !== id ||
        result.occurrence.scope.bookId !== book.id ||
        result.occurrence.scope.entityId !== book.entityId
      )
        throw new Error("Document scope mismatch");
      return result;
    },
    retry: false,
  });
  const purchases = useQuery({
    queryKey: [...bookKey(book), "source-purchase-links", id],
    queryFn: async ({ signal }) => {
      const result = await readAccounting(
        `${bookPath(book)}/source-occurrences/${encodeURIComponent(id)}/purchase-links`,
        Sources.SourcePurchaseLinks,
        { signal },
      );
      if (
        result.occurrenceId !== id ||
        result.scope.bookId !== book.id ||
        result.scope.entityId !== book.entityId
      )
        throw new Error("Purchase source scope mismatch");
      return result;
    },
    retry: false,
  });
  const source = document.isError ? undefined : document.data?.occurrence;
  return (
    <Box display="grid" gap="xl">
      <AccountingStatus locale={locale} pending={document.isPending} error={document.error} />
      {source ? (
        <>
          <RecordHeading
            title={source.filename}
            subtitle={labels.originalDocument}
            action={
              <Button
                variant="outline"
                onClick={() => {
                  if (document.data)
                    downloadIntake(
                      new Blob(
                        [
                          Uint8Array.from(atob(document.data.contentBase64), (char) =>
                            char.charCodeAt(0),
                          ),
                        ],
                        { type: source.mediaType },
                      ),
                      source.filename,
                    );
                }}
              >
                <Download size={14} />
                {labels.downloadOriginal}
              </Button>
            }
          />
          <RecordSplit
            aside={
              <Box display="grid" gap="xl">
                <RecordSection title={labels.documentDetails}>
                  <Text>
                    {labels.uploaded}:{" "}
                    {new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
                      new Date(source.retainedAt),
                    )}
                  </Text>
                  <Text>{source.mediaType}</Text>
                  <Text>{new Intl.NumberFormat(locale).format(source.byteLength)} bytes</Text>
                  <PageCaption>{labels.theOriginalIsRetainedNo}</PageCaption>
                  {book.role === "operator" ? (
                    <PageAction
                      href={`${workspacePath(book)}/purchases?view=supplier-drafts&record=${encodeURIComponent(`new:${source.id}`)}`}
                    >
                      {sv ? "Förbered leverantörsfaktura" : "Prepare supplier invoice"}
                    </PageAction>
                  ) : null}
                  {book.role === "operator" && !document.data?.admission ? (
                    <PageAction
                      href={`${workspacePath(book)}/purchases?view=expenses&record=${encodeURIComponent(`new:${source.id}`)}`}
                    >
                      {sv ? "Förbered utgift" : "Prepare expense"}
                    </PageAction>
                  ) : null}
                </RecordSection>
                <RecordSection title={sv ? "Arbete från originalet" : "Work from this original"}>
                  <AccountingStatus
                    locale={locale}
                    pending={purchases.isPending}
                    error={purchases.error}
                  />
                  {purchases.isError ? (
                    <Button variant="outline" onClick={() => void purchases.refetch()}>
                      {sv ? "Försök igen" : "Retry"}
                    </Button>
                  ) : null}
                  {purchases.data?.supplierDrafts.map((draft) => (
                    <PageAction
                      key={draft.id}
                      href={`${workspacePath(book)}/purchases?view=supplier-drafts&record=${encodeURIComponent(draft.id)}`}
                    >
                      {sv ? "Fakturautkast" : "Invoice draft"}: {draft.title} ·{" "}
                      {draft.currentSource
                        ? sv
                          ? "Aktuellt underlag"
                          : "Current source"
                        : sv
                          ? "Tidigare underlag"
                          : "Earlier source"}
                    </PageAction>
                  ))}
                  {purchases.data?.expenses.map((expense) => (
                    <PageAction
                      key={expense.id}
                      href={`${workspacePath(book)}/purchases?view=expenses&record=${encodeURIComponent(expense.id)}`}
                    >
                      {sv ? "Utgift" : "Expense"}: {expense.description} ·{" "}
                      {!expense.currentSource
                        ? sv
                          ? "Tidigare underlag"
                          : "Earlier source"
                        : expense.withdrawn
                          ? sv
                            ? "Återtagen"
                            : "Withdrawn"
                          : expense.reviewCurrent
                            ? sv
                              ? "Granskad"
                              : "Reviewed"
                            : sv
                              ? "Att granska"
                              : "Needs review"}
                    </PageAction>
                  ))}
                  {purchases.isSuccess &&
                  !purchases.data.supplierDrafts.length &&
                  !purchases.data.expenses.length ? (
                    <PageCaption>
                      {sv
                        ? "Inga sparade inköpsuppgifter är kopplade till originalet."
                        : "No saved purchase work is linked to this original."}
                    </PageCaption>
                  ) : null}
                </RecordSection>
              </Box>
            }
          >
            {document.data ? (
              <DocumentPreview
                key={source.id}
                content={document.data.contentBase64}
                mediaType={source.mediaType}
                filename={source.filename}
              />
            ) : null}
          </RecordSplit>
        </>
      ) : null}
    </Box>
  );
}

function archivePath(base: string, filters: typeof Sources.ArchiveFilters.Type, cursor = "") {
  const query = new URLSearchParams();
  if (filters.filename) query.set("filename", filters.filename);
  if (filters.sourceSystem) query.set("sourceSystem", filters.sourceSystem);
  if (filters.retainedFrom) query.set("retainedFrom", filters.retainedFrom);
  if (filters.retainedTo) query.set("retainedTo", filters.retainedTo);
  if (cursor) query.set("cursor", cursor);
  const search = query.toString();
  return search ? `${base}?${search}` : base;
}

const english = {
  allDocuments: "All documents",
  documents: "Documents",
  receiptsInvoicesAndStatementsOriginal:
    "Receipts, invoices and statements. Original files are kept unchanged.",
  uploadDocument: "Upload document",
  exportArchivePage: "Export first page and originals",
  exportingArchive: "Exporting page",
  archiveExportHelp:
    "Exports up to 10 matching originals with a JSON manifest. Additional pages stay separate.",
  exactFilename: "Exact filename",
  sourceSystem: "Source system",
  retainedFrom: "Retained from",
  retainedTo: "Retained to",
  applyArchiveFilters: "Search archive",
  clearArchiveFilters: "Clear filters",
  invalidArchiveFilters: "Enter valid dates and a retained-from date no later than retained-to.",
  retryArchiveSearch: "Retry archive search",
  document: "Document",
  uploaded: "Uploaded",
  fileType: "File type",
  noMatchingDocuments: "No matching documents",
  aHomeForYourSource: "A home for your source documents",
  adjustArchiveFilters: "Clear or change the archive filters.",
  uploadAPdfImageOr: "Upload a PDF, image or data file to retain the original.",
  loadMoreDocuments: "Load more documents",
  loadingDocuments: "Loading documents…",
  uploadingRetainsTheOriginalIt:
    "Uploading retains the original. It does not create a posting or automatically extract document details.",
  close: "Close",
  chooseAFileBetween1: "Choose a file between 1 byte and 5 MB.",
  pdfImagesCsvTextJson: "PDF, images, CSV, text, JSON or XML. Up to 5 MB.",
  retryUpload: "Retry upload",
  saveOriginal: "Save original",
  originalDocument: "Original document",
  downloadOriginal: "Download original",
  documentDetails: "Document details",
  theOriginalIsRetainedNo: "The original is retained. No posting was created by this upload.",
};
const swedish: typeof english = {
  allDocuments: "Alla dokument",
  documents: "Dokument",
  receiptsInvoicesAndStatementsOriginal:
    "Kvitton, fakturor och kontoutdrag. Originalen sparas oförändrade.",
  uploadDocument: "Ladda upp dokument",
  exportArchivePage: "Exportera första sidan och original",
  exportingArchive: "Exporterar sidan",
  archiveExportHelp:
    "Exporterar upp till 10 matchande original med en JSON-manifest. Ytterligare sidor exporteras separat.",
  exactFilename: "Exakt filnamn",
  sourceSystem: "Källsystem",
  retainedFrom: "Sparad från",
  retainedTo: "Sparad till",
  applyArchiveFilters: "Sök i arkivet",
  clearArchiveFilters: "Rensa filter",
  invalidArchiveFilters:
    "Ange giltiga datum och ett från-datum som är före eller lika med till-datumet.",
  retryArchiveSearch: "Försök arkivsökningen igen",
  document: "Dokument",
  uploaded: "Uppladdat",
  fileType: "Filtyp",
  noMatchingDocuments: "Inga matchande dokument",
  aHomeForYourSource: "En plats för dina underlag",
  adjustArchiveFilters: "Rensa eller ändra arkivfiltren.",
  uploadAPdfImageOr: "Ladda upp en PDF, bild eller datafil för att behålla originalet.",
  loadMoreDocuments: "Läs in fler dokument",
  loadingDocuments: "Läser in dokument…",
  uploadingRetainsTheOriginalIt:
    "Uppladdning sparar originalet. Den skapar inte bokföring eller automatisk dokumenttolkning.",
  close: "Stäng",
  chooseAFileBetween1: "Välj en fil mellan 1 byte och 5 MB.",
  pdfImagesCsvTextJson: "PDF, bilder, CSV, text, JSON eller XML. Högst 5 MB.",
  retryUpload: "Försök igen",
  saveOriginal: "Spara original",
  originalDocument: "Sparat original",
  downloadOriginal: "Ladda ned original",
  documentDetails: "Dokumentuppgifter",
  theOriginalIsRetainedNo: "Originalet är sparat. Ingen bokföring har skapats från uppladdningen.",
};
