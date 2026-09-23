import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Cancellation from "@open-erp/contracts/invoice-cancellations";
import type * as Issuance from "@open-erp/contracts/invoice-issuance";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { DataTable } from "@open-erp/ui/components/data-table";
import { InputField, SelectField } from "@open-erp/ui/components/field";
import { RecordFact, RecordHeading, RecordSection, RecordSummary } from "@open-erp/ui/components/record-layout";
import { Text } from "@open-erp/ui/components/typography";
import { AccountingStatus } from "@/components/accounting-status";
import { bookKey, bookPath, readAccounting } from "@/lib/accounting-api";
import { invoiceCancellationCopy } from "./invoice-cancellation-copy";
import { CommandForm, Details, Evidence, Facts, Lookup, checkScope, commerceKey, commercePath, type CommerceProps } from "./shared";

type Issue = typeof Issuance.InvoiceIssueReceipt.Type;
export function InvoiceCancellationPanel(props: CommerceProps & { issue: Issue }) {
  return <CancellationPanel key={`${props.book.entityId}:${props.book.id}:${props.issue.id}`} {...props} />;
}
function CancellationPanel(props: CommerceProps & { issue: Issue }) {
  const { book, locale, issue } = props;
  const copy = invoiceCancellationCopy(locale);
  const [reviewId, setReviewId] = useState("");
  const status = useQuery({
    queryKey: [...commerceKey(book), "invoice-cancellation-status", issue.id],
    staleTime: 0,
    refetchOnMount: "always",
    queryFn: async ({ signal }) => {
      const result = await readAccounting(`${commercePath(book)}/invoice-issues/${encodeURIComponent(issue.id)}/cancellation-status`, Cancellation.InvoiceCancellationStatus, { signal });
      checkScope(book, result.scope);
      checkScope(book, result.issue.scope);
      if (result.issue.id !== issue.id || result.issue.digest !== issue.digest) throw new Error("Cancellation source identity mismatch");
      if (result.cancellation) {
        checkScope(book, result.cancellation.scope);
        if (result.cancellation.issueId !== issue.id || result.cancellation.registerInvoiceId !== issue.registerInvoiceId
          || result.cancellation.originalVoucherId !== issue.postingReceipt.voucherId) throw new Error("Cancellation target identity mismatch");
      }
      return result;
    },
    retry: false,
  });
  const ready = status.isSuccess && status.isFetchedAfterMount && status.fetchStatus === "idle";
  return <RecordSection title={copy.title}>
    <Text>{copy.boundary}</Text>
    <Text tone="muted">{copy.retained}</Text>
    <Box><Button variant="outline" disabled={status.isFetching} onClick={() => { void status.refetch(); }}>{copy.refresh}</Button></Box>
    <AccountingStatus locale={locale} pending={status.isPending} error={status.error} />
    <Text role="status">{!ready ? copy.unknown : status.data.cancellation ? copy.cancelled : copy.active}</Text>
    {status.data?.cancellation ? <Facts title={copy.receipt} value={status.data.cancellation} /> : null}
    {book.role !== "operator" ? <Text>{copy.operator}</Text> : null}
    {status.data ? <Details title={copy.prepare}>
      <CancellationPreparation {...props} allowed={ready && !status.data.cancellation && book.role === "operator"} onOpen={setReviewId} />
    </Details> : null}
    {status.data ? <Details title={copy.history}>
      {status.data.reviews.length === 0 ? <Text>{copy.empty}</Text> : null}
      {status.data.reviews.map((review) => <Box key={review.id} display="grid" gap="sm">
        <Button variant="outline" onClick={() => setReviewId(review.id)}>{copy.review} · {review.createdAt}</Button>
        <Text>{review.reason}</Text>
      </Box>)}
    </Details> : null}
    <Details title={copy.recover}><Lookup label={copy.recover} onOpen={setReviewId} /></Details>
    {reviewId ? <InvoiceCancellationReviewPanel {...props} key={reviewId} id={reviewId} /> : null}
  </RecordSection>;
}
function CancellationAcknowledgment({ locale }: Pick<CommerceProps, "locale">) {
  return <Box as="label" display="flex" alignItems="start" gap="md" padding="md">
    <input type="checkbox" name="acknowledgeSyntheticOnly" required />
    <span>{invoiceCancellationCopy(locale).acknowledge}</span>
  </Box>;
}
function CancellationPreparation(props: CommerceProps & { issue: Issue; allowed: boolean; onOpen: (id: string) => void }) {
  const { book, locale, issue } = props;
  const copy = invoiceCancellationCopy(locale);
  const setup = useQuery({
    queryKey: [...bookKey(book), "setup"],
    staleTime: 0,
    refetchOnMount: "always",
    queryFn: ({ signal }) => readAccounting(`${bookPath(book)}/setup`, Accounting.BookSetup, { signal }),
    retry: false,
  });
  return <Box display="grid" gap="lg">
    <Text>{copy.requirements}</Text>
    <AccountingStatus locale={locale} pending={setup.isPending} error={setup.error} />
    <CommandForm {...props} path={`${commercePath(book)}/invoice-cancellation-reviews`}
      schema={Cancellation.PrepareInvoiceCancellation} output={Cancellation.InvoiceCancellationReview}
      label={copy.prepare} allowed={props.allowed} canSubmit={setup.isSuccess && setup.fetchStatus === "idle" && setup.isFetchedAfterMount}
      input={(fields) => ({ issueId: issue.id, issueDigest: issue.digest, accountingPeriodId: fields.get("accountingPeriodId"),
        postingDate: fields.get("postingDate"), reason: fields.get("reason"), acknowledgeSyntheticOnly: fields.get("acknowledgeSyntheticOnly") === "on" })}
      onSuccess={(review) => props.onOpen(review.id)}>
      <SelectField name="accountingPeriodId" label={copy.period} required options={[
        { value: "", label: "—" }, ...(setup.data?.periods.filter((period) => !period.locked).map((period) => ({ value: period.id, label: `${period.startsOn} – ${period.endsOn}` })) ?? []),
      ]} />
      <InputField name="postingDate" type="date" label={copy.date} required />
      <InputField name="reason" label={copy.reason} required maxLength={2000} />
      <CancellationAcknowledgment locale={locale} />
    </CommandForm>
  </Box>;
}
export function InvoiceCancellationReviewPanel(props: CommerceProps & { id: string }) {
  const { book, locale, id } = props;
  const copy = invoiceCancellationCopy(locale);
  const review = useQuery({
    queryKey: [...commerceKey(book), "invoice-cancellation-review", id],
    staleTime: 0,
    refetchOnMount: "always",
    queryFn: async ({ signal }) => {
      const result = await readAccounting(`${commercePath(book)}/invoice-cancellation-reviews/${encodeURIComponent(id)}`, Cancellation.InvoiceCancellationView, { signal });
      checkScope(book, result.review.scope);
      checkScope(book, result.review.snapshot.issue.scope);
      checkScope(book, result.review.snapshot.invoice.scope);
      if (result.review.id !== id || result.review.input.issueId !== result.review.snapshot.issue.id
        || result.review.snapshot.invoice.id !== result.review.snapshot.issue.registerInvoiceId) throw new Error("Cancellation review identity mismatch");
      if (result.approval) {
        checkScope(book, result.approval.scope);
        if (result.approval.reviewId !== id || result.approval.digest !== result.review.digest) throw new Error("Cancellation approval identity mismatch");
      }
      if (result.cancellation) {
        checkScope(book, result.cancellation.scope);
        if (result.cancellation.issueId !== result.review.input.issueId) throw new Error("Cancellation receipt identity mismatch");
      }
      return result;
    },
    retry: false,
  });
  return <Box display="grid" gap="lg" minWidth="zero">
    <RecordHeading title={copy.review} />
    <Box><Button variant="outline" disabled={review.isFetching} onClick={() => { void review.refetch(); }}>{copy.refresh}</Button></Box>
    <AccountingStatus locale={locale} pending={review.isPending} error={review.error} />
    {review.data ? <CancellationReviewContents {...props} view={review.data}
      ready={review.isSuccess && review.isFetchedAfterMount && review.fetchStatus === "idle"} /> : null}
  </Box>;
}
function CancellationReviewContents(props: CommerceProps & { view: typeof Cancellation.InvoiceCancellationView.Type; ready: boolean }) {
  const { book, locale, view, ready } = props;
  const copy = invoiceCancellationCopy(locale);
  const client = useQueryClient();
  const { review, approval, cancellation } = view;
  const posting = review.postingPlan.groups[0]?.actions[0];
  const current = ready && view.dependenciesCurrent && !cancellation;
  const path = `${commercePath(book)}/invoice-cancellation-reviews/${encodeURIComponent(review.id)}`;
  const refresh = () => { void client.invalidateQueries({ queryKey: bookKey(book) }); };
  return <Box display="grid" gap="lg" minWidth="zero">
    <Text role="status">{cancellation ? copy.cancelled : !ready ? copy.unknown : view.dependenciesCurrent ? copy.ready : copy.stale}</Text>
    <RecordSummary>
      <RecordFact label={copy.original}>{review.snapshot.issue.internalDocumentNumber}</RecordFact>
      <RecordFact label={copy.reason}>{review.input.reason}</RecordFact>
      <RecordFact label={copy.date}>{review.input.postingDate}</RecordFact>
      <RecordFact label={copy.period}>{review.input.accountingPeriodId}</RecordFact>
    </RecordSummary>
    <Text>{copy.digest}: {review.digest}</Text>
    {posting ? <DataTable title={copy.posting} narrow="stack" columns={[
      { id: "account", label: copy.account }, { id: "debit", label: copy.debit, numeric: true }, { id: "credit", label: copy.credit, numeric: true },
    ]} rows={posting.lines.map((line) => ({ id: line.lineId, cells: [line.accountId, line.debitMinor, line.creditMinor] }))} /> : null}
    <Details title={copy.evidence}><Evidence {...props} reference={review.snapshot.invoice.evidence} /></Details>
    <Facts title={copy.invoice} value={review.snapshot} />
    <Facts title={copy.journal} value={review.postingPlan} />
    <Facts title={copy.approvals} value={view.approvals} />
    {cancellation ? <Facts title={copy.receipt} value={cancellation} /> : null}
    {book.role !== "operator" ? <Text>{copy.operator}</Text> : null}
    <Text>{copy.authority}</Text>
    <CommandForm {...props} path={`${path}/approve`} schema={Cancellation.ApproveInvoiceCancellation}
      output={Cancellation.InvoiceCancellationApproval} label={copy.approve} allowed={current && book.role === "operator"}
      input={(fields) => ({ version: 1, digest: review.digest, acknowledgeSyntheticOnly: fields.get("acknowledgeSyntheticOnly") === "on" })}
      onSuccess={refresh}>
      <CancellationAcknowledgment locale={locale} />
    </CommandForm>
    {/* Keep captured requests mounted after approval changes, revocation or another review's success. */}
    {view.approvals.map((entry) => <Box key={entry.approval.id} display="grid" gap="lg">
      <Text>{copy.expires}: {entry.approval.expiresAt} · {entry.approval.actorId} · {entry.approval.id}</Text>
      <CommandForm {...props} path={`${path}/execute`} schema={Cancellation.ExecuteInvoiceCancellation}
        output={Cancellation.InvoiceCancellationReceipt} label={copy.execute}
        allowed={current && book.role === "operator" && view.approvalUsable && approval?.id === entry.approval.id}
        input={(fields) => ({ version: 1, digest: review.digest, approvalId: entry.approval.id, acknowledgeSyntheticOnly: fields.get("acknowledgeSyntheticOnly") === "on" })}
        onSuccess={refresh}>
        <CancellationAcknowledgment locale={locale} />
      </CommandForm>
      <CommandForm {...props} path={`${commercePath(book)}/invoice-cancellation-approvals/${encodeURIComponent(entry.approval.id)}/revoke`}
        schema={Cancellation.RevokeInvoiceCancellationApproval} output={Cancellation.InvoiceCancellationRevocation}
        label={copy.revoke} allowed={ready && book.role === "operator" && !cancellation && !entry.revocation}
        input={(fields) => ({ reason: fields.get("reason") })} onSuccess={refresh}>
        <InputField name="reason" label={copy.revokeReason} required maxLength={2000} />
      </CommandForm>
    </Box>)}
  </Box>;
}
