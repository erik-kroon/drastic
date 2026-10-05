import { useNavigate } from "@tanstack/react-router";
import * as Accounting from "@open-erp/contracts/accounting";
import { WorkQueueQuery, workReturnHref } from "@/lib/work-return";
import { useBookWorkspace, reviewPath, workspacePath } from "@/lib/book-context";
import { PostingRecoveryPanel } from "./panel";
import { SavedPostingRequestsPanel } from "./saved-requests";

export function WorkRecovery({ filters }: { filters: typeof WorkQueueQuery.Type }) {
  const { book, setup, locale } = useBookWorkspace();
  const navigate = useNavigate();

  const openProposal = (id: typeof Accounting.Identifier.Type) => {
    void navigate({ to: reviewPath(book, id), search: filters });
  };

  return (
    <>
      <SavedPostingRequestsPanel
        key={book.id}
        book={book}
        locale={locale}
        accounts={setup.accounts}
        onPrepared={openProposal}
        onEvidence={(_, requestKey) => {
          void navigate({
            to: `${workReturnHref(`${workspacePath(book)}/books`, "journal", filters)}&savedRequest=${encodeURIComponent(requestKey)}`,
          });
        }}
      />
      <PostingRecoveryPanel book={book} locale={locale} onPrepared={openProposal} />
    </>
  );
}
