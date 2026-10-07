import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import workerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";
import * as Accounting from "@open-erp/contracts/accounting";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { Text } from "@open-erp/ui/components/typography";
import { PdfViewer, type PdfView } from "@open-erp/ui/components/pdf-viewer";
import { PageCaption } from "@open-erp/ui/components/accounting-page";
import { bookKey, bookPath, readAccounting } from "@/lib/accounting-api";
import { enteredExpenseSource, sourceDocumentOptions } from "@/lib/source-documents";
import { downloadIntake } from "@/components/source-intake/download";
import type { CommerceProps } from "@/components/commerce/shared";
import { useSearch, defaultStringifySearch } from "@tanstack/react-router";
import { encodeOwnerReturn } from "@/lib/work-return";
import { workspacePath } from "@/lib/book-context";
import { PageAction } from "@open-erp/ui/components/accounting-page";

class BankOriginalChecksumMismatch extends Error {
  constructor(readonly expected: string) {
    super("Matching original checksum mismatch");
  }
}

export function useBankMatchOriginal(
  props: CommerceProps & {
    selection?: { voucherId: string; lineId: string };
  },
) {
  const { book } = props;
  const voucherId = props.selection?.voucherId;
  const lineId = props.selection?.lineId;
  const client = useQueryClient();

  return useQuery({
    queryKey: [...bookKey(book), "bank-match-original", voucherId, lineId],
    enabled: !!voucherId && !!lineId,
    queryFn: async ({ signal }) => {
      if (!voucherId || !lineId) throw new Error("Matching selection is missing");

      const voucher = await readAccounting(
        `${bookPath(book)}/vouchers/${encodeURIComponent(voucherId)}`,
        Accounting.Voucher,
        { signal },
      );

      if (voucher.id !== voucherId || !voucher.action.lines.some((line) => line.lineId === lineId))
        throw new Error("Matching voucher identity mismatch");

      const originals = [];

      for (const reference of voucher.action.evidenceRefs) {
        const evidence = await readAccounting(
          `${bookPath(book)}/evidence/${encodeURIComponent(reference.evidenceId)}`,
          Accounting.EvidenceContent,
          { signal },
        );

        if (evidence.id !== reference.evidenceId || evidence.sha256 !== reference.sha256)
          throw new Error("Matching evidence identity mismatch");

        const original =
          evidence.mediaType === "application/json" ? enteredExpenseSource(evidence.content) : null;

        if (original) originals.push(original);
      }

      if (!originals.length) return { voucher, original: null, source: null };

      if (originals.length !== 1) throw new Error("Matching original is ambiguous");

      const original = originals[0];

      if (!original) throw new Error("Matching original is missing");

      const options = sourceDocumentOptions(book, original.occurrenceId);
      const source = await client.fetchQuery(options);

      if (source.occurrence.sha256 !== original.sha256)
        throw new BankOriginalChecksumMismatch(original.sha256);

      return { original, source, voucher };
    },
    retry: false,
  });
}

export function BankMatchOriginal(
  props: CommerceProps & {
    query: ReturnType<typeof useBankMatchOriginal>;
    onAvailabilityChange?: (available: boolean) => void;
  },
) {
  const { query, onAvailabilityChange } = props;
  const ownerSearch = useSearch({ from: "/entities/$entityId/books/$bookId/accounts" });
  const sv = props.locale === "sv";
  const [view, setView] = useState<PdfView>({ page: 1, zoom: 100 });

  if (query.isSuccess && query.data.source === null) return null;

  const retained = query.isSuccess && query.data.source !== null ? query.data : undefined;

  return (
    <Box display="grid" gap="md" minWidth="zero">
      {query.isPending ? (
        <PageCaption role="status">{sv ? "Visar sidan…" : "Rendering page…"}</PageCaption>
      ) : null}
      {query.isError ? (
        <Box display="grid" gap="md">
          <Text role="alert">
            {sv ? "Originalet kan inte visas" : "The original cannot be shown"}
          </Text>
          <Text>
            {query.error instanceof BankOriginalChecksumMismatch
              ? sv
                ? "Den hämtade filen stämmer inte med den sparade kontrollsumman. Ingen annan fil visas i stället."
                : "The fetched file does not match the stored checksum. No substitute file is shown."
              : sv
                ? "Originalet kan inte granskas. Matchningen kan inte förberedas."
                : "The original cannot be reviewed. The match cannot be prepared."}
          </Text>
          {query.error instanceof BankOriginalChecksumMismatch ? (
            <PageCaption title={query.error.expected}>
              {sv ? "Sparad SHA-256" : "Stored SHA-256"} {query.error.expected}
            </PageCaption>
          ) : null}
          <Box>
            <Button
              variant="outline"
              disabled={query.isFetching}
              onClick={() => void query.refetch()}
            >
              {sv ? "Försök igen" : "Try again"}
            </Button>
          </Box>
        </Box>
      ) : null}
      {retained ? (
        <>
          {retained.source.occurrence.mediaType === "application/pdf" ? (
            <PdfViewer
              workerUrl={workerUrl}
              content={retained.source.contentBase64}
              filename={retained.source.occurrence.filename}
              locale={props.locale}
              view={view}
              onViewChange={setView}
              presentation="bank"
              onAvailabilityChange={onAvailabilityChange}
            />
          ) : (
            <Text role="alert">
              {sv ? "Originalet kan inte visas" : "The original cannot be shown"}
            </Text>
          )}
          <PageCaption>{retained.source.occurrence.filename}</PageCaption>
          <Box>
            <Button
              variant="ghost"
              onClick={() =>
                downloadIntake(
                  new Blob(
                    [
                      Uint8Array.from(atob(retained.source.contentBase64), (char) =>
                        char.charCodeAt(0),
                      ),
                    ],
                    { type: retained.source.occurrence.mediaType },
                  ),
                  retained.source.occurrence.filename,
                )
              }
            >
              {sv ? "Ladda ned original" : "Download original"}
            </Button>
            <PageAction
              quiet
              compact
              href={`${workspacePath(props.book)}/books${defaultStringifySearch({ view: "vouchers", record: retained.voucher.id, returnTo: encodeOwnerReturn({ owner: "bank", search: ownerSearch }) })}`}
            >
              {sv ? "Öppna verifikation" : "Open voucher"}
            </PageAction>
          </Box>
        </>
      ) : null}
    </Box>
  );
}
