import { useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type * as Accounting from "@open-erp/contracts/accounting";
import * as Subledgers from "@open-erp/contracts/subledgers";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { InputField, SelectField, TextareaField } from "@open-erp/ui/components/field";
import { ChoiceField } from "@open-erp/ui/components/choice-field";
import { RecordSection } from "@open-erp/ui/components/record-layout";
import { PageCaption } from "@open-erp/ui/components/accounting-page";
import { Disclosure } from "@open-erp/ui/components/workflow";
import { decimalToMinor, minorToDecimal, workQueryOptions } from "@/lib/workspace-api";
import { AccountingStatus } from "@/components/accounting-status";
import { EvidenceCommandForm } from "@/components/evidence-command-form";
import { bookPath } from "@/lib/accounting-api";
import type { Locale } from "@/paraglide/runtime";
import { subledgerCopy } from "./copy";

export function ScheduleForm(props: {
  book: typeof Accounting.Book.Type;
  setup: typeof Accounting.BookSetup.Type;
  locale: Locale;
  current?: typeof Subledgers.ScheduleRevision.Type;
  onSaved: (id: string) => void;
}) {
  const { book, setup, locale, current } = props;
  const copy = subledgerCopy(locale);
  const labels = locale === "sv" ? swedish : english;
  const terms = current?.terms;
  const metadata = useQuery(workQueryOptions(book, {}));
  const scale = metadata.data?.currencyScale;
  const policyId = useId();
  const [sourceKey] = useState(() => current?.sourceKey ?? `schedule_${crypto.randomUUID()}`);
  const [count, setCount] = useState(terms?.usefulPeriods ?? 1);

  const accounts = [
    { value: "", label: labels.chooseAccount },
    ...setup.accounts.map((account) => ({
      value: account.id,
      label: `${account.code} · ${account.name}`,
      disabled: !account.active,
    })),
  ];

  const periods = [
    { value: "", label: labels.choosePeriod },
    ...setup.periods.map((period) => ({
      value: period.id,
      label: `${period.startsOn} – ${period.endsOn}`,
      disabled: period.locked,
    })),
  ];

  if (scale === undefined || metadata.isError)
    return <AccountingStatus locale={locale} pending={metadata.isPending} error={metadata.error} />;

  return (
    <EvidenceCommandForm
      book={book}
      locale={locale}
      path={
        current
          ? `${bookPath(book)}/schedules/${encodeURIComponent(current.scheduleId)}/revisions`
          : `${bookPath(book)}/schedules`
      }
      schema={current ? Subledgers.ReviseSchedule : Subledgers.CreateSchedule}
      output={Subledgers.ScheduleRevision}
      label={current ? copy.revise : copy.create}
      stickyFooter
      source={(fields) => ({
        title: fieldText(fields, "name"),
        origin: "Schedule assessment entered in OpenERP",
        mediaType: "application/json",
        content: JSON.stringify({
          sourceKey,
          currency: book.currency,
          currencyScale: scale,
          fields: Object.fromEntries(fields.entries()),
        }),
      })}
      input={(fields, evidence) => {
        const nextTerms = {
          kind: fields.get("kind"),
          name: fields.get("name"),
          evidenceId: fields.get("evidenceId") || evidence.id,
          rationale: fields.get("rationale"),
          costMinor: decimalToMinor(fieldText(fields, "costMinor"), scale),
          residualMinor: decimalToMinor(fieldText(fields, "residualMinor"), scale),
          usefulPeriods: count,
          allocationPolicy: fields.get("allocationPolicy"),
          debitAccountId: fields.get("debitAccountId"),
          creditAccountId:
            fields.get("creditAccountId") === fields.get("debitAccountId")
              ? null
              : fields.get("creditAccountId"),
          series: fields.get("series"),
          taxAssessment: "not_applicable",
          periods: Array.from({ length: count }, (_, index) => ({
            postingDate: fields.get(`date_${index}`),
            accountingPeriodId: fields.get(`period_${index}`),
          })),
        };

        return current
          ? { expectedDigest: current.digest, terms: nextTerms }
          : { sourceKey, terms: nextTerms };
      }}
      onSuccess={(revision) => props.onSaved(revision.scheduleId)}
      footerSummary={<PageCaption>{labels.savedAsReview}</PageCaption>}
    >
      <Box display="grid" columns={1} columnsAtLg={2} gap="2xl" alignItems="start">
        <Box display="grid" gap="xl">
          <RecordSection title={labels.about}>
            <InputField
              label={copy.name}
              name="name"
              required
              maxLength={2000}
              defaultValue={terms?.name}
            />
            <ChoiceField
              label={copy.kind}
              name="kind"
              required
              defaultValue={terms?.kind ?? ""}
              options={[
                { value: "asset", label: copy.asset },
                { value: "deferral", label: copy.deferral },
              ]}
            />
            <TextareaField
              label={copy.rationale}
              name="rationale"
              required
              rows={3}
              maxLength={2000}
              defaultValue={terms?.rationale}
            />
          </RecordSection>
          <RecordSection title={labels.amounts}>
            <Box display="grid" columns={2} gap="lg">
              <InputField
                label={`${labels.cost} · ${book.currency}`}
                name="costMinor"
                inputMode="decimal"
                required
                defaultValue={terms ? minorToDecimal(terms.costMinor, scale) : ""}
              />
              <InputField
                label={`${labels.residual} · ${book.currency}`}
                name="residualMinor"
                inputMode="decimal"
                required
                defaultValue={terms ? minorToDecimal(terms.residualMinor, scale) : ""}
              />
            </Box>
          </RecordSection>
          <RecordSection title={labels.posting}>
            <SelectField
              label={copy.debit}
              name="debitAccountId"
              required
              options={accounts}
              defaultValue={terms?.debitAccountId ?? ""}
            />
            <SelectField
              label={copy.credit}
              name="creditAccountId"
              required
              options={accounts}
              defaultValue={terms?.creditAccountId ?? ""}
            />
            <InputField
              label={copy.series}
              name="series"
              required
              pattern="[A-Z0-9]{1,16}"
              defaultValue={terms?.series}
            />
          </RecordSection>
        </Box>
        <RecordSection title={labels.dates}>
          <PageCaption>{labels.dateHelp}</PageCaption>
          {Array.from({ length: count }, (_, index) => (
            <Box
              key={index}
              as="fieldset"
              display="grid"
              gap="md"
              minWidth="zero"
              padding="md"
              borderWidth="thin"
              borderColor="default"
              borderRadius="control"
            >
              <legend>
                {copy.occurrence} {index + 1}
              </legend>
              <InputField
                label={copy.date}
                name={`date_${index}`}
                type="date"
                required
                defaultValue={terms?.periods[index]?.postingDate}
              />
              <SelectField
                label={copy.period}
                name={`period_${index}`}
                required
                options={periods}
                defaultValue={terms?.periods[index]?.accountingPeriodId ?? ""}
              />
            </Box>
          ))}
          <Box display="flex" flexWrap="wrap" gap="md">
            <Button variant="outline" disabled={count >= 120} onClick={() => setCount(count + 1)}>
              {copy.add}
            </Button>
            <Button variant="ghost" disabled={count <= 1} onClick={() => setCount(count - 1)}>
              {copy.remove}
            </Button>
          </Box>
          <PageCaption>{copy.policyHelp}</PageCaption>
          <Box
            as="label"
            htmlFor={policyId}
            display="flex"
            alignItems="start"
            gap="md"
            paddingBlock="md"
          >
            <input
              id={policyId}
              type="checkbox"
              name="allocationPolicy"
              value="equal_minor_final_remainder_v1"
              required
            />
            {copy.policy}
          </Box>
        </RecordSection>
      </Box>
      <Disclosure title={labels.references}>
        <PageCaption>{labels.evidenceHelp}</PageCaption>
        <InputField
          label={copy.evidence}
          name="evidenceId"
          pattern="[a-z][a-z0-9_\-]{2,127}"
          defaultValue={terms?.evidenceId}
        />
        <PageCaption>{sourceKey}</PageCaption>
      </Disclosure>
    </EvidenceCommandForm>
  );
}

const english = {
  chooseAccount: "Choose account",
  choosePeriod: "Choose accounting period",
  about: "Asset or deferral",
  amounts: "Amounts",
  cost: "Source cost",
  residual: "Residual value",
  posting: "Posting accounts",
  dates: "Posting dates",
  dateHelp:
    "Add each date and its accounting period. No entries are posted when the schedule is saved.",
  savedAsReview:
    "Your entered assessment is retained with the schedule. Each posting needs its own review and approval.",
  references: "Existing source reference (optional)",
  evidenceHelp:
    "Use an existing retained evidence reference if this schedule is based on it. Otherwise, your entered details and assessment are retained as its source; they do not establish that original documents are complete.",
};

const swedish: typeof english = {
  chooseAccount: "Välj konto",
  choosePeriod: "Välj bokföringsperiod",
  about: "Tillgång eller periodisering",
  amounts: "Belopp",
  cost: "Anskaffningsvärde",
  residual: "Restvärde",
  posting: "Bokföringskonton",
  dates: "Bokföringsdatum",
  dateHelp: "Lägg till varje datum och dess bokföringsperiod. Inget bokförs när planen sparas.",
  savedAsReview:
    "Din bedömning sparas med planen. Varje bokföring kräver egen granskning och godkännande.",
  references: "Befintlig underlagsreferens (valfritt)",
  evidenceHelp:
    "Ange en befintlig bevarad referens om planen bygger på den. Annars sparas dina inmatade uppgifter och bedömning som underlag. De fastställer inte att originalunderlagen är kompletta.",
};

function fieldText(fields: FormData, name: string) {
  const value = fields.get(name);

  return typeof value === "string" ? value : "";
}
