import { ArrowLeft } from "lucide-react";
import { PageAction } from "@open-erp/ui/components/accounting-page";
import { useBookWorkspace, workspacePath } from "@/lib/book-context";
import { accountingCopy } from "@/lib/accounting-copy";
import { workQueueHref, ownerReturnHref, useOwnerReturn, type WorkReturn } from "@/lib/work-return";

export function WorkReturnAction(props: { work: WorkReturn | undefined }) {
  const { book, locale } = useBookWorkspace();

  const owner = useOwnerReturn();

  if (!props.work && !owner) return null;

  return (
    <PageAction
      quiet
      href={
        owner
          ? ownerReturnHref(workspacePath(book), owner)
          : workQueueHref(workspacePath(book), props.work)
      }
    >
      <ArrowLeft size={14} aria-hidden="true" />
      {accountingCopy(locale).workspace_back}
    </PageAction>
  );
}
