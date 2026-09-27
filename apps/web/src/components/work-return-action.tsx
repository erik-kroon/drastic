import { ArrowLeft } from "lucide-react";
import { PageAction } from "@open-erp/ui/components/accounting-page";
import { useBookWorkspace, workspacePath } from "@/lib/book-context";
import { accountingCopy } from "@/lib/accounting-copy";
import { workQueueHref, type WorkReturn } from "@/lib/work-return";

// The way back to the work queue a record was opened from. It renders nothing
// when the page was not reached through the queue, so a direct link to a record
// does not grow a return target that leads nowhere.
export function WorkReturnAction(props: { work: WorkReturn | undefined }) {
  const { book, locale } = useBookWorkspace();

  if (!props.work) return null;

  return (
    <PageAction quiet href={workQueueHref(workspacePath(book), props.work)}>
      <ArrowLeft size={14} aria-hidden="true" />
      {accountingCopy(locale).workspace_back}
    </PageAction>
  );
}
