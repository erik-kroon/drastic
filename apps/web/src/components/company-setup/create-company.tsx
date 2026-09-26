import { useRef } from "react";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import * as Setup from "@open-erp/contracts/company-setup";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { InputField } from "@open-erp/ui/components/field";
import { FormDialog } from "@open-erp/ui/components/form-dialog";
import { Text } from "@open-erp/ui/components/typography";
import { AccountingStatus } from "@/components/accounting-status";
import {
  booksKey,
  isUncertainWriteError,
  mutationOptions,
  readAccounting,
} from "@/lib/accounting-api";
import type { Locale } from "@/paraglide/runtime";

const validator = Schema.toStandardSchemaV1(Setup.CreateCompany);

export function CreateCompany({ locale, onClose }: { locale: Locale; onClose: () => void }) {
  const sv = locale === "sv";
  const cache = useQueryClient();
  const navigate = useNavigate();
  const keys = useRef(new Map<string, string>());

  const mutation = useMutation({
    mutationFn: (input: typeof Setup.CreateCompany.Type) =>
      readAccounting(
        "/api/v1/companies",
        Setup.CompanySetup,
        mutationOptions("/api/v1/companies", JSON.stringify(input), keys.current),
      ),
    onSuccess: async (result) => {
      await cache.invalidateQueries({ queryKey: booksKey });
      await navigate({
        to: `/entities/${result.scope.entityId}/books/${result.scope.bookId}/setup`,
      });
      onClose();
    },
  });

  const form = useForm({
    defaultValues: { name: "" },
    validators: { onBlur: validator, onSubmit: validator },
    onSubmit: async ({ value }) => {
      await mutation.mutateAsync({ name: value.name.trim() });
    },
  });

  const uncertain = isUncertainWriteError(mutation.error);

  return (
    <FormDialog
      title={sv ? "Skapa företag" : "Create company"}
      size="compact"
      closeLabel={sv ? "Stäng" : "Close"}
      onClose={() => {
        if (!mutation.isPending) onClose();
      }}
    >
      <Box
        as="form"
        display="grid"
        gap="lg"
        onSubmit={(event) => {
          event.preventDefault();
          event.stopPropagation();
          void form.handleSubmit().catch(() => undefined);
        }}
      >
        <Text tone="muted">
          {sv
            ? "Börja med företagets namn. Du kan fylla i övriga uppgifter senare."
            : "Start with the company name. You can fill in the remaining details later."}
        </Text>
        <form.Field name="name">
          {(field) => (
            <Box display="grid" gap="sm">
              <InputField
                label={sv ? "Företagsnamn" : "Company name"}
                name={field.name}
                autoComplete="organization"
                required
                maxLength={200}
                value={field.state.value}
                disabled={mutation.isPending || uncertain}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
                aria-invalid={field.state.meta.errors.length > 0}
                aria-describedby="company-name-error"
              />
              <Text id="company-name-error" role="alert">
                {field.state.meta.errors.length
                  ? sv
                    ? "Ange företagets namn."
                    : "Enter the company name."
                  : null}
              </Text>
            </Box>
          )}
        </form.Field>
        <AccountingStatus
          locale={locale}
          pending={mutation.isPending}
          error={mutation.error}
          write
        />
        <Button type="submit" disabled={mutation.isPending}>
          {uncertain
            ? sv
              ? "Försök igen"
              : "Retry creation"
            : sv
              ? "Skapa företag"
              : "Create company"}
        </Button>
      </Box>
    </FormDialog>
  );
}
