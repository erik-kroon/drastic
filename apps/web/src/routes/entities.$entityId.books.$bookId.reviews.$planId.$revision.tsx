import * as Schema from "effect/Schema";
import { OwnerReviewQuery, decodeOwnerReturn, ownerReturnHref } from "@/lib/work-return";
import { createFileRoute, defaultStringifySearch } from "@tanstack/react-router";
import { Box } from "@open-erp/ui/components/box";
import { Link } from "@open-erp/ui/components/link";
import {
  FocusedReview,
  ReviewQueueLabel,
  ReviewQueueItem,
} from "@open-erp/ui/components/focused-review";
import { useQuery } from "@tanstack/react-query";
import {
  attentionQueryOptions,
  attentionPath,
  attentionCopy,
  expiredSupplierApproval,
} from "@/lib/attention";
import { formatMinorAmount } from "@/lib/workspace-api";
import { AccountingStatus } from "@/components/accounting-status";
import { useBookWorkspace, workspacePath } from "@/lib/book-context";
import { ReviewOwner, reviewTargetQueryOptions } from "@/components/review-owner";
import { accountingCopy } from "@/lib/accounting-copy";

export const Route = createFileRoute("/entities/$entityId/books/$bookId/reviews/$planId/$revision")(
  { component: Review, validateSearch: Schema.decodeUnknownSync(OwnerReviewQuery) },
);

function Review() {
  const filters = Route.useSearch();
  const { planId, revision } = Route.useParams();
  const { book, setup, locale } = useBookWorkspace();
  const copy = accountingCopy(locale);
  const owner = decodeOwnerReturn(filters.returnTo);
  const queue = useQuery(attentionQueryOptions(book, filters));
  const target = useQuery(reviewTargetQueryOptions(book, planId));

  const presentation =
    !target.isError && target.data?.kind === "supplier_acceptance" ? "focused" : undefined;

  const reasons = attentionCopy(locale);
  const items = queue.isError ? [] : (queue.data?.items ?? []);

  const ownerLabels =
    locale === "sv"
      ? {
          purchases: "Inköp /",
          documents: "Dokument /",
          bank: "Bank /",
          sales: "Försäljning /",
          work: "Att göra /",
          home: "Att göra /",
        }
      : {
          purchases: "Purchases /",
          documents: "Documents /",
          bank: "Bank /",
          sales: "Sales /",
          work: "To do /",
          home: "To do /",
        };

  return (
    <FocusedReview
      presentation={presentation}
      title={
        presentation && queue.data && !queue.isError
          ? locale === "sv"
            ? `Granska: ${queue.data.counts.open} kvar`
            : `Review: ${queue.data.counts.open} remaining`
          : copy.workspace_review
      }
      backLabel={presentation ? ownerLabels[owner?.owner ?? "work"] : copy.workspace_back}
      backHref={
        owner
          ? ownerReturnHref(workspacePath(book), owner)
          : `${workspacePath(book)}/work${defaultStringifySearch(filters)}`
      }
      identity={book.name}
      queue={
        <>
          <ReviewQueueLabel presentation={presentation}>
            {locale === "sv" ? "GRANSKA OCH GODKÄNN" : "REVIEW AND APPROVE"}
          </ReviewQueueLabel>
          <AccountingStatus locale={locale} pending={queue.isPending} error={queue.error} />
          {items.map((item) => (
            <ReviewQueueItem
              key={item.key}
              title={item.title}
              active={item.kind === "journal" && item.id === planId}
              presentation={presentation}
              status={
                item.state === "completed"
                  ? "completed"
                  : expiredSupplierApproval(item) !== null ||
                      item.reason === "document_reading_failed"
                    ? "warning"
                    : item.reason === "invoice_draft" ||
                        item.reason === "supplier_draft" ||
                        item.reason === "document_review"
                      ? "draft"
                      : "pending"
              }
              href={attentionPath(book, item, filters)}
              detail={
                item.amountMinor !== null && item.currencyScale !== null
                  ? `${formatMinorAmount(item.amountMinor, item.currencyScale, locale)} ${item.currency ?? book.currency}`
                  : reasons[item.reason]
              }
            />
          ))}
          {queue.data?.next ? (
            <Box padding="sm">
              <Link
                href={`${workspacePath(book)}/work${defaultStringifySearch({ ...filters, after: queue.data.next })}`}
              >
                {reasons.next}
              </Link>
            </Box>
          ) : null}
        </>
      }
    >
      <ReviewOwner
        key={`${planId}/${revision}`}
        book={book}
        setup={setup}
        locale={locale}
        planId={planId}
        expectedDigest={revision}
        returnSearch={defaultStringifySearch(filters)}
      />
    </FocusedReview>
  );
}
