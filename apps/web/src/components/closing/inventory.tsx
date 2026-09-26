import * as Closing from "@open-erp/contracts/closing";
import { Box } from "@open-erp/ui/components/box";
import { InputField, SelectField } from "@open-erp/ui/components/field";
import { Text } from "@open-erp/ui/components/typography";
import type { Locale } from "@/paraglide/runtime";
import { closingCopy } from "./copy";

export function FamilyInventoryFields({ locale, disabled }: { locale: Locale; disabled: boolean }) {
  const copy = closingCopy(locale);

  return (
    <Box display="grid" gap="lg" minWidth="zero">
      <Text>{copy.familyHelp}</Text>
      {Closing.ClosingFamily.literals.map((family) => (
        <Box as="fieldset" key={family} display="grid" gap="md" minWidth="zero" disabled={disabled}>
          <legend>{copy.familyLabels[family]}</legend>
          <SelectField
            name={`${family}:status`}
            label={copy.familyStatus}
            required
            disabled={disabled}
            options={Closing.ClosingFamilyStatus.literals.map((value) => ({
              value,
              label: copy.familyStatuses[value],
            }))}
          />
          <InputField
            name={`${family}:reviewedOn`}
            label={copy.familyDate}
            type="date"
            required
            disabled={disabled}
          />
          <InputField
            name={`${family}:evidenceId`}
            label={copy.familyEvidence}
            required
            disabled={disabled}
          />
          <InputField
            name={`${family}:rationale`}
            label={copy.familyRationale}
            maxLength={2000}
            required
            disabled={disabled}
          />
        </Box>
      ))}
    </Box>
  );
}

export function readFamilyDecisions(values: FormData) {
  return Closing.ClosingFamily.literals.map((family) => ({
    family,
    status: values.get(`${family}:status`),
    reviewedOn: values.get(`${family}:reviewedOn`),
    evidenceId: values.get(`${family}:evidenceId`),
    rationale: values.get(`${family}:rationale`),
  }));
}
