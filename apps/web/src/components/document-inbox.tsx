import { useRef, useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Schema from "effect/Schema";
import * as Sources from "@open-erp/contracts/source-intake";
import { ArrowLeft, Upload, Download, FileText } from "lucide-react";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { InputField } from "@open-erp/ui/components/field";
import { DataTable } from "@open-erp/ui/components/data-table";
import { Badge } from "@open-erp/ui/components/badge";
import { FormDialog } from "@open-erp/ui/components/form-dialog";
import { DocumentPreview } from "@open-erp/ui/components/document-preview";
import { RecordHeading, RecordSplit, RecordSection } from "@open-erp/ui/components/record-layout";
import {
  PageEmpty,
  PageAction,
  PageCaption,
  RegisterSearch,
  RecordToggle,
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
  const [search, setSearch] = useState("");
  const sources = useInfiniteQuery({
    queryKey: [...bookKey(book), "document-inbox"],
    initialPageParam: "",
    queryFn: async ({ pageParam, signal }) => {
      const result = await readAccounting(
        `${bookPath(book)}/source-occurrences${pageParam ? `?cursor=${encodeURIComponent(pageParam)}` : ""}`,
        Sources.SourceInventory,
        { signal },
      );
      if (
        result.items.some(
          (item) =>
            item.occurrence.scope.bookId !== book.id ||
            item.occurrence.scope.entityId !== book.entityId,
        )
      )
        throw new Error("Source scope mismatch");
      return result;
    },
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    retry: false,
  });
  const items =
    sources.data?.pages
      .flatMap((page) => page.items)
      .filter((item) =>
        item.occurrence.filename
          .toLocaleLowerCase(locale)
          .includes(search.toLocaleLowerCase(locale)),
      ) ?? [];
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
          <Button onClick={() => onOpen("new")}>
            <Upload size={14} />
            {labels.uploadDocument}
          </Button>
        }
      />
      <RegisterSearch
        aria-label={labels.searchDocuments}
        placeholder={labels.searchFilename}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <AccountingStatus locale={locale} pending={sources.isPending} error={sources.error} />
      {sources.isSuccess ? (
        items.length ? (
          <DataTable
            title={labels.documents}
            narrow="stack"
            columns={[
              { id: "name", label: labels.document },
              { id: "date", label: labels.uploaded },
              { id: "type", label: labels.fileType },
              { id: "status", label: "Status" },
            ]}
            rows={items.map(({ occurrence, admission }) => ({
              id: occurrence.id,
              cells: [
                <RecordToggle key="open" expanded={false} onClick={() => onOpen(occurrence.id)}>
                  <FileText size={14} />
                  {occurrence.filename}
                </RecordToggle>,
                new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
                  new Date(occurrence.retainedAt),
                ),
                occurrence.mediaType.split("/").at(-1)?.toUpperCase(),
                <Badge key="status" variant={admission ? "success" : "secondary"}>
                  {admission ? labels.imported : labels.originalSaved}
                </Badge>,
              ],
            }))}
          />
        ) : (
          <PageEmpty
            title={search ? labels.noMatchingDocuments : labels.aHomeForYourSource}
            detail={labels.uploadAPdfImageOr}
          />
        )
      ) : null}
      {sources.hasNextPage ? (
        <Box>
          <Button
            variant="outline"
            disabled={sources.isFetching}
            onClick={() => {
              void sources.fetchNextPage();
            }}
          >
            {labels.loadMoreDocuments}
          </Button>
        </Box>
      ) : null}
      <PageCaption>{labels.uploadingRetainsTheOriginalIt}</PageCaption>
      {recordId === "new" ? (
        <FormDialog
          title={labels.uploadDocument}
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
}: {
  onSaved: (id: string) => void;
  statement?: boolean;
}) {
  const { book, locale } = useBookWorkspace();
  const sv = locale === "sv";
  const labels = sv ? swedish : english;
  const client = useQueryClient();
  const keys = useRef(new Map<string, string>());
  const [occurrenceKey] = useState(() => crypto.randomUUID());
  const [fileError, setFileError] = useState<string | null>(null);
  const sizeLimit = statement ? 65536 : Sources.maxSourceBytes;
  const fileHelp = statement
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
        accept={statement ? ".csv" : ".pdf,.png,.jpg,.jpeg,.csv,.txt,.json,.xml"}
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
                {book.role === "operator" && !document.data?.admission ? (
                  <PageAction
                    href={`${workspacePath(book)}/purchases?view=expenses&record=${encodeURIComponent(`new:${source.id}`)}`}
                  >
                    {sv ? "Förbered utgift" : "Prepare expense"}
                  </PageAction>
                ) : null}
              </RecordSection>
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

const english = {
  allDocuments: "All documents",
  documents: "Documents",
  receiptsInvoicesAndStatementsOriginal:
    "Receipts, invoices and statements. Original files are kept unchanged.",
  uploadDocument: "Upload document",
  searchDocuments: "Search documents",
  searchFilename: "Search filename…",
  document: "Document",
  uploaded: "Uploaded",
  fileType: "File type",
  imported: "Imported",
  originalSaved: "Original saved",
  noMatchingDocuments: "No matching documents",
  aHomeForYourSource: "A home for your source documents",
  uploadAPdfImageOr: "Upload a PDF, image or data file to retain the original.",
  loadMoreDocuments: "Load more documents",
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
  searchDocuments: "Sök dokument",
  searchFilename: "Sök filnamn…",
  document: "Dokument",
  uploaded: "Uppladdat",
  fileType: "Filtyp",
  imported: "Importerat",
  originalSaved: "Sparat original",
  noMatchingDocuments: "Inga matchande dokument",
  aHomeForYourSource: "En plats för dina underlag",
  uploadAPdfImageOr: "Ladda upp en PDF, bild eller datafil för att behålla originalet.",
  loadMoreDocuments: "Läs in fler dokument",
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
