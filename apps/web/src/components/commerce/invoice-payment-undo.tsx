import { useQuery } from "@tanstack/react-query";
import * as Reversal from "@open-erp/contracts/commerce-allocation-reversals";
import type * as Commerce from "@open-erp/contracts/commerce";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { Badge } from "@open-erp/ui/components/badge";
import { RecordHeading, RecordSummary, RecordFact } from "@open-erp/ui/components/record-layout";
import { DataTable } from "@open-erp/ui/components/data-table";
import { Text } from "@open-erp/ui/components/typography";
import { AccountingStatus } from "@/components/accounting-status";
import { readAccounting } from "@/lib/accounting-api";
import { formatMinorAmount } from "@/lib/workspace-api";
import {
  CommandForm,
  Details,
  Field,
  checkScope,
  commerceKey,
  commercePath,
  type CommerceProps,
} from "./shared";
import { CommerceAllocationReversalReview, type UndoContext } from "./allocation-reversal-review";
import { paymentUndoCopy } from "./payment-undo-copy";
import type { InvoicePaymentNavigation } from "./invoice-payments";

type UndoProps = CommerceProps &
  UndoContext & { plan: typeof Commerce.AllocationPlan.Type; navigation: InvoicePaymentNavigation };

export function InvoicePaymentUndo(props: UndoProps) {
  const { book, locale, receipt, navigation } = props;
  const copy = paymentUndoCopy(locale);
  const status = useQuery({
    queryKey: [...commerceKey(book), "allocation-release-status", receipt.id],
    staleTime: 0,
    refetchOnMount: "always",
    retry: false,
    queryFn: async ({ signal }) => {
      const result = await readAccounting(
        `${commercePath(book)}/allocation-receipts/${encodeURIComponent(receipt.id)}/status`,
        Reversal.CommerceAllocationStatus,
        { signal },
      );
      checkScope(book, result.original.scope);
      if (
        result.original.id !== receipt.id ||
        result.original.planId !== props.plan.id ||
        result.original.planDigest !== props.plan.digest
      )
        throw new Error("Invoice payment status mismatch");
      if (result.reversal) {
        checkScope(book, result.reversal.scope);
        if (result.reversal.receiptId !== receipt.id)
          throw new Error("Invoice payment undo mismatch");
      }
      return result;
    },
  });
  const ready = status.isSuccess && status.isFetchedAfterMount && !status.isFetching;
  if (navigation.releaseId && navigation.releaseId !== "new")
    return (
      <CommerceAllocationReversalReview
        book={book}
        locale={locale}
        id={navigation.releaseId}
        context={{ invoice: props.invoice, receipt }}
        onBack={() => navigation.onRelease(undefined)}
        onNewReview={ready && status.data?.active ? () => navigation.onRelease("new") : undefined}
      />
    );
  return (
    <Box display="grid" gap="lg">
      {navigation.releaseId === "new" ? (
        <>
          <Box>
            <Button variant="ghost" onClick={() => navigation.onRelease(undefined)}>
              {copy.back}
            </Button>
          </Box>
          <RecordHeading
            title={`${copy.title} · ${props.invoice.documentNumber}`}
            subtitle={props.invoice.counterpartyName}
          />
          <PrepareUndo {...props} ready={ready && status.data?.active === true} />
        </>
      ) : null}
      <AccountingStatus locale={locale} pending={status.isPending} error={status.error} />
      {status.isError ? (
        <Box>
          <Button
            variant="outline"
            onClick={() => {
              void status.refetch();
            }}
          >
            {copy.refresh}
          </Button>
        </Box>
      ) : null}
      {ready ? (
        <>
          {navigation.releaseId !== "new" || !status.data.active ? (
            <Box display="flex" alignItems="center" justifyContent="between" gap="md">
              <Badge variant={status.data.active ? "success" : "secondary"}>
                {status.data.active ? copy.matched : copy.released}
              </Badge>
              {status.data.active ? (
                <Button variant="outline" onClick={() => navigation.onRelease("new")}>
                  {copy.undo}
                </Button>
              ) : null}
            </Box>
          ) : null}
          {status.data.plans.length ? (
            <Details title={copy.history}>
              {[...status.data.plans]
                .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
                .map((plan) => (
                  <Box
                    key={plan.id}
                    display="flex"
                    justifyContent="between"
                    alignItems="center"
                    gap="md"
                  >
                    <Box display="grid" gap="xs">
                      <Text>{plan.reason}</Text>
                      <Text tone="muted">
                        {new Intl.DateTimeFormat(locale, {
                          dateStyle: "medium",
                          timeStyle: "short",
                        }).format(new Date(plan.createdAt))}
                      </Text>
                    </Box>
                    <Button variant="ghost" onClick={() => navigation.onRelease(plan.id)}>
                      {copy.review}
                    </Button>
                  </Box>
                ))}
            </Details>
          ) : null}
        </>
      ) : null}
    </Box>
  );
}

function PrepareUndo(props: UndoProps & { ready: boolean }) {
  const { book, locale, plan, invoice } = props;
  const copy = paymentUndoCopy(locale);
  const money = (amount: string) =>
    `${formatMinorAmount(amount, invoice.currencyScale, locale)} ${invoice.currency}`;
  return (
    <Box display="grid" gap="lg" minWidth="zero">
      <RecordSummary>
        <RecordFact label={copy.matchedAmount}>{money(props.receipt.totalMinor)}</RecordFact>
        <RecordFact label={copy.currentBalance}>
          {invoice.outstandingMinor === null ? "—" : money(invoice.outstandingMinor)}
        </RecordFact>
      </RecordSummary>
      <Text tone="muted">{copy.effect}</Text>
      {plan.legs.length > 1 ? (
        <>
          <Text>{copy.whole}</Text>
          <DataTable
            title={copy.invoice}
            minWidth="fit"
            columns={[
              { id: "invoice", label: copy.invoice },
              { id: "amount", label: copy.amount, numeric: true },
            ]}
            rows={plan.legs.map((leg) => ({
              id: leg.invoiceId,
              cells: [leg.documentNumber, money(leg.amountMinor)],
            }))}
          />
        </>
      ) : null}
      <CommandForm
        book={book}
        locale={locale}
        compact
        recoveryId={props.receipt.id}
        path={`${commercePath(book)}/allocation-reversal-plans`}
        schema={Reversal.PrepareCommerceAllocationReversal}
        output={Reversal.CommerceAllocationReversalPlan}
        label={copy.prepare}
        allowed={props.ready}
        input={(fields) => ({ receiptId: props.receipt.id, reason: fields.get("reason") })}
        onSuccess={(result) => {
          if (
            result.input.receiptId !== props.receipt.id ||
            result.snapshot.original.planId !== plan.id ||
            result.snapshot.original.planDigest !== plan.digest ||
            !result.snapshot.invoices.some((item) => item.invoice.id === invoice.id)
          )
            throw new Error("Prepared invoice undo mismatch");
          props.navigation.onRelease(result.id);
        }}
      >
        <Field name="reason" label={copy.reason} />
      </CommandForm>
    </Box>
  );
}
