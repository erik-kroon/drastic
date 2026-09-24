import { useState } from "react";
import { Box } from "@open-erp/ui/components/box";
import { DataTable } from "@open-erp/ui/components/data-table";
import {
  RegisterFilters,
  RegisterSearch,
  RegisterChoices,
  PageEmpty,
} from "@open-erp/ui/components/accounting-page";
import { RecordHeading } from "@open-erp/ui/components/record-layout";
import { useBookWorkspace } from "@/lib/book-context";
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
