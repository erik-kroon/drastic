import { useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import * as Schema from "effect/Schema";
import type * as Accounting from "@open-erp/contracts/accounting";
import * as Vat from "@open-erp/contracts/vat-returns";
import * as Tax from "@open-erp/contracts/expense-tax";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { InputField, SelectField } from "@open-erp/ui/components/field";
import { Disclosure } from "@open-erp/ui/components/disclosure";
import { ChoiceField } from "@open-erp/ui/components/choice-field";
import { RecordSection } from "@open-erp/ui/components/record-layout";
import { FormActions } from "@open-erp/ui/components/form-actions";
import { PageCaption } from "@open-erp/ui/components/accounting-page";
import { VatFactEditor } from "./fact-editor";
import { Text } from "@open-erp/ui/components/typography";
import { AccountingStatus } from "@/components/accounting-status";
import { bookKey, bookPath, mutationOptions, readAccounting } from "@/lib/accounting-api";
import type { Locale } from "@/paraglide/runtime";
import { vatCopy } from "./copy";

type Common = { book: typeof Accounting.Book.Type; locale: Locale };

function nullable(fields: FormData, name: string) {
  const value = fields.get(name);

  return typeof value === "string" && value !== "" ? value : null;
}

export function VatFactForm(
  props: Common & { current?: typeof Vat.VatFact.Type; onSaved: (id: string) => void },
) {
  const { book, locale, current } = props;
  const copy = vatCopy(locale);
  const [expenseId, setExpenseId] = useState("");

  const expenses = useQuery({
    queryKey: [...bookKey(book), "expense-tax", "inventory"],
    queryFn: ({ signal }) =>
      readAccounting(`${bookPath(book)}/expense-tax/sources`, Tax.TaxInventory, { signal }),
    retry: false,
    enabled: !current,
  });

  const importable =
    expenses.data?.sources.filter(
      (row) => row.reviewCurrent && row.latestReview?.facts.treatment === "domestic_purchase",
    ) ?? [];

  const source = importable.find((row) => row.current.sourceId === expenseId && row.reviewCurrent);
  const review = source?.latestReview;

  const imported: Partial<typeof Vat.VatFactInput.Type> | undefined =
    source && review
      ? {
          sourceKey: `expense_${source.current.sourceId}`,
          recordClass: source.current.facts.recordClass,
          evidenceId: source.current.facts.evidenceId,
          sourceLocator: source.current.facts.sourceLocator,
          description: source.current.facts.description,
          reviewEvidenceId: review.facts.evidenceId,
          reviewRationale: review.facts.rationale,
          treatment: "domestic_purchase",
          netMinor: review.facts.amounts.netMinor ?? undefined,
          vatMinor: review.facts.amounts.vatMinor ?? undefined,
          grossMinor: review.facts.amounts.grossMinor ?? undefined,
          currency: source.current.facts.currency,
          issuedOn: source.current.facts.issuedOn,
          receivedOn: source.current.facts.receivedOn,
          suppliedOn: review.facts.suppliedOn,
          taxPointOn: review.facts.taxPointOn,
          dateBasis: review.facts.dateBasis,
          registration: review.facts.registration,
          registrationEvidenceId: review.facts.registrationEvidenceId,
          method: review.facts.method,
          methodEvidenceId: review.facts.methodEvidenceId,
          voucherId: source.current.facts.voucherId,
          deductionEvidenceId: review.facts.deductionEvidenceId,
          expenseLink: {
            sourceId: source.current.sourceId,
            sourceDigest: source.current.digest,
            reviewDigest: review.digest,
          },
        }
      : undefined;

  return (
    <Box display="grid" gap="lg" minWidth="zero">
      {!current ? (
        <>
          {importable.length ? (
            <SelectField
              label={copy.importExpense}
              value={expenseId}
              onValueChange={(value) => setExpenseId(value ?? "")}
              options={[
                { value: "", label: copy.noImport },
                ...importable.map((row) => ({
                  value: row.current.sourceId,
                  label: row.current.facts.description,
                })),
              ]}
            />
          ) : null}
          <AccountingStatus locale={locale} pending={expenses.isPending} error={expenses.error} />
        </>
      ) : null}
      <VatFactEditor
        key={current?.digest ?? expenseId}
        {...props}
        initial={current?.input ?? imported}
      />
    </Box>
  );
}

export function VatDraftForm({
  book,
  locale,
  onSaved,
}: Common & { onSaved: (id: string) => void }) {
  const copy = vatCopy(locale);
  const sv = locale === "sv";
  const [mode, setMode] = useState<(typeof Vat.PrepareVatDraft.Type)["mode"]>("actual_review");
  const [invalid, setInvalid] = useState(false);
  const keys = useRef(new Map<string, string>());

  const prepare = useMutation({
    mutationFn: (input: typeof Vat.PrepareVatDraft.Type) => {
      const path = `${bookPath(book)}/vat-returns/drafts`;

      return readAccounting(
        path,
        Vat.VatDraft,
        mutationOptions(path, JSON.stringify(input), keys.current),
      );
    },
    onSuccess: (draft, input) => {
      keys.current.delete(`${bookPath(book)}/vat-returns/drafts:${JSON.stringify(input)}`);
      onSaved(draft.id);
    },
  });

  return (
    <Box
      as="form"
      display="grid"
      gap="lg"
      minWidth="zero"
      onSubmit={(event) => {
        event.preventDefault();
        const fields = new FormData(event.currentTarget);

        const decoded = Schema.decodeUnknownOption(Vat.PrepareVatDraft)({
          mode,
          startsOn: fields.get("startsOn"),
          endsOn: fields.get("endsOn"),
          periodEvidenceId: nullable(fields, "periodEvidenceId"),
          otherBoxes: mode === "actual_review" ? "unknown" : fields.get("otherBoxes"),
        });

        setInvalid(decoded._tag === "None");

        if (decoded._tag === "Some") prepare.mutate(decoded.value);
      }}
    >
      <Box
        as="fieldset"
        disabled={prepare.isPending}
        borderWidth="none"
        padding="none"
        margin="none"
        display="grid"
        gap="xl"
        minWidth="zero"
      >
        <ChoiceField
          label={copy.mode}
          value={mode}
          onValueChange={(value) =>
            setMode(
              value === "synthetic_demonstration" ? "synthetic_demonstration" : "actual_review",
            )
          }
          options={[
            {
              value: "actual_review",
              label: copy.actual,
              description: sv
                ? "Granska företagets underlag. Deklarationsbelopp är ännu inte tillgängliga."
                : "Review company records. Return amounts are not available yet.",
            },
            {
              value: "synthetic_demonstration",
              label: copy.synthetic,
              description: sv
                ? "Beräkna ett exempel med syntetiska underlag."
                : "Calculate an example using synthetic records.",
            },
          ]}
        />
        <RecordSection title={sv ? "Rapportperiod" : "Reporting period"}>
          <Box display="grid" columns={2} gap="md">
            <InputField label={copy.startsOn} name="startsOn" type="date" required />
            <InputField label={copy.endsOn} name="endsOn" type="date" required />
          </Box>
          <Disclosure
            label={sv ? "Periodunderlag (valfritt)" : "Period evidence (optional)"}
            variant="inline"
          >
            <Box display="grid" gap="md" paddingBlock="md">
              <InputField label={copy.periodEvidenceId} name="periodEvidenceId" />
              <PageCaption>
                {sv
                  ? "Referens till ett sparat underlag som fastställer rapportperioden."
                  : "Reference to retained evidence establishing the reporting period."}
              </PageCaption>
            </Box>
          </Disclosure>
        </RecordSection>
        {mode === "synthetic_demonstration" ? (
          <ChoiceField
            label={copy.otherBoxes}
            name="otherBoxes"
            defaultValue="unknown"
            options={[
              { value: "unknown", label: copy.unknown },
              { value: "absent_in_synthetic_example", label: copy.absence },
            ]}
          />
        ) : null}
        <FormActions>
          <PageCaption>
            {sv ? "Utkastet sparas för granskning." : "The draft is saved for review."}
          </PageCaption>
          <Button type="submit">
            {prepare.isPending ? (sv ? "Sparar…" : "Saving…") : copy.prepare}
          </Button>
        </FormActions>
      </Box>
      <Text role="status">{invalid ? copy.invalid : prepare.isSuccess ? copy.saved : ""}</Text>
      <AccountingStatus locale={locale} write pending={prepare.isPending} error={prepare.error} />
    </Box>
  );
}
