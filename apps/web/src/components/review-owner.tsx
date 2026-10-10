import { queryOptions, useQuery } from "@tanstack/react-query";
import { Navigate } from "@tanstack/react-router";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Cases from "@open-erp/contracts/cases";
import { ReviewContent } from "@open-erp/ui/kanon/layouts";
import { Box } from "@open-erp/ui/components/box";
import { Action } from "@open-erp/ui/kanon/action";
import { Text } from "@open-erp/ui/components/typography";
import { AccountingStatus } from "@/components/accounting-status";
import { PostingRecoveryReview } from "@/components/posting-recovery/review";
import { SupplierFocusedReview } from "@/components/commerce/supplier-focused-review";
import { bookKey, bookPath, readAccounting } from "@/lib/accounting-api";
import { accountingCopy } from "@/lib/accounting-copy";
import { reviewPath, reviewTargetPath } from "@/lib/book-context";
import type { Locale } from "@/paraglide/runtime";

export function reviewTargetQueryOptions(book: typeof Accounting.Book.Type, planId: string) {
  return queryOptions({
    queryKey: [...bookKey(book), "review-target", planId],
    queryFn: async ({ signal }) => {
      const result = await readAccounting(
        `${bookPath(book)}/review-targets/${encodeURIComponent(planId)}`,
        Cases.ReviewResolution,
        { signal },
      );

      if ((result.kind === "correction" ? result.constituentId : result.changeSetId) !== planId)
        throw new Error("Review target identity mismatch");

      return result;
    },
    retry: false,
  });
}

export function ReviewOwner(props: {
  book: typeof Accounting.Book.Type;
  setup: typeof Accounting.BookSetup.Type;
  locale: Locale;
  planId: string;
  expectedDigest?: string;
  returnSearch: string;
}) {
  const { book, setup, locale, planId } = props;

  const copy = accountingCopy(locale);

  const resolution = useQuery(reviewTargetQueryOptions(book, planId));

  const target = resolution.isError ? undefined : resolution.data;

  if (
    (target?.kind === "standalone" || target?.kind === "supplier_acceptance") &&
    !props.expectedDigest
  )
    return (
      <Navigate
        to={`${reviewPath(book, planId, target.planDigest)}${props.returnSearch}`}
        replace
      />
    );

  if (target?.kind === "supplier_acceptance")
    return (
      <SupplierFocusedReview
        book={book}
        locale={locale}
        accounts={setup.accounts}
        today={setup.today}
        owner={target}
        expectedDigest={props.expectedDigest ?? target.planDigest}
        returnSearch={props.returnSearch}
      />
    );

  if (target?.kind === "standalone")
    return (
      <ReviewContent>
        <PostingRecoveryReview
          book={book}
          accounts={setup.accounts}
          locale={locale}
          id={planId}
          expectedDigest={props.expectedDigest ?? target.planDigest}
          returnSearch={props.returnSearch}
        />
      </ReviewContent>
    );

  if (target?.kind === "correction") {
    const destination = reviewTargetPath(book, {
      kind: "correction",
      bundleId: target.bundleId,
      bundleDigest: target.bundleDigest,
    });

    const context = new URLSearchParams(props.returnSearch);
    const ownerReturn = context.get("returnTo");
    const work = context.get("work");
    const witnesses = `&correctionChild=${encodeURIComponent(planId)}${props.expectedDigest ? `&correctionPlanDigest=${encodeURIComponent(props.expectedDigest)}` : ""}`;
    const returnContext = `${work ? `&work=${encodeURIComponent(work)}` : ""}${ownerReturn ? `&returnTo=${encodeURIComponent(ownerReturn)}` : ""}`;

    return <Navigate to={`${destination}${witnesses}${returnContext}`} replace />;
  }

  return (
    <ReviewContent>
      <Box display="grid" gap="md" padding="md">
        <AccountingStatus locale={locale} pending={resolution.isPending} error={resolution.error} />
        {target?.kind === "ambiguous" ? <Text role="alert">{copy.case_owner_conflict}</Text> : null}
        {resolution.isError || target?.kind === "ambiguous" ? (
          <Box>
            <Action
              kind="secondary"
              blockedBy={resolution.isFetching ? copy.journal_working : undefined}
              onClick={() => {
                void resolution.refetch();
              }}
            >
              {copy.journal_retry}
            </Action>
          </Box>
        ) : null}
      </Box>
    </ReviewContent>
  );
}
