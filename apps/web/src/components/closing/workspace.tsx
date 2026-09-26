import { useQuery } from "@tanstack/react-query";
import * as Closing from "@open-erp/contracts/closing";
import { CheckCircle2, Circle, LockKeyhole } from "lucide-react";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { SelectField } from "@open-erp/ui/components/field";
import { Badge } from "@open-erp/ui/components/badge";
import { FormDialog } from "@open-erp/ui/components/form-dialog";
import { DataTable } from "@open-erp/ui/components/data-table";
import { Text } from "@open-erp/ui/components/typography";
import {
  RecordHeading,
  RecordSection,
  RecordSummary,
  RecordFact,
} from "@open-erp/ui/components/record-layout";
import { PageAction, PageCaption, PageEmpty } from "@open-erp/ui/components/accounting-page";
import { Disclosure } from "@open-erp/ui/components/workflow";
import { AccountingStatus } from "@/components/accounting-status";
import { useBookWorkspace, workspacePath } from "@/lib/book-context";
import { bookKey, bookPath, readAccounting } from "@/lib/accounting-api";
import { PeriodClosing } from "./panel";
import { ClosingReview } from "./review";
import { PeriodInventoryEditor } from "./inventory-editor";
import { useState } from "react";

export function ClosingWorkspace({
  recordId,
  onOpen,
}: {
  recordId?: string;
  onOpen: (id: string) => void;
}) {
  const { book, setup, locale } = useBookWorkspace();
  const sv = locale === "sv";
  const labels = sv ? swedish : english;
  const period = setup.periods.find((item) => item.id === recordId) ?? setup.periods.at(-1);
  const [proposal, setProposal] = useState("");
  const [preparing, setPreparing] = useState(false);
  const [reviewingScope, setReviewingScope] = useState(false);

  const readiness = useQuery({
    queryKey: [...bookKey(book), "closing-readiness", period?.id],
    enabled: !!period,
    queryFn: async ({ signal }) => {
      const result = await readAccounting(
        `${bookPath(book)}/periods/${encodeURIComponent(period?.id ?? "")}/closing-readiness`,
        Closing.ClosingReadiness,
        { signal },
      );

      if (
        result.scope.bookId !== book.id ||
        result.scope.entityId !== book.entityId ||
        result.periodId !== period?.id
      )
        throw new Error("Closing scope mismatch");

      return result;
    },
    retry: false,
  });

  const basis = readiness.isError ? undefined : readiness.data;

  if (!period)
    return <PageEmpty title={labels.noAccountingPeriod} detail={labels.setUpAnAccountingPeriod} />;

  return (
    <Box display="grid" gap="xl">
      <RecordHeading
        title={labels.getThePeriodReady}
        subtitle={labels.seeWhatIsCompleteAnd}
        action={
          setup.periods.length > 1 ? (
            <Box width="fit">
              <SelectField
                label={labels.period}
                value={period.id}
                onValueChange={(value) => {
                  setProposal("");
                  setPreparing(false);
                  setReviewingScope(false);

                  if (value) onOpen(value);
                }}
                options={setup.periods.map((item) => ({
                  value: item.id,
                  label: `${item.startsOn} – ${item.endsOn}`,
                }))}
              />
            </Box>
          ) : undefined
        }
      />
      <AccountingStatus locale={locale} pending={readiness.isPending} error={readiness.error} />
      {basis ? (
        <>
          <RecordSummary>
            <RecordFact label="Status">
              <Badge variant={basis.locked ? "secondary" : "outline"}>
                {basis.locked ? labels.locked : labels.open}
              </Badge>
            </RecordFact>
            <RecordFact label={labels.checksComplete}>
              {basis.checks.filter((check) => check.passed).length} / {basis.checks.length}
            </RecordFact>
            <RecordFact label={labels.periodEnd}>{basis.endsOn}</RecordFact>
          </RecordSummary>
          <ReadinessChecklist
            checks={basis.checks}
            locale={locale}
            base={workspacePath(book)}
            onReviewScope={() => setReviewingScope(true)}
          />
          <Box display="flex" gap="md" flexWrap="wrap">
            <Button onClick={() => setReviewingScope(true)} disabled={book.role !== "operator"}>
              {sv ? "Granska periodens områden" : "Review period scope"}
            </Button>
            <Button variant="outline" onClick={() => setPreparing(!preparing)}>
              <LockKeyhole size={14} />
              {preparing ? labels.closePeriodControls : labels.preparePeriodLock}
            </Button>
          </Box>
          {preparing ? (
            <FormDialog
              size="compact"
              title={
                basis.locked
                  ? sv
                    ? "Öppna perioden igen"
                    : "Reopen period"
                  : labels.preparePeriodLock
              }
              closeLabel={sv ? "Stäng" : "Close"}
              onClose={() => setPreparing(false)}
            >
              <PeriodClosing
                key={period.id}
                book={book}
                locale={locale}
                periodId={period.id}
                customerView
                onPrepared={(id) => {
                  setProposal(id);
                  setPreparing(false);
                }}
              />
            </FormDialog>
          ) : null}
          {reviewingScope ? (
            <FormDialog
              title={sv ? "Periodens områden" : "Period scope"}
              closeLabel={sv ? "Stäng" : "Close"}
              onClose={() => setReviewingScope(false)}
            >
              <PeriodInventoryEditor
                key={period.id}
                basis={basis}
                onSaved={() => setReviewingScope(false)}
              />
            </FormDialog>
          ) : null}
          {proposal ? (
            <ClosingReview key={proposal} book={book} locale={locale} id={proposal} />
          ) : null}
          <Disclosure title={labels.remainingYearEndRequirements}>
            {basis.statutoryBlockers.map((blocker) => (
              <Text key={blocker}>{blocker}</Text>
            ))}
          </Disclosure>
          <PageCaption>{labels.aPeriodLockProtectsThe}</PageCaption>
        </>
      ) : null}
    </Box>
  );
}

const english = {
  noAccountingPeriod: "No accounting period",
  setUpAnAccountingPeriod: "Set up an accounting period before preparing year-end.",
  getThePeriodReady: "Get the period ready",
  seeWhatIsCompleteAnd: "See what is complete and what needs attention before locking the books.",
  period: "Period",
  locked: "Locked",
  open: "Open",
  checksComplete: "Checks complete",
  periodEnd: "Period end",
  readinessChecklist: "Readiness checklist",
  closePeriodControls: "Close period controls",
  preparePeriodLock: "Prepare period lock",
  remainingYearEndRequirements: "Remaining year-end requirements",
  aPeriodLockProtectsThe:
    "A period lock protects the books. It does not mean an annual report or tax return has been filed.",
};

const swedish: typeof english = {
  noAccountingPeriod: "Ingen räkenskapsperiod",
  setUpAnAccountingPeriod: "Lägg upp en period innan du förbereder bokslutet.",
  getThePeriodReady: "Gör perioden klar",
  seeWhatIsCompleteAnd: "Se vad som är klart och vad som återstår före låsning.",
  period: "Period",
  locked: "Låst",
  open: "Öppen",
  checksComplete: "Kontroller klara",
  periodEnd: "Periodslut",
  readinessChecklist: "Checklista",
  closePeriodControls: "Stäng periodverktyg",
  preparePeriodLock: "Förbered periodlåsning",
  remainingYearEndRequirements: "Kvarstående krav för årsavslut",
  aPeriodLockProtectsThe:
    "En periodlåsning skyddar bokföringen. Den innebär inte att årsredovisning eller deklaration har lämnats in.",
};

function ReadinessChecklist({
  checks,
  locale,
  base,
  onReviewScope,
}: {
  checks: readonly (typeof Closing.ClosingCheck.Type)[];
  locale: "en" | "sv";
  base: string;
  onReviewScope: () => void;
}) {
  const labels = locale === "sv" ? swedish : english;
  const pending = checks.filter((check) => !check.passed);
  const completed = checks.filter((check) => check.passed);

  return (
    <RecordSection title={labels.readinessChecklist}>
      <Box display="grid" gap="sm">
        {pending.map((check) => (
          <ReadinessCheck
            key={check.code}
            check={check}
            locale={locale}
            base={base}
            onReviewScope={onReviewScope}
          />
        ))}
      </Box>
      <Disclosure
        title={`${completed.length} ${locale === "sv" ? "kontroller klara" : "checks completed"}`}
      >
        <Box display="grid" gap="sm">
          {completed.map((check) => (
            <ReadinessCheck
              key={check.code}
              check={check}
              locale={locale}
              base={base}
              onReviewScope={onReviewScope}
            />
          ))}
        </Box>
      </Disclosure>
      <Disclosure title={locale === "sv" ? "Kontrollernas detaljer" : "Check details"}>
        <DataTable
          title={labels.readinessChecklist}
          columns={[
            { id: "check", label: locale === "sv" ? "Kontroll" : "Check" },
            { id: "detail", label: locale === "sv" ? "Underlag" : "Basis" },
          ]}
          rows={checks.map((check) => ({
            id: check.code,
            cells: [readinessNames.get(check.code)?.[locale] ?? check.code, check.detail],
          }))}
        />
      </Disclosure>
    </RecordSection>
  );
}

function ReadinessCheck({
  check,
  locale,
  base,
  onReviewScope,
}: {
  check: typeof Closing.ClosingCheck.Type;
  locale: "en" | "sv";
  base: string;
  onReviewScope: () => void;
}) {
  const name = readinessNames.get(check.code)?.[locale] ?? check.code;
  const destination = readinessDestinations.get(check.code);
  const scope = check.code === "DeclaredBankInventory" || check.code === "CompleteFamilyInventory";

  return (
    <Box display="flex" gap="lg" alignItems="start" paddingBlock="md">
      <Box paddingBlock="md">
        {check.passed ? (
          <CheckCircle2 size={18} strokeWidth={1.5} />
        ) : (
          <Circle size={18} strokeWidth={1.5} />
        )}
      </Box>
      <Box flexGrow minWidth="zero" display="grid" gap="sm">
        <Text>{name}</Text>
        {!check.passed ? (
          <PageCaption>{readinessHelp.get(check.code)?.[locale] ?? check.detail}</PageCaption>
        ) : null}
      </Box>
      {!check.passed && scope ? (
        <Button static variant="outline" onClick={onReviewScope}>
          {locale === "sv" ? "Granska omfattning" : "Review scope"}
        </Button>
      ) : null}
      {!check.passed && destination ? (
        <PageAction quiet href={`${base}/${destination.path}`}>
          {destination[locale]}
        </PageAction>
      ) : null}
    </Box>
  );
}

const readinessHelp = new Map<string, { en: string; sv: string }>([
  [
    "DeclaredBankInventory",
    {
      en: "Name the bank accounts that belong to this period and confirm the supporting records.",
      sv: "Ange periodens bankkonton och bekräfta underlagen som hör till dem.",
    },
  ],
  [
    "CurrentTrialBalance",
    {
      en: "Create a balanced trial balance for this exact period using the latest entries.",
      sv: "Skapa en balanserad saldobalans för hela perioden med de senaste bokförda posterna.",
    },
  ],
  [
    "RepresentedBankSources",
    {
      en: "Reconcile the imported statements against the books for the full period.",
      sv: "Stäm av importerade kontoutdrag mot bokföringen för hela perioden.",
    },
  ],
  [
    "ExpenseControlCoverage",
    {
      en: "Expense reviews are recorded, but complete posting and reconciliation coverage is not yet supported. This check still blocks closing.",
      sv: "Utgiftsgranskningar sparas, men fullständig kontroll av bokföring och avstämning stöds ännu inte. Kontrollen blockerar periodlåsning.",
    },
  ],
  [
    "VatReturnControlCoverage",
    {
      en: "VAT records can be reviewed. Complete tax controls are not yet supported, so the period remains blocked.",
      sv: "Momsunderlagen kan granskas. Fullständiga skattekontroller stöds ännu inte, så perioden förblir blockerad.",
    },
  ],
  [
    "CompleteFamilyInventory",
    {
      en: "Review each closing area and record what applies, what does not, and what is still unknown.",
      sv: "Gå igenom varje bokslutsområde och ange vad som gäller, vad som inte gäller och vad som ännu är okänt.",
    },
  ],
]);

const readinessDestinations = new Map<string, { path: string; en: string; sv: string }>([
  [
    "CurrentTrialBalance",
    { path: "reports?view=trial", en: "Create trial balance", sv: "Skapa saldobalans" },
  ],
  [
    "RepresentedBankSources",
    { path: "accounts", en: "Review bank accounts", sv: "Granska bankkonton" },
  ],
  ["RegisteredCommerce", { path: "sales", en: "Review invoices", sv: "Granska fakturor" }],
  [
    "ExpenseReviewCurrentness",
    { path: "purchases?view=expenses", en: "Review expenses", sv: "Granska utgifter" },
  ],
  [
    "ExpenseControlCoverage",
    { path: "purchases?view=expenses", en: "Review expenses", sv: "Granska utgifter" },
  ],
  ["VatReturnControlCoverage", { path: "tax?view=vat", en: "Review VAT", sv: "Granska moms" }],
  [
    "ScheduleBasisCoverage",
    { path: "reports?view=subledgers", en: "Review assets", sv: "Granska tillgångar" },
  ],
  [
    "SubledgerControlCoverage",
    {
      path: "reports?view=subledgers",
      en: "Review asset controls",
      sv: "Granska tillgångskontroller",
    },
  ],
  [
    "RepresentedSchedules",
    { path: "reports?view=subledgers", en: "Review schedules", sv: "Granska planer" },
  ],
]);

const readinessNames = new Map<string, { en: string; sv: string }>([
  ["DeclaredBankInventory", { en: "Expected bank accounts", sv: "Förväntade bankkonton" }],
  ["SyntheticNativeProfile", { en: "Book profile", sv: "Bokprofil" }],
  ["PeriodBoundaries", { en: "Period dates", sv: "Perioddatum" }],
  ["CurrentTrialBalance", { en: "Current trial balance", sv: "Aktuell saldobalans" }],
  ["RepresentedBankSources", { en: "Bank reconciliation", sv: "Bankavstämning" }],
  ["RegisteredCommerce", { en: "Invoices and allocations", sv: "Fakturor och fördelningar" }],
  ["OwnerSourceReview", { en: "Owner transactions", sv: "Ägartransaktioner" }],
  ["ExpenseReviewCurrentness", { en: "Expense reviews", sv: "Utgiftsgranskningar" }],
  [
    "ExpenseControlCoverage",
    { en: "Expense accounting coverage", sv: "Utgifternas bokföringstäckning" },
  ],
  ["VatReturnControlCoverage", { en: "VAT controls", sv: "Momskontroller" }],
  [
    "ScheduleBasisCoverage",
    { en: "Asset and schedule sources", sv: "Tillgångars och planers underlag" },
  ],
  [
    "SubledgerControlCoverage",
    { en: "Asset accounting coverage", sv: "Tillgångarnas bokföringstäckning" },
  ],
  ["RepresentedSchedules", { en: "Scheduled entries", sv: "Planerade bokningar" }],
  [
    "CompleteFamilyInventory",
    { en: "Required closing areas", sv: "Obligatoriska bokslutsområden" },
  ],
]);
