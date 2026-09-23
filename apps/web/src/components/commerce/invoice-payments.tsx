import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import * as Commerce from "@open-erp/contracts/commerce";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { Badge } from "@open-erp/ui/components/badge";
import { InputField } from "@open-erp/ui/components/field";
import { DataTable } from "@open-erp/ui/components/data-table";
import { PageEmpty, RecordToggle } from "@open-erp/ui/components/accounting-page";
import {
  RecordHeading,
  RecordSummary,
  RecordFact,
  RecordSection,
} from "@open-erp/ui/components/record-layout";
import { Text } from "@open-erp/ui/components/typography";
import { AccountingStatus } from "@/components/accounting-status";
import { readAccounting } from "@/lib/accounting-api";
import { decimalToMinor, minorToDecimal, formatMinorAmount } from "@/lib/workspace-api";
import {
  CommandForm,
  Details,
  Evidence,
  Field,
  checkScope,
  commerceKey,
  commercePath,
  type CommerceProps,
} from "./shared";
import { InvoicePaymentReview } from "./invoice-payment-review";
import { invoicePaymentCopy } from "./invoice-payment-copy";

export type InvoicePaymentNavigation = {
  planId?: string;
  onPlan: (id: string | undefined) => void;
  onBack: () => void;
};
type PaymentProps = CommerceProps & {
  invoice: typeof Commerce.Invoice.Type;
  navigation: InvoicePaymentNavigation;
};

export function InvoicePaymentsWorkspace(props: PaymentProps) {
  const { book, locale, invoice, navigation } = props;
  const copy = invoicePaymentCopy(locale);
  const [page, setPage] = useState(1);
  const [historyPage, setHistoryPage] = useState(1);
  const [selected, setSelected] = useState<typeof Commerce.InvoicePaymentCandidate.Type | null>(
    null,
  );
  const query = new URLSearchParams({ page: String(page), historyPage: String(historyPage) });
  const payments = useQuery({
    enabled: !navigation.planId,
    queryKey: [...commerceKey(book), "invoice-payments", invoice.id, page, historyPage],
    staleTime: 0,
    refetchOnMount: "always",
    retry: false,
    queryFn: async ({ signal }) => {
      const result = await readAccounting(
        `${commercePath(book)}/invoices/${encodeURIComponent(invoice.id)}/payments?${query}`,
        Commerce.InvoicePayments,
        { signal },
      );
      checkScope(book, result.scope);
      if (
        result.invoiceId !== invoice.id ||
        result.page !== page ||
        result.historyPage !== historyPage
      )
        throw new Error("Invoice payment projection mismatch");
      for (const candidate of result.items) {
        checkScope(book, candidate.payment.scope);
        if (
          candidate.payment.accountId !== invoice.controlAccountId ||
          candidate.payment.direction !== invoice.direction ||
          candidate.payment.currency !== invoice.currency ||
          candidate.payment.currencyScale !== invoice.currencyScale
        )
          throw new Error("Invoice payment candidate mismatch");
      }
      return result;
    },
  });
  const ready = payments.isSuccess && payments.isFetchedAfterMount && !payments.isFetching;
  const candidate = ready
    ? payments.data.items.find(
        (item) =>
          item.payment.voucherId === selected?.payment.voucherId &&
          item.payment.lineId === selected.payment.lineId,
      )
    : undefined;
  const money = (amount: string) =>
    `${formatMinorAmount(amount, invoice.currencyScale, locale)} ${invoice.currency}`;
  if (navigation.planId) return <InvoicePaymentReview {...props} id={navigation.planId} />;
  return (
    <Box display="grid" gap="lg" minWidth="zero">
      <Box>
        <Button variant="ghost" onClick={navigation.onBack}>
          <ArrowLeft size={14} />
          {copy.back}
        </Button>
      </Box>
      <RecordHeading
        title={`${copy.title} · ${invoice.documentNumber}`}
        subtitle={invoice.counterpartyName}
        action={
          <Button
            variant="ghost"
            disabled={payments.isFetching}
            onClick={() => {
              void payments.refetch();
            }}
          >
            {copy.refresh}
          </Button>
        }
      />
      <RecordSummary>
        <RecordFact label={copy.outstanding}>
          {invoice.outstandingMinor === null ? "—" : money(invoice.outstandingMinor)}
        </RecordFact>
        <RecordFact label={copy.matched}>{money(invoice.recordedAllocatedMinor)}</RecordFact>
      </RecordSummary>
      <>
        <AccountingStatus locale={locale} pending={payments.isPending} error={payments.error} />
        {ready && !candidate ? (
          <>
            {invoice.status === "open" || invoice.status === "partially_allocated" ? (
              <RecordSection title={copy.available}>
                <Text tone="muted">{copy.availableHelp}</Text>
                {payments.data.items.length ? (
                  <DataTable
                    title={copy.available}
                    minWidth="fit"
                    columns={[
                      { id: "date", label: copy.date },
                      { id: "payment", label: copy.payment },
                      { id: "amount", label: copy.remaining, numeric: true },
                      { id: "choose", label: "" },
                    ]}
                    rows={payments.data.items.map((item) => ({
                      id: `${item.payment.voucherId}:${item.payment.lineId}`,
                      cells: [
                        item.payment.postingDate,
                        <Box key="reference" display="grid" gap="xs">
                          <Text>{item.voucherLabel}</Text>
                          <Text tone="muted">{item.description}</Text>
                        </Box>,
                        money(item.payment.remainingMinor),
                        <Button
                          key="choose"
                          variant="outline"
                          size="sm"
                          onClick={() => setSelected(item)}
                        >
                          {candidate === item ? copy.selected : copy.choose}
                        </Button>,
                      ],
                    }))}
                  />
                ) : (
                  <PageEmpty title={copy.empty} detail={copy.emptyHelp} />
                )}
                <PaymentPager
                  {...props}
                  page={page}
                  total={payments.data.total}
                  onPage={(next) => {
                    setSelected(null);
                    setPage(next);
                  }}
                />
              </RecordSection>
            ) : null}
          </>
        ) : null}
        {candidate ? (
          <Box>
            <Button variant="ghost" onClick={() => setSelected(null)}>
              {copy.chooseAnother}
            </Button>
          </Box>
        ) : null}
        <PrepareInvoicePayment {...props} candidate={candidate} ready={ready} />
        {ready && !candidate ? (
          <RecordSection title={copy.history}>
            {payments.data.history.length ? (
              <DataTable
                title={copy.history}
                minWidth="fit"
                columns={[
                  { id: "payment", label: copy.payment },
                  { id: "date", label: copy.date },
                  { id: "status", label: "Status" },
                  { id: "amount", label: copy.amount, numeric: true },
                ]}
                rows={payments.data.history.map((item) => ({
                  id: item.planId,
                  cells: [
                    <RecordToggle
                      key="open"
                      expanded={false}
                      onClick={() => navigation.onPlan(item.planId)}
                    >
                      {item.voucherLabel}
                    </RecordToggle>,
                    item.postingDate,
                    <Badge
                      key="status"
                      variant={item.status === "matched" ? "success" : "secondary"}
                    >
                      {copy[item.status]}
                    </Badge>,
                    money(item.amountMinor),
                  ],
                }))}
              />
            ) : (
              <PageEmpty title={copy.noHistory} detail={copy.historyHelp} />
            )}
            <PaymentPager
              {...props}
              page={historyPage}
              total={payments.data.historyTotal}
              onPage={setHistoryPage}
            />
          </RecordSection>
        ) : null}
      </>
    </Box>
  );
}

function PrepareInvoicePayment(
  props: PaymentProps & {
    candidate?: typeof Commerce.InvoicePaymentCandidate.Type;
    ready: boolean;
  },
) {
  const { book, locale, invoice, candidate } = props;
  const copy = invoicePaymentCopy(locale);
  const outstanding = BigInt(invoice.outstandingMinor ?? "0");
  const available = BigInt(candidate?.payment.remainingMinor ?? "0");
  const maximum = outstanding < available ? outstanding : available;
  const [amount, setAmount] = useState({ payment: "", value: "" });
  const paymentKey = candidate
    ? `${candidate.payment.voucherId}:${candidate.payment.lineId}:${maximum}`
    : "";
  const value =
    amount.payment === paymentKey
      ? amount.value
      : minorToDecimal(String(maximum), invoice.currencyScale);
  const parsed = decimalToMinor(value, invoice.currencyScale);
  const valid = parsed !== null && BigInt(parsed) > 0n && BigInt(parsed) <= maximum;
  return (
    <CommandForm
      {...props}
      compact
      recoveryId={invoice.id}
      path={`${commercePath(book)}/allocation-plans`}
      schema={Commerce.PrepareAllocation}
      output={Commerce.AllocationPlan}
      label={copy.prepare}
      allowed={props.ready && !!candidate && maximum > 0n}
      canSubmit={valid}
      input={(fields) => ({
        voucherId: candidate?.payment.voucherId,
        lineId: candidate?.payment.lineId,
        evidenceId: candidate?.evidence.evidenceId,
        rationale: fields.get("rationale"),
        allocations: [{ invoiceId: invoice.id, amountMinor: parsed }],
      })}
      onSuccess={(plan) => {
        if (plan.legs.length !== 1 || plan.legs[0]?.invoiceId !== invoice.id)
          throw new Error("Prepared invoice payment mismatch");
        props.navigation.onPlan(plan.id);
      }}
    >
      {candidate ? (
        <RecordSection key={paymentKey} title={`${copy.match} · ${candidate.voucherLabel}`}>
          <Text>{candidate.sourceTitle}</Text>
          <Text tone="muted">
            {candidate.payment.postingDate} · {copy.remaining}:{" "}
            {formatMinorAmount(candidate.payment.remainingMinor, invoice.currencyScale, locale)}{" "}
            {invoice.currency}
          </Text>
          <Details title={copy.source}>
            <Evidence {...props} expanded reference={candidate.evidence} />
          </Details>
          <InputField
            name="amount"
            label={`${copy.amount} (${invoice.currency})`}
            inputMode="decimal"
            value={value}
            onChange={(event) => setAmount({ payment: paymentKey, value: event.target.value })}
            required
          />
          {!valid ? <Text role="alert">{copy.invalid}</Text> : null}
          <Field name="rationale" label={copy.reason} />
          <Box as="label" display="flex" gap="md" alignItems="start">
            <input type="checkbox" required />
            <span>{copy.acknowledge}</span>
          </Box>
        </RecordSection>
      ) : null}
    </CommandForm>
  );
}

function PaymentPager(
  props: CommerceProps & { page: number; total: number; onPage: (page: number) => void },
) {
  const copy = invoicePaymentCopy(props.locale);
  if (props.page === 1 && props.total <= 25) return null;
  return (
    <Box display="flex" gap="md" justifyContent="end" alignItems="center">
      <Button
        variant="ghost"
        size="sm"
        disabled={props.page <= 1}
        onClick={() => props.onPage(props.page - 1)}
      >
        {copy.previous}
      </Button>
      <Text tone="muted">
        {props.page} / {Math.max(1, Math.ceil(props.total / 25))}
      </Text>
      <Button
        variant="ghost"
        size="sm"
        disabled={props.page * 25 >= props.total}
        onClick={() => props.onPage(props.page + 1)}
      >
        {copy.next}
      </Button>
    </Box>
  );
}
