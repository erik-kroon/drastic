import { useQuery } from "@tanstack/react-query";
import type * as Accounting from "@open-erp/contracts/accounting";
import * as Corrections from "@open-erp/contracts/corrections";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { Link } from "@open-erp/ui/components/link";
import { AccountingStatus } from "@/components/accounting-status";
import { WorkReturnAction } from "@/components/work-return-action";
import { bookKey, bookPath, readAccounting } from "@/lib/accounting-api";
import { workspacePath } from "@/lib/book-context";
import { useWorkReturn } from "@/lib/work-return";
import type { Locale } from "@/paraglide/runtime";
import { workQueryOptions } from "@/lib/workspace-api";
import { BlockedImpactWorkspace } from "./blocked-impact-workspace";
import { correctionCopy } from "./copy";
import { CorrectionImpactDetails } from "./impact-review";

export function BlockedCorrectionImpactReview(props: {
  book: typeof Accounting.Book.Type;
  locale: Locale;
  setup: typeof Accounting.BookSetup.Type;
  id: string;
}) {
  const { book, id, locale } = props;
  const copy = correctionCopy(locale);
  const work = useWorkReturn();
  const metadata = useQuery(workQueryOptions(book, {}));

  const view = useQuery({
    queryKey: [...bookKey(book), "correction-impact", id],
    queryFn: async ({ signal }) => {
      const result = await readAccounting(
        `${bookPath(book)}/correction-impact-reviews/${encodeURIComponent(id)}`,
        Corrections.CorrectionImpactView,
        { signal },
      );

      if (
        result.impact.id !== id ||
        result.impact.scope.entityId !== book.entityId ||
        result.impact.scope.bookId !== book.id
      )
        throw new Error("Correction impact scope mismatch");

      if (
        result.impact.basis.chain.selectedVoucherId !== result.impact.voucherId ||
        !result.impact.basis.chain.vouchers.some(
          (voucher) => voucher.id === result.impact.voucherId,
        )
      )
        throw new Error("Correction original is missing from the retained chain");

      return result;
    },
    retry: false,
  });

  const current = view.isError ? undefined : view.data;

  if (!current)
    return (
      <Box display="grid" gap="lg">
        <AccountingStatus locale={locale} pending={view.isPending} error={view.error} />
        <Button
          variant="outline"
          disabled={view.isFetching}
          onClick={() => {
            void view.refetch();
          }}
        >
          {copy.refresh}
        </Button>
      </Box>
    );

  return (
    <BlockedImpactWorkspace
      impact={current}
      setup={props.setup}
      locale={locale}
      scale={metadata.isSuccess ? metadata.data.currencyScale : undefined}
      breadcrumb={
        <>
          <Link href={`${workspacePath(book)}/books`}>
            {locale === "sv" ? "Bokföring" : "Bookkeeping"}
          </Link>
          <span aria-hidden="true">›</span>
          <span>{copy.impact}</span>
          <WorkReturnAction work={work} />
        </>
      }
      actions={
        <>
          {(current.currentBasis ?? current.impact.basis).blockers.some(
            (blocker) => blocker.code === "PeriodLocked",
          ) ? (
            <Link href={`${workspacePath(book)}/closing`}>
              {locale === "sv" ? "Öppna periodens arbetsflöde" : "Open the period workflow"}
            </Link>
          ) : null}
          <Button
            variant="outline"
            disabled={view.isFetching}
            onClick={() => {
              void view.refetch();
            }}
          >
            {copy.refresh}
          </Button>
        </>
      }
      details={
        <details>
          <summary>{locale === "sv" ? "Underlag och följder" : "Evidence and impacts"}</summary>
          <CorrectionImpactDetails book={book} impact={current.impact} locale={locale} />
        </details>
      }
    />
  );
}
