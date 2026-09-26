import { useInfiniteQuery } from "@tanstack/react-query";
import type * as Accounting from "@open-erp/contracts/accounting";
import * as Reports from "@open-erp/contracts/reports";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { DataTable } from "@open-erp/ui/components/data-table";
import { Link } from "@open-erp/ui/components/link";
import { PageCaption, PageEmpty } from "@open-erp/ui/components/accounting-page";
import { RecordFact, RecordSummary } from "@open-erp/ui/components/record-layout";
import { AccountingStatus } from "@/components/accounting-status";
import { bookKey, bookPath, readAccounting } from "@/lib/accounting-api";
import { workspacePath } from "@/lib/book-context";
import { formatMinorAmount } from "@/lib/workspace-api";
import type { Locale } from "@/paraglide/runtime";

export function GeneralLedger(props: {
  book: typeof Accounting.Book.Type;
  report: typeof Reports.ReportSnapshot.Type;
  accountId: string;
  locale: Locale;
  scale?: number;
}) {
  const { book, report, accountId, locale } = props;
  const copy = locale === "sv" ? swedish : english;
  const base = `${bookPath(book)}/report-snapshots/${encodeURIComponent(report.id)}/lines/${encodeURIComponent(accountId)}/general-ledger`;

  const ledger = useInfiniteQuery({
    queryKey: [...bookKey(book), "general-ledger", report.id, accountId],
    initialPageParam: "",
    queryFn: async ({ signal, pageParam }) => {
      const page = await readAccounting(
        `${base}${pageParam ? `?after=${encodeURIComponent(pageParam)}` : ""}`,
        Reports.GeneralLedgerPage,
        { signal },
      );

      if (
        page.report.id !== report.id ||
        page.report.sequence !== report.sequence ||
        page.report.scope.entityId !== book.entityId ||
        page.report.scope.bookId !== book.id ||
        page.line.accountId !== accountId
      )
        throw new Error("General ledger scope mismatch");

      return page;
    },
    getNextPageParam: (page) => page.next ?? undefined,
    retry: false,
  });

  const first = ledger.data?.pages[0];
  const entries = ledger.data?.pages.flatMap((page) => page.items) ?? [];
  const scale = report.currencyScale ?? props.scale;

  const amount = (value: string) =>
    scale === undefined ? "—" : formatMinorAmount(value, scale, locale);

  return (
    <Box display="grid" gap="xl" minWidth="zero">
      <PageCaption>
        {report.startsOn} – {report.endsOn} · {report.currency}
      </PageCaption>
      <AccountingStatus locale={locale} pending={ledger.isPending} error={ledger.error} />
      {ledger.isError ? (
        <Box>
          <Button
            variant="outline"
            disabled={ledger.isFetching}
            onClick={() => void ledger.refetch()}
          >
            {copy.retry}
          </Button>
        </Box>
      ) : null}
      {first && !ledger.isError ? (
        <>
          <RecordSummary>
            <RecordFact label={copy.opening}>{amount(first.line.openingMinor)}</RecordFact>
            <RecordFact label={copy.debit}>{amount(first.line.debitMinor)}</RecordFact>
            <RecordFact label={copy.credit}>{amount(first.line.creditMinor)}</RecordFact>
            <RecordFact label={copy.closing}>{amount(first.line.closingMinor)}</RecordFact>
          </RecordSummary>
          <PageCaption>{copy.order}</PageCaption>
          {entries.length ? (
            <DataTable
              title={copy.entries}
              columns={[
                { id: "date", label: copy.date },
                { id: "voucher", label: copy.voucher },
                { id: "description", label: copy.description },
                { id: "debit", label: copy.debit, numeric: true },
                { id: "credit", label: copy.credit, numeric: true },
                { id: "balance", label: copy.balance, numeric: true },
              ]}
              rows={entries.map((entry) => ({
                id: entry.lineId,
                cells: [
                  entry.postingDate,
                  <Link
                    key="voucher"
                    href={`${workspacePath(book)}/books?view=vouchers&record=${encodeURIComponent(entry.voucherId)}&returnReport=${encodeURIComponent(report.id)}&returnAccount=${encodeURIComponent(accountId)}&returnView=ledger`}
                  >
                    {entry.series}
                    {entry.voucherNumber}
                  </Link>,
                  entry.description,
                  amount(entry.debitMinor),
                  amount(entry.creditMinor),
                  amount(entry.runningBalanceMinor),
                ],
              }))}
            />
          ) : (
            <PageEmpty title={copy.empty} detail={copy.emptyDetail} />
          )}
          <PageCaption>
            {entries.length} / {first.totalMovements} {copy.entries.toLocaleLowerCase(locale)}
          </PageCaption>
          {ledger.hasNextPage ? (
            <Box>
              <Button
                variant="outline"
                disabled={ledger.isFetchingNextPage}
                onClick={() => void ledger.fetchNextPage()}
              >
                {copy.more}
              </Button>
            </Box>
          ) : null}
        </>
      ) : null}
    </Box>
  );
}

const english = {
  retry: "Try again",
  opening: "Opening balance",
  debit: "Debit",
  credit: "Credit",
  closing: "Closing balance",
  order:
    "Entries appear in posting order. The running balance includes every preceding entry in this saved report.",
  entries: "Transactions",
  date: "Date",
  voucher: "Voucher",
  description: "Description",
  balance: "Balance",
  more: "Load more transactions",
  empty: "No transactions in this period",
  emptyDetail: "The opening balance carries forward unchanged.",
};

const swedish: typeof english = {
  retry: "Försök igen",
  opening: "Ingående saldo",
  debit: "Debet",
  credit: "Kredit",
  closing: "Utgående saldo",
  order:
    "Raderna visas i bokföringsordning. Löpande saldo inkluderar alla föregående rader i den sparade rapporten.",
  entries: "Transaktioner",
  date: "Datum",
  voucher: "Verifikat",
  description: "Beskrivning",
  balance: "Saldo",
  more: "Läs in fler transaktioner",
  empty: "Inga transaktioner under perioden",
  emptyDetail: "Det ingående saldot förs vidare oförändrat.",
};
