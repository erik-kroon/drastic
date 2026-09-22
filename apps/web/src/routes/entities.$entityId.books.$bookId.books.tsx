import { createFileRoute, useNavigate } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import { Box } from "@open-erp/ui/components/box";
import { PageTab, PageTabs } from "@open-erp/ui/components/workflow";
import { Heading, Text } from "@open-erp/ui/components/typography";
import { WorkspaceHeader } from "@open-erp/ui/components/workspace";
import { useBookWorkspace, workspacePath, reviewPath } from "@/lib/book-context";
import { PostingDraft } from "@/components/posting-recovery/draft";
import { PostedRecords } from "@/components/posted-records";
import { accountingCopy } from "@/lib/accounting-copy";

const search = Schema.Struct({ view: Schema.optional(Schema.Literals(["journal", "vouchers"])) });
export const Route = createFileRoute("/entities/$entityId/books/$bookId/books")({
  validateSearch: Schema.decodeUnknownSync(search),
  component: Books,
});

function Books() {
  const { book, setup, locale } = useBookWorkspace();
  const { view = "journal" } = Route.useSearch();
  const navigate = useNavigate();
  const copy = accountingCopy(locale);
  const base = `${workspacePath(book)}/books`;
  const onPrepared = (id: string) => {
    void navigate({ to: reviewPath(book, id) });
  };
  return (
    <Box display="grid" gap="xl" minWidth="zero">
      <WorkspaceHeader>
        <Heading level={1}>
          {view === "journal" ? copy.workspace_new_journal : copy.workspace_vouchers}
        </Heading>
        <Text tone="muted">
          {view === "journal" ? copy.workspace_journal_intro : copy.workspace_voucher_intro}
        </Text>
      </WorkspaceHeader>
      <PageTabs label={copy.workspace_books}>
        <PageTab href={base} active={view === "journal"}>
          {copy.workspace_new_journal}
        </PageTab>
        <PageTab href={`${base}?view=vouchers`} active={view === "vouchers"}>
          {copy.workspace_vouchers}
        </PageTab>
      </PageTabs>
      {view === "vouchers" ? (
        <PostedRecords book={book} locale={locale} setup={setup} onPrepared={onPrepared} />
      ) : (
        <>
          {setup.blockers.map((blocker) => (
            <Text key={blocker} role="alert">
              {blocker}
            </Text>
          ))}
          {setup.blockers.length === 0 ? (
            <PostingDraft book={book} setup={setup} locale={locale} onPrepared={onPrepared} />
          ) : null}
        </>
      )}
    </Box>
  );
}
