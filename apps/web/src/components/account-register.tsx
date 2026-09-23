import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { LedgerSnapshot } from "@open-erp/contracts/accounting";
import { Box } from "@open-erp/ui/components/box";
import { DataTable } from "@open-erp/ui/components/data-table";
import {
  PageCaption,
  RegisterFilters,
  RegisterSearch,
  RegisterChoices,
  PageEmpty,
} from "@open-erp/ui/components/accounting-page";
import { RecordHeading } from "@open-erp/ui/components/record-layout";
import { AccountingStatus } from "@/components/accounting-status";
import { useBookWorkspace } from "@/lib/book-context";
import { bookKey, bookPath, readAccounting } from "@/lib/accounting-api";
import { workQueryOptions, formatMinorAmount } from "@/lib/workspace-api";
import { frontendCopy } from "@/lib/frontend-copy";
import { accountingCopy } from "@/lib/accounting-copy";

export function ChartOfAccounts() {
  const { setup, locale } = useBookWorkspace();
  const copy = accountingCopy(locale);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("active");
  const matching = setup.accounts.filter(
    (account) =>
      (status === "all" || (status === "active") === account.active) &&
      `${account.code} ${account.name}`
        .toLocaleLowerCase(locale)
        .includes(search.toLocaleLowerCase(locale)),
  );
  return (
    <Box display="grid" gap="lg">
      <RecordHeading
        title={frontendCopy(locale).chart}
        subtitle={
          locale === "sv" ? "Sök på kontonummer eller namn." : "Find an account by number or name."
        }
      />
      <RegisterFilters>
        <RegisterSearch
          aria-label={locale === "sv" ? "Sök konto" : "Search accounts"}
          placeholder={locale === "sv" ? "Sök kontonummer eller namn…" : "Search number or name…"}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <RegisterChoices
          label={locale === "sv" ? "Kontostatus" : "Account status"}
          value={status}
          onValueChange={setStatus}
          options={[
            { value: "active", label: copy.journal_active },
            { value: "inactive", label: copy.journal_inactive },
            { value: "all", label: locale === "sv" ? "Alla konton" : "All accounts" },
          ]}
        />
      </RegisterFilters>
      {matching.length ? (
        <DataTable
          title={frontendCopy(locale).chart}
          narrow="stack"
          columns={[
            { id: "code", label: copy.journal_account },
            { id: "name", label: copy.journal_description },
            { id: "status", label: copy.journal_active },
          ]}
          rows={matching.map((account) => ({
            id: account.id,
            cells: [
              account.code,
              account.name,
              account.active ? copy.journal_active : copy.journal_inactive,
            ],
          }))}
        />
      ) : (
        <PageEmpty title={locale === "sv" ? "Inga matchande konton" : "No matching accounts"} />
      )}
    </Box>
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
