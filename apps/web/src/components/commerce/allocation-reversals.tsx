import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as Reversal from "@open-erp/contracts/commerce-allocation-reversals";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { DataTable } from "@open-erp/ui/components/data-table";
import { Heading, Text } from "@open-erp/ui/components/typography";
import { AccountingStatus } from "@/components/accounting-status";
import { bookKey, readAccounting } from "@/lib/accounting-api";
import { allocationReversalCopy } from "./allocation-reversal-copy";
import {
  CommandForm, Details, Evidence, Facts, Field, Lookup, Pager,
  checkScope, commerceKey, commercePath, type CommerceProps,
} from "./shared";

export function CommerceAllocationReversals(props: CommerceProps & { receiptId?: string }) {
  return <ReversalWorkspace key={`${props.book.entityId}:${props.book.id}:${props.receiptId ?? ""}`} {...props} />;
}
function ReversalWorkspace(props: CommerceProps & { receiptId?: string }) {
  const { book, locale } = props;
  const copy = allocationReversalCopy(locale);
  const [receiptId, setReceiptId] = useState(props.receiptId ?? "");
  const [planId, setPlanId] = useState("");
  const [reportId, setReportId] = useState("");
  const [after, setAfter] = useState("");
  const history = useQuery({
    queryKey: [...commerceKey(book), "unallocation-history", after],
    queryFn: ({ signal }) => readAccounting(
      `${commercePath(book)}/allocation-reversal-plans${after ? `?after=${encodeURIComponent(after)}` : ""}`,
      Reversal.CommerceAllocationReversalList, { signal },
    ),
    retry: false,
  });
  return (
    <Box display="grid" gap="lg" minWidth="zero">
      <Heading>{copy.title}</Heading>
      <Text>{copy.boundary}</Text>
      <Text tone="muted">{copy.impact}</Text>
      <Lookup label={copy.receipt} onOpen={(id) => { setReceiptId(id); setPlanId(""); }} />
      {receiptId ? <AllocationReleaseStatus {...props} key={receiptId} id={receiptId} onOpen={setPlanId} /> : null}
      <Lookup label={copy.plan} onOpen={setPlanId} />
      {planId ? <CommerceAllocationReversalReview {...props} key={planId} id={planId} /> : null}
      <Details title={copy.history}>
        <Text>{copy.live}</Text>
        <Box><Button variant="outline" disabled={history.isFetching} onClick={() => { void history.refetch(); }}>{copy.refresh}</Button></Box>
        <AccountingStatus locale={locale} pending={history.isPending} error={history.error} />
        {history.isSuccess ? <>
          <DataTable title={copy.history} narrow="stack" columns={[
            { id: "id", label: copy.plan }, { id: "receipt", label: copy.receipt },
            { id: "created", label: copy.created }, { id: "state", label: copy.state },
          ]} rows={history.data.items.map((item) => ({
            id: item.id,
            cells: [<Button key="open" variant="outline" onClick={() => setPlanId(item.id)}>{item.id}</Button>,
              item.receiptId, item.createdAt, item.execution ? copy.reversed : copy.pending],
          }))} />
          {history.data.items.length === 0 ? <Text>{copy.empty}</Text> : null}
          <Pager locale={locale} first={!after} next={history.data.next} onPage={setAfter} />
        </> : null}
      </Details>
      <Details title={copy.report}>
        <Lookup label={copy.report} onOpen={setReportId} />
        {reportId ? <CommerceRegisterAllocationStatus {...props} key={reportId} id={reportId} /> : null}
      </Details>
    </Box>
  );
}
export function AllocationReleaseStatus(props: CommerceProps & { id: string; onOpen?: (id: string) => void }) {
  const { book, locale, id } = props;
  const copy = allocationReversalCopy(locale);
  const status = useQuery({
    queryKey: [...commerceKey(book), "allocation-release-status", id],
    queryFn: async ({ signal }) => {
      const result = await readAccounting(`${commercePath(book)}/allocation-receipts/${encodeURIComponent(id)}/status`, Reversal.CommerceAllocationStatus, { signal });
      checkScope(book, result.original.scope);
      if (result.original.id !== id) throw new Error("Allocation receipt identity mismatch");
      if (result.reversal) {
        checkScope(book, result.reversal.scope);
        if (result.reversal.receiptId !== id) throw new Error("Unallocation target mismatch");
      }
      return result;
    },
    retry: false,
  });
  const ready = status.isSuccess && status.isFetchedAfterMount && !status.isFetching;
  return <Box display="grid" gap="lg" minWidth="zero">
    <Heading>{copy.receipt}: {id}</Heading>
    <Box><Button variant="outline" disabled={status.isFetching} onClick={() => { void status.refetch(); }}>{copy.refresh}</Button></Box>
    <AccountingStatus locale={locale} pending={status.isPending} error={status.error} />
    {status.data ? <>
      <Text role="status">{!ready ? copy.unknown : status.data.active ? copy.active : copy.reversed}</Text>
      <Facts title={copy.original} value={status.data.original} />
      {status.data.reversal ? <Facts title={copy.execution} value={status.data.reversal} /> : null}
      {status.data.plans.map((plan) => props.onOpen ? <Box key={plan.id}>
        <Button variant="outline" onClick={() => props.onOpen?.(plan.id)}>{copy.plan}: {plan.id}</Button>
        <Text>{plan.reason} · {plan.createdAt}</Text>
      </Box> : <Text key={plan.id}>{plan.id} · {plan.reason}</Text>)}
      {props.onOpen && status.data.active ? <Details title={copy.prepare}>
        <CommandForm {...props} path={`${commercePath(book)}/allocation-reversal-plans`}
          schema={Reversal.PrepareCommerceAllocationReversal} output={Reversal.CommerceAllocationReversalPlan}
          label={copy.prepare} allowed={ready} input={(fields) => ({ receiptId: id, reason: fields.get("reason") })}
          onSuccess={(plan) => props.onOpen?.(plan.id)}>
          <Field name="reason" label={copy.reason} />
        </CommandForm>
      </Details> : null}
    </> : null}
  </Box>;
}
export function CommerceAllocationReversalReview(props: CommerceProps & { id: string }) {
  const { book, locale, id } = props;
  const copy = allocationReversalCopy(locale);
  const review = useQuery({
    queryKey: [...commerceKey(book), "unallocation-review", id],
    queryFn: async ({ signal }) => {
      const result = await readAccounting(`${commercePath(book)}/allocation-reversal-plans/${encodeURIComponent(id)}`, Reversal.CommerceAllocationReversalView, { signal });
      checkScope(book, result.plan.scope);
      if (result.plan.id !== id) throw new Error("Unallocation review identity mismatch");
      if (result.execution) {
        checkScope(book, result.execution.scope);
        if (result.execution.planId !== id || result.execution.receiptId !== result.plan.input.receiptId) throw new Error("Unallocation execution identity mismatch");
      }
      if (result.approval && result.approval.planId !== id) throw new Error("Unallocation approval identity mismatch");
      return result;
    },
    retry: false,
  });
  const ready = review.isSuccess && review.isFetchedAfterMount && !review.isFetching;
  return <Box display="grid" gap="lg" minWidth="zero">
    <Heading>{copy.review}</Heading>
    <Box><Button variant="outline" disabled={review.isFetching} onClick={() => { void review.refetch(); }}>{copy.refresh}</Button></Box>
    <AccountingStatus locale={locale} pending={review.isPending} error={review.error} />
    {review.data ? <ReviewContents {...props} view={review.data} ready={ready} /> : null}
  </Box>;
}
function ReviewContents(props: CommerceProps & { view: typeof Reversal.CommerceAllocationReversalView.Type; ready: boolean }) {
  const { view, book, locale, ready } = props;
  const copy = allocationReversalCopy(locale);
  const client = useQueryClient();
  const { plan, approval, execution } = view;
  const { snapshot } = plan;
  const path = `${commercePath(book)}/allocation-reversal-plans/${encodeURIComponent(plan.id)}`;
  const current = ready && view.dependenciesCurrent && !execution;
  const refresh = () => { void client.invalidateQueries({ queryKey: bookKey(book) }); };
  return <Box display="grid" gap="lg" minWidth="zero">
    <Text>{plan.id} · {copy.receipt}: {plan.input.receiptId}</Text>
    <Text>{copy.reason}: {plan.input.reason}</Text>
    <Text>{copy.digest}: {plan.digest}</Text>
    <Text role="status">{execution ? copy.reversed : !ready ? copy.unknown : view.dependenciesCurrent ? copy.ready : copy.stale}</Text>
    <Text>{copy.units}: {plan.currency} / {plan.currencyScale}</Text>
    <Text>{copy.payment}: {snapshot.payment.voucherId} / {snapshot.payment.lineId} · {snapshot.payment.postingDate}</Text>
    <Text>{copy.remaining}: {snapshot.payment.remainingMinor} · {copy.remainingAfter}: {snapshot.paymentRemainingAfterMinor}</Text>
    <Text>{copy.periods}: {snapshot.periods.map((period) => period.id).join(", ")}</Text>
    <Text>{copy.versions}: {snapshot.periods.map((period) => `${period.id} / ${period.version}`).join(", ")}</Text>
    <DataTable title={copy.invoices} narrow="stack" columns={[
      { id: "invoice", label: copy.invoice }, { id: "allocated", label: copy.allocated, numeric: true },
      { id: "release", label: copy.released, numeric: true }, { id: "before", label: copy.outstanding, numeric: true },
      { id: "after", label: copy.after, numeric: true },
    ]} rows={snapshot.invoices.map((item) => ({
      id: item.invoice.id,
      cells: [`${item.invoice.documentNumber} · ${item.invoice.counterpartyName} · ${item.invoice.id}`,
        item.invoice.recordedAllocatedMinor, item.releasedMinor, item.invoice.outstandingMinor ?? "—", item.outstandingAfterMinor],
    }))} />
    <Details title={copy.evidence}><Evidence {...props} reference={snapshot.originalPlan.evidence} /></Details>
    {snapshot.invoices.map((item) => <Details key={item.invoice.id} title={`${copy.invoice}: ${item.invoice.documentNumber}`}>
      <Text>{item.invoice.recognition.voucherId} / {item.invoice.recognition.lineId} · {item.invoice.recognition.postingDate}</Text>
      <Evidence {...props} reference={item.invoice.evidence} />
      <Evidence {...props} reference={item.invoice.currentRevision.evidence} />
    </Details>)}
    <Facts title={copy.original} value={snapshot} />
    <Box><Button variant="outline" onClick={() => {
      const url = URL.createObjectURL(new Blob([JSON.stringify(view, null, 2)], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `unallocation-${plan.id}.json`;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    }}>{copy.download}</Button></Box>
    <Facts title={copy.approvals} value={view.approvals} />
    {execution ? <Facts title={copy.execution} value={execution} /> : <>
      {!approval ? book.role === "operator" ? <CommandForm {...props}
        path={`${path}/approve`} schema={Reversal.ApproveCommerceAllocationReversal}
        output={Reversal.CommerceAllocationReversalApproval} label={copy.approve}
        allowed={current} input={() => ({ version: 1, digest: plan.digest })} onSuccess={refresh}>
        <Box as="label" display="flex" alignItems="start" gap="md" padding="md">
          <input type="checkbox" required /><span>{copy.acknowledge}</span>
        </Box>
      </CommandForm> : <Text>{copy.operator}</Text> : <>
        <Text>{copy.expires}: {approval.expiresAt} · {approval.actorId}</Text>
        <CommandForm {...props} key={`execute-${approval.id}`} path={`${path}/execute`}
          schema={Reversal.ExecuteCommerceAllocationReversal} output={Reversal.CommerceAllocationReversalExecution}
          label={copy.execute} allowed={current}
          input={() => ({ version: 1, digest: plan.digest, approvalId: approval.id })} onSuccess={refresh} />
        {book.role === "operator" ? <CommandForm {...props} key={`revoke-${approval.id}`}
          path={`${commercePath(book)}/allocation-reversal-approvals/${encodeURIComponent(approval.id)}/revoke`}
          schema={Reversal.RevokeCommerceAllocationReversalApproval} output={Reversal.CommerceAllocationReversalRevocation}
          label={copy.revoke} allowed={ready} input={(fields) => ({ reason: fields.get("reason") })} onSuccess={refresh}>
          <Field name="reason" label={copy.revokeReason} />
        </CommandForm> : null}
      </>}
    </>}
  </Box>;
}
export function CommerceRegisterAllocationStatus(props: CommerceProps & { id: string }) {
  const { book, locale, id } = props;
  const copy = allocationReversalCopy(locale);
  const status = useQuery({
    queryKey: [...commerceKey(book), "register-allocation-status", id],
    queryFn: async ({ signal }) => {
      const result = await readAccounting(`${commercePath(book)}/register-reports/${encodeURIComponent(id)}/allocation-status`, Reversal.CommerceRegisterAllocationStatus, { signal });
      if (result.reportId !== id) throw new Error("Register report identity mismatch");
      return result;
    },
    retry: false,
  });
  return <Box display="grid" gap="md">
    <Box><Button variant="outline" disabled={status.isFetching} onClick={() => { void status.refetch(); }}>{copy.refresh}</Button></Box>
    <AccountingStatus locale={locale} pending={status.isPending} error={status.error} />
    <Text role="status">{!status.isSuccess || status.isFetching || !status.isFetchedAfterMount ? copy.unknown : status.data.allocationDependenciesCurrent ? copy.reportCurrent : copy.reportStale}</Text>
  </Box>;
}
