import { useQuery } from "@tanstack/react-query";
import { BookOpen, Upload, FileText, ReceiptText, CalendarCheck } from "lucide-react";
import {
  PageContent,
  WorkspaceWelcome,
  TaskColumns,
  TaskSection,
  TaskRow,
  PageEmpty,
  PageAction,
  PageCaption,
} from "@open-erp/ui/components/accounting-page";
import { WorkspaceHeader } from "@open-erp/ui/components/workspace";
import { AccountingStatus } from "@/components/accounting-status";
import { useBookWorkspace, workspacePath } from "@/lib/book-context";
import { formatMinorAmount } from "@/lib/workspace-api";
import { attentionQueryOptions, attentionPath, attentionCopy } from "@/lib/attention";
import { frontendCopy } from "@/lib/frontend-copy";

export function WorkHome() {
  const { book, locale } = useBookWorkspace();
  const sv = locale === "sv";
  const copy = frontendCopy(locale);
  const tasks = attentionCopy(locale);
  const base = workspacePath(book);
  const work = useQuery(attentionQueryOptions(book, { status: "open" }));
  const page = work.isError ? undefined : work.data;
  return (
    <>
      <WorkspaceHeader
        title={copy.todo}
        action={
          <PageAction href={`${base}/purchases?view=documents&record=new`}>
            <Upload size={14} strokeWidth={1.5} />
            {sv ? "Ladda upp underlag" : "Upload document"}
          </PageAction>
        }
      />
      <PageContent>
        <WorkspaceWelcome
          title={sv ? "Vad behöver göras?" : "Your work, in one place"}
          context={book.name}
        />
        <TaskColumns>
          <TaskSection
            title={sv ? "Behöver din uppmärksamhet" : "Needs your attention"}
            action={
              <PageAction quiet href={`${base}/work?status=open`}>
                {copy.viewAll}
                {page ? ` (${page.counts.open})` : ""}
              </PageAction>
            }
          >
            <AccountingStatus locale={locale} pending={work.isPending} error={work.error} />
            {page?.items.slice(0, 6).map((item) => (
              <TaskRow
                key={item.key}
                href={attentionPath(book, item)}
                icon={
                  item.kind === "invoice" ? (
                    <FileText size={15} strokeWidth={1.5} />
                  ) : item.kind === "expense" ? (
                    <ReceiptText size={15} strokeWidth={1.5} />
                  ) : (
                    <BookOpen size={15} strokeWidth={1.5} />
                  )
                }
                title={item.title}
                detail={tasks[item.reason]}
                value={
                  item.amountMinor !== null && item.currencyScale !== null
                    ? `${formatMinorAmount(item.amountMinor, item.currencyScale, locale)} ${item.currency ?? ""}`
                    : "—"
                }
              />
            ))}
            {page?.items.length === 0 ? (
              <PageEmpty title={tasks.empty} detail={tasks.emptyDetail} />
            ) : null}
            <PageCaption>{tasks.coverage}</PageCaption>
            {page ? (
              <PageCaption>
                {tasks.updated}{" "}
                {new Intl.DateTimeFormat(locale, {
                  dateStyle: "medium",
                  timeStyle: "short",
                }).format(new Date(page.checkedAt))}
              </PageCaption>
            ) : null}
          </TaskSection>
          <TaskSection title={sv ? "Nästa steg" : "Start something"}>
            <TaskRow
              href={`${base}/sales?view=drafts&record=new`}
              icon={<FileText size={15} strokeWidth={1.5} />}
              title={sv ? "Skapa en faktura" : "Create an invoice"}
              detail={
                sv
                  ? "Välj kund och lägg till dina fakturarader."
                  : "Choose a customer and add your line items."
              }
            />
            <TaskRow
              href={`${base}/purchases?view=expenses&record=new`}
              icon={<ReceiptText size={15} strokeWidth={1.5} />}
              title={sv ? "Lägg till en utgift" : "Add an expense"}
              detail={
                sv
                  ? "Börja med kvittot eller fakturan."
                  : "Start with a receipt or supplier document."
              }
            />
            <TaskRow
              href={`${base}/books?view=journal`}
              icon={<BookOpen size={15} strokeWidth={1.5} />}
              title={copy.newEntry}
              detail={
                sv ? "Förbered bokföring för granskning." : "Prepare accounting entries for review."
              }
            />
            <TaskRow
              href={`${base}/closing`}
              icon={<CalendarCheck size={15} strokeWidth={1.5} />}
              title={sv ? "Granska perioden" : "Review the period"}
              detail={
                sv
                  ? "Se avstämningar och återstående kontroller."
                  : "See reconciliations and outstanding checks."
              }
            />
          </TaskSection>
        </TaskColumns>
      </PageContent>
    </>
  );
}
