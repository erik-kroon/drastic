import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Documents from "@open-erp/contracts/invoice-documents";
import type * as Issuance from "@open-erp/contracts/invoice-issuance";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { Text } from "@open-erp/ui/components/typography";
import { AccountingStatus } from "@/components/accounting-status";
import { readAccounting } from "@/lib/accounting-api";
import { invoiceDocumentCopy } from "./invoice-document-copy";
import { CommandForm, Details, Facts, checkScope, commerceKey, commercePath, type CommerceProps } from "./shared";

export function InvoiceDocumentPanel(props: CommerceProps & { issue: typeof Issuance.InvoiceIssueReceipt.Type }) {
  return <DocumentPanel key={`${props.book.entityId}:${props.book.id}:${props.issue.id}`} {...props} />;
}
function DocumentPanel(props: CommerceProps & { issue: typeof Issuance.InvoiceIssueReceipt.Type }) {
  const { book, locale, issue } = props;
  const copy = invoiceDocumentCopy(locale);
  const [id, setId] = useState("");
  const history = useQuery({
    queryKey: [...commerceKey(book), "invoice-document-history", issue.id],
    queryFn: async ({ signal }) => {
      checkScope(book, issue.scope);
      const result = await readAccounting(`${commercePath(book)}/invoice-issues/${encodeURIComponent(issue.id)}/documents`, Documents.InvoiceDocumentHistory, { signal });
      checkScope(book, result.scope);
      if (result.issueId !== issue.id) throw new Error("Invoice document history identity mismatch");
      return result;
    }, retry: false,
  });
  const captured = history.data?.items[0];
  const selected = id || captured?.id;
  return <Details title={copy.title}>
    <Text>{copy.boundary}</Text>
    <Text tone="muted">{copy.historyMeaning}</Text>
    <Text>{copy.recovery}</Text>
    <Box><Button variant="outline" disabled={history.isFetching} onClick={() => { void history.refetch(); }}>{copy.refresh}</Button></Box>
    <AccountingStatus locale={locale} pending={history.isPending} error={history.error} />
    {history.isSuccess && history.data.items.length === 0 ? <Text>{copy.empty}</Text> : null}
    <CommandForm {...props} path={`${commercePath(book)}/invoice-documents`}
      schema={Documents.PrepareInvoiceDocument} output={Documents.InvoiceDocumentView}
      label={copy.prepare} allowed={history.isSuccess && !history.isFetching}
      input={() => ({ issueId: issue.id, issueDigest: issue.digest, generatorVersion: Documents.invoiceDocumentGenerator })}
      onSuccess={(view) => {
        checkScope(book, view.capture.scope);
        if (view.capture.input.issueId !== issue.id || view.capture.input.issueDigest !== issue.digest)
          throw new Error("Invoice document capture source mismatch");
        setId(view.capture.id);
      }} />
    {captured ? <Box display="grid" gap="sm">
      <Text>{copy.history}: {captured.id} · {captured.createdAt}</Text>
      <Box><Button variant="outline" onClick={() => setId(captured.id)}>{copy.open}</Button></Box>
    </Box> : null}
    {selected ? <InvoiceDocumentInspector {...props} key={selected} id={selected} /> : null}
  </Details>;
}
export function InvoiceDocumentInspector(props: CommerceProps & { id: string; issue?: typeof Issuance.InvoiceIssueReceipt.Type }) {
  const { book, locale, id, issue } = props;
  const copy = invoiceDocumentCopy(locale);
  const client = useQueryClient();
  const path = `${commercePath(book)}/invoice-documents/${encodeURIComponent(id)}`;
  const view = useQuery({
    queryKey: [...commerceKey(book), "invoice-document", id],
    queryFn: async ({ signal }) => {
      const result = await readAccounting(path, Documents.InvoiceDocumentView, { signal });
      checkScope(book, result.capture.scope);
      if (result.capture.id !== id || (issue && (result.capture.input.issueId !== issue.id || result.capture.input.issueDigest !== issue.digest)))
        throw new Error("Invoice document capture identity mismatch");
      return result;
    }, retry: false,
  });
  const resume = useMutation({
    mutationFn: () => readAccounting(`${path}/render`, Documents.InvoiceDocumentView, { method: "POST" }),
    onSettled: () => { void client.invalidateQueries({ queryKey: commerceKey(book) }); },
    retry: false,
  });
  const capture = view.data?.capture;
  const artifact = view.data?.artifact;
  return <Box display="grid" gap="lg" minWidth="zero">
    <Text>{copy.id}: {id}</Text>
    <Box><Button variant="outline" disabled={view.isFetching || resume.isPending} onClick={() => { void view.refetch(); }}>{copy.inspectAgain}</Button></Box>
    <AccountingStatus locale={locale} pending={view.isPending} error={view.error} />
    {capture ? <>
      <Text>{artifact ? copy.sealed : copy.captured}</Text>
      <Facts title={copy.source} value={capture} />
      {!artifact ? <Box><Button variant="outline" disabled={resume.isPending || !view.isSuccess || view.isFetching}
        onClick={() => resume.mutate()}>{copy.resume}</Button></Box> : null}
      <AccountingStatus locale={locale} write pending={resume.isPending} error={resume.error} />
      {artifact && view.isSuccess ? <VerifiedDocument {...props} key={`${id}:${artifact.sha256}`} capture={capture} artifact={artifact} /> : null}
    </> : null}
  </Box>;
}
function VerifiedDocument(props: CommerceProps & {
  capture: typeof Documents.InvoiceDocumentCapture.Type;
  artifact: typeof Documents.InvoiceDocumentArtifact.Type;
}) {
  const { book, locale, capture, artifact } = props;
  const copy = invoiceDocumentCopy(locale);
  const verification = useMutation({
    mutationFn: async () => {
      checkScope(book, capture.scope);
      checkScope(book, artifact.scope);
      checkScope(book, capture.source.issue.scope);
      checkScope(book, capture.source.review.scope);
      if (artifact.captureId !== capture.id || artifact.captureDigest !== capture.digest
        || artifact.sourceDigest !== capture.sourceDigest || artifact.issueId !== capture.input.issueId
        || artifact.issueDigest !== capture.input.issueDigest || artifact.issueDigest !== capture.source.issue.digest
        || artifact.issueId !== capture.source.issue.id || artifact.generatorVersion !== capture.generatorVersion
        || artifact.filename !== `${capture.id}.html` || artifact.byteLength < 1 || artifact.byteLength > Documents.invoiceDocumentMaxBytes
        || capture.source.issue.reviewId !== capture.source.review.id || capture.source.issue.reviewDigest !== capture.source.review.digest)
        throw new Error("Invoice document artifact identity mismatch");
      const binary = atob(artifact.contentBase64);
      if (btoa(binary) !== artifact.contentBase64) throw new Error("Noncanonical invoice document bytes");
      const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      const hash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
      if (bytes.length !== artifact.byteLength || hash !== artifact.sha256) throw new Error("Invoice document hash or length mismatch");
      const html = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      if (!html.startsWith("<!doctype html>\n") || !html.endsWith("</html>\n"))
        throw new Error("Invoice document format boundary mismatch");
      return { bytes, html };
    }, retry: false,
  });
  const verified = verification.data;
  const { contentBase64: retainedBytes, ...descriptor } = artifact;
  return <Box display="grid" gap="md" minWidth="zero">
    <Text>{artifact.filename} · {artifact.byteLength} {copy.bytes}</Text>
    <Facts title={copy.descriptor} value={descriptor} />
    <Box minWidth="zero"><textarea aria-label={copy.hash} readOnly value={artifact.sha256} rows={2} cols={16} /></Box>
    <Box><Button variant="outline" disabled={verification.isPending || Boolean(verified) || !retainedBytes}
      onClick={() => verification.mutate()}>{copy.verify}</Button></Box>
    <AccountingStatus locale={locale} pending={verification.isPending} error={verification.error} />
    {verified ? <>
      <Text role="status">{copy.verified}</Text>
      <a download={artifact.filename} ref={(anchor) => {
        if (!anchor) return;
        const url = URL.createObjectURL(new Blob([verified.bytes], { type: "text/html;charset=utf-8" }));
        anchor.href = url;
        return () => URL.revokeObjectURL(url);
      }}>{copy.save}</a>
      <iframe title={copy.preview} sandbox="" referrerPolicy="no-referrer" width="100%" height="640" srcDoc={verified.html} />
    </> : null}
  </Box>;
}
