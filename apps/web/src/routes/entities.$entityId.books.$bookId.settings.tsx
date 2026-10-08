import { createFileRoute } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import { PageCaption } from "@open-erp/ui/components/accounting-page";
import { RecordSummary, RecordFact, RecordSection } from "@open-erp/ui/components/record-layout";
import { Box } from "@open-erp/ui/components/box";
import { DataTable } from "@open-erp/ui/components/data-table";
import { Disclosure } from "@open-erp/ui/components/workflow";
import { SettingsWorkspace } from "@open-erp/ui/components/settings-workspace";
import { Link } from "@open-erp/ui/components/link";
import { Text } from "@open-erp/ui/components/typography";
import { LanguagePreference } from "@/components/book-workspace";
import { useBookWorkspace, workspacePath } from "@/lib/book-context";
import { accountingCopy } from "@/lib/accounting-copy";
import { DimensionSettings } from "@/components/dimension-settings";
import { PayrollFoundation } from "@/components/payroll-foundation";
import { NativeLedgerSetup } from "@/components/company-setup/native-ledger";

export const Route = createFileRoute("/entities/$entityId/books/$bookId/settings")({
  validateSearch: Schema.decodeUnknownSync(
    Schema.Struct({
      section: Schema.optional(Schema.Literals(["home", "company", "accounting", "tax"])),
    }),
  ),
  component: Settings,
});

function Settings() {
  const { book, setup, locale } = useBookWorkspace();
  const copy = accountingCopy(locale);
  const { section = "home" } = Route.useSearch();
  const sv = locale === "sv";

  const sections = [
    { key: "home", label: sv ? "Hem" : "Home" },
    { key: "company", label: sv ? "Företag" : "Company" },
    { key: "accounting", label: sv ? "Bokföring" : "Accounting" },
    { key: "tax", label: sv ? "Skatt" : "Tax" },
  ];

  return (
    <SettingsWorkspace
      title={copy.workspace_settings}
      section={sections.find((item) => item.key === section)?.label ?? copy.workspace_settings}
      navigationLabel={copy.workspace_settings}
      items={sections.map((item) => ({
        label: item.label,
        href: `${workspacePath(book)}/settings?section=${item.key}`,
        active: item.key === section,
      }))}
    >
      {section === "home" || section === "company" ? (
        <>
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
          <Link href={`${workspacePath(book)}/setup`}>
            {locale === "sv" ? "Företagsuppgifter och inställning" : "Company details and setup"}
          </Link>
          <Box width="fit">
            <LanguagePreference locale={locale} />
          </Box>
        </>
      ) : null}
      {section === "accounting" ? (
        <>
          {book.profile === "company-setup-v1" &&
          setup.accounts.length === 0 &&
          setup.periods.length === 0 ? (
            <NativeLedgerSetup />
          ) : null}
          <DimensionSettings book={book} locale={locale} />
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
        </>
      ) : null}
      {section === "tax" ? <PayrollFoundation book={book} locale={locale} /> : null}

      <Disclosure
        title={locale === "sv" ? "Profilens begränsningar" : "Workspace profile limitations"}
      >
        {setup.warnings.map((warning) => (
          <Text key={warning}>{warning}</Text>
        ))}
      </Disclosure>
    </SettingsWorkspace>
  );
}
