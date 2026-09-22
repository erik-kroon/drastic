import { useQuery } from "@tanstack/react-query";
import { FileCheck2, BookOpen, CheckSquare, Plus } from "lucide-react";
import {
  PageContent,
  WorkspaceWelcome,
  TaskColumns,
  TaskSection,
  TaskBand,
  TaskRow,
  PageEmpty,
  PageAction,
  PageCaption,
} from "@open-erp/ui/components/accounting-page";
import { WorkspaceHeader } from "@open-erp/ui/components/workspace";
import { AccountingStatus } from "@/components/accounting-status";
import { useBookWorkspace, workspacePath, reviewPath } from "@/lib/book-context";
import { workQueryOptions, formatMinorAmount } from "@/lib/workspace-api";
import { frontendCopy } from "@/lib/frontend-copy";

export function WorkHome() {
  const { book, locale } = useBookWorkspace();
  const copy = frontendCopy(locale);
  const base = workspacePath(book);
  const work = useQuery(workQueryOptions(book, { status: "all" }));
  const page = work.isError ? undefined : work.data;
  const open = page?.items.filter((item) => item.state === "unposted") ?? [];
  const recent = page?.items.filter((item) => item.state !== "unposted").slice(0, 3) ?? [];
  return (
    <>
      <WorkspaceHeader
        title={copy.todo}
        action={
          <PageAction href={`${base}/books?view=journal`}>
            <Plus size={14} aria-hidden="true" />
            {copy.newEntry}
          </PageAction>
        }
      />
      <PageContent>
        <WorkspaceWelcome
          title={copy.welcome}
          context={`${book.name}${page ? ` · ${new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(new Date(page.checkedAt))}` : ""}`}
        />
        <AccountingStatus locale={locale} pending={work.isPending} error={work.error} />
        {page ? (
          <TaskColumns>
            <TaskSection
              title={copy.todo}
              action={
                <PageAction quiet href={`${base}/work`}>
                  {copy.viewAll}
                </PageAction>
              }
            >
              <TaskBand>{copy.review}</TaskBand>
              {page.counts.open !== "0" ? (
                <TaskRow
                  href={`${base}/work?status=open`}
                  icon={<CheckSquare size={15} strokeWidth={1.5} aria-hidden="true" />}
                  title={copy.journalTasks}
                  detail={copy.journalDetail}
                  value={page.counts.open}
                />
              ) : (
                <PageEmpty title={copy.emptyTitle} detail={copy.emptyDetail} />
              )}
              <PageCaption>{copy.coverage}</PageCaption>
            </TaskSection>
            <TaskSection title={copy.continueWork}>
              {open.length ? (
                <>
                  {open.slice(0, 3).map((item) => (
                    <TaskRow
                      key={item.id}
                      href={reviewPath(book, item.id, item.revision)}
                      icon={<BookOpen size={15} strokeWidth={1.5} aria-hidden="true" />}
                      title={item.description}
                      detail={item.postingDate}
                      value={`${formatMinorAmount(item.amountMinor, page.currencyScale, locale)} ${book.currency}`}
                    />
                  ))}
                </>
              ) : (
                <TaskRow
                  href={`${base}/books?view=journal`}
                  icon={<Plus size={15} strokeWidth={1.5} aria-hidden="true" />}
                  title={copy.ready}
                  detail={copy.readyDetail}
                />
              )}
              {recent.length ? <TaskBand>{copy.recent}</TaskBand> : null}
              {recent.map((item) => (
                <TaskRow
                  key={item.id}
                  href={reviewPath(book, item.id, item.revision)}
                  icon={<FileCheck2 size={15} strokeWidth={1.5} aria-hidden="true" />}
                  title={item.description}
                  detail={item.postingDate}
                  value={`${formatMinorAmount(item.amountMinor, page.currencyScale, locale)} ${book.currency}`}
                />
              ))}
            </TaskSection>
          </TaskColumns>
        ) : null}
      </PageContent>
    </>
  );
}
