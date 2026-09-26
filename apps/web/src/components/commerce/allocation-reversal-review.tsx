import { useQuery } from "@tanstack/react-query";
import * as Reversal from "@open-erp/contracts/commerce-allocation-reversals";
import type * as Commerce from "@open-erp/contracts/commerce";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { Badge } from "@open-erp/ui/components/badge";
import { DataTable } from "@open-erp/ui/components/data-table";
import { RecordHeading, RecordSummary, RecordFact } from "@open-erp/ui/components/record-layout";
import { Text } from "@open-erp/ui/components/typography";
import { AccountingStatus } from "@/components/accounting-status";
import { readAccounting } from "@/lib/accounting-api";
import { formatMinorAmount } from "@/lib/workspace-api";
import {
  CommandForm,
  Details,
  Evidence,
  Facts,
  Field,
  checkScope,
  commerceKey,
  commercePath,
  type CommerceProps,
} from "./shared";
import { paymentUndoCopy } from "./payment-undo-copy";

export type UndoContext = {
  invoice: typeof Commerce.Invoice.Type;
  receipt: typeof Commerce.AllocationReceipt.Type;
};

type ReviewProps = CommerceProps & {
  id: string;
  context?: UndoContext;
  onBack?: () => void;
  onNewReview?: () => void;
};

export function CommerceAllocationReversalReview(props: ReviewProps) {
  const { book, locale, id } = props;
  const copy = paymentUndoCopy(locale);

  const review = useQuery({
    queryKey: [...commerceKey(book), "unallocation-review", id],
    staleTime: 0,
    refetchOnMount: "always",
    retry: false,
    queryFn: async ({ signal }) => {
      const result = await readAccounting(
        `${commercePath(book)}/allocation-reversal-plans/${encodeURIComponent(id)}`,
        Reversal.CommerceAllocationReversalView,
        { signal },
      );

      checkReview(props, result);

      return result;
    },
  });

  const ready = review.isSuccess && review.isFetchedAfterMount && !review.isFetching;

  return (
    <Box display="grid" gap="lg" minWidth="zero">
      {props.onBack ? (
        <Box>
          <Button variant="ghost" onClick={props.onBack}>
            {copy.back}
          </Button>
        </Box>
      ) : null}
      <RecordHeading
        title={
          props.context ? `${copy.title} · ${props.context.invoice.documentNumber}` : copy.title
        }
        subtitle={props.context?.invoice.counterpartyName}
        action={
          <Button
            variant="ghost"
            disabled={review.isFetching}
            onClick={() => {
              void review.refetch();
            }}
          >
            {copy.refresh}
          </Button>
        }
      />
      <AccountingStatus locale={locale} pending={review.isPending} error={review.error} />
      {review.data && !review.isError ? (
        <ReviewContents {...props} view={review.data} ready={ready} />
      ) : null}
    </Box>
  );
}

function checkReview(
  props: ReviewProps,
  view: typeof Reversal.CommerceAllocationReversalView.Type,
) {
  const { plan, approval, execution } = view;
  const snapshot = plan.snapshot;

  for (const record of [plan, snapshot.original, snapshot.originalPlan, snapshot.payment])
    checkScope(props.book, record.scope);

  for (const item of snapshot.invoices) checkScope(props.book, item.invoice.scope);

  if (
    plan.id !== props.id ||
    plan.input.receiptId !== snapshot.original.id ||
    snapshot.original.planId !== snapshot.originalPlan.id ||
    snapshot.original.planDigest !== snapshot.originalPlan.digest
  )
    throw new Error("Undo review binding mismatch");

  if (
    props.context &&
    (plan.input.receiptId !== props.context.receipt.id ||
      snapshot.original.planDigest !== props.context.receipt.planDigest ||
      plan.currency !== props.context.invoice.currency ||
      plan.currencyScale !== props.context.invoice.currencyScale ||
      !snapshot.invoices.some((item) => item.invoice.id === props.context?.invoice.id))
  )
    throw new Error("Invoice undo context mismatch");

  if (approval && (approval.planId !== plan.id || approval.digest !== plan.digest))
    throw new Error("Undo approval binding mismatch");

  for (const entry of view.approvals) {
    if (
      entry.approval.planId !== plan.id ||
      entry.approval.digest !== plan.digest ||
      (entry.revocation && entry.revocation.approvalId !== entry.approval.id)
    )
      throw new Error("Undo approval history mismatch");
  }

  if (execution) {
    checkScope(props.book, execution.scope);

    if (
      execution.planId !== plan.id ||
      execution.receiptId !== plan.input.receiptId ||
      execution.digest !== plan.digest
    )
      throw new Error("Undo execution binding mismatch");
  }
}

function ReviewContents(
  props: ReviewProps & {
    view: typeof Reversal.CommerceAllocationReversalView.Type;
    ready: boolean;
  },
) {
  const { locale, view } = props;
  const copy = paymentUndoCopy(locale);
  const plan = view.plan;

  const money = (amount: string) =>
    `${formatMinorAmount(amount, plan.currencyScale, locale)} ${plan.currency}`;

  return (
    <Box display="grid" gap="lg" minWidth="zero">
      {view.execution ? (
        <>
          <Badge variant="success">{copy.released}</Badge>
          <Text role="status">{copy.completed}</Text>
          <Text tone="muted">
            {copy.completedAt}{" "}
            {new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(
              new Date(view.execution.executedAt),
            )}
          </Text>
        </>
      ) : null}
      <RecordSummary>
        <RecordFact label={view.execution ? copy.releasedAmount : copy.amount}>
          {money(plan.snapshot.original.totalMinor)}
        </RecordFact>
        <RecordFact label={copy.paymentAfter}>
          {money(plan.snapshot.paymentRemainingAfterMinor)}
        </RecordFact>
      </RecordSummary>
      <Text>{plan.input.reason}</Text>
      <Text tone="muted">{copy.effect}</Text>
      {plan.snapshot.invoices.length > 1 ? <Text>{copy.whole}</Text> : null}
      <DataTable
        title={copy.invoice}
        minWidth="fit"
        columns={[
          { id: "invoice", label: copy.invoice },
          { id: "before", label: copy.before, numeric: true },
          {
            id: "released",
            label: view.execution ? copy.releasedAmount : copy.amount,
            numeric: true,
          },
          { id: "after", label: copy.after, numeric: true },
        ]}
        rows={plan.snapshot.invoices.map((item) => ({
          id: item.invoice.id,
          cells: [
            <Box key="invoice" display="grid" gap="xs">
              <Text>{item.invoice.documentNumber}</Text>
              <Text tone="muted">{item.invoice.counterpartyName}</Text>
            </Box>,
            item.invoice.outstandingMinor === null ? "—" : money(item.invoice.outstandingMinor),
            money(item.releasedMinor),
            money(item.outstandingAfterMinor),
          ],
        }))}
      />
      <Details title={copy.source}>
        <Evidence
          book={props.book}
          locale={locale}
          expanded
          reference={plan.snapshot.originalPlan.evidence}
        />
      </Details>
      {!view.execution && !view.dependenciesCurrent ? (
        <Box display="grid" gap="md">
          <Text role="alert">{copy.stale}</Text>
          {props.onNewReview ? (
            <Box>
              <Button variant="outline" onClick={props.onNewReview}>
                {copy.newReview}
              </Button>
            </Box>
          ) : null}
        </Box>
      ) : null}
      <UndoActions book={props.book} locale={locale} view={view} ready={props.ready} />
      <Facts title={copy.details} value={view} />
    </Box>
  );
}

function UndoActions(
  props: CommerceProps & {
    view: typeof Reversal.CommerceAllocationReversalView.Type;
    ready: boolean;
  },
) {
  const { book, locale, view, ready } = props;
  const copy = paymentUndoCopy(locale);
  const { plan, approval, execution } = view;
  const current = ready && view.dependenciesCurrent && !execution;
  const approvalCurrent = !!approval && Date.parse(approval.expiresAt) > Date.now();
  const path = `${commercePath(book)}/allocation-reversal-plans/${encodeURIComponent(plan.id)}`;

  return (
    <Box display="grid" gap="md">
      {!execution && book.role !== "operator" ? <Text>{copy.operator}</Text> : null}
      <CommandForm
        key={`${view.approvals.length}:${view.approvals.filter((entry) => entry.revocation).length}`}
        {...props}
        compact
        recoveryId={plan.id}
        path={`${path}/approve`}
        schema={Reversal.ApproveCommerceAllocationReversal}
        output={Reversal.CommerceAllocationReversalApproval}
        label={copy.approve}
        allowed={current && book.role === "operator" && !approvalCurrent}
        input={() => ({ version: 1, digest: plan.digest })}
        onSuccess={(result) => {
          if (result.planId !== plan.id || result.digest !== plan.digest)
            throw new Error("Undo approval mismatch");
        }}
      >
        <Box as="label" display="flex" gap="md" alignItems="start">
          <input type="checkbox" required />
          <span>{copy.acknowledge}</span>
        </Box>
      </CommandForm>
      {approval && !execution ? (
        <Text tone="muted">
          {approvalCurrent
            ? `${copy.approved} ${new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(approval.expiresAt))}`
            : copy.expired}
        </Text>
      ) : null}
      <CommandForm
        {...props}
        compact
        recoveryId={plan.id}
        path={`${path}/execute`}
        schema={Reversal.ExecuteCommerceAllocationReversal}
        output={Reversal.CommerceAllocationReversalExecution}
        label={copy.execute}
        allowed={current && approvalCurrent}
        input={() => ({ version: 1, digest: plan.digest, approvalId: approval?.id })}
        onSuccess={(result) => {
          if (
            result.planId !== plan.id ||
            result.digest !== plan.digest ||
            result.receiptId !== plan.input.receiptId
          )
            throw new Error("Undo execution mismatch");
        }}
      />
      {view.approvals.length ? (
        <Details title={copy.approvalHistory}>
          {view.approvals.map((entry) => (
            <Box key={entry.approval.id} display="grid" gap="md">
              <Text tone="muted">
                {entry.revocation ? copy.revoked : copy.approved} ·{" "}
                {new Intl.DateTimeFormat(locale, {
                  dateStyle: "medium",
                  timeStyle: "short",
                }).format(new Date(entry.revocation?.revokedAt ?? entry.approval.expiresAt))}
              </Text>
              {entry.revocation ? <Text>{entry.revocation.reason}</Text> : null}
              <CommandForm
                {...props}
                compact
                recoveryId={entry.approval.id}
                path={`${commercePath(book)}/allocation-reversal-approvals/${encodeURIComponent(entry.approval.id)}/revoke`}
                schema={Reversal.RevokeCommerceAllocationReversalApproval}
                output={Reversal.CommerceAllocationReversalRevocation}
                label={copy.withdraw}
                allowed={ready && book.role === "operator" && !execution && !entry.revocation}
                input={(fields) => ({ reason: fields.get("reason") })}
                onSuccess={(result) => {
                  if (result.approvalId !== entry.approval.id)
                    throw new Error("Undo withdrawal mismatch");
                }}
              >
                <Field name="reason" label={copy.withdrawReason} />
              </CommandForm>
            </Box>
          ))}
        </Details>
      ) : null}
    </Box>
  );
}
