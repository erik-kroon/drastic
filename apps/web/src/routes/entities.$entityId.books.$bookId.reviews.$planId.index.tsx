import * as Schema from "effect/Schema";
import { OwnerReviewQuery, decodeOwnerReturn, ownerReturnHref } from "@/lib/work-return";
import { createFileRoute, defaultStringifySearch } from "@tanstack/react-router";
import { Box } from "@open-erp/ui/components/box";
import { Link } from "@open-erp/ui/components/link";
import { useBookWorkspace, workspacePath } from "@/lib/book-context";
import { ReviewOwner } from "@/components/review-owner";
import { accountingCopy } from "@/lib/accounting-copy";

export const Route = createFileRoute("/entities/$entityId/books/$bookId/reviews/$planId/")({
  component: ResolveReview,
  validateSearch: Schema.decodeUnknownSync(OwnerReviewQuery),
});

function ResolveReview() {
  const filters = Route.useSearch();
  const { planId } = Route.useParams();
  const { book, setup, locale } = useBookWorkspace();
  const copy = accountingCopy(locale);
  const owner = decodeOwnerReturn(filters.returnTo);

  return (
    <Box display="grid" gap="lg">
      <Link
        href={
          owner
            ? ownerReturnHref(workspacePath(book), owner)
            : `${workspacePath(book)}/work${defaultStringifySearch(filters)}`
        }
      >
        {copy.workspace_back}
      </Link>
      <ReviewOwner
        book={book}
        setup={setup}
        locale={locale}
        planId={planId}
        returnSearch={defaultStringifySearch(filters)}
      />
    </Box>
  );
}
