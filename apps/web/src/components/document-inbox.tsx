import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Schema from "effect/Schema";
import * as Option from "effect/Option";
import * as Sources from "@open-erp/contracts/source-intake";
import { ArrowLeft, Upload, Download, FileText } from "lucide-react";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { InputField } from "@open-erp/ui/components/field";
import { DataTable } from "@open-erp/ui/components/data-table";
import { FormDialog } from "@open-erp/ui/components/form-dialog";
import { DocumentPreview } from "@open-erp/ui/components/document-preview";
import { RecordHeading, RecordSplit, RecordSection } from "@open-erp/ui/components/record-layout";
import { PageEmpty, PageAction, PageCaption } from "@open-erp/ui/components/accounting-page";
import { Text } from "@open-erp/ui/components/typography";
import { AccountingStatus } from "@/components/accounting-status";
import { useBookWorkspace, workspacePath } from "@/lib/book-context";
import { bookKey, bookPath, mutationOptions, readAccounting } from "@/lib/accounting-api";
import { defaultStringifySearch, useSearch } from "@tanstack/react-router";
import { encodeOwnerReturn, useWorkReturn, workReturnHref } from "@/lib/work-return";
import { decimalToMinor, minorToDecimal, formatMinorAmount } from "@/lib/workspace-api";
import { downloadIntake } from "@/components/source-intake/download";

export function DocumentInbox({
  recordId,
  onOpen,
  filters: search,
  onFilters,
}: {
  recordId?: string;
  onOpen: (id: string) => void;
  filters: typeof Sources.ArchiveFilters.Type;
  onFilters: (filters: typeof Sources.ArchiveFilters.Type) => void;
}) {
  const { book, locale } = useBookWorkspace();
  const sv = locale === "sv";
  const labels = sv ? swedish : english;

  const filters = {
    q: search.q,
    supplierId: search.supplierId,
    documentFrom: search.documentFrom,
    documentTo: search.documentTo,
    currency: search.currency,
    currencyScale: search.currencyScale,
    amountMinor: search.amountMinor,
    invoiceId: search.invoiceId,
    voucherId: search.voucherId,
    occurrenceId: search.occurrenceId,
    filename: search.filename,
    sourceSystem: search.sourceSystem,
    retainedFrom: search.retainedFrom,
    retainedTo: search.retainedTo,
    cursor: search.cursor,
  };

  const opener = useRef<string | null>(null);
  const pendingFocus = useRef<string | null | undefined>(undefined);
  const areaSearch = useSearch({ strict: false });

  const base = `${workspacePath(book)}/purchases`;

  const href = (id: string) =>
    `${base}${defaultStringifySearch({ ...areaSearch, view: "documents", record: id })}`;

  const [filterError, setFilterError] = useState<string | null>(null);

  const sources = useQuery({
    queryKey: [...bookKey(book), "document-inbox", filters],
    queryFn: async ({ signal }) => {
      const result = await readAccounting(
        archivePath(`${bookPath(book)}/source-archive`, filters),
        Sources.ArchiveSearch,
        { signal },
      );

      result.items.forEach((occurrence) => {
        if (occurrence.scope.bookId !== book.id || occurrence.scope.entityId !== book.entityId)
          throw new Error("Archive scope mismatch");
      });

      return result;
    },
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

  const items = sources.data?.items ?? [];

  const hasFilters = Object.entries(filters).some(
    ([name, value]) => name !== "cursor" && value !== undefined,
  );

  if (recordId && recordId !== "new")
    return (
      <Box display="grid" gap="xl">
        <Box>
          <Button
            variant="ghost"
            onClick={() => {
              pendingFocus.current = opener.current ?? recordId;
              onOpen("");
            }}
          >
            <ArrowLeft size={14} />
            {labels.allDocuments}
          </Button>
        </Box>
        <DocumentDetail id={recordId} />
      </Box>
    );

  return (
    <Box
      ref={(node) => {
        if (!node || !sources.isSuccess || pendingFocus.current === undefined) return;

        const row = pendingFocus.current
          ? node.querySelector<HTMLAnchorElement>(`[data-document-id="${pendingFocus.current}"]`)
          : null;

        const target = row ?? node.querySelector<HTMLHeadingElement>("h2");

        if (target) {
          if (!row) target.tabIndex = -1;
          target.focus();
          pendingFocus.current = undefined;
        }
      }}
      display="grid"
      gap="xl"
    >
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

          const decoded = readArchiveForm(fields, filters.occurrenceId);

          if (Option.isNone(decoded)) {
            setFilterError(labels.invalidArchiveFilters);

            return;
          }

          setFilterError(null);
          const criteria = { ...filters, cursor: undefined };

          const changed =
            Object.entries(decoded.value).some(
              ([name, value]) =>
                Object.entries(criteria).find(([key]) => key === name)?.[1] !== value,
            ) ||
            Object.entries(criteria).some(
              ([name, value]) =>
                Object.entries(decoded.value).find(([key]) => key === name)?.[1] !== value,
            );

          const applied = { ...decoded.value, cursor: changed ? undefined : filters.cursor };

          onFilters(applied);

          if (intent === "export") archiveExport.mutate(applied);
          else archiveExport.reset();
        }}
      >
        <Box key={JSON.stringify(filters)} display="flex" flexWrap="wrap" alignItems="end" gap="md">
          <InputField
            name="q"
            label={labels.filenameOrSupplier}
            defaultValue={filters.q}
            maxLength={200}
            autoComplete="off"
            disabled={archiveExport.isPending}
          />
          <InputField
            name="supplierId"
            label={labels.supplierReference}
            defaultValue={filters.supplierId}
            maxLength={128}
            autoComplete="off"
            disabled={archiveExport.isPending}
          />
          <InputField
            name="documentFrom"
            type="date"
            label={labels.documentFrom}
            defaultValue={filters.documentFrom}
            disabled={archiveExport.isPending}
          />
          <InputField
            name="documentTo"
            type="date"
            label={labels.documentTo}
            defaultValue={filters.documentTo}
            disabled={archiveExport.isPending}
          />
          <InputField
            name="amount"
            label={labels.exactGrossAmount}
            inputMode="decimal"
            defaultValue={
              filters.amountMinor && filters.currencyScale !== undefined
                ? minorToDecimal(filters.amountMinor, Number(filters.currencyScale))
                : ""
            }
            autoComplete="off"
            disabled={archiveExport.isPending}
          />
          <InputField
            name="currency"
            label={labels.currency}
            defaultValue={filters.currency}
            maxLength={3}
            autoComplete="off"
            disabled={archiveExport.isPending}
          />
          <InputField
            name="currencyScale"
            label={labels.currencyDecimals}
            defaultValue={filters.currencyScale}
            inputMode="numeric"
            maxLength={1}
            autoComplete="off"
            disabled={archiveExport.isPending}
          />
          <InputField
            name="invoiceId"
            label={labels.invoiceReference}
            defaultValue={filters.invoiceId}
            maxLength={128}
            autoComplete="off"
            disabled={archiveExport.isPending}
          />
          <InputField
            name="voucherId"
            label={labels.voucherReference}
            defaultValue={filters.voucherId}
            maxLength={128}
            autoComplete="off"
            disabled={archiveExport.isPending}
          />
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
                onFilters({
                  q: undefined,
                  supplierId: undefined,
                  documentFrom: undefined,
                  documentTo: undefined,
                  currency: undefined,
                  currencyScale: undefined,
                  amountMinor: undefined,
                  invoiceId: undefined,
                  voucherId: undefined,
                  occurrenceId: undefined,
                  filename: undefined,
                  sourceSystem: undefined,
                  retainedFrom: undefined,
                  retainedTo: undefined,
                  cursor: undefined,
                });
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
      <PageCaption>{labels.archiveSearchHelp}</PageCaption>
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
              { id: "facts", label: labels.savedFacts },
              { id: "source", label: labels.sourceSystem },
              { id: "date", label: labels.uploaded },
              { id: "type", label: labels.fileType },
            ]}
            rows={items.map((occurrence) => ({
              id: occurrence.id,
              cells: [
                <PageAction
                  key="open"
                  quiet
                  href={href(occurrence.id)}
                  data-document-id={occurrence.id}
                  onClick={() => {
                    opener.current = occurrence.id;
                  }}
                >
                  <FileText size={14} />
                  {occurrence.filename}
                </PageAction>,
                <DocumentFactSummary key="facts" row={occurrence} />,
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
      {sources.data?.nextCursor ? (
        <Box>
          <Button
            variant="outline"
            disabled={sources.isFetching}
            onClick={() => {
              onFilters({ ...filters, cursor: sources.data?.nextCursor ?? undefined });
            }}
          >
            {sources.isFetching ? labels.loadingDocuments : labels.loadMoreDocuments}
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
  supplier = false,
}: {
  onSaved: (id: string) => void;
  statement?: boolean;
  sie?: boolean;
  supplier?: boolean;
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
        destination: supplier ? "supplier_inbox" : undefined,
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
  const work = useWorkReturn();
  const ownerSearch = useSearch({ strict: false });
  const returnTo = encodeOwnerReturn({ owner: "documents", search: ownerSearch });
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

  const metadata = useQuery({
    queryKey: [...bookKey(book), "document-library-metadata", id],
    queryFn: async ({ signal }) => {
      const result = await readAccounting(
        archivePath(`${bookPath(book)}/source-archive`, { occurrenceId: id }),
        Sources.ArchiveSearch,
        { signal },
      );

      if (
        result.items.some(
          (item) =>
            item.id !== id ||
            item.scope.bookId !== book.id ||
            item.scope.entityId !== book.entityId,
        )
      )
        throw new Error("Document metadata scope mismatch");

      return result.items[0] ?? null;
    },
    retry: false,
  });

  const source = metadata.data ?? document.data?.occurrence;

  return (
    <Box display="grid" gap="xl">
      <AccountingStatus locale={locale} pending={document.isPending} error={document.error} />
      {document.isError ? (
        <Box>
          <Button
            static
            variant="outline"
            disabled={document.isFetching}
            onClick={() => void document.refetch()}
          >
            {sv ? "Försök läsa originalet igen" : "Retry original"}
          </Button>
        </Box>
      ) : null}
      <AccountingStatus locale={locale} pending={metadata.isPending} error={metadata.error} />
      {metadata.isError ? (
        <Box>
          <Button
            variant="outline"
            disabled={metadata.isFetching}
            onClick={() => void metadata.refetch()}
          >
            {labels.retryArchiveSearch}
          </Button>
        </Box>
      ) : null}
      {metadata.isSuccess && !metadata.data ? (
        <PageCaption>
          {sv
            ? "Originalet finns inte i detta arkiv."
            : "The original is absent from this archive."}
        </PageCaption>
      ) : null}
      {source ? (
        <>
          <RecordHeading
            title={source.filename}
            subtitle={labels.originalDocument}
            action={
              <Button
                variant="outline"
                disabled={!document.data}
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
                      href={`${workReturnHref(`${workspacePath(book)}/purchases`, "supplier-drafts", work)}&returnTo=${encodeURIComponent(returnTo)}&record=${encodeURIComponent(`new:${source.id}`)}`}
                    >
                      {sv ? "Förbered leverantörsfaktura" : "Prepare supplier invoice"}
                    </PageAction>
                  ) : null}
                  {book.role === "operator" && document.data && !document.data.admission ? (
                    <PageAction
                      href={`${workReturnHref(`${workspacePath(book)}/purchases`, "expenses", work)}&returnTo=${encodeURIComponent(returnTo)}&record=${encodeURIComponent(`new:${source.id}`)}`}
                    >
                      {sv ? "Förbered utgift" : "Prepare expense"}
                    </PageAction>
                  ) : null}
                </RecordSection>
                <RecordSection title={labels.savedFacts}>
                  {metadata.data ? <DocumentFacts row={metadata.data} returnTo={returnTo} /> : null}
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

function archivePath(base: string, filters: typeof Sources.ArchiveFilters.Type) {
  const query = new URLSearchParams();

  for (const [name, value] of Object.entries(filters)) {
    if (value !== undefined) query.set(name, value);
  }

  const search = query.toString();

  return search ? `${base}?${search}` : base;
}

function readArchiveForm(fields: FormData, occurrenceId: string | undefined) {
  const text = (name: string) => {
    const value = fields.get(name);

    return typeof value === "string" ? value : "";
  };

  const scaleText = text("currencyScale");

  const scale = /^[0-6]$/.test(scaleText) ? Number(scaleText) : null;

  const amount = text("amount").trim().replace(",", ".");

  const decoded = Schema.decodeUnknownOption(Sources.ArchiveFilters)({
    occurrenceId,
    ...Object.fromEntries(
      [
        "q",
        "supplierId",
        "documentFrom",
        "documentTo",
        "invoiceId",
        "voucherId",
        "filename",
        "sourceSystem",
        "retainedFrom",
        "retainedTo",
      ].map((name) => [name, text(name) || undefined]),
    ),
    currency: text("currency").trim().toUpperCase() || undefined,
    currencyScale: scaleText || undefined,
    amountMinor: amount ? (scale === null ? null : decimalToMinor(amount, scale)) : undefined,
  });

  if (Option.isNone(decoded)) return decoded;
  const filters = decoded.value;

  if (
    (filters.amountMinor !== undefined &&
      (filters.currency === undefined || filters.currencyScale === undefined)) ||
    (filters.currencyScale !== undefined && filters.currency === undefined) ||
    (filters.documentFrom !== undefined &&
      filters.documentTo !== undefined &&
      filters.documentFrom > filters.documentTo) ||
    (filters.retainedFrom !== undefined &&
      filters.retainedTo !== undefined &&
      filters.retainedFrom > filters.retainedTo)
  )
    return Option.none();

  return decoded;
}

function documentAmount(fact: typeof Sources.DocumentFact.Type, locale: "en" | "sv") {
  if (fact.grossMinor === null) return locale === "sv" ? "Okänt belopp" : "Unknown amount";

  if (fact.currency === null || fact.currencyScale === null)
    return `${fact.grossMinor} · ${locale === "sv" ? "valutaenhet okänd" : "currency units unknown"}`;

  return `${formatMinorAmount(fact.grossMinor, fact.currencyScale, locale)} ${fact.currency}`;
}

function factBasis(fact: typeof Sources.DocumentFact.Type, sv: boolean) {
  switch (fact.basis) {
    case "entered_draft":
      return sv ? "Angivet i utkast" : "Entered draft";
    case "registered_invoice":
      return sv ? "Registrerad faktura" : "Registered invoice";
    case "entered_expense":
      return sv ? "Angiven utgift" : "Entered expense";
    case "reviewed_expense":
      return sv ? "Granskad utgift" : "Reviewed expense";
  }
}

function DocumentFactSummary({ row }: { row: typeof Sources.DocumentSearchRow.Type }) {
  const { locale } = useBookWorkspace();
  const sv = locale === "sv";
  const current = row.facts.filter((fact) => fact.currentSource);

  return (
    <Box display="grid" gap="sm">
      {current.length > 1 ? (
        <PageCaption>{sv ? "Flera aktuella uppgifter" : "Multiple current records"}</PageCaption>
      ) : null}
      {current.map((fact) => (
        <Box key={`${fact.ownerKind}:${fact.ownerId}:${fact.revision}:${fact.basis}`}>
          <Text>
            {fact.supplierName ?? (sv ? "Leverantör okänd" : "Supplier unknown")} ·{" "}
            {documentAmount(fact, locale)}
          </Text>
          <PageCaption>
            {factBasis(fact, sv)} ·{" "}
            {fact.documentDate ?? (sv ? "Dokumentdatum okänt" : "Document date unknown")}
          </PageCaption>
          {fact.withdrawn ? (
            <PageCaption>{sv ? "Återtaget underlag" : "Withdrawn source"}</PageCaption>
          ) : null}
        </Box>
      ))}
      {!current.length ? (
        <PageCaption>
          {sv ? "Inga aktuella sparade uppgifter" : "No current saved facts"}
        </PageCaption>
      ) : null}
      {row.facts.some((fact) => !fact.currentSource) ? (
        <PageCaption>
          {sv ? "Tidigare versioner finns i dokumentet" : "Earlier revisions in document details"}
        </PageCaption>
      ) : null}
      {row.suggestions.length ? (
        <PageCaption>
          {sv ? "Ogranskade tolkningsförslag" : "Unreviewed extraction suggestions"}
        </PageCaption>
      ) : null}
    </Box>
  );
}

function DocumentFacts({
  row,
  returnTo,
}: {
  row: typeof Sources.DocumentSearchRow.Type;
  returnTo: string;
}) {
  const { book, locale } = useBookWorkspace();
  const work = useWorkReturn();
  const sv = locale === "sv";

  const purchase = (view: string, record: string) =>
    `${workReturnHref(`${workspacePath(book)}/purchases`, view, work)}&returnTo=${encodeURIComponent(returnTo)}&record=${encodeURIComponent(record)}`;

  return (
    <Box display="grid" gap="lg">
      {!row.facts.length ? (
        <PageCaption>
          {sv
            ? "Inga sparade uppgifter är kopplade till originalet."
            : "No saved facts are linked to this original."}
        </PageCaption>
      ) : null}
      {row.facts.map((fact) => (
        <Box
          display="grid"
          gap="sm"
          key={`${fact.ownerKind}:${fact.ownerId}:${fact.revision}:${fact.basis}`}
        >
          <Text>
            {fact.supplierName ?? (sv ? "Leverantör okänd" : "Supplier unknown")} ·{" "}
            {documentAmount(fact, locale)}
          </Text>
          <Text>
            {factBasis(fact, sv)} ·{" "}
            {fact.currentSource
              ? sv
                ? "Aktuellt underlag"
                : "Current source"
              : sv
                ? "Tidigare underlag"
                : "Earlier source"}{" "}
            · {fact.documentDate ?? (sv ? "Dokumentdatum okänt" : "Document date unknown")}
          </Text>
          <PageAction
            href={`${purchase(fact.ownerKind === "supplier_draft" ? "supplier-drafts" : "expenses", fact.ownerId)}&${defaultStringifySearch(fact.ownerKind === "supplier_draft" ? { draftRevision: fact.revision } : { expenseRevision: fact.revision }).slice(1)}`}
          >
            {fact.ownerKind === "supplier_draft"
              ? sv
                ? "Fakturautkast version"
                : "Supplier draft version"
              : sv
                ? "Utgiftsunderlag version"
                : "Expense source version"}{" "}
            {fact.revision}
          </PageAction>
          {fact.reviewId ? (
            <Box display="grid" gap="sm">
              <PageAction
                href={`${purchase("expenses", fact.ownerId)}&expenseReviewId=${encodeURIComponent(fact.reviewId)}`}
              >
                {sv ? "Utgiftsgranskning version" : "Expense review version"} {fact.reviewRevision}
              </PageAction>
              <PageCaption>
                {sv ? "Granskning" : "Review"} {fact.reviewedAt} · {fact.reviewDigest}
              </PageCaption>
            </Box>
          ) : null}
          {fact.invoiceId ? (
            <PageAction href={purchase("invoices", fact.invoiceId)}>
              {sv ? "Faktura" : "Invoice"} {fact.invoiceId}
            </PageAction>
          ) : null}
          {fact.voucherId ? (
            <PageAction
              href={`${workReturnHref(`${workspacePath(book)}/books`, "vouchers", work)}&returnTo=${encodeURIComponent(returnTo)}&record=${encodeURIComponent(fact.voucherId)}`}
            >
              {sv ? "Verifikat" : "Voucher"} {fact.voucherId}
            </PageAction>
          ) : null}
          {fact.withdrawn ? (
            <PageCaption>{sv ? "Återtaget underlag" : "Withdrawn source"}</PageCaption>
          ) : null}
          <PageCaption>
            {sv ? "Sparad version" : "Retained revision"} {fact.revision} · {fact.recordedAt} ·{" "}
            {fact.digest}
          </PageCaption>
        </Box>
      ))}
      {row.suggestions.map((suggestion) => (
        <Box key={suggestion.attemptId} display="grid" gap="sm">
          <Text>
            {sv ? "Ogranskade tolkningsförslag" : "Unreviewed extraction suggestions"} ·{" "}
            {suggestion.engineRelease} · {suggestion.createdAt}
          </Text>
          {suggestion.fields.map((field, index) => (
            <PageCaption key={`${field.fieldKey}:${field.lineOrdinal}:${index}`}>
              {field.fieldKey}: {field.proposedValue ?? (sv ? "Okänt" : "Unknown")}
            </PageCaption>
          ))}
        </Box>
      ))}
    </Box>
  );
}

const english = {
  allDocuments: "All documents",
  documents: "Documents",
  receiptsInvoicesAndStatementsOriginal:
    "Receipts, invoices and statements. Original files are kept unchanged.",
  uploadDocument: "Upload document",
  exportArchivePage: "Export this page and originals",
  exportingArchive: "Exporting page",
  archiveExportHelp:
    "Exports up to 10 matching originals with a JSON manifest. Additional pages stay separate.",
  filenameOrSupplier: "Filename or supplier",
  supplierReference: "Supplier reference",
  documentFrom: "Document from",
  documentTo: "Document to",
  exactGrossAmount: "Exact gross amount",
  currency: "Currency",
  currencyDecimals: "Currency decimals",
  invoiceReference: "Invoice reference",
  voucherReference: "Voucher reference",
  savedFacts: "Saved facts",
  archiveSearchHelp:
    "Search filenames and saved supplier or expense facts. Exact amounts require currency and its decimal places. Document dates and retained dates are separate. OCR body text is outside this search.",
  exactFilename: "Exact filename",
  sourceSystem: "Source system",
  retainedFrom: "Retained from",
  retainedTo: "Retained to",
  applyArchiveFilters: "Search archive",
  clearArchiveFilters: "Clear filters",
  invalidArchiveFilters:
    "Check the dates, references and exact amount. Amount searches need a currency and 0 to 6 decimal places.",
  retryArchiveSearch: "Retry archive search",
  document: "Document",
  uploaded: "Uploaded",
  fileType: "File type",
  noMatchingDocuments: "No matching documents",
  aHomeForYourSource: "A home for your source documents",
  adjustArchiveFilters: "Clear or change the archive filters.",
  uploadAPdfImageOr: "Upload a PDF, image or data file to retain the original.",
  loadMoreDocuments: "Next documents",
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
  theOriginalIsRetainedNo:
    "This is the original retention receipt. Uploading did not create a posting.",
};

const swedish: typeof english = {
  allDocuments: "Alla dokument",
  documents: "Dokument",
  receiptsInvoicesAndStatementsOriginal:
    "Kvitton, fakturor och kontoutdrag. Originalen sparas oförändrade.",
  uploadDocument: "Ladda upp dokument",
  exportArchivePage: "Exportera sidan och original",
  exportingArchive: "Exporterar sidan",
  archiveExportHelp:
    "Exporterar upp till 10 matchande original med en JSON-manifest. Ytterligare sidor exporteras separat.",
  filenameOrSupplier: "Filnamn eller leverantör",
  supplierReference: "Leverantörsreferens",
  documentFrom: "Dokument från",
  documentTo: "Dokument till",
  exactGrossAmount: "Exakt bruttobelopp",
  currency: "Valuta",
  currencyDecimals: "Valutadecimaler",
  invoiceReference: "Fakturareferens",
  voucherReference: "Verifikationsreferens",
  savedFacts: "Sparade uppgifter",
  archiveSearchHelp:
    "Sök filnamn och sparade leverantörs- eller utgiftsuppgifter. Exakta belopp behöver valuta och antal decimaler. Dokumentdatum och sparat datum är separata. OCR-text ingår inte i sökningen.",
  exactFilename: "Exakt filnamn",
  sourceSystem: "Källsystem",
  retainedFrom: "Sparad från",
  retainedTo: "Sparad till",
  applyArchiveFilters: "Sök i arkivet",
  clearArchiveFilters: "Rensa filter",
  invalidArchiveFilters:
    "Kontrollera datum, referenser och exakt belopp. Beloppssökning behöver valuta och 0 till 6 decimaler.",
  retryArchiveSearch: "Försök arkivsökningen igen",
  document: "Dokument",
  uploaded: "Uppladdat",
  fileType: "Filtyp",
  noMatchingDocuments: "Inga matchande dokument",
  aHomeForYourSource: "En plats för dina underlag",
  adjustArchiveFilters: "Rensa eller ändra arkivfiltren.",
  uploadAPdfImageOr: "Ladda upp en PDF, bild eller datafil för att behålla originalet.",
  loadMoreDocuments: "Nästa dokument",
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
  theOriginalIsRetainedNo:
    "Detta är kvittot för originalet. Uppladdningen skapade ingen bokföring.",
};
