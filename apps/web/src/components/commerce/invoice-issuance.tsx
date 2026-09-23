import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import * as Drafts from "@open-erp/contracts/invoice-drafts";
import * as Issuance from "@open-erp/contracts/invoice-issuance";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { DataTable } from "@open-erp/ui/components/data-table";
import { Heading, Text } from "@open-erp/ui/components/typography";
import { AccountingStatus } from "@/components/accounting-status";
import { readAccounting } from "@/lib/accounting-api";
import { invoiceIssueCopy } from "./invoice-issue-copy";
import { InvoiceDocumentPanel } from "./invoice-documents";
import {
  CommandForm,
  Details,
  Evidence,
  Facts,
  Field,
  Lookup,
  checkScope,
  commerceKey,
  commercePath,
  type CommerceProps,
} from "./shared";

export function InvoiceIssuance(props: CommerceProps & { recordId?: string }) {
  return <IssueWorkspace key={`${props.book.entityId}:${props.book.id}:${props.recordId ?? ""}`} {...props} />;
}
function IssueWorkspace(props: CommerceProps & { recordId?: string }) {
  const copy = invoiceIssueCopy(props.locale);
  const [draftId, setDraftId] = useState(props.recordId ?? "");
  const [reviewId, setReviewId] = useState("");
  return (
    <Box display="grid" gap="lg" minWidth="zero">
      <Heading>{copy.title}</Heading>
      <Text>{copy.boundary}</Text>
      <Text tone="muted">{copy.requirements}</Text>
      <Text tone="muted">{copy.recovery}</Text>
      <Lookup label={copy.openDraft} onOpen={(id) => {
        setDraftId(id);
        setReviewId("");
      }} />
      {draftId ? <IssueDraft {...props} key={draftId} id={draftId} onOpen={setReviewId} /> : null}
      <Lookup label={copy.openReview} onOpen={setReviewId} />
      {reviewId ? <InvoiceIssueReviewPanel {...props} key={reviewId} id={reviewId} /> : null}
    </Box>
  );
}
function IssueDraft(props: CommerceProps & { id: string; onOpen: (id: string) => void }) {
  const { book, locale, id } = props;
  const copy = invoiceIssueCopy(locale);
  const draft = useQuery({
    queryKey: [...commerceKey(book), "issue-draft", id],
    queryFn: async ({ signal }) => {
      const result = await readAccounting(
        `${commercePath(book)}/invoice-drafts/${encodeURIComponent(id)}`,
        Drafts.InvoiceDraftView,
        { signal },
      );
      checkScope(book, result.record.scope);
      if (result.record.id !== id) throw new Error("Issue draft identity mismatch");
      return result;
    },
    retry: false,
  });
  const history = useQuery({
    queryKey: [...commerceKey(book), "invoice-issue-history", id],
    queryFn: async ({ signal }) => {
      const result = await readAccounting(
        `${commercePath(book)}/invoice-drafts/${encodeURIComponent(id)}/issue-reviews`,
        Issuance.InvoiceIssueHistory,
        { signal },
      );
      checkScope(book, result.scope);
      if (result.draftId !== id) throw new Error("Issue history draft mismatch");
      return result;
    },
    retry: false,
  });
  return (
    <Box display="grid" gap="lg" minWidth="zero">
      <Box>
        <Button variant="outline" disabled={draft.isFetching || history.isFetching} onClick={() => {
          void draft.refetch();
          void history.refetch();
        }}>{copy.refresh}</Button>
      </Box>
      <AccountingStatus locale={locale} pending={draft.isPending} error={draft.error} />
      {draft.isSuccess && history.isSuccess && !history.data.items.some((item) => item.issueId !== null) ? (
        <IssuePreparation {...props} draft={draft.data.record} />
      ) : null}
      <AccountingStatus locale={locale} pending={history.isPending} error={history.error} />
      {history.isSuccess ? (
        <>
          <DataTable title={copy.history} narrow="stack" columns={[
            { id: "id", label: copy.id },
            { id: "revision", label: copy.revision },
            { id: "created", label: copy.created },
            { id: "issued", label: copy.internal },
          ]} rows={history.data.items.map((item) => ({
            id: item.id,
            cells: [
              <Button key="open" variant="outline" onClick={() => props.onOpen(item.id)}>{item.id}</Button>,
              item.draftRevision,
              item.createdAt,
              item.internalDocumentNumber ?? copy.pending,
            ],
          }))} />
          {history.data.count === 0 ? <Text>{copy.empty}</Text> : null}
        </>
      ) : null}
    </Box>
  );
}
function SyntheticAcknowledgment({ locale }: { locale: CommerceProps["locale"] }) {
  const copy = invoiceIssueCopy(locale);
  return (
    <Box as="label" display="flex" alignItems="start" gap="md" padding="md">
      <input type="checkbox" name="acknowledgeSyntheticOnly" required />
      <span>{copy.acknowledge}</span>
    </Box>
  );
}
function IssuePreparation(props: CommerceProps & {
  draft: typeof Drafts.InvoiceDraftRevision.Type;
  onOpen: (id: string) => void;
}) {
  const copy = invoiceIssueCopy(props.locale);
  // Keep the expected revision and draft review stable while a command is pending or uncertain.
  const [draft] = useState(props.draft);
  return (
    <Details title={copy.prepare}>
      <Text>{copy.snapshot}</Text>
      <Text>{copy.draft}: {draft.id} · {copy.revision}: {draft.revision}</Text>
      <Text>{copy.customer}: {draft.content.customer.legalName}</Text>
      <Text>{copy.total}: {draft.totals.grossMinor ?? "—"} {draft.content.currency} · {copy.scale}: {draft.content.currencyScale}</Text>
      <Text>{copy.digest}: {draft.digest}</Text>
      <CommandForm {...props}
        path={`${commercePath(props.book)}/invoice-issue-reviews`}
        schema={Issuance.PrepareInvoiceIssue}
        output={Issuance.InvoiceIssueReview}
        label={copy.prepare}
        input={(fields) => ({
          profile: "synthetic-manual-invoice-v1",
          draftId: draft.id,
          expectedRevision: draft.revision,
          expectedDigest: draft.digest,
          controlAccountId: fields.get("controlAccountId"),
          creditAccountId: fields.get("creditAccountId"),
          accountingPeriodId: fields.get("accountingPeriodId"),
          series: fields.get("series"),
          reason: fields.get("reason"),
          acknowledgeSyntheticOnly: fields.get("acknowledgeSyntheticOnly") === "on",
        })}
        onSuccess={(review) => props.onOpen(review.id)}
      >
        <Field name="controlAccountId" label={copy.control} maxLength={128} />
        <Field name="creditAccountId" label={copy.credit} maxLength={128} />
        <Field name="accountingPeriodId" label={copy.period} maxLength={128} />
        <Field name="series" label={copy.series} maxLength={16} />
        <Field name="reason" label={copy.reason} />
        <SyntheticAcknowledgment locale={props.locale} />
      </CommandForm>
    </Details>
  );
}
export function InvoiceIssueReviewPanel(props: CommerceProps & { id: string; readOnly?: boolean }) {
  const { book, locale, id } = props;
  const copy = invoiceIssueCopy(locale);
  const review = useQuery({
    queryKey: [...commerceKey(book), "invoice-issue-review", id],
    queryFn: async ({ signal }) => {
      const result = await readAccounting(
        `${commercePath(book)}/invoice-issue-reviews/${encodeURIComponent(id)}`,
        Issuance.InvoiceIssueView,
        { signal },
      );
      checkScope(book, result.plan.scope);
      if (result.plan.id !== id) throw new Error("Issue review identity mismatch");
      if (result.issue) {
        checkScope(book, result.issue.scope);
        if (result.issue.reviewId !== id) throw new Error("Issue receipt review mismatch");
      }
      if (result.approval) {
        checkScope(book, result.approval.scope);
        if (result.approval.reviewId !== id) throw new Error("Issue approval review mismatch");
      }
      return result;
    },
    retry: false,
  });
  return (
    <Box display="grid" gap="lg" minWidth="zero">
      <Heading>{copy.review}</Heading>
      <Text>{copy.id}: {id}</Text>
      <Box><Button variant="outline" disabled={review.isFetching} onClick={() => {
        void review.refetch();
      }}>{copy.refresh}</Button></Box>
      <AccountingStatus locale={locale} pending={review.isPending} error={review.error} />
      {review.isSuccess ? <IssueContents {...props} view={review.data} /> : null}
    </Box>
  );
}
function IssueContents(props: CommerceProps & { view: typeof Issuance.InvoiceIssueView.Type; readOnly?: boolean }) {
  const { view, locale, book } = props;
  const { plan, approval, issue } = view;
  const copy = invoiceIssueCopy(locale);
  const draft = plan.draftSnapshot;
  const path = `${commercePath(book)}/invoice-issue-reviews/${encodeURIComponent(plan.id)}`;
  return (
    <Box display="grid" gap="lg" minWidth="zero">
      <Text>{copy.draft}: {draft.id} · {copy.revision}: {draft.revision}</Text>
      <Text>{copy.seller}: {draft.content.seller.legalName}</Text>
      <Text>{copy.customer}: {draft.content.customer.legalName}</Text>
      <Text>{copy.total}: {draft.totals.grossMinor} {draft.content.currency} · {copy.scale}: {draft.content.currencyScale}</Text>
      <Text>{copy.postingDate}: {draft.content.plannedIssueDate} · {copy.dueDate}: {draft.content.dueDate}</Text>
      <Text>{copy.digest}: {plan.digest}</Text>
      <Text>{plan.input.reason}</Text>
      <Text tone="muted">{copy.rules}</Text>
      <DataTable title={copy.commercialLines} narrow="stack" columns={[
        { id: "description", label: copy.description },
        { id: "quantity", label: copy.quantity, numeric: true },
        { id: "base", label: copy.base, numeric: true },
        { id: "discount", label: copy.discount, numeric: true },
        { id: "charge", label: copy.charge, numeric: true },
        { id: "tax", label: copy.tax, numeric: true },
        { id: "source", label: copy.sourceGross, numeric: true },
      ]} rows={draft.content.lines.map((line) => ({
        id: line.id,
        cells: [line.description, line.quantity, line.baseMinor, line.discountMinor, line.chargeMinor, line.taxMinor ?? "—", line.sourceGrossMinor ?? "—"],
      }))} />
      <Facts title={copy.draftFacts} value={draft} />
      <DataTable title={copy.posting} narrow="stack" columns={[
        { id: "account", label: copy.account },
        { id: "debit", label: copy.debit, numeric: true },
        { id: "credit", label: copy.creditAmount, numeric: true },
        { id: "description", label: copy.description },
      ]} rows={plan.postingPlan.groups.flatMap((group) => group.actions.flatMap((action) => action.lines.map((line) => ({
        id: `${group.id}:${line.lineId}`,
        cells: [line.accountId, line.debitMinor, line.creditMinor, line.description],
      }))))} />
      <Details title={copy.evidence}>
        <Evidence {...props} reference={{ evidenceId: plan.evidence.id, sha256: plan.evidence.sha256 }} />
      </Details>
      {view.blockers.length > 0 && !issue ? (
        <Box display="grid" gap="md">
          <Heading>{copy.blocked}</Heading>
          {view.blockers.map((blocker) => <Text key={blocker}>{blocker}</Text>)}
        </Box>
      ) : null}
      <Text>{copy.legal}: {plan.legalBlockers.join(" · ")}</Text>
      {issue ? (
        <Box display="grid" gap="md">
          <Text role="status">{copy.success}</Text>
          <Text>{copy.internal}: {issue.internalDocumentNumber}</Text>
          <Text>{copy.receipt}: {issue.postingReceipt.id}</Text>
          <Text>{copy.register}: {issue.registerInvoiceId}</Text>
          <InvoiceDocumentPanel book={book} locale={locale} issue={issue} />
        </Box>
      ) : props.readOnly ? null : (
        <>
          <Text>{copy.approvalNote}</Text>
          <CommandForm {...props} path={`${path}/approvals`}
            schema={Issuance.ApproveInvoiceIssue} output={Issuance.InvoiceIssueApproval}
            label={copy.approve} allowed={view.dependenciesCurrent}
            input={(fields) => ({ version: plan.version, digest: plan.digest, acknowledgeSyntheticOnly: fields.get("acknowledgeSyntheticOnly") === "on" })}
          ><SyntheticAcknowledgment locale={locale} /></CommandForm>
          {approval ? (
            <>
              <Text>{copy.operator}: {approval.actorId} · {copy.expires}: {approval.expiresAt}</Text>
              <Facts title={copy.approval} value={approval} />
              <CommandForm {...props} path={`${path}/execute`}
                schema={Issuance.ExecuteInvoiceIssue} output={Issuance.InvoiceIssueReceipt}
                label={copy.execute} allowed={view.approvalUsable}
                input={(fields) => ({ version: plan.version, digest: plan.digest, approvalId: approval.id, acknowledgeSyntheticOnly: fields.get("acknowledgeSyntheticOnly") === "on" })}
              ><SyntheticAcknowledgment locale={locale} /></CommandForm>
            </>
          ) : null}
          {!view.approvalUsable ? <Text>{copy.unavailable}</Text> : null}
        </>
      )}
      <Box><Button variant="outline" onClick={() => {
        const url = URL.createObjectURL(new Blob([JSON.stringify(view, null, 2)], { type: "application/json" }));
        const link = document.createElement("a");
        link.href = url;
        link.download = `${plan.id}.json`;
        document.body.append(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 0);
      }}>{copy.download}</Button></Box>
      <Facts title={copy.details} value={view} />
    </Box>
  );
}
