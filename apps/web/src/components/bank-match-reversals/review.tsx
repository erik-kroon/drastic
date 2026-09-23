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
import type { Locale } from "@/paraglide/runtime";
import { bankUnmatchCopy } from "./copy";

export function BankUnmatchReview({ book, id, locale }: {
  book: typeof Accounting.Book.Type;
  id: string;
  locale: Locale;
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
    queryKey: [...bookKey(book), "bank-match-reversal", id],
    queryFn: async ({ signal }) => {
      const result = await readAccounting(base, Reversal.BankMatchReversalView, { signal });
      if (result.plan.id !== id || result.plan.scope.bookId !== book.id || result.plan.scope.entityId !== book.entityId)
        throw new Error("Unmatch scope mismatch");
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
  const receipt = view?.execution ?? execution.data;
  const busy = plan.isFetching || approval.isPending || execution.isPending || revocation.isPending;
  const current = Boolean(view?.dependenciesCurrent && !plan.isError && !busy && !receipt);
  return (
    <Box as="section" display="grid" gap="lg" minWidth="zero">
      <Heading>{copy.review}</Heading>
      <Box><Button type="button" variant="outline" disabled={busy} onClick={() => { void plan.refetch(); }}>{copy.refresh}</Button></Box>
      <AccountingStatus locale={locale} pending={plan.isPending} error={plan.error} />
      {view ? <>
        <Text>{copy.planId}: {view.plan.id}</Text>
        <Text>{copy.reason}: {view.plan.input.reason}</Text>
        <Text>{copy.currency}: {view.plan.currency} / {view.plan.currencyScale}</Text>
        <Text role="status">{receipt ? copy.done : plan.isError || plan.isFetching ? copy.unknown : view.dependenciesCurrent ? copy.ready : copy.stale}</Text>
        <Text>{copy.periods}: {view.plan.snapshot.periods.map((period) => `${period.id} / ${period.version}`).join(", ")}</Text>
        {view.plan.snapshot.capacities.map((capacity, index) => <Box
          key={`${capacity.leg.statementId}/${capacity.leg.rowOrdinal}/${capacity.leg.voucherId}/${capacity.leg.lineId}`}
          display="grid" gap="md" minWidth="zero">
          <DataTable title={`${copy.review} ${index + 1}`} narrow="stack"
            columns={[{ id: "fact", label: copy.target }, { id: "value", label: copy.review }]}
            rows={[
              { id: "source", cells: [copy.source, `${capacity.leg.statementId} / ${capacity.leg.rowOrdinal} · ${capacity.observedOn}`] },
              { id: "line", cells: [copy.line, `${capacity.leg.voucherId} / ${capacity.leg.lineId} · ${capacity.postedOn}`] },
              { id: "amount", cells: [copy.amount, capacity.leg.amountMinor] },
              { id: "source-used", cells: [copy.sourceUsed, capacity.sourceAllocatedMinor] },
              { id: "line-used", cells: [copy.lineUsed, capacity.lineAllocatedMinor] },
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
              <Box><Button type="button" size="xl" disabled={!current || !reviewed} onClick={() => {
                approval.mutate({ digest: view.plan.digest, version: 1 });
              }}>{copy.approve}</Button></Box>
            </> : null}
          </> : <Text>{copy.operator}</Text>}
          {view.approval ? <>
            <Text>{copy.expires}: {view.approval.expiresAt} · {view.approval.actorId}</Text>
            <Box><Button type="button" size="xl" disabled={!current} onClick={() => {
              if (view.approval) execution.mutate({ digest: view.plan.digest, version: 1, approvalId: view.approval.id });
            }}>{copy.execute}</Button></Box>
            {book.role === "operator" ? <Box as="form" display="grid" gap="md" onSubmit={(event) => {
              event.preventDefault();
              if (view.approval) revocation.mutate({ approvalId: view.approval.id, reason });
            }}>
              <InputField label={copy.revokeReason} value={reason} required maxLength={2000}
                disabled={busy} onChange={(event) => setReason(event.currentTarget.value)} />
              <Box><Button type="submit" variant="outline" disabled={busy || !reason.trim()}>{copy.revoke}</Button></Box>
            </Box> : null}
          </> : null}
        </>}
        <AccountingStatus locale={locale} pending={approval.isPending} error={approval.error} write />
        <AccountingStatus locale={locale} pending={execution.isPending} error={execution.error} write />
        <AccountingStatus locale={locale} pending={revocation.isPending} error={revocation.error} write />
      </> : null}
    </Box>
  );
}
