import { useRef, useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Schema from "effect/Schema";
import * as Reports from "@open-erp/contracts/reports";
import * as Accounting from "@open-erp/contracts/accounting";
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
import { InputField, TextareaField } from "@open-erp/ui/components/field";
import {
  RecordFact,
  RecordHeading,
  RecordSection,
  RecordSummary,
} from "@open-erp/ui/components/record-layout";
import { Text } from "@open-erp/ui/components/typography";
import {
  TaskSection,
  TaskRow,
  PageCaption,
  PageEmpty,
  RegisterSearch,
} from "@open-erp/ui/components/accounting-page";
import { AccountingStatus } from "@/components/accounting-status";
import { AccountExplanation, TrialBalance } from "@/components/trial-balance";
import { useBookWorkspace, workspacePath } from "@/lib/book-context";
import { bookKey, bookPath, mutationOptions, readAccounting } from "@/lib/accounting-api";
import { formatMinorAmount } from "@/lib/workspace-api";

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
      title: labels.financialStatements,
      items: [
        {
          view: "profit_and_loss",
          title: labels.profitAndLoss,
          detail: labels.syntheticMappedIncomeStatement,
          icon: FileSpreadsheet,
        },
        {
          view: "balance_sheet",
          title: labels.balanceSheet,
          detail: labels.syntheticMappedBalanceSheet,
          icon: FileSpreadsheet,
        },
        {
          view: "cash_flow",
          title: labels.cashFlow,
          detail: labels.syntheticMappedCashFlow,
          icon: FileSpreadsheet,
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

export function ReportFamilyWorkspace(props: {
  family: typeof Reports.ReportFamily.Type;
  recordId?: string;
  onOpen: (id: string) => void;
}) {
  const { book, locale } = useBookWorkspace();
  const sv = locale === "sv";
  const labels = sv ? familySwedish : familyEnglish;
  const keys = useRef(new Map<string, string>());
  const [inputError, setInputError] = useState("");
  const [accountId, setAccountId] = useState("");
  const saved = useQuery({
    queryKey: [...bookKey(book), "report-family", props.recordId],
    enabled: Boolean(props.recordId && props.recordId !== "new"),
    queryFn: async ({ signal }) => {
      const snapshot = await readAccounting(
        `${bookPath(book)}/report-family-snapshots/${encodeURIComponent(props.recordId ?? "")}`,
        Reports.ReportFamilySnapshot,
        { signal },
      );
      if (snapshot.report.id !== props.recordId || snapshot.family !== props.family) {
        throw new Error("Report family scope mismatch");
      }
      return snapshot;
    },
    retry: false,
  });
  const prepare = useMutation({
    mutationFn: (input: typeof Reports.PrepareReportFamily.Type) =>
      readAccounting(
        `${bookPath(book)}/report-family-snapshots`,
        Reports.ReportFamilySnapshot,
        mutationOptions(
          `${bookPath(book)}/report-family-snapshots`,
          JSON.stringify(input),
          keys.current,
        ),
      ),
    onSuccess: (snapshot) => props.onOpen(snapshot.report.id),
  });
  const title = labels[props.family];
  if (props.recordId && props.recordId !== "new") {
    return (
      <Box display="grid" gap="xl">
        <Button variant="ghost" onClick={() => props.onOpen("")}>
          {sv ? "Nya rapporter" : "New reports"}
        </Button>
        <AccountingStatus locale={locale} pending={saved.isPending} error={saved.error} />
        {saved.data ? (
          <SavedReportFamily
            book={book}
            locale={locale}
            snapshot={saved.data}
            title={title}
            accountId={accountId}
            onSelectAccount={setAccountId}
          />
        ) : null}
      </Box>
    );
  }
  return (
    <Box display="grid" gap="xl">
      <RecordHeading
        title={title}
        subtitle={labels.familySubtitle}
        action={
          <Button
            onClick={() => {
              prepare.reset();
              keys.current.clear();
              setInputError("");
            }}
          >
            {sv ? "Rensa" : "Clear"}
          </Button>
        }
      />
      <Box
        as="form"
        display="grid"
        gap="lg"
        maxWidth="content"
        onSubmit={(event) => {
          event.preventDefault();
          const fields = new FormData(event.currentTarget);
          const mappingValue = fields.get("mapping");
          if (typeof mappingValue !== "string") {
            setInputError(
              sv ? "Kopplingsrollerna måste vara giltig JSON." : "The mapping must be valid JSON.",
            );
            return;
          }
          let mapping: unknown;
          try {
            mapping = JSON.parse(mappingValue);
          } catch {
            setInputError(
              sv ? "Kopplingsrollerna måste vara giltig JSON." : "The mapping must be valid JSON.",
            );
            return;
          }
          const decoded = Schema.decodeUnknownOption(Reports.PrepareReportFamily)({
            kind: props.family,
            sourceReportId: fields.get("sourceReportId"),
            mapping,
          });
          if (decoded._tag === "None") {
            setInputError(
              sv
                ? "Ange en fullständig granskad konto- till rollmappning."
                : "Provide a complete reviewed account-role mapping.",
            );
            return;
          }
          setInputError("");
          prepare.mutate(decoded.value);
        }}
      >
        <InputField
          name="sourceReportId"
          label={labels.sourceReportId}
          placeholder="report_..."
          required
        />
        <TextareaField
          name="mapping"
          label={labels.mapping}
          defaultValue={JSON.stringify(
            { version: "synthetic_report_mapping_v1", reviewed: true, roles: [] },
            null,
            2,
          )}
          rows={10}
          required
        />
        <Text tone="muted">{labels.mappingHelp}</Text>
        <Box>
          <Button type="submit" disabled={prepare.isPending}>
            {sv ? "Spara rapport" : "Save report"}
          </Button>
        </Box>
        <Text role="status">{inputError}</Text>
        <AccountingStatus write locale={locale} pending={prepare.isPending} error={prepare.error} />
      </Box>
    </Box>
  );
}

function SavedReportFamily(props: {
  book: typeof Accounting.Book.Type;
  locale: "en" | "sv";
  snapshot: typeof Reports.ReportFamilySnapshot.Type;
  title: string;
  accountId: string;
  onSelectAccount: (id: string) => void;
}) {
  const { snapshot, locale, accountId } = props;
  const sv = locale === "sv";
  const labels = sv ? familySwedish : familyEnglish;
  const scale = snapshot.report.currencyScale;
  const amount = (value: string) =>
    scale === undefined
      ? "—"
      : `${formatMinorAmount(value, scale, locale)} ${snapshot.report.currency}`;
  return (
    <Box display="grid" gap="xl">
      <RecordHeading
        title={props.title}
        subtitle={`${snapshot.cutoff.startsOn} – ${snapshot.cutoff.endsOn}`}
        action={
          <Button variant="ghost" onClick={() => props.onSelectAccount("")}>
            {sv ? "Stäng detalj" : "Close detail"}
          </Button>
        }
      />
      <RecordSummary>
        <RecordFact label={sv ? "Avklippning" : "Cutoff"}>{snapshot.cutoff.sequence}</RecordFact>
        <RecordFact label={sv ? "Källa" : "Source"}>{snapshot.sourceReportId}</RecordFact>
        <RecordFact label={sv ? "Mappat belopp" : "Mapped amount"}>
          {amount(snapshot.totals.amountMinor)}
        </RecordFact>
        <RecordFact label={sv ? "Status" : "Status"}>
          {sv ? "Syntetisk, inte godkänd" : "Synthetic, not approved"}
        </RecordFact>
      </RecordSummary>
      <Text>
        {sv
          ? "Fasta totaler från den sparade rapportens avklippning. Kontrollera varje konto och verifikat."
          : "Fixed totals from the saved report cutoff. Inspect each account and contributing entry."}
      </Text>
      <DataTable
        title={labels.lines}
        narrow="stack"
        columns={[
          { id: "line", label: labels.line },
          { id: "accounts", label: labels.accounts },
          { id: "opening", label: sv ? "Ingående" : "Opening", numeric: true },
          { id: "movement", label: sv ? "Rörelse" : "Movement", numeric: true },
          { id: "closing", label: sv ? "Utgående" : "Closing", numeric: true },
          { id: "amount", label: sv ? "Mappat belopp" : "Mapped amount", numeric: true },
        ]}
        rows={snapshot.lines.map((line) => ({
          id: line.id,
          cells: [
            line.label,
            <Box key={line.id} display="flex" gap="xs" flexWrap="wrap">
              {line.accountIds.map((id) => (
                <Button
                  key={id}
                  type="button"
                  variant="outline"
                  onClick={() => props.onSelectAccount(id)}
                >
                  {id}
                </Button>
              ))}
            </Box>,
            amount(line.openingMinor),
            amount(line.movementMinor),
            amount(line.closingMinor),
            amount(line.amountMinor),
          ],
        }))}
      />
      {accountId ? (
        <Box display="grid" gap="lg">
          <RecordHeading
            title={`${sv ? "Bidragande verifikat" : "Contributing entries"} · ${accountId}`}
            subtitle={snapshot.mappingDigest}
          />
          <AccountExplanation
            book={props.book}
            report={snapshot.report}
            accountId={accountId}
            locale={locale}
          />
        </Box>
      ) : null}
      {snapshot.warnings.map((warning) => (
        <Text key={warning} tone="muted">
          {warning}
        </Text>
      ))}
    </Box>
  );
}

const familyEnglish = {
  profit_and_loss: "Profit and loss",
  balance_sheet: "Balance sheet",
  cash_flow: "Cash flow",
  familySubtitle:
    "Use a saved trial balance and provide a complete reviewed account-role mapping. No account classification is inferred.",
  sourceReportId: "Saved trial-balance report ID",
  mapping: "Reviewed account-role mapping",
  mappingHelp:
    "JSON: version synthetic_report_mapping_v1, reviewed true, and one role for every account in the saved report. Use excluded only for an explicitly excluded account. The API returns UnsupportedProfile when the mapping is absent or incomplete.",
  lines: "Fixed-cutoff report lines",
  line: "Line",
  accounts: "Contributing accounts",
};
const familySwedish: typeof familyEnglish = {
  profit_and_loss: "Resultaträkning",
  balance_sheet: "Balansräkning",
  cash_flow: "Kassaflödesanalys",
  familySubtitle:
    "Använd en sparad saldobalans och ange en fullständig granskad konto- till rollmappning. Ingen kontoklassificeras automatiskt.",
  sourceReportId: "Saldobalansens rapport-id",
  mapping: "Granskad konto- till rollmappning",
  mappingHelp:
    "JSON: version synthetic_report_mapping_v1, reviewed true och en roll för varje konto i den sparade rapporten. Använd excluded endast för ett uttryckligen uteslutet konto. API:et returnerar UnsupportedProfile när mappningen saknas eller är ofullständig.",
  lines: "Rapporterader med fast avklippning",
  line: "Rad",
  accounts: "Bidragande konton",
};

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
  financialStatements: "Financial statements",
  profitAndLoss: "Profit and loss",
  balanceSheet: "Balance sheet",
  cashFlow: "Cash flow",
  syntheticMappedIncomeStatement: "Mapped income-statement lines from a saved trial balance.",
  syntheticMappedBalanceSheet: "Mapped balance-sheet lines from a saved trial balance.",
  syntheticMappedCashFlow: "Mapped cash-flow lines from a saved trial balance.",
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
  financialStatements: "Finansiella rapporter",
  profitAndLoss: "Resultaträkning",
  balanceSheet: "Balansräkning",
  cashFlow: "Kassaflödesanalys",
  syntheticMappedIncomeStatement: "Mappade resultaträkningsrader från en sparad saldobalans.",
  syntheticMappedBalanceSheet: "Mappade balansräkningsrader från en sparad saldobalans.",
  syntheticMappedCashFlow: "Mappade kassaflödesrader från en sparad saldobalans.",
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
