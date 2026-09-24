import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { DocumentPreview } from "@open-erp/ui/components/document-preview";
import { PageAction, PageCaption } from "@open-erp/ui/components/accounting-page";
import { AccountingStatus } from "@/components/accounting-status";
import { downloadIntake } from "@/components/source-intake/download";
import { sourceDocumentOptions } from "@/lib/source-documents";
import type { CommerceProps } from "@/components/commerce/shared";
import { workspacePath } from "@/lib/book-context";

export function OriginalDocument(props: CommerceProps & { id: string; sha256?: string }) {
  const query = useQuery(sourceDocumentOptions(props.book, props.id));
  const source = query.data;
  const mismatch = source && props.sha256 && source.occurrence.sha256 !== props.sha256;
  const sv = props.locale === "sv";
  return (
    <Box display="grid" gap="lg" minWidth="zero">
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
      {source && !query.isError && !mismatch ? (
        <>
          <DocumentPreview
            content={source.contentBase64}
            mediaType={source.occurrence.mediaType}
            filename={source.occurrence.filename}
          />
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
          <PageCaption>{source.occurrence.filename}</PageCaption>
          <PageAction
            quiet
            href={`${workspacePath(props.book)}/purchases?view=documents&record=${encodeURIComponent(source.occurrence.id)}`}
          >
            {sv ? "Öppna originalets ärenden" : "Open work linked to original"}
          </PageAction>
        </>
      ) : null}
    </Box>
  );
}
