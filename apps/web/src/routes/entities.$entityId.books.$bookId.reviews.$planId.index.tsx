import * as Schema from "effect/Schema";
import { WorkQuery } from "@open-erp/contracts/workspace";
import { createFileRoute, Navigate, defaultStringifySearch } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import * as Recovery from "@open-erp/contracts/posting-recovery";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { Link } from "@open-erp/ui/components/link";
import { AccountingStatus } from "@/components/accounting-status";
import { useBookWorkspace, workspacePath, reviewPath } from "@/lib/book-context";
import { bookKey, bookPath, readAccounting } from "@/lib/accounting-api";
import { accountingCopy } from "@/lib/accounting-copy";

export const Route = createFileRoute("/entities/$entityId/books/$bookId/reviews/$planId/")({
  component: ResolveReview,
  validateSearch: Schema.decodeUnknownSync(WorkQuery),
});

function ResolveReview() {
  const filters = Route.useSearch();
  const { planId } = Route.useParams();
  const { book, locale } = useBookWorkspace();
  const copy = accountingCopy(locale);
  const recovery = useQuery({
    queryKey: [...bookKey(book), "posting-recovery", "detail", planId, null],
    queryFn: async ({ signal }) => {
      const result = await readAccounting(
        `${bookPath(book)}/posting-recovery/${encodeURIComponent(planId)}`,
        Recovery.PostingRecovery,
        { signal },
      );
      if (
        result.plan.id !== planId ||
        result.scope.entityId !== book.entityId ||
        result.scope.bookId !== book.id
      )
        throw new Error("Response scope mismatch");
      return result;
    },
    retry: false,
  });
  if (recovery.data && !recovery.isError)
    return (
      <Navigate
        to={reviewPath(book, planId, recovery.data.plan.planDigest)}
        search={filters}
        replace
      />
    );
  return (
    <Box display="grid" gap="lg">
      <Link href={`${workspacePath(book)}/work${defaultStringifySearch(filters)}`}>
        {copy.workspace_back}
      </Link>
      <AccountingStatus locale={locale} pending={recovery.isPending} error={recovery.error} />
      {recovery.isError ? (
        <Button
          size="xl"
          variant="outline"
          onClick={() => {
            void recovery.refetch();
          }}
        >
          {copy.journal_retry}
        </Button>
      ) : null}
    </Box>
  );
}
