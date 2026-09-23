import { useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import * as Schema from "effect/Schema";
import * as Reports from "@open-erp/contracts/reports";
import { ArrowLeft, BookOpen, FileSpreadsheet, FileText, ListChecks } from "lucide-react";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { InputField } from "@open-erp/ui/components/field";
import { RecordHeading, RecordSection } from "@open-erp/ui/components/record-layout";
import { TaskSection, TaskRow, PageCaption } from "@open-erp/ui/components/accounting-page";
import { AccountingStatus } from "@/components/accounting-status";
import { TrialBalance } from "@/components/trial-balance";
import { useBookWorkspace, workspacePath } from "@/lib/book-context";
import { bookPath, mutationOptions, readAccounting } from "@/lib/accounting-api";

export function ReportLibrary() {
  const { book, locale } = useBookWorkspace();
  const sv = locale === "sv";
  const labels = sv ? swedish : english;
  const base = `${workspacePath(book)}/reports`;
  return (
    <Box display="grid" gap="xl">
      <RecordHeading title={labels.reports} subtitle={labels.fromTheNumbersToThe} />
      <TaskSection title={labels.accounting}>
        <TaskRow
          href={`${base}?view=trial`}
          icon={<FileSpreadsheet size={16} strokeWidth={1.5} />}
          title={labels.trialBalance}
          detail={labels.openingBalancesPeriodMovementsAnd}
        />
        <TaskRow
          href={`${base}?view=ledger`}
          icon={<BookOpen size={16} strokeWidth={1.5} />}
          title={labels.generalLedger}
          detail={labels.currentDebitsCreditsAndBalances}
        />
      </TaskSection>
      <TaskSection title={labels.reconciliationHandoff}>
        <TaskRow
          href={`${base}?view=register`}
          icon={<ListChecks size={16} strokeWidth={1.5} />}
          title={labels.invoiceRegisterReport}
          detail={labels.outstandingInvoicesAndTheirControl}
        />
        <TaskRow
          href={`${base}?view=export`}
          icon={<FileText size={16} strokeWidth={1.5} />}
          title={labels.accountantReviewPack}
          detail={labels.collectReportsSourceRecordsAnd}
        />
      </TaskSection>
      <PageCaption>{labels.reportsCoverRecordedMaterialThey}</PageCaption>
    </Box>
  );
}
export function TrialBalanceWorkspace({
  recordId,
  onOpen,
}: {
  recordId?: string;
  onOpen: (id: string) => void;
}) {
  const { book, setup, locale } = useBookWorkspace();
  const sv = locale === "sv";
  const labels = sv ? swedish : english;
  const keys = useRef(new Map<string, string>());
  const period = setup.periods.at(-1);
  const prepare = useMutation({
    mutationFn: (input: typeof Reports.PrepareReport.Type) => {
      const path = `${bookPath(book)}/report-snapshots`;
      return readAccounting(
        path,
        Reports.ReportSnapshot,
        mutationOptions(path, JSON.stringify(input), keys.current),
      );
    },
    onSuccess: (report) => onOpen(report.id),
  });
  if (recordId)
    return (
      <Box display="grid" gap="xl">
        <Box>
          <Button variant="ghost" onClick={() => onOpen("")}>
            <ArrowLeft size={14} />
            {labels.choosePeriod}
          </Button>
        </Box>
        <TrialBalance book={book} locale={locale} id={recordId} />
      </Box>
    );
  return (
    <Box display="grid" gap="xl">
      <RecordHeading title={labels.trialBalance} subtitle={labels.createASavedReportFor} />
      <RecordSection title={labels.reportPeriod}>
        <Box
          as="form"
          display="grid"
          gap="lg"
          maxWidth="content"
          onSubmit={(event) => {
            event.preventDefault();
            const fields = new FormData(event.currentTarget);
            prepare.mutate(
              Schema.decodeUnknownSync(Reports.PrepareReport)({
                kind: "trial_balance_v1",
                startsOn: fields.get("start"),
                endsOn: fields.get("end"),
              }),
            );
          }}
        >
          <Box display="grid" columns={2} gap="lg">
            <InputField
              name="start"
              label={labels.from}
              type="date"
              required
              defaultValue={period?.startsOn}
            />
            <InputField
              name="end"
              label={labels.to}
              type="date"
              required
              defaultValue={period?.endsOn}
            />
          </Box>
          <Box>
            <Button type="submit" disabled={prepare.isPending}>
              {labels.generateReport}
            </Button>
          </Box>
          <AccountingStatus locale={locale} pending={prepare.isPending} error={prepare.error} />
        </Box>
      </RecordSection>
    </Box>
  );
}

const english = {
  reports: "Reports",
  fromTheNumbersToThe: "From the numbers to the entries and sources behind them.",
  accounting: "Accounting",
  trialBalance: "Trial balance",
  openingBalancesPeriodMovementsAnd:
    "Opening balances, period movements and closing balances by account.",
  generalLedger: "General ledger",
  currentDebitsCreditsAndBalances: "Current debits, credits and balances in your books.",
  reconciliationHandoff: "Reconciliation & handoff",
  invoiceRegisterReport: "Invoice register report",
  outstandingInvoicesAndTheirControl: "Outstanding invoices and their control-account comparison.",
  accountantReviewPack: "Accountant review pack",
  collectReportsSourceRecordsAnd: "Collect reports, source records and notes for review.",
  reportsCoverRecordedMaterialThey:
    "Reports cover recorded material. They do not establish that every source has been received.",
  choosePeriod: "Choose period",
  createASavedReportFor: "Create a saved report for the period you want to review.",
  reportPeriod: "Report period",
  from: "From",
  to: "To",
  generateReport: "Generate report",
};
const swedish: typeof english = {
  reports: "Rapporter",
  fromTheNumbersToThe: "Från sammanställning till verifikat och originalunderlag.",
  accounting: "Bokföring",
  trialBalance: "Saldobalans",
  openingBalancesPeriodMovementsAnd:
    "Ingående saldo, periodens rörelser och utgående saldo per konto.",
  generalLedger: "Huvudbok",
  currentDebitsCreditsAndBalances: "Aktuella debet-, kredit- och saldobelopp i bokföringen.",
  reconciliationHandoff: "Avstämning & överlämning",
  invoiceRegisterReport: "Fakturaregister",
  outstandingInvoicesAndTheirControl: "Utestående fakturor och jämförelse med bokföringen.",
  accountantReviewPack: "Granskningspaket",
  collectReportsSourceRecordsAnd: "Samla rapporter, underlag och anteckningar för granskning.",
  reportsCoverRecordedMaterialThey:
    "Rapporterna bygger på registrerat material. De fastställer inte att allt underlag är komplett.",
  choosePeriod: "Välj period",
  createASavedReportFor: "Skapa en sparad rapport för perioden du vill granska.",
  reportPeriod: "Rapportperiod",
  from: "Från",
  to: "Till",
  generateReport: "Visa rapport",
};
