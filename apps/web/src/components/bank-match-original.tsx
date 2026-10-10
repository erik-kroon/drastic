import { bookScope } from "@/lib/contract-client";
import { useState } from "react";
import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import workerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";
import * as Accounting from "@open-erp/contracts/accounting";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { Text } from "@open-erp/ui/components/typography";
import { PdfViewer, type PdfView } from "@open-erp/ui/components/pdf-viewer";
import { PageCaption } from "@open-erp/ui/components/accounting-page";
import { bookKey, readAccounting } from "@/lib/accounting-api";
import { enteredExpenseDocument, sourceDocumentOptions } from "@/lib/source-documents";
import { downloadIntake } from "@/components/source-intake/download";
import type { CommerceProps } from "@/components/commerce/shared";
import { useSearch, defaultStringifySearch } from "@tanstack/react-router";
import { encodeOwnerReturn } from "@/lib/work-return";
import { workspacePath } from "@/lib/book-context";
import {
  BankReviewLink,
  BankReviewTextAction,
  BankReviewOriginalRefusal,
  BankReviewOriginalFooter,
  BankReviewCaption,
} from "@open-erp/ui/components/bank-evidence-review";

class BankOriginalChecksumMismatch extends Error {
  constructor(
    readonly expected: string,
    readonly voucher: typeof Accounting.Voucher.Type,
    readonly document: NonNullable<ReturnType<typeof enteredExpenseDocument>>,
  ) {
    super("Matching original checksum mismatch");
  }
}

function bankMatchDocumentOptions(
  book: CommerceProps["book"],
  selection?: { voucherId: string; lineId: string },
) {
  const voucherId = selection?.voucherId;
  const lineId = selection?.lineId;

  return queryOptions({
    queryKey: [...bookKey(book), "bank-match-document", voucherId, lineId],
    enabled: !!voucherId && !!lineId,
    queryFn: ({ signal }) => readBankMatchDocument(book, selection, signal),
    retry: false,
  });
}

async function readBankMatchDocument(
  book: CommerceProps["book"],
  selection: { voucherId: string; lineId: string } | undefined,
  signal: AbortSignal,
) {
  const voucherId = selection?.voucherId;
  const lineId = selection?.lineId;

  if (!voucherId || !lineId) throw new Error("Matching selection is missing");

  const voucher = await readAccounting(
    (client) => client.accounting.getVoucher({ params: { ...bookScope(book), id: voucherId } }),
    Accounting.Voucher,
    { signal },
  );

  if (voucher.id !== voucherId || !voucher.action.lines.some((line) => line.lineId === lineId))
    throw new Error("Matching voucher identity mismatch");

  const originals = [];

  for (const reference of voucher.action.evidenceRefs) {
    const evidence = await readAccounting(
      (client) =>
        client.accounting.getEvidence({ params: { ...bookScope(book), id: reference.evidenceId } }),
      Accounting.EvidenceContent,
      { signal },
    );

    if (evidence.id !== reference.evidenceId || evidence.sha256 !== reference.sha256)
      throw new Error("Matching evidence identity mismatch");

    const document =
      evidence.mediaType === "application/json" ? enteredExpenseDocument(evidence.content) : null;

    if (document?.source) originals.push(document);
  }

  if (!originals.length) return { voucher, document: null };

  if (originals.length !== 1) throw new Error("Matching original is ambiguous");

  const document = originals[0];

  if (!document) throw new Error("Matching original is missing");

  return { voucher, document };
}

export function useBankMatchDocument(
  props: CommerceProps & { selection: { voucherId: string; lineId: string } },
) {
  return useQuery(bankMatchDocumentOptions(props.book, props.selection));
}

export function useBankMatchOriginal(
  props: CommerceProps & { selection?: { voucherId: string; lineId: string } },
) {
  const { book, selection } = props;
  const client = useQueryClient();

  return useQuery({
    queryKey: [...bookKey(book), "bank-match-original", selection?.voucherId, selection?.lineId],
    enabled: !!selection,
    queryFn: async ({ signal }) => {
      const { voucher, document } = await readBankMatchDocument(book, selection, signal);

      const original = document?.source;

      if (!original) return { voucher, document, original: null, source: null };

      const options = sourceDocumentOptions(book, original.occurrenceId);
      const source = await client.fetchQuery(options);

      if (source.occurrence.sha256 !== original.sha256)
        throw new BankOriginalChecksumMismatch(original.sha256, voucher, document);

      return { original, source, voucher, document };
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
  const refused = query.error instanceof BankOriginalChecksumMismatch ? query.error : undefined;
  const voucher = retained?.voucher ?? refused?.voucher;
  const filename = retained?.source.occurrence.filename ?? refused?.document.source?.filename;

  return (
    <Box display="grid" gap="xl" minWidth="zero">
      {query.isPending ? (
        <PageCaption role="status">{sv ? "Visar sidan…" : "Rendering page…"}</PageCaption>
      ) : null}
      {query.isError ? (
        <BankOriginalRefusal
          sv={sv}
          refused={refused}
          pending={query.isFetching}
          onRetry={() => void query.refetch()}
        />
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
          <BankReviewOriginalFooter>
            <BankReviewCaption>{filename}</BankReviewCaption>
            <Box display="flex" gap="xl">
              <BankReviewTextAction
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
              </BankReviewTextAction>
              <BankReviewLink
                href={`${workspacePath(props.book)}/books${defaultStringifySearch({ view: "vouchers", record: retained.voucher.id, returnTo: encodeOwnerReturn({ owner: "bank", search: ownerSearch }) })}`}
              >
                {sv ? "Öppna verifikation" : "Open voucher"}
              </BankReviewLink>
            </Box>
          </BankReviewOriginalFooter>
        </>
      ) : null}
      {refused && voucher ? (
        <BankReviewOriginalFooter>
          <BankReviewCaption>{filename}</BankReviewCaption>
          <BankReviewLink
            href={`${workspacePath(props.book)}/books${defaultStringifySearch({ view: "vouchers", record: voucher.id, returnTo: encodeOwnerReturn({ owner: "bank", search: ownerSearch }) })}`}
          >
            {sv ? "Öppna verifikation" : "Open voucher"}
          </BankReviewLink>
        </BankReviewOriginalFooter>
      ) : null}
    </Box>
  );
}

function BankOriginalRefusal({
  sv,
  refused,
  pending,
  onRetry,
}: {
  sv: boolean;
  refused?: BankOriginalChecksumMismatch;
  pending: boolean;
  onRetry: () => void;
}) {
  return (
    <BankReviewOriginalRefusal
      title={sv ? "Originalet kan inte visas" : "The original cannot be shown"}
      description={
        refused
          ? sv
            ? "Den hämtade filen stämmer inte med den sparade kontrollsumman. Ingen annan fil visas i stället."
            : "The fetched file does not match the stored checksum. No substitute file is shown."
          : sv
            ? "Originalet kan inte granskas. Matchningen kan inte förberedas."
            : "The original cannot be reviewed. The match cannot be prepared."
      }
      checksum={refused?.expected}
      action={
        <Button variant="outline" size="sm" disabled={pending} onClick={onRetry}>
          {sv ? "Försök igen" : "Try again"}
        </Button>
      }
    />
  );
}
