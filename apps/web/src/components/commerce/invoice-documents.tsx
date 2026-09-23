import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Documents from "@open-erp/contracts/invoice-documents";
import type * as Issuance from "@open-erp/contracts/invoice-issuance";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { HtmlDocumentPreview } from "@open-erp/ui/components/document-preview";
import { Disclosure } from "@open-erp/ui/components/disclosure";
import { FormActions } from "@open-erp/ui/components/form-actions";
import { Text } from "@open-erp/ui/components/typography";
import { AccountingStatus } from "@/components/accounting-status";
import { readAccounting } from "@/lib/accounting-api";
import { invoiceDocumentCopy } from "./invoice-document-copy";
import {
  CommandForm,
  Facts,
  checkScope,
  commerceKey,
  commercePath,
  type CommerceProps,
} from "./shared";

type IssuedDocumentProps = CommerceProps & { issue: typeof Issuance.InvoiceIssueReceipt.Type };
export function InvoiceDocumentPanel(props: IssuedDocumentProps) {
  return (
    <DocumentPanel key={`${props.book.entityId}:${props.book.id}:${props.issue.id}`} {...props} />
  );
}
function DocumentPanel(props: IssuedDocumentProps) {
  const { book, locale, issue } = props;
  const copy = invoiceDocumentCopy(locale);
  const [id, setId] = useState("");
  const history = useQuery({
    queryKey: [...commerceKey(book), "invoice-document-history", issue.id],
    queryFn: async ({ signal }) => {
      checkScope(book, issue.scope);
      const result = await readAccounting(
        `${commercePath(book)}/invoice-issues/${encodeURIComponent(issue.id)}/documents`,
        Documents.InvoiceDocumentHistory,
        { signal },
      );
      checkScope(book, result.scope);
      if (result.issueId !== issue.id)
        throw new Error("Invoice document history identity mismatch");
      return result;
    },
    retry: false,
  });
  const selected = id || history.data?.items[0]?.id;
  return (
    <Box display="grid" gap="md" minWidth="zero">
      <AccountingStatus locale={locale} pending={history.isPending} error={history.error} />
      {history.isError ? (
        <Box>
          <Button
            variant="outline"
            disabled={history.isFetching}
            onClick={() => {
              void history.refetch();
            }}
          >
            {copy.refresh}
          </Button>
        </Box>
      ) : null}
      {history.isSuccess && !selected ? (
        <>
          <Text tone="muted">{copy.empty}</Text>
          <CommandForm
            {...props}
            compact
            recoveryId={issue.id}
            path={`${commercePath(book)}/invoice-documents`}
            schema={Documents.PrepareInvoiceDocument}
            output={Documents.InvoiceDocumentView}
            label={copy.prepare}
            allowed={!history.isFetching}
            input={() => ({
              issueId: issue.id,
              issueDigest: issue.digest,
              generatorVersion: Documents.invoiceDocumentGenerator,
            })}
            onSuccess={(view) => {
              checkScope(book, view.capture.scope);
              if (
                view.capture.input.issueId !== issue.id ||
                view.capture.input.issueDigest !== issue.digest
              )
                throw new Error("Invoice document capture source mismatch");
              setId(view.capture.id);
            }}
          />
        </>
      ) : null}
      {selected && !history.isError ? (
        <InvoiceDocumentInspector {...props} key={selected} id={selected} />
      ) : null}
    </Box>
  );
}

export function InvoiceDocumentInspector(props: IssuedDocumentProps & { id: string }) {
  const { book, locale, id, issue } = props;
  const copy = invoiceDocumentCopy(locale);
  const client = useQueryClient();
  const path = `${commercePath(book)}/invoice-documents/${encodeURIComponent(id)}`;
  const view = useQuery({
    queryKey: [...commerceKey(book), "invoice-document", id, issue.id, issue.digest],
    queryFn: async ({ signal }) => {
      const result = await readAccounting(path, Documents.InvoiceDocumentView, { signal });
      checkScope(book, result.capture.scope);
      if (
        result.capture.id !== id ||
        result.capture.input.issueId !== issue.id ||
        result.capture.input.issueDigest !== issue.digest
      )
        throw new Error("Invoice document capture identity mismatch");
      return {
        ...result,
        verified: result.artifact
          ? await verifyDocument(book, result.capture, result.artifact)
          : null,
      };
    },
    retry: false,
  });
  const resume = useMutation({
    mutationFn: () =>
      readAccounting(`${path}/render`, Documents.InvoiceDocumentView, { method: "POST" }),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: commerceKey(book) });
    },
    retry: false,
  });
  return (
    <Box display="grid" gap="md" minWidth="zero">
      <AccountingStatus locale={locale} pending={view.isPending} error={view.error} />
      {view.isError ? (
        <Box>
          <Button
            variant="outline"
            disabled={view.isFetching}
            onClick={() => {
              void view.refetch();
            }}
          >
            {copy.refresh}
          </Button>
        </Box>
      ) : null}
      {view.isSuccess ? (
        <>
          {view.data.verified && view.data.artifact ? (
            <>
              <FormActions>
                <Box display="grid" gap="xs">
                  <Text role="status">{copy.verified}</Text>
                  <Text tone="muted">{copy.boundary}</Text>
                </Box>
                <Button
                  variant="outline"
                  disabled={view.isFetching}
                  onClick={() => {
                    const file = view.data;
                    if (!file.verified || !file.artifact) return;
                    const url = URL.createObjectURL(
                      new Blob([file.verified.bytes], { type: "text/html;charset=utf-8" }),
                    );
                    const link = document.createElement("a");
                    link.href = url;
                    link.download = file.artifact.filename;
                    document.body.append(link);
                    link.click();
                    link.remove();
                    window.setTimeout(() => URL.revokeObjectURL(url), 0);
                  }}
                >
                  {copy.save}
                </Button>
              </FormActions>
            </>
          ) : (
            <>
              <Text>{copy.captured}</Text>
              <Box>
                <Button
                  variant="outline"
                  disabled={resume.isPending || view.isFetching}
                  onClick={() => resume.mutate()}
                >
                  {copy.resume}
                </Button>
              </Box>
            </>
          )}
          <Box display="flex" flexWrap="wrap" gap="lg" minWidth="zero">
            {view.data.verified ? (
              <Disclosure label={copy.preview} variant="toolbar">
                <Box display="grid" gap="md" minWidth="zero">
                  <Text tone="muted">{copy.historyMeaning}</Text>
                  <HtmlDocumentPreview title={copy.preview} html={view.data.verified.html} />
                </Box>
              </Disclosure>
            ) : null}
            <Disclosure label={copy.source} variant="toolbar">
              <Box display="grid" gap="md" minWidth="zero">
                <Text tone="muted">{copy.recovery}</Text>
                <Box>
                  <Button
                    variant="outline"
                    disabled={view.isFetching || resume.isPending}
                    onClick={() => {
                      void view.refetch();
                    }}
                  >
                    {copy.refresh}
                  </Button>
                </Box>
                <Facts title={copy.title} value={view.data.capture} />
                {view.data.artifact ? (
                  <Facts
                    title={copy.descriptor}
                    value={{ ...view.data.artifact, contentBase64: undefined }}
                  />
                ) : null}
              </Box>
            </Disclosure>
          </Box>
        </>
      ) : null}
      <AccountingStatus locale={locale} write pending={resume.isPending} error={resume.error} />
    </Box>
  );
}

async function verifyDocument(
  book: CommerceProps["book"],
  capture: typeof Documents.InvoiceDocumentCapture.Type,
  artifact: typeof Documents.InvoiceDocumentArtifact.Type,
) {
  checkScope(book, artifact.scope);
  checkScope(book, capture.source.issue.scope);
  checkScope(book, capture.source.review.scope);
  if (
    artifact.captureId !== capture.id ||
    artifact.captureDigest !== capture.digest ||
    artifact.sourceDigest !== capture.sourceDigest ||
    artifact.issueId !== capture.input.issueId ||
    artifact.issueDigest !== capture.input.issueDigest ||
    artifact.issueDigest !== capture.source.issue.digest ||
    artifact.issueId !== capture.source.issue.id ||
    artifact.generatorVersion !== capture.generatorVersion ||
    artifact.filename !== `${capture.id}.html` ||
    artifact.byteLength < 1 ||
    artifact.byteLength > Documents.invoiceDocumentMaxBytes ||
    capture.source.issue.reviewId !== capture.source.review.id ||
    capture.source.issue.reviewDigest !== capture.source.review.digest
  )
    throw new Error("Invoice document artifact identity mismatch");
  const binary = atob(artifact.contentBase64);
  if (btoa(binary) !== artifact.contentBase64)
    throw new Error("Noncanonical invoice document bytes");
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hash = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  if (bytes.length !== artifact.byteLength || hash !== artifact.sha256)
    throw new Error("Invoice document hash or length mismatch");
  const html = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (!html.startsWith("<!doctype html>\n") || !html.endsWith("</html>\n"))
    throw new Error("Invoice document format boundary mismatch");
  return { bytes, html };
}
