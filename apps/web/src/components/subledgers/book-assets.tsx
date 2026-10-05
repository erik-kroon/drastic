import { useNavigate } from "@tanstack/react-router";
import { useBookWorkspace, workspacePath } from "@/lib/book-context";
import { PageContent } from "@open-erp/ui/components/accounting-page";
import { WorkspaceHeader } from "@open-erp/ui/components/workspace";
import { AssetWorkspace } from "./workspace";
import { AssetValuationWorkspace } from "./valuation-workspace";
import { AssetActionWorkspace } from "./action-workspace";

export function BookAssets(props: {
  recordId?: string;
  action?: "disposal" | "reversal";
  reviewId?: string;
  plan?: boolean;
}) {
  const { book, locale } = useBookWorkspace();
  const navigate = useNavigate();

  if (props.action === "reversal")
    return (
      <AssetValuationWorkspace
        scheduleId={props.recordId}
        reviewId={props.reviewId}
        plan={props.plan}
      />
    );

  if (props.action)
    return (
      <AssetActionWorkspace
        action={props.action}
        scheduleId={props.recordId}
        reviewId={props.reviewId}
      />
    );

  return (
    <>
      <WorkspaceHeader title={locale === "sv" ? "Tillgångar" : "Assets"} />
      <PageContent>
        <AssetWorkspace
          recordId={props.recordId}
          onOpen={(id) =>
            void navigate({
              to: `${workspacePath(book)}/books`,
              search: { view: "assets", record: id },
            })
          }
        />
      </PageContent>
    </>
  );
}
