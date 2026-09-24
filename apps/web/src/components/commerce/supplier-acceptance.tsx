import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Acceptance from "@open-erp/contracts/supplier-acceptance";
import type * as Drafts from "@open-erp/contracts/supplier-invoice-drafts";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { DataTable } from "@open-erp/ui/components/data-table";
import { InputField, SelectField } from "@open-erp/ui/components/field";
import { PageAction, PageCaption, RecordOpen } from "@open-erp/ui/components/accounting-page";
import { RecordSection } from "@open-erp/ui/components/record-layout";
import { Text } from "@open-erp/ui/components/typography";
import { AccountingStatus } from "@/components/accounting-status";
import { bookKey, bookPath, readAccounting } from "@/lib/accounting-api";
import { workspacePath } from "@/lib/book-context";
import { formatMinorAmount } from "@/lib/workspace-api";
import { CommandForm, checkScope, commerceKey, commercePath, type CommerceProps } from "./shared";

type Draft = typeof Drafts.SupplierInvoiceDraftRevision.Type;

export function useSupplierAcceptanceHistory(book: CommerceProps["book"], draftId: string) {
  return useQuery({
    queryKey: [...commerceKey(book), "supplier-acceptance-history", draftId],
    staleTime: 0,
    refetchOnMount: "always",
    queryFn: async ({ signal }) => {
      const result = await readAccounting(
        `${commercePath(book)}/supplier-invoice-drafts/${encodeURIComponent(draftId)}/acceptance-reviews`,
        Acceptance.SupplierAcceptanceHistory,
        { signal },
      );
      checkScope(book, result.scope);
      if (result.draftId !== draftId) throw new Error("Supplier acceptance history mismatch");
      return result;
    },
    retry: false,
  });
}

export function SupplierAcceptancePanel(props: CommerceProps & { draft: Draft; current: boolean }) {
  const [reviewId, setReviewId] = useState("");
  const sv = props.locale === "sv";
  const history = useSupplierAcceptanceHistory(props.book, props.draft.id);
  const accepted = history.data?.items.some((item) => item.acceptanceId !== null) ?? false;
  return (
    <RecordSection
      title={sv ? "Syntetisk attest och bokföring" : "Synthetic acceptance and posting"}
    >
      <PageCaption>
        {sv
          ? "Endast syntetisk bokföring. Ingen juridisk faktura, momsbedömning eller betalning skapas."
          : "Synthetic accounting only. This creates no legal invoice, VAT assessment or payment."}
      </PageCaption>
      <AccountingStatus locale={props.locale} pending={history.isPending} error={history.error} />
      {history.isError ? (
        <Button variant="outline" onClick={() => void history.refetch()}>
          {sv ? "Försök igen" : "Retry"}
        </Button>
      ) : null}
      {history.isSuccess ? (
        <>
          {history.data.items.length ? (
            <Box display="grid" gap="sm">
              {history.data.items.map((item) => (
                <RecordOpen key={item.id} onClick={() => setReviewId(item.id)}>
                  {sv ? "Granskning" : "Review"} {item.ordinal} ·{" "}
                  {sv ? "utkastversion" : "draft revision"} {item.draftRevision}
                  {item.acceptanceId ? (sv ? " · Bokförd" : " · Posted") : ""}
                </RecordOpen>
              ))}
            </Box>
          ) : null}
          {reviewId ? <SupplierAcceptanceReview {...props} id={reviewId} /> : null}
          {!reviewId && !accepted && props.current && props.book.role === "operator" ? (
            <SupplierAcceptancePreparation {...props} onPrepared={setReviewId} />
          ) : null}
        </>
      ) : null}
    </RecordSection>
  );
}

function SyntheticAcknowledgment({ locale }: { locale: CommerceProps["locale"] }) {
  return (
    <Box as="label" display="flex" alignItems="start" gap="md" padding="md">
      <input type="checkbox" name="acknowledgeSyntheticOnly" required />
      <span>
        {locale === "sv"
          ? "Jag förstår att detta är en syntetisk bokföringsoperation utan juridisk faktura eller momsbeslut."
          : "I understand this is a synthetic accounting operation without a legal invoice or VAT decision."}
      </span>
    </Box>
  );
}

function SupplierAcceptancePreparation(
  props: CommerceProps & { draft: Draft; current: boolean; onPrepared: (id: string) => void },
) {
  const sv = props.locale === "sv";
  const setup = useQuery({
    queryKey: [...bookKey(props.book), "setup"],
    queryFn: ({ signal }) =>
      readAccounting(`${bookPath(props.book)}/setup`, Accounting.BookSetup, { signal }),
    retry: false,
  });
  const accounts =
    setup.data?.accounts
      .filter((account) => account.active)
      .map((account) => ({
        value: account.id,
        label: `${account.code} · ${account.name}`,
      })) ?? [];
  return (
    <Box display="grid" gap="lg">
      <Text>
        {sv
          ? "Granska leverantörsfakturan och välj konton för den exakta bokföringen."
          : "Review the supplier invoice and choose accounts for the exact posting."}
      </Text>
      <AccountingStatus locale={props.locale} pending={setup.isPending} error={setup.error} />
      <CommandForm
        {...props}
        compact
        path={`${commercePath(props.book)}/supplier-acceptance-reviews`}
        recoveryId={props.draft.id}
        schema={Acceptance.PrepareSupplierAcceptance}
        output={Acceptance.SupplierAcceptanceReview}
        label={sv ? "Förbered bokföring" : "Prepare posting"}
        allowed={props.current && setup.isSuccess && props.book.role === "operator"}
        input={(fields) => ({
          profile: "synthetic-manual-supplier-v1",
          draftId: props.draft.id,
          expectedRevision: props.draft.revision,
          expectedDigest: props.draft.digest,
          controlAccountId: fields.get("controlAccountId"),
          debitAccountId: fields.get("debitAccountId"),
          accountingPeriodId: fields.get("accountingPeriodId"),
          series: fields.get("series"),
          reason: fields.get("reason"),
          acknowledgeSyntheticOnly: fields.get("acknowledgeSyntheticOnly") === "on",
        })}
        onSuccess={(review) => props.onPrepared(review.id)}
      >
        <SelectField
          name="controlAccountId"
          label={sv ? "Leverantörsskuld" : "Supplier payable account"}
          options={[{ value: "", label: "—" }, ...accounts]}
          required
        />
        <SelectField
          name="debitAccountId"
          label={sv ? "Utgiftskonto" : "Expense account"}
          options={[{ value: "", label: "—" }, ...accounts]}
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
        <InputField name="reason" label={sv ? "Motivering" : "Reason"} maxLength={2000} required />
        <SyntheticAcknowledgment locale={props.locale} />
      </CommandForm>
    </Box>
  );
}

function SupplierAcceptanceReview(props: CommerceProps & { id: string; draft: Draft }) {
  const sv = props.locale === "sv";
  const review = useQuery({
    queryKey: [...commerceKey(props.book), "supplier-acceptance-review", props.id],
    staleTime: 0,
    refetchOnMount: "always",
    queryFn: async ({ signal }) => {
      const result = await readAccounting(
        `${commercePath(props.book)}/supplier-acceptance-reviews/${encodeURIComponent(props.id)}`,
        Acceptance.SupplierAcceptanceView,
        { signal },
      );
      checkScope(props.book, result.plan.scope);
      if (result.plan.id !== props.id || result.plan.input.draftId !== props.draft.id)
        throw new Error("Supplier acceptance review mismatch");
      if (result.approval) checkScope(props.book, result.approval.scope);
      if (result.acceptance) checkScope(props.book, result.acceptance.scope);
      return result;
    },
    retry: false,
  });
  const view = review.isError ? undefined : review.data;
  return (
    <Box display="grid" gap="lg">
      <Button variant="outline" disabled={review.isFetching} onClick={() => void review.refetch()}>
        {sv ? "Uppdatera granskning" : "Refresh review"}
      </Button>
      <AccountingStatus locale={props.locale} pending={review.isPending} error={review.error} />
      {view ? (
        <>
          <Text>{sv ? "Bokföringseffekt" : "Accounting effect"}</Text>
          <DataTable
            title={sv ? "Föreslagen verifikation" : "Proposed voucher"}
            narrow="stack"
            columns={[
              { id: "account", label: sv ? "Konto" : "Account" },
              { id: "debit", label: sv ? "Debet" : "Debit", numeric: true },
              { id: "credit", label: sv ? "Kredit" : "Credit", numeric: true },
            ]}
            rows={view.plan.postingPlan.groups.flatMap((group) =>
              group.actions.flatMap((action) =>
                action.lines.map((line) => ({
                  id: `${group.id}:${line.lineId}`,
                  cells: [
                    line.accountId,
                    formatMinorAmount(
                      line.debitMinor,
                      view.plan.draftSnapshot.content.currencyScale,
                      props.locale,
                    ),
                    formatMinorAmount(
                      line.creditMinor,
                      view.plan.draftSnapshot.content.currencyScale,
                      props.locale,
                    ),
                  ],
                })),
              ),
            )}
          />
          {view.blockers.map((blocker) => (
            <Text key={blocker}>{blocker}</Text>
          ))}
          {view.acceptance ? (
            <Box display="grid" gap="md">
              <Text role="status">{sv ? "Syntetiskt bokförd" : "Synthetic posting complete"}</Text>
              <Text>
                {sv ? "Verifikation" : "Voucher"}: {view.acceptance.postingReceipt.voucherId}
              </Text>
              <PageAction
                href={`${workspacePath(props.book)}/purchases?view=invoices&record=${encodeURIComponent(view.acceptance.registerInvoiceId)}`}
              >
                {sv ? "Öppna registrerad faktura" : "Open registered invoice"}
              </PageAction>
            </Box>
          ) : null}
          {!view.acceptance ? (
            <>
              <CommandForm
                {...props}
                compact
                path={`${commercePath(props.book)}/supplier-acceptance-reviews/${encodeURIComponent(props.id)}/approvals`}
                recoveryId={props.id}
                schema={Acceptance.ApproveSupplierAcceptance}
                output={Acceptance.SupplierAcceptanceApproval}
                label={sv ? "Attestera bokföring" : "Approve posting"}
                allowed={
                  review.isFetchedAfterMount &&
                  review.fetchStatus === "idle" &&
                  view.dependenciesCurrent &&
                  !view.approvalUsable &&
                  props.book.role === "operator"
                }
                input={(fields) => ({
                  version: 1,
                  digest: view.plan.digest,
                  acknowledgeSyntheticOnly: fields.get("acknowledgeSyntheticOnly") === "on",
                })}
              >
                <SyntheticAcknowledgment locale={props.locale} />
              </CommandForm>
              {view.approval && view.approvalUsable ? (
                <CommandForm
                  {...props}
                  compact
                  path={`${commercePath(props.book)}/supplier-acceptance-reviews/${encodeURIComponent(props.id)}/execute`}
                  recoveryId={`${props.id}:${view.approval.id}`}
                  schema={Acceptance.ExecuteSupplierAcceptance}
                  output={Acceptance.SupplierAcceptanceReceipt}
                  label={sv ? "Bokför och registrera" : "Post and register"}
                  allowed={
                    review.isFetchedAfterMount &&
                    review.fetchStatus === "idle" &&
                    props.book.role === "operator"
                  }
                  input={(fields) => ({
                    version: 1,
                    digest: view.plan.digest,
                    approvalId: view.approval?.id,
                    acknowledgeSyntheticOnly: fields.get("acknowledgeSyntheticOnly") === "on",
                  })}
                >
                  <SyntheticAcknowledgment locale={props.locale} />
                </CommandForm>
              ) : null}
            </>
          ) : null}
        </>
      ) : null}
    </Box>
  );
}
