import { Link, defaultStringifySearch } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { DetailBar, ReviewFrame, ReviewQueue, QueueItem } from "@open-erp/ui/kanon/layouts";
import { InlineAction } from "@open-erp/ui/kanon/action";
import { type OwnerReviewQuery, decodeOwnerReturn, ownerReturnHref } from "@/lib/work-return";
import {
  attentionQueryOptions,
  attentionPath,
  attentionCopy,
  attentionStatus,
} from "@/lib/attention";
import { formatMinorAmount } from "@/lib/workspace-api";
import { AccountingStatus } from "@/components/accounting-status";
import { useBookWorkspace, workspacePath } from "@/lib/book-context";
import { ReviewOwner, reviewTargetQueryOptions } from "@/components/review-owner";
import { accountingCopy } from "@/lib/accounting-copy";

export function ReviewScreen({
  planId,
  revision,
  filters,
}: {
  planId: string;
  revision: string;
  filters: typeof OwnerReviewQuery.Type;
}) {
  const { book, setup, locale } = useBookWorkspace();
  const copy = accountingCopy(locale);
  const owner = decodeOwnerReturn(filters.returnTo);
  const queue = useQuery(attentionQueryOptions(book, filters));
  const target = useQuery(reviewTargetQueryOptions(book, planId));
  const supplier = !target.isError && target.data?.kind === "supplier_acceptance";
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

  const backLabel = supplier ? ownerLabels[owner?.owner ?? "work"] : copy.workspace_back;

  const backHref = owner
    ? ownerReturnHref(workspacePath(book), owner)
    : `${workspacePath(book)}/work${defaultStringifySearch(filters)}`;

  const title =
    supplier && queue.data && !queue.isError
      ? locale === "sv"
        ? `Granska: ${queue.data.counts.open} kvar`
        : `Review: ${queue.data.counts.open} remaining`
      : copy.workspace_review;

  return (
    <ReviewFrame
      bar={
        <DetailBar
          crumbs={[
            {
              label: backLabel.replace(/ \/$/, ""),
              render: <Link to={backHref} aria-label={backLabel} />,
            },
          ]}
          current={title}
          currentAs="h1"
          identity={book.name}
        />
      }
      queue={
        <ReviewQueue
          title={locale === "sv" ? "Granska" : "Review"}
          count={!queue.isError ? queue.data?.counts.open : undefined}
        >
          <AccountingStatus locale={locale} pending={queue.isPending} error={queue.error} />
          {items.map((item) => (
            <QueueItem
              key={item.key}
              name={item.title}
              selected={item.kind === "journal" && item.id === planId}
              status={attentionStatus(item)}
              render={<Link to={attentionPath(book, item, filters, owner)} />}
              meta={
                item.amountMinor !== null && item.currencyScale !== null
                  ? `${formatMinorAmount(item.amountMinor, item.currencyScale, locale)} ${item.currency ?? book.currency}`
                  : reasons[item.reason]
              }
            />
          ))}
          {queue.data?.next ? (
            <InlineAction
              render={
                <a
                  href={`${workspacePath(book)}/work${defaultStringifySearch({ ...filters, after: queue.data.next })}`}
                />
              }
            >
              {reasons.next}
            </InlineAction>
          ) : null}
        </ReviewQueue>
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
    </ReviewFrame>
  );
}
