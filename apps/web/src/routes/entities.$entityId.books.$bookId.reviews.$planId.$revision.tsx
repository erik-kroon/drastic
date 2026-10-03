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
import { attentionQueryOptions, attentionPath, attentionCopy } from "@/lib/attention";
import { formatMinorAmount } from "@/lib/workspace-api";
import { AccountingStatus } from "@/components/accounting-status";
import { useBookWorkspace, workspacePath } from "@/lib/book-context";
import { PostingRecoveryReview } from "@/components/posting-recovery/review";
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
  const reasons = attentionCopy(locale);
  const items = queue.isError ? [] : (queue.data?.items ?? []);

  return (
    <FocusedReview
      title={copy.workspace_review}
      backLabel={copy.workspace_back}
      backHref={
        owner
          ? ownerReturnHref(workspacePath(book), owner)
          : `${workspacePath(book)}/work${defaultStringifySearch(filters)}`
      }
      identity={book.name}
      queue={
        <>
          <ReviewQueueLabel>
            {locale === "sv" ? "GRANSKA OCH GODKÄNN" : "REVIEW AND APPROVE"}
          </ReviewQueueLabel>
          <AccountingStatus locale={locale} pending={queue.isPending} error={queue.error} />
          {items.map((item) => (
            <ReviewQueueItem
              key={item.key}
              title={item.title}
              active={item.kind === "journal" && item.id === planId}
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
      <PostingRecoveryReview
        key={`${planId}/${revision}`}
        book={book}
        accounts={setup.accounts}
        locale={locale}
        id={planId}
        expectedDigest={revision}
        returnSearch={defaultStringifySearch(filters)}
      />
    </FocusedReview>
  );
}
