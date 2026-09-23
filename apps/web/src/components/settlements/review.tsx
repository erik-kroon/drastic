import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Settlement from "@open-erp/contracts/settlements";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { DataTable } from "@open-erp/ui/components/data-table";
import { InputField } from "@open-erp/ui/components/field";
import { Heading, Text } from "@open-erp/ui/components/typography";
import { AccountingStatus } from "@/components/accounting-status";
import { EvidenceInspector } from "@/components/evidence-inspector";
import { BankAllocationUnmatchNotice } from "@/components/bank-match-reversals/notice";
import { bookKey, bookPath, mutationOptions, readAccounting } from "@/lib/accounting-api";
import type { Locale } from "@/paraglide/runtime";
import { settlementCopy } from "./copy";

export function AllocationReview({
  book,
  id,
  locale,
}: {
  book: typeof Accounting.Book.Type;
  id: string;
  locale: Locale;
}) {
  const copy = settlementCopy(locale);
  const client = useQueryClient();
  const [reviewed, setReviewed] = useState(false);
  const approvalKeys = useRef(new Map<string, string>());
  const executionKeys = useRef(new Map<string, string>());
  const base = `${bookPath(book)}/bank-allocation-plans/${encodeURIComponent(id)}`;
  const plan = useQuery({
    queryKey: [...bookKey(book), "bank-allocation", id],
    staleTime: 0,
    refetchOnMount: "always",
    retry: false,
    queryFn: async ({ signal }) => {
      const view = await readAccounting(base, Settlement.BankAllocationView, { signal });
      if (
        view.plan.id !== id ||
        view.plan.scope.bookId !== book.id ||
        view.plan.scope.entityId !== book.entityId
      )
        throw new Error("Allocation scope mismatch");
      return view;
    },
  });
  const approval = useMutation({
    mutationFn: (input: typeof Settlement.ApproveBankAllocation.Type) =>
      readAccounting(
        `${base}/approve`,
        Settlement.BankAllocationApproval,
        mutationOptions(`${base}/approve`, JSON.stringify(input), approvalKeys.current),
      ),
    onSuccess: () => {
      approvalKeys.current.clear();
      setReviewed(false);
    },
    onSettled: () => {
      void plan.refetch();
    },
  });
  const execution = useMutation({
    mutationFn: (input: typeof Settlement.ExecuteBankAllocation.Type) =>
      readAccounting(
        `${base}/execute`,
        Settlement.BankAllocationExecution,
        mutationOptions(`${base}/execute`, JSON.stringify(input), executionKeys.current),
      ),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: bookKey(book) });
    },
  });
  const view = plan.data;
  const executed = view?.execution ?? execution.data;
  const writesPending = approval.isPending || execution.isPending;
  const busy = plan.isFetching || writesPending;
  const known = plan.isSuccess && plan.fetchStatus === "idle" && plan.isFetchedAfterMount;
  const current = known && view?.dependenciesCurrent && !writesPending && !executed && !view?.unmatch;
  return (
    <Box as="section" display="grid" gap="lg" minWidth="zero">
      <Heading>{copy.capacity}</Heading>
      <Box>
        <Button
          type="button"
          size="xl"
          variant="outline"
          disabled={busy}
          onClick={() => {
            void plan.refetch();
          }}
        >
          {copy.refresh}
        </Button>
      </Box>
      <AccountingStatus locale={locale} pending={plan.isPending} error={plan.error} />
      {view ? (
        <>
          <Text>
            {copy.planId}: {view.plan.id}
          </Text>
          <Text>
            {copy.digest}: {view.plan.digest}
          </Text>
          <Text>
            {copy.version}: {view.plan.version} · {copy.currency}: {view.plan.currency} /{" "}
            {view.plan.currencyScale}
          </Text>
          <Text>
            {copy.reason}: {view.plan.input.reason}
          </Text>
          <Text>{copy.candidateHelp}</Text>
          {view.unmatch ? (
            <>
              {!known ? <Text role="status">{copy.unknown}</Text> : null}
              <BankAllocationUnmatchNotice unmatch={view.unmatch} locale={locale} />
            </>
          ) : (
            <Text role="status">
              {!known
                ? copy.unknown
                : executed
                  ? copy.done
                  : view.dependenciesCurrent
                    ? copy.ready
                    : copy.stale}
            </Text>
          )}
          {view.plan.snapshot.capacities.map((capacity, index) => (
            <Box
              key={`${capacity.leg.statementId}/${capacity.leg.rowOrdinal}/${capacity.leg.voucherId}/${capacity.leg.lineId}`}
              display="grid"
              gap="md"
              minWidth="zero"
            >
              <Text>
                {copy.leg} {index + 1}: {capacity.leg.amountMinor} · {copy.candidates}:{" "}
                {capacity.candidateCount}
              </Text>
              <DataTable
                title={`${copy.capacity} ${index + 1}`}
                narrow="stack"
                columns={[
                  { id: "identity", label: copy.source },
                  { id: "total", label: copy.total, numeric: true },
                  { id: "allocated", label: copy.allocated, numeric: true },
                  { id: "remaining", label: copy.remaining, numeric: true },
                ]}
                rows={[
                  {
                    id: "source",
                    cells: [
                      `${capacity.leg.statementId} / ${capacity.leg.rowOrdinal} · ${capacity.observedOn}`,
                      capacity.sourceAmountMinor,
                      capacity.sourceAllocatedMinor,
                      (
                        BigInt(capacity.sourceAmountMinor) - BigInt(capacity.sourceAllocatedMinor)
                      ).toString(),
                    ],
                  },
                  {
                    id: "line",
                    cells: [
                      `${capacity.leg.voucherId} / ${capacity.leg.lineId} · ${capacity.postedOn}`,
                      capacity.lineAmountMinor,
                      capacity.lineAllocatedMinor,
                      (
                        BigInt(capacity.lineAmountMinor) - BigInt(capacity.lineAllocatedMinor)
                      ).toString(),
                    ],
                  },
                ]}
              />
              <Text>
                {copy.source}: {capacity.sourceBankAccountId} / {capacity.providerId ?? "—"}
              </Text>
              <EvidenceInspector
                book={book}
                reference={{
                  evidenceId: capacity.evidenceId,
                  sha256: capacity.evidenceSha256,
                  locator: `${capacity.leg.statementId}/${capacity.leg.rowOrdinal}`,
                }}
                locale={locale}
              />
            </Box>
          ))}
          {executed ? (
            <>
              <Text>
                {copy.receipt}: {executed.receipt.key} · {executed.receipt.actorId} ·{" "}
                {executed.executedAt}
              </Text>
              <Text>
                {copy.savedLegs}: {executed.legs.length}
              </Text>
            </>
          ) : (
            <>
              {book.role === "operator" ? (
                <>
                  <InputField
                    label={copy.review}
                    type="checkbox"
                    checked={reviewed}
                    onChange={(event) => setReviewed(event.currentTarget.checked)}
                    disabled={!current}
                  />
                  <Box>
                    <Button
                      type="button"
                      size="xl"
                      disabled={!current || !reviewed || approval.isError}
                      onClick={() => {
                        if (current && reviewed && !approval.isError)
                          approval.mutate({ digest: view.plan.digest, version: view.plan.version });
                      }}
                    >
                      {copy.approve}
                    </Button>
                  </Box>
                </>
              ) : (
                <Text>{copy.operator}</Text>
              )}
              {view.approval ? (
                <Text>
                  {copy.approvalExpires}: {view.approval.expiresAt} · {view.approval.actorId}
                </Text>
              ) : null}
              <Box>
                <Button
                  type="button"
                  size="xl"
                  variant="outline"
                  disabled={!current || !view.approval || execution.isError}
                  onClick={() => {
                    if (current && view.approval && !execution.isError)
                      execution.mutate({
                        digest: view.plan.digest,
                        version: view.plan.version,
                        approvalId: view.approval.id,
                      });
                  }}
                >
                  {copy.execute}
                </Button>
              </Box>
            </>
          )}
          <AccountingStatus
            locale={locale}
            pending={approval.isPending}
            error={approval.error}
            write
          />
          <AccountingStatus
            locale={locale}
            pending={execution.isPending}
            error={execution.error}
            write
          />
        </>
      ) : null}
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
    </Box>
  );
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
