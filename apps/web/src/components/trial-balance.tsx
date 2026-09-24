import { RecordHeading, RecordSummary, RecordFact } from "@open-erp/ui/components/record-layout";
import { PageCaption, RecordOpen } from "@open-erp/ui/components/accounting-page";
import { RecordSheet } from "@open-erp/ui/components/record-sheet";
import { Link } from "@open-erp/ui/components/link";
import { workspacePath } from "@/lib/book-context";
import { Disclosure } from "@open-erp/ui/components/workflow";
import { formatMinorAmount, workQueryOptions } from "@/lib/workspace-api";
import { useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Reports from "@open-erp/contracts/reports";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { DataTable } from "@open-erp/ui/components/data-table";
import { Heading, Text } from "@open-erp/ui/components/typography";
import { AccountingStatus } from "@/components/accounting-status";
import { GeneralLedger } from "@/components/general-ledger";
import { EvidenceInspector } from "@/components/evidence-inspector";
import { bookKey, bookPath, readAccounting } from "@/lib/accounting-api";
import { accountingCopy } from "@/lib/accounting-copy";
import type { Locale } from "@/paraglide/runtime";

export function TrialBalance(props: {
  book: typeof Accounting.Book.Type;
  id: string;
  locale: Locale;
  accountId?: string;
  mode?: "trial" | "ledger";
  onSelectAccount?: (id: string) => void;
}) {
  const { book, id, locale } = props;
  const copy = accountingCopy(locale);
  const metadata = useQuery(workQueryOptions(book, {}));
  const [localAccount, setLocalAccount] = useState<string | null>(null);
  const accountId = props.onSelectAccount ? props.accountId : localAccount;
  const setAccountId = (value: string | null) => {
    setLocalAccount(value);
    props.onSelectAccount?.(value ?? "");
  };
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
  const scale = report.data?.currencyScale ?? metadata.data?.currencyScale;
  const amount = (value: string) =>
    scale === undefined ? "—" : formatMinorAmount(value, scale, locale);
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
      <AccountingStatus
        locale={locale}
        pending={report.isPending || lines.isPending || metadata.isPending}
        error={report.error ?? lines.error ?? metadata.error}
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
      {report.data && !report.isError && !lines.isError ? (
        <>
          <SnapshotHeader report={report.data} locale={locale} scale={scale} mode={props.mode} />
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
                  { id: "opening", label: locale === "sv" ? "Ingående" : "Opening", numeric: true },
                  { id: "debit", label: locale === "sv" ? "Debet" : "Debit", numeric: true },
                  { id: "credit", label: locale === "sv" ? "Kredit" : "Credit", numeric: true },
                  { id: "closing", label: locale === "sv" ? "Utgående" : "Closing", numeric: true },
                ]}
                rows={loaded
                  .toSorted((a, b) => a.code.localeCompare(b.code))
                  .map((line) => ({
                    id: line.accountId,
                    cells: [
                      <RecordOpen key={line.accountId} onClick={() => setAccountId(line.accountId)}>
                        {line.code}
                      </RecordOpen>,
                      line.name,
                      amount(line.openingMinor),
                      amount(line.debitMinor),
                      amount(line.creditMinor),
                      amount(line.closingMinor),
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
          <ReportBasis report={report.data} locale={locale} />
          {accountId ? (
            <AccountReportSheet
              book={book}
              report={report.data}
              line={loaded.find((line) => line.accountId === accountId)}
              accountId={accountId}
              locale={locale}
              mode={props.mode}
              scale={scale}
              onClose={() => setAccountId(null)}
            />
          ) : null}
        </>
      ) : null}
    </Box>
  );
}

function AccountReportSheet(props: {
  book: typeof Accounting.Book.Type;
  report: typeof Reports.ReportSnapshot.Type;
  line?: typeof Reports.ReportLine.Type;
  accountId: string;
  locale: Locale;
  mode?: "trial" | "ledger";
  scale?: number;
  onClose: () => void;
}) {
  const { book, report, accountId, locale } = props;
  return (
    <RecordSheet
      title={
        props.line
          ? `${props.line.code} · ${props.line.name}`
          : locale === "sv"
            ? "Kontodetaljer"
            : "Account details"
      }
      closeLabel={locale === "sv" ? "Till rapporten" : "Back to report"}
      onClose={props.onClose}
    >
      {props.mode === "ledger" ? (
        <GeneralLedger
          key={accountId}
          book={book}
          report={report}
          accountId={accountId}
          locale={locale}
          scale={props.scale}
        />
      ) : (
        <AccountExplanation
          key={accountId}
          book={book}
          report={report}
          accountId={accountId}
          locale={locale}
        />
      )}
    </RecordSheet>
  );
}

function SnapshotHeader({
  report,
  locale,
  scale,
  mode,
}: {
  report: typeof Reports.ReportSnapshot.Type;
  locale: Locale;
  scale?: number;
  mode?: "trial" | "ledger";
}) {
  const sv = locale === "sv";
  const amount = (value: string) =>
    scale === undefined ? "—" : `${formatMinorAmount(value, scale, locale)} ${report.currency}`;
  return (
    <Box display="grid" gap="lg">
      <RecordHeading
        title={
          mode === "ledger"
            ? sv
              ? "Huvudbok"
              : "General ledger"
            : sv
              ? "Saldobalans"
              : "Trial balance"
        }
        subtitle={`${report.startsOn} – ${report.endsOn}`}
      />
      <RecordSummary>
        <RecordFact label={sv ? "Debet" : "Debit"}>{amount(report.debitMinor)}</RecordFact>
        <RecordFact label={sv ? "Kredit" : "Credit"}>{amount(report.creditMinor)}</RecordFact>
        <RecordFact label={sv ? "Verifikat" : "Vouchers"}>{report.voucherCount}</RecordFact>
        <RecordFact label="Status">
          {report.balanced ? (sv ? "Balanserad" : "Balanced") : sv ? "Differens" : "Difference"}
        </RecordFact>
      </RecordSummary>
      <PageCaption>
        {sv ? "Sparad" : "Saved"}{" "}
        {new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(
          new Date(report.createdAt),
        )}
        .{" "}
        {sv
          ? "Välj ett konto för att se verifikat och underlag."
          : "Choose an account to see its entries and source records."}
      </PageCaption>
    </Box>
  );
}

function ReportBasis({
  report,
  locale,
}: {
  report: typeof Reports.ReportSnapshot.Type;
  locale: Locale;
}) {
  const sv = locale === "sv";
  return (
    <Disclosure title={sv ? "Rapportunderlag & begränsningar" : "Report basis & limitations"}>
      <Text>
        {report.id} · {report.sequence}
      </Text>
      <Text>
        {sv
          ? "Rapporten fastställer inte att allt underlag är komplett."
          : "This report does not establish source completeness."}
      </Text>
      {report.warnings.map((warning) => (
        <Text key={warning}>{warning}</Text>
      ))}
    </Disclosure>
  );
}

export function AccountExplanation({
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
  const metadata = useQuery(workQueryOptions(book, {}));
  const scale = report.currencyScale ?? metadata.data?.currencyScale;
  const amount = (value: string) =>
    scale === undefined ? "—" : formatMinorAmount(value, scale, locale);
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
            {first.line.code} · {first.line.name}
          </Text>
          <Text tone="muted">
            {first.report.currency} · {first.report.startsOn} – {first.report.endsOn}
          </Text>
          <Text>{copy.report_formula}</Text>
          <DataTable
            title={copy.report_frozen_totals}
            narrow="stack"
            columns={[
              { id: "opening", label: locale === "sv" ? "Ingående" : "Opening", numeric: true },
              { id: "debit", label: locale === "sv" ? "Debet" : "Debit", numeric: true },
              { id: "credit", label: locale === "sv" ? "Kredit" : "Credit", numeric: true },
              { id: "closing", label: locale === "sv" ? "Utgående" : "Closing", numeric: true },
            ]}
            rows={[
              {
                id: first.line.accountId,
                cells: [
                  amount(first.line.openingMinor),
                  amount(first.line.debitMinor),
                  amount(first.line.creditMinor),
                  amount(first.line.closingMinor),
                ],
              },
            ]}
          />
          <Text role="status">
            {copy.report_loaded_contributions}: {contributions.length} / {first.totalContributions}
          </Text>
          <DataTable
            title={copy.report_contributions}
            narrow="stack"
            columns={[
              { id: "date", label: copy.journal_date },
              { id: "part", label: copy.report_part },
              { id: "debit", label: locale === "sv" ? "Debet" : "Debit", numeric: true },
              { id: "credit", label: locale === "sv" ? "Kredit" : "Credit", numeric: true },
              { id: "description", label: copy.journal_description },
              { id: "evidence", label: copy.journal_evidence_refs },
            ]}
            rows={contributions.map((entry) => ({
              id: `${entry.sequence}:${entry.ordinal}`,
              cells: [
                entry.postingDate,
                entry.part === "opening" ? copy.report_opening_part : copy.report_movement_part,
                amount(entry.debitMinor),
                amount(entry.creditMinor),
                <Link
                  key="voucher"
                  href={`${workspacePath(book)}/books?view=vouchers&record=${encodeURIComponent(entry.voucherId)}&returnReport=${encodeURIComponent(report.id)}&returnAccount=${encodeURIComponent(accountId)}&returnView=ledger`}
                >
                  {entry.description}
                </Link>,
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
