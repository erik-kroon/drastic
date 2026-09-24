import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Reversal from "@open-erp/contracts/bank-match-reversals";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { DataTable } from "@open-erp/ui/components/data-table";
import { InputField } from "@open-erp/ui/components/field";
import { Heading, Text } from "@open-erp/ui/components/typography";
import { AccountingStatus } from "@/components/accounting-status";
import { EvidenceInspector } from "@/components/evidence-inspector";
import { bookKey, bookPath, mutationOptions, readAccounting } from "@/lib/accounting-api";
import { formatMinorAmount } from "@/lib/workspace-api";
import type { Locale } from "@/paraglide/runtime";
import { bankUnmatchCopy } from "./copy";

export function BankUnmatchReview({ book, id, locale, expected }: {
  book: typeof Accounting.Book.Type;
  id: string;
  locale: Locale;
  expected?: { allocationId: string; accountId?: string };
}) {
  const copy = bankUnmatchCopy(locale);
  const client = useQueryClient();
  const [reviewed, setReviewed] = useState(false);
  const [reason, setReason] = useState("");
  const approvalKeys = useRef(new Map<string, string>());
  const executionKeys = useRef(new Map<string, string>());
  const revocationKeys = useRef(new Map<string, string>());
  const base = `${bookPath(book)}/bank-match-reversal-plans/${encodeURIComponent(id)}`;
  const plan = useQuery({
    queryKey: [...bookKey(book), "bank-match-reversal", id, expected],
    staleTime: 0,
    refetchOnMount: "always",
    queryFn: async ({ signal }) => {
      const result = await readAccounting(base, Reversal.BankMatchReversalView, { signal });
      assertUnmatchView(result, book, id, expected);
      return result;
    },
    retry: false,
  });
  const approval = useMutation({
    mutationFn: (input: typeof Reversal.ApproveBankMatchReversal.Type) =>
      readAccounting(`${base}/approve`, Reversal.BankMatchReversalApproval,
        mutationOptions(`${base}/approve`, JSON.stringify(input), approvalKeys.current)),
    onSuccess: () => { approvalKeys.current.clear(); setReviewed(false); },
    onSettled: () => { void plan.refetch(); },
  });
  const execution = useMutation({
    mutationFn: (input: typeof Reversal.ExecuteBankMatchReversal.Type) =>
      readAccounting(`${base}/execute`, Reversal.BankMatchReversalExecution,
        mutationOptions(`${base}/execute`, JSON.stringify(input), executionKeys.current)),
    onSettled: () => { void client.invalidateQueries({ queryKey: bookKey(book) }); },
  });
  const revocation = useMutation({
    mutationFn: ({ approvalId, reason: explanation }: { approvalId: string; reason: string }) => {
      const path = `${bookPath(book)}/bank-match-reversal-approvals/${encodeURIComponent(approvalId)}/revoke`;
      return readAccounting(path, Reversal.BankMatchReversalRevocation,
        mutationOptions(path, JSON.stringify({ reason: explanation }), revocationKeys.current));
    },
    onSuccess: () => { setReason(""); setReviewed(false); revocationKeys.current.clear(); },
    onSettled: () => { void plan.refetch(); },
  });
  const view = plan.data;
  const amount = (minor: string) => view
    ? `${formatMinorAmount(minor, view.plan.currencyScale, locale)} ${view.plan.currency}`
    : "—";
  const receipt = view?.execution ?? execution.data;
  const writesPending = approval.isPending || execution.isPending || revocation.isPending;
  const busy = plan.isFetching || writesPending;
  const known = plan.isSuccess && plan.fetchStatus === "idle" && plan.isFetchedAfterMount;
  const current = Boolean(known && view?.dependenciesCurrent && !writesPending && !receipt);
  const revocationRequestKey = revocation.variables
    ? revocationKeys.current.get(`${bookPath(book)}/bank-match-reversal-approvals/${encodeURIComponent(revocation.variables.approvalId)}/revoke:${JSON.stringify({ reason: revocation.variables.reason })}`)
    : undefined;
  return (
    <Box as="section" display="grid" gap="lg" minWidth="zero">
      <Heading>{copy.review}</Heading>
      <Box><Button type="button" variant="outline" disabled={busy} onClick={() => { void plan.refetch(); }}>{copy.refresh}</Button></Box>
      <AccountingStatus locale={locale} pending={plan.isPending} error={plan.error} />
      {view ? <>
        <Text>{copy.planId}: {view.plan.id}</Text>
        <Text>{copy.reason}: {view.plan.input.reason}</Text>
        <Text>{copy.currency}: {view.plan.currency} / {view.plan.currencyScale}</Text>
        <Text role="status">{!known ? copy.unknown : receipt ? copy.done : view.dependenciesCurrent ? copy.ready : copy.stale}</Text>
        <Text>{copy.periods}: {view.plan.snapshot.periods.map((period) => `${period.id} / ${period.version}`).join(", ")}</Text>
        {view.plan.snapshot.capacities.map((capacity, index) => <Box
          key={`${capacity.leg.statementId}/${capacity.leg.rowOrdinal}/${capacity.leg.voucherId}/${capacity.leg.lineId}`}
          display="grid" gap="md" minWidth="zero">
          <DataTable title={`${copy.review} ${index + 1}`} narrow="stack"
            columns={[{ id: "fact", label: copy.target }, { id: "value", label: copy.review }]}
            rows={[
              { id: "source", cells: [copy.source, `${capacity.leg.statementId} / ${capacity.leg.rowOrdinal} · ${capacity.observedOn}`] },
              { id: "line", cells: [copy.line, `${capacity.leg.voucherId} / ${capacity.leg.lineId} · ${capacity.postedOn}`] },
              { id: "amount", cells: [copy.amount, amount(capacity.leg.amountMinor)] },
              { id: "source-used", cells: [copy.sourceUsed, amount(capacity.sourceAllocatedMinor)] },
              { id: "line-used", cells: [copy.lineUsed, amount(capacity.lineAllocatedMinor)] },
            ]} />
          <EvidenceInspector book={book} locale={locale} reference={{
            evidenceId: capacity.evidenceId, sha256: capacity.evidenceSha256,
            locator: `${capacity.leg.statementId}/${capacity.leg.rowOrdinal}`,
          }} />
        </Box>)}
        <details><summary>{copy.original}</summary>
          <Text>{copy.digest}: {view.plan.digest}</Text>
          <Text>{JSON.stringify(view.plan.snapshot)}</Text>
        </details>
        {receipt ? <>
          <Text>{copy.receipt}: {receipt.receipt.key} · {receipt.receipt.actorId} · {receipt.executedAt}</Text>
          <Text>{copy.sourceRevision}: {receipt.sourceRevision}</Text>
        </> : <>
          {book.role === "operator" ? <>
            {!view.approval ? <>
              <InputField type="checkbox" label={copy.acknowledge} checked={reviewed}
                disabled={!current} onChange={(event) => setReviewed(event.currentTarget.checked)} />
              <Box><Button type="button" size="xl" disabled={!current || !reviewed || approval.isError} onClick={() => {
                if (current && reviewed && !approval.isError) approval.mutate({ digest: view.plan.digest, version: 1 });
              }}>{copy.approve}</Button></Box>
            </> : null}
          </> : <Text>{copy.operator}</Text>}
          {view.approval ? <>
            <Text>{copy.expires}: {view.approval.expiresAt} · {view.approval.actorId}</Text>
            <Box><Button type="button" size="xl" disabled={!current || execution.isError} onClick={() => {
              if (current && view.approval && !execution.isError) execution.mutate({ digest: view.plan.digest, version: 1, approvalId: view.approval.id });
            }}>{copy.execute}</Button></Box>
            {book.role === "operator" ? <Box as="form" display="grid" gap="md" onSubmit={(event) => {
              event.preventDefault();
              if (known && !writesPending && !receipt && !revocation.isError && view.approval && reason.trim())
                revocation.mutate({ approvalId: view.approval.id, reason });
            }}>
              <InputField label={copy.revokeReason} value={reason} required maxLength={2000}
                disabled={!known || writesPending || revocation.isError} onChange={(event) => setReason(event.currentTarget.value)} />
              <Box><Button type="submit" variant="outline" disabled={!known || writesPending || revocation.isError || !reason.trim()}>{copy.revoke}</Button></Box>
            </Box> : null}
          </> : null}
        </>}
        <AccountingStatus locale={locale} pending={approval.isPending} error={approval.error} write />
        <AccountingStatus locale={locale} pending={execution.isPending} error={execution.error} write />
        <AccountingStatus locale={locale} pending={revocation.isPending} error={revocation.error} write />
      </> : null}
      <RequestRecovery locale={locale} label={copy.approve}
        request={JSON.stringify(approval.variables)} requestKey={approvalKeys.current.get(`${base}/approve:${JSON.stringify(approval.variables)}`)}
        complete={approval.isSuccess} pending={writesPending}
        onRetry={() => { if (!writesPending && approval.variables) approval.mutate(approval.variables); }}
        onDiscard={() => {
          if (writesPending) return;
          approval.reset(); approvalKeys.current.clear(); setReviewed(false);
        }} />
      <RequestRecovery locale={locale} label={copy.execute}
        request={JSON.stringify(execution.variables)} requestKey={executionKeys.current.get(`${base}/execute:${JSON.stringify(execution.variables)}`)}
        complete={execution.isSuccess} pending={writesPending}
        onRetry={() => { if (!writesPending && execution.variables) execution.mutate(execution.variables); }}
        onDiscard={() => {
          if (writesPending) return;
          execution.reset(); executionKeys.current.clear();
        }} />
      <RequestRecovery locale={locale} label={copy.revoke}
        request={JSON.stringify(revocation.variables)} requestKey={revocationRequestKey}
        complete={revocation.isSuccess} pending={writesPending}
        onRetry={() => { if (!writesPending && revocation.variables) revocation.mutate(revocation.variables); }}
        onDiscard={() => {
          if (writesPending) return;
          revocation.reset(); revocationKeys.current.clear(); setReason("");
        }} />
    </Box>
  );
}

function matchesTarget(view: typeof Reversal.BankMatchReversalView.Type,
  expected: { allocationId: string; accountId?: string }) {
  const target = view.plan.input.target;
  return target.kind === "allocation" &&
    target.allocationPlanId === expected.allocationId &&
    (!expected.accountId || view.plan.snapshot.accountId === expected.accountId);
}

function assertUnmatchView(
  view: typeof Reversal.BankMatchReversalView.Type,
  book: typeof Accounting.Book.Type,
  id: string,
  expected?: { allocationId: string; accountId?: string },
) {
  if (view.plan.id !== id || view.plan.scope.bookId !== book.id || view.plan.scope.entityId !== book.entityId)
    throw new Error("Unmatch scope mismatch");
  if (expected && !matchesTarget(view, expected)) throw new Error("Unmatch target mismatch");
}

function RequestRecovery(props: {
  locale: Locale;
  label: string;
  request: string | undefined;
  requestKey: string | undefined;
  complete: boolean;
  pending: boolean;
  onRetry: () => void;
  onDiscard: () => void;
}) {
  if (!props.request || props.complete) return null;
  return <Box display="grid" gap="md" minWidth="zero">
    <Text>{props.label}</Text>
    <Text>{props.locale === "sv"
      ? "Anropet kan ha sparats även om svaret saknas. Återförsök samma anrop eller läs kvittot innan du kastar återförsöksnyckeln."
      : "The request may have committed even if its response is missing. Retry the same request or recover its receipt before discarding the retry key."}</Text>
    <Text>{props.requestKey}</Text><Text>{props.request}</Text>
    <Box display="flex" flexWrap="wrap" gap="md">
      <Button type="button" variant="outline" disabled={props.pending} onClick={props.onRetry}>
        {props.locale === "sv" ? "Återförsök bevarat anrop" : "Retry retained request"} · {props.label}
      </Button>
      <Button type="button" variant="ghost" disabled={props.pending} onClick={props.onDiscard}>
        {props.locale === "sv" ? "Kasta anrop och återförsöksnyckel" : "Discard request and retry key"} · {props.label}
      </Button>
    </Box>
  </Box>;
}
