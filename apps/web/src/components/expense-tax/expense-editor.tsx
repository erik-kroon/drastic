import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type * as Accounting from "@open-erp/contracts/accounting";
import * as Tax from "@open-erp/contracts/expense-tax";
import { Box } from "@open-erp/ui/components/box";
import { InputField, SelectField } from "@open-erp/ui/components/field";
import { RecordSection } from "@open-erp/ui/components/record-layout";
import { PageCaption } from "@open-erp/ui/components/accounting-page";
import { RetainedNote } from "@/components/retained-note";
import { AccountingStatus } from "@/components/accounting-status";
import { CommandForm, type CommerceProps } from "@/components/commerce/shared";
import { bookPath } from "@/lib/accounting-api";
import { decimalToMinor, workQueryOptions } from "@/lib/workspace-api";

export function ExpenseEditor(props: CommerceProps & { onSaved: (id: string) => void }) {
  const sv = props.locale === "sv";
  const [evidence, setEvidence] = useState<typeof Accounting.Evidence.Type | null>(null);
  const [sourceKey] = useState(() => `expense_${crypto.randomUUID().replaceAll("-", "")}`);
  const metadata = useQuery(workQueryOptions(props.book, {}));
  const scale = metadata.data?.currencyScale;
  if (!evidence) return <RetainedNote {...props} onSaved={setEvidence} />;
  if (scale === undefined)
    return (
      <AccountingStatus locale={props.locale} pending={metadata.isPending} error={metadata.error} />
    );
  return (
    <CommandForm
      {...props}
      path={`${bookPath(props.book)}/expense-tax/sources`}
      schema={Tax.RecordTaxSource}
      output={Tax.TaxSourceRevision}
      label={sv ? "Spara utgift" : "Save expense"}
      onSuccess={(source) => props.onSaved(source.sourceId)}
      input={(fields) => ({
        sourceKey,
        expectedSourceDigest: null,
        facts: {
          evidenceId: evidence.id,
          sourceLocator: evidence.title,
          description: fields.get("description"),
          recordClass: fields.get("recordClass"),
          currency: props.book.currency,
          currencyScale: scale,
          amounts: {
            grossMinor: expenseAmount(fields, "gross", scale),
            netMinor: expenseAmount(fields, "net", scale),
            vatMinor: expenseAmount(fields, "vat", scale),
          },
          supplierJurisdiction: nullable(fields, "supplierCountry"),
          supplyJurisdiction: nullable(fields, "supplyCountry"),
          issuedOn: nullable(fields, "issuedOn"),
          receivedOn: nullable(fields, "receivedOn"),
          suppliedOn: null,
          taxPointOn: null,
          changeSetId: null,
          voucherId: null,
        },
      })}
    >
      <RecordSection title={sv ? "Utgiftsuppgifter" : "Expense details"}>
        <InputField
          name="description"
          label={sv ? "Beskrivning" : "Description"}
          defaultValue={evidence.title}
          required
          maxLength={2000}
        />
        <Box display="grid" columns={2} gap="lg">
          <InputField name="issuedOn" label={sv ? "Dokumentdatum" : "Document date"} type="date" />
          <InputField
            name="receivedOn"
            label={sv ? "Mottaget datum" : "Received date"}
            type="date"
          />
        </Box>
        <Box display="grid" columns={3} gap="lg">
          <InputField
            name="gross"
            label={`${sv ? "Totalt" : "Total"} · ${props.book.currency}`}
            inputMode="decimal"
          />
          <InputField name="net" label={sv ? "Exkl. moms" : "Before tax"} inputMode="decimal" />
          <InputField name="vat" label={sv ? "Moms" : "Tax"} inputMode="decimal" />
        </Box>
        <PageCaption>
          {sv
            ? "Lämna okända belopp tomma. Momsbehandlingen granskas separat."
            : "Leave unknown amounts blank. Tax treatment is reviewed separately."}
        </PageCaption>
        <Box display="grid" columns={2} gap="lg">
          <InputField
            name="supplierCountry"
            label={sv ? "Leverantörsland (landskod)" : "Supplier country (country code)"}
            placeholder="SE"
            pattern="[A-Z]{2}"
            maxLength={2}
          />
          <InputField
            name="supplyCountry"
            label={sv ? "Leveransland (landskod)" : "Supply country (country code)"}
            placeholder="SE"
            pattern="[A-Z]{2}"
            maxLength={2}
          />
        </Box>
        <SelectField
          name="recordClass"
          label={sv ? "Underlagstyp" : "Source type"}
          defaultValue={props.book.profile === "synthetic-core-v1" ? "synthetic" : "actual_company"}
          options={[
            { value: "actual_company", label: sv ? "Företagets underlag" : "Company document" },
            { value: "synthetic", label: sv ? "Demounderlag" : "Demo source" },
          ]}
        />
      </RecordSection>
    </CommandForm>
  );
}
function nullable(fields: FormData, name: string) {
  const value = fields.get(name);
  return value === "" ? null : value;
}
function expenseAmount(fields: FormData, name: string, scale: number) {
  const value = fields.get(name);
  if (value === "" || value === null) return null;
  return typeof value === "string" ? (decimalToMinor(value, scale) ?? "invalid") : "invalid";
}
