import { useState } from "react";
import * as Tax from "@open-erp/contracts/expense-tax";
import { Box } from "@open-erp/ui/components/box";
import { InputField, SelectField, TextareaField } from "@open-erp/ui/components/field";
import { RecordSection, RecordColumns } from "@open-erp/ui/components/record-layout";
import { PageCaption } from "@open-erp/ui/components/accounting-page";
import { EvidenceCommandForm } from "@/components/evidence-command-form";
import { EvidenceInspector } from "@/components/evidence-inspector";
import { type CommerceProps } from "@/components/commerce/shared";
import { bookPath } from "@/lib/accounting-api";
import { decimalToMinor, minorToDecimal } from "@/lib/workspace-api";
import { expenseTaxCopy } from "./copy";
import { nullableValue } from "./forms";

export function ExpenseReviewForm(
  props: CommerceProps & { source: typeof Tax.TaxSourceView.Type; onSaved: () => void },
) {
  const [source] = useState(props.source);
  const sv = props.locale === "sv";
  const previous = source.reviewCurrent ? source.latestReview?.facts : null;
  const scale = source.current.facts.currencyScale;
  const copy = expenseTaxCopy(props.locale);
  return (
    <EvidenceCommandForm
      {...props}
      path={`${bookPath(props.book)}/expense-tax/sources/${source.current.sourceId}/reviews`}
      schema={Tax.ReviewTaxSource}
      output={Tax.TaxReview}
      label={sv ? "Spara granskning" : "Save review"}
      canSubmit={scale !== null}
      onSuccess={props.onSaved}
      source={(fields) => ({
        title: source.current.facts.description,
        origin: "Expense review entered in OpenERP",
        mediaType: "application/json",
        content: JSON.stringify({
          kind: "expense_review_entry_v1",
          sourceDigest: source.current.digest,
          fields: Object.fromEntries(fields),
        }),
      })}
      input={(fields, evidence) => ({
        sourceDigest: source.current.digest,
        expectedReviewDigest: source.latestReview?.digest ?? null,
        facts: {
          evidenceId: evidence.id,
          rationale: fields.get("rationale"),
          amounts: {
            grossMinor: amountField(fields, "gross", scale),
            netMinor: amountField(fields, "net", scale),
            vatMinor: amountField(fields, "vat", scale),
          },
          registration: fields.get("registration"),
          registrationEvidenceId: fields.get("registration") === "unknown" ? null : evidence.id,
          method: fields.get("method"),
          methodEvidenceId: fields.get("method") === "unknown" ? null : evidence.id,
          bookJurisdiction: nullableValue(fields, "bookJurisdiction"),
          suppliedOn: nullableValue(fields, "suppliedOn"),
          taxPointOn: nullableValue(fields, "taxPointOn"),
          dateBasis: nullableValue(fields, "dateBasis"),
          dateEvidenceId: nullableValue(fields, "dateBasis") ? evidence.id : null,
          treatment: fields.get("treatment"),
          profileId: fields.get("profile") === "synthetic" ? "synthetic-expense-tax" : null,
          profileVersion: fields.get("profile") === "synthetic" ? "1" : null,
          rateNumerator: percentFraction(fields, "rate").numerator,
          rateDenominator: percentFraction(fields, "rate").denominator,
          deductionNumerator: percentFraction(fields, "deduction").numerator,
          deductionDenominator: percentFraction(fields, "deduction").denominator,
          deductionBasis: nullableValue(fields, "deductionBasis"),
          deductionEvidenceId: nullableValue(fields, "deductionBasis") ? evidence.id : null,
          roundingPolicy: fields.get("roundingPolicy"),
        },
      })}
    >
      <RecordColumns>
        <RecordSection title={sv ? "Underlag" : "Source document"}>
          <EvidenceInspector
            {...props}
            expanded
            compact
            reference={{
              evidenceId: source.current.facts.evidenceId,
              sha256: source.current.evidenceSha256,
              locator: source.current.facts.sourceLocator,
            }}
          />
        </RecordSection>
        <Box display="grid" gap="xl">
          <RecordSection title={sv ? "Belopp att granska" : "Amounts to review"}>
            <PageCaption>
              {source.current.facts.currency ?? "—"}
              {scale === null
                ? sv
                  ? " · Valutans decimaler måste fastställas först."
                  : " · Establish the currency scale in the source first."
                : ""}
            </PageCaption>
            <Box display="grid" columns={3} gap="md">
              {(["gross", "net", "vat"] as const).map((name) => (
                <InputField
                  key={name}
                  name={name}
                  label={
                    name === "gross"
                      ? sv
                        ? "Totalt"
                        : "Total"
                      : name === "net"
                        ? sv
                          ? "Exkl. moms"
                          : "Before tax"
                        : sv
                          ? "Moms"
                          : "Tax"
                  }
                  inputMode="decimal"
                  defaultValue={displayAmount(
                    (previous?.amounts ?? source.current.facts.amounts)[`${name}Minor`],
                    scale,
                  )}
                />
              ))}
            </Box>
            <ReviewDecisions locale={props.locale} previous={previous} />
          </RecordSection>
          <RecordSection title={sv ? "Datum och motivering" : "Dates and reasoning"}>
            <Box display="grid" columns={2} gap="md">
              <InputField
                name="suppliedOn"
                type="date"
                label={copy.suppliedOn}
                defaultValue={previous?.suppliedOn ?? source.current.facts.suppliedOn ?? ""}
              />
              <InputField
                name="taxPointOn"
                type="date"
                label={copy.taxPointOn}
                defaultValue={previous?.taxPointOn ?? source.current.facts.taxPointOn ?? ""}
              />
            </Box>
            <InputField
              name="dateBasis"
              label={sv ? "Vad styr datumen?" : "What establishes these dates?"}
              defaultValue={previous?.dateBasis ?? ""}
              maxLength={2000}
            />
            <TextareaField
              name="rationale"
              label={sv ? "Granskningsanteckning" : "Review note"}
              required
              maxLength={2000}
              rows={3}
              defaultValue={previous?.rationale}
            />
          </RecordSection>
        </Box>
      </RecordColumns>
      <PageCaption>
        {sv
          ? "Granskningen sparar dina bedömningar och deras motivering. Den aktiverar inte en skatteprofil och bokför eller deklarerar ingenting."
          : "This saves your assessment and its basis. It does not activate a tax profile, post an expense or file a return."}
      </PageCaption>
    </EvidenceCommandForm>
  );
}
function ReviewDecisions(props: {
  locale: CommerceProps["locale"];
  previous: typeof Tax.TaxReviewFacts.Type | null | undefined;
}) {
  const sv = props.locale === "sv";
  const copy = expenseTaxCopy(props.locale);
  const previous = props.previous;
  return (
    <>
      <Box display="grid" columns={2} gap="md">
        <SelectField
          name="registration"
          label={copy.registration}
          defaultValue={previous?.registration ?? "unknown"}
          options={[
            { value: "unknown", label: copy.unknown },
            { value: "registered", label: copy.registered },
            { value: "not_registered", label: copy.notRegistered },
          ]}
        />
        <SelectField
          name="method"
          label={copy.method}
          defaultValue={previous?.method ?? "unknown"}
          options={[
            { value: "unknown", label: copy.unknown },
            { value: "accrual", label: copy.accrual },
            { value: "cash", label: copy.cash },
          ]}
        />
      </Box>
      <SelectField
        name="treatment"
        label={copy.treatment}
        defaultValue={previous?.treatment ?? "unknown"}
        options={[
          { value: "unknown", label: copy.unknown },
          { value: "domestic_purchase", label: copy.domesticPurchase },
          { value: "foreign_purchase", label: copy.foreignPurchase },
          { value: "reverse_charge", label: copy.reverseCharge },
          { value: "import", label: copy.imports },
          { value: "exempt", label: copy.exempt },
          { value: "out_of_scope", label: copy.outOfScope },
          { value: "other", label: copy.other },
        ]}
      />
      <Box display="grid" columns={2} gap="md">
        <InputField
          name="rate"
          label={sv ? "Momssats (%)" : "Tax rate (%)"}
          inputMode="decimal"
          defaultValue={displayPercent(previous?.rateNumerator, previous?.rateDenominator)}
        />
        <InputField
          name="deduction"
          label={sv ? "Avdragsgill andel (%)" : "Deductible share (%)"}
          inputMode="decimal"
          defaultValue={displayPercent(
            previous?.deductionNumerator,
            previous?.deductionDenominator,
          )}
        />
      </Box>
      <PageCaption>
        {sv
          ? "Ange procent som decimaltal eller exakt bråk, till exempel 100/3."
          : "Enter a decimal percentage or an exact fraction, such as 100/3."}
      </PageCaption>
      <InputField
        name="deductionBasis"
        label={copy.deductionBasis}
        defaultValue={previous?.deductionBasis ?? ""}
        maxLength={2000}
      />
      <details>
        <summary>{sv ? "Bokföringsprofil" : "Accounting profile"}</summary>
        <Box display="grid" gap="lg" paddingBlock="lg">
          <InputField
            name="bookJurisdiction"
            label={copy.bookJurisdiction}
            defaultValue={previous?.bookJurisdiction ?? ""}
            pattern="[A-Z]{2}"
            maxLength={2}
          />
          <SelectField
            name="profile"
            label={sv ? "Profil" : "Profile"}
            defaultValue={previous?.profileId === "synthetic-expense-tax" ? "synthetic" : ""}
            options={[
              { value: "", label: sv ? "Inte fastställd" : "Not established" },
              {
                value: "synthetic",
                label: sv ? "Demonstration · utgiftsmoms" : "Demonstration · expense tax",
              },
            ]}
          />
          <SelectField
            name="roundingPolicy"
            label={copy.roundingPolicy}
            defaultValue={previous?.roundingPolicy ?? "unknown"}
            options={[
              { value: "unknown", label: copy.unknown },
              { value: "exact_only", label: copy.exactOnly },
            ]}
          />
        </Box>
      </details>
    </>
  );
}
function amountField(fields: FormData, name: string, scale: number | null) {
  const value = nullableValue(fields, name);
  return value === null
    ? null
    : scale === null
      ? "invalid"
      : (decimalToMinor(value, scale) ?? "invalid");
}
function percentFraction(fields: FormData, name: string) {
  const value = nullableValue(fields, name);
  if (value === null) return { numerator: null, denominator: null };
  if (/^[0-9]+\/[1-9][0-9]*$/.test(value)) {
    const separator = value.indexOf("/");
    return { numerator: value.slice(0, separator), denominator: (BigInt(value.slice(separator + 1)) * 100n).toString() };
  }
  return { numerator: decimalToMinor(value, 6) ?? "invalid", denominator: "100000000" };
}
function displayAmount(value: string | null, scale: number | null) {
  return value === null || scale === null ? "" : minorToDecimal(value, scale);
}
function displayPercent(
  numerator: string | null | undefined,
  denominator: string | null | undefined,
) {
  if (numerator == null || denominator == null || BigInt(denominator) === 0n) return "";
  const scaled = BigInt(numerator) * 10000n;
  if (scaled % BigInt(denominator) !== 0n) return `${BigInt(numerator) * 100n}/${denominator}`;
  return displayAmount((scaled / BigInt(denominator)).toString(), 2);
}
