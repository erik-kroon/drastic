import { createFileRoute } from "@tanstack/react-router";
import { PageContent } from "@open-erp/ui/components/accounting-page";
import { RecordSummary, RecordFact, RecordSection } from "@open-erp/ui/components/record-layout";
import { Box } from "@open-erp/ui/components/box";
import { DataTable } from "@open-erp/ui/components/data-table";
import { WorkspaceHeader } from "@open-erp/ui/components/workspace";
import { Text } from "@open-erp/ui/components/typography";
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
      <WorkspaceHeader title={copy.workspace_settings} />
      <PageContent>
        <RecordSummary>
          <RecordFact label={locale === "sv" ? "Bok" : "Book"}>{book.name}</RecordFact>
          <RecordFact label={locale === "sv" ? "Valuta" : "Currency"}>{book.currency}</RecordFact>
          <RecordFact label={locale === "sv" ? "Behörighet" : "Access"}>
            {book.role === "operator"
              ? locale === "sv"
                ? "Operatör"
                : "Operator"
              : locale === "sv"
                ? "Automatisering"
                : "Automation"}
          </RecordFact>
        </RecordSummary>
        <RecordSection title={locale === "sv" ? "Språk" : "Language"}>
          <LanguagePreference locale={locale} />
        </RecordSection>
        {setup.warnings.map((warning) => (
          <Text key={warning}>{warning}</Text>
        ))}
        <RecordSection title={copy.journal_periods}>
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
        </RecordSection>
        <RecordSection title={copy.journal_accounts}>
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
        </RecordSection>
      </PageContent>
    </Box>
  );
}
