import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Recovery from "@open-erp/contracts/posting-recovery";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { DataTable } from "@open-erp/ui/components/data-table";
import { Heading, Text } from "@open-erp/ui/components/typography";
import { SealedAction } from "@/components/journal-review";
import { bookKey, bookPath, booksKey, readAccounting } from "@/lib/accounting-api";
import type { Locale } from "@/paraglide/runtime";
import { postingCopy } from "./copy";
import { postingRequestOptions } from "./request";

export function PostingRecoveryReview({
  book,
  id,
  locale,
  accounts,
}: {
  book: typeof Accounting.Book.Type;
  id: string;
  locale: Locale;
  accounts: typeof Accounting.BookSetup.Type.accounts;
}) {
  const copy = postingCopy(locale);
  const [after, setAfter] = useState<string | null>(null);
  const recovery = useQuery({
    queryKey: [...bookKey(book), "posting-recovery", "detail", id, after],
    queryFn: async ({ signal }) => {
      const result = await readAccounting(
        `${bookPath(book)}/posting-recovery/${encodeURIComponent(id)}${after ? `?after=${encodeURIComponent(after)}` : ""}`,
        Recovery.PostingRecovery,
        { signal },
      );
      if (
        result.plan.id !== id ||
        result.scope.bookId !== book.id ||
        result.scope.entityId !== book.entityId
      )
        throw new Error("Response scope mismatch");
      return result;
    },
    retry: false,
  });
  return (
    <Box as="section" id="journal-review" tabIndex={-1} display="grid" gap="lg" minWidth="zero">
      <Heading>{copy.review}</Heading>
      <Box>
        <Button
          size="xl"
          variant="outline"
          disabled={recovery.isFetching}
          onClick={() => {
            void recovery.refetch();
          }}
        >
          {copy.refresh}
        </Button>
      </Box>
      {recovery.isPending ? <Text role="status">{copy.pending}</Text> : null}
      {recovery.isError ? (
        <Text role="alert">
          {copy.unknown} {recovery.error.message}
        </Text>
      ) : null}
      {recovery.data && !recovery.isError ? (
        <>
          <RecoveryDetail
            key={recovery.data.plan.planDigest}
            book={book}
            current={recovery.data}
            locale={locale}
            accounts={accounts}
            refreshing={recovery.isFetching}
          />
          <RequestHistory current={recovery.data} locale={locale} />
          <Box display="flex" flexWrap="wrap" gap="md">
            {after ? (
              <Button size="xl" variant="outline" onClick={() => setAfter(null)}>
                {copy.newestRequests}
              </Button>
            ) : null}
            {recovery.data.nextRequest ? (
              <Button
                size="xl"
                variant="outline"
                onClick={() => setAfter(recovery.data?.nextRequest ?? null)}
              >
                {copy.olderRequests}
              </Button>
            ) : null}
          </Box>
        </>
      ) : null}
    </Box>
  );
}

function RecoveryDetail(props: {
  book: typeof Accounting.Book.Type;
  current: typeof Recovery.PostingRecovery.Type;
  locale: Locale;
  accounts: typeof Accounting.BookSetup.Type.accounts;
  refreshing: boolean;
}) {
  const { book, current, locale, accounts } = props;
  const copy = postingCopy(locale);
  const client = useQueryClient();
  const [reviewed, setReviewed] = useState(false);
  const base = `${bookPath(book)}/change-sets/${encodeURIComponent(current.plan.id)}`;
  const refresh = () => {
    void client.invalidateQueries({ queryKey: bookKey(book) });
    void client.invalidateQueries({ queryKey: booksKey });
  };
  const approve = useMutation({
    mutationFn: async () => {
      const path = `${base}/approvals`;
      const payload = { planDigest: current.plan.planDigest, version: current.plan.version };
      const options = await postingRequestOptions({
        book,
        actorId: current.actorId,
        path,
        payload,
        checkedAt: current.checkedAt,
        storageMessage: copy.storage,
      });
      const result = await readAccounting(path, Accounting.Approval, options);
      if (result.changeSetId !== current.plan.id || result.planDigest !== current.plan.planDigest)
        throw new Error("Response scope mismatch");
      return result;
    },
    onSettled: refresh,
  });
  const execute = useMutation({
    mutationFn: async () => {
      if (!current.availableApproval) throw new Error(copy.operatorOnly);
      const path = `${base}/execute`;
      const payload = {
        planDigest: current.plan.planDigest,
        version: current.plan.version,
        approvalId: current.availableApproval.id,
      };
      const options = await postingRequestOptions({
        book,
        actorId: current.actorId,
        path,
        payload,
        checkedAt: current.checkedAt,
        storageMessage: copy.storage,
      });
      const result = await readAccounting(path, Accounting.ExecutionReceipt, options);
      if (result.changeSetId !== current.plan.id || result.planDigest !== current.plan.planDigest)
        throw new Error("Response scope mismatch");
      return result;
    },
    onSettled: refresh,
  });
  const busy = props.refreshing || approve.isPending || execute.isPending;
  const unposted = current.summary.postingStatus === "unposted_at_check";
  const actionable = unposted && current.validation.status === "current" && reviewed && !busy;
  const receipt = current.summary.executionReceipt ?? execute.data;
  return (
    <Box display="grid" gap="lg" minWidth="zero">
      <Box role="status" aria-live="polite" display="grid" gap="sm">
        <Text>{copy[current.summary.postingStatus]}</Text>
        <Text tone="muted">
          {copy.checked}: {current.checkedAt} · {copy.sequence}: {current.sequence}
        </Text>
      </Box>
      <Text>ID: {current.plan.id}</Text>
      <Text>
        {copy.digest}: {current.plan.planDigest}
      </Text>
      {current.plan.groups.map((group) => (
        <Box key={group.id} display="grid" gap="lg" minWidth="zero">
          {group.actions.map((action) => (
            <SealedAction
              key={`${action.eventId}/${action.occurrenceKey}`}
              book={book}
              action={action}
              locale={locale}
              setupAccounts={accounts}
            />
          ))}
        </Box>
      ))}
      {receipt ? (
        <Box
          as="section"
          display="grid"
          gap="sm"
          padding="lg"
          backgroundColor="surface"
          borderRadius="surface"
        >
          <Heading>{copy.receipt}</Heading>
          <Text>
            {receipt.id} · {receipt.committedAt}
          </Text>
          <Text>
            {copy.voucher}: {receipt.voucherId} · {receipt.voucherNumber}
          </Text>
          <Text>
            {copy.sequence}: {receipt.sequence}
          </Text>
          <Text>
            {copy.digest}: {receipt.planDigest}
          </Text>
        </Box>
      ) : null}
      {unposted ? (
        <>
          {current.validation.blocker ? (
            <Text role="alert">
              {copy.blocked} {current.validation.blocker.message}
            </Text>
          ) : null}
          <Text>{copy.approvalHelp}</Text>
          {current.availableApproval ? (
            <Box display="grid" gap="sm">
              <Text>
                {copy.approval}: {current.availableApproval.id}
              </Text>
              <Text>
                {current.availableApproval.actorId} · {copy.expires}:{" "}
                {current.availableApproval.expiresAt}
              </Text>
            </Box>
          ) : (
            <Text>{copy.operatorOnly}</Text>
          )}
          <Box as="label" display="flex" alignItems="center" gap="md" paddingBlock="md">
            <input
              type="checkbox"
              checked={reviewed}
              disabled={busy}
              onChange={(event) => setReviewed(event.target.checked)}
            />{" "}
            {copy.reviewCheck}
          </Box>
          <Box display="flex" flexWrap="wrap" gap="md">
            {book.role === "operator" ? (
              <Button
                size="xl"
                disabled={!actionable || current.availableApproval !== null}
                onClick={() => approve.mutate()}
              >
                {copy.approve}
              </Button>
            ) : null}
            <Button
              size="xl"
              disabled={!actionable || current.availableApproval === null}
              onClick={() => execute.mutate()}
            >
              {copy.execute}
            </Button>
          </Box>
          {approve.isPending || execute.isPending ? (
            <Text role="status">{copy.pending}</Text>
          ) : null}
          {approve.isError || execute.isError ? (
            <Text role="alert">
              {copy.commandUnknown} {approve.error?.message ?? execute.error?.message}
            </Text>
          ) : null}
        </>
      ) : null}
    </Box>
  );
}

function RequestHistory({
  current,
  locale,
}: {
  current: typeof Recovery.PostingRecovery.Type;
  locale: Locale;
}) {
  const copy = postingCopy(locale);
  return (
    <Box display="grid" gap="md" minWidth="zero">
      <Text>{copy.historyHelp}</Text>
      <DataTable
        title={copy.history}
        narrow="stack"
        columns={[
          { id: "key", label: copy.requestKey },
          { id: "operation", label: copy.operation },
          { id: "actor", label: copy.actor },
          { id: "recorded", label: copy.recorded },
          { id: "result", label: copy.result },
          { id: "approval", label: copy.approvalState },
        ]}
        rows={current.requests.map((request) => ({
          id: request.key,
          cells: [
            request.key,
            request.operation,
            request.actorId,
            request.recordedAt,
            request.resultId ?? "—",
            request.approvalState ? copy[request.approvalState] : "—",
          ],
        }))}
      />
    </Box>
  );
}
