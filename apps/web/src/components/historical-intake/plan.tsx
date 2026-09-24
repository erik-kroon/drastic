import { useRef } from "react";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery } from "@tanstack/react-query";
import * as Schema from "effect/Schema";
import * as Sie from "@open-erp/contracts/sie-import";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { InputField, SelectField, TextareaField } from "@open-erp/ui/components/field";
import { Text } from "@open-erp/ui/components/typography";
import { RecordSection } from "@open-erp/ui/components/record-layout";
import { AccountingStatus } from "@/components/accounting-status";
import { useBookWorkspace } from "@/lib/book-context";
import {
  bookPath,
  bookKey,
  mutationOptions,
  readAccounting,
  isUncertainWriteError,
} from "@/lib/accounting-api";
import { checkScope } from "@/components/commerce/shared";
import { SieStagingRun } from "./run";
import { OpenItemEntry, OpenItemControlEntry, SavedOpenItems } from "./open-items";

const reviewSchema = Schema.Struct({
  mappings: Sie.SealSiePlan.fields.mappings,
  openingControls: Sie.SealSiePlan.fields.openingControls,
  openItems: Sie.SealSiePlan.fields.openItems,
  openItemControls: Sie.SealSiePlan.fields.openItemControls,
  rationale: Sie.SealSiePlan.fields.rationale,
  reviewedMissingDetail: Schema.Literal(true),
  pendingItemDraft: Schema.Literal(false),
  pendingControlDraft: Schema.Literal(false),
});

export function SiePlanReview({
  preview,
  sourceSystem,
  onSealed,
}: {
  preview: typeof Sie.SiePreview.Type;
  sourceSystem: string;
  onSealed: (plan: typeof Sie.SiePlan.Type) => void;
}) {
  const { book, setup, locale } = useBookWorkspace();
  const sv = locale === "sv";
  const keys = useRef(new Map<string, string>());
  const sourceAccounts = [
    ...new Set(
      preview.records.flatMap((record) => {
        if (["KONTO", "TRANS", "RTRANS", "BTRANS"].includes(record.tag))
          return record.fields.slice(0, 1);
        if (["IB", "UB", "RES"].includes(record.tag)) return record.fields.slice(1, 2);
        return [];
      }),
    ),
  ].sort();
  const controls = preview.controls
    .filter((control) => control.kind === "IB" || control.kind === "UB")
    .filter(
      (control, index, all) =>
        all.findIndex(
          (other) => other.account === control.account && other.year === control.year,
        ) === index,
    );
  const activeAccounts = setup.accounts.filter((account) => account.active);
  const exactAccounts = new Map(activeAccounts.map((account) => [account.code, account.id]));
  const unresolvedAccounts = sourceAccounts.filter((code) => !exactAccounts.has(code));
  const path = `${bookPath(book)}/sie-previews/${encodeURIComponent(preview.id)}/plans`;
  const seal = useMutation({
    mutationFn: (input: typeof Sie.SealSiePlan.Type) =>
      readAccounting(path, Sie.SiePlan, mutationOptions(path, JSON.stringify(input), keys.current)),
    onSuccess: (result) => {
      checkScope(book, result.scope);
      if (result.previewId !== preview.id || result.previewDigest !== preview.digest)
        throw new Error("SIE plan identity mismatch");
      onSealed(result);
    },
  });
  const form = useForm({
    defaultValues: {
      mappings: sourceAccounts.map((sourceAccount) => ({
        sourceAccount,
        accountId: exactAccounts.get(sourceAccount) ?? "",
      })),
      openingControls: controls.map((control) => ({
        sourceAccount: control.account,
        year: control.year,
        independentOpeningMinor: "",
        independentClosingMinor: "",
        basis: "",
      })),
      rationale: "",
      openItems: [...Schema.decodeSync(Sie.SealSiePlan.fields.openItems)([])],
      openItemControls: [...Schema.decodeSync(Sie.SealSiePlan.fields.openItemControls)([])],
      reviewedMissingDetail: false,
      pendingItemDraft: false,
      pendingControlDraft: false,
    },
    validators: {
      onSubmit: ({ value }) =>
        Schema.is(reviewSchema)(value)
          ? undefined
          : sv
            ? "Välj konton, fyll i kontrollsaldon, lägg till eller rensa utkast och bekräfta granskad omfattning."
            : "Select accounts, complete balance controls, add or clear item drafts, and confirm the reviewed scope.",
    },
    onSubmit: async ({ value }) => {
      const input = Schema.decodeSync(Sie.SealSiePlan)({
        digest: preview.digest,
        mappings: value.mappings,
        openingControls: value.openingControls,
        openItems: value.openItems,
        openItemControls: value.openItemControls,
        rationale: value.rationale,
        openingPolicy: "unreconstructable_detail",
        sourceKind: sourceSystem.startsWith("synthetic_") ? "synthetic" : "reviewed_sie4",
      });
      await seal.mutateAsync(
        isUncertainWriteError(seal.error) && seal.variables ? seal.variables : input,
      );
    },
  });
  const disabled = seal.isPending || isUncertainWriteError(seal.error) || book.role !== "operator";
  if (!preview.ready) return null;
  if (!setup.accounts.length)
    return (
      <Text>
        {sv
          ? "Lägg till företagets kontoplan innan du mappar filens konton."
          : "Set up the company’s chart of accounts before mapping the file’s accounts."}
      </Text>
    );
  return (
    <Box
      as="form"
      display="grid"
      gap="xl"
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void form.handleSubmit().catch(() => undefined);
      }}
    >
      <RecordSection title={sv ? "Koppla konton" : "Map accounts"}>
        <Text>
          {sv
            ? `${sourceAccounts.length} källkonton · ${sourceAccounts.length - unresolvedAccounts.length} exakta förslag · ${unresolvedAccounts.length} kräver val. Kontrollera även föreslagna konton före låsning.`
            : `${sourceAccounts.length} source accounts · ${sourceAccounts.length - unresolvedAccounts.length} exact suggestions · ${unresolvedAccounts.length} need selection. Check suggested accounts before sealing.`}
        </Text>
        {sourceAccounts.map((code, index) => (
          <form.Field key={code} name={`mappings[${index}].accountId`}>
            {(field) => (
              <SelectField
                label={`${sv ? "Källkonto" : "Source account"} ${code}`}
                value={field.state.value}
                disabled={disabled}
                name={field.name}
                options={[
                  { value: "", label: sv ? "Välj konto" : "Select account" },
                  ...activeAccounts.map((account) => ({
                    value: account.id,
                    label: `${account.code} · ${account.name}`,
                  })),
                ]}
                onValueChange={(value) => {
                  field.handleChange(value ?? "");
                  field.handleBlur();
                }}
              />
            )}
          </form.Field>
        ))}
      </RecordSection>
      <RecordSection title={sv ? "Oberoende kontrollsaldon" : "Independent balance controls"}>
        <Text>
          {sv
            ? "Ange belopp i öre med tecken från ett separat, granskat underlag. 100 betyder 1,00 SEK. Kopiera inte filens saldon som kontroll."
            : "Enter signed amounts in öre from a separate reviewed source. 100 means SEK 1.00. Do not copy the file’s balances as your control."}
        </Text>
        {controls.map((control, index) => (
          <Box key={`${control.account}:${control.year}`} display="grid" gap="md">
            <Text>
              {sv ? "Konto" : "Account"} {control.account} · {sv ? "Källår" : "Source year"}{" "}
              {control.year}
            </Text>
            <form.Field name={`openingControls[${index}].independentOpeningMinor`}>
              {(field) => (
                <InputField
                  label={sv ? "Ingående saldo (öre)" : "Opening balance (öre)"}
                  name={field.name}
                  value={field.state.value}
                  disabled={disabled}
                  required
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
              )}
            </form.Field>
            <form.Field name={`openingControls[${index}].independentClosingMinor`}>
              {(field) => (
                <InputField
                  label={sv ? "Utgående saldo (öre)" : "Closing balance (öre)"}
                  name={field.name}
                  value={field.state.value}
                  disabled={disabled}
                  required
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
              )}
            </form.Field>
            <form.Field name={`openingControls[${index}].basis`}>
              {(field) => (
                <InputField
                  label={sv ? "Kontrollunderlag" : "Control source"}
                  name={field.name}
                  value={field.state.value}
                  maxLength={200}
                  disabled={disabled}
                  required
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
              )}
            </form.Field>
          </Box>
        ))}
      </RecordSection>
      <RecordSection
        title={
          sv
            ? "Obetalda fakturor och andra öppna poster"
            : "Outstanding invoices and other open items"
        }
      >
        <Text>
          {sv
            ? "Lägg till poster från ett separat underlag. SIE-kontosaldon identifierar inte enskilda fakturor."
            : "Add items from a separate source. SIE account balances do not identify individual invoices."}
        </Text>
        <form.Field name="openItems" mode="array">
          {(field) => (
            <>
              {field.state.value.map((item, index) => (
                <Box
                  key={`${item.sourceIdentity}:${index}`}
                  display="flex"
                  flexWrap="wrap"
                  gap="md"
                >
                  <Text>
                    {item.sourceIdentity} · {item.sourceAccount} · {item.outstandingMinor}{" "}
                    {item.currency} {sv ? "minsta valutaenheter" : "minor units"}
                  </Text>
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={disabled}
                    onClick={() => field.removeValue(index)}
                  >
                    {sv ? "Ta bort post" : "Remove item"}
                  </Button>
                </Box>
              ))}
              <OpenItemEntry
                disabled={disabled}
                sourceAccounts={sourceAccounts}
                onAdd={(item) => field.pushValue(item)}
                onDraftChange={(dirty) => form.setFieldValue("pendingItemDraft", dirty)}
              />
            </>
          )}
        </form.Field>
        <form.Field name="openItemControls" mode="array">
          {(field) => (
            <>
              {field.state.value.map((control, index) => (
                <Box
                  key={`${control.sourceAccount}:${control.currency}:${index}`}
                  display="flex"
                  flexWrap="wrap"
                  gap="md"
                >
                  <Text>
                    {control.sourceAccount} · {control.independentOutstandingMinor}{" "}
                    {control.currency} {sv ? "minsta valutaenheter" : "minor units"} ·{" "}
                    {control.basis}
                  </Text>
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={disabled}
                    onClick={() => field.removeValue(index)}
                  >
                    {sv ? "Ta bort kontroll" : "Remove control"}
                  </Button>
                </Box>
              ))}
              <OpenItemControlEntry
                disabled={disabled}
                sourceAccounts={sourceAccounts}
                onAdd={(control) => field.pushValue(control)}
                onDraftChange={(dirty) => form.setFieldValue("pendingControlDraft", dirty)}
              />
            </>
          )}
        </form.Field>
      </RecordSection>
      <RecordSection title={sv ? "Granskningsbeslut" : "Review decision"}>
        <Text>
          {sv
            ? "Endast öppna poster som lagts till ovan ingår. Betalningshistorik och detaljer som saknas återskapas inte. Planen bokför inga belopp."
            : "Only open items added above are included. Missing payment history and details are not reconstructed. Sealing the plan does not post amounts."}
        </Text>
        <form.Field name="rationale">
          {(field) => (
            <TextareaField
              label={sv ? "Grund för granskningen" : "Review rationale"}
              value={field.state.value}
              name={field.name}
              required
              maxLength={2000}
              disabled={disabled}
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.target.value)}
            />
          )}
        </form.Field>
        <form.Field name="reviewedMissingDetail">
          {(field) => (
            <SelectField
              label={sv ? "Saknad detaljhistorik" : "Missing detailed history"}
              value={field.state.value ? "confirmed" : ""}
              name={field.name}
              disabled={disabled}
              options={[
                { value: "", label: sv ? "Bekräfta efter granskning" : "Confirm after review" },
                {
                  value: "confirmed",
                  label: sv
                    ? "Omfattning och saknade detaljer granskade"
                    : "Scope and missing details reviewed",
                },
              ]}
              onValueChange={(value) => {
                field.handleChange(value === "confirmed");
                field.handleBlur();
              }}
            />
          )}
        </form.Field>
      </RecordSection>
      <form.Subscribe selector={(state) => state.errors}>
        {(errors) => <Text role="alert">{errors.join(" ")}</Text>}
      </form.Subscribe>
      <AccountingStatus locale={locale} pending={seal.isPending} error={seal.error} write />
      <Box>
        <Button type="submit" disabled={seal.isPending || book.role !== "operator"}>
          {sv ? "Spara granskad importplan" : "Seal reviewed import plan"}
        </Button>
      </Box>
    </Box>
  );
}

export function SavedSiePlan({
  plan,
  preview,
  runId,
  onStarted,
}: {
  plan: string;
  preview?: string;
  runId?: string;
  onStarted: () => void;
}) {
  const { book, locale } = useBookWorkspace();
  const sv = locale === "sv";
  const keys = useRef(new Map<string, string>());
  const startPath = `${bookPath(book)}/sie-plans/${encodeURIComponent(plan)}/runs`;
  const start = useMutation({
    mutationFn: (digest: string) =>
      readAccounting(
        startPath,
        Sie.SieRunStart,
        mutationOptions(startPath, JSON.stringify({ digest }), keys.current),
      ),
    onSuccess: (result) => {
      if (result.planId !== plan) throw new Error("SIE staging plan identity mismatch");
      onStarted();
    },
  });
  const savedPlan = useQuery({
    queryKey: [...bookKey(book), "sie-plan", plan],

    retry: false,
    queryFn: async ({ signal }) => {
      const result = await readAccounting(
        `${bookPath(book)}/sie-plans/${encodeURIComponent(plan ?? "")}`,
        Sie.SiePlan,
        { signal },
      );
      checkScope(book, result.scope);
      if (result.id !== plan || result.previewId !== preview)
        throw new Error("SIE plan identity mismatch");
      return result;
    },
  });
  return (
    <RecordSection title={sv ? "Sparad importplan" : "Saved import plan"}>
      <AccountingStatus locale={locale} pending={savedPlan.isPending} error={savedPlan.error} />
      {savedPlan.data ? (
        <>
          <Text>
            {sv ? "Verifikationer i planen" : "Vouchers in the plan"}: {savedPlan.data.voucherCount}
          </Text>
          <Text>{savedPlan.data.input.rationale}</Text>
          <SavedOpenItems plan={savedPlan.data} />
          <Text>
            {sv
              ? "Planen är sparad. Ingen bokföring har utförts av detta steg."
              : "The plan is sealed. This step has not posted any entries."}
          </Text>
          {!runId && !start.data ? (
            <Button
              disabled={start.isPending || book.role !== "operator"}
              onClick={() => {
                if (savedPlan.data) start.mutate(savedPlan.data.digest);
              }}
            >
              {sv ? "Förbered källverifikationer" : "Stage source vouchers"}
            </Button>
          ) : null}
          <AccountingStatus locale={locale} pending={start.isPending} error={start.error} write />
          {runId || start.data ? (
            <SieStagingRun id={runId ?? start.data?.id ?? ""} plan={savedPlan.data} />
          ) : null}
        </>
      ) : null}
      {savedPlan.isError ? (
        <Button
          variant="outline"
          onClick={() => {
            void savedPlan.refetch();
          }}
        >
          {sv ? "Försök igen" : "Try again"}
        </Button>
      ) : null}
    </RecordSection>
  );
}
