import { useQuery } from "@tanstack/react-query";
import * as Closing from "@open-erp/contracts/closing";
import { CheckCircle2, Circle, LockKeyhole } from "lucide-react";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { SelectField } from "@open-erp/ui/components/field";
import { Badge } from "@open-erp/ui/components/badge";
import { Text } from "@open-erp/ui/components/typography";
import {
  RecordHeading,
  RecordSection,
  RecordSummary,
  RecordFact,
} from "@open-erp/ui/components/record-layout";
import { PageCaption, PageEmpty } from "@open-erp/ui/components/accounting-page";
import { Disclosure } from "@open-erp/ui/components/workflow";
import { Disclosure as CheckDisclosure } from "@open-erp/ui/components/disclosure";
import { AccountingStatus } from "@/components/accounting-status";
import { useBookWorkspace } from "@/lib/book-context";
import { bookKey, bookPath, readAccounting } from "@/lib/accounting-api";
import { PeriodClosing } from "./panel";
import { ClosingReview } from "./review";
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
          <Box width="fit">
            <SelectField
              label={labels.period}
              value={period.id}
              onValueChange={(value) => {
                setProposal("");
                setPreparing(false);
                if (value) onOpen(value);
              }}
              options={setup.periods.map((item) => ({
                value: item.id,
                label: `${item.startsOn} – ${item.endsOn}`,
              }))}
            />
          </Box>
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
          <ReadinessChecklist checks={basis.checks} locale={locale} />
          <Box>
            <Button variant="outline" onClick={() => setPreparing(!preparing)}>
              <LockKeyhole size={14} />
              {preparing ? labels.closePeriodControls : labels.preparePeriodLock}
            </Button>
          </Box>
          {preparing ? (
            <PeriodClosing
              key={period.id}
              book={book}
              locale={locale}
              periodId={period.id}
              onPrepared={setProposal}
            />
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
}: {
  checks: readonly (typeof Closing.ClosingCheck.Type)[];
  locale: "en" | "sv";
}) {
  const labels = locale === "sv" ? swedish : english;
  const pending = checks.filter((check) => !check.passed);
  const completed = checks.filter((check) => check.passed);
  return (
    <RecordSection title={labels.readinessChecklist}>
      <Box display="grid" gap="sm">
        {pending.map((check) => (
          <ReadinessCheck key={check.code} check={check} locale={locale} />
        ))}
      </Box>
      <Disclosure
        title={`${completed.length} ${locale === "sv" ? "kontroller klara" : "checks completed"}`}
      >
        <Box display="grid" gap="sm">
          {completed.map((check) => (
            <ReadinessCheck key={check.code} check={check} locale={locale} />
          ))}
        </Box>
      </Disclosure>
    </RecordSection>
  );
}

function ReadinessCheck({
  check,
  locale,
}: {
  check: typeof Closing.ClosingCheck.Type;
  locale: "en" | "sv";
}) {
  const name = readinessNames.get(check.code)?.[locale] ?? check.code;
  return (
    <Box display="flex" gap="md" alignItems="start">
      <Box paddingBlock="md">
        {check.passed ? (
          <CheckCircle2 size={18} strokeWidth={1.5} />
        ) : (
          <Circle size={18} strokeWidth={1.5} />
        )}
      </Box>
      <Box flexGrow minWidth="zero">
        <CheckDisclosure
          variant="inline"
          label={`${name} · ${check.passed ? (locale === "sv" ? "Kontrollerat" : "Checked") : locale === "sv" ? "Återstår" : "Needs attention"}`}
        >
          <Text>{check.detail}</Text>
        </CheckDisclosure>
      </Box>
    </Box>
  );
}
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
