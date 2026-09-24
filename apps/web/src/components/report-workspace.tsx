import { useRef, useState } from "react";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import * as Schema from "effect/Schema";
import * as Reports from "@open-erp/contracts/reports";
import {
  ArrowLeft,
  BookOpen,
  FileSpreadsheet,
  FileText,
  ListChecks,
  Calculator,
  ArrowLeftRight,
} from "lucide-react";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { FormDialog } from "@open-erp/ui/components/form-dialog";
import { DataTable } from "@open-erp/ui/components/data-table";
import { RecordOpen } from "@open-erp/ui/components/accounting-page";
import { InputField } from "@open-erp/ui/components/field";
import { RecordHeading, RecordSection } from "@open-erp/ui/components/record-layout";
import {
  TaskSection,
  TaskRow,
  PageCaption,
  PageEmpty,
  RegisterSearch,
} from "@open-erp/ui/components/accounting-page";
import { AccountingStatus } from "@/components/accounting-status";
import { TrialBalance } from "@/components/trial-balance";
import { useBookWorkspace, workspacePath } from "@/lib/book-context";
import { bookKey, bookPath, mutationOptions, readAccounting } from "@/lib/accounting-api";

export function ReportLibrary() {
  const { book, locale } = useBookWorkspace();
  const sv = locale === "sv";
  const labels = sv ? swedish : english;
  const base = `${workspacePath(book)}/reports`;
  const [search, setSearch] = useState("");
  const sections = [
    {
      title: labels.accounting,
      items: [
        {
          view: "trial",
          title: labels.trialBalance,
          detail: labels.openingBalancesPeriodMovementsAnd,
          icon: FileSpreadsheet,
        },
        {
          view: "ledger",
          title: labels.generalLedger,
          detail: labels.currentDebitsCreditsAndBalances,
          icon: BookOpen,
        },
      ],
    },
    {
      title: labels.reconciliationHandoff,
      items: [
        {
          view: "register",
          title: labels.invoiceRegisterReport,
          detail: labels.outstandingInvoicesAndTheirControl,
          icon: ListChecks,
        },
        {
          view: "export",
          title: labels.accountantReviewPack,
          detail: labels.collectReportsSourceRecordsAnd,
          icon: FileText,
        },
      ],
    },
    {
      title: sv ? "Tillgångar och valuta" : "Assets and currencies",
      items: [
        {
          view: "subledgers",
          title: sv ? "Tillgångar och periodiseringar" : "Assets and deferrals",
          detail: sv
            ? "Planer, bokförda värden och avstämning mot huvudboken."
            : "Schedules, carrying values and comparison with the ledger.",
          icon: Calculator,
        },
        {
          view: "exchange-rates",
          title: sv ? "Valutakurser och omräkning" : "Exchange rates and conversions",
          detail: sv
            ? "Granskade kurser och sparade omräkningsunderlag."
            : "Reviewed rates and retained currency conversions.",
          icon: ArrowLeftRight,
        },
      ],
    },
  ]
    .map((section) => ({
      ...section,
      items: section.items.filter((item) =>
        `${item.title} ${item.detail}`
          .toLocaleLowerCase(locale)
          .includes(search.trim().toLocaleLowerCase(locale)),
      ),
    }))
    .filter((section) => section.items.length);
  return (
    <Box display="grid" gap="xl">
      <RecordHeading title={labels.reports} subtitle={labels.fromTheNumbersToThe} />
      <RegisterSearch
        aria-label={sv ? "Sök rapport" : "Search reports"}
        placeholder={sv ? "Sök rapport…" : "Search reports…"}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      {sections.map((section) => (
        <TaskSection key={section.title} title={section.title}>
          {section.items.map((item) => (
            <TaskRow
              key={item.view}
              href={`${base}?view=${item.view}`}
              icon={<item.icon size={16} strokeWidth={1.5} />}
              title={item.title}
              detail={item.detail}
            />
          ))}
        </TaskSection>
      ))}
      {!sections.length ? (
        <PageEmpty
          title={sv ? "Inga matchande rapporter" : "No matching reports"}
          detail={
            sv
              ? "Prova att söka på konto, faktura eller tillgång."
              : "Try searching for an account, invoice or asset."
          }
        />
      ) : null}
      <PageCaption>{labels.reportsCoverRecordedMaterialThey}</PageCaption>
    </Box>
  );
}
export function TrialBalanceWorkspace(props: {
  recordId?: string;
  onOpen: (id: string) => void;
  accountId?: string;
  onSelectAccount?: (id: string) => void;
  mode?: "trial" | "ledger";
}) {
  const { recordId, onOpen, accountId, onSelectAccount } = props;
  const { book, setup, locale } = useBookWorkspace();
  const sv = locale === "sv";
  const labels = sv ? swedish : english;
  const title = props.mode === "ledger" ? labels.generalLedger : labels.trialBalance;
  const keys = useRef(new Map<string, string>());
  const period = setup.periods.at(-1);
  const client = useQueryClient();
  const saved = useInfiniteQuery({
    queryKey: [...bookKey(book), "report-snapshots"],
    initialPageParam: "",
    queryFn: ({ signal, pageParam }) =>
      readAccounting(
        `${bookPath(book)}/report-snapshots${pageParam ? `?after=${encodeURIComponent(pageParam)}` : ""}`,
        Reports.ReportSnapshotPage,
        { signal },
      ),
    getNextPageParam: (page) => page.next ?? undefined,
    retry: false,
  });
  const prepare = useMutation({
    mutationFn: (input: typeof Reports.PrepareReport.Type) => {
      const path = `${bookPath(book)}/report-snapshots`;
      return readAccounting(
        path,
        Reports.ReportSnapshot,
        mutationOptions(path, JSON.stringify(input), keys.current),
      );
    },
    onSuccess: (report) => {
      void client.invalidateQueries({ queryKey: [...bookKey(book), "report-snapshots"] });
      onOpen(report.id);
    },
  });
  if (recordId && recordId !== "new")
    return (
      <Box display="grid" gap="xl">
        <Box>
          <Button variant="ghost" onClick={() => onOpen("")}>
            <ArrowLeft size={14} />
            {sv ? "Sparade rapporter" : "Saved reports"}
          </Button>
        </Box>
        <TrialBalance
          book={book}
          locale={locale}
          id={recordId}
          mode={props.mode}
          accountId={accountId}
          onSelectAccount={onSelectAccount}
        />
      </Box>
    );
  return (
    <Box display="grid" gap="xl">
      <RecordHeading
        title={title}
        subtitle={labels.createASavedReportFor}
        action={
          <Button
            onClick={() => {
              prepare.reset();
              keys.current.clear();
              onOpen("new");
            }}
          >
            {sv ? "Ny rapport" : "New report"}
          </Button>
        }
      />
      <AccountingStatus locale={locale} pending={saved.isPending} error={saved.error} />
      {saved.isSuccess ? (
        <DataTable
          title={title}
          columns={[
            { id: "period", label: labels.reportPeriod },
            { id: "created", label: sv ? "Sparad" : "Saved" },
            { id: "vouchers", label: sv ? "Verifikat" : "Vouchers", numeric: true },
            { id: "status", label: "Status" },
          ]}
          rows={saved.data.pages
            .flatMap((page) => page.items)
            .map((report) => ({
              id: report.id,
              cells: [
                <RecordOpen key="period" onClick={() => onOpen(report.id)}>
                  {report.startsOn} – {report.endsOn}
                </RecordOpen>,
                new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(
                  new Date(report.createdAt),
                ),
                report.voucherCount,
                report.balanced
                  ? sv
                    ? "Balanserad"
                    : "Balanced"
                  : sv
                    ? "Differens"
                    : "Difference",
              ],
            }))}
        />
      ) : null}
      {saved.isSuccess && !saved.data.pages[0]?.items.length ? (
        <PageEmpty
          title={sv ? "Inga sparade rapporter" : "No saved reports"}
          detail={labels.createASavedReportFor}
        />
      ) : null}
      {saved.hasNextPage ? (
        <Box>
          <Button
            variant="outline"
            disabled={saved.isFetchingNextPage}
            onClick={() => void saved.fetchNextPage()}
          >
            {sv ? "Läs in fler" : "Load more"}
          </Button>
        </Box>
      ) : null}
      {recordId === "new" ? (
        <FormDialog
          size="compact"
          title={labels.reportPeriod}
          closeLabel={sv ? "Stäng" : "Close"}
          onClose={() => onOpen("")}
        >
          <RecordSection title={title}>
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
        </FormDialog>
      ) : null}
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
  currentDebitsCreditsAndBalances:
    "Dated transactions and running balances for each account in a saved period.",
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
  currentDebitsCreditsAndBalances:
    "Daterade transaktioner och löpande saldo per konto i en sparad period.",
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
