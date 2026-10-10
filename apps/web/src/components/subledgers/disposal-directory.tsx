import { Api } from "@open-erp/contracts/api";
import { bookScope, httpQuery } from "@/lib/contract-client";
import { useQuery } from "@tanstack/react-query";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Disposals from "@open-erp/contracts/asset-disposals";
import * as Subledgers from "@open-erp/contracts/subledgers";
import { useState } from "react";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { Link } from "@open-erp/ui/components/link";
import { AccountingStatus } from "@/components/accounting-status";
import { bookKey, readAccounting } from "@/lib/accounting-api";
import { workspacePath } from "@/lib/book-context";
import { checkScope } from "@/components/commerce/shared";
import type { Locale } from "@/paraglide/runtime";

export function AssetDisposalDirectory(props: {
  book: typeof Accounting.Book.Type;
  schedule: typeof Subledgers.ScheduleView.Type;
  locale: Locale;
}) {
  const { book, schedule, locale } = props;

  const [after, setAfter] = useState<string>();

  const id = schedule.current.scheduleId;

  const page = useQuery({
    queryKey: [...bookKey(book), "asset-disposals", "schedule", id, after],
    retry: false,
    queryFn: async ({ signal }) => {
      const value = await readAccounting(
        (client) =>
          client.assetDisposals.listAssetProceedsDisposals({
            params: { ...bookScope(book), id: id },
            query: httpQuery(
              Api.groups.assetDisposals.endpoints.listAssetProceedsDisposals,
              `${after ? `?after=${encodeURIComponent(after)}` : ""}`,
            ),
          }),
        Disposals.ReviewPage,
        { signal },
      );

      checkScope(book, value.scope);

      if (
        value.scheduleId !== id ||
        value.items.some((review) => review.assetBasis.schedule.scheduleId !== id)
      )
        throw new Error("Disposal directory identity mismatch");

      return value;
    },
  });

  return (
    <Box display="grid" gap="md">
      <AccountingStatus locale={locale} pending={page.isPending} error={page.error} />
      {page.isError ? (
        <Button variant="outline" onClick={() => void page.refetch()}>
          {locale === "sv" ? "Försök igen" : "Retry"}
        </Button>
      ) : null}
      {page.data && !page.isError ? (
        <>
          {page.data.items.map((review) => (
            <Link
              key={review.id}
              href={`${workspacePath(book)}/books?view=assets&record=${encodeURIComponent(id)}&assetAction=disposal&assetReview=${encodeURIComponent(review.id)}`}
            >
              {locale === "sv" ? "Avyttra" : "Dispose"} {schedule.current.terms.name},{" "}
              {review.input.postingDate}
            </Link>
          ))}
          {page.data.next ? (
            <Button variant="outline" onClick={() => setAfter(page.data?.next ?? undefined)}>
              {locale === "sv" ? "Visa fler" : "Show more"}
            </Button>
          ) : null}
          {after ? (
            <Button variant="ghost" onClick={() => setAfter(undefined)}>
              {locale === "sv" ? "Tillbaka" : "Back"}
            </Button>
          ) : null}
        </>
      ) : null}
    </Box>
  );
}
