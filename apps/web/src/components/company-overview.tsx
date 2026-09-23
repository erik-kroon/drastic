import { useQuery } from "@tanstack/react-query";
import { FileText, Upload, BookOpen, CalendarCheck, ArrowRight } from "lucide-react";
import { Box } from "@open-erp/ui/components/box";
import { WorkspaceHeader } from "@open-erp/ui/components/workspace";
import {
  PageContent,
  WorkspaceWelcome,
  TaskColumns,
  TaskSection,
  TaskRow,
  PageAction,
  PageEmpty,
  PageCaption,
} from "@open-erp/ui/components/accounting-page";
import { RecordSummary, RecordFact } from "@open-erp/ui/components/record-layout";
import { AccountBalances } from "@/components/account-register";
import { AccountingStatus } from "@/components/accounting-status";
import { useBookWorkspace, workspacePath } from "@/lib/book-context";
import { formatMinorAmount } from "@/lib/workspace-api";
import { attentionQueryOptions, attentionPath, attentionCopy } from "@/lib/attention";

export function CompanyOverview() {
  const { book, setup, locale } = useBookWorkspace();
  const sv = locale === "sv";
  const labels = sv ? swedish : english;
  const base = workspacePath(book);
  const work = useQuery(attentionQueryOptions(book, { status: "open" }));
  const drafts = useQuery(attentionQueryOptions(book, { status: "open", kind: "invoice" }));
  return (
    <>
      <WorkspaceHeader
        title={labels.overview}
        action={
          <PageAction href={`${base}/purchases?view=documents&record=new`}>
            <Upload size={14} />
            {labels.uploadDocument}
          </PageAction>
        }
      />
      <PageContent>
        <WorkspaceWelcome title={book.name} context={labels.decisionsWorkInProgressAnd} />
        <RecordSummary>
          <RecordFact label={labels.awaitingReview}>
            {work.isSuccess ? work.data.counts.open : "—"}
          </RecordFact>
          <RecordFact label={labels.invoiceDrafts}>
            {drafts.isSuccess ? drafts.data.total : "—"}
          </RecordFact>
          <RecordFact label={labels.openPeriods}>
            {setup.periods.filter((period) => !period.locked).length}
          </RecordFact>
        </RecordSummary>
        <TaskColumns>
          <TaskSection
            title={labels.needsYourAttention}
            action={
              <PageAction quiet href={`${base}/work`}>
                {labels.viewAll}
                <ArrowRight size={12} />
              </PageAction>
            }
          >
            <AccountingStatus locale={locale} pending={work.isPending} error={work.error} />
            {work.isSuccess && !work.data.items.length ? (
              <PageEmpty
                title={labels.noJournalsWaitingForReview}
                detail={labels.preparedAccountingProposalsWillAppear}
              />
            ) : null}
            {work.data?.items.slice(0, 5).map((item) => (
              <TaskRow
                key={item.id}
                href={attentionPath(book, item)}
                icon={<BookOpen size={15} strokeWidth={1.5} />}
                title={item.title}
                detail={attentionCopy(locale)[item.reason]}
                value={
                  item.amountMinor !== null && item.currencyScale !== null
                    ? `${formatMinorAmount(item.amountMinor, item.currencyScale, locale)} ${item.currency ?? ""}`
                    : "—"
                }
              />
            ))}
            <PageCaption>{labels.theWorkQueueCoversJournal}</PageCaption>
          </TaskSection>
          <TaskSection title={labels.continueWorking}>
            <AccountingStatus locale={locale} pending={drafts.isPending} error={drafts.error} />
            {drafts.data?.items.slice(0, 3).map((draft) => (
              <TaskRow
                key={draft.id}
                href={`${base}/sales?view=drafts&record=${encodeURIComponent(draft.id)}`}
                icon={<FileText size={15} strokeWidth={1.5} />}
                title={draft.title}
                detail={attentionCopy(locale)[draft.reason]}
                value={labels.draft}
              />
            ))}
            <TaskRow
              href={`${base}/sales?view=drafts&record=new`}
              icon={<FileText size={15} strokeWidth={1.5} />}
              title={labels.prepareAnInvoice}
              detail={labels.chooseACustomerAndAdd}
            />
            <TaskRow
              href={`${base}/closing`}
              icon={<CalendarCheck size={15} strokeWidth={1.5} />}
              title={labels.reviewPeriodReadiness}
              detail={labels.checksAndOutstandingWorkBefore}
            />
          </TaskSection>
        </TaskColumns>
        <TaskSection
          title={labels.balancesInYourBooks}
          action={
            <PageAction quiet href={`${base}/reports`}>
              {labels.viewReports}
            </PageAction>
          }
        >
          <Box paddingBlock="lg">
            <AccountBalances />
          </Box>
        </TaskSection>
      </PageContent>
    </>
  );
}

const english = {
  overview: "Overview",
  uploadDocument: "Upload document",
  decisionsWorkInProgressAnd: "Decisions, work in progress and your books.",
  awaitingReview: "Open work",
  invoiceDrafts: "Invoice drafts",
  openPeriods: "Open periods",
  needsYourAttention: "Needs your attention",
  viewAll: "View all",
  noJournalsWaitingForReview: "No open work in this view",
  preparedAccountingProposalsWillAppear:
    "Invoice drafts, expenses and accounting proposals appear here.",
  theWorkQueueCoversJournal: "Covers journal proposals, invoice drafts and expense reviews.",
  continueWorking: "Continue working",
  draft: "Draft",
  prepareAnInvoice: "Prepare an invoice",
  chooseACustomerAndAdd: "Choose a customer and add line items.",
  reviewPeriodReadiness: "Review period readiness",
  checksAndOutstandingWorkBefore: "Checks and outstanding work before locking.",
  balancesInYourBooks: "Balances in your books",
  viewReports: "View reports",
};
const swedish: typeof english = {
  overview: "Översikt",
  uploadDocument: "Ladda upp dokument",
  decisionsWorkInProgressAnd: "Beslut, pågående arbete och bokföring.",
  awaitingReview: "Att granska",
  invoiceDrafts: "Fakturautkast",
  openPeriods: "Öppna perioder",
  needsYourAttention: "Behöver din uppmärksamhet",
  viewAll: "Visa alla",
  noJournalsWaitingForReview: "Inget öppet arbete i den här vyn",
  preparedAccountingProposalsWillAppear: "Fakturautkast, utgifter och bokföringsförslag visas här.",
  theWorkQueueCoversJournal: "Omfattar bokföringsförslag, fakturautkast och utgiftsgranskningar.",
  continueWorking: "Fortsätt arbeta",
  draft: "Utkast",
  prepareAnInvoice: "Förbered en faktura",
  chooseACustomerAndAdd: "Välj kund och lägg till fakturarader.",
  reviewPeriodReadiness: "Granska perioden",
  checksAndOutstandingWorkBefore: "Kontroller och återstående arbete före låsning.",
  balancesInYourBooks: "Bokförda saldon",
  viewReports: "Visa rapporter",
};
