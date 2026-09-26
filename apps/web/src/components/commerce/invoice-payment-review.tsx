import { useQuery } from "@tanstack/react-query";
import * as Commerce from "@open-erp/contracts/commerce";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { RecordHeading, RecordSummary, RecordFact } from "@open-erp/ui/components/record-layout";
import { DataTable } from "@open-erp/ui/components/data-table";
import { Text } from "@open-erp/ui/components/typography";
import { AccountingStatus } from "@/components/accounting-status";
import { readAccounting } from "@/lib/accounting-api";
import { formatMinorAmount } from "@/lib/workspace-api";
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
import { InvoicePaymentUndo } from "./invoice-payment-undo";
import { invoicePaymentCopy } from "./invoice-payment-copy";
import type { InvoicePaymentNavigation } from "./invoice-payments";

export function InvoicePaymentReview(
  props: CommerceProps & {
    id: string;
    invoice: typeof Commerce.Invoice.Type;
    navigation: InvoicePaymentNavigation;
  },
) {
  const { book, locale, id, invoice } = props;
  const copy = invoicePaymentCopy(locale);

  const view = useQuery({
    queryKey: [...commerceKey(book), "allocation", id],
    staleTime: 0,
    refetchOnMount: "always",
    retry: false,
    queryFn: async ({ signal }) => {
      const result = await readAccounting(
        `${commercePath(book)}/allocation-plans/${encodeURIComponent(id)}`,
        Commerce.AllocationView,
        { signal },
      );

      checkScope(book, result.plan.scope);
      checkScope(book, result.plan.payment.scope);

      if (
        result.plan.id !== id ||
        !result.plan.legs.some((leg) => leg.invoiceId === invoice.id) ||
        result.plan.payment.currency !== invoice.currency ||
        result.plan.payment.currencyScale !== invoice.currencyScale
      )
        throw new Error("Invoice allocation review binding mismatch");

      for (const receipt of [result.approval, result.application]) {
        if (receipt && (receipt.planId !== id || receipt.planDigest !== result.plan.digest))
          throw new Error("Invoice allocation receipt mismatch");
      }

      if (result.application) checkScope(book, result.application.scope);

      return result;
    },
  });

  const ready = view.isSuccess && view.isFetchedAfterMount && !view.isFetching;
  const plan = view.data?.plan;

  const money = (amount: string) =>
    `${formatMinorAmount(amount, invoice.currencyScale, locale)} ${invoice.currency}`;

  if (props.navigation.releaseId && plan && view.data?.application && !view.isError)
    return (
      <InvoicePaymentUndo
        book={book}
        locale={locale}
        invoice={invoice}
        plan={plan}
        receipt={view.data.application}
        navigation={props.navigation}
      />
    );

  return (
    <Box display="grid" gap="lg" minWidth="zero">
      <Box>
        <Button variant="ghost" onClick={() => props.navigation.onPlan(undefined)}>
          {copy.savedReviews}
        </Button>
      </Box>
      <RecordHeading
        title={`${view.data?.application ? copy.savedTitle : copy.reviewTitle} · ${invoice.documentNumber}`}
        subtitle={`${invoice.counterpartyName}${plan ? ` · ${plan.payment.postingDate}` : ""}`}
        action={
          <Button
            variant="ghost"
            disabled={view.isFetching}
            onClick={() => {
              void view.refetch();
            }}
          >
            {copy.refresh}
          </Button>
        }
      />
      <AccountingStatus locale={locale} pending={view.isPending} error={view.error} />
      {plan && view.data && !view.isError ? (
        <>
          <RecordSummary>
            <RecordFact label={view.data.application ? copy.matchedAmount : copy.amount}>
              {money(plan.totalMinor)}
            </RecordFact>
            <RecordFact label={view.data.application ? copy.outstanding : copy.after}>
              {view.data.application
                ? invoice.outstandingMinor === null
                  ? "—"
                  : money(invoice.outstandingMinor)
                : money(
                    plan.legs.find((leg) => leg.invoiceId === invoice.id)?.outstandingAfterMinor ??
                      "0",
                  )}
            </RecordFact>
            {!view.data.application ? (
              <RecordFact label={copy.paymentAfter}>
                {money(plan.paymentRemainingAfterMinor)}
              </RecordFact>
            ) : null}
          </RecordSummary>
          <Text>{plan.rationale}</Text>
          <Text tone="muted">{copy.effect}</Text>
          <Details title={copy.source}>
            <Evidence {...props} expanded reference={plan.evidence} />
          </Details>
          {plan.legs.length > 1 ? (
            <DataTable
              title={copy.title}
              minWidth="fit"
              columns={[
                { id: "invoice", label: "Invoice" },
                { id: "amount", label: copy.amount, numeric: true },
              ]}
              rows={plan.legs.map((leg) => ({
                id: leg.invoiceId,
                cells: [leg.documentNumber, money(leg.amountMinor)],
              }))}
            />
          ) : null}
          {view.data.application ? (
            <InvoicePaymentUndo
              book={book}
              locale={locale}
              invoice={invoice}
              plan={plan}
              receipt={view.data.application}
              navigation={props.navigation}
            />
          ) : null}
          <InvoicePaymentActions {...props} view={view.data} ready={ready} />
          <Facts title={copy.details} value={view.data} />
        </>
      ) : null}
    </Box>
  );
}

function InvoicePaymentActions(
  props: CommerceProps & { view: typeof Commerce.AllocationView.Type; ready: boolean },
) {
  const { book, locale, view, ready } = props;
  const copy = invoicePaymentCopy(locale);
  const plan = view.plan;
  const approval = view.approval;
  const actionable = ready && view.dependenciesCurrent && !view.application;
  const approvalCurrent = !!approval && Date.parse(approval.expiresAt) > Date.now();

  return (
    <Box display="grid" gap="md">
      {!view.application && !view.dependenciesCurrent ? (
        <Text role="alert">{copy.stale}</Text>
      ) : null}
      {!view.application && book.role !== "operator" ? <Text>{copy.operator}</Text> : null}
      <CommandForm
        {...props}
        compact
        recoveryId={plan.id}
        path={`${commercePath(book)}/allocation-plans/${encodeURIComponent(plan.id)}/approvals`}
        schema={Commerce.ApproveAllocation}
        output={Commerce.AllocationApproval}
        label={copy.approve}
        allowed={actionable && book.role === "operator" && !approvalCurrent}
        input={() => ({ version: plan.version, planDigest: plan.digest })}
        onSuccess={(result) => {
          if (result.planId !== plan.id || result.planDigest !== plan.digest)
            throw new Error("Allocation approval binding mismatch");
        }}
      >
        <Box as="label" display="flex" gap="md" alignItems="start">
          <input type="checkbox" required />
          <span>{copy.approveAck}</span>
        </Box>
      </CommandForm>
      {approval && !view.application && view.dependenciesCurrent ? (
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
        path={`${commercePath(book)}/allocation-plans/${encodeURIComponent(plan.id)}/apply`}
        schema={Commerce.ApplyAllocation}
        output={Commerce.AllocationReceipt}
        label={copy.apply}
        allowed={actionable && approvalCurrent}
        input={() => ({ version: plan.version, planDigest: plan.digest, approvalId: approval?.id })}
        onSuccess={(result) => {
          if (result.planId !== plan.id || result.planDigest !== plan.digest)
            throw new Error("Allocation application binding mismatch");
        }}
      />
    </Box>
  );
}
