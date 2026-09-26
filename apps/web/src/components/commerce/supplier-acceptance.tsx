import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Acceptance from "@open-erp/contracts/supplier-acceptance";
import * as Drafts from "@open-erp/contracts/supplier-invoice-drafts";
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

function inferredVatRate(netMinor: string | undefined, taxMinor: string | null) {
  if (!netMinor || taxMinor === null) return null;
  const net = BigInt(netMinor);
  const tax = BigInt(taxMinor);

  if (net <= 0n || tax < 0n) return null;

  return (
    ([0, 6, 12, 25] as const).find((rate) => (net * BigInt(rate) + 50n) / 100n === tax) ?? null
  );
}

function selectedVatRate(value: string): 0 | 6 | 12 | 25 {
  if (value === "0") return 0;

  if (value === "6") return 6;

  if (value === "12") return 12;

  if (value === "25") return 25;
  throw new Error("Select a VAT rate for each invoice line");
}

function textField(fields: FormData, name: string) {
  const value = fields.get(name);

  return typeof value === "string" ? value : "";
}

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
    <RecordSection title={sv ? "Granska och bokför" : "Review and post"}>
      <PageCaption>
        {sv
          ? "Granska originalet och bokföringsförslaget."
          : "Review the original and proposed posting."}
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

function PostingAcknowledgment({ locale }: { locale: CommerceProps["locale"] }) {
  return (
    <Box as="label" display="flex" alignItems="start" gap="md" padding="md">
      <input type="checkbox" name="acknowledgeSyntheticOnly" required />
      <span>
        {locale === "sv"
          ? "Jag förstår att detta bokför förslaget utan att fastställa momsbehandling."
          : "I understand this posts the proposal without establishing VAT treatment."}
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

  const suggestions = useQuery({
    queryKey: [
      ...commerceKey(props.book),
      "supplier-account-suggestions",
      props.draft.content.counterpartyId,
    ],
    queryFn: async ({ signal }) => {
      const result = await readAccounting(
        `${commercePath(props.book)}/supplier-account-suggestions/${encodeURIComponent(props.draft.content.counterpartyId)}`,
        Drafts.SupplierAccountSuggestions,
        { signal },
      );

      checkScope(props.book, result.scope);

      if (result.counterpartyId !== props.draft.content.counterpartyId)
        throw new Error("Supplier account suggestions mismatch");

      return result;
    },
    retry: false,
  });

  const accounts =
    setup.data?.accounts
      .filter((account) => account.active)
      .map((account) => ({
        value: account.id,
        label: `${account.code} · ${account.name}`,
      })) ?? [];

  const payable = setup.data?.accounts.find((account) => account.active && account.code === "2440");

  const expenseAccounts =
    setup.data?.accounts.filter((account) => account.active && /^[4-8]/.test(account.code)) ?? [];

  const suggestion = suggestions.data?.items[0];

  const suggestedAccount = expenseAccounts.find(
    (account) => account.id === suggestion?.expenseAccountId,
  );

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
          profile: "swedish-purchase-v1",
          draftId: props.draft.id,
          expectedRevision: props.draft.revision,
          expectedDigest: props.draft.digest,
          controlAccountId: fields.get("controlAccountId"),
          lineAssignments: props.draft.content.lines.map((line, index) => ({
            lineId: line.id,
            expenseAccountId: fields.get(`expenseAccountId-${index}`),
            vatRatePercent: selectedVatRate(textField(fields, `vatRatePercent-${index}`)),
          })),
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
          defaultValue={payable?.id ?? ""}
          required
        />
        <RecordSection title={sv ? "Konton och moms per rad" : "Accounts and VAT by line"}>
          {suggestedAccount ? (
            <PageCaption>
              {sv
                ? `Förslag från tidigare bokförd faktura: ${suggestedAccount.code} · ${suggestedAccount.name}, ${suggestion?.vatRatePercent} % moms. Välj konto och kontrollera varje rad.`
                : `Previous posting suggests ${suggestedAccount.code} · ${suggestedAccount.name} and ${suggestion?.vatRatePercent}% VAT. Select an account and check each line.`}
            </PageCaption>
          ) : null}
          {props.draft.content.lines.map((line, index) => {
            const net = props.draft.calculatedLines.find((item) => item.id === line.id)?.netMinor;
            const rate = inferredVatRate(net, line.taxMinor);

            return (
              <Box key={line.id} display="grid" gap="sm">
                <Text>
                  {index + 1}. {line.description} · {sv ? "exkl. moms" : "before VAT"}{" "}
                  {net
                    ? formatMinorAmount(net, props.draft.content.currencyScale, props.locale)
                    : "—"}{" "}
                  · {sv ? "moms" : "VAT"}{" "}
                  {line.taxMinor
                    ? formatMinorAmount(
                        line.taxMinor,
                        props.draft.content.currencyScale,
                        props.locale,
                      )
                    : "—"}
                </Text>
                <SelectField
                  name={`expenseAccountId-${index}`}
                  label={
                    sv ? `Utgiftskonto, rad ${index + 1}` : `Expense account, line ${index + 1}`
                  }
                  options={[
                    { value: "", label: "—" },
                    ...expenseAccounts.map((account) => ({
                      value: account.id,
                      label: `${account.code} · ${account.name}`,
                    })),
                  ]}
                  required
                />
                <SelectField
                  name={`vatRatePercent-${index}`}
                  label={sv ? `Momssats, rad ${index + 1}` : `VAT rate, line ${index + 1}`}
                  options={[
                    { value: "", label: "—" },
                    ...[0, 6, 12, 25].map((value) => ({
                      value: String(value),
                      label: `${value} %`,
                    })),
                  ]}
                  defaultValue={rate === null ? "" : String(rate)}
                  required
                />
              </Box>
            );
          })}
          <PageCaption>
            {sv
              ? "Kontrollera momssatsen mot fakturans momsbelopp. Ändra fakturautkastet om beloppet är fel."
              : "Check each VAT rate against the invoice tax amount. Edit the invoice draft if the amount is wrong."}
          </PageCaption>
        </RecordSection>
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
        <PostingAcknowledgment locale={props.locale} />
      </CommandForm>
    </Box>
  );
}

function SupplierAcceptanceReview(props: CommerceProps & { id: string; draft: Draft }) {
  const sv = props.locale === "sv";

  const setup = useQuery({
    queryKey: [...bookKey(props.book), "setup"],
    queryFn: ({ signal }) =>
      readAccounting(`${bookPath(props.book)}/setup`, Accounting.BookSetup, { signal }),
    retry: false,
  });

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
      <AccountingStatus locale={props.locale} pending={setup.isPending} error={setup.error} />
      {view ? (
        <>
          <SupplierReviewedLines
            locale={props.locale}
            plan={view.plan}
            accounts={setup.data?.accounts ?? []}
          />
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
                action.lines.map((line) => {
                  const account = setup.data?.accounts.find((item) => item.id === line.accountId);

                  return {
                    id: `${group.id}:${line.lineId}`,
                    cells: [
                      account ? `${account.code} · ${account.name}` : line.accountId,
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
                  };
                }),
              ),
            )}
          />
          {view.blockers.map((blocker) => (
            <Text key={blocker}>{blocker}</Text>
          ))}
          {view.acceptance ? (
            <Box display="grid" gap="md">
              <Text role="status">{sv ? "Bokförd" : "Posted"}</Text>
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
                onSuccess={() => void review.refetch()}
                allowed={
                  review.isFetchedAfterMount &&
                  review.fetchStatus === "idle" &&
                  view.dependenciesCurrent &&
                  view.blockers.length === 0 &&
                  !view.approvalUsable &&
                  props.book.role === "operator"
                }
                input={(fields) => ({
                  version: 1,
                  digest: view.plan.digest,
                  acknowledgeSyntheticOnly: fields.get("acknowledgeSyntheticOnly") === "on",
                })}
              >
                <PostingAcknowledgment locale={props.locale} />
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
                  onSuccess={() => void review.refetch()}
                  allowed={
                    review.isFetchedAfterMount &&
                    review.fetchStatus === "idle" &&
                    view.blockers.length === 0 &&
                    props.book.role === "operator"
                  }
                  input={(fields) => ({
                    version: 1,
                    digest: view.plan.digest,
                    approvalId: view.approval?.id,
                    acknowledgeSyntheticOnly: fields.get("acknowledgeSyntheticOnly") === "on",
                  })}
                >
                  <PostingAcknowledgment locale={props.locale} />
                </CommandForm>
              ) : null}
            </>
          ) : null}
        </>
      ) : null}
    </Box>
  );
}

function SupplierReviewedLines(props: {
  locale: CommerceProps["locale"];
  plan: typeof Acceptance.SupplierAcceptanceReview.Type;
  accounts: ReadonlyArray<(typeof Accounting.BookSetup.Type)["accounts"][number]>;
}) {
  if (!("lineAssignments" in props.plan.input)) return null;
  const sv = props.locale === "sv";

  return (
    <DataTable
      title={sv ? "Granskade fakturarader" : "Reviewed invoice lines"}
      narrow="stack"
      columns={[
        { id: "line", label: sv ? "Rad" : "Line" },
        { id: "account", label: sv ? "Utgiftskonto" : "Expense account" },
        { id: "rate", label: sv ? "Momssats" : "VAT rate" },
        { id: "vat", label: sv ? "Momsbelopp" : "VAT amount", numeric: true },
      ]}
      rows={props.plan.input.lineAssignments.map((assignment) => {
        const line = props.plan.draftSnapshot.content.lines.find(
          (item) => item.id === assignment.lineId,
        );

        const account = props.accounts.find((item) => item.id === assignment.expenseAccountId);

        return {
          id: assignment.lineId,
          cells: [
            line?.description ?? assignment.lineId,
            account ? `${account.code} · ${account.name}` : assignment.expenseAccountId,
            `${assignment.vatRatePercent} %`,
            line?.taxMinor === null || line?.taxMinor === undefined
              ? "—"
              : formatMinorAmount(
                  line.taxMinor,
                  props.plan.draftSnapshot.content.currencyScale,
                  props.locale,
                ),
          ],
        };
      })}
    />
  );
}
