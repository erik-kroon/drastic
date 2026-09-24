import { createFileRoute } from "@tanstack/react-router";
import { PageCaption, PageContent } from "@open-erp/ui/components/accounting-page";
import { RecordSummary, RecordFact, RecordSection } from "@open-erp/ui/components/record-layout";
import { Box } from "@open-erp/ui/components/box";
import { DataTable } from "@open-erp/ui/components/data-table";
import { Disclosure } from "@open-erp/ui/components/workflow";
import { WorkspaceHeader } from "@open-erp/ui/components/workspace";
import { Link } from "@open-erp/ui/components/link";
import { Text } from "@open-erp/ui/components/typography";
import { LanguagePreference } from "@/components/book-workspace";
import { useBookWorkspace, workspacePath } from "@/lib/book-context";
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
        <Box width="fit">
          <LanguagePreference locale={locale} />
        </Box>

        <RecordSection title={copy.journal_periods}>
          <DataTable
            title={copy.journal_periods}
            narrow="stack"
            columns={[
              { id: "dates", label: copy.workspace_period },
              { id: "status", label: "Status" },
            ]}
            rows={setup.periods.map((period) => ({
              id: period.id,
              cells: [
                <Link
                  key="period"
                  href={`${workspacePath(book)}/closing?record=${encodeURIComponent(period.id)}`}
                >
                  {period.startsOn} – {period.endsOn}
                </Link>,
                period.locked ? copy.journal_locked : copy.journal_open,
              ],
            }))}
          />
        </RecordSection>
        <RecordSection title={copy.journal_accounts}>
          <PageCaption>
            {locale === "sv"
              ? "Sök efter konton och se vilka som är aktiva i kontoplanen."
              : "Find accounts and check their status in the chart of accounts."}
          </PageCaption>
          <Link href={`${workspacePath(book)}/books?view=accounts`}>
            {locale === "sv" ? "Öppna kontoplanen" : "Open chart of accounts"}
          </Link>
        </RecordSection>
        <Disclosure
          title={locale === "sv" ? "Profilens begränsningar" : "Workspace profile limitations"}
        >
          {setup.warnings.map((warning) => (
            <Text key={warning}>{warning}</Text>
          ))}
        </Disclosure>
      </PageContent>
    </Box>
  );
}
