import * as Schema from "effect/Schema";
import { WorkQuery } from "@open-erp/contracts/workspace";
import { createFileRoute, defaultStringifySearch } from "@tanstack/react-router";
import { Box } from "@open-erp/ui/components/box";
import { Link } from "@open-erp/ui/components/link";
import { WorkspaceHeader } from "@open-erp/ui/components/workspace";
import { useBookWorkspace, workspacePath } from "@/lib/book-context";
import { PostingRecoveryReview } from "@/components/posting-recovery/review";
import { accountingCopy } from "@/lib/accounting-copy";

export const Route = createFileRoute("/entities/$entityId/books/$bookId/reviews/$planId/$revision")(
  { component: Review, validateSearch: Schema.decodeUnknownSync(WorkQuery) },
);

function Review() {
  const filters = Route.useSearch();
  const { planId, revision } = Route.useParams();
  const { book, setup, locale } = useBookWorkspace();
  const copy = accountingCopy(locale);

  return (
    <Box display="grid" gap="xl" minWidth="zero">
      <WorkspaceHeader
        title={copy.workspace_review}
        action={
          <Link href={`${workspacePath(book)}/work${defaultStringifySearch(filters)}`}>
            {copy.workspace_back}
          </Link>
        }
      />
      <PostingRecoveryReview
        key={`${planId}/${revision}`}
        book={book}
        accounts={setup.accounts}
        locale={locale}
        id={planId}
        expectedDigest={revision}
        returnSearch={defaultStringifySearch(filters)}
      />
    </Box>
  );
}
