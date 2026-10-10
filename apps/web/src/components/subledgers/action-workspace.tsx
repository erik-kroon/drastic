import { bookScope } from "@/lib/contract-client";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import * as Disposals from "@open-erp/contracts/asset-disposals";
import * as Subledgers from "@open-erp/contracts/subledgers";
import { Button } from "@open-erp/ui/components/button";
import { Box } from "@open-erp/ui/components/box";
import { AccountingStatus } from "@/components/accounting-status";
import { checkScope } from "@/components/commerce/shared";
import { bookKey, readAccounting } from "@/lib/accounting-api";
import { useBookWorkspace, workspacePath } from "@/lib/book-context";
import { AssetActionLayout } from "@open-erp/ui/components/asset-action";
import { AssetDisposalReview } from "./proceeds-review";

export function AssetActionWorkspace(props: {
  action: "disposal";
  scheduleId?: string;
  reviewId?: string;
}) {
  const { book, locale, setup } = useBookWorkspace();

  const navigate = useNavigate();

  const { scheduleId, reviewId } = props;

  const query = useQuery({
    queryKey: [...bookKey(book), "asset-action", props.action, scheduleId, reviewId],
    enabled: !!scheduleId && !!reviewId,
    retry: false,
    queryFn: async ({ signal }) => {
      if (!scheduleId || !reviewId) throw new Error("Asset and review are required");

      const [schedule, view] = await Promise.all([
        readAccounting(
          (client) =>
            client.subledgers.getSchedule({ params: { ...bookScope(book), id: scheduleId } }),
          Subledgers.ScheduleView,
          { signal },
        ),
        readAccounting(
          (client) =>
            client.assetDisposals.getAssetProceedsDisposal({
              params: { ...bookScope(book), id: reviewId },
            }),
          Disposals.View,
          { signal },
        ),
      ]);

      checkScope(book, schedule.current.scope);
      checkScope(book, view.review.scope);

      if (
        schedule.current.scheduleId !== scheduleId ||
        view.review.id !== reviewId ||
        view.review.assetBasis.schedule.scheduleId !== scheduleId
      )
        throw new Error("Asset action identity mismatch");

      return { schedule, view };
    },
  });

  const saved = query.isError ? undefined : query.data;

  const backHref = `${workspacePath(book)}/books?view=assets${scheduleId ? `&record=${encodeURIComponent(scheduleId)}` : ""}`;

  return (
    <AssetActionLayout
      title={saved ? `Avyttra ${saved.schedule.current.terms.name}, såld på faktura` : "Tillgångar"}
      synthetic={book.profile === "synthetic-core-v1"}
      assetName={saved?.schedule.current.terms.name ?? ""}
      backHref={backHref}
    >
      <AccountingStatus
        locale={locale}
        pending={query.isPending && query.fetchStatus !== "idle"}
        error={query.error}
      />
      {!scheduleId || !reviewId || query.isError ? (
        <Box>
          <Button
            variant="outline"
            onClick={() => void query.refetch()}
            disabled={!scheduleId || !reviewId}
          >
            {locale === "sv" ? "Försök igen" : "Retry"}
          </Button>
        </Box>
      ) : null}
      {saved ? (
        <AssetDisposalReview
          key={saved.view.review.id}
          book={book}
          setup={setup}
          locale={locale}
          schedule={saved.schedule}
          view={saved.view}
          backHref={backHref}
          onRefresh={() => void query.refetch()}
          onPrepared={(id) =>
            void navigate({
              to: `${workspacePath(book)}/books`,
              search: {
                view: "assets",
                record: scheduleId,
                assetAction: "disposal",
                assetReview: id,
              },
              resetScroll: false,
            })
          }
        />
      ) : null}
    </AssetActionLayout>
  );
}
