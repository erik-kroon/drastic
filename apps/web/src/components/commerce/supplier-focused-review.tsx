import * as Cases from "@open-erp/contracts/cases";
import * as Accounting from "@open-erp/contracts/accounting";
import { Box } from "@open-erp/ui/components/box";
import { Action } from "@open-erp/ui/kanon/action";
import { Link } from "@open-erp/ui/components/link";
import { LedgerCard } from "@open-erp/ui/kanon/cards";
import { CheckRow } from "@open-erp/ui/kanon/feedback";
import { Text } from "@open-erp/ui/components/typography";
import { ReviewPanes, ReviewContent, OriginalViewerSurface } from "@open-erp/ui/kanon/layouts";
import {
  DetailPanelSurface,
  DetailPanelHeader,
  DetailPanelActions,
  PanelSection,
} from "@open-erp/ui/kanon/detail-panel";
import { Disclosure } from "@open-erp/ui/components/workflow";
import { AccountingStatus } from "@/components/accounting-status";
import { EvidenceInspector } from "@/components/evidence-inspector";
import { WorkQuestionsEntry } from "@/components/work-questions";
import { reviewPath } from "@/lib/book-context";
import { accountingCopy } from "@/lib/accounting-copy";
import { formatMinorAmount } from "@/lib/workspace-api";
import {
  SupplierAcceptanceActions,
  SupplierAcceptanceResult,
  SupplierReviewedLines,
  useSupplierAcceptanceReview,
  supplierPostingSummary,
} from "./supplier-acceptance";
import { SupplierApprovalExpiry, isSupplierApprovalExpired } from "./supplier-approval-expiry";
import type { CommerceProps } from "./shared";

type Owner = Extract<typeof Cases.ReviewResolution.Type, { kind: "supplier_acceptance" }>;

export function SupplierFocusedReview(
  props: CommerceProps & {
    owner: Owner;
    accounts: typeof Accounting.BookSetup.Type.accounts;
    expectedDigest: string;
    returnSearch: string;
  },
) {
  const { book, locale, owner } = props;
  const sv = locale === "sv";
  const copy = accountingCopy(locale);

  const labels = sv
    ? {
        original: "Original",
        decision: "Beslut",
        kicker: "Leverantörsfaktura, förslag",
        posting: "Bokförs",
        matches: "Beloppen stämmer med granskade uppgifter",
        check: "Kontrollera beloppen mot originalet",
      }
    : {
        original: "Evidence",
        decision: "Decision",
        kicker: "Supplier invoice, proposal",
        posting: "Posting",
        matches: "Amounts match reviewed facts",
        check: "Check amounts against the original",
      };

  const query = useSupplierAcceptanceReview(book, owner.draftId, owner.reviewId);
  const view = query.isError ? undefined : query.data;

  const matches =
    view &&
    view.plan.postingPlan.id === owner.changeSetId &&
    view.plan.postingPlan.planDigest === owner.planDigest &&
    view.plan.digest === owner.reviewDigest;

  if (!view || !matches || view.plan.postingPlan.planDigest !== props.expectedDigest)
    return (
      <ReviewContent>
        <Box display="grid" gap="md" padding="md">
          <AccountingStatus locale={locale} pending={query.isPending} error={query.error} />
          {view ? (
            <>
              <Text role="alert">{copy.workspace_revision_mismatch}</Text>
              {matches ? (
                <Link
                  href={`${reviewPath(book, owner.changeSetId, view.plan.postingPlan.planDigest)}${props.returnSearch}`}
                >
                  {copy.workspace_current_revision}
                </Link>
              ) : null}
            </>
          ) : null}
          <Box>
            <Action
              kind="secondary"
              blockedBy={query.isFetching ? copy.journal_working : undefined}
              onClick={() => void query.refetch()}
            >
              {sv ? "Uppdatera granskning" : "Refresh review"}
            </Action>
          </Box>
        </Box>
      </ReviewContent>
    );

  const snapshot = view.plan.draftSnapshot;
  const ready = query.isFetchedAfterMount && query.fetchStatus === "idle";

  const amountsMatch =
    snapshot.totals.sourceTotalMatches === true &&
    snapshot.calculatedLines.every((line) => line.sourceGrossMatches === true);

  return (
    <ReviewPanes
      paneLabels={{
        original: labels.original,
        decision: labels.decision,
      }}
      original={
        <OriginalViewerSurface label={labels.original}>
          <EvidenceInspector
            book={book}
            locale={locale}
            expanded
            compact
            presentation="focused"
            reference={{ ...snapshot.sourceEvidence, locator: snapshot.content.title }}
          />
        </OriginalViewerSurface>
      }
      decision={
        <DetailPanelSurface as="section" label={labels.decision}>
          <DetailPanelHeader
            figureAs="h2"
            kicker={labels.kicker}
            figure={
              snapshot.totals.grossMinor === null
                ? "—"
                : formatMinorAmount(
                    snapshot.totals.grossMinor,
                    snapshot.content.currencyScale,
                    locale,
                  )
            }
            subtitle={`${snapshot.counterparty.displayName}, ${sv ? "faktura" : "invoice"} ${snapshot.content.supplierDocumentNumber ?? "—"}`}
          />
          {isSupplierApprovalExpired(view) ? (
            <SupplierApprovalExpiry
              book={book}
              locale={locale}
              view={view}
              ready={ready}
              onRenewed={() => void query.refetch()}
            />
          ) : (
            <>
              <PanelSection label={labels.posting}>
                <LedgerCard
                  signed
                  lines={supplierPostingSummary(view.plan, props.accounts, locale)}
                />
                <CheckRow result={amountsMatch ? "done" : "needsYou"}>
                  {amountsMatch ? labels.matches : labels.check}
                </CheckRow>
              </PanelSection>
              <Box display="grid" gap="sm" paddingBlock="sm">
                {!view.acceptance
                  ? view.blockers.map((blocker) => (
                      <Text key={blocker} role="alert">
                        {blocker}
                      </Text>
                    ))
                  : null}
                <Disclosure compact title={sv ? "Granskade uppgifter" : "Reviewed facts"}>
                  <SupplierReviewedLines
                    locale={locale}
                    plan={view.plan}
                    accounts={props.accounts}
                  />
                  <Text tone="muted">
                    {sv ? "Granskning" : "Review"} {view.plan.ordinal},{" "}
                    {sv ? "utkastversion" : "draft revision"} {snapshot.revision}
                  </Text>
                </Disclosure>
              </Box>
              <PanelSection label={sv ? "FRÅGOR" : "QUESTIONS"}>
                <WorkQuestionsEntry
                  book={book}
                  locale={locale}
                  target={{ kind: "journal", recordId: owner.changeSetId }}
                />
              </PanelSection>
              <DetailPanelActions
                primary={
                  view.acceptance ? (
                    <SupplierAcceptanceResult
                      book={book}
                      locale={locale}
                      receipt={view.acceptance}
                      draftId={owner.draftId}
                      reviewId={owner.reviewId}
                    />
                  ) : (
                    <SupplierAcceptanceActions
                      book={book}
                      locale={locale}
                      view={view}
                      ready={ready}
                      presentation="focused"
                      onChanged={() => void query.refetch()}
                    />
                  )
                }
              />
            </>
          )}
        </DetailPanelSurface>
      }
    />
  );
}
