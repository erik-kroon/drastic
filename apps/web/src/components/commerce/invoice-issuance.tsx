import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as Accounting from "@open-erp/contracts/accounting";
import * as ArLegal from "@open-erp/contracts/ar-legal-issue";
import * as Drafts from "@open-erp/contracts/invoice-drafts";
import * as Issuance from "@open-erp/contracts/invoice-issuance";
import * as LegalDelivery from "@open-erp/contracts/legal-delivery";
import * as LegalInvoicePdf from "@open-erp/contracts/legal-invoice-pdf";
import * as LegalSalesPolicy from "@open-erp/contracts/legal-sales-policy";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { DataTable } from "@open-erp/ui/components/data-table";
import { InputField, SelectField } from "@open-erp/ui/components/field";
import {
  RecordFact,
  RecordHeading,
  RecordSplit,
  RecordSection,
  RecordSummary,
} from "@open-erp/ui/components/record-layout";
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
          ? "Demoutfärdande är den enda åtgärden här. Inspektören läser sparad juridisk utfärdande-, PDF- och leveranshistorik men utfärdar, aktiverar, renderar eller skickar inget."
          : "Demo issuance is the only action here. The inspector reads retained legal issue, PDF and delivery history but does not issue, activate, render or send anything."}
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
      <LegalInvoiceInspector {...props} draftId={id} draft={draft.data?.record} />
    </Box>
  );
}

export function LegalInvoiceInspector(
  props: CommerceProps & {
    draftId?: string;
    draft?: typeof Drafts.InvoiceDraftRevision.Type;
    issueId?: string;
  },
) {
  const { book, locale } = props;
  const copy = invoiceIssueCopy(locale);
  const client = useQueryClient();

  const policyHistory = useQuery({
    queryKey: [...commerceKey(book), "ar-legal", "sales-policy-history"],
    queryFn: async ({ signal }) => {
      const result = await readAccounting(
        `${commercePath(book)}/legal-sales-policies`,
        LegalSalesPolicy.LegalSalesPolicyHistory,
        { signal },
      );

      checkScope(book, result.scope);
      result.items.forEach((policy) => checkScope(book, policy.scope));

      return result;
    },
    staleTime: 0,
    refetchOnMount: "always",
    retry: false,
  });

  const issueReads = useLegalIssueRead(props);

  const { policy, accountingProfile } = useLegalActivationRead(
    book,
    issueReads.review.data,
    issueReads.issue,
  );

  const { pdfHistory, captureId, pdf, deliveries } = useLegalArtifactRead(book, issueReads.issue);

  const queries = [
    policyHistory,
    issueReads.issueRead,
    issueReads.history,
    issueReads.review,
    policy,
    accountingProfile,
    pdfHistory,
    pdf,
    deliveries,
  ];

  const error = queries.map((query) => query.error).find(Boolean) ?? null;

  const draftInputBlockers = issueReads.draft?.blockers.filter(
    (blocker) =>
      ![
        "issuance_not_implemented",
        "legal_identity_not_verified",
        "tax_profile_not_activated",
      ].includes(blocker.code),
  );

  const draftBoundaryBlockers = issueReads.draft?.blockers.filter((blocker) =>
    [
      "issuance_not_implemented",
      "legal_identity_not_verified",
      "tax_profile_not_activated",
    ].includes(blocker.code),
  );

  const selectedPolicy = policy.data ?? issueReads.review.data?.review.policySnapshot;

  const selectedAccountingProfile =
    accountingProfile.data ?? issueReads.review.data?.review.accountingProfileSnapshot;

  return (
    <Details title={copy.legalHistory}>
      <Box display="grid" gap="lg" minWidth="zero">
        <LegalInspectorHeader
          locale={locale}
          copy={copy}
          pending={queries.some((query) => query.isFetching)}
          error={error}
          onRefresh={() => {
            void client.invalidateQueries({ queryKey: [...commerceKey(book), "ar-legal"] });
          }}
        />
        <LegalPolicySection
          copy={copy}
          history={policyHistory.data}
          loaded={policyHistory.isSuccess}
        />
        {issueReads.history.isSuccess ? (
          <LegalReviewsSection
            locale={locale}
            copy={copy}
            history={issueReads.history.data}
            onOpen={issueReads.setSelectedReview}
          />
        ) : null}
        <LegalIdentitySection
          copy={copy}
          draft={issueReads.draft}
          review={issueReads.review.data}
          issue={issueReads.issue}
        />
        <LegalStateSection
          locale={locale}
          copy={copy}
          draft={issueReads.draft}
          review={issueReads.review.data}
          issue={issueReads.issue}
        />
        <LegalActivationSection
          copy={copy}
          policy={selectedPolicy}
          accountingProfile={selectedAccountingProfile}
        />
        <LegalBlockersSection
          locale={locale}
          copy={copy}
          inputBlockers={draftInputBlockers}
          boundaryBlockers={draftBoundaryBlockers}
          currentBlockers={issueReads.review.data?.blockers}
        />
        <LegalArtifactSection
          copy={copy}
          issue={issueReads.issue}
          history={pdfHistory.data}
          historyLoaded={pdfHistory.isSuccess}
          pdf={pdf.data}
        />
        <LegalDeliverySection
          copy={copy}
          captureId={captureId}
          history={deliveries.data}
          loaded={deliveries.isSuccess}
        />
        <LegalSnapshotSection
          copy={copy}
          missingIdentity={!issueReads.draftId && !props.issueId}
          draft={issueReads.draft}
          review={issueReads.review.data}
          issue={issueReads.issue}
        />
      </Box>
    </Details>
  );
}

function useLegalIssueRead(
  props: CommerceProps & {
    draftId?: string;
    draft?: typeof Drafts.InvoiceDraftRevision.Type;
    issueId?: string;
  },
) {
  const [selectedReview, setSelectedReview] = useState("");

  const issueRead = useQuery({
    queryKey: [...commerceKey(props.book), "ar-legal", "issue", props.issueId ?? ""],
    queryFn: async ({ signal }) => {
      const result = await readAccounting(
        `${commercePath(props.book)}/ar-legal-issues/${encodeURIComponent(props.issueId ?? "")}`,
        ArLegal.ArLegalIssueReceipt,
        { signal },
      );

      checkScope(props.book, result.scope);

      if (result.id !== props.issueId) throw new Error("Legal issue identity mismatch");

      return result;
    },
    enabled: Boolean(props.issueId),
    staleTime: 0,
    refetchOnMount: "always",
    retry: false,
  });

  const draftId = props.draftId ?? issueRead.data?.draftId ?? "";

  const history = useQuery({
    queryKey: [...commerceKey(props.book), "ar-legal", "issue-history", draftId],
    queryFn: async ({ signal }) => {
      const result = await readAccounting(
        `${commercePath(props.book)}/invoice-drafts/${encodeURIComponent(draftId)}/ar-legal-issue-reviews`,
        ArLegal.ArLegalIssueHistory,
        { signal },
      );

      checkScope(props.book, result.scope);

      if (result.draftId !== draftId) throw new Error("Legal issue history draft mismatch");

      return result;
    },
    enabled: Boolean(draftId),
    staleTime: 0,
    refetchOnMount: "always",
    retry: false,
  });

  const selectedReviewId = props.issueId
    ? (issueRead.data?.reviewId ?? "")
    : selectedReview || history.data?.items.at(-1)?.id || "";

  const review = useQuery({
    queryKey: [...commerceKey(props.book), "ar-legal", "issue-review", selectedReviewId],
    queryFn: async ({ signal }) => {
      const result = await readAccounting(
        `${commercePath(props.book)}/ar-legal-issue-reviews/${encodeURIComponent(selectedReviewId)}`,
        ArLegal.ArLegalIssueView,
        { signal },
      );

      checkScope(props.book, result.review.scope);

      if (
        result.review.id !== selectedReviewId ||
        result.review.input.draftId !== result.review.draftSnapshot.id ||
        (draftId && result.review.draftSnapshot.id !== draftId)
      )
        throw new Error("Legal issue review identity mismatch");

      if (result.issue) {
        checkScope(props.book, result.issue.scope);

        if (
          result.issue.reviewId !== result.review.id ||
          result.issue.reviewDigest !== result.review.digest
        )
          throw new Error("Legal issue review receipt mismatch");
      }

      if (result.approval) {
        checkScope(props.book, result.approval.scope);

        if (result.approval.reviewId !== result.review.id)
          throw new Error("Legal issue approval identity mismatch");
      }

      return result;
    },
    enabled: Boolean(selectedReviewId),
    staleTime: 0,
    refetchOnMount: "always",
    retry: false,
  });

  const issue = issueRead.data ?? review.data?.issue ?? undefined;

  return {
    issueRead,
    draftId,
    history,
    review,
    issue,
    draft: props.draft ?? review.data?.review.draftSnapshot ?? issue?.draftSnapshot,
    setSelectedReview,
  };
}

function useLegalActivationRead(
  book: CommerceProps["book"],
  review: typeof ArLegal.ArLegalIssueView.Type | undefined,
  issue: typeof ArLegal.ArLegalIssueReceipt.Type | undefined,
) {
  const policyId = review?.review.input.policyId ?? issue?.policyId ?? "";

  const policy = useQuery({
    queryKey: [...commerceKey(book), "ar-legal", "sales-policy", policyId],
    queryFn: async ({ signal }) => {
      const result = await readAccounting(
        `${commercePath(book)}/legal-sales-policies/${encodeURIComponent(policyId)}`,
        LegalSalesPolicy.LegalSalesPolicy,
        { signal },
      );

      checkScope(book, result.scope);

      if (result.id !== policyId) throw new Error("Legal sales policy identity mismatch");

      if (
        review &&
        (result.digest !== review.review.input.policyDigest ||
          result.digest !== review.review.policySnapshot.digest)
      )
        throw new Error("Legal sales policy snapshot mismatch");

      return result;
    },
    enabled: Boolean(policyId),
    staleTime: 0,
    refetchOnMount: "always",
    retry: false,
  });

  const accountingProfileId = review?.review.input.accountingProfileId ?? "";

  const accountingProfile = useQuery({
    queryKey: [...commerceKey(book), "ar-legal", "accounting-profile", accountingProfileId],
    queryFn: async ({ signal }) => {
      const result = await readAccounting(
        `${commercePath(book)}/ar-legal-accounting-profiles/${encodeURIComponent(accountingProfileId)}`,
        ArLegal.ArLegalAccountingProfile,
        { signal },
      );

      checkScope(book, result.scope);

      if (
        result.id !== accountingProfileId ||
        (review &&
          (result.policyId !== review.review.input.policyId ||
            result.digest !== review.review.input.accountingProfileDigest ||
            result.digest !== review.review.accountingProfileSnapshot.digest))
      )
        throw new Error("Legal accounting profile identity mismatch");

      return result;
    },
    enabled: Boolean(accountingProfileId),
    staleTime: 0,
    refetchOnMount: "always",
    retry: false,
  });

  return { policy, accountingProfile };
}

function useLegalArtifactRead(
  book: CommerceProps["book"],
  issue: typeof ArLegal.ArLegalIssueReceipt.Type | undefined,
) {
  const pdfHistory = useQuery({
    queryKey: [...commerceKey(book), "ar-legal", "pdf-history", issue?.id ?? ""],
    queryFn: async ({ signal }) => {
      const result = await readAccounting(
        `${commercePath(book)}/ar-legal-issues/${encodeURIComponent(issue?.id ?? "")}/pdfs`,
        LegalInvoicePdf.LegalInvoicePdfHistory,
        { signal },
      );

      checkScope(book, result.scope);

      if (result.issueId !== issue?.id) throw new Error("Legal PDF history issue mismatch");

      return result;
    },
    enabled: Boolean(issue?.id),
    staleTime: 0,
    refetchOnMount: "always",
    retry: false,
  });

  const captureId = pdfHistory.data?.items[0]?.id ?? "";

  const pdf = useQuery({
    queryKey: [...commerceKey(book), "ar-legal", "pdf", captureId],
    queryFn: async ({ signal }) => {
      const result = await readAccounting(
        `${commercePath(book)}/legal-invoice-pdfs/${encodeURIComponent(captureId)}`,
        LegalInvoicePdf.LegalInvoicePdfView,
        { signal },
      );

      checkScope(book, result.capture.scope);

      if (
        result.capture.id !== captureId ||
        result.capture.issueId !== issue?.id ||
        result.capture.source.issue.id !== issue?.id ||
        result.capture.source.issue.digest !== issue?.digest
      )
        throw new Error("Legal PDF capture identity mismatch");

      return {
        ...result,
        verified: result.artifact
          ? await verifyLegalPdf(book, result.capture, result.artifact)
          : null,
      };
    },
    enabled: Boolean(captureId),
    staleTime: 0,
    refetchOnMount: "always",
    retry: false,
  });

  const deliveries = useQuery({
    queryKey: [...commerceKey(book), "ar-legal", "delivery-history", captureId],
    queryFn: async ({ signal }) => {
      const result = await readAccounting(
        `${commercePath(book)}/legal-invoice-pdfs/${encodeURIComponent(captureId)}/deliveries`,
        LegalDelivery.LegalDeliveryHistory,
        { signal },
      );

      checkScope(book, result.scope);

      if (result.pdfCaptureId !== captureId) throw new Error("Legal delivery history PDF mismatch");
      result.items.forEach((item) => {
        checkScope(book, item.request.scope);

        if (
          item.request.input.pdfCaptureId !== captureId ||
          item.request.issueId !== issue?.id ||
          item.delivered
        )
          throw new Error("Legal delivery request identity mismatch");

        if (item.approval) checkScope(book, item.approval.scope);
        item.attempts.forEach(({ attempt, reconciliation }) => {
          checkScope(book, attempt.scope);

          if (attempt.requestId !== item.request.id || attempt.delivered)
            throw new Error("Legal delivery attempt identity mismatch");

          if (reconciliation) checkScope(book, reconciliation.scope);
        });
      });

      return result;
    },
    enabled: Boolean(captureId),
    staleTime: 0,
    refetchOnMount: "always",
    retry: false,
  });

  return { pdfHistory, captureId, pdf, deliveries };
}

type LegalCopy = ReturnType<typeof invoiceIssueCopy>;

type LegalPdfInspection = typeof LegalInvoicePdf.LegalInvoicePdfView.Type & {
  verified: Awaited<ReturnType<typeof verifyLegalPdf>> | null;
};

function LegalInspectorHeader(props: {
  locale: CommerceProps["locale"];
  copy: LegalCopy;
  pending: boolean;
  error: Error | null;
  onRefresh: () => void;
}) {
  return (
    <>
      <Text>{props.copy.legalReadOnly}</Text>
      <Text>{props.copy.combinedActivation}</Text>
      <Text>{props.copy.limitedProfile}</Text>
      <Box>
        <Button variant="outline" disabled={props.pending} onClick={props.onRefresh}>
          {props.copy.refresh}
        </Button>
      </Box>
      <AccountingStatus locale={props.locale} pending={props.pending} error={props.error} />
    </>
  );
}

function LegalPolicySection({
  copy,
  history,
  loaded,
}: {
  copy: LegalCopy;
  history?: typeof LegalSalesPolicy.LegalSalesPolicyHistory.Type;
  loaded: boolean;
}) {
  return (
    <RecordSection title={copy.policyActivations}>
      {history?.items.length ? (
        <DataTable
          title={copy.policyActivations}
          narrow="stack"
          columns={[
            { id: "policy", label: copy.policyIdentity },
            { id: "series", label: copy.series },
            { id: "review", label: copy.policyReview },
            { id: "limits", label: copy.activationLimits },
          ]}
          rows={history.items.map((item) => ({
            id: item.id,
            cells: [
              `${item.id} · ${item.digest}`,
              item.input.series,
              `${item.candidate.id} → ${item.review.id}`,
              `${copy.issue}: ${String(item.legalInvoiceEnabled)} · ${copy.legalCredit}: ${String(item.creditEnabled)} · ${copy.delivery}: ${String(item.deliveryEnabled)}`,
            ],
          }))}
        />
      ) : (
        <Text>{loaded ? copy.noPolicy : copy.notAvailable}</Text>
      )}
    </RecordSection>
  );
}

function LegalReviewsSection({
  locale,
  copy,
  history,
  onOpen,
}: {
  locale: CommerceProps["locale"];
  copy: LegalCopy;
  history: typeof ArLegal.ArLegalIssueHistory.Type;
  onOpen: (id: string) => void;
}) {
  return (
    <RecordSection title={copy.legalReviews}>
      {history.items.length ? (
        <DataTable
          title={copy.legalReviews}
          narrow="stack"
          columns={[
            { id: "review", label: copy.legalReview },
            { id: "revision", label: copy.revision },
            { id: "created", label: copy.created },
            { id: "number", label: copy.legalNumber },
            { id: "issue", label: copy.issue },
          ]}
          rows={history.items.map((item) => ({
            id: item.id,
            cells: [
              <RecordOpen key="open" onClick={() => onOpen(item.id)}>
                {item.ordinal} · {item.id}
              </RecordOpen>,
              item.draftRevision,
              new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
                new Date(item.createdAt),
              ),
              item.legalDocumentNumber ?? copy.notIssued,
              item.issueId ?? copy.notIssued,
            ],
          }))}
        />
      ) : (
        <Text>{copy.noLegalReview}</Text>
      )}
    </RecordSection>
  );
}

function LegalIdentitySection({
  copy,
  draft,
  review,
  issue,
}: {
  copy: LegalCopy;
  draft?: typeof Drafts.InvoiceDraftRevision.Type;
  review?: typeof ArLegal.ArLegalIssueView.Type;
  issue?: typeof ArLegal.ArLegalIssueReceipt.Type;
}) {
  return (
    <RecordSection title={copy.immutableIdentities}>
      <RecordSummary>
        <RecordFact label={copy.draftIdentity}>
          {draft ? `${draft.id} · ${draft.revision} · ${draft.digest}` : copy.notAvailable}
        </RecordFact>
        <RecordFact label={copy.legalReview}>
          {review ? `${review.review.id} · ${review.review.digest}` : copy.notAvailable}
        </RecordFact>
        <RecordFact label={copy.issueIdentity}>
          {issue ? `${issue.id} · ${issue.digest}` : copy.notIssued}
        </RecordFact>
        <RecordFact label={copy.approvalIdentity}>
          {review?.approval?.id ?? copy.notAvailable}
        </RecordFact>
      </RecordSummary>
    </RecordSection>
  );
}

function LegalStateSection(props: {
  locale: CommerceProps["locale"];
  copy: LegalCopy;
  draft?: typeof Drafts.InvoiceDraftRevision.Type;
  review?: typeof ArLegal.ArLegalIssueView.Type;
  issue?: typeof ArLegal.ArLegalIssueReceipt.Type;
}) {
  const totals = props.review?.review.totals ?? props.issue?.totals;
  const scale = props.draft?.content.currencyScale ?? 2;

  const amount = (value: string | null | undefined) =>
    value == null ? props.copy.notAvailable : formatMinorAmount(value, scale, props.locale);

  return (
    <RecordSection title={props.copy.legalStatesAndTotals}>
      <RecordSummary>
        <RecordFact label={props.copy.issued}>
          {props.issue
            ? props.issue.issued
              ? props.copy.yes
              : props.copy.no
            : props.copy.notIssued}
        </RecordFact>
        <RecordFact label={props.copy.recognized}>
          {props.issue
            ? props.issue.recognized
              ? props.copy.yes
              : props.copy.no
            : props.copy.notIssued}
        </RecordFact>
        <RecordFact label={props.copy.deliveredState}>
          {props.issue?.delivered ? props.copy.yes : props.copy.no}
        </RecordFact>
        <RecordFact label={props.copy.legalNumber}>
          {props.issue?.legalDocumentNumber ?? props.copy.notIssued}
        </RecordFact>
        <RecordFact label={props.copy.net}>
          {amount(totals?.netMinor ?? props.draft?.totals.netMinor)}
        </RecordFact>
        <RecordFact label={props.copy.legalTax}>
          {amount(totals?.taxMinor ?? props.draft?.totals.taxMinor)}
        </RecordFact>
        <RecordFact label={props.copy.gross}>
          {amount(totals?.grossMinor ?? props.draft?.totals.grossMinor)}
        </RecordFact>
      </RecordSummary>
    </RecordSection>
  );
}

function LegalActivationSection({
  copy,
  policy,
  accountingProfile,
}: {
  copy: LegalCopy;
  policy?: typeof LegalSalesPolicy.LegalSalesPolicy.Type;
  accountingProfile?: typeof ArLegal.ArLegalAccountingProfile.Type;
}) {
  return (
    <RecordSection title={copy.activationPair}>
      {policy && accountingProfile ? (
        <>
          <RecordSummary>
            <RecordFact label={copy.legalPolicy}>
              {policy.id} · {policy.digest} · {policy.activatedBy}
            </RecordFact>
            <RecordFact label={copy.accountingProfile}>
              {accountingProfile.id} · {accountingProfile.digest} · {accountingProfile.activatedBy}
            </RecordFact>
          </RecordSummary>
          {policy.activatedBy === accountingProfile.activatedBy ? (
            <Text role="alert">{copy.sameActivationOperator}</Text>
          ) : null}
        </>
      ) : (
        <Text>{copy.noActivationPair}</Text>
      )}
    </RecordSection>
  );
}

function LegalBlockersSection(props: {
  locale: CommerceProps["locale"];
  copy: LegalCopy;
  inputBlockers?: (typeof Drafts.InvoiceDraftRevision.Type)["blockers"];
  boundaryBlockers?: (typeof Drafts.InvoiceDraftRevision.Type)["blockers"];
  currentBlockers?: readonly string[];
}) {
  return (
    <RecordSection title={props.copy.legalInputBlockers}>
      {props.inputBlockers?.map((blocker) => (
        <Text key={`${blocker.code}:${blocker.lineId ?? ""}`} role="alert">
          {invoiceDraftBlocker(blocker.code, props.locale)}
        </Text>
      ))}
      {props.currentBlockers?.map((blocker) => (
        <Text key={blocker} role="alert">
          {blocker}
        </Text>
      ))}
      {props.boundaryBlockers?.map((blocker) => (
        <Text key={blocker.code} tone="muted">
          {invoiceDraftBlocker(blocker.code, props.locale)}
        </Text>
      ))}
      {!props.inputBlockers?.length && !props.currentBlockers?.length ? (
        <Text tone="muted">{props.copy.noReadBlockers}</Text>
      ) : null}
    </RecordSection>
  );
}

function LegalArtifactSection(props: {
  copy: LegalCopy;
  issue?: typeof ArLegal.ArLegalIssueReceipt.Type;
  history?: typeof LegalInvoicePdf.LegalInvoicePdfHistory.Type;
  historyLoaded: boolean;
  pdf?: LegalPdfInspection;
}) {
  if (!props.issue)
    return (
      <RecordSection title={props.copy.legalArtifacts}>
        <Text>{props.copy.noIssueForArtifacts}</Text>
      </RecordSection>
    );

  if (!props.history?.items.length)
    return (
      <RecordSection title={props.copy.legalArtifacts}>
        <Text>{props.historyLoaded ? props.copy.noPdf : props.copy.notAvailable}</Text>
      </RecordSection>
    );
  const verified = props.pdf?.verified;

  return (
    <RecordSection title={props.copy.legalArtifacts}>
      <DataTable
        title={props.copy.legalPdfHistory}
        narrow="stack"
        columns={[
          { id: "capture", label: props.copy.pdfCapture },
          { id: "digest", label: props.copy.captureDigest },
          { id: "artifact", label: props.copy.sealedArtifact },
          { id: "sha", label: props.copy.sha256 },
        ]}
        rows={props.history.items.map((item) => ({
          id: item.id,
          cells: [
            item.id,
            item.digest,
            item.sealed ? props.copy.yes : props.copy.no,
            item.sha256 ?? "—",
          ],
        }))}
      />
      {props.pdf ? (
        <>
          <RecordSummary>
            <RecordFact label={props.copy.pdfCapture}>
              {props.pdf.capture.id} · {props.pdf.capture.digest}
            </RecordFact>
            <RecordFact label={props.copy.artifactHash}>
              {props.pdf.artifact?.sha256 ?? props.copy.notSealed}
            </RecordFact>
            <RecordFact label={props.copy.artifactBytes}>
              {props.pdf.artifact?.byteLength ?? props.copy.notSealed}
            </RecordFact>
            <RecordFact label={props.copy.renderer}>
              {props.pdf.artifact?.rendererVersion ?? props.copy.notSealed}
            </RecordFact>
            <RecordFact label={props.copy.deliveredState}>{props.copy.no}</RecordFact>
          </RecordSummary>
          {verified ? (
            <Box>
              <Button variant="outline" onClick={() => downloadLegalPdf(verified)}>
                {props.copy.downloadPdf}
              </Button>
            </Box>
          ) : null}
          <Text>{props.pdf.artifact ? props.copy.pdfVerified : props.copy.pdfCaptured}</Text>
        </>
      ) : null}
    </RecordSection>
  );
}

function downloadLegalPdf(verified: NonNullable<Awaited<ReturnType<typeof verifyLegalPdf>>>) {
  const url = URL.createObjectURL(new Blob([verified.bytes], { type: "application/pdf" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = verified.filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function LegalDeliverySection({
  copy,
  captureId,
  history,
  loaded,
}: {
  copy: LegalCopy;
  captureId: string;
  history?: typeof LegalDelivery.LegalDeliveryHistory.Type;
  loaded: boolean;
}) {
  if (!captureId)
    return (
      <RecordSection title={copy.deliveryHistory}>
        <Text>{copy.noPdfForDelivery}</Text>
      </RecordSection>
    );

  if (!history?.items.length)
    return (
      <RecordSection title={copy.deliveryHistory}>
        <Text>{loaded ? copy.noDelivery : copy.notAvailable}</Text>
      </RecordSection>
    );

  return (
    <RecordSection title={copy.deliveryHistory}>
      {history.items.map((item) => (
        <LegalDeliveryItem key={item.request.id} copy={copy} value={item} />
      ))}
    </RecordSection>
  );
}

function LegalDeliveryItem({
  copy,
  value,
}: {
  copy: LegalCopy;
  value: typeof LegalDelivery.LegalDeliveryView.Type;
}) {
  return (
    <Details title={`${copy.deliveryRequest} · ${value.request.id}`}>
      <RecordSummary>
        <RecordFact label={copy.deliveryStatus}>{value.status}</RecordFact>
        <RecordFact label={copy.sendAuthorized}>
          {value.approval?.sendAuthorized ? copy.yes : copy.no}
        </RecordFact>
        <RecordFact label={copy.providerPayload}>
          {value.approval?.providerPayloadReady ? copy.yes : copy.no}
        </RecordFact>
        <RecordFact label={copy.deliveredState}>{copy.no}</RecordFact>
      </RecordSummary>
      <Text>
        {value.request.input.channel} · {value.request.input.destination}
      </Text>
      {value.attempts.length ? (
        <DataTable
          title={copy.providerAttempts}
          narrow="stack"
          columns={[
            { id: "attempt", label: copy.attempt },
            { id: "provider", label: copy.providerRequest },
            { id: "status", label: copy.deliveryStatus },
            { id: "traffic", label: copy.externalTraffic },
            { id: "outcome", label: copy.providerOutcome },
            { id: "delivered", label: copy.deliveredState },
          ]}
          rows={value.attempts.map(({ attempt, reconciliation }) => ({
            id: attempt.id,
            cells: [
              `${attempt.ordinal} · ${attempt.id}`,
              attempt.providerRequestId,
              attempt.status,
              String(attempt.externalTrafficProven),
              reconciliation?.outcome ?? copy.notReconciled,
              copy.no,
            ],
          }))}
        />
      ) : (
        <Text>{copy.noProviderAttempts}</Text>
      )}
      <Text>{copy.providerNotDelivery}</Text>
    </Details>
  );
}

function LegalSnapshotSection(props: {
  copy: LegalCopy;
  missingIdentity: boolean;
  draft?: typeof Drafts.InvoiceDraftRevision.Type;
  review?: typeof ArLegal.ArLegalIssueView.Type;
  issue?: typeof ArLegal.ArLegalIssueReceipt.Type;
}) {
  return (
    <>
      {props.missingIdentity ? <Text role="alert">{props.copy.missingIssueIdentity}</Text> : null}
      {props.draft ? <Facts title={props.copy.draftSnapshot} value={props.draft} /> : null}
      {props.review ? <Facts title={props.copy.reviewSnapshot} value={props.review} /> : null}
      {props.issue ? <Facts title={props.copy.issueSnapshot} value={props.issue} /> : null}
    </>
  );
}

async function verifyLegalPdf(
  book: CommerceProps["book"],
  capture: typeof LegalInvoicePdf.LegalInvoicePdfCapture.Type,
  artifact: typeof LegalInvoicePdf.LegalInvoicePdfArtifact.Type,
) {
  if (
    artifact.captureId !== capture.id ||
    artifact.captureDigest !== capture.digest ||
    artifact.legalInvoice !== true ||
    artifact.delivered !== false ||
    artifact.filename !== `${capture.source.issue.legalDocumentNumber}.pdf` ||
    artifact.byteLength < 1 ||
    artifact.byteLength > 2_097_152
  )
    throw new Error("Legal PDF artifact identity mismatch");
  const binary = atob(artifact.contentBase64);

  if (btoa(binary) !== artifact.contentBase64) throw new Error("Noncanonical legal PDF bytes");
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const digest = await crypto.subtle.digest("SHA-256", bytes);

  const sha256 = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

  if (
    bytes.length !== artifact.byteLength ||
    sha256 !== artifact.sha256 ||
    new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-"
  )
    throw new Error("Legal PDF hash, length or signature mismatch");
  checkScope(book, capture.source.issue.scope);

  return { bytes, filename: artifact.filename };
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
                    const account = setup.data?.accounts.find(
                      (entry) => entry.id === line.accountId,
                    );

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
