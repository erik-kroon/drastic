import { useRef, useState } from "react";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Schema from "effect/Schema";
import * as Setup from "@open-erp/contracts/company-setup";
import { AccountingError } from "@open-erp/contracts/accounting";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { InputField, SelectField } from "@open-erp/ui/components/field";
import { ChoiceField } from "@open-erp/ui/components/choice-field";
import { Link } from "@open-erp/ui/components/link";
import { Text } from "@open-erp/ui/components/typography";
import { PageContent } from "@open-erp/ui/components/accounting-page";
import { RecordHeading, RecordSection, RecordSplit } from "@open-erp/ui/components/record-layout";
import { WorkspaceHeader } from "@open-erp/ui/components/workspace";
import { AccountingStatus } from "@/components/accounting-status";
import { useBookWorkspace, workspacePath } from "@/lib/book-context";
import {
  bookKey,
  bookPath,
  booksKey,
  isUncertainWriteError,
  mutationOptions,
  readAccounting,
} from "@/lib/accounting-api";
import { english, swedish } from "./copy";

const validator = Schema.toStandardSchemaV1(Setup.CompanyDetails);
const fieldSteps = {
  name: 0,
  legalForm: 0,
  organizationNumber: 0,
  accountingMethod: 1,
  vatRegistered: 1,
  vatPeriod: 1,
  fiscalYearStartsOn: 1,
  fiscalYearEndsOn: 1,
  historyChoice: 2,
  bankChoice: 3,
} satisfies Record<keyof typeof Setup.CompanyDetails.Type, number>;
const setupFields = [
  "name",
  "legalForm",
  "organizationNumber",
  "accountingMethod",
  "vatRegistered",
  "vatPeriod",
  "fiscalYearStartsOn",
  "fiscalYearEndsOn",
  "historyChoice",
  "bankChoice",
] satisfies Array<keyof typeof Setup.CompanyDetails.Type>;

export function CompanySetupPanel() {
  const { book, locale } = useBookWorkspace();
  const copy = locale === "sv" ? swedish : english;
  const setup = useQuery({
    queryKey: [...bookKey(book), "company-setup"],
    queryFn: ({ signal }) =>
      readAccounting(`${bookPath(book)}/company-setup`, Setup.CompanySetup, { signal }),
    retry: false,
  });
  return (
    <>
      <WorkspaceHeader title={copy.title} />
      <PageContent>
        <AccountingStatus locale={locale} pending={setup.isPending} error={setup.error} />
        {setup.isError ? (
          <Button
            variant="outline"
            onClick={() => {
              void setup.refetch();
            }}
          >
            {copy.retry}
          </Button>
        ) : null}
        {setup.isSuccess ? <SetupJourney key={book.id} saved={setup.data} /> : null}
      </PageContent>
    </>
  );
}

function SetupJourney({ saved }: { saved: typeof Setup.CompanySetup.Type }) {
  const { book, locale } = useBookWorkspace();
  const copy = locale === "sv" ? swedish : english;
  const cache = useQueryClient();
  const keys = useRef(new Map<string, string>());
  const [step, setStep] = useState(() => {
    if (saved.missing.some((field) => field === "legalForm" || field === "organizationNumber"))
      return 0;
    if (saved.missing.length) return 1;
    if (saved.details.historyChoice === null) return 2;
    if (saved.details.bankChoice === null) return 3;
    return 4;
  });
  const heading = useRef<HTMLDivElement>(null);
  const formElement = useRef<HTMLFormElement>(null);
  const path = `${bookPath(book)}/company-setup`;
  const mutation = useMutation({
    mutationFn: (input: typeof Setup.SaveCompanySetup.Type) =>
      readAccounting(
        path,
        Setup.CompanySetup,
        mutationOptions(path, JSON.stringify(input), keys.current),
      ),
    onSuccess: async (result) => {
      cache.setQueryData([...bookKey(book), "company-setup"], result);
      await cache.invalidateQueries({ queryKey: booksKey });
    },
  });
  const steps = [copy.identity, copy.accounting, copy.history, copy.banking, copy.review];
  const reload = useMutation({
    mutationFn: () => readAccounting(path, Setup.CompanySetup),
    onSuccess: (current) => {
      cache.setQueryData([...bookKey(book), "company-setup"], current);
      form.reset(current.details);
      mutation.reset();
    },
  });
  const uncertain = isUncertainWriteError(mutation.error);
  const disabled = book.role !== "operator" || mutation.isPending || reload.isPending || uncertain;
  const form = useForm({
    defaultValues: saved.details,
    validators: { onBlur: validator, onSubmit: validator },
    onSubmitInvalid: ({ formApi }) => {
      for (const name of setupFields) {
        if (formApi.getFieldMeta(name)?.errors.length) {
          setStep(fieldSteps[name]);
          requestAnimationFrame(() => {
            formElement.current?.querySelector<HTMLElement>(`[name="${name}"]`)?.focus();
          });
          break;
        }
      }
    },
    onSubmit: async ({ value, formApi }) => {
      const result = await mutation.mutateAsync(
        uncertain && mutation.variables
          ? mutation.variables
          : { expectedRevision: saved.revision, details: value },
      );
      formApi.reset(result.details);
      setStep((current) => Math.min(current + 1, steps.length - 1));
      heading.current?.focus();
    },
  });
  return (
    <>
      <RecordHeading title={saved.details.name} subtitle={copy.intro} />
      <RecordSplit
        aside={
          <Box display="grid" gap="xl" minWidth="zero">
            <RecordSection title={saved.state === "incomplete" ? copy.incomplete : copy.recorded}>
              {saved.missing.map((field) => (
                <Text key={field}>{copy[field]}</Text>
              ))}
              <Text tone="muted">{copy.recordedHint}</Text>
            </RecordSection>
            <RecordSection title={copy.review}>
              {steps.map((title, index) => (
                <Button
                  key={title}
                  type="button"
                  variant={index === step ? "secondary" : "ghost"}
                  aria-current={index === step ? "step" : undefined}
                  disabled={mutation.isPending || uncertain}
                  onClick={() => {
                    setStep(index);
                    heading.current?.focus();
                  }}
                >
                  {index + 1}. {title}
                </Button>
              ))}
            </RecordSection>
          </Box>
        }
      >
        <Box display="grid" gap="xl" minWidth="zero">
          <Box ref={heading} tabIndex={-1} role="group" aria-label={steps[step]}>
            <Text tone="muted">
              {step + 1} / {steps.length}
            </Text>
          </Box>
          <Box
            as="form"
            ref={formElement}
            display="grid"
            gap="xl"
            onSubmit={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void form.handleSubmit().catch(() => undefined);
            }}
          >
            {step === 0 ? (
              <RecordSection title={copy.identity}>
                <form.Field name="name">
                  {(field) => (
                    <Box display="grid" gap="sm">
                      <InputField
                        label={copy.name}
                        name={field.name}
                        value={field.state.value}
                        required
                        maxLength={200}
                        autoComplete="organization"
                        disabled={disabled}
                        onBlur={field.handleBlur}
                        onChange={(event) => field.handleChange(event.target.value)}
                        aria-invalid={field.state.meta.errors.length > 0}
                        aria-describedby="setup-name-error"
                      />
                      <FieldErrors id="setup-name-error" errors={field.state.meta.errors} />
                    </Box>
                  )}
                </form.Field>
                <form.Field name="legalForm">
                  {(field) => (
                    <SelectField
                      label={copy.legalForm}
                      name={field.name}
                      value={field.state.value ?? ""}
                      disabled={disabled}
                      options={[
                        { value: "", label: copy.unknown },
                        { value: "aktiebolag", label: copy.limited },
                        { value: "enskild_firma", label: copy.sole },
                      ]}
                      onValueChange={(value) => {
                        field.handleChange(
                          Schema.decodeUnknownSync(Setup.CompanyDetails.fields.legalForm)(
                            value || null,
                          ),
                        );
                        field.handleBlur();
                      }}
                    />
                  )}
                </form.Field>
                <form.Field name="organizationNumber">
                  {(field) => (
                    <Box display="grid" gap="sm">
                      <InputField
                        label={copy.organizationNumber}
                        name={field.name}
                        value={field.state.value ?? ""}
                        inputMode="numeric"
                        maxLength={10}
                        disabled={disabled}
                        onBlur={field.handleBlur}
                        onChange={(event) => field.handleChange(event.target.value || null)}
                        aria-invalid={field.state.meta.errors.length > 0}
                        aria-describedby="setup-number-hint setup-number-error"
                      />
                      <Text id="setup-number-hint" tone="muted">
                        {copy.numberHint}
                      </Text>
                      <FieldErrors id="setup-number-error" errors={field.state.meta.errors} />
                    </Box>
                  )}
                </form.Field>
              </RecordSection>
            ) : null}
            {step === 1 ? (
              <RecordSection title={copy.accounting}>
                <form.Field name="accountingMethod">
                  {(field) => (
                    <SelectField
                      label={copy.accountingMethod}
                      name={field.name}
                      value={field.state.value ?? ""}
                      disabled={disabled}
                      options={[
                        { value: "", label: copy.unknown },
                        { value: "accrual", label: copy.accrual },
                        { value: "cash", label: copy.cash },
                      ]}
                      onValueChange={(value) => {
                        field.handleChange(
                          Schema.decodeUnknownSync(Setup.CompanyDetails.fields.accountingMethod)(
                            value || null,
                          ),
                        );
                        field.handleBlur();
                      }}
                    />
                  )}
                </form.Field>
                <form.Field name="vatRegistered">
                  {(field) => (
                    <SelectField
                      label={copy.vatRegistered}
                      name={field.name}
                      value={field.state.value === null ? "" : String(field.state.value)}
                      disabled={disabled}
                      options={[
                        { value: "", label: copy.unknown },
                        { value: "true", label: copy.yes },
                        { value: "false", label: copy.no },
                      ]}
                      onValueChange={(value) => {
                        field.handleChange(
                          value === "true" ? true : value === "false" ? false : null,
                        );
                        if (value !== "true") form.setFieldValue("vatPeriod", null);
                        field.handleBlur();
                      }}
                    />
                  )}
                </form.Field>
                <form.Subscribe selector={(state) => state.values.vatRegistered}>
                  {(registered) =>
                    registered ? (
                      <form.Field name="vatPeriod">
                        {(field) => (
                          <SelectField
                            label={copy.vatPeriod}
                            name={field.name}
                            value={field.state.value ?? ""}
                            disabled={disabled}
                            options={[
                              { value: "", label: copy.unknown },
                              { value: "monthly", label: copy.monthly },
                              { value: "quarterly", label: copy.quarterly },
                              { value: "yearly", label: copy.yearly },
                            ]}
                            onValueChange={(value) => {
                              field.handleChange(
                                Schema.decodeUnknownSync(Setup.CompanyDetails.fields.vatPeriod)(
                                  value || null,
                                ),
                              );
                              field.handleBlur();
                            }}
                          />
                        )}
                      </form.Field>
                    ) : null
                  }
                </form.Subscribe>
                {(["fiscalYearStartsOn", "fiscalYearEndsOn"] as const).map((name) => (
                  <form.Field key={name} name={name}>
                    {(field) => (
                      <Box display="grid" gap="sm">
                        <InputField
                          label={copy[name]}
                          name={field.name}
                          type="date"
                          value={field.state.value ?? ""}
                          disabled={disabled}
                          onBlur={field.handleBlur}
                          onChange={(event) => field.handleChange(event.target.value || null)}
                          aria-invalid={field.state.meta.errors.length > 0}
                          aria-describedby={`setup-${name}-error`}
                        />
                        <FieldErrors id={`setup-${name}-error`} errors={field.state.meta.errors} />
                      </Box>
                    )}
                  </form.Field>
                ))}
              </RecordSection>
            ) : null}
            {step === 2 ? (
              <RecordSection title={copy.history}>
                <form.Field name="historyChoice">
                  {(field) => (
                    <ChoiceField
                      label={copy.historyQuestion}
                      name={field.name}
                      value={field.state.value ?? ""}
                      disabled={disabled}
                      options={[
                        {
                          value: "new_business",
                          label: copy.newBusiness,
                          description: copy.newBusinessHint,
                        },
                        { value: "sie", label: copy.sie, description: copy.sieHint },
                        {
                          value: "opening_balances",
                          label: copy.opening,
                          description: copy.openingHint,
                        },
                      ]}
                      onValueChange={(value) => {
                        field.handleChange(
                          Schema.decodeUnknownSync(Setup.CompanyDetails.fields.historyChoice)(
                            value,
                          ),
                        );
                        field.handleBlur();
                      }}
                    />
                  )}
                </form.Field>
              </RecordSection>
            ) : null}
            {step === 3 ? (
              <RecordSection title={copy.banking}>
                <Text tone="muted">{copy.bankOptional}</Text>
                <form.Field name="bankChoice">
                  {(field) => (
                    <ChoiceField
                      label={copy.bankQuestion}
                      name={field.name}
                      value={field.state.value ?? ""}
                      disabled={disabled}
                      options={[
                        { value: "connect", label: copy.connect, description: copy.connectHint },
                        { value: "file", label: copy.file, description: copy.fileHint },
                        { value: "later", label: copy.later, description: copy.laterHint },
                      ]}
                      onValueChange={(value) => {
                        field.handleChange(
                          Schema.decodeUnknownSync(Setup.CompanyDetails.fields.bankChoice)(value),
                        );
                        field.handleBlur();
                      }}
                    />
                  )}
                </form.Field>
              </RecordSection>
            ) : null}
            {step === 4 ? (
              <RecordSection title={copy.review}>
                <Text>{copy.recordedHint}</Text>
                {saved.accountingProfile === "company-setup-v1" ? (
                  <Text>{copy.profilePending}</Text>
                ) : null}
                {saved.details.historyChoice === "sie" ? (
                  <Link href={`${workspacePath(book)}/history`}>{copy.sie}</Link>
                ) : null}
                {saved.details.bankChoice === "file" ? (
                  <Link href={`${workspacePath(book)}/accounts?view=imports`}>{copy.file}</Link>
                ) : null}
                <Link href={`${workspacePath(book)}/overview`}>{copy.finish}</Link>
              </RecordSection>
            ) : null}
            <AccountingStatus
              locale={locale}
              pending={mutation.isPending}
              error={mutation.error}
              write
            />
            <AccountingStatus locale={locale} pending={reload.isPending} error={reload.error} />
            <form.Subscribe
              selector={(state) => ({ isDirty: state.isDirty, errors: state.errors })}
            >
              {({ isDirty, errors }) => (
                <Box display="grid" gap="sm">
                  <Text role="status">
                    {isDirty ? copy.unsaved : mutation.isSuccess ? copy.saved : null}
                  </Text>
                  {errors.length ? <Text role="alert">{copy.validation}</Text> : null}
                </Box>
              )}
            </form.Subscribe>
            {mutation.error instanceof AccountingError &&
            mutation.error.code === "StaleDependency" ? (
              <Button
                type="button"
                variant="outline"
                disabled={reload.isPending}
                onClick={() => reload.mutate()}
              >
                {copy.reload}
              </Button>
            ) : null}
            {book.role !== "operator" ? <Text>{copy.readOnly}</Text> : null}
            <Box display="flex" flexWrap="wrap" gap="md">
              {step > 0 ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={mutation.isPending || uncertain}
                  onClick={() => {
                    setStep(step - 1);
                    heading.current?.focus();
                  }}
                >
                  {copy.back}
                </Button>
              ) : null}
              {book.role === "operator" ? (
                <Button type="submit" disabled={mutation.isPending || reload.isPending}>
                  {uncertain ? copy.retry : step === 4 ? copy.save : copy.next}
                </Button>
              ) : (
                <Button type="button" onClick={() => setStep(Math.min(step + 1, 4))}>
                  {copy.review}
                </Button>
              )}
            </Box>
          </Box>
        </Box>
      </RecordSplit>
    </>
  );
}

function FieldErrors({
  id,
  errors,
}: {
  id: string;
  errors: ReadonlyArray<{ message: string } | undefined>;
}) {
  return (
    <Text id={id} role="alert">
      {errors.map((error) => error?.message).join(" ")}
    </Text>
  );
}
