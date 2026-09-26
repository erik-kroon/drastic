import { useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import * as Payments from "@open-erp/contracts/supplier-payment-batches";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { ChoiceField } from "@open-erp/ui/components/choice-field";
import { DataTable } from "@open-erp/ui/components/data-table";
import { InputField } from "@open-erp/ui/components/field";
import { FormDialog } from "@open-erp/ui/components/form-dialog";
import { PageCaption, PageEmpty } from "@open-erp/ui/components/accounting-page";
import { RecordHeading, RecordSection } from "@open-erp/ui/components/record-layout";
import { Text } from "@open-erp/ui/components/typography";
import { AccountingStatus } from "@/components/accounting-status";
import { readAccounting } from "@/lib/accounting-api";
import { decimalToMinor, formatMinorAmount, minorToDecimal } from "@/lib/workspace-api";
import { CommandForm, checkScope, commerceKey, commercePath, type CommerceProps } from "./shared";

type EligibleInvoice = (typeof Payments.PaymentEligibility.Type)["items"][number];

function field(fields: FormData, name: string) {
  const value = fields.get(name);

  return typeof value === "string" ? value.trim() : "";
}

function paymentPath(props: CommerceProps) {
  return `${commercePath(props.book)}/supplier-payment-batches`;
}

export function SupplierPaymentFiles(props: CommerceProps & { recordId?: string }) {
  const sv = props.locale === "sv";
  const [batchId, setBatchId] = useState(props.recordId ?? "");
  const [payee, setPayee] = useState<EligibleInvoice | null>(null);
  const [payeeId, setPayeeId] = useState("");

  const eligibility = useInfiniteQuery({
    queryKey: [...commerceKey(props.book), "supplier-payment-eligibility"],
    initialPageParam: "",
    queryFn: async ({ pageParam, signal }) => {
      const result = await readAccounting(
        `${paymentPath(props)}/eligibility${pageParam ? `?after=${encodeURIComponent(pageParam)}` : ""}`,
        Payments.PaymentEligibility,
        { signal },
      );

      checkScope(props.book, result.scope);

      return result;
    },
    getNextPageParam: (page) => page.next ?? undefined,
    retry: false,
  });

  const invoices = eligibility.data?.pages.flatMap((page) => page.items) ?? [];
  const ready = invoices.filter((invoice) => invoice.eligible && invoice.payeeVerification);

  return (
    <Box display="grid" gap="xl">
      <RecordHeading
        title={sv ? "Betalningsfiler för leverantörer" : "Supplier payment files"}
        subtitle={
          sv ? "Förbered och exportera en betalningsfil." : "Prepare and export a payment file."
        }
      />
      <RecordSection title={sv ? "Behörighet och betalningsuppgifter" : "Eligibility and payees"}>
        <AccountingStatus
          locale={props.locale}
          pending={eligibility.isPending}
          error={eligibility.error}
        />
        {eligibility.isError ? (
          <Button variant="outline" onClick={() => void eligibility.refetch()}>
            {sv ? "Försök igen" : "Retry"}
          </Button>
        ) : null}
        {eligibility.isSuccess && !invoices.length ? (
          <PageEmpty
            title={sv ? "Inga registrerade leverantörsfakturor" : "No registered supplier invoices"}
            detail={
              sv ? "Godkänn en faktura för att se den här." : "Accept an invoice to see it here."
            }
          />
        ) : null}
        {invoices.length ? (
          <DataTable
            title={sv ? "Leverantörsfakturor för betalningsfil" : "Invoices for payment file"}
            narrow="stack"
            columns={[
              { id: "invoice", label: sv ? "Faktura" : "Invoice" },
              { id: "amount", label: sv ? "Kvarstående" : "Outstanding", numeric: true },
              { id: "payee", label: sv ? "Betalningsmottagare" : "Payee" },
              { id: "state", label: sv ? "Nästa steg" : "Next step" },
            ]}
            rows={invoices.map((invoice) => ({
              id: invoice.invoiceId,
              cells: [
                invoice.supplierDocumentNumber,
                invoice.outstandingMinor === null
                  ? "—"
                  : `${formatMinorAmount(invoice.outstandingMinor, 2, props.locale)} SEK`,
                invoice.payeeVerification
                  ? sv
                    ? "Kontrollerad"
                    : "Independently checked"
                  : sv
                    ? "Saknas"
                    : "Missing",
                invoice.eligible ? (
                  <Text key="state" tone="muted">
                    {sv ? "Kan väljas" : "Available"}
                  </Text>
                ) : !invoice.payeeVerification ? (
                  <Button key="state" variant="outline" onClick={() => setPayee(invoice)}>
                    {sv ? "Ange mottagare" : "Set up payee"}
                  </Button>
                ) : invoice.reasons.length ? (
                  <Text key="state" tone="muted">
                    {invoice.reasons.join(" · ")}
                  </Text>
                ) : (
                  <Text key="state" tone="muted">
                    {sv ? "Ej tillgänglig" : "Unavailable"}
                  </Text>
                ),
              ],
            }))}
          />
        ) : null}
        {eligibility.hasNextPage ? (
          <Button
            variant="outline"
            disabled={eligibility.isFetchingNextPage}
            onClick={() => void eligibility.fetchNextPage()}
          >
            {sv ? "Visa fler fakturor" : "Show more invoices"}
          </Button>
        ) : null}
        <PageCaption>
          {sv
            ? "Endast fakturor med en aktuell, oberoende kontrollerad mottagare kan ingå. Andra hinder visas per faktura."
            : "Only invoices with a current, independently checked payee can be selected. Other blockers appear per invoice."}
        </PageCaption>
      </RecordSection>
      <PaymentPreparationSection {...props} invoices={ready} onPrepared={setBatchId} />
      <RecordSection
        title={sv ? "Öppna en tidigare förhandsgranskning" : "Open an existing preview"}
      >
        <Box
          as="form"
          display="flex"
          flexWrap="wrap"
          alignItems="end"
          gap="md"
          onSubmit={(event) => {
            event.preventDefault();
            setBatchId(field(new FormData(event.currentTarget), "batchId"));
          }}
        >
          <InputField
            name="batchId"
            label={sv ? "Förhandsgranskningens ID" : "Preview ID"}
            required
          />
          <Button type="submit" variant="outline">
            {sv ? "Öppna" : "Open"}
          </Button>
        </Box>
      </RecordSection>
      {batchId ? <PaymentBatchDetail {...props} id={batchId} /> : null}
      {payee ? (
        <FormDialog
          title={sv ? "Betalningsmottagare" : "Supplier payee"}
          closeLabel={sv ? "Stäng" : "Close"}
          onClose={() => {
            setPayee(null);
            setPayeeId("");
          }}
          size="compact"
        >
          <PayeeSetup {...props} invoice={payee} payeeId={payeeId} onProposed={setPayeeId} />
        </FormDialog>
      ) : null}
    </Box>
  );
}

function PaymentPreparationSection(
  props: CommerceProps & { invoices: EligibleInvoice[]; onPrepared: (id: string) => void },
) {
  if (props.book.currency !== "SEK")
    return (
      <PageCaption>
        {props.locale === "sv"
          ? "Betalningsfilen kräver en SEK-bok med två decimaler."
          : "This payment file requires a SEK book with two decimal places."}
      </PageCaption>
    );

  if (!props.invoices.length) return null;

  return <PaymentPreparation {...props} />;
}

function PayeeSetup(
  props: CommerceProps & {
    invoice: EligibleInvoice;
    payeeId: string;
    onProposed: (id: string) => void;
  },
) {
  const sv = props.locale === "sv";

  const review = useQuery({
    queryKey: [...commerceKey(props.book), "supplier-payee", props.payeeId],
    enabled: !!props.payeeId,
    queryFn: async ({ signal }) => {
      const result = await readAccounting(
        `${paymentPath(props)}/payees/${encodeURIComponent(props.payeeId)}`,
        Payments.PayeeReview,
        { signal },
      );

      checkScope(props.book, result.proposal.scope);

      if (result.proposal.counterpartyId !== props.invoice.counterpartyId)
        throw new Error("Supplier payee proposal does not match this invoice");

      return result;
    },
    retry: false,
  });

  return (
    <Box display="grid" gap="lg">
      <PageCaption>
        {sv
          ? "Ange betalningsuppgifter från sparat underlag. En annan behörig person måste kontrollera samma underlag före export."
          : "Enter payment details from retained evidence. Another authorized person must check the same evidence before export."}
      </PageCaption>
      {!props.payeeId ? (
        <>
          <Box
            as="form"
            display="flex"
            flexWrap="wrap"
            alignItems="end"
            gap="md"
            onSubmit={(event) => {
              event.preventDefault();
              props.onProposed(field(new FormData(event.currentTarget), "payeeId"));
            }}
          >
            <InputField
              name="payeeId"
              label={sv ? "Befintligt förslags-ID" : "Existing proposal ID"}
              required
            />
            <Button type="submit" variant="outline">
              {sv ? "Öppna förslag" : "Open proposal"}
            </Button>
          </Box>
          <CommandForm
            {...props}
            path={`${paymentPath(props)}/payees`}
            schema={Payments.PayeeProposalInput}
            output={Payments.PayeeProposal}
            label={sv ? "Föreslå mottagare" : "Propose payee"}
            allowed={props.book.role === "operator"}
            onSuccess={(proposal) => props.onProposed(proposal.id)}
            input={(fields) => ({
              counterpartyId: props.invoice.counterpartyId,
              expectedRevision: props.invoice.currentCounterpartyRevision,
              creditorName: field(fields, "name"),
              creditorIban: field(fields, "iban").toUpperCase().replaceAll(" ", ""),
              creditorBic: field(fields, "bic").toUpperCase().replaceAll(" ", ""),
              evidenceId: field(fields, "evidenceId"),
              reason: field(fields, "reason"),
            })}
          >
            <InputField
              name="name"
              label={sv ? "Mottagarens namn" : "Creditor name"}
              required
              maxLength={70}
            />
            <InputField name="iban" label="IBAN" required autoCapitalize="characters" />
            <InputField name="bic" label="BIC" required autoCapitalize="characters" />
            <InputField name="evidenceId" label={sv ? "Underlagets ID" : "Evidence ID"} required />
            <InputField
              name="reason"
              label={sv ? "Varför föreslås uppgifterna?" : "Reason for proposal"}
              required
            />
          </CommandForm>
        </>
      ) : null}
      {props.payeeId ? (
        <AccountingStatus locale={props.locale} pending={review.isPending} error={review.error} />
      ) : null}
      {review.isError ? (
        <Button variant="outline" onClick={() => void review.refetch()}>
          {sv ? "Försök igen" : "Retry"}
        </Button>
      ) : null}
      {review.data ? (
        <>
          <PageCaption>
            {sv ? "Förslags-ID" : "Proposal ID"}: {review.data.proposal.id}
          </PageCaption>
          <Text>
            {review.data.proposal.creditorName} · {review.data.proposal.creditorIban} ·{" "}
            {review.data.proposal.creditorBic}
          </Text>
          {review.data.verification ? (
            <Text role="status">
              {sv ? "Mottagaren är oberoende kontrollerad." : "The payee has an independent check."}
            </Text>
          ) : (
            <CommandForm
              {...props}
              path={`${paymentPath(props)}/payees/${encodeURIComponent(props.payeeId)}/verify`}
              schema={Payments.VerifyPayeeInput}
              output={Payments.PayeeVerification}
              label={sv ? "Bekräfta oberoende kontroll" : "Confirm independent check"}
              allowed={props.book.role === "operator"}
              input={(fields) => ({
                digest: review.data.proposal.digest,
                evidenceId: review.data.proposal.evidence.evidenceId,
                reason: field(fields, "reason"),
                confirmIndependentCheck: fields.has("independent"),
              })}
            >
              <InputField
                name="reason"
                label={sv ? "Hur kontrollerades uppgifterna?" : "How were the details checked?"}
                required
              />
              <label>
                <input type="checkbox" name="independent" required />{" "}
                {sv
                  ? "Jag har självständigt kontrollerat samma underlag."
                  : "I independently checked the same evidence."}
              </label>
            </CommandForm>
          )}
        </>
      ) : null}
    </Box>
  );
}

function PaymentPreparation(
  props: CommerceProps & { invoices: EligibleInvoice[]; onPrepared: (id: string) => void },
) {
  const sv = props.locale === "sv";
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const selectedCount = props.invoices.filter((invoice) => selected.has(invoice.invoiceId)).length;

  return (
    <RecordSection title={sv ? "Förbered betalningsfil" : "Prepare payment file"}>
      <CommandForm
        {...props}
        path={paymentPath(props)}
        schema={Payments.PrepareSupplierPaymentBatch}
        output={Payments.SupplierPaymentPreview}
        label={sv ? "Förhandsgranska fil" : "Preview file"}
        allowed={props.book.role === "operator"}
        canSubmit={selectedCount > 0 && selectedCount <= 20}
        onSuccess={(preview) => props.onPrepared(preview.id)}
        input={(fields) => ({
          profile: "synthetic-offline-pain001-v1",
          executionDate: field(fields, "executionDate"),
          debtorName: field(fields, "debtorName"),
          debtorIban: field(fields, "debtorIban").toUpperCase().replaceAll(" ", ""),
          debtorBic: field(fields, "debtorBic").toUpperCase().replaceAll(" ", ""),
          items: props.invoices
            .filter((invoice) => fields.has(`select_${invoice.invoiceId}`))
            .map((invoice) => ({
              invoiceId: invoice.invoiceId,
              expectedOutstandingMinor: invoice.outstandingMinor,
              expectedAllocationVersion: invoice.allocationVersion,
              amountMinor: decimalToMinor(field(fields, `amount_${invoice.invoiceId}`), 2),
              creditorName: invoice.payeeVerification?.creditorName,
              creditorIban: invoice.payeeVerification?.creditorIban,
              creditorBic: invoice.payeeVerification?.creditorBic,
              payeeEvidenceId: invoice.payeeVerification?.evidence.evidenceId,
              payeeVerificationId: invoice.payeeVerification?.id,
            })),
          reason: field(fields, "reason"),
          acknowledgeOfflineOnly: fields.has("offline"),
        })}
      >
        <Box display="grid" gap="sm">
          {props.invoices.map((invoice) => (
            <Box
              key={invoice.invoiceId}
              display="flex"
              flexWrap="wrap"
              alignItems="center"
              gap="md"
            >
              <label>
                <input
                  type="checkbox"
                  name={`select_${invoice.invoiceId}`}
                  checked={selected.has(invoice.invoiceId)}
                  disabled={!selected.has(invoice.invoiceId) && selectedCount >= 20}
                  onChange={(event) => {
                    const next = new Set(selected);

                    if (event.target.checked) next.add(invoice.invoiceId);
                    else next.delete(invoice.invoiceId);
                    setSelected(next);
                  }}
                />{" "}
                {invoice.supplierDocumentNumber}
              </label>
              <InputField
                name={`amount_${invoice.invoiceId}`}
                label={sv ? "Belopp SEK" : "Amount SEK"}
                inputMode="decimal"
                defaultValue={minorToDecimal(invoice.outstandingMinor ?? "0", 2)}
              />
            </Box>
          ))}
        </Box>
        <PageCaption>
          {sv
            ? `Välj 1–20 fakturor. ${selectedCount} valda.`
            : `Select 1–20 invoices. ${selectedCount} selected.`}
        </PageCaption>
        <InputField
          name="executionDate"
          type="date"
          label={sv ? "Utförandedatum" : "Execution date"}
          required
        />
        <InputField
          name="debtorName"
          label={sv ? "Betalarens namn" : "Debtor name"}
          required
          maxLength={70}
        />
        <InputField name="debtorIban" label={sv ? "Betalarens IBAN" : "Debtor IBAN"} required />
        <InputField name="debtorBic" label={sv ? "Betalarens BIC" : "Debtor BIC"} required />
        <InputField name="reason" label={sv ? "Syfte" : "Reason"} required />
        <label>
          <input type="checkbox" name="offline" required />{" "}
          {sv
            ? "Jag förstår att exporten skapar en fil men inte skickar den."
            : "I understand export creates a file but does not send it."}
        </label>
      </CommandForm>
    </RecordSection>
  );
}

function PaymentBatchDetail(props: CommerceProps & { id: string }) {
  const sv = props.locale === "sv";

  const batch = useQuery({
    queryKey: [...commerceKey(props.book), "supplier-payment-batch", props.id],
    queryFn: async ({ signal }) => {
      const result = await readAccounting(
        `${paymentPath(props)}/${encodeURIComponent(props.id)}`,
        Payments.SupplierPaymentBatchView,
        { signal },
      );

      checkScope(props.book, result.preview.scope);

      return result;
    },
    retry: false,
  });

  const view = batch.data;
  const exported = view?.export;

  return (
    <RecordSection title={sv ? "Förhandsgranskning och export" : "Preview and export"}>
      <AccountingStatus locale={props.locale} pending={batch.isPending} error={batch.error} />
      {batch.isError ? (
        <Button variant="outline" onClick={() => void batch.refetch()}>
          {sv ? "Försök igen" : "Retry"}
        </Button>
      ) : null}
      {view ? (
        <>
          <PageCaption>
            {sv ? "Förhandsgranskning" : "Preview"} {view.preview.id} ·{" "}
            {view.preview.selection.count} {sv ? "fakturor" : "invoices"} ·{" "}
            {formatMinorAmount(view.preview.selection.totalMinor, 2, props.locale)} SEK
          </PageCaption>
          <DataTable
            title={sv ? "Valda betalningar" : "Selected payments"}
            narrow="stack"
            columns={[
              { id: "invoice", label: sv ? "Faktura" : "Invoice" },
              { id: "payee", label: sv ? "Mottagare" : "Payee" },
              { id: "amount", label: sv ? "Belopp" : "Amount", numeric: true },
            ]}
            rows={view.preview.selection.items.map((item) => ({
              id: item.invoiceId,
              cells: [
                item.supplierDocumentNumber,
                `${item.creditorName} · ${item.creditorIban}`,
                `${formatMinorAmount(item.amountMinor, 2, props.locale)} SEK`,
              ],
            }))}
          />
          {!exported ? (
            <CommandForm
              {...props}
              path={`${paymentPath(props)}/${encodeURIComponent(props.id)}/export`}
              schema={Payments.ExportSupplierPaymentBatch}
              output={Payments.SupplierPaymentExport}
              label={sv ? "Exportera granskad fil" : "Export reviewed file"}
              allowed={props.book.role === "operator"}
              input={(fields) => ({
                digest: view.preview.digest,
                acknowledgeOfflineOnly: fields.has("offline"),
              })}
            >
              <label>
                <input type="checkbox" name="offline" required />{" "}
                {sv
                  ? "Jag har granskat uppgifterna och förstår att export inte är betalning."
                  : "I reviewed the details and understand export is not payment."}
              </label>
            </CommandForm>
          ) : (
            <>
              <Text role="status">{sv ? "Filen har exporterats." : "File exported."}</Text>
              <Button variant="outline" onClick={() => downloadXml(exported.base64, props.id)}>
                {sv ? "Hämta XML-fil" : "Download XML file"}
              </Button>
              <PageCaption>SHA-256: {exported.sha256}</PageCaption>
              <CommandForm
                {...props}
                path={`${paymentPath(props)}/${encodeURIComponent(props.id)}/outcomes`}
                schema={Payments.OutcomeInput}
                output={Payments.PaymentOutcome}
                label={sv ? "Spara extern status" : "Record external status"}
                allowed={props.book.role === "operator"}
                input={(fields) => ({
                  exportSha256: exported.sha256,
                  status: field(fields, "status"),
                  evidenceId: field(fields, "evidenceId"),
                  externalReference: field(fields, "externalReference"),
                  reason: field(fields, "reason"),
                  acknowledgeNoAccountingEffect: fields.has("noAccounting"),
                })}
              >
                <ChoiceField
                  label={sv ? "Rapporterad status" : "Reported status"}
                  name="status"
                  defaultValue="unknown"
                  required
                  options={[
                    { value: "unknown", label: sv ? "Okänd" : "Unknown" },
                    {
                      value: "reported_accepted",
                      label: sv ? "Uppges accepterad" : "Reported accepted",
                    },
                    { value: "reported_settled", label: sv ? "Uppges betald" : "Reported settled" },
                    {
                      value: "reported_rejected",
                      label: sv ? "Uppges avvisad" : "Reported rejected",
                    },
                  ]}
                />
                <InputField
                  name="evidenceId"
                  label={sv ? "Underlagets ID" : "Evidence ID"}
                  required
                />
                <InputField
                  name="externalReference"
                  label={sv ? "Extern referens" : "External reference"}
                  required
                />
                <InputField name="reason" label={sv ? "Kommentar" : "Reason"} required />
                <label>
                  <input type="checkbox" name="noAccounting" required />{" "}
                  {sv
                    ? "Jag förstår att rapporterad status inte bokför betalning eller matchar fakturan."
                    : "I understand a reported status does not post payment or settle the invoice."}
                </label>
              </CommandForm>
            </>
          )}
          <PageCaption>{view.recovery}</PageCaption>
          {view.outcomes.map((outcome) => (
            <Text key={outcome.id} tone="muted">
              {outcome.status} · {outcome.externalReference}
            </Text>
          ))}
        </>
      ) : null}
    </RecordSection>
  );
}

function downloadXml(base64: string, id: string) {
  const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/xml" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${id}.xml`;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
