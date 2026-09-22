import { useQuery } from "@tanstack/react-query";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Bank from "@open-erp/contracts/reconciliation";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { DataTable } from "@open-erp/ui/components/data-table";
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
}: {
  book: typeof Accounting.Book.Type;
  id: string;
  locale: Locale;
}) {
  const copy = accountingCopy(locale);
  const report = useQuery({
    queryKey: [...bookKey(book), "bank-reconciliation", id],
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
      return view;
    },
    retry: false,
  });
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
      <AccountingStatus locale={locale} pending={report.isPending} error={report.error} />
      {report.data ? (
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
  const report = view.report;
  const status = {
    complete: copy.bank_complete,
    balanced_but_incomplete: copy.bank_incomplete,
    differences: copy.bank_differences,
  };
  return (
    <Box display="grid" gap="lg" minWidth="zero">
      <Text>
        {copy.bank_report_id}: {report.id}
      </Text>
      <Text>
        {copy.journal_account}: {report.accountId} · {report.currency} · {report.startsOn} –{" "}
        {report.endsOn}
      </Text>
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
      <Text tone="muted">
        {copy.bank_checkpoint}: {report.checkpoint.sequence} / {report.checkpoint.sourceRevision} ·{" "}
        {report.createdAt}
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
            cells: [copy.bank_ledger, report.ledgerOpeningMinor, report.ledgerClosingMinor],
          },
          {
            id: "bank",
            cells: [
              copy.bank_source_label,
              report.bankOpeningMinor ?? copy.bank_missing,
              report.bankClosingMinor ?? copy.bank_missing,
            ],
          },
          {
            id: "difference",
            cells: [
              copy.bank_difference,
              report.openingDifferenceMinor ?? copy.bank_missing,
              report.closingDifferenceMinor ?? copy.bank_missing,
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
      />
      <LedgerLines
        title={copy.bank_unmatched_ledger}
        lines={report.unmatchedLedger}
        locale={locale}
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
          <SourceRows title={copy.bank_rows} rows={report.sourceRows} locale={locale} />
        </Box>
      </details>
      <details>
        <summary>{copy.bank_ledger_lines}</summary>
        <Box paddingBlock="lg" minWidth="zero">
          <LedgerLines title={copy.bank_ledger_lines} lines={report.ledgerLines} locale={locale} />
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
}: {
  title: string;
  rows: readonly (typeof Bank.SourceObservation.Type)[];
  locale: Locale;
}) {
  const copy = accountingCopy(locale);
  return (
    <Box display="grid" gap="md" minWidth="zero">
      <DataTable
        title={title}
        narrow="stack"
        columns={[
          { id: "statement", label: copy.bank_statement_id },
          { id: "ordinal", label: copy.bank_ordinal },
          { id: "provider", label: copy.bank_provider_id },
          { id: "date", label: copy.journal_date },
          { id: "amount", label: copy.bank_amount, numeric: true },
          { id: "description", label: copy.journal_description },
          { id: "evidence", label: copy.journal_evidence_refs },
        ]}
        rows={rows.map((row) => ({
          id: `${row.statementId}/${row.rowOrdinal}`,
          cells: [
            row.statementId,
            String(row.rowOrdinal),
            row.providerId ?? "—",
            row.date,
            row.amountMinor,
            row.description,
            `${row.evidenceId} · ${row.evidenceSha256}`,
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
}: {
  title: string;
  lines: readonly (typeof Bank.BankLedgerLine.Type)[];
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
          { id: "line", label: copy.bank_line_id },
          { id: "sequence", label: copy.journal_sequence },
          { id: "date", label: copy.journal_date },
          { id: "amount", label: copy.bank_amount, numeric: true },
          { id: "description", label: copy.journal_description },
        ]}
        rows={lines.map((line) => ({
          id: line.lineId,
          cells: [
            line.voucherId,
            line.lineId,
            line.sequence,
            line.date,
            line.amountMinor,
            line.description,
          ],
        }))}
      />
      {lines.length === 0 ? <Text tone="muted">{copy.bank_empty}</Text> : null}
    </Box>
  );
}
