import { useQuery } from "@tanstack/react-query";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Bank from "@open-erp/contracts/reconciliation";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { DataTable } from "@open-erp/ui/components/data-table";
import { RecordHeading, RecordSummary, RecordFact } from "@open-erp/ui/components/record-layout";
import { workQueryOptions, formatMinorAmount } from "@/lib/workspace-api";
import { Heading, Text } from "@open-erp/ui/components/typography";
import { AccountingStatus } from "@/components/accounting-status";
import { BankMatches, BankStatementDetails } from "@/components/bank-statement";
import { bookKey, bookPath, readAccounting } from "@/lib/accounting-api";
import { accountingCopy } from "@/lib/accounting-copy";
import type { Locale } from "@/paraglide/runtime";

export function BankReport({
  book,
  id,
  locale,
  expected,
}: {
  book: typeof Accounting.Book.Type;
  id: string;
  locale: Locale;
  expected?: { accountId: string; startsOn: string; endsOn: string };
}) {
  const copy = accountingCopy(locale);

  const report = useQuery({
    queryKey: [...bookKey(book), "bank-reconciliation", id, expected],
    queryFn: async ({ signal }) => {
      const view = await readAccounting(
        `${bookPath(book)}/bank-reconciliations/${encodeURIComponent(id)}`,
        Bank.BankReconciliationView,
        { signal },
      );

      if (
        view.report.id !== id ||
        view.report.scope.entityId !== book.entityId ||
        view.report.scope.bookId !== book.id
      )
        throw new Error("Report scope mismatch");

      if (
        expected &&
        (view.report.accountId !== expected.accountId ||
          view.report.startsOn !== expected.startsOn ||
          view.report.endsOn !== expected.endsOn)
      )
        throw new Error("Report account or period mismatch");

      return view;
    },
    retry: false,
  });

  const scopeMismatch =
    report.error instanceof Error && report.error.message === "Report account or period mismatch";

  return (
    <Box as="section" display="grid" gap="lg" minWidth="zero">
      <Heading>{copy.bank_report}</Heading>
      <Box>
        <Button
          size="xl"
          variant="outline"
          disabled={report.isFetching}
          onClick={() => {
            void report.refetch();
          }}
        >
          {copy.journal_refresh}
        </Button>
      </Box>
      <AccountingStatus
        locale={locale}
        pending={report.isPending}
        error={scopeMismatch ? null : report.error}
      />
      {scopeMismatch ? (
        <Text role="alert">
          {locale === "sv"
            ? "Rapporten hör till ett annat konto eller en annan period. Välj den ursprungliga perioden eller spara en ny rapport här."
            : "This report belongs to another account or period. Select its original period or save a new report here."}
        </Text>
      ) : null}
      {report.isSuccess ? (
        <>
          <Text tone="muted">
            {copy.bank_last_checked}: {new Date(report.dataUpdatedAt).toISOString()}
          </Text>
          <ReportDetails
            book={book}
            view={report.data}
            locale={locale}
            freshnessKnown={!report.isFetching && !report.isError}
          />
        </>
      ) : null}
    </Box>
  );
}

function ReportDetails({
  book,
  view,
  locale,
  freshnessKnown,
}: {
  book: typeof Accounting.Book.Type;
  view: typeof Bank.BankReconciliationView.Type;
  locale: Locale;
  freshnessKnown: boolean;
}) {
  const copy = accountingCopy(locale);
  const metadata = useQuery(workQueryOptions(book, {}));

  const setup = useQuery({
    queryKey: [...bookKey(book), "setup"],
    queryFn: ({ signal }) =>
      readAccounting(`${bookPath(book)}/setup`, Accounting.BookSetup, { signal }),
    retry: false,
  });

  const scale = metadata.data?.currencyScale;

  const amount = (value: string | null) =>
    value === null || scale === undefined ? "—" : formatMinorAmount(value, scale, locale);

  const report = view.report;

  const status = {
    complete: copy.bank_complete,
    balanced_but_incomplete: copy.bank_incomplete,
    differences: copy.bank_differences,
  };

  return (
    <Box display="grid" gap="lg" minWidth="zero">
      <RecordHeading
        title={
          setup.data?.accounts.find((account) => account.id === report.accountId)?.name ??
          copy.journal_account
        }
        subtitle={`${report.startsOn} – ${report.endsOn} · ${report.currency}`}
      />
      <AccountingStatus
        locale={locale}
        pending={metadata.isPending}
        error={metadata.error ?? setup.error}
      />
      <RecordSummary>
        <RecordFact label={locale === "sv" ? "Bokfört saldo" : "Ledger balance"}>
          {amount(report.ledgerClosingMinor)} {report.currency}
        </RecordFact>
        <RecordFact label={locale === "sv" ? "Kontoutdragets saldo" : "Statement balance"}>
          {amount(report.bankClosingMinor)} {report.currency}
        </RecordFact>
        <RecordFact label={copy.bank_difference}>
          {amount(report.closingDifferenceMinor)} {report.currency}
        </RecordFact>
      </RecordSummary>
      <Box
        role="status"
        display="grid"
        gap="md"
        padding="lg"
        backgroundColor="muted"
        borderRadius="surface"
      >
        <Text>
          {copy.bank_recorded_status}: {status[report.status]}
        </Text>
        <Text>
          {!freshnessKnown
            ? copy.bank_freshness_unknown
            : view.fresh
              ? copy.bank_fresh
              : copy.bank_stale}
        </Text>
        <Text>
          {report.sourceCoverageComplete
            ? copy.bank_sources_complete
            : copy.bank_sources_incomplete}
        </Text>
      </Box>
      <Text tone="muted">{copy.bank_warning}</Text>
      <details>
        <summary>{locale === "sv" ? "Underlag och historik" : "Snapshot and receipt"}</summary>
        <Box paddingBlock="lg" display="grid" gap="md">
          <Text tone="muted">
            {copy.bank_checkpoint}: {report.checkpoint.sequence} /{" "}
            {report.checkpoint.sourceRevision} · {report.createdAt}
          </Text>
          <Text tone="muted">
            {copy.bank_account_checkpoint}: {report.accountLedgerSequence}
          </Text>
          <Text tone="muted">
            {copy.bank_current}: {view.currentAccountLedgerSequence} / {view.currentSourceRevision}
          </Text>
          <Text tone="muted">
            {copy.bank_receipt}: {report.receipt.key} · {report.receipt.operation} ·{" "}
            {report.receipt.actorId}
          </Text>
        </Box>
      </details>
      <DataTable
        title={copy.bank_summary}
        narrow="stack"
        columns={[
          { id: "source", label: copy.journal_description },
          { id: "opening", label: copy.bank_opening, numeric: true },
          { id: "closing", label: copy.bank_closing, numeric: true },
        ]}
        rows={[
          {
            id: "ledger",
            cells: [
              copy.bank_ledger,
              amount(report.ledgerOpeningMinor),
              amount(report.ledgerClosingMinor),
            ],
          },
          {
            id: "bank",
            cells: [
              copy.bank_source_label,
              amount(report.bankOpeningMinor),
              amount(report.bankClosingMinor),
            ],
          },
          {
            id: "difference",
            cells: [
              copy.bank_difference,
              amount(report.openingDifferenceMinor),
              amount(report.closingDifferenceMinor),
            ],
          },
        ]}
      />
      <Heading>{copy.bank_differences}</Heading>
      {report.differences.length === 0 ? (
        <Text>{copy.bank_no_differences}</Text>
      ) : (
        report.differences.map((difference) => <Text key={difference}>{difference}</Text>)
      )}
      <Heading>{copy.bank_gaps}</Heading>
      {report.coverageGaps.length === 0 ? (
        <Text>{copy.bank_no_gaps}</Text>
      ) : (
        report.coverageGaps.map((gap) => <Text key={gap}>{gap}</Text>)
      )}
      <SourceRows
        title={copy.bank_unmatched_source}
        rows={report.unmatchedSource}
        locale={locale}
        scale={scale}
      />
      <LedgerLines
        title={copy.bank_unmatched_ledger}
        lines={report.unmatchedLedger}
        locale={locale}
        scale={scale}
      />
      <details>
        <summary>{copy.bank_sources}</summary>
        <Box display="grid" gap="xl" paddingBlock="lg" minWidth="zero">
          {report.statements.length === 0 ? (
            <Text>{copy.bank_empty}</Text>
          ) : (
            report.statements.map((statement) => (
              <BankStatementDetails
                key={statement.id}
                book={book}
                statement={statement}
                locale={locale}
              />
            ))
          )}
        </Box>
      </details>
      <details>
        <summary>{copy.bank_rows}</summary>
        <Box paddingBlock="lg" minWidth="zero">
          <SourceRows
            title={copy.bank_rows}
            rows={report.sourceRows}
            locale={locale}
            scale={scale}
          />
        </Box>
      </details>
      <details>
        <summary>{copy.bank_ledger_lines}</summary>
        <Box paddingBlock="lg" minWidth="zero">
          <LedgerLines
            title={copy.bank_ledger_lines}
            lines={report.ledgerLines}
            locale={locale}
            scale={scale}
          />
        </Box>
      </details>
      <details>
        <summary>{copy.bank_matches}</summary>
        <Box paddingBlock="lg" minWidth="zero">
          <BankMatches matches={report.matches} locale={locale} />
        </Box>
      </details>
    </Box>
  );
}

function SourceRows({
  title,
  rows,
  locale,
  scale,
}: {
  title: string;
  rows: readonly (typeof Bank.SourceObservation.Type)[];
  scale: number | undefined;
  locale: Locale;
}) {
  const copy = accountingCopy(locale);

  return (
    <Box display="grid" gap="md" minWidth="zero">
      <DataTable
        title={title}
        narrow="stack"
        columns={[
          { id: "ordinal", label: copy.bank_ordinal },
          { id: "provider", label: copy.bank_provider_id },
          { id: "date", label: copy.journal_date },
          { id: "amount", label: copy.bank_amount, numeric: true },
          { id: "description", label: copy.journal_description },
        ]}
        rows={rows.map((row) => ({
          id: `${row.statementId}/${row.rowOrdinal}`,
          cells: [
            String(row.rowOrdinal),
            row.providerId ?? "—",
            row.date,
            scale === undefined ? "—" : formatMinorAmount(row.amountMinor, scale, locale),
            row.description,
          ],
        }))}
      />
      {rows.length === 0 ? <Text tone="muted">{copy.bank_empty}</Text> : null}
    </Box>
  );
}

function LedgerLines({
  title,
  lines,
  locale,
  scale,
}: {
  title: string;
  lines: readonly (typeof Bank.BankLedgerLine.Type)[];
  scale: number | undefined;
  locale: Locale;
}) {
  const copy = accountingCopy(locale);

  return (
    <Box display="grid" gap="md" minWidth="zero">
      <DataTable
        title={title}
        narrow="stack"
        columns={[
          { id: "voucher", label: copy.journal_voucher },
          { id: "sequence", label: copy.journal_sequence },
          { id: "date", label: copy.journal_date },
          { id: "amount", label: copy.bank_amount, numeric: true },
          { id: "description", label: copy.journal_description },
        ]}
        rows={lines.map((line) => ({
          id: line.lineId,
          cells: [
            line.voucherId,
            line.sequence,
            line.date,
            scale === undefined ? "—" : formatMinorAmount(line.amountMinor, scale, locale),
            line.description,
          ],
        }))}
      />
      {lines.length === 0 ? <Text tone="muted">{copy.bank_empty}</Text> : null}
    </Box>
  );
}
