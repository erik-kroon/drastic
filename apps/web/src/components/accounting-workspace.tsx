import { lazy, Suspense, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import * as Schema from "effect/Schema";
import * as Accounting from "@open-erp/contracts/accounting";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { DataTable } from "@open-erp/ui/components/data-table";
import { InputField } from "@open-erp/ui/components/field";
import { Heading, Text } from "@open-erp/ui/components/typography";
import { AccountingStatus } from "@/components/accounting-status";
import { PostingDraft } from "@/components/posting-recovery/draft";
import { PostingRecoveryReview } from "@/components/posting-recovery/review";
import { PostingRecoveryPanel } from "@/components/posting-recovery/panel";
import { postingCopy } from "@/components/posting-recovery/copy";
import { PostedRecords } from "@/components/posted-records";
import { CorrectionsPanel } from "@/components/corrections/corrections-panel";
import { correctionCopy } from "@/components/corrections/copy";
import { BankReconciliation } from "@/components/bank-reconciliation";
import { InternalReports } from "@/components/internal-reports";
import { BookReadiness } from "@/components/book-readiness";
import { settlementCopy } from "@/components/settlements/copy";
import { subledgerCopy } from "@/components/subledgers/copy";
import { closingCopy } from "@/components/closing/copy";
import { commerceCopy } from "@/components/commerce/copy";
import { reviewCopy } from "@/components/accountant-review/copy";
import { intakeCopy } from "@/components/source-intake/copy";
import { expenseTaxCopy } from "@/components/expense-tax/copy";
import { vatCopy } from "@/components/vat-returns/copy";
import { CaseSnapshots } from "@/components/case-snapshots";
import { RecurringPreparation } from "@/components/recurring-preparation";
import { bookKey, bookPath, readAccounting } from "@/lib/accounting-api";
import { accountingCopy } from "@/lib/accounting-copy";
import type { Locale } from "@/paraglide/runtime";

const BankSourceCoveragePanel = lazy(() =>
  import("@/components/bank-source-coverage/panel").then((module) => ({
    default: module.BankSourceCoveragePanel,
  })),
);
const BankMatchCandidatesPanel = lazy(() =>
  import("@/components/bank-match-candidates/panel").then((module) => ({
    default: module.BankMatchCandidatesPanel,
  })),
);
const BankAllocations = lazy(() =>
  import("@/components/settlements").then((module) => ({ default: module.BankAllocations })),
);
const BankMatchReversals = lazy(() =>
  import("@/components/bank-match-reversals/panel").then((module) => ({
    default: module.BankMatchReversals,
  })),
);
const SubledgersPanel = lazy(() =>
  import("@/components/subledgers/schedules").then((module) => ({
    default: module.SubledgersPanel,
  })),
);
const ExchangeRateReviewsPanel = lazy(() =>
  import("@/components/exchange-rates/panel").then((module) => ({
    default: module.ExchangeRateReviewsPanel,
  })),
);
const SubledgerControlsPanel = lazy(() =>
  import("@/components/subledger-controls/panel").then((module) => ({
    default: module.SubledgerControlsPanel,
  })),
);
const ClosingPanel = lazy(() =>
  import("@/components/closing/panel").then((module) => ({ default: module.ClosingPanel })),
);
const CommercePanel = lazy(() =>
  import("@/components/commerce/commerce-panel").then((module) => ({
    default: module.CommercePanel,
  })),
);

const AccountantReviewPanel = lazy(() =>
  import("@/components/accountant-review/panel").then((module) => ({
    default: module.AccountantReviewPanel,
  })),
);

const SourceIntake = lazy(() =>
  import("@/components/source-intake").then((module) => ({ default: module.SourceIntake })),
);

const ExpenseTaxPanel = lazy(() =>
  import("@/components/expense-tax/panel").then((module) => ({ default: module.ExpenseTaxPanel })),
);

const VatReturnsPanel = lazy(() =>
  import("@/components/vat-returns/panel").then((module) => ({ default: module.VatReturnsPanel })),
);

const OwnerRegisterPanel = lazy(() =>
  import("@/components/owner-register/owner-register-panel").then((module) => ({
    default: module.OwnerRegisterPanel,
  })),
);

export function AccountingWorkspace({
  book,
  locale,
}: {
  book: typeof Accounting.Book.Type;
  locale: Locale;
}) {
  const copy = accountingCopy(locale);
  const [planId, setPlanId] = useState<string | null>(null);
  const [draftNumber, setDraftNumber] = useState(0);
  const [inputError, setInputError] = useState("");
  const setup = useQuery({
    queryKey: [...bookKey(book), "setup"],
    queryFn: ({ signal }) =>
      readAccounting(`${bookPath(book)}/setup`, Accounting.BookSetup, { signal }),
    retry: false,
  });
  return (
    <Box display="grid" gap="2xl" minWidth="zero">
      <Box display="grid" gap="sm">
        <Heading>{book.name}</Heading>
        <Text tone="muted">
          {copy.journal_role}: {book.role} · {copy.journal_profile}: {book.profile} ·{" "}
          {book.currency}
        </Text>
      </Box>
      <WorkspaceSections
        journalAvailable={setup.data?.blockers.length === 0}
        bankAvailable={setup.data !== undefined}
        locale={locale}
      />
      <BookReadiness book={book} locale={locale} />
      <AccountingStatus locale={locale} pending={setup.isPending} error={setup.error} />
      {setup.isError ? (
        <Box>
          <Button
            size="xl"
            variant="outline"
            onClick={() => {
              void setup.refetch();
            }}
          >
            {copy.journal_retry}
          </Button>
        </Box>
      ) : null}
      {setup.data ? (
        <>
          <details>
            <summary>{copy.journal_setup}</summary>
            <Box display="grid" gap="lg" paddingBlock="lg" minWidth="zero">
              <DataTable
                title={copy.journal_accounts}
                narrow="stack"
                columns={[
                  { id: "code", label: copy.journal_account },
                  { id: "name", label: copy.journal_description },
                  { id: "state", label: copy.journal_active },
                ]}
                rows={setup.data.accounts.map((account) => ({
                  id: account.id,
                  cells: [
                    `${account.code} · ${account.id}`,
                    account.name,
                    account.active ? copy.journal_active : copy.journal_inactive,
                  ],
                }))}
              />
              <DataTable
                title={copy.journal_periods}
                narrow="stack"
                columns={[
                  { id: "id", label: "ID" },
                  { id: "dates", label: copy.journal_period },
                  { id: "state", label: copy.journal_open },
                ]}
                rows={setup.data.periods.map((period) => ({
                  id: period.id,
                  cells: [
                    period.id,
                    `${period.startsOn} – ${period.endsOn}`,
                    period.locked ? copy.journal_locked : copy.journal_open,
                  ],
                }))}
              />
            </Box>
          </details>
          {setup.data.warnings.length > 0 ? (
            <Box
              as="aside"
              aria-label={copy.journal_setup_warnings}
              display="grid"
              gap="sm"
              padding="lg"
              backgroundColor="muted"
              borderRadius="surface"
            >
              <Heading>{copy.journal_setup_warnings}</Heading>
              {setup.data.warnings.map((warning) => (
                <Text key={warning}>{warning}</Text>
              ))}
            </Box>
          ) : null}
          {setup.data.blockers.map((blocker) => (
            <Text key={blocker} role="alert">
              {blocker}
            </Text>
          ))}
          {setup.data.blockers.length === 0 ? (
            <PostingDraft
              key={draftNumber}
              book={book}
              setup={setup.data}
              locale={locale}
              onPrepared={setPlanId}
            />
          ) : null}
        </>
      ) : null}
      <details id="posting-recovery-section" tabIndex={-1}>
        <summary>{postingCopy(locale).title}</summary>
        <Box paddingBlock="lg" minWidth="zero">
          <PostingRecoveryPanel book={book} locale={locale} onPrepared={setPlanId} />
        </Box>
      </details>
      <Box
        as="form"
        display="grid"
        gap="md"
        onSubmit={(event) => {
          event.preventDefault();
          const id = new FormData(event.currentTarget).get("planId");
          if (!Schema.is(Accounting.Identifier)(id)) {
            setInputError(copy.journal_invalid);
            return;
          }
          setInputError("");
          setPlanId(id);
        }}
      >
        <Heading>{copy.journal_resume}</Heading>
        <InputField
          label={copy.journal_plan_id}
          name="planId"
          required
          pattern="[a-z][a-z0-9_\-]{2,127}"
        />
        <Box>
          <Button type="submit" size="xl" variant="outline">
            {copy.journal_load}
          </Button>
        </Box>
        <Text role="status">{inputError}</Text>
      </Box>
      {planId ? (
        <>
          <PostingRecoveryReview
            key={planId}
            book={book}
            id={planId}
            locale={locale}
            accounts={setup.data?.accounts ?? []}
          />
          <Box>
            <Button
              size="xl"
              variant="outline"
              onClick={() => {
                setPlanId(null);
                setDraftNumber(draftNumber + 1);
                void setup.refetch();
              }}
            >
              {copy.journal_new}
            </Button>
          </Box>
        </>
      ) : null}
      <details id="posted-records" tabIndex={-1}>
        <summary>{copy.section_vouchers}</summary>
        <Box paddingBlock="lg" minWidth="zero">
          <PostedRecords book={book} locale={locale} setup={setup.data} onPrepared={setPlanId} />
        </Box>
      </details>
      {setup.data ? <CorrectionsPanel book={book} setup={setup.data} locale={locale} /> : null}
      {setup.data ? (
        <Suspense fallback={<AccountingStatus locale={locale} pending={true} error={null} />}>
          <SourceIntake book={book} setup={setup.data} locale={locale} />
        </Suspense>
      ) : null}
      {setup.data ? <BankReconciliation book={book} setup={setup.data} locale={locale} /> : null}
      {setup.data ? (
        <Suspense fallback={<AccountingStatus locale={locale} pending={true} error={null} />}>
          <BankSourceCoveragePanel key={JSON.stringify(bookKey(book))} book={book} locale={locale} />
          <BankMatchCandidatesPanel key={JSON.stringify(bookKey(book))} book={book} locale={locale} />
          <BankAllocations book={book} setup={setup.data} locale={locale} />
          <BankMatchReversals key={JSON.stringify(bookKey(book))} book={book} locale={locale} />
        </Suspense>
      ) : null}
      <details id="owner-register" tabIndex={-1}>
        <summary>
          {locale === "sv" ? "Ägarutlägg och finansiering" : "Owner expenses and funding"}
        </summary>
        <Box paddingBlock="lg" minWidth="zero">
          <Suspense fallback={<AccountingStatus locale={locale} pending={true} error={null} />}>
            <OwnerRegisterPanel book={book} locale={locale} />
          </Suspense>
        </Box>
      </details>
      <details id="commerce" tabIndex={-1}>
        <summary>{commerceCopy(locale).title}</summary>
        <Box paddingBlock="lg" minWidth="zero">
          <Suspense fallback={<AccountingStatus locale={locale} pending={true} error={null} />}>
            <CommercePanel book={book} locale={locale} />
          </Suspense>
        </Box>
      </details>
      {setup.data ? (
        <Suspense fallback={<AccountingStatus locale={locale} pending={true} error={null} />}>
          <SubledgersPanel book={book} setup={setup.data} locale={locale} onPrepared={setPlanId} />
          <SubledgerControlsPanel key={JSON.stringify(bookKey(book))} book={book} setup={setup.data} locale={locale} />
          <ExchangeRateReviewsPanel book={book} locale={locale} />
        </Suspense>
      ) : null}
      {setup.data ? (
        <Suspense fallback={<AccountingStatus locale={locale} pending={true} error={null} />}>
          <ClosingPanel book={book} setup={setup.data} locale={locale} />
        </Suspense>
      ) : null}
      <Suspense fallback={<AccountingStatus locale={locale} pending={true} error={null} />}>
        <ExpenseTaxPanel key={book.id} book={book} locale={locale} onPrepared={setPlanId} />
      </Suspense>
      <Suspense fallback={<AccountingStatus locale={locale} pending={true} error={null} />}>
        <VatReturnsPanel key={JSON.stringify(bookKey(book))} book={book} locale={locale} />
      </Suspense>
      <InternalReports book={book} locale={locale} />
      <Suspense fallback={<AccountingStatus locale={locale} pending={true} error={null} />}>
        <AccountantReviewPanel key={book.id} book={book} locale={locale} />
      </Suspense>
      <CaseSnapshots book={book} locale={locale} onPrepared={setPlanId} />
      <RecurringPreparation book={book} setup={setup.data} locale={locale} onPrepared={setPlanId} />
    </Box>
  );
}

function WorkspaceSections({
  journalAvailable,
  bankAvailable,
  locale,
}: {
  journalAvailable: boolean;
  bankAvailable: boolean;
  locale: Locale;
}) {
  const copy = accountingCopy(locale);
  const sections = [
    { id: "journal-draft", label: copy.section_journal, disabled: !journalAvailable },
    { id: "posting-recovery-section", label: postingCopy(locale).title, disabled: false },
    { id: "posted-records", label: copy.section_vouchers, disabled: false },
    { id: "corrections", label: correctionCopy(locale).title, disabled: !bankAvailable },
    { id: "source-intake", label: intakeCopy(locale).title, disabled: !bankAvailable },
    { id: "bank-reconciliation", label: copy.section_bank, disabled: !bankAvailable },
    { id: "internal-reports", label: copy.section_reports, disabled: false },
    { id: "accountant-review", label: reviewCopy(locale).title, disabled: false },
    { id: "expense-tax", label: expenseTaxCopy(locale).title, disabled: false },
    { id: "vat-returns", label: vatCopy(locale).title, disabled: false },
    { id: "case-snapshots", label: copy.section_cases, disabled: false },
    { id: "recurring-preparation", label: copy.section_preparation, disabled: false },
    { id: "bank-allocations", label: settlementCopy(locale).title, disabled: !bankAvailable },
    { id: "commerce", label: commerceCopy(locale).title, disabled: false },
    {
      id: "owner-register",
      label: locale === "sv" ? "Ägarutlägg och finansiering" : "Owner expenses and funding",
      disabled: false,
    },
    { id: "subledgers", label: subledgerCopy(locale).title, disabled: !bankAvailable },
    { id: "technical-closing", label: closingCopy(locale).title, disabled: !bankAvailable },
    { id: "book-readiness", label: copy.section_readiness, disabled: false },
  ];
  return (
    <Box as="nav" aria-label={copy.workspace_sections} display="flex" flexWrap="wrap" gap="sm">
      {sections.map((section) => (
        <Button
          key={section.id}
          size="xl"
          variant="ghost"
          disabled={section.disabled}
          onClick={() => {
            const target = document.getElementById(section.id);
            if (target instanceof HTMLDetailsElement) target.open = true;
            target?.focus();
          }}
        >
          {section.label}
        </Button>
      ))}
    </Box>
  );
}
