import { bookScope } from "@/lib/contract-client";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import * as Acceptance from "@open-erp/contracts/supplier-acceptance";
import * as Accounting from "@open-erp/contracts/accounting";
import type * as Workspace from "@open-erp/contracts/workspace";
import { PageCaption } from "@open-erp/ui/components/accounting-page";
import { LedgerCard } from "@open-erp/ui/kanon/cards";
import { DetailPanelHeader, PanelSection } from "@open-erp/ui/kanon/detail-panel";
import { EvidenceFile } from "@open-erp/ui/kanon/record";
import { CheckRow } from "@open-erp/ui/kanon/feedback";
import { InlineAction } from "@open-erp/ui/kanon/action";
import { useBookWorkspace, reviewPath } from "@/lib/book-context";
import { readAccounting, bookKey } from "@/lib/accounting-api";
import { formatMinorAmount } from "@/lib/workspace-api";
import { enteredExpenseSource } from "@/lib/source-documents";
import { commerceKey, checkScope } from "@/components/commerce/shared";
import { AccountingStatus } from "@/components/accounting-status";
import { supplierPostingSummary } from "./commerce/supplier-acceptance";
import {
  SupplierApprovalExpiry,
  isSupplierApprovalExpired,
  supplierApprovalRefetchInterval,
} from "./commerce/supplier-approval-expiry";

export function WorkSupplierPreview({
  item,
  heading,
  actions,
}: {
  item: typeof Workspace.AttentionItem.Type;
  heading?: ReactNode;
  actions?: ReactNode;
}) {
  const { book, setup, locale } = useBookWorkspace();
  const reference = item.supplierReview;
  const reviewId = reference?.reviewId ?? "";
  const draftId = reference?.draftId ?? "";

  const query = useQuery<typeof Acceptance.SupplierAcceptanceView.Type>({
    queryKey: [...commerceKey(book), "supplier-acceptance-review", reviewId],
    refetchInterval: (query) => supplierApprovalRefetchInterval(query.state.data),
    enabled: Boolean(reference),
    staleTime: 0,
    refetchOnMount: "always",
    queryFn: async ({ signal }) => {
      const result = await readAccounting(
        (client) =>
          client.supplierAcceptance.getSupplierAcceptanceReview({
            params: { ...bookScope(book), id: reviewId },
          }),
        Acceptance.SupplierAcceptanceView,
        { signal },
      );

      checkScope(book, result.plan.scope);
      checkScope(book, result.plan.postingPlan.scope);
      checkScope(book, result.plan.draftSnapshot.scope);

      if (result.approval) checkScope(book, result.approval.scope);

      if (result.acceptance) checkScope(book, result.acceptance.scope);

      if (
        result.plan.id !== reviewId ||
        result.plan.input.draftId !== draftId ||
        result.plan.draftSnapshot.id !== draftId
      )
        throw new Error("Supplier acceptance review mismatch");

      return result;
    },
    retry: false,
  });

  const evidenceRef = query.data?.plan.draftSnapshot.sourceEvidence;

  const evidence = useQuery({
    queryKey: [...bookKey(book), "evidence", evidenceRef?.evidenceId, evidenceRef?.sha256],
    enabled: Boolean(evidenceRef),
    queryFn: async ({ signal }) => {
      if (!evidenceRef) throw new Error("Supplier evidence is required");

      const result = await readAccounting(
        (client) =>
          client.accounting.getEvidence({
            params: { ...bookScope(book), id: evidenceRef.evidenceId },
          }),
        Accounting.EvidenceContent,
        { signal },
      );

      if (result.id !== evidenceRef.evidenceId || result.sha256 !== evidenceRef.sha256)
        throw new Error("Supplier evidence reference mismatch");

      return result;
    },
    retry: false,
  });

  if (!reference) return null;

  if (!query.data || query.isError)
    return (
      <>
        {heading}
        <AccountingStatus locale={locale} pending={query.isPending} error={query.error} />
        {actions}
      </>
    );

  const view = query.data;

  if (isSupplierApprovalExpired(view)) {
    return (
      <SupplierApprovalExpiry
        book={book}
        locale={locale}
        view={view}
        heading
        ready={query.isFetchedAfterMount && query.fetchStatus === "idle"}
        onRenewed={() => {
          void query.refetch();
        }}
      />
    );
  }

  const copy =
    locale === "sv"
      ? {
          posted: "Bokföring",
          proposed: "Föreslagen bokföring",
          kicker: "Leverantörsfaktura, förslag",
          unknown: "Okänt",
          stale: "Förslaget behöver uppdateras.",
          original: "Original",
          open: "Öppna",
          matched: "Beloppen stämmer med granskade uppgifter",
          check: "Kontrollera beloppen mot originalet",
          dueToday: "Förfaller i dag.",
        }
      : {
          posted: "Posting",
          proposed: "Proposed posting",
          kicker: "Supplier invoice, proposal",
          unknown: "Unknown",
          stale: "The proposal needs updating.",
          original: "Original document",
          open: "Open",
          matched: "Amounts match reviewed facts",
          check: "Check amounts against the original",
          dueToday: "Due today.",
        };

  const snapshot = view.plan.draftSnapshot;

  const original =
    evidence.data?.mediaType === "application/json"
      ? enteredExpenseSource(evidence.data.content)
      : null;

  const amountsMatch =
    snapshot.totals.sourceTotalMatches === true &&
    snapshot.calculatedLines.every((line) => line.sourceGrossMatches === true);

  return (
    <>
      <DetailPanelHeader
        kicker={copy.kicker}
        figure={
          snapshot.totals.grossMinor === null
            ? copy.unknown
            : formatMinorAmount(snapshot.totals.grossMinor, snapshot.content.currencyScale, locale)
        }
        subtitle={
          snapshot.content.dueDate === setup.today
            ? `${snapshot.content.title.replace(/\.$/u, "")}. ${copy.dueToday}`
            : snapshot.content.title
        }
        subtitleAs="h2"
      />
      {!view.dependenciesCurrent && !view.acceptance ? (
        <PageCaption>{copy.stale}</PageCaption>
      ) : null}
      <AccountingStatus locale={locale} pending={evidence.isPending} error={evidence.error} />
      {original ? (
        <EvidenceFile
          name={original.filename}
          detail={copy.original}
          action={
            <InlineAction
              render={
                <a
                  href={reviewPath(
                    book,
                    view.plan.postingPlan.id,
                    view.plan.postingPlan.planDigest,
                  )}
                />
              }
            >
              {copy.open}
            </InlineAction>
          }
        />
      ) : null}
      <PanelSection label={view.acceptance ? copy.posted : copy.proposed}>
        <LedgerCard signed lines={supplierPostingSummary(view.plan, setup.accounts, locale)} />
        <CheckRow result={amountsMatch ? "done" : "needsYou"}>
          {amountsMatch ? copy.matched : copy.check}
        </CheckRow>
      </PanelSection>
      {actions}
    </>
  );
}
