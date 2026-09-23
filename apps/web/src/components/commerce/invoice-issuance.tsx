import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Drafts from "@open-erp/contracts/invoice-drafts";
import * as Issuance from "@open-erp/contracts/invoice-issuance";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { DataTable } from "@open-erp/ui/components/data-table";
import { InputField, SelectField } from "@open-erp/ui/components/field";
import { RecordHeading, RecordSplit, RecordSection } from "@open-erp/ui/components/record-layout";
import { PageAction, PageCaption, RecordOpen } from "@open-erp/ui/components/accounting-page";
import { workspacePath } from "@/lib/book-context";
import { formatMinorAmount } from "@/lib/workspace-api";
import { Heading, Text } from "@open-erp/ui/components/typography";
import { AccountingStatus } from "@/components/accounting-status";
import { bookKey, bookPath, readAccounting } from "@/lib/accounting-api";
import { InvoiceDraftDocument } from "./invoice-draft-document";
import { invoiceDraftBlocker } from "./invoice-draft-copy";
import { invoiceIssueCopy } from "./invoice-issue-copy";
import { InvoiceDocumentPanel } from "./invoice-documents";
import { InvoiceCancellationPanel } from "./invoice-cancellations";
import {
  CommandForm,
  Details,
  Evidence,
  Facts,
  Lookup,
  checkScope,
  commerceKey,
  commercePath,
  type CommerceProps,
} from "./shared";

type IssueWorkspaceProps = CommerceProps & {
  recordId?: string;
  reviewId?: string;
  onBack?: () => void;
  onReviewOpen?: (id: string) => void;
  onIssued?: (id: string) => void;
};
export function InvoiceIssuance(props: IssueWorkspaceProps) {
  return (
    <IssueWorkspace
      key={`${props.book.entityId}:${props.book.id}:${props.recordId ?? ""}`}
      {...props}
    />
  );
}
function IssueWorkspace(props: IssueWorkspaceProps) {
  const copy = invoiceIssueCopy(props.locale);
  const [draftId, setDraftId] = useState(props.recordId ?? "");
  const [localReviewId, setLocalReviewId] = useState("");
  const reviewId = props.reviewId ?? localReviewId;
  const setReviewId = props.onReviewOpen ?? setLocalReviewId;
  const drafts = useQuery({
    queryKey: [...commerceKey(props.book), "invoice-drafts"],
    queryFn: ({ signal }) =>
      readAccounting(`${commercePath(props.book)}/invoice-drafts`, Drafts.InvoiceDraftList, {
        signal,
      }),
    retry: false,
    enabled: !props.recordId,
  });
  return (
    <Box display="grid" gap="lg" minWidth="zero">
      {!reviewId ? (
        <RecordHeading
          title={copy.title}
          subtitle={
            props.locale === "sv"
              ? "Granska fakturan och den bokföring som ska skapas."
              : "Review the invoice and the accounting it will create."
          }
        />
      ) : null}
      <PageCaption>
        {props.locale === "sv"
          ? "Endast demoutfärdande är tillgängligt. Ingen juridisk faktura skapas eller skickas."
          : "Only demo issuance is available. No legal invoice is created or sent."}
      </PageCaption>
      <Details title={props.locale === "sv" ? "Vad demoutfärdande innebär" : "About demo issuance"}>
        <Text>{copy.boundary}</Text>
      </Details>
      {!props.recordId ? (
        <SelectField
          label={props.locale === "sv" ? "Fakturautkast" : "Invoice draft"}
          value={draftId}
          onValueChange={(id) => {
            setDraftId(id ?? "");
            setReviewId("");
          }}
          options={[
            { value: "", label: props.locale === "sv" ? "Välj faktura" : "Choose invoice" },
            ...(drafts.data?.items.map((item) => ({
              value: item.id,
              label: `${item.title} · ${item.customerName}`,
            })) ?? []),
          ]}
        />
      ) : null}
      {!props.recordId ? (
        <AccountingStatus locale={props.locale} pending={drafts.isPending} error={drafts.error} />
      ) : null}
      {draftId ? (
        props.onBack ? (
          <Box>
            <Button variant="ghost" onClick={props.onBack}>
              {props.locale === "sv" ? "Till fakturan" : "Back to invoice"}
            </Button>
          </Box>
        ) : (
          <PageAction
            quiet
            href={`${workspacePath(props.book)}/sales?view=drafts&record=${encodeURIComponent(draftId)}`}
          >
            {props.locale === "sv" ? "Till fakturan" : "Back to invoice"}
          </PageAction>
        )
      ) : null}
      {draftId && !reviewId ? (
        <IssueDraft {...props} key={draftId} id={draftId} onOpen={setReviewId} />
      ) : null}
      {reviewId ? (
        <InvoiceIssueReviewPanel {...props} key={reviewId} id={reviewId} draftId={draftId} />
      ) : null}
      <Details
        title={props.locale === "sv" ? "Återställ tidigare granskning" : "Recover a saved review"}
      >
        <Text>{copy.recovery}</Text>
        <Lookup label={copy.openReview} onOpen={setReviewId} />
      </Details>
    </Box>
  );
}
function IssueDraft(props: CommerceProps & { id: string; onOpen: (id: string) => void }) {
  const { book, locale, id } = props;
  const copy = invoiceIssueCopy(locale);
  const draft = useQuery({
    queryKey: [...commerceKey(book), "issue-draft", id],
    staleTime: 0,
    refetchOnMount: "always",
    queryFn: async ({ signal }) => {
      const result = await readAccounting(
        `${commercePath(book)}/invoice-drafts/${encodeURIComponent(id)}`,
        Drafts.InvoiceDraftView,
        { signal },
      );
      checkScope(book, result.record.scope);
      if (result.record.id !== id) throw new Error("Issue draft identity mismatch");
      return result;
    },
    retry: false,
  });
  const history = useQuery({
    queryKey: [...commerceKey(book), "invoice-issue-history", id],
    staleTime: 0,
    refetchOnMount: "always",
    queryFn: async ({ signal }) => {
      const result = await readAccounting(
        `${commercePath(book)}/invoice-drafts/${encodeURIComponent(id)}/issue-reviews`,
        Issuance.InvoiceIssueHistory,
        { signal },
      );
      checkScope(book, result.scope);
      if (result.draftId !== id) throw new Error("Issue history draft mismatch");
      return result;
    },
    retry: false,
  });
  return (
    <Box display="grid" gap="lg" minWidth="zero">
      <Box>
        <Button
          variant="outline"
          disabled={draft.isFetching || history.isFetching}
          onClick={() => {
            void draft.refetch();
            void history.refetch();
          }}
        >
          {copy.refresh}
        </Button>
      </Box>
      <AccountingStatus locale={locale} pending={draft.isPending} error={draft.error} />
      {draft.data && history.data ? (
        <IssuePreparation
          {...props}
          draft={draft.data.record}
          allowed={
            draft.isSuccess &&
            draft.fetchStatus === "idle" &&
            draft.isFetchedAfterMount &&
            history.isSuccess &&
            history.fetchStatus === "idle" &&
            history.isFetchedAfterMount &&
            !history.data.items.some((item) => item.issueId !== null) &&
            book.role === "operator"
          }
        />
      ) : null}
      <AccountingStatus locale={locale} pending={history.isPending} error={history.error} />
      {history.isSuccess ? (
        <Details title={copy.history}>
          <DataTable
            title={copy.history}
            narrow="stack"
            columns={[
              { id: "id", label: copy.id },
              { id: "revision", label: copy.revision },
              { id: "created", label: copy.created },
              { id: "issued", label: copy.internal },
            ]}
            rows={history.data.items.map((item) => ({
              id: item.id,
              cells: [
                <RecordOpen key="open" onClick={() => props.onOpen(item.id)}>
                  {copy.review} · {item.draftRevision}
                </RecordOpen>,
                item.draftRevision,
                new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
                  new Date(item.createdAt),
                ),
                item.internalDocumentNumber ?? copy.pending,
              ],
            }))}
          />
          {history.data.count === 0 ? <Text>{copy.empty}</Text> : null}
        </Details>
      ) : null}
    </Box>
  );
}
function SyntheticAcknowledgment({ locale }: { locale: CommerceProps["locale"] }) {
  const copy = invoiceIssueCopy(locale);
  return (
    <Box as="label" display="flex" alignItems="start" gap="md" padding="md">
      <input type="checkbox" name="acknowledgeSyntheticOnly" required />
      <span>{copy.acknowledge}</span>
    </Box>
  );
}
function IssuePreparation(
  props: CommerceProps & {
    draft: typeof Drafts.InvoiceDraftRevision.Type;
    allowed: boolean;
    onOpen: (id: string) => void;
  },
) {
  const copy = invoiceIssueCopy(props.locale);
  // Keep the expected revision and draft review stable while a command is pending or uncertain.
  const [draft] = useState(props.draft);
  const setup = useQuery({
    queryKey: [...bookKey(props.book), "setup"],
    queryFn: ({ signal }) =>
      readAccounting(`${bookPath(props.book)}/setup`, Accounting.BookSetup, { signal }),
    retry: false,
  });
  const missing = invoiceIssueMissing(draft, props.locale);
  const accounts =
    setup.data?.accounts
      .filter((account) => account.active)
      .map((account) => ({ value: account.id, label: `${account.code} · ${account.name}` })) ?? [];
  return (
    <RecordSplit
      aside={
        <RecordSection title={props.locale === "sv" ? "Inför utfärdande" : "Before issuing"}>
          {missing.length ? (
            <Box display="grid" gap="sm">
              {missing.map((reason) => (
                <Text key={reason} tone="muted">
                  {reason}
                </Text>
              ))}
            </Box>
          ) : null}
          <AccountingStatus locale={props.locale} pending={setup.isPending} error={setup.error} />
          {missing.length === 0 ? (
            <CommandForm
              {...props}
              compact
              path={`${commercePath(props.book)}/invoice-issue-reviews`}
              recoveryId={draft.id}
              schema={Issuance.PrepareInvoiceIssue}
              output={Issuance.InvoiceIssueReview}
              label={copy.prepare}
              allowed={props.allowed}
              canSubmit={setup.isSuccess && setup.fetchStatus === "idle" && missing.length === 0}
              input={(fields) => ({
                profile: "synthetic-manual-invoice-v1",
                draftId: draft.id,
                expectedRevision: draft.revision,
                expectedDigest: draft.digest,
                controlAccountId: fields.get("controlAccountId"),
                creditAccountId: fields.get("creditAccountId"),
                accountingPeriodId: fields.get("accountingPeriodId"),
                series: fields.get("series"),
                reason: fields.get("reason"),
                acknowledgeSyntheticOnly: fields.get("acknowledgeSyntheticOnly") === "on",
              })}
              onSuccess={(review) => props.onOpen(review.id)}
            >
              <Box display="grid" gap="lg">
                <SelectField
                  name="controlAccountId"
                  label={copy.control}
                  options={[{ value: "", label: "—" }, ...accounts]}
                  required
                />
                <SelectField
                  name="creditAccountId"
                  label={copy.credit}
                  options={[{ value: "", label: "—" }, ...accounts]}
                  required
                />
                <SelectField
                  name="accountingPeriodId"
                  label={copy.period}
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
                <InputField name="series" label={copy.series} maxLength={16} required />
              </Box>
              <InputField name="reason" label={copy.reason} required maxLength={2000} />
              <SyntheticAcknowledgment locale={props.locale} />
            </CommandForm>
          ) : null}
          <Details
            title={props.locale === "sv" ? "Krav för demoutfärdande" : "Demo issue requirements"}
          >
            <Text>{copy.requirements}</Text>
          </Details>
        </RecordSection>
      }
    >
      <InvoiceDraftDocument record={draft} locale={props.locale} />
    </RecordSplit>
  );
}
export function InvoiceIssueReviewPanel(
  props: CommerceProps & {
    id: string;
    readOnly?: boolean;
    onIssued?: (id: string) => void;
    draftId?: string;
  },
) {
  const { book, locale, id } = props;
  const copy = invoiceIssueCopy(locale);
  const review = useQuery({
    queryKey: [...commerceKey(book), "invoice-issue-review", id, props.draftId ?? ""],
    staleTime: 0,
    refetchOnMount: "always",
    queryFn: async ({ signal }) => {
      const result = await readAccounting(
        `${commercePath(book)}/invoice-issue-reviews/${encodeURIComponent(id)}`,
        Issuance.InvoiceIssueView,
        { signal },
      );
      checkScope(book, result.plan.scope);
      if (result.plan.id !== id || (props.draftId && result.plan.input.draftId !== props.draftId))
        throw new Error("Issue review identity mismatch");
      if (result.issue) {
        checkScope(book, result.issue.scope);
        if (result.issue.reviewId !== id) throw new Error("Issue receipt review mismatch");
      }
      if (result.approval) {
        checkScope(book, result.approval.scope);
        if (result.approval.reviewId !== id) throw new Error("Issue approval review mismatch");
      }
      return result;
    },
    retry: false,
  });
  return (
    <Box display="grid" gap="lg" minWidth="zero">
      <Heading>{copy.review}</Heading>

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
      <AccountingStatus locale={locale} pending={review.isPending} error={review.error} />
      {review.data ? (
        <IssueContents
          {...props}
          view={review.data}
          current={review.isSuccess && review.fetchStatus === "idle" && review.isFetchedAfterMount}
        />
      ) : null}
    </Box>
  );
}
function IssueContents(
  props: CommerceProps & {
    view: typeof Issuance.InvoiceIssueView.Type;
    readOnly?: boolean;
    current: boolean;
    onIssued?: (id: string) => void;
  },
) {
  const { view, locale, book } = props;
  const { plan, approval, issue } = view;
  const copy = invoiceIssueCopy(locale);
  const draft = plan.draftSnapshot;
  const path = `${commercePath(book)}/invoice-issue-reviews/${encodeURIComponent(plan.id)}`;
  const setup = useQuery({
    queryKey: [...bookKey(book), "setup"],
    queryFn: ({ signal }) =>
      readAccounting(`${bookPath(book)}/setup`, Accounting.BookSetup, { signal }),
    retry: false,
  });
  return (
    <Box display="grid" gap="lg" minWidth="zero">
      <InvoiceDraftDocument record={draft} locale={locale} />
      {!props.current ? (
        <Text role="status">
          {locale === "sv"
            ? "Aktuell status är okänd. Den senast hämtade granskningen visas. Bevarade anrop kan fortfarande återförsökas med samma nyckel."
            : "Current status is unknown. The last fetched review is shown. Retained requests can still be retried with the same key."}
        </Text>
      ) : null}
      <DataTable
        title={copy.posting}
        narrow="stack"
        columns={[
          { id: "account", label: copy.account },
          { id: "debit", label: copy.debit, numeric: true },
          { id: "credit", label: copy.creditAmount, numeric: true },
          { id: "description", label: copy.description },
        ]}
        rows={plan.postingPlan.groups.flatMap((group) =>
          group.actions.flatMap((action) =>
            action.lines.map((line) => ({
              id: `${group.id}:${line.lineId}`,
              cells: [
                (() => {
                  const account = setup.data?.accounts.find((entry) => entry.id === line.accountId);
                  return account ? `${account.code} · ${account.name}` : line.accountId;
                })(),
                formatMinorAmount(line.debitMinor, draft.content.currencyScale, locale),
                formatMinorAmount(line.creditMinor, draft.content.currencyScale, locale),
                line.description,
              ],
            })),
          ),
        )}
      />
      {view.blockers.length > 0 && !issue ? (
        <Box display="grid" gap="md">
          <Heading>{copy.blocked}</Heading>
          {view.blockers.map((blocker) => (
            <Text key={blocker}>{blocker}</Text>
          ))}
        </Box>
      ) : null}
      {issue ? (
        <Box display="grid" gap="md">
          <Text role="status">{copy.success}</Text>
          <Text>
            {copy.internal}: {issue.internalDocumentNumber}
          </Text>
          <Text>
            {copy.receipt}: {issue.postingReceipt.id}
          </Text>
          <Text>
            {copy.register}: {issue.registerInvoiceId}
          </Text>
          <InvoiceCancellationPanel book={book} locale={locale} issue={issue} />
          <InvoiceDocumentPanel book={book} locale={locale} issue={issue} />
        </Box>
      ) : null}
      {props.readOnly || issue ? null : (
        <>
          <Text>{copy.approvalNote}</Text>
          <CommandForm
            {...props}
            compact
            path={`${path}/approvals`}
            recoveryId={plan.id}
            schema={Issuance.ApproveInvoiceIssue}
            output={Issuance.InvoiceIssueApproval}
            label={copy.approve}
            allowed={
              props.current &&
              !issue &&
              book.role === "operator" &&
              view.dependenciesCurrent &&
              !view.approvalUsable
            }
            input={(fields) => ({
              version: plan.version,
              digest: plan.digest,
              acknowledgeSyntheticOnly: fields.get("acknowledgeSyntheticOnly") === "on",
            })}
          >
            <SyntheticAcknowledgment locale={locale} />
          </CommandForm>
          {approval ? (
            <>
              <Text>
                {copy.expires}:{" "}
                {new Intl.DateTimeFormat(locale, {
                  dateStyle: "medium",
                  timeStyle: "short",
                }).format(new Date(approval.expiresAt))}
              </Text>
              <CommandForm
                {...props}
                compact
                path={`${path}/execute`}
                recoveryId={`${plan.id}:${approval.id}`}
                schema={Issuance.ExecuteInvoiceIssue}
                output={Issuance.InvoiceIssueReceipt}
                onSuccess={(receipt) => props.onIssued?.(receipt.registerInvoiceId)}
                label={copy.execute}
                allowed={props.current && !issue && book.role === "operator" && view.approvalUsable}
                input={(fields) => ({
                  version: plan.version,
                  digest: plan.digest,
                  approvalId: approval.id,
                  acknowledgeSyntheticOnly: fields.get("acknowledgeSyntheticOnly") === "on",
                })}
              >
                <SyntheticAcknowledgment locale={locale} />
              </CommandForm>
            </>
          ) : null}
          {!view.approvalUsable ? <Text>{copy.unavailable}</Text> : null}
        </>
      )}
      <Details
        title={locale === "sv" ? "Underlag och granskningshistorik" : "Sources and review history"}
      >
        <Text>
          {copy.legal}: {plan.legalBlockers.join(" · ")}
        </Text>
        <Text tone="muted">{copy.rules}</Text>
        <DataTable
          title={copy.commercialLines}
          narrow="stack"
          columns={[
            { id: "description", label: copy.description },
            { id: "quantity", label: copy.quantity, numeric: true },
            { id: "base", label: copy.base, numeric: true },
            { id: "discount", label: copy.discount, numeric: true },
            { id: "charge", label: copy.charge, numeric: true },
            { id: "tax", label: copy.tax, numeric: true },
            { id: "source", label: copy.sourceGross, numeric: true },
          ]}
          rows={draft.content.lines.map((line) => ({
            id: line.id,
            cells: [
              line.description,
              line.quantity,
              formatMinorAmount(line.baseMinor, draft.content.currencyScale, locale),
              formatMinorAmount(line.discountMinor, draft.content.currencyScale, locale),
              formatMinorAmount(line.chargeMinor, draft.content.currencyScale, locale),
              line.taxMinor === null
                ? "—"
                : formatMinorAmount(line.taxMinor, draft.content.currencyScale, locale),
              line.sourceGrossMinor === null
                ? "—"
                : formatMinorAmount(line.sourceGrossMinor, draft.content.currencyScale, locale),
            ],
          }))}
        />
        <Facts title={copy.draftFacts} value={draft} />
        <Details title={copy.evidence}>
          <Evidence
            {...props}
            reference={{ evidenceId: plan.evidence.id, sha256: plan.evidence.sha256 }}
          />
        </Details>
        <Box>
          <Button
            variant="outline"
            onClick={() => {
              const url = URL.createObjectURL(
                new Blob([JSON.stringify(view, null, 2)], { type: "application/json" }),
              );
              const link = document.createElement("a");
              link.href = url;
              link.download = `${plan.id}.json`;
              document.body.append(link);
              link.click();
              link.remove();
              window.setTimeout(() => URL.revokeObjectURL(url), 0);
            }}
          >
            {copy.download}
          </Button>
        </Box>
        <Facts title={copy.details} value={view} />
      </Details>
    </Box>
  );
}

function invoiceIssueMissing(
  draft: typeof Drafts.InvoiceDraftRevision.Type,
  locale: CommerceProps["locale"],
) {
  const reasons = draft.blockers
    .filter(
      (blocker) =>
        ![
          "issuance_not_implemented",
          "legal_identity_not_verified",
          "tax_profile_not_activated",
        ].includes(blocker.code),
    )
    .map((blocker) => invoiceDraftBlocker(blocker.code, locale));
  if (draft.totals.taxMinor !== "0")
    reasons.push(
      locale === "sv"
        ? "Demoutfärdande stöder endast uttryckligt nollbelopp i moms."
        : "Demo issuance supports an explicitly entered zero tax amount only.",
    );
  if (
    draft.totals.sourceTotalMatches !== true ||
    draft.calculatedLines.some((line) => line.sourceGrossMatches !== true)
  )
    reasons.push(
      locale === "sv"
        ? "Ange avtalade radbelopp och totalbelopp i fakturautkastet. De måste stämma med beräkningen."
        : "Enter the agreed line totals and overall total in the draft. They must match the calculated amounts.",
    );
  return reasons;
}
