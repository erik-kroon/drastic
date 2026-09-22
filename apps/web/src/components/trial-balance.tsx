import { useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Reports from "@open-erp/contracts/reports";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { DataTable } from "@open-erp/ui/components/data-table";
import { Heading, Text } from "@open-erp/ui/components/typography";
import { AccountingStatus } from "@/components/accounting-status";
import { EvidenceInspector } from "@/components/evidence-inspector";
import { bookKey, bookPath, readAccounting } from "@/lib/accounting-api";
import { accountingCopy } from "@/lib/accounting-copy";
import type { Locale } from "@/paraglide/runtime";

export function TrialBalance({
  book,
  id,
  locale,
}: {
  book: typeof Accounting.Book.Type;
  id: string;
  locale: Locale;
}) {
  const copy = accountingCopy(locale);
  const [accountId, setAccountId] = useState<string | null>(null);
  const base = `${bookPath(book)}/report-snapshots/${encodeURIComponent(id)}`;
  const report = useQuery({
    queryKey: [...bookKey(book), "report-snapshot", id],
    queryFn: async ({ signal }) => {
      const snapshot = await readAccounting(base, Reports.ReportSnapshot, { signal });
      if (
        snapshot.id !== id ||
        snapshot.scope.entityId !== book.entityId ||
        snapshot.scope.bookId !== book.id
      )
        throw new Error("Report scope mismatch");
      return snapshot;
    },
    retry: false,
  });
  const lines = useInfiniteQuery({
    queryKey: [...bookKey(book), "report-lines", id],
    initialPageParam: "",
    queryFn: async ({ signal, pageParam }) => {
      const page = await readAccounting(
        `${base}/lines${pageParam ? `?after=${encodeURIComponent(pageParam)}` : ""}`,
        Reports.ReportLines,
        { signal },
      );
      if (page.reportId !== id) throw new Error("Report line scope mismatch");
      return page;
    },
    getNextPageParam: (page) => page.next,
    retry: false,
  });
  const loaded = lines.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <Box as="section" display="grid" gap="lg" minWidth="zero">
      <Heading>{copy.report_snapshot}</Heading>
      <AccountingStatus
        locale={locale}
        pending={report.isPending || lines.isPending}
        error={report.error ?? lines.error}
      />
      {report.isError || lines.isError ? (
        <Box>
          <Button
            size="xl"
            variant="outline"
            disabled={report.isFetching || lines.isFetching}
            onClick={() => {
              void report.refetch();
              void lines.refetch();
            }}
          >
            {copy.journal_retry}
          </Button>
        </Box>
      ) : null}
      {report.data ? (
        <>
          <SnapshotHeader report={report.data} locale={locale} />
          <Text tone="muted">{copy.report_account_help}</Text>
          {lines.data ? (
            <>
              <Text role="status">
                {copy.report_loaded_accounts}: {loaded.length} / {lines.data.pages[0]?.total}
              </Text>
              <DataTable
                title={copy.report_accounts}
                narrow="stack"
                columns={[
                  { id: "code", label: copy.journal_account },
                  { id: "name", label: copy.journal_description },
                  { id: "opening", label: copy.bank_opening, numeric: true },
                  { id: "debit", label: copy.journal_debit, numeric: true },
                  { id: "credit", label: copy.journal_credit, numeric: true },
                  { id: "closing", label: copy.bank_closing, numeric: true },
                ]}
                rows={loaded.map((line) => ({
                  id: line.accountId,
                  cells: [
                    <Button
                      key={line.accountId}
                      size="xl"
                      variant="link"
                      aria-expanded={accountId === line.accountId}
                      aria-controls="report-explanation"
                      onClick={() => {
                        setAccountId(line.accountId);
                        requestAnimationFrame(() =>
                          document.getElementById("report-explanation")?.focus(),
                        );
                      }}
                    >
                      {line.code}
                    </Button>,
                    `${line.name} · ${line.accountId}`,
                    line.openingMinor,
                    line.debitMinor,
                    line.creditMinor,
                    line.closingMinor,
                  ],
                }))}
              />
              {loaded.length === 0 ? <Text>{copy.report_empty}</Text> : null}
            </>
          ) : null}
          {lines.hasNextPage ? (
            <Box>
              <Button
                size="xl"
                variant="outline"
                disabled={lines.isFetching}
                onClick={() => {
                  void lines.fetchNextPage();
                }}
              >
                {copy.report_more_accounts}
              </Button>
            </Box>
          ) : null}
          <Box id="report-explanation" tabIndex={-1} minWidth="zero">
            {accountId ? (
              <AccountExplanation
                key={accountId}
                book={book}
                report={report.data}
                accountId={accountId}
                locale={locale}
              />
            ) : (
              <Text tone="muted">{copy.report_account_help}</Text>
            )}
          </Box>
        </>
      ) : null}
    </Box>
  );
}

function SnapshotHeader({
  report,
  locale,
}: {
  report: typeof Reports.ReportSnapshot.Type;
  locale: Locale;
}) {
  const copy = accountingCopy(locale);
  return (
    <Box display="grid" gap="md" minWidth="zero">
      <Text>
        {copy.report_id}: {report.id}
      </Text>
      <Text>
        {copy.report_sequence}: {report.sequence} · {report.currency} · {report.startsOn} –{" "}
        {report.endsOn}
      </Text>
      <Text tone="muted">
        {copy.report_created_at}: {report.createdAt}
      </Text>
      <Text>{copy.report_coverage}</Text>
      <Text>{report.balanced ? copy.report_balanced : copy.report_unbalanced}</Text>
      <Text tone="muted">{copy.report_warning}</Text>
      {report.warnings.map((warning) => (
        <Text key={warning}>{warning}</Text>
      ))}
      <Heading>{copy.report_global_totals}</Heading>
      <Text>
        {copy.report_account_count}: {report.accountCount} · {copy.report_voucher_count}:{" "}
        {report.voucherCount}
      </Text>
      <DataTable
        title={copy.report_global_totals}
        narrow="stack"
        columns={[
          { id: "debit", label: copy.journal_debit, numeric: true },
          { id: "credit", label: copy.journal_credit, numeric: true },
        ]}
        rows={[{ id: "snapshot-total", cells: [report.debitMinor, report.creditMinor] }]}
      />
    </Box>
  );
}

function AccountExplanation({
  book,
  report,
  accountId,
  locale,
}: {
  book: typeof Accounting.Book.Type;
  report: typeof Reports.ReportSnapshot.Type;
  accountId: string;
  locale: Locale;
}) {
  const copy = accountingCopy(locale);
  const base = `${bookPath(book)}/report-snapshots/${encodeURIComponent(report.id)}/lines/${encodeURIComponent(accountId)}/explanation`;
  const explanation = useInfiniteQuery({
    queryKey: [...bookKey(book), "report-explanation", report.id, accountId],
    initialPageParam: "",
    queryFn: async ({ signal, pageParam }) => {
      const page = await readAccounting(
        `${base}${pageParam ? `?after=${encodeURIComponent(pageParam)}` : ""}`,
        Reports.ReportExplanation,
        { signal },
      );
      if (
        page.report.id !== report.id ||
        page.report.sequence !== report.sequence ||
        page.line.accountId !== accountId
      )
        throw new Error("Explanation scope mismatch");
      return page;
    },
    getNextPageParam: (page) => page.next,
    retry: false,
  });
  const first = explanation.data?.pages[0];
  const contributions = explanation.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <Box as="section" display="grid" gap="lg" minWidth="zero">
      <Heading>{copy.report_explanation}</Heading>
      <AccountingStatus locale={locale} pending={explanation.isPending} error={explanation.error} />
      {explanation.isError ? (
        <Box>
          <Button
            size="xl"
            variant="outline"
            disabled={explanation.isFetching}
            onClick={() => {
              void explanation.refetch();
            }}
          >
            {copy.journal_retry}
          </Button>
        </Box>
      ) : null}
      {first ? (
        <>
          <Text>
            {first.line.code} · {first.line.name} · {first.line.accountId}
          </Text>
          <Text tone="muted">
            {copy.report_id}: {first.report.id} · {copy.report_sequence}: {first.report.sequence} ·{" "}
            {first.report.currency} · {first.report.startsOn} – {first.report.endsOn}
          </Text>
          <Text>{copy.report_formula}</Text>
          <DataTable
            title={copy.report_frozen_totals}
            narrow="stack"
            columns={[
              { id: "opening", label: copy.bank_opening, numeric: true },
              { id: "debit", label: copy.journal_debit, numeric: true },
              { id: "credit", label: copy.journal_credit, numeric: true },
              { id: "closing", label: copy.bank_closing, numeric: true },
            ]}
            rows={[
              {
                id: first.line.accountId,
                cells: [
                  first.line.openingMinor,
                  first.line.debitMinor,
                  first.line.creditMinor,
                  first.line.closingMinor,
                ],
              },
            ]}
          />
          <Text role="status">
            {copy.report_loaded_contributions}: {contributions.length} / {first.totalContributions}
          </Text>
          <Text tone="muted">
            {copy.report_total_contributions}: {first.totalContributions}
          </Text>
          <DataTable
            title={copy.report_contributions}
            narrow="stack"
            columns={[
              { id: "voucher", label: copy.journal_voucher },
              { id: "line", label: copy.bank_line_id },
              { id: "sequence", label: copy.journal_sequence },
              { id: "date", label: copy.journal_date },
              { id: "part", label: copy.report_part },
              { id: "debit", label: copy.journal_debit, numeric: true },
              { id: "credit", label: copy.journal_credit, numeric: true },
              { id: "description", label: copy.journal_description },
              { id: "evidence", label: copy.journal_evidence_refs },
            ]}
            rows={contributions.map((entry) => ({
              id: `${entry.sequence}:${entry.ordinal}`,
              cells: [
                entry.voucherId,
                entry.lineId,
                `${entry.sequence}:${entry.ordinal}`,
                entry.postingDate,
                entry.part === "opening" ? copy.report_opening_part : copy.report_movement_part,
                entry.debitMinor,
                entry.creditMinor,
                entry.description,
                <details key={`${entry.sequence}:${entry.ordinal}`}>
                  <summary>{copy.report_evidence}</summary>
                  <Box display="grid" gap="lg" paddingBlock="md" minWidth="zero">
                    {entry.evidenceRefs.length === 0 ? (
                      <Text>{copy.report_no_evidence}</Text>
                    ) : (
                      entry.evidenceRefs.map((reference) => (
                        <EvidenceInspector
                          key={`${reference.evidenceId}/${reference.locator}`}
                          book={book}
                          reference={reference}
                          locale={locale}
                        />
                      ))
                    )}
                  </Box>
                </details>,
              ],
            }))}
          />
          {contributions.length === 0 ? <Text>{copy.report_no_contributions}</Text> : null}
          {explanation.hasNextPage ? (
            <Box>
              <Button
                size="xl"
                variant="outline"
                disabled={explanation.isFetching}
                onClick={() => {
                  void explanation.fetchNextPage();
                }}
              >
                {copy.report_more_contributions}
              </Button>
            </Box>
          ) : null}
        </>
      ) : null}
    </Box>
  );
}
