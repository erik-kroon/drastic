import { createFileRoute, useNavigate } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import { Plus } from "lucide-react";
import { Box } from "@open-erp/ui/components/box";
import { Text } from "@open-erp/ui/components/typography";
import { WorkspaceHeader } from "@open-erp/ui/components/workspace";
import { FormDialog } from "@open-erp/ui/components/form-dialog";
import { RecordSheet } from "@open-erp/ui/components/record-sheet";
import { PageAction, PageContent } from "@open-erp/ui/components/accounting-page";
import { PageTabs, PageTab } from "@open-erp/ui/components/workflow";
import { useBookWorkspace, workspacePath, reviewPath } from "@/lib/book-context";
import { PostingDraft } from "@/components/posting-recovery/draft";
import { PostedRecords, PostedRecord } from "@/components/posted-records";
import { ChartOfAccounts } from "@/components/account-register";
import { frontendCopy } from "@/lib/frontend-copy";

const search = Schema.Struct({
  view: Schema.optional(Schema.Literals(["journal", "vouchers", "accounts"])),
  record: Schema.optional(Schema.String),
});
export const Route = createFileRoute("/entities/$entityId/books/$bookId/books")({
  validateSearch: Schema.decodeUnknownSync(search),
  component: Books,
});
function Books() {
  const { book, setup, locale } = useBookWorkspace();
  const { view = "vouchers", record } = Route.useSearch();
  const navigate = useNavigate();
  const copy = frontendCopy(locale);
  const base = `${workspacePath(book)}/books`;
  const onPrepared = (id: string) => {
    void navigate({ to: reviewPath(book, id) });
  };
  return (
    <>
      <WorkspaceHeader
        title={copy.bookkeeping}
        action={
          <PageAction href={`${base}?view=journal`}>
            <Plus size={14} aria-hidden="true" />
            {copy.newEntry}
          </PageAction>
        }
      />
      <PageContent>
        <PageTabs label={copy.bookkeeping}>
          <PageTab href={base} active={view !== "accounts"}>
            {copy.vouchers}
          </PageTab>
          <PageTab href={`${base}?view=accounts`} active={view === "accounts"}>
            {copy.chart}
          </PageTab>
        </PageTabs>
        {view !== "accounts" ? (
          <PostedRecords book={book} locale={locale} setup={setup} onPrepared={onPrepared} />
        ) : null}
        {view === "accounts" ? <ChartOfAccounts /> : null}
        {record && view === "vouchers" ? (
          <RecordSheet
            title={copy.voucher}
            closeLabel={copy.returnVouchers}
            onClose={() =>
              void navigate({ to: base, search: { view: "vouchers" }, resetScroll: false })
            }
          >
            <PostedRecord
              book={book}
              locale={locale}
              setup={setup}
              id={record}
              onPrepared={onPrepared}
            />
          </RecordSheet>
        ) : null}
        {view === "journal" ? (
          <FormDialog
            title={copy.newEntry}
            closeLabel={copy.returnVouchers}
            onClose={() => {
              void navigate({ to: base, search: { view: "vouchers" } });
            }}
          >
            <Box display="grid" gap="lg" minWidth="zero">
              {setup.blockers.map((blocker) => (
                <Text key={blocker} role="alert">
                  {blocker}
                </Text>
              ))}
              {setup.blockers.length === 0 ? (
                <PostingDraft book={book} setup={setup} locale={locale} onPrepared={onPrepared} />
              ) : null}
            </Box>
          </FormDialog>
        ) : null}
      </PageContent>
    </>
  );
}
