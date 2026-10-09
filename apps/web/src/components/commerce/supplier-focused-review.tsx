import * as Cases from "@open-erp/contracts/cases";
import * as Accounting from "@open-erp/contracts/accounting";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { Link } from "@open-erp/ui/components/link";
import {
  RegisterDetailHeading,
  RegisterDetailLines,
} from "@open-erp/ui/components/register-workspace";
import { Text } from "@open-erp/ui/components/typography";
import { ReviewPanes, ReviewContent, OriginalViewerSurface } from "@open-erp/ui/kanon/layouts";
import { DetailPanelSurface } from "@open-erp/ui/kanon/detail-panel";
import { Disclosure } from "@open-erp/ui/components/workflow";
import { WorkReviewFooter } from "@open-erp/ui/components/work-controls";
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
            <Button
              variant="outline"
              disabled={query.isFetching}
              onClick={() => void query.refetch()}
            >
              {sv ? "Uppdatera granskning" : "Refresh review"}
            </Button>
          </Box>
        </Box>
      </ReviewContent>
    );

  const snapshot = view.plan.draftSnapshot;
  const ready = query.isFetchedAfterMount && query.fetchStatus === "idle";

  const lines = view.plan.postingPlan.groups.flatMap((group) =>
    group.actions.flatMap((action) =>
      action.lines.map((line) => {
        const account = props.accounts.find((item) => item.id === line.accountId);

        return {
          id: `${group.id}/${line.lineId}`,
          description: account ? `${account.code} ${account.name}` : line.description,
          amount: formatMinorAmount(
            (BigInt(line.debitMinor) - BigInt(line.creditMinor)).toString(),
            snapshot.content.currencyScale,
            locale,
          ),
        };
      }),
    ),
  );

  return (
    <ReviewPanes
      paneLabels={{
        original: sv ? "Original" : "Evidence",
        decision: sv ? "Beslut" : "Decision",
      }}
      original={
        <OriginalViewerSurface label={sv ? "Original" : "Evidence"}>
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
        <DetailPanelSurface as="section" label={sv ? "Beslut" : "Decision"}>
          <RegisterDetailHeading
            presentation="focused"
            caption={sv ? "Leverantörsfaktura, förslag" : "Supplier invoice, proposal"}
            title={
              snapshot.totals.grossMinor === null
                ? "—"
                : `${formatMinorAmount(snapshot.totals.grossMinor, snapshot.content.currencyScale, locale)} ${sv ? "att betala" : "payable"}`
            }
            note={`${snapshot.counterparty.displayName}, ${sv ? "faktura" : "invoice"} ${snapshot.content.supplierDocumentNumber ?? "—"}`}
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
              <RegisterDetailLines
                title={sv ? "Bokförs" : "Posting"}
                rowSize="review"
                presentation="focused"
                lines={lines}
              />
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
              <Box display="grid" gap="xs" marginBlockStart="md">
                <Text variant="caption" weight="semibold">
                  {sv ? "FRÅGOR" : "QUESTIONS"}
                </Text>
                <WorkQuestionsEntry
                  book={book}
                  locale={locale}
                  target={{ kind: "journal", recordId: owner.changeSetId }}
                />
              </Box>
              <WorkReviewFooter presentation="focused">
                {view.acceptance ? (
                  <SupplierAcceptanceResult
                    book={book}
                    locale={locale}
                    receipt={view.acceptance}
                    draftId={owner.draftId}
                    reviewId={owner.reviewId}
                  />
                ) : null}
                <SupplierAcceptanceActions
                  book={book}
                  locale={locale}
                  view={view}
                  ready={ready}
                  presentation="focused"
                  onChanged={() => void query.refetch()}
                />
              </WorkReviewFooter>
            </>
          )}
        </DetailPanelSurface>
      }
    />
  );
}
