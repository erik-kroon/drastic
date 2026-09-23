import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Cancellation from "@open-erp/contracts/invoice-cancellations";
import type * as Issuance from "@open-erp/contracts/invoice-issuance";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { DataTable } from "@open-erp/ui/components/data-table";
import { InputField, SelectField } from "@open-erp/ui/components/field";
import { RecordFact, RecordSummary } from "@open-erp/ui/components/record-layout";
import { Text } from "@open-erp/ui/components/typography";
import { AccountingStatus } from "@/components/accounting-status";
import { bookKey, bookPath, readAccounting } from "@/lib/accounting-api";
import { formatMinorAmount } from "@/lib/workspace-api";
import { invoiceCancellationCopy } from "./invoice-cancellation-copy";
import {
  CommandForm,
  Details,
  Evidence,
  Facts,
  checkScope,
  commerceKey,
  commercePath,
  type CommerceProps,
} from "./shared";

type Issue = typeof Issuance.InvoiceIssueReceipt.Type;
type CancellationProps = CommerceProps & { issue: Issue };
export function InvoiceCancellationPanel(props: CancellationProps) {
  return (
    <CancellationPanel
      key={`${props.book.entityId}:${props.book.id}:${props.issue.id}`}
      {...props}
    />
  );
}
function CancellationPanel(props: CancellationProps) {
  const { book, locale, issue } = props;
  const copy = invoiceCancellationCopy(locale);
  const [selected, setSelected] = useState<string | null>(null);
  const status = useQuery({
    queryKey: [...commerceKey(book), "invoice-cancellation-status", issue.id],
    staleTime: 0,
    refetchOnMount: "always",
    queryFn: async ({ signal }) => {
      const result = await readAccounting(
        `${commercePath(book)}/invoice-issues/${encodeURIComponent(issue.id)}/cancellation-status`,
        Cancellation.InvoiceCancellationStatus,
        { signal },
      );
      checkScope(book, result.scope);
      checkScope(book, result.issue.scope);
      if (result.issue.id !== issue.id || result.issue.digest !== issue.digest)
        throw new Error("Cancellation source identity mismatch");
      if (result.cancellation) {
        checkScope(book, result.cancellation.scope);
        if (
          result.cancellation.issueId !== issue.id ||
          result.cancellation.registerInvoiceId !== issue.registerInvoiceId ||
          result.cancellation.originalVoucherId !== issue.postingReceipt.voucherId
        )
          throw new Error("Cancellation target identity mismatch");
      }
      return result;
    },
    retry: false,
  });
  const ready = status.isSuccess && status.isFetchedAfterMount && status.fetchStatus === "idle";
  const reviewId = selected ?? status.data?.reviews[0]?.id;
  return (
    <Box display="grid" gap="lg" minWidth="zero">
      <AccountingStatus locale={locale} pending={status.isPending} error={status.error} />
      {status.isError ? (
        <Box>
          <Button
            variant="outline"
            disabled={status.isFetching}
            onClick={() => {
              void status.refetch();
            }}
          >
            {copy.refresh}
          </Button>
        </Box>
      ) : null}
      {status.data?.cancellation && ready ? (
        <>
          <Text role="status">{copy.cancelled}</Text>
          <Text tone="muted">{copy.retained}</Text>
          <Facts title={copy.receipt} value={status.data.cancellation} />
        </>
      ) : null}
      {!status.data?.cancellation ? (
        <>
          <Text>{copy.boundary}</Text>
          {book.role !== "operator" ? <Text>{copy.operator}</Text> : null}
          {status.isSuccess && !reviewId ? (
            <CancellationPreparation
              {...props}
              allowed={ready && book.role === "operator"}
              onOpen={setSelected}
            />
          ) : null}
        </>
      ) : null}
      {reviewId ? <InvoiceCancellationReviewPanel {...props} key={reviewId} id={reviewId} /> : null}
      {status.data && status.data.reviews.length > 0 ? (
        <Details title={copy.history}>
          {status.data.reviews.map((review) => (
            <Box
              key={review.id}
              display="flex"
              justifyContent="between"
              gap="md"
              alignItems="center"
            >
              <Box display="grid" gap="xs">
                <Text>{review.reason}</Text>
                <Text tone="muted">
                  {new Intl.DateTimeFormat(locale, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  }).format(new Date(review.createdAt))}
                </Text>
              </Box>
              <Button
                variant="outline"
                disabled={review.id === reviewId}
                onClick={() => setSelected(review.id)}
              >
                {copy.review}
              </Button>
            </Box>
          ))}
        </Details>
      ) : null}
      {reviewId && !status.data?.cancellation && book.role === "operator" ? (
        <Box>
          <Button variant="outline" disabled={!ready} onClick={() => setSelected("")}>
            {copy.newReview}
          </Button>
        </Box>
      ) : null}
    </Box>
  );
}
function CancellationAcknowledgment({ locale }: Pick<CommerceProps, "locale">) {
  return (
    <Box as="label" display="flex" alignItems="start" gap="md">
      <input type="checkbox" name="acknowledgeSyntheticOnly" required />
      <Text>{invoiceCancellationCopy(locale).acknowledge}</Text>
    </Box>
  );
}
function useCancellationSetup(book: CommerceProps["book"]) {
  return useQuery({
    queryKey: [...bookKey(book), "setup"],
    staleTime: 0,
    refetchOnMount: "always",
    queryFn: ({ signal }) =>
      readAccounting(`${bookPath(book)}/setup`, Accounting.BookSetup, { signal }),
    retry: false,
  });
}
function CancellationPreparation(
  props: CancellationProps & { allowed: boolean; onOpen: (id: string) => void },
) {
  const { book, locale, issue } = props;
  const copy = invoiceCancellationCopy(locale);
  const setup = useCancellationSetup(book);
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm" }).format(
    new Date(),
  );
  const currentPeriod = setup.data?.periods.find(
    (period) => !period.locked && period.startsOn <= today && period.endsOn >= today,
  );
  return (
    <Box display="grid" gap="lg">
      <Text tone="muted">{copy.requirements}</Text>
      <AccountingStatus locale={locale} pending={setup.isPending} error={setup.error} />
      <CommandForm
        {...props}
        compact
        path={`${commercePath(book)}/invoice-cancellation-reviews`}
        schema={Cancellation.PrepareInvoiceCancellation}
        output={Cancellation.InvoiceCancellationReview}
        label={copy.prepare}
        allowed={props.allowed}
        canSubmit={setup.isSuccess && setup.fetchStatus === "idle" && setup.isFetchedAfterMount}
        input={(fields) => ({
          issueId: issue.id,
          issueDigest: issue.digest,
          accountingPeriodId: fields.get("accountingPeriodId"),
          postingDate: fields.get("postingDate"),
          reason: fields.get("reason"),
          acknowledgeSyntheticOnly: fields.get("acknowledgeSyntheticOnly") === "on",
        })}
        onSuccess={(review) => {
          checkScope(book, review.scope);
          if (review.input.issueId !== issue.id || review.input.issueDigest !== issue.digest)
            throw new Error("Cancellation preparation identity mismatch");
          props.onOpen(review.id);
        }}
      >
        <Box display="grid" columns={2} gap="lg">
          <SelectField
            key={currentPeriod?.id ?? "loading"}
            defaultValue={currentPeriod?.id ?? ""}
            name="accountingPeriodId"
            label={copy.period}
            required
            options={[
              { value: "", label: "—" },
              ...(setup.data?.periods
                .filter((period) => !period.locked)
                .map((period) => ({
                  value: period.id,
                  label: `${period.startsOn} – ${period.endsOn}`,
                })) ?? []),
            ]}
          />
          <InputField
            name="postingDate"
            type="date"
            defaultValue={today}
            label={copy.date}
            required
          />
        </Box>
        <InputField name="reason" label={copy.reason} required maxLength={2000} />
        <CancellationAcknowledgment locale={locale} />
      </CommandForm>
    </Box>
  );
}
export function InvoiceCancellationReviewPanel(props: CancellationProps & { id: string }) {
  const { book, locale, id, issue } = props;
  const copy = invoiceCancellationCopy(locale);
  const review = useQuery({
    queryKey: [...commerceKey(book), "invoice-cancellation-review", id, issue.id],
    staleTime: 0,
    refetchOnMount: "always",
    queryFn: async ({ signal }) => {
      const result = await readAccounting(
        `${commercePath(book)}/invoice-cancellation-reviews/${encodeURIComponent(id)}`,
        Cancellation.InvoiceCancellationView,
        { signal },
      );
      checkScope(book, result.review.scope);
      checkScope(book, result.review.snapshot.issue.scope);
      checkScope(book, result.review.snapshot.invoice.scope);
      if (
        result.review.id !== id ||
        result.review.input.issueId !== issue.id ||
        result.review.input.issueDigest !== issue.digest ||
        result.review.input.issueId !== result.review.snapshot.issue.id ||
        result.review.snapshot.invoice.id !== issue.registerInvoiceId
      )
        throw new Error("Cancellation review identity mismatch");
      if (result.approval) {
        checkScope(book, result.approval.scope);
        if (result.approval.reviewId !== id || result.approval.digest !== result.review.digest)
          throw new Error("Cancellation approval identity mismatch");
      }
      if (result.cancellation) {
        checkScope(book, result.cancellation.scope);
        if (result.cancellation.issueId !== issue.id)
          throw new Error("Cancellation receipt identity mismatch");
      }
      return result;
    },
    retry: false,
  });
  return (
    <Box display="grid" gap="lg" minWidth="zero">
      <AccountingStatus locale={locale} pending={review.isPending} error={review.error} />
      {review.isError ? (
        <Box>
          <Button
            variant="outline"
            disabled={review.isFetching}
            onClick={() => {
              void review.refetch();
            }}
          >
            {copy.refresh}
          </Button>
        </Box>
      ) : null}
      {review.data ? (
        <CancellationReviewContents
          {...props}
          view={review.data}
          ready={review.isSuccess && review.isFetchedAfterMount && review.fetchStatus === "idle"}
        />
      ) : null}
    </Box>
  );
}
function CancellationReviewContents(
  props: CommerceProps & { view: typeof Cancellation.InvoiceCancellationView.Type; ready: boolean },
) {
  const { book, locale, view, ready } = props;
  const copy = invoiceCancellationCopy(locale);
  const setup = useCancellationSetup(book);
  const { review, approval, cancellation } = view;
  const invoice = review.snapshot.invoice;
  const posting = review.postingPlan.groups[0]?.actions[0];
  const current = ready && view.dependenciesCurrent && !cancellation;
  const path = `${commercePath(book)}/invoice-cancellation-reviews/${encodeURIComponent(review.id)}`;
  return (
    <Box display="grid" gap="lg" minWidth="zero">
      {!cancellation ? (
        <>
          <Text role="status">
            {!ready ? copy.unknown : view.dependenciesCurrent ? copy.ready : copy.stale}
          </Text>
          <RecordSummary>
            <RecordFact label={copy.original}>
              {review.snapshot.issue.internalDocumentNumber}
            </RecordFact>
            <RecordFact label={copy.amount}>
              {formatMinorAmount(invoice.amountMinor, invoice.currencyScale, locale)}{" "}
              {invoice.currency}
            </RecordFact>
            <RecordFact label={copy.date}>{review.input.postingDate}</RecordFact>
          </RecordSummary>
          <Text>
            {copy.reason}: {review.input.reason}
          </Text>
          {posting ? (
            <DataTable
              title={copy.posting}
              minWidth="fit"
              narrow="scroll"
              columns={[
                { id: "account", label: copy.account },
                { id: "debit", label: copy.debit, numeric: true },
                { id: "credit", label: copy.credit, numeric: true },
              ]}
              rows={posting.lines.map((line) => {
                const account = setup.data?.accounts.find((entry) => entry.id === line.accountId);
                return {
                  id: line.lineId,
                  cells: [
                    account ? `${account.code} · ${account.name}` : line.accountId,
                    formatMinorAmount(line.debitMinor, invoice.currencyScale, locale),
                    formatMinorAmount(line.creditMinor, invoice.currencyScale, locale),
                  ],
                };
              })}
            />
          ) : null}
          {view.approvalUsable && approval ? (
            <Text>
              {copy.expires}{" "}
              {new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(
                new Date(approval.expiresAt),
              )}
            </Text>
          ) : null}
          {!view.approvalUsable && view.approvals.length > 0 && current ? (
            <Text>{copy.expired}</Text>
          ) : null}
        </>
      ) : null}
      <CommandForm
        {...props}
        compact
        path={`${path}/approve`}
        schema={Cancellation.ApproveInvoiceCancellation}
        output={Cancellation.InvoiceCancellationApproval}
        label={copy.approve}
        allowed={current && book.role === "operator" && !view.approvalUsable}
        input={(fields) => ({
          version: 1,
          digest: review.digest,
          acknowledgeSyntheticOnly: fields.get("acknowledgeSyntheticOnly") === "on",
        })}
      >
        <CancellationAcknowledgment locale={locale} />
      </CommandForm>
      {/* Keep uncertain requests mounted when approval or cancellation state changes. */}
      {view.approvals.map((entry) => (
        <Box key={entry.approval.id} display="grid" gap="lg">
          <CommandForm
            {...props}
            compact
            path={`${path}/execute`}
            schema={Cancellation.ExecuteInvoiceCancellation}
            output={Cancellation.InvoiceCancellationReceipt}
            label={copy.execute}
            allowed={
              current &&
              book.role === "operator" &&
              view.approvalUsable &&
              approval?.id === entry.approval.id
            }
            input={(fields) => ({
              version: 1,
              digest: review.digest,
              approvalId: entry.approval.id,
              acknowledgeSyntheticOnly: fields.get("acknowledgeSyntheticOnly") === "on",
            })}
          >
            <CancellationAcknowledgment locale={locale} />
          </CommandForm>
          <Details title={copy.revoke}>
            <CommandForm
              {...props}
              compact
              path={`${commercePath(book)}/invoice-cancellation-approvals/${encodeURIComponent(entry.approval.id)}/revoke`}
              schema={Cancellation.RevokeInvoiceCancellationApproval}
              output={Cancellation.InvoiceCancellationRevocation}
              label={copy.revoke}
              allowed={ready && book.role === "operator" && !cancellation && !entry.revocation}
              input={(fields) => ({ reason: fields.get("reason") })}
            >
              <InputField name="reason" label={copy.revokeReason} required maxLength={2000} />
            </CommandForm>
          </Details>
        </Box>
      ))}
      <Details title={copy.technical}>
        <Text tone="muted">{copy.authority}</Text>
        <Details title={copy.evidence}>
          <Evidence {...props} reference={review.snapshot.invoice.evidence} />
        </Details>
        <Facts title={copy.invoice} value={review.snapshot} />
        <Facts title={copy.journal} value={review.postingPlan} />
        <Facts title={copy.approvals} value={view.approvals} />
        {cancellation ? <Facts title={copy.receipt} value={cancellation} /> : null}
      </Details>
    </Box>
  );
}
