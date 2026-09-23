import { useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import * as Sources from "@open-erp/contracts/source-intake";
import * as Tax from "@open-erp/contracts/expense-tax";
import { Box } from "@open-erp/ui/components/box";
import { InputField, SelectField } from "@open-erp/ui/components/field";
import { RecordColumns, RecordSection } from "@open-erp/ui/components/record-layout";
import { PageCaption } from "@open-erp/ui/components/accounting-page";
import { EvidenceCommandForm } from "@/components/evidence-command-form";
import { OriginalDocument } from "@/components/original-document";
import { sourceDocumentOptions } from "@/lib/source-documents";
import { Button } from "@open-erp/ui/components/button";
import { AccountingStatus } from "@/components/accounting-status";
import { checkScope, type CommerceProps } from "@/components/commerce/shared";
import { bookKey, bookPath, readAccounting } from "@/lib/accounting-api";
import { decimalToMinor, workQueryOptions } from "@/lib/workspace-api";

export function ExpenseEditor(
  props: CommerceProps & { sourceId?: string; onSaved: (id: string) => void },
) {
  const sv = props.locale === "sv";
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
  const scale = metadata.data?.currencyScale;
  if (scale === undefined)
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
        <ExpenseFields {...props} description={source?.filename} />
      </RecordColumns>
    </EvidenceCommandForm>
  );
}
function ExpenseFields(props: CommerceProps & { description?: string }) {
  const sv = props.locale === "sv";
  return (
        <RecordSection title={sv ? "Utgiftsuppgifter" : "Expense details"}>
          <InputField
            name="description"
            label={sv ? "Beskrivning" : "Description"}
            defaultValue={props.description}
            required
            maxLength={2000}
          />
          <Box display="grid" columns={2} gap="lg">
            <InputField
              name="issuedOn"
              label={sv ? "Dokumentdatum" : "Document date"}
              type="date"
            />
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
            defaultValue={
              props.book.profile === "synthetic-core-v1" ? "synthetic" : "actual_company"
            }
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
