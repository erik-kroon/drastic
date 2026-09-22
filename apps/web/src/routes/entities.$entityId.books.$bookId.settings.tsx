import { createFileRoute } from "@tanstack/react-router";
import { Box } from "@open-erp/ui/components/box";
import { DataTable } from "@open-erp/ui/components/data-table";
import { Heading, Text } from "@open-erp/ui/components/typography";
import { LanguagePreference } from "@/components/book-workspace";
import { useBookWorkspace } from "@/lib/book-context";
import { accountingCopy } from "@/lib/accounting-copy";

export const Route = createFileRoute("/entities/$entityId/books/$bookId/settings")({
  component: Settings,
});

function Settings() {
  const { book, setup, locale } = useBookWorkspace();
  const copy = accountingCopy(locale);
  return (
    <Box display="grid" gap="xl" minWidth="zero">
      <Heading level={1}>{copy.workspace_settings}</Heading>
      <LanguagePreference locale={locale} />
      <Text>
        {book.profile} · {book.role} · {book.currency}
      </Text>
      {setup.warnings.map((warning) => (
        <Text key={warning}>{warning}</Text>
      ))}
      <DataTable
        title={copy.journal_periods}
        narrow="stack"
        columns={[
          { id: "dates", label: copy.workspace_period },
          { id: "status", label: copy.journal_open },
        ]}
        rows={setup.periods.map((period) => ({
          id: period.id,
          cells: [
            `${period.startsOn} – ${period.endsOn}`,
            period.locked ? copy.journal_locked : copy.journal_open,
          ],
        }))}
      />
      <DataTable
        title={copy.journal_accounts}
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
    </Box>
  );
}
