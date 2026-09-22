import { useState, type ComponentProps } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Recovery from "@open-erp/contracts/posting-recovery";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { DataTable } from "@open-erp/ui/components/data-table";
import { Heading, Text } from "@open-erp/ui/components/typography";
import { ReviewEntry } from "./review-entry";
import { Disclosure, WorkflowSurface } from "@open-erp/ui/components/workflow";
import { bookKey, bookPath, booksKey, readAccounting } from "@/lib/accounting-api";
import type { Locale } from "@/paraglide/runtime";
import { postingCopy } from "./copy";
import { sendSavedPostingCommand } from "./request";
import { SavedPostingOutcome } from "./saved-requests";
import { InputField } from "@open-erp/ui/components/field";
import { Link } from "@open-erp/ui/components/link";
import { reviewPath, workspacePath } from "@/lib/book-context";
import { accountingCopy } from "@/lib/accounting-copy";

export function PostingRecoveryReview(props: {
  book: typeof Accounting.Book.Type;
  id: string;
  locale: Locale;
  accounts: typeof Accounting.BookSetup.Type.accounts;
  expectedDigest?: string;
  returnSearch?: string;
}) {
  const { book, id, locale, accounts } = props;
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
      <Box display="flex" flexWrap="wrap" justifyContent="between" alignItems="center" gap="md">
        {recovery.data && !recovery.isError ? (
          <Box role="status" display="grid" gap="sm">
            <Text>{copy[recovery.data.summary.postingStatus]}</Text>
            <Text tone="muted">
              {copy.checked}:{" "}
              {new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(
                new Date(recovery.data.checkedAt),
              )}
            </Text>
          </Box>
        ) : null}
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
      {recovery.data &&
      props.expectedDigest &&
      recovery.data.plan.planDigest !== props.expectedDigest ? (
        <Box display="grid" gap="md">
          <Text role="alert">{accountingCopy(locale).workspace_revision_mismatch}</Text>
          <Link
            href={`${reviewPath(book, id, recovery.data.plan.planDigest)}${props.returnSearch ?? ""}`}
          >
            {accountingCopy(locale).workspace_current_revision}
          </Link>
        </Box>
      ) : null}
      {recovery.data &&
      !recovery.isError &&
      (!props.expectedDigest || recovery.data.plan.planDigest === props.expectedDigest) ? (
        <>
          <RecoveryDetail
            key={recovery.data.plan.planDigest}
            book={book}
            current={recovery.data}
            locale={locale}
            accounts={accounts}
            refreshing={recovery.isFetching}
          />
          <Disclosure title={copy.history}>
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
          </Disclosure>
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
  const refresh = () => {
    void client.invalidateQueries({ queryKey: bookKey(book) });
    void client.invalidateQueries({ queryKey: booksKey });
    setReviewed(false);
  };
  const approve = useMutation({
    mutationFn: () =>
      sendSavedPostingCommand({
        book,
        actorId: current.actorId,
        command: {
          operation: "approve_change",
          id: current.plan.id,
          input: { planDigest: current.plan.planDigest, version: current.plan.version },
        },
        storageMessage: copy.storage,
        replaceTerminal: true,
      }),
    onSettled: refresh,
  });
  const execute = useMutation({
    mutationFn: () => {
      if (!current.availableApproval) throw new Error(copy.operatorOnly);
      return sendSavedPostingCommand({
        book,
        actorId: current.actorId,
        command: {
          operation: "execute_change",
          id: current.plan.id,
          input: {
            planDigest: current.plan.planDigest,
            version: current.plan.version,
            approvalId: current.availableApproval.id,
          },
        },
        storageMessage: copy.storage,
      });
    },
    onSettled: refresh,
  });
  const revoke = useMutation({
    mutationFn: (reason: string) => {
      if (!current.availableApproval) throw new Error(copy.operatorOnly);
      return sendSavedPostingCommand({
        book,
        actorId: current.actorId,
        command: {
          operation: "revoke_approval",
          id: current.availableApproval.id,
          input: { reason },
        },
        storageMessage: copy.storage,
      });
    },
    onSettled: refresh,
  });
  const busy = props.refreshing || approve.isPending || execute.isPending || revoke.isPending;
  const unposted = current.summary.postingStatus === "unposted_at_check";
  const actionable = unposted && current.validation.status === "current" && reviewed && !busy;
  const receipt = current.summary.executionReceipt;
  return (
    <Box display="grid" gap="lg" minWidth="zero">
      {current.plan.groups.map((group) => (
        <Box key={group.id} display="grid" gap="lg" minWidth="zero">
          {group.actions.map((action) => (
            <ReviewEntry
              key={`${action.eventId}/${action.occurrenceKey}`}
              book={book}
              action={action}
              locale={locale}
              accounts={accounts}
            />
          ))}
        </Box>
      ))}
      {receipt ? (
        <WorkflowSurface>
          <Heading>
            {accountingCopy(locale).workspace_posted_receipt} {receipt.voucherNumber}
          </Heading>
          <Text>
            {new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(
              new Date(receipt.committedAt),
            )}
          </Text>
          <Link href={`${workspacePath(book)}/books?view=vouchers`}>
            {accountingCopy(locale).workspace_view_vouchers}
          </Link>
          <Disclosure title={copy.receipt}>
            <Text tone="muted">
              {receipt.id} · {receipt.committedAt}
            </Text>
            <Text tone="muted">
              {copy.voucher}: {receipt.voucherId} · {receipt.voucherNumber}
            </Text>
            <Text tone="muted">
              {copy.sequence}: {receipt.sequence}
            </Text>
            <Text tone="muted">
              {copy.digest}: {receipt.planDigest}
            </Text>
          </Disclosure>
        </WorkflowSurface>
      ) : null}
      <CommandOutcome saved={approve.data} locale={locale} />
      <CommandOutcome saved={execute.data} locale={locale} />
      <CommandOutcome saved={revoke.data} locale={locale} />
      {unposted ? (
        <WorkflowSurface>
          {current.validation.blocker ? (
            <Text role="alert">
              {copy.blocked} {current.validation.blocker.message}
            </Text>
          ) : null}
          <Heading>{current.availableApproval ? copy.saveExecute : copy.saveApprove}</Heading>
          <Text tone="muted">{copy.approvalHelp}</Text>
          {current.availableApproval ? (
            <Box display="grid" gap="sm">
              <Text>{accountingCopy(locale).workspace_approved_ready}</Text>
              <Text tone="muted">
                {copy.expires}:{" "}
                {new Intl.DateTimeFormat(locale, {
                  dateStyle: "medium",
                  timeStyle: "short",
                }).format(new Date(current.availableApproval.expiresAt))}
              </Text>
            </Box>
          ) : book.role === "agent" ? (
            <Text>{copy.operatorOnly}</Text>
          ) : null}
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
            {book.role === "operator" && current.availableApproval === null ? (
              <Button
                size="xl"
                disabled={!actionable || current.availableApproval !== null}
                onClick={() => approve.mutate()}
              >
                {copy.saveApprove}
              </Button>
            ) : null}
            {current.availableApproval ? (
              <Button size="xl" disabled={!actionable} onClick={() => execute.mutate()}>
                {copy.saveExecute}
              </Button>
            ) : null}
          </Box>
          {book.role === "operator" && current.availableApproval ? (
            <Disclosure title={copy.revoke}>
              <Box
                as="form"
                display="grid"
                gap="md"
                onSubmit={(event) => {
                  event.preventDefault();
                  const reason = new FormData(event.currentTarget).get("reason");
                  if (typeof reason === "string" && reason.trim()) revoke.mutate(reason);
                }}
              >
                <Text>{copy.revokeHelp}</Text>
                <InputField
                  label={copy.revokeReason}
                  name="reason"
                  required
                  maxLength={2000}
                  disabled={busy}
                />
                <Box>
                  <Button type="submit" size="xl" variant="outline" disabled={busy}>
                    {copy.revoke}
                  </Button>
                </Box>
              </Box>
            </Disclosure>
          ) : null}
          {approve.isPending || execute.isPending || revoke.isPending ? (
            <Text role="status">{copy.pending}</Text>
          ) : null}
          {approve.isError || execute.isError || revoke.isError ? (
            <Text role="alert">
              {copy.commandUnknown}{" "}
              {approve.error?.message ?? execute.error?.message ?? revoke.error?.message}
            </Text>
          ) : null}
        </WorkflowSurface>
      ) : null}
      <Disclosure title={accountingCopy(locale).workspace_reference_details}>
        <Text tone="muted">{current.plan.id}</Text>
        <Text tone="muted">
          {copy.digest}: {current.plan.planDigest}
        </Text>
      </Disclosure>
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

function CommandOutcome({
  saved,
  locale,
}: {
  saved: ComponentProps<typeof SavedPostingOutcome>["saved"] | undefined;
  locale: Locale;
}) {
  if (!saved || saved.outcome?.state === "committed") return null;
  return <SavedPostingOutcome saved={saved} locale={locale} />;
}
