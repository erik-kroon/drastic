import { useQuery } from "@tanstack/react-query";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Controls from "@open-erp/contracts/subledger-controls";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { Link } from "@open-erp/ui/components/link";
import { AccountingStatus } from "@/components/accounting-status";
import { checkScope } from "@/components/commerce/shared";
import { bookKey, bookPath, readAccounting } from "@/lib/accounting-api";
import { workspacePath } from "@/lib/book-context";
import type { Locale } from "@/paraglide/runtime";

export function AssetValuationDirectory(props: {
  book: typeof Accounting.Book.Type;
  scheduleId: string;
  locale: Locale;
}) {
  const { book, scheduleId, locale } = props;

  const query = useQuery({
    queryKey: [...bookKey(book), "asset-valuations", "schedule", scheduleId],
    retry: false,
    queryFn: async ({ signal }) => {
      const value = await readAccounting(
        `${bookPath(book)}/subledger-controls/valuations/for-schedule/${encodeURIComponent(scheduleId)}`,
        Controls.AssetValuationReviewList,
        { signal },
      );

      checkScope(book, value.scope);

      if (
        value.scheduleId !== scheduleId ||
        value.items.some((review) => review.input.scheduleId !== scheduleId)
      )
        throw new Error("Valuation directory identity mismatch");

      return value;
    },
  });

  return (
    <Box display="grid" gap="md">
      <AccountingStatus locale={locale} pending={query.isPending} error={query.error} />
      {query.isError ? (
        <Button variant="outline" onClick={() => void query.refetch()}>
          Försök igen
        </Button>
      ) : null}
      {!query.isError
        ? query.data?.items
            .filter((review) => review.input.kind === "economic_reversal")
            .map((review) => (
              <Link
                key={review.id}
                href={`${workspacePath(book)}/books?view=assets&record=${encodeURIComponent(scheduleId)}&assetAction=reversal&assetReview=${encodeURIComponent(review.id)}`}
              >
                Återföring av nedskrivning, {review.input.postingDate}
              </Link>
            ))
        : null}
    </Box>
  );
}
