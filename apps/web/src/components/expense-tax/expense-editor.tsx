import { useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Sources from "@open-erp/contracts/source-intake";
import * as Tax from "@open-erp/contracts/expense-tax";
import { Box } from "@open-erp/ui/components/box";
import { InputField, SelectField } from "@open-erp/ui/components/field";
import { RecordColumns, RecordSection } from "@open-erp/ui/components/record-layout";
import { PageCaption } from "@open-erp/ui/components/accounting-page";
import { EvidenceCommandForm } from "@/components/evidence-command-form";
import { OriginalDocument } from "@/components/original-document";
import { enteredExpenseSource, sourceDocumentOptions } from "@/lib/source-documents";
import { Button } from "@open-erp/ui/components/button";
import { AccountingStatus } from "@/components/accounting-status";
import { checkScope, type CommerceProps } from "@/components/commerce/shared";
import { bookKey, bookPath, readAccounting } from "@/lib/accounting-api";
import { decimalToMinor, minorToDecimal, workQueryOptions } from "@/lib/workspace-api";

export function ExpenseEditor(
  props: CommerceProps & {
    sourceId?: string;
    baseline?: typeof Tax.TaxSourceRevision.Type;
    onSaved: (id: string) => void;
  },
) {
  const sv = props.locale === "sv";
  const [baseline] = useState(props.baseline);
  const [units, setUnits] = useState<{ currency: string; scale: number } | null>(null);
  const [documentId, setDocumentId] = useState(props.sourceId ?? "");

  const document = useQuery({
    ...sourceDocumentOptions(props.book, documentId),
    enabled: !!documentId,
  });

  const documents = useInfiniteQuery({
    queryKey: [...bookKey(props.book), "document-inbox"],
    initialPageParam: "",
    queryFn: async ({ pageParam, signal }) => {
      const page = await readAccounting(
        `${bookPath(props.book)}/source-occurrences${pageParam ? `?cursor=${encodeURIComponent(pageParam)}` : ""}`,
        Sources.SourceInventory,
        { signal },
      );

      page.items.forEach((item) => checkScope(props.book, item.occurrence.scope));

      return page;
    },
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    retry: false,
  });

  const source = document.isError ? undefined : document.data?.occurrence;

  const originals =
    documents.data?.pages.flatMap((page) => page.items.map((item) => item.occurrence)) ?? [];

  const choices =
    source && !originals.some((item) => item.id === source.id) ? [source, ...originals] : originals;

  const [sourceKey] = useState(() => `expense_${crypto.randomUUID().replaceAll("-", "")}`);
  const metadata = useQuery(workQueryOptions(props.book, {}));

  const { currency, scale } = expenseCurrency(
    baseline?.facts,
    units,
    props.book.currency,
    metadata.data?.currencyScale,
  );

  if (baseline && (scale == null || currency == null))
    return (
      <EstablishExpenseCurrency
        locale={props.locale}
        currency={baseline.facts.currency}
        onSave={setUnits}
      />
    );

  if (scale == null || currency == null)
    return (
      <AccountingStatus locale={props.locale} pending={metadata.isPending} error={metadata.error} />
    );

  return (
    <EvidenceCommandForm
      {...props}
      path={`${bookPath(props.book)}/expense-tax/sources`}
      schema={Tax.RecordTaxSource}
      output={Tax.TaxSourceRevision}
      label={sv ? "Spara utgift" : "Save expense"}
      onSuccess={(source) => props.onSaved(source.sourceId)}
      canSubmit={!documentId || (!!source && !document.isFetching)}
      source={(fields) => ({
        title: fieldText(fields, "description") ?? "Expense",
        origin: source ? `Entered from ${source.filename}` : "Expense details entered in OpenERP",
        mediaType: "application/json",
        content: JSON.stringify({
          kind: "expense_entry_v1",
          source: source
            ? { occurrenceId: source.id, sha256: source.sha256, filename: source.filename }
            : null,
          fields: Object.fromEntries(fields),
        }),
      })}
      input={(fields, evidence) => ({
        sourceKey: baseline?.sourceKey ?? sourceKey,
        expectedSourceDigest: baseline?.digest ?? null,
        facts: {
          evidenceId: evidence.id,
          sourceLocator: source?.filename ?? evidence.title,
          description: fields.get("description"),
          recordClass: baseline?.facts.recordClass ?? fields.get("recordClass"),
          currency,
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
          suppliedOn: nullable(fields, "suppliedOn"),
          taxPointOn: nullable(fields, "taxPointOn"),
          changeSetId: baseline?.facts.changeSetId ?? null,
          voucherId: baseline?.facts.voucherId ?? null,
        },
      })}
    >
      <RecordSection title={sv ? "Underlag" : "Source document"}>
        <SelectField
          label={sv ? "Original" : "Original document"}
          value={documentId}
          onValueChange={(value) => setDocumentId(value ?? "")}
          options={[
            {
              value: "",
              label: sv
                ? "Ange uppgifterna utan en uppladdad fil"
                : "Enter details without an uploaded file",
            },
            ...choices.map((item) => ({ value: item.id, label: item.filename })),
          ]}
        />
        <AccountingStatus
          locale={props.locale}
          pending={documents.isPending || (!!documentId && document.isPending)}
          error={documents.error ?? document.error}
        />
        {documents.hasNextPage ? (
          <Box>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                void documents.fetchNextPage();
              }}
            >
              {sv ? "Läs in fler dokument" : "Load more documents"}
            </Button>
          </Box>
        ) : null}
      </RecordSection>
      <RecordColumns>
        {source ? (
          <OriginalDocument {...props} id={source.id} sha256={source.sha256} />
        ) : (
          <PageCaption>
            {sv
              ? "Lägg till uppgifterna från kvittot eller fakturan. Ett uppladdat original visas här."
              : "Enter the details from your receipt or invoice. An uploaded original appears here."}
          </PageCaption>
        )}
        <ExpenseFields
          {...props}
          baseline={baseline}
          scale={scale}
          currency={currency}
          description={source?.filename}
        />
      </RecordColumns>
    </EvidenceCommandForm>
  );
}

function ExpenseFields(
  props: CommerceProps & {
    description?: string;
    baseline?: typeof Tax.TaxSourceRevision.Type;
    currency: string;
    scale: number;
  },
) {
  const sv = props.locale === "sv";
  const facts = props.baseline?.facts;

  return (
    <RecordSection title={sv ? "Utgiftsuppgifter" : "Expense details"}>
      <InputField
        name="description"
        label={sv ? "Beskrivning" : "Description"}
        defaultValue={facts?.description ?? props.description}
        required
        maxLength={2000}
      />
      <ExpenseDates facts={facts} locale={props.locale} />
      <ExpenseAmounts
        amounts={facts?.amounts}
        scale={props.scale}
        currency={props.currency}
        locale={props.locale}
      />
      <PageCaption>
        {sv
          ? "Lämna okända belopp tomma. Momsbehandlingen granskas separat."
          : "Leave unknown amounts blank. Tax treatment is reviewed separately."}
      </PageCaption>
      <Box display="grid" columns={2} gap="lg">
        <InputField
          name="supplierCountry"
          defaultValue={facts?.supplierJurisdiction ?? ""}
          label={sv ? "Leverantörsland (landskod)" : "Supplier country (country code)"}
          placeholder="SE"
          pattern="[A-Z]{2}"
          maxLength={2}
        />
        <InputField
          name="supplyCountry"
          defaultValue={facts?.supplyJurisdiction ?? ""}
          label={sv ? "Leveransland (landskod)" : "Supply country (country code)"}
          placeholder="SE"
          pattern="[A-Z]{2}"
          maxLength={2}
        />
      </Box>
      <details>
        <summary>{sv ? "Leverans- och momsdatum" : "Supply and tax dates"}</summary>
        <Box display="grid" columns={2} gap="md" paddingBlock="lg">
          <InputField
            name="suppliedOn"
            type="date"
            label={sv ? "Leveransdatum" : "Supply date"}
            defaultValue={facts?.suppliedOn ?? ""}
          />
          <InputField
            name="taxPointOn"
            type="date"
            label={sv ? "Momsdatum" : "Tax point date"}
            defaultValue={facts?.taxPointOn ?? ""}
          />
        </Box>
      </details>
      <SelectField
        name="recordClass"
        label={sv ? "Underlagstyp" : "Source type"}
        defaultValue={
          facts?.recordClass ??
          (props.book.profile === "synthetic-core-v1" ? "synthetic" : "actual_company")
        }
        disabled={!!props.baseline}
        options={[
          { value: "actual_company", label: sv ? "Företagets underlag" : "Company document" },
          { value: "synthetic", label: sv ? "Demounderlag" : "Demo source" },
        ]}
      />
    </RecordSection>
  );
}

function fieldText(fields: FormData, name: string) {
  const value = fields.get(name);

  return typeof value === "string" && value.trim() ? value.trim() : null;
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

function editableAmount(value: string | null | undefined, scale: number) {
  return value == null ? "" : minorToDecimal(value, scale);
}

export function ExpenseRevisionEditor(
  props: CommerceProps & {
    baseline: typeof Tax.TaxSourceRevision.Type;
    onSaved: (id: string) => void;
  },
) {
  const evidence = useQuery({
    queryKey: [...bookKey(props.book), "evidence", props.baseline.facts.evidenceId],
    queryFn: async ({ signal }) => {
      const result = await readAccounting(
        `${bookPath(props.book)}/evidence/${encodeURIComponent(props.baseline.facts.evidenceId)}`,
        Accounting.EvidenceContent,
        { signal },
      );

      if (
        result.id !== props.baseline.facts.evidenceId ||
        result.sha256 !== props.baseline.evidenceSha256
      )
        throw new Error("Expense source mismatch");

      return result;
    },
    retry: false,
  });

  if (!evidence.isSuccess)
    return (
      <AccountingStatus locale={props.locale} pending={evidence.isPending} error={evidence.error} />
    );

  return (
    <ExpenseEditor
      {...props}
      sourceId={enteredExpenseSource(evidence.data.content)?.occurrenceId}
    />
  );
}

function ExpenseAmounts(props: {
  amounts?: typeof Tax.TaxAmounts.Type;
  scale: number;
  currency: string;
  locale: CommerceProps["locale"];
}) {
  const sv = props.locale === "sv";

  return (
    <Box display="grid" columns={3} gap="lg">
      <InputField
        name="gross"
        defaultValue={editableAmount(props.amounts?.grossMinor, props.scale)}
        label={`${sv ? "Totalt" : "Total"} · ${props.currency}`}
        inputMode="decimal"
      />
      <InputField
        name="net"
        defaultValue={editableAmount(props.amounts?.netMinor, props.scale)}
        label={sv ? "Exkl. moms" : "Before tax"}
        inputMode="decimal"
      />
      <InputField
        name="vat"
        defaultValue={editableAmount(props.amounts?.vatMinor, props.scale)}
        label={sv ? "Moms" : "Tax"}
        inputMode="decimal"
      />
    </Box>
  );
}

function ExpenseDates(props: {
  facts?: typeof Tax.TaxSourceFacts.Type;
  locale: CommerceProps["locale"];
}) {
  const sv = props.locale === "sv";
  const facts = props.facts;

  return (
    <Box display="grid" columns={2} gap="lg">
      <InputField
        name="issuedOn"
        defaultValue={facts?.issuedOn ?? ""}
        label={sv ? "Dokumentdatum" : "Document date"}
        type="date"
      />
      <InputField
        name="receivedOn"
        defaultValue={facts?.receivedOn ?? ""}
        label={sv ? "Mottaget datum" : "Received date"}
        type="date"
      />
    </Box>
  );
}

function EstablishExpenseCurrency(props: {
  locale: "en" | "sv";
  currency: string | null;
  onSave: (units: { currency: string; scale: number }) => void;
}) {
  const sv = props.locale === "sv";

  return (
    <Box
      as="form"
      display="grid"
      gap="lg"
      onSubmit={(event) => {
        event.preventDefault();
        const fields = new FormData(event.currentTarget);
        const currency = fields.get("currency");
        const scale = fields.get("scale");

        if (
          typeof currency === "string" &&
          /^[A-Z]{3}$/.test(currency) &&
          typeof scale === "string" &&
          /^[0-6]$/.test(scale)
        )
          props.onSave({ currency, scale: Number(scale) });
      }}
    >
      <PageCaption>
        {sv
          ? "Kontrollera valutan och beloppsformatet mot originalet innan du redigerar beloppen."
          : "Check the currency and amount format against the original before editing amounts."}
      </PageCaption>
      <InputField
        name="currency"
        label={sv ? "Valuta" : "Currency"}
        required
        pattern="[A-Z]{3}"
        maxLength={3}
        defaultValue={props.currency ?? ""}
      />
      <SelectField
        name="scale"
        label={sv ? "Beloppsformat" : "Amount format"}
        required
        defaultValue=""
        options={[
          { value: "", label: sv ? "Välj från originalet" : "Choose from the original" },
          ...[0, 1, 2, 3, 4, 5, 6].map((scale) => ({
            value: String(scale),
            label: minorToDecimal("1234567", scale),
          })),
        ]}
      />
      <Box>
        <Button type="submit">{sv ? "Fortsätt" : "Continue"}</Button>
      </Box>
    </Box>
  );
}

function expenseCurrency(
  facts: typeof Tax.TaxSourceFacts.Type | undefined,
  units: { currency: string; scale: number } | null,
  bookCurrency: string,
  bookScale: number | undefined,
) {
  if (!facts) return { currency: bookCurrency, scale: bookScale };

  return {
    currency: facts.currency ?? units?.currency,
    scale: facts.currencyScale ?? units?.scale,
  };
}
