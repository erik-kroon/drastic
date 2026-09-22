import { useQuery } from "@tanstack/react-query";
import { LedgerSnapshot } from "@open-erp/contracts/accounting";
import { Box } from "@open-erp/ui/components/box";
import { DataTable } from "@open-erp/ui/components/data-table";
import { PageCaption } from "@open-erp/ui/components/accounting-page";
import { AccountingStatus } from "@/components/accounting-status";
import { useBookWorkspace } from "@/lib/book-context";
import { bookKey, bookPath, readAccounting } from "@/lib/accounting-api";
import { workQueryOptions, formatMinorAmount } from "@/lib/workspace-api";
import { frontendCopy } from "@/lib/frontend-copy";
import { accountingCopy } from "@/lib/accounting-copy";

export function ChartOfAccounts() {
  const { setup, locale } = useBookWorkspace();
  const copy = accountingCopy(locale);
  return (
    <DataTable
      title={frontendCopy(locale).chart}
      narrow="stack"
      columns={[
        { id: "code", label: copy.journal_account },
        { id: "name", label: copy.journal_description },
        { id: "status", label: copy.journal_active },
      ]}
      rows={setup.accounts.map((account) => ({
        id: account.id,
        cells: [
          account.code,
          account.name,
          account.active ? copy.journal_active : copy.journal_inactive,
        ],
      }))}
    />
  );
}
export function AccountBalances() {
  const { book, locale } = useBookWorkspace();
  const copy = frontendCopy(locale);
  const metadata = useQuery(workQueryOptions(book, {}));
  const scale = metadata.data?.currencyScale;
  const ledger = useQuery({
    queryKey: [...bookKey(book), "ledger"],
    queryFn: ({ signal }) => readAccounting(`${bookPath(book)}/ledger`, LedgerSnapshot, { signal }),
    retry: false,
  });
  const amount = (minor: string) =>
    scale === undefined ? "—" : formatMinorAmount(minor, scale, locale);
  return (
    <Box display="grid" gap="lg" minWidth="zero">
      <PageCaption>
        {copy.ledger} · {book.currency}
      </PageCaption>
      <AccountingStatus
        locale={locale}
        pending={ledger.isPending}
        error={ledger.error ?? metadata.error}
      />
      {ledger.data && !ledger.isError ? (
        <DataTable
          title={copy.ledger}
          narrow="stack"
          columns={[
            { id: "account", label: copy.accounts },
            { id: "debit", label: copy.debit, numeric: true },
            { id: "credit", label: copy.credit, numeric: true },
            { id: "balance", label: copy.balance, numeric: true },
          ]}
          rows={ledger.data.accounts.map((account) => ({
            id: account.accountId,
            cells: [
              `${account.code} · ${account.name}`,
              amount(account.debitMinor),
              amount(account.creditMinor),
              amount(account.balanceMinor),
            ],
          }))}
        />
      ) : null}
    </Box>
  );
}
