import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import workerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";
import { Download } from "lucide-react";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { PdfThumbnail } from "@open-erp/ui/components/pdf-thumbnail";
import { DocumentPreview } from "@open-erp/ui/components/document-preview";
import { PdfViewer, type PdfView } from "@open-erp/ui/components/pdf-viewer";
import { PageAction, PageCaption } from "@open-erp/ui/components/accounting-page";
import { AccountingStatus } from "@/components/accounting-status";
import { downloadIntake } from "@/components/source-intake/download";
import { sourceDocumentOptions } from "@/lib/source-documents";
import type { CommerceProps } from "@/components/commerce/shared";
import { useWorkReturn, workReturnHref } from "@/lib/work-return";
import { workspacePath } from "@/lib/book-context";
import type * as Extraction from "@open-erp/contracts/supplier-extraction";

export function OriginalDocument(
  props: CommerceProps & {
    id: string;
    sha256?: string;
    compact?: boolean;
    presentation?: "focused";
    archive?: boolean;
    view?: PdfView;
    onViewChange?: (view: PdfView) => void;
    quote?: Pick<typeof Extraction.DocumentSourceLocator.Type, "page" | "quote" | "region">;
  },
) {
  const work = useWorkReturn();
  const query = useQuery(sourceDocumentOptions(props.book, props.id));
  const source = query.data;
  const mismatch = source && props.sha256 && source.occurrence.sha256 !== props.sha256;
  const sv = props.locale === "sv";

  const actions = source ? (
    <>
      {!props.compact ? (
        <Box>
          <Button
            variant="outline"
            onClick={() =>
              downloadIntake(
                new Blob(
                  [Uint8Array.from(atob(source.contentBase64), (char) => char.charCodeAt(0))],
                  { type: source.occurrence.mediaType },
                ),
                source.occurrence.filename,
              )
            }
          >
            <Download size={14} strokeWidth={1.5} />
            {sv ? "Ladda ned original" : "Download original"}
          </Button>
        </Box>
      ) : null}
      {!props.archive ? <PageCaption>{source.occurrence.filename}</PageCaption> : null}
      {props.quote && props.quote.page === props.view?.page ? (
        <PageCaption>
          {sv ? "Sida" : "Page"} {props.quote.page}: “{props.quote.quote}”
          {!props.quote.region
            ? sv
              ? " Källmarkering saknas."
              : " Source highlight unavailable."
            : null}
        </PageCaption>
      ) : null}
      {!props.compact ? (
        <PageAction
          quiet
          compact={props.presentation === "focused"}
          href={`${workReturnHref(`${workspacePath(props.book)}/purchases`, "documents", work)}&record=${encodeURIComponent(source.occurrence.id)}`}
        >
          {sv ? "Öppna originalets ärenden" : "Open work linked to original"}
        </PageAction>
      ) : null}
    </>
  ) : null;

  return (
    <Box
      display="grid"
      gap={props.compact || props.presentation === "focused" ? "sm" : "lg"}
      minWidth="zero"
    >
      <AccountingStatus
        locale={props.locale}
        pending={query.isPending}
        error={
          mismatch
            ? new Error(
                sv
                  ? "Originalet stämmer inte med det sparade underlaget."
                  : "The original does not match the retained source.",
              )
            : query.error
        }
      />
      {query.isError ? (
        <Box>
          <Button
            static
            variant="outline"
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            {sv ? "Försök läsa originalet igen" : "Retry original"}
          </Button>
        </Box>
      ) : null}
      {source && !query.isError && !mismatch ? (
        <>
          <OriginalPreview
            key={`${props.book.entityId}/${props.book.id}/${props.id}/${source.occurrence.sha256}`}
            {...props}
            content={source.contentBase64}
            mediaType={source.occurrence.mediaType}
            filename={source.occurrence.filename}
          />
          {props.presentation === "focused" ? (
            <Box display="grid" gap="lg" minWidth="zero">
              {actions}
            </Box>
          ) : (
            actions
          )}
        </>
      ) : null}
    </Box>
  );
}

function OriginalPreview(props: {
  content: string;
  mediaType: string;
  filename: string;
  locale: "sv" | "en";
  compact?: boolean;
  archive?: boolean;
  view?: PdfView;
  onViewChange?: (view: PdfView) => void;
  presentation?: "focused";
  quote?: Pick<typeof Extraction.DocumentSourceLocator.Type, "page" | "quote" | "region">;
}) {
  const [view, setView] = useState<PdfView>({ page: 1, zoom: 100 });

  if (props.mediaType === "application/pdf") {
    if (props.archive)
      return (
        <PdfThumbnail content={props.content} filename={props.filename} locale={props.locale} />
      );

    return (
      <PdfViewer
        workerUrl={workerUrl}
        content={props.content}
        filename={props.filename}
        locale={props.locale}
        view={props.view ?? view}
        onViewChange={props.onViewChange ?? setView}
        presentation={props.presentation}
        highlight={
          props.quote?.region
            ? { page: props.quote.page, region: props.quote.region, quote: props.quote.quote }
            : undefined
        }
      />
    );
  }

  return (
    <DocumentPreview
      {...props}
      highlight={
        props.quote?.region && props.quote.page === 1
          ? {
              region: props.quote.region,
              quote: props.quote.quote,
              label: props.locale === "sv" ? "Källmarkering" : "Source highlight",
            }
          : undefined
      }
    />
  );
}
