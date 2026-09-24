import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import * as Suppliers from "@open-erp/contracts/supplier-invoice-drafts";
import { ArrowLeft, Plus, Pencil } from "lucide-react";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { Badge } from "@open-erp/ui/components/badge";
import { DataTable } from "@open-erp/ui/components/data-table";
import { FormDialog } from "@open-erp/ui/components/form-dialog";
import {
  PageCaption,
  PageEmpty,
  RecordOpen,
  RegisterSearch,
} from "@open-erp/ui/components/accounting-page";
import {
  RecordColumns,
  RecordSection,
  RecordHeading,
  RecordSummary,
  RecordFact,
} from "@open-erp/ui/components/record-layout";
import { Text } from "@open-erp/ui/components/typography";
import { AccountingStatus } from "@/components/accounting-status";
import { EvidenceInspector } from "@/components/evidence-inspector";
import { readAccounting } from "@/lib/accounting-api";
import { formatMinorAmount } from "@/lib/workspace-api";
import { invoiceDraftBlocker } from "./invoice-draft-copy";
import { SupplierInvoiceEditor } from "./supplier-invoice-editor";
import {
  Details,
  Facts,
  checkScope,
  commerceKey,
  commercePath,
  type CommerceProps,
} from "./shared";

type Draft = typeof Suppliers.SupplierInvoiceDraftRevision.Type;
export function SupplierInvoiceDrafts(
  props: CommerceProps & { recordId?: string; onOpen: (id: string) => void },
) {
  const sv = props.locale === "sv";
  const [search, setSearch] = useState("");
  const creating = props.recordId === "new" || props.recordId?.startsWith("new:");
  const list = useQuery({
    queryKey: [...commerceKey(props.book), "supplier-invoice-drafts"],
    queryFn: async ({ signal }) => {
      const result = await readAccounting(
        `${commercePath(props.book)}/supplier-invoice-drafts`,
        Suppliers.SupplierInvoiceDraftList,
        { signal },
      );
      checkScope(props.book, result.scope);
      return result;
    },
    retry: false,
  });
  if (props.recordId && !creating)
    return (
      <Box display="grid" gap="xl">
        <Box>
          <Button variant="ghost" onClick={() => props.onOpen("")}>
            <ArrowLeft size={14} />
            {sv ? "Alla utkast" : "All drafts"}
          </Button>
        </Box>
        <SupplierDraftDetail {...props} key={props.recordId} id={props.recordId} />
      </Box>
    );
  const matches =
    list.data?.items.filter((record) =>
      `${record.title} ${record.supplierName} ${record.supplierDocumentNumber ?? ""}`
        .toLocaleLowerCase(props.locale)
        .includes(search.toLocaleLowerCase(props.locale)),
    ) ?? [];
  return (
    <Box display="grid" gap="xl">
      <RecordHeading
        title={sv ? "Fakturor att förbereda" : "Invoices to prepare"}
        subtitle={
          sv
            ? "Granska originalet, fyll i uppgifter och spara för fortsatt arbete."
            : "Review the original, capture the details and save your work."
        }
        action={
          <Button disabled={props.book.role !== "operator"} onClick={() => props.onOpen("new")}>
            <Plus size={14} />
            {sv ? "Ny leverantörsfaktura" : "New supplier invoice"}
          </Button>
        }
      />
      <RegisterSearch
        aria-label={sv ? "Sök fakturautkast" : "Search invoice drafts"}
        placeholder={
          sv
            ? "Sök leverantör, fakturanummer eller beskrivning…"
            : "Search supplier, invoice number or description…"
        }
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <AccountingStatus locale={props.locale} pending={list.isPending} error={list.error} />
      {list.isError ? (
        <Box>
          <Button
            variant="outline"
            onClick={() => {
              void list.refetch();
            }}
          >
            {sv ? "Försök igen" : "Retry"}
          </Button>
        </Box>
      ) : null}
      {list.isSuccess ? (
        matches.length ? (
          <DataTable
            title={sv ? "Leverantörsfakturautkast" : "Supplier invoice drafts"}
            narrow="stack"
            columns={[
              { id: "supplier", label: sv ? "Leverantör / faktura" : "Supplier / invoice" },
              { id: "description", label: sv ? "Beskrivning" : "Description" },
              { id: "saved", label: sv ? "Senast sparad" : "Last saved" },
              { id: "status", label: "Status" },
              { id: "amount", label: sv ? "Belopp" : "Amount", numeric: true },
            ]}
            rows={matches.map((record) => ({
              id: record.id,
              cells: [
                <RecordOpen key="open" onClick={() => props.onOpen(record.id)}>
                  {record.supplierName}
                  {record.supplierDocumentNumber ? ` · ${record.supplierDocumentNumber}` : ""}
                </RecordOpen>,
                record.title,
                new Intl.DateTimeFormat(props.locale, { dateStyle: "medium" }).format(
                  new Date(record.createdAt),
                ),
                <Badge key="status" variant="secondary">
                  {sv ? "Utkast" : "Draft"}
                </Badge>,
                money(record.grossMinor, record.currencyScale, record.currency, props.locale),
              ],
            }))}
          />
        ) : (
          <PageEmpty
            title={
              sv
                ? search
                  ? "Inga matchande fakturor"
                  : "Börja med originalfakturan"
                : search
                  ? "No matching invoices"
                  : "Start with the original invoice"
            }
            detail={
              sv
                ? "Ladda upp eller välj ett sparat dokument, välj leverantör och granska beloppen."
                : "Upload or choose a saved document, select the supplier and review the amounts."
            }
          />
        )
      ) : null}
      <PageCaption>
        {sv
          ? "Sparade utkast har inte attesterats eller bokförts genom detta flöde. Redan registrerade fakturor finns under Registrerade."
          : "Saving drafts here does not approve or post them. Previously registered invoices are under Registered."}
      </PageCaption>
      {creating ? (
        <FormDialog
          title={sv ? "Ny leverantörsfaktura" : "New supplier invoice"}
          closeLabel={sv ? "Stäng" : "Close"}
          onClose={() => props.onOpen("")}
        >
          <SupplierInvoiceEditor
            {...props}
            sourceId={props.recordId?.startsWith("new:") ? props.recordId.slice(4) : undefined}
            onSaved={props.onOpen}
          />
        </FormDialog>
      ) : null}
    </Box>
  );
}
function SupplierDraftDetail(props: CommerceProps & { id: string }) {
  const sv = props.locale === "sv";
  const [revision, setRevision] = useState("");
  const [editing, setEditing] = useState<Draft | null>(null);
  const draft = useQuery({
    queryKey: [...commerceKey(props.book), "supplier-invoice-draft", props.id, revision],
    queryFn: async ({ signal }) => {
      const result = await readAccounting(
        `${commercePath(props.book)}/supplier-invoice-drafts/${encodeURIComponent(props.id)}${revision ? `?revision=${encodeURIComponent(revision)}` : ""}`,
        Suppliers.SupplierInvoiceDraftView,
        { signal },
      );
      checkScope(props.book, result.record.scope);
      if (result.record.id !== props.id || (revision && result.record.revision !== revision))
        throw new Error("Supplier draft identity mismatch");
      return result;
    },
    retry: false,
  });
  const record = draft.isError ? undefined : draft.data?.record;
  const current = record?.revision === draft.data?.currentRevision;
  return (
    <Box display="grid" gap="xl">
      <AccountingStatus locale={props.locale} pending={draft.isPending} error={draft.error} />
      {draft.isError ? (
        <Box>
          <Button
            variant="outline"
            onClick={() => {
              void draft.refetch();
            }}
          >
            {sv ? "Försök igen" : "Retry"}
          </Button>
        </Box>
      ) : null}
      {record ? (
        <>
          <RecordHeading
            title={record.content.title}
            subtitle={`${record.content.supplier.legalName} · ${record.content.supplierDocumentNumber ?? (sv ? "Fakturanummer saknas" : "Invoice number missing")}`}
            action={
              current ? (
                <Button
                  disabled={props.book.role !== "operator"}
                  onClick={() => setEditing(record)}
                >
                  <Pencil size={14} />
                  {sv ? "Redigera utkast" : "Edit draft"}
                </Button>
              ) : (
                <Button variant="outline" onClick={() => setRevision("")}>
                  {sv ? "Visa senaste versionen" : "Show latest version"}
                </Button>
              )
            }
          />
          <Box>
            <Badge variant={current ? "secondary" : "warning"}>
              {current
                ? sv
                  ? "Utkast"
                  : "Draft"
                : sv
                  ? `Tidigare version ${record.revision}`
                  : `Earlier version ${record.revision}`}
            </Badge>
          </Box>
          <RecordSummary>
            <RecordFact label={sv ? "Fakturadatum" : "Invoice date"}>
              {record.content.documentDate ?? "—"}
            </RecordFact>
            <RecordFact label={sv ? "Förfallodatum" : "Due date"}>
              {record.content.dueDate ?? "—"}
            </RecordFact>
            <RecordFact label={sv ? "Totalt enligt rader" : "Calculated total"}>
              {money(
                record.totals.grossMinor,
                record.content.currencyScale,
                record.content.currency,
                props.locale,
              )}
            </RecordFact>
            <RecordFact label={sv ? "Originalets total" : "Original total"}>
              {money(
                record.content.sourceTotalMinor,
                record.content.currencyScale,
                record.content.currency,
                props.locale,
              )}
            </RecordFact>
          </RecordSummary>
          <RecordColumns>
            <RecordSection title={sv ? "Originalfaktura" : "Original invoice"} sticky>
              <EvidenceInspector
                {...props}
                expanded
                compact
                reference={{ ...record.sourceEvidence, locator: record.content.title }}
              />
            </RecordSection>
            <Box display="grid" gap="xl">
              <SupplierDraftChecks {...props} record={record} />
              <RecordSection title={sv ? "Fakturauppgifter" : "Invoice details"}>
                <Text>
                  <strong>{sv ? "Leverantör" : "Supplier"}</strong>
                  <br />
                  {record.content.supplier.legalName}
                  <br />
                  {record.content.supplier.address ?? "—"}
                </Text>
                <Text>
                  <strong>{sv ? "Fakturamottagare" : "Billed to"}</strong>
                  <br />
                  {record.content.buyer.legalName}
                  <br />
                  {record.content.buyer.address ?? "—"}
                </Text>
                <Text>
                  {sv ? "Leveransdatum" : "Supply date"}: {record.content.supplyDate ?? "—"}
                </Text>
                <Text>
                  {sv ? "Betalningsvillkor" : "Payment terms"}: {record.content.paymentTerms ?? "—"}
                </Text>
              </RecordSection>
              <PageCaption>
                {sv
                  ? "Attest, bokföring och betalning stöds inte från utkastet. Om originalet har bokförts någon annanstans måste det kontrolleras separat."
                  : "Approval, posting and payment are not supported from this draft. Recognition of the original elsewhere must be checked separately."}
              </PageCaption>
            </Box>
          </RecordColumns>
          <SupplierDraftLines {...props} record={record} />
          <Details title={sv ? "Versionshistorik" : "Version history"}>
            <SupplierDraftHistory {...props} selected={record.revision} onSelect={setRevision} />
          </Details>
          <Facts
            title={
              sv
                ? "Sparade uppgifter och beräkningsunderlag"
                : "Retained facts and calculation basis"
            }
            value={record}
          />
        </>
      ) : null}
      {editing ? (
        <FormDialog
          title={sv ? "Redigera leverantörsfaktura" : "Edit supplier invoice"}
          closeLabel={sv ? "Stäng" : "Close"}
          onClose={() => setEditing(null)}
        >
          <SupplierInvoiceEditor
            {...props}
            baseline={editing}
            onSaved={() => {
              setEditing(null);
              setRevision("");
            }}
          />
        </FormDialog>
      ) : null}
    </Box>
  );
}
function money(
  value: string | null,
  scale: number,
  currency: string,
  locale: CommerceProps["locale"],
) {
  return value === null ? "—" : `${formatMinorAmount(value, scale, locale)} ${currency}`;
}
function SupplierDraftLines(props: CommerceProps & { record: Draft }) {
  const sv = props.locale === "sv";
  const content = props.record.content;
  const display = (value: string | null) =>
    money(value, content.currencyScale, content.currency, props.locale);
  return (
    <DataTable
      title={sv ? "Fakturarader" : "Invoice lines"}
      narrow="stack"
      columns={[
        { id: "description", label: sv ? "Beskrivning" : "Description" },
        { id: "quantity", label: sv ? "Antal" : "Quantity", numeric: true },
        { id: "net", label: sv ? "Exkl. moms" : "Before tax", numeric: true },
        { id: "tax", label: sv ? "Moms" : "Tax", numeric: true },
        { id: "total", label: sv ? "Totalt" : "Total", numeric: true },
      ]}
      rows={content.lines.map((line) => {
        const calculated = props.record.calculatedLines.find((item) => item.id === line.id);
        return {
          id: line.id,
          cells: [
            line.description,
            line.quantity,
            display(calculated?.netMinor ?? null),
            display(line.taxMinor),
            display(calculated?.grossMinor ?? null),
          ],
        };
      })}
    />
  );
}
const platformBlockers = new Set([
  "acceptance_not_implemented",
  "recognition_not_implemented",
  "legal_identity_not_verified",
  "tax_profile_not_activated",
]);
function SupplierDraftChecks(props: CommerceProps & { record: Draft }) {
  const sv = props.locale === "sv";
  const blockers = props.record.blockers.filter((blocker) => !platformBlockers.has(blocker.code));
  return (
    <RecordSection title={sv ? "Att granska" : "Review details"}>
      {props.record.totals.sourceTotalMatches !== null ? (
        <Badge variant={props.record.totals.sourceTotalMatches ? "success" : "warning"}>
          {props.record.totals.sourceTotalMatches
            ? sv
              ? "Totalen stämmer med originalet"
              : "Total matches the original"
            : sv
              ? "Totalen skiljer sig från originalet"
              : "Total differs from the original"}
        </Badge>
      ) : null}
      {blockers.map((blocker, index) => {
        const line = props.record.content.lines.findIndex((item) => item.id === blocker.lineId);
        return (
          <Text key={`${blocker.code}:${index}`}>
            {line >= 0 ? `${sv ? "Rad" : "Line"} ${line + 1}: ` : ""}
            {supplierBlocker(blocker.code, props.locale)}
          </Text>
        );
      })}
      {!blockers.length ? (
        <Text>
          {sv
            ? "Inga saknade uppgifter eller beloppsskillnader i utkastets kontroller."
            : "No missing details or amount differences in the draft checks."}
        </Text>
      ) : null}
      <PageCaption>
        {sv
          ? "Juridisk identitet och skattebehandling är inte verifierade. Uppgifterna ovan är en granskning av utkastets innehåll."
          : "Legal identity and tax treatment are not verified. These checks review the draft content."}
      </PageCaption>
    </RecordSection>
  );
}
function supplierBlocker(code: string, locale: CommerceProps["locale"]) {
  const sv = locale === "sv";
  if (code === "supplier_document_number_missing")
    return sv ? "Lägg till leverantörens fakturanummer." : "Add the supplier invoice number.";
  if (code === "supplier_identity_fields_missing")
    return sv
      ? "Komplettera leverantörens organisationsnummer, adress och land."
      : "Complete the supplier registration number, address and country.";
  if (code === "buyer_identity_fields_missing")
    return sv
      ? "Komplettera fakturamottagarens organisationsnummer, adress och land."
      : "Complete the buyer registration number, address and country.";
  if (code === "dates_or_terms_missing")
    return sv
      ? "Komplettera fakturadatum, leveransdatum, förfallodatum och betalningsvillkor."
      : "Complete the invoice, supply and due dates and payment terms.";
  return invoiceDraftBlocker(code, locale);
}
function SupplierDraftHistory(
  props: CommerceProps & { id: string; selected: string; onSelect: (revision: string) => void },
) {
  const sv = props.locale === "sv";
  const history = useQuery({
    queryKey: [...commerceKey(props.book), "supplier-invoice-draft-history", props.id],
    queryFn: async ({ signal }) => {
      const result = await readAccounting(
        `${commercePath(props.book)}/supplier-invoice-drafts/${encodeURIComponent(props.id)}/revisions`,
        Suppliers.SupplierInvoiceDraftHistory,
        { signal },
      );
      checkScope(props.book, result.scope);
      if (result.id !== props.id) throw new Error("Supplier draft history mismatch");
      return result;
    },
    retry: false,
  });
  return (
    <Box display="grid" gap="md">
      <AccountingStatus locale={props.locale} pending={history.isPending} error={history.error} />
      {history.isError ? (
        <Box>
          <Button
            variant="outline"
            onClick={() => {
              void history.refetch();
            }}
          >
            {sv ? "Försök igen" : "Retry"}
          </Button>
        </Box>
      ) : null}
      {history.isSuccess
        ? history.data.items.map((item) => (
            <RecordOpen key={item.revision} onClick={() => props.onSelect(item.revision)}>
              {sv ? "Version" : "Version"} {item.revision} ·{" "}
              {new Intl.DateTimeFormat(props.locale, {
                dateStyle: "medium",
                timeStyle: "short",
              }).format(new Date(item.createdAt))}
              {item.revision === props.selected ? (sv ? " · Visas" : " · Viewing") : ""}
            </RecordOpen>
          ))
        : null}
    </Box>
  );
}
