import { useQuery } from "@tanstack/react-query";
import * as Closing from "@open-erp/contracts/closing";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import {
  RegisterWorkspace,
  RegisterCheckRow,
  RegisterDetailHeading,
  RegisterNavigation,
} from "@open-erp/ui/components/register-workspace";
import { PeriodRegister } from "@open-erp/ui/components/period-register";
import { FormDialog } from "@open-erp/ui/components/form-dialog";
import { DataTable } from "@open-erp/ui/components/data-table";
import { Text } from "@open-erp/ui/components/typography";
import { ContactPreviewLayout } from "@open-erp/ui/components/contact-register";
import { WorkReviewFooter, WorkReviewAction } from "@open-erp/ui/components/work-controls";
import { PageAction, PageCaption, PageEmpty } from "@open-erp/ui/components/accounting-page";
import { Disclosure } from "@open-erp/ui/components/workflow";
import { AccountingStatus } from "@/components/accounting-status";
import { useBookWorkspace, workspacePath } from "@/lib/book-context";
import { bookKey, bookPath, readAccounting } from "@/lib/accounting-api";
import { PeriodClosing } from "./panel";
import { readinessNames, readinessHelp } from "./readiness-copy";
import { ClosingReview } from "./review";
import { PeriodInventoryEditor } from "./inventory-editor";
import { useState, type ReactNode } from "react";

export function ClosingWorkspace({
  recordId,
  onOpen,
  title,
  navigation,
}: {
  title: string;
  navigation: ReactNode;
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

  const detail = (
    <ContactPreviewLayout>
      <RegisterDetailHeading
        title={`${period.startsOn} – ${period.endsOn}`}
        note={
          basis
            ? basis.locked
              ? labels.locked
              : sv
                ? `${basis.checks.filter((check) => !check.passed).length} kontroller återstår innan perioden kan låsas.`
                : `${basis.checks.filter((check) => !check.passed).length} checks remain before the period can be locked.`
            : undefined
        }
      />
      <AccountingStatus locale={locale} pending={readiness.isPending} error={readiness.error} />
      {basis ? (
        <>
          <ReadinessChecklist
            checks={basis.checks}
            locale={locale}
            base={workspacePath(book)}
            onReviewScope={() => setReviewingScope(true)}
          />

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
          <Disclosure compact title={labels.remainingYearEndRequirements}>
            {basis.statutoryBlockers.map((blocker) => (
              <Text key={blocker}>{blocker}</Text>
            ))}
            <PageCaption>{labels.aPeriodLockProtectsThe}</PageCaption>
            <Button variant="outline" onClick={() => setPreparing(true)}>
              {labels.preparePeriodLock}
            </Button>
          </Disclosure>
          <WorkReviewFooter>
            <Box display="grid" gap="sm">
              <WorkReviewAction
                variant="outline"
                disabled={
                  (!basis.locked && !basis.technicalCloseAllowed) || book.role !== "operator"
                }
                onClick={() => setPreparing(true)}
              >
                {basis.locked
                  ? sv
                    ? "Öppna perioden igen"
                    : "Reopen period"
                  : sv
                    ? "Lås perioden"
                    : "Lock period"}
              </WorkReviewAction>
              <PageCaption>
                {sv
                  ? "Knappen blir tillgänglig när alla kontroller är klara."
                  : "The button becomes available when all checks are complete."}
              </PageCaption>
            </Box>
          </WorkReviewFooter>
        </>
      ) : null}
    </ContactPreviewLayout>
  );

  return (
    <RegisterWorkspace
      title={title}
      tabs={
        navigation ?? (
          <RegisterNavigation
            label={title}
            options={[
              {
                label: sv ? "Perioder" : "Periods",
                href: `${workspacePath(book)}/closing`,
                active: true,
              },
            ]}
          />
        )
      }
      detail={detail}
      detailSize="wide"
      headingSpacing="work"
    >
      <PeriodRegister
        labels={{
          period: labels.period,
          status: sv ? "Status" : "Status",
          result: sv ? "Resultat" : "Result",
        }}
        selected={period.id}
        rows={[...setup.periods].reverse().map((item) => ({
          id: item.id,
          period: `${item.startsOn} – ${item.endsOn}`,
          locked: item.locked,
          status: item.locked
            ? labels.locked
            : basis && item.id === period.id
              ? `${labels.open}, ${basis.checks.filter((check) => !check.passed).length} ${sv ? "kvar" : "remaining"}`
              : labels.open,
          result: "—",
        }))}
        onSelect={(id) => {
          setProposal("");
          setPreparing(false);
          setReviewingScope(false);
          onOpen(id);
        }}
      />
    </RegisterWorkspace>
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
  const pending = checks.filter((check) => !check.passed);
  const completed = checks.filter((check) => check.passed);

  return (
    <Box display="grid" gap="none" marginBlockStart="md">
      <Box display="grid" gap="none">
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
        compact
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
      <Disclosure compact title={locale === "sv" ? "Kontrollernas detaljer" : "Check details"}>
        <DataTable
          title={locale === "sv" ? "Checklista" : "Readiness checklist"}
          columns={[
            { id: "check", label: locale === "sv" ? "Kontroll" : "Check" },
            { id: "detail", label: locale === "sv" ? "Underlag" : "Basis" },
          ]}
          rows={checks.map((check) => ({
            id: check.code,
            cells: [
              readinessNames.get(check.code)?.[locale] ?? check.code,
              readinessHelp.get(check.code)?.[locale] ?? check.detail,
            ],
          }))}
        />
      </Disclosure>
    </Box>
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
    <RegisterCheckRow
      title={name}
      completed={check.passed}
      action={
        !check.passed && scope ? (
          <Button static variant="ghost" onClick={onReviewScope}>
            {locale === "sv" ? "Granska" : "Review"}
          </Button>
        ) : !check.passed && destination ? (
          <PageAction compact quiet href={`${base}/${destination.path}`}>
            {locale === "sv" ? "Öppna" : "Open"}
          </PageAction>
        ) : (
          <PageCaption>
            {check.passed
              ? locale === "sv"
                ? "Klart"
                : "Done"
              : locale === "sv"
                ? "Återstår"
                : "Pending"}
          </PageCaption>
        )
      }
    />
  );
}

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
