import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Commerce from "@open-erp/contracts/commerce";
import * as Credits from "@open-erp/contracts/supplier-credits";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { DataTable } from "@open-erp/ui/components/data-table";
import { InputField, SelectField } from "@open-erp/ui/components/field";
import { PageCaption, RecordOpen } from "@open-erp/ui/components/accounting-page";
import { RecordSection } from "@open-erp/ui/components/record-layout";
import { Text } from "@open-erp/ui/components/typography";
import { AccountingStatus } from "@/components/accounting-status";
import { EvidenceCommandForm } from "@/components/evidence-command-form";
import { bookKey, bookPath, readAccounting } from "@/lib/accounting-api";
import { formatMinorAmount } from "@/lib/workspace-api";
import { CommandForm, checkScope, commerceKey, commercePath, type CommerceProps } from "./shared";

type Invoice = typeof Commerce.Invoice.Type;

function textField(fields: FormData, name: string) {
  const value = fields.get(name);

  return typeof value === "string" ? value : "";
}

export function SupplierCreditPanel(props: CommerceProps & { invoice: Invoice }) {
  const [reviewId, setReviewId] = useState("");
  const sv = props.locale === "sv";
  const invoice = props.invoice;

  const history = useQuery({
    queryKey: [...commerceKey(props.book), "supplier-credit-history", invoice.id],
    queryFn: async ({ signal }) => {
      const result = await readAccounting(
        `${commercePath(props.book)}/invoices/${encodeURIComponent(invoice.id)}/supplier-credits`,
        Credits.SupplierCreditHistory,
        { signal },
      );

      checkScope(props.book, result.scope);

      if (result.invoiceId !== invoice.id) throw new Error("Supplier credit history mismatch");

      return result;
    },
    retry: false,
  });

  const available =
    invoice.supplierAcceptanceDigest &&
    invoice.status === "open" &&
    invoice.outstandingMinor === invoice.amountMinor &&
    invoice.recordedAllocatedMinor === "0";

  const setup = useQuery({
    queryKey: [...bookKey(props.book), "setup"],
    queryFn: ({ signal }) =>
      readAccounting(`${bookPath(props.book)}/setup`, Accounting.BookSetup, { signal }),
    enabled: !!available,
    retry: false,
  });

  return (
    <RecordSection title={sv ? "Kreditera leverantörsfaktura" : "Credit supplier invoice"}>
      <PageCaption>
        {sv
          ? "En full kredit återför originalets utgiftskonton och moms. Granska verifikationen innan du attesterar."
          : "A full credit reverses the original expense accounts and VAT. Review the voucher before approval."}
      </PageCaption>
      <AccountingStatus locale={props.locale} pending={history.isPending} error={history.error} />
      {history.data?.items.map((item) => (
        <RecordOpen key={item.id} onClick={() => setReviewId(item.reviewId)}>
          {sv ? "Kredit" : "Credit"} {item.supplierCreditNumber} ·{" "}
          {formatMinorAmount(item.amountMinor, invoice.currencyScale, props.locale)}{" "}
          {invoice.currency}
        </RecordOpen>
      ))}
      {reviewId ? <SupplierCreditReview {...props} id={reviewId} /> : null}
      {available && !reviewId ? (
        <>
          <AccountingStatus locale={props.locale} pending={setup.isPending} error={setup.error} />
          <EvidenceCommandForm
            {...props}
            path={`${commercePath(props.book)}/supplier-credit-reviews`}
            schema={Credits.PrepareSupplierCredit}
            output={Credits.SupplierCreditReview}
            label={sv ? "Förbered full kredit" : "Prepare full credit"}
            canSubmit={setup.isSuccess}
            source={(fields) => ({
              title: `${sv ? "Kredit" : "Credit"} ${textField(fields, "supplierCreditNumber")}`,
              origin: "Supplier credit captured in OpenERP",
              mediaType: "application/json",
              content: JSON.stringify({
                kind: "supplier_credit_source_v1",
                invoiceId: invoice.id,
                supplierCreditNumber: fields.get("supplierCreditNumber"),
                creditDate: fields.get("creditDate"),
                reason: fields.get("reason"),
              }),
            })}
            input={(fields, evidence) => ({
              profile: "swedish-purchase-full-credit-v1",
              invoiceId: invoice.id,
              acceptanceDigest: invoice.supplierAcceptanceDigest,
              expectedInvoiceRevision: invoice.currentRevision.revision,
              expectedAllocationVersion: invoice.allocationVersion,
              expectedOutstandingMinor: invoice.outstandingMinor,
              creditEvidenceId: evidence.id,
              supplierCreditNumber: fields.get("supplierCreditNumber"),
              amountMinor: invoice.amountMinor,
              creditDate: fields.get("creditDate"),
              accountingPeriodId: fields.get("accountingPeriodId"),
              series: fields.get("series"),
              reason: fields.get("reason"),
              acknowledgeSyntheticOnly: fields.get("acknowledgeSyntheticOnly") === "on",
            })}
            onSuccess={(result) => setReviewId(result.id)}
          >
            <Text>
              {invoice.documentNumber} ·{" "}
              {formatMinorAmount(invoice.amountMinor, invoice.currencyScale, props.locale)}{" "}
              {invoice.currency}
            </Text>
            <InputField
              name="supplierCreditNumber"
              label={sv ? "Leverantörens kreditnummer" : "Supplier credit number"}
              required
              maxLength={128}
            />
            <InputField
              name="creditDate"
              label={sv ? "Kreditdatum" : "Credit date"}
              type="date"
              required
            />
            <SelectField
              name="accountingPeriodId"
              label={sv ? "Bokföringsperiod" : "Accounting period"}
              options={[
                { value: "", label: "—" },
                ...(setup.data?.periods
                  .filter((period) => !period.locked)
                  .map((period) => ({
                    value: period.id,
                    label: `${period.startsOn} – ${period.endsOn}`,
                  })) ?? []),
              ]}
              required
            />
            <InputField
              name="series"
              label={sv ? "Verifikationsserie" : "Voucher series"}
              maxLength={16}
              required
            />
            <InputField
              name="reason"
              label={sv ? "Motivering" : "Reason"}
              maxLength={2000}
              required
            />
            <label>
              <input name="acknowledgeSyntheticOnly" type="checkbox" required />{" "}
              {sv
                ? "Jag förstår att detta bokför krediten utan att skicka en återbetalning."
                : "I understand this posts the credit without sending a refund."}
            </label>
          </EvidenceCommandForm>
        </>
      ) : null}
    </RecordSection>
  );
}

function SupplierCreditReview(props: CommerceProps & { id: string; invoice: Invoice }) {
  const sv = props.locale === "sv";

  const review = useQuery({
    queryKey: [...commerceKey(props.book), "supplier-credit-review", props.id],
    staleTime: 0,
    refetchOnMount: "always",
    queryFn: async ({ signal }) => {
      const result = await readAccounting(
        `${commercePath(props.book)}/supplier-credit-reviews/${encodeURIComponent(props.id)}`,
        Credits.SupplierCreditView,
        { signal },
      );

      checkScope(props.book, result.review.scope);

      if (result.review.input.invoiceId !== props.invoice.id)
        throw new Error("Supplier credit review mismatch");

      return result;
    },
    retry: false,
  });

  const setup = useQuery({
    queryKey: [...bookKey(props.book), "setup"],
    queryFn: ({ signal }) =>
      readAccounting(`${bookPath(props.book)}/setup`, Accounting.BookSetup, { signal }),
    retry: false,
  });

  const view = review.data;

  return (
    <Box display="grid" gap="lg">
      <Button variant="outline" disabled={review.isFetching} onClick={() => void review.refetch()}>
        {sv ? "Uppdatera granskning" : "Refresh review"}
      </Button>
      <AccountingStatus locale={props.locale} pending={review.isPending} error={review.error} />
      <AccountingStatus locale={props.locale} pending={setup.isPending} error={setup.error} />
      {view ? (
        <>
          <DataTable
            title={sv ? "Återförd verifikation" : "Reversing voucher"}
            narrow="stack"
            columns={[
              { id: "account", label: sv ? "Konto" : "Account" },
              { id: "debit", label: sv ? "Debet" : "Debit", numeric: true },
              { id: "credit", label: sv ? "Kredit" : "Credit", numeric: true },
            ]}
            rows={view.review.postingPlan.groups.flatMap((group) =>
              group.actions.flatMap((action) =>
                action.lines.map((line) => {
                  const account = setup.data?.accounts.find((item) => item.id === line.accountId);

                  return {
                    id: `${group.id}:${line.lineId}`,
                    cells: [
                      account ? `${account.code} · ${account.name}` : line.accountId,
                      formatMinorAmount(line.debitMinor, props.invoice.currencyScale, props.locale),
                      formatMinorAmount(
                        line.creditMinor,
                        props.invoice.currencyScale,
                        props.locale,
                      ),
                    ],
                  };
                }),
              ),
            )}
          />
          {view.credit ? (
            <Text role="status">{sv ? "Krediten är bokförd." : "Credit posted."}</Text>
          ) : (
            <>
              <CommandForm
                {...props}
                compact
                path={`${commercePath(props.book)}/supplier-credit-reviews/${encodeURIComponent(props.id)}/approvals`}
                recoveryId={props.id}
                schema={Credits.ApproveSupplierCredit}
                output={Credits.SupplierCreditApproval}
                label={sv ? "Attestera kredit" : "Approve credit"}
                onSuccess={() => void review.refetch()}
                allowed={
                  review.isFetchedAfterMount &&
                  review.fetchStatus === "idle" &&
                  view.dependenciesCurrent &&
                  !view.approval &&
                  props.book.role === "operator"
                }
                input={(fields) => ({
                  digest: view.review.digest,
                  acknowledgeSyntheticOnly: fields.get("acknowledgeSyntheticOnly") === "on",
                })}
              >
                <label>
                  <input name="acknowledgeSyntheticOnly" type="checkbox" required />{" "}
                  {sv
                    ? "Jag förstår att detta bokför krediten."
                    : "I understand this posts the credit."}
                </label>
              </CommandForm>
              {view.approval ? (
                <CommandForm
                  {...props}
                  compact
                  path={`${commercePath(props.book)}/supplier-credit-reviews/${encodeURIComponent(props.id)}/execute`}
                  recoveryId={`${props.id}:${view.approval.id}`}
                  schema={Credits.ExecuteSupplierCredit}
                  output={Credits.SupplierCreditReceipt}
                  label={sv ? "Bokför kredit" : "Post credit"}
                  onSuccess={() => void review.refetch()}
                  allowed={
                    review.isFetchedAfterMount &&
                    review.fetchStatus === "idle" &&
                    view.dependenciesCurrent &&
                    props.book.role === "operator"
                  }
                  input={(fields) => ({
                    digest: view.review.digest,
                    approvalId: view.approval?.id,
                    acknowledgeSyntheticOnly: fields.get("acknowledgeSyntheticOnly") === "on",
                  })}
                >
                  <label>
                    <input name="acknowledgeSyntheticOnly" type="checkbox" required />{" "}
                    {sv
                      ? "Jag förstår att detta bokför krediten."
                      : "I understand this posts the credit."}
                  </label>
                </CommandForm>
              ) : null}
            </>
          )}
        </>
      ) : null}
    </Box>
  );
}
