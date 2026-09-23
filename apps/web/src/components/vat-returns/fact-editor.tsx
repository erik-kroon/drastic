import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type * as Accounting from "@open-erp/contracts/accounting";
import * as Vat from "@open-erp/contracts/vat-returns";
import { Box } from "@open-erp/ui/components/box";
import { InputField, TextareaField } from "@open-erp/ui/components/field";
import { ChoiceField } from "@open-erp/ui/components/choice-field";
import { RecordColumns, RecordSection } from "@open-erp/ui/components/record-layout";
import { Disclosure } from "@open-erp/ui/components/disclosure";
import { PageCaption } from "@open-erp/ui/components/accounting-page";
import { EvidenceCommandForm } from "@/components/evidence-command-form";
import { AccountingStatus } from "@/components/accounting-status";
import { bookKey, bookPath, readAccounting } from "@/lib/accounting-api";
import { decimalToMinor, minorToDecimal } from "@/lib/workspace-api";
import type { Locale } from "@/paraglide/runtime";
import { vatCopy } from "./copy";

type Props = {
  book: typeof Accounting.Book.Type;
  locale: Locale;
  current?: typeof Vat.VatFact.Type;
  initial?: Partial<typeof Vat.VatFactInput.Type>;
  onSaved: (id: string) => void;
};
function nullable(fields: FormData, name: string) {
  const value = fields.get(name);
  return typeof value === "string" && value !== "" ? value : null;
}

export function VatFactEditor(props: Props) {
  const { book, locale, current, initial } = props;
  const sv = locale === "sv";
  const copy = vatCopy(locale);
  const [sourceKey] = useState(() => initial?.sourceKey ?? `vat_${crypto.randomUUID()}`);
  const basis = useQuery({
    queryKey: [...bookKey(book), "vat-returns", "basis"],
    queryFn: ({ signal }) =>
      readAccounting(`${bookPath(book)}/vat-returns/facts`, Vat.VatBasis, { signal }),
    retry: false,
  });
  const scale = basis.data?.currencyScale;
  return (
    <EvidenceCommandForm
      book={book}
      locale={locale}
      path={`${bookPath(book)}/vat-returns/facts`}
      schema={Vat.VatFactInput}
      output={Vat.VatFact}
      label={copy.save}
      canSubmit={scale !== undefined}
      stickyFooter
      onSuccess={(fact) => props.onSaved(fact.factId)}
      source={(fields) => ({
        title: nullable(fields, "description") ?? "",
        origin: "VAT assessment entered in OpenERP",
        mediaType: "application/json",
        content: JSON.stringify({
          kind: "vat_assessment_entry_v1",
          sourceKey,
          previousDigest: current?.digest ?? null,
          fields: Object.fromEntries(fields),
        }),
      })}
      input={(fields, evidence) => ({
        sourceKey,
        expectedDigest: current?.digest ?? null,
        recordClass: initial?.recordClass ?? fields.get("recordClass"),
        sourceLocator: fields.get("sourceLocator"),
        description: fields.get("description"),
        evidenceId: initial?.evidenceId ?? nullable(fields, "sourceEvidenceId") ?? evidence.id,
        reviewEvidenceId: evidence.id,
        reviewRationale: fields.get("reviewRationale"),
        netMinor:
          scale === undefined ? null : decimalToMinor(nullable(fields, "netMinor") ?? "", scale),
        vatMinor:
          scale === undefined ? null : decimalToMinor(nullable(fields, "vatMinor") ?? "", scale),
        grossMinor:
          scale === undefined ? null : decimalToMinor(nullable(fields, "grossMinor") ?? "", scale),
        currency: nullable(fields, "currency"),
        issuedOn: nullable(fields, "issuedOn"),
        receivedOn: nullable(fields, "receivedOn"),
        suppliedOn: nullable(fields, "suppliedOn"),
        taxPointOn: nullable(fields, "taxPointOn"),
        dateBasis: nullable(fields, "dateBasis"),
        periodEvidenceId: nullable(fields, "periodEvidenceId"),
        voucherId: nullable(fields, "voucherId"),
        registration: fields.get("registration"),
        method: fields.get("method"),
        treatment: fields.get("treatment"),
        domesticEligibility: fields.get("domesticEligibility"),
        fullDeduction: fields.get("fullDeduction"),
        registrationEvidenceId: fields.get("registration") === "unknown" ? null : evidence.id,
        methodEvidenceId: fields.get("method") === "unknown" ? null : evidence.id,
        treatmentEvidenceId: fields.get("domesticEligibility") === "unknown" ? null : evidence.id,
        deductionEvidenceId: fields.get("fullDeduction") === "unknown" ? null : evidence.id,
        taxLineIds: (nullable(fields, "taxLineIds") ?? "")
          .split(",")
          .map((id) => id.trim())
          .filter(Boolean),
        expenseLink: initial?.expenseLink ?? null,
      })}
    >
      <AccountingStatus locale={locale} pending={basis.isPending} error={basis.error} />
      <RecordColumns>
        <Box display="grid" gap="xl">
          <RecordSection title={sv ? "Underlag och belopp" : "Source and amounts"}>
            {initial?.recordClass ? (
              <PageCaption>
                {initial.recordClass === "synthetic" ? copy.synthetic : copy.actual}
              </PageCaption>
            ) : (
              <ChoiceField
                label={copy.recordClass}
                name="recordClass"
                required
                options={[
                  { value: "actual_company", label: copy.actual },
                  { value: "synthetic", label: copy.synthetic },
                ]}
              />
            )}
            <InputField
              label={copy.description}
              name="description"
              required
              maxLength={2000}
              defaultValue={initial?.description}
            />
            <InputField
              label={copy.sourceLocator}
              name="sourceLocator"
              required
              maxLength={2000}
              defaultValue={initial?.sourceLocator}
            />
            <Box display="grid" columns={3} gap="md">
              {(["netMinor", "vatMinor", "grossMinor"] as const).map((name) => (
                <InputField
                  key={`${name}:${scale}`}
                  name={name}
                  required
                  inputMode="decimal"
                  label={
                    name === "netMinor"
                      ? sv
                        ? "Exkl. moms"
                        : "Before VAT"
                      : name === "vatMinor"
                        ? sv
                          ? "Moms"
                          : "VAT"
                        : sv
                          ? "Totalt"
                          : "Total"
                  }
                  defaultValue={
                    initial?.[name] !== undefined && scale !== undefined
                      ? minorToDecimal(initial[name], scale)
                      : ""
                  }
                />
              ))}
            </Box>
            <InputField
              label={sv ? "Valuta" : "Currency"}
              name="currency"
              maxLength={3}
              pattern="[A-Z]{3}"
              defaultValue={initial?.currency ?? ""}
              placeholder={book.currency}
            />
            <PageCaption>
              {sv
                ? "Ange belopp i hela valutaenheter, till exempel 1250,00. Tom valuta förblir okänd."
                : "Enter amounts in currency units, for example 1250.00. A blank currency remains unknown."}
            </PageCaption>
          </RecordSection>
          <RecordSection title={sv ? "Datum och period" : "Dates and period"}>
            <Box display="grid" columns={2} gap="md">
              {(["issuedOn", "receivedOn", "suppliedOn", "taxPointOn"] as const).map((name) => (
                <InputField
                  key={name}
                  label={copy[name]}
                  name={name}
                  type="date"
                  defaultValue={initial?.[name] ?? ""}
                />
              ))}
            </Box>
            <InputField
              label={copy.dateBasis}
              name="dateBasis"
              maxLength={2000}
              defaultValue={initial?.dateBasis ?? ""}
            />
          </RecordSection>
        </Box>
        <Box display="grid" gap="xl">
          <RecordSection title={sv ? "Momsbedömning" : "VAT assessment"}>
            <VatChoices locale={locale} initial={initial} />
            <TextareaField
              label={sv ? "Motivering till bedömningen" : "Reason for this assessment"}
              name="reviewRationale"
              required
              rows={3}
              maxLength={2000}
              defaultValue={initial?.reviewRationale}
            />
            <PageCaption>
              {sv
                ? "Din bedömning och motivering sparas som granskningsunderlag. Okända förhållanden ska lämnas okända."
                : "Your assessment and reasoning are saved as review evidence. Leave unestablished facts unknown."}
            </PageCaption>
          </RecordSection>
          <Disclosure
            label={
              sv
                ? "Periodunderlag och bokföringsreferenser"
                : "Period evidence and ledger references"
            }
          >
            <Box display="grid" gap="md" paddingBlock="md">
              <PageCaption>{copy.linksHelp}</PageCaption>
              {!initial?.evidenceId ? (
                <InputField
                  label={
                    sv
                      ? "Befintligt källunderlag, ID (valfritt)"
                      : "Existing source evidence ID (optional)"
                  }
                  name="sourceEvidenceId"
                />
              ) : null}
              <InputField
                label={copy.periodEvidenceId}
                name="periodEvidenceId"
                defaultValue={initial?.periodEvidenceId ?? ""}
              />
              <InputField
                label={copy.voucherId}
                name="voucherId"
                defaultValue={initial?.voucherId ?? ""}
              />
              <InputField
                label={copy.taxLineIds}
                name="taxLineIds"
                defaultValue={initial?.taxLineIds?.join(", ") ?? ""}
              />
            </Box>
          </Disclosure>
        </Box>
      </RecordColumns>
    </EvidenceCommandForm>
  );
}
function VatChoices({ locale, initial }: Pick<Props, "locale" | "initial">) {
  const copy = vatCopy(locale);
  const options = {
    treatment: [
      { value: "domestic_sale", label: copy.sale },
      { value: "domestic_purchase", label: copy.purchase },
      { value: "unsupported", label: copy.unsupported },
    ],
    registration: [
      { value: "registered", label: copy.registered },
      { value: "not_registered", label: copy.notRegistered },
    ],
    method: [
      { value: "accrual", label: copy.accrual },
      { value: "cash", label: copy.cash },
    ],
    domesticEligibility: [
      { value: "confirmed", label: copy.confirmed },
      { value: "unsupported", label: copy.unsupported },
    ],
    fullDeduction: [
      { value: "confirmed", label: copy.confirmed },
      { value: "unsupported", label: copy.unsupported },
    ],
  };
  return (
    <>
      {(
        ["treatment", "registration", "method", "domesticEligibility", "fullDeduction"] as const
      ).map((name) => (
        <ChoiceField
          key={name}
          name={name}
          label={copy[name]}
          defaultValue={initial?.[name] ?? "unknown"}
          options={[{ value: "unknown", label: copy.unknown }, ...options[name]]}
        />
      ))}
    </>
  );
}
