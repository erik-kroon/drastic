import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import * as Accounting from "@open-erp/contracts/accounting";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { DataTable } from "@open-erp/ui/components/data-table";
import { Heading, Text } from "@open-erp/ui/components/typography";
import { AccountingStatus } from "@/components/accounting-status";
import { JournalCorrection } from "@/components/journal-correction";
import { SealedAction } from "@/components/journal-review";
import { bookKey, bookPath, readAccounting } from "@/lib/accounting-api";
import { accountingCopy } from "@/lib/accounting-copy";
import type { Locale } from "@/paraglide/runtime";

export function PostedRecords({
  book,
  locale,
  setup,
  onPrepared,
}: {
  book: typeof Accounting.Book.Type;
  locale: Locale;
  setup: typeof Accounting.BookSetup.Type | undefined;
  onPrepared: (id: string) => void;
}) {
  const copy = accountingCopy(locale);
  const vouchers = useInfiniteQuery({
    queryKey: [...bookKey(book), "vouchers"],
    initialPageParam: "0",
    queryFn: ({ signal, pageParam }) =>
      readAccounting(
        `${bookPath(book)}/vouchers?after=${encodeURIComponent(pageParam)}`,
        Accounting.VoucherPage,
        { signal },
      ),
    getNextPageParam: (page) => page.next,
    retry: false,
  });
  const ledger = useQuery({
    queryKey: [...bookKey(book), "ledger"],
    queryFn: ({ signal }) =>
      readAccounting(`${bookPath(book)}/ledger`, Accounting.LedgerSnapshot, { signal }),
    retry: false,
  });
  return (
    <Box as="section" display="grid" gap="2xl" minWidth="zero">
      <Box display="flex" justifyContent="between" alignItems="center" flexWrap="wrap" gap="lg">
        <Heading>{copy.journal_vouchers}</Heading>
        <Button
          size="xl"
          variant="outline"
          disabled={vouchers.isFetching || ledger.isFetching}
          onClick={() => {
            void vouchers.refetch();
            void ledger.refetch();
          }}
        >
          {copy.journal_refresh}
        </Button>
      </Box>
      <Text tone="muted">{copy.journal_units}</Text>
      <AccountingStatus locale={locale} pending={vouchers.isPending} error={vouchers.error} />
      {vouchers.data?.pages[0]?.items.length === 0 ? (
        <Text>{copy.journal_empty_vouchers}</Text>
      ) : null}
      {vouchers.data?.pages
        .flatMap((page) => page.items)
        .map((voucher) => (
          <details key={voucher.id}>
            <summary>
              {voucher.action.series}
              {voucher.number} · {voucher.action.postingDate} · {voucher.action.description}
            </summary>
            <Box display="grid" gap="md" paddingBlock="lg" minWidth="zero">
              <Text>
                {copy.journal_voucher}: {voucher.id} · {copy.journal_sequence}: {voucher.sequence}
              </Text>
              <Text tone="muted">
                {copy.journal_committed}: {voucher.recordedAt}
              </Text>
              <SealedAction
                book={book}
                action={voucher.action}
                locale={locale}
                setupAccounts={setup?.accounts ?? []}
              />
              {setup && setup.blockers.length === 0 ? (
                <JournalCorrection
                  book={book}
                  voucherId={voucher.id}
                  periods={setup.periods}
                  locale={locale}
                  onPrepared={onPrepared}
                />
              ) : null}
            </Box>
          </details>
        ))}
      {vouchers.hasNextPage ? (
        <Box>
          <Button
            size="xl"
            variant="outline"
            disabled={vouchers.isFetchingNextPage}
            onClick={() => {
              void vouchers.fetchNextPage();
            }}
          >
            {copy.journal_more}
          </Button>
        </Box>
      ) : null}
      <Heading>{copy.journal_ledger}</Heading>
      <AccountingStatus locale={locale} pending={ledger.isPending} error={ledger.error} />
      {ledger.data ? (
        <>
          <Text>
            {copy.journal_sequence}: {ledger.data.sequence}
          </Text>
          {ledger.data.accounts.length === 0 ? (
            <Text>{copy.journal_no_accounts}</Text>
          ) : (
            <DataTable
              title={`${copy.journal_ledger} · ${book.currency}`}
              narrow="stack"
              columns={[
                { id: "account", label: copy.journal_account },
                { id: "debit", label: copy.journal_debit, numeric: true },
                { id: "credit", label: copy.journal_credit, numeric: true },
                { id: "balance", label: copy.journal_balance, numeric: true },
              ]}
              rows={ledger.data.accounts.map((account) => ({
                id: account.accountId,
                cells: [
                  `${account.code} · ${account.name}`,
                  account.debitMinor,
                  account.creditMinor,
                  account.balanceMinor,
                ],
              }))}
            />
          )}
        </>
      ) : null}
    </Box>
  );
}
