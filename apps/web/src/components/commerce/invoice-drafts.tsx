import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import * as Drafts from "@open-erp/contracts/invoice-drafts";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { InputField } from "@open-erp/ui/components/field";
import { DataTable } from "@open-erp/ui/components/data-table";
import { Heading, Text } from "@open-erp/ui/components/typography";
import { AccountingStatus } from "@/components/accounting-status";
import { readAccounting } from "@/lib/accounting-api";
import { invoiceDraftBlocker, invoiceDraftCopy } from "./invoice-draft-copy";
import { CommandForm, Details, Evidence, Facts, Field, Lookup, checkScope, commerceKey, commercePath, type CommerceProps } from "./shared";

type DraftRevision = typeof Drafts.InvoiceDraftRevision.Type;
type EditableLine = { id: string; defaults?: typeof Drafts.DraftLine.Type };

export function InvoiceDrafts(props: CommerceProps) {
  const copy = invoiceDraftCopy(props.locale);
  const [selected, setSelected] = useState("");
  const list = useQuery({
    queryKey: [...commerceKey(props.book), "invoice-drafts"],
    queryFn: async ({ signal }) => {
      const result = await readAccounting(`${commercePath(props.book)}/invoice-drafts`, Drafts.InvoiceDraftList, { signal });
      checkScope(props.book, result.scope);
      return result;
    },
    retry: false,
  });
  return <Box display="grid" gap="lg" minWidth="zero">
    <Text>{copy.boundary}</Text>
    <Text tone="muted">{copy.limits}</Text>
    <Text>{copy.operator}</Text>
    <Details title={copy.create}>
      <DraftEditor {...props} onSaved={(record) => setSelected(record.id)} />
    </Details>
    <Lookup label={copy.open} onOpen={setSelected} />
    <Box><Button size="xl" variant="outline" disabled={list.isFetching} onClick={() => { void list.refetch(); }}>{copy.refresh}</Button></Box>
    <AccountingStatus locale={props.locale} pending={list.isPending} error={list.error} />
    {list.isSuccess ? <>
      <Text>{copy.count}: {list.data.count} · {copy.captured}: {list.data.capturedAt}</Text>
      <DataTable title={copy.title} narrow="stack" columns={[
        { id: "key", label: copy.draftKey }, { id: "title", label: copy.draftTitle },
        { id: "customer", label: copy.legalName }, { id: "revision", label: copy.revision },
        { id: "gross", label: copy.gross, numeric: true }, { id: "open", label: copy.id },
      ]} rows={list.data.items.map((record) => ({ id: record.id, cells: [record.draftKey, record.title,
        record.customerName, record.revision, record.grossMinor ?? copy.unknown,
        <Button key="open" size="xl" variant="outline" onClick={() => setSelected(record.id)}>{record.id}</Button>,
      ] }))} />
      {list.data.count === 0 ? <Text>{copy.empty}</Text> : null}
    </> : null}
    {selected ? <DraftDetail {...props} key={selected} id={selected} /> : null}
  </Box>;
}

function optionalText(fields: FormData, name: string) {
  const value = fields.get(name);
  return value === "" ? null : value;
}
function identityInput(fields: FormData, prefix: string) {
  return {
    legalName: fields.get(`${prefix}_legalName`), registrationId: optionalText(fields, `${prefix}_registrationId`),
    taxId: optionalText(fields, `${prefix}_taxId`), address: optionalText(fields, `${prefix}_address`),
    countryCode: optionalText(fields, `${prefix}_countryCode`), evidenceId: fields.get(`${prefix}_evidenceId`),
  };
}
function contentInput(fields: FormData, lines: EditableLine[]) {
  const scale = fields.get("currencyScale");
  return {
    title: fields.get("title"), counterpartyId: fields.get("counterpartyId"), counterpartyRevision: fields.get("counterpartyRevision"),
    seller: identityInput(fields, "seller"), customer: identityInput(fields, "customer"),
    currency: fields.get("currency"), currencyScale: typeof scale === "string" && scale !== "" ? Number(scale) : undefined,
    plannedIssueDate: optionalText(fields, "plannedIssueDate"), supplyDate: optionalText(fields, "supplyDate"),
    dueDate: optionalText(fields, "dueDate"), paymentTerms: optionalText(fields, "paymentTerms"),
    sourceTotalMinor: optionalText(fields, "sourceTotalMinor"),
    lines: lines.map((line) => ({
      id: line.id, description: fields.get(`${line.id}_description`), quantity: fields.get(`${line.id}_quantity`),
      unitPriceMinor: optionalText(fields, `${line.id}_unitPriceMinor`), baseMinor: fields.get(`${line.id}_baseMinor`),
      discountMinor: fields.get(`${line.id}_discountMinor`), chargeMinor: fields.get(`${line.id}_chargeMinor`),
      taxMinor: optionalText(fields, `${line.id}_taxMinor`), taxDescription: optionalText(fields, `${line.id}_taxDescription`),
      taxEvidenceId: optionalText(fields, `${line.id}_taxEvidenceId`), sourceGrossMinor: optionalText(fields, `${line.id}_sourceGrossMinor`),
    })),
  };
}
function initialLines(baseline?: DraftRevision): EditableLine[] {
  return baseline ? baseline.content.lines.map((line) => ({ id: line.id, defaults: line })) : [{ id: "draft_line_1" }];
}
function DraftEditor(props: CommerceProps & { baseline?: DraftRevision; onSaved: (record: DraftRevision) => void }) {
  const copy = invoiceDraftCopy(props.locale);
  const baseline = props.baseline;
  const content = baseline?.content;
  const [lines, setLines] = useState(() => initialLines(baseline));
  return <CommandForm
    {...props}
    path={`${commercePath(props.book)}/invoice-drafts${baseline ? `/${encodeURIComponent(baseline.id)}/revisions` : ""}`}
    schema={baseline ? Drafts.ReviseInvoiceDraft : Drafts.CreateInvoiceDraft}
    output={Drafts.InvoiceDraftRevision}
    label={baseline ? copy.revise : copy.create}
    allowed={props.book.role === "operator"}
    onSuccess={props.onSaved}
    onNewCommand={() => setLines(initialLines(baseline))}
    input={(fields) => baseline ? {
      expectedRevision: baseline.revision, expectedDigest: baseline.digest, reason: fields.get("reason"), content: contentInput(fields, lines),
    } : { draftKey: fields.get("draftKey"), content: contentInput(fields, lines) }}
  >
    {baseline ? <>
      <Text>{copy.editing}</Text>
      <Text>{copy.revision}: {baseline.revision} · {copy.digest}: {baseline.digest}</Text>
      <Field name="reason" label={copy.reason} />
    </> : <Field name="draftKey" label={copy.draftKey} maxLength={128} />}
    <Field name="title" label={copy.draftTitle} value={content?.title} maxLength={200} />
    <Box display="grid" columns={1} columnsAtSm={2} gap="lg">
      <Field name="counterpartyId" label={copy.counterpart} value={content?.counterpartyId} maxLength={128} />
      <Field name="counterpartyRevision" label={copy.counterpartRevision} value={content?.counterpartyRevision} maxLength={18} />
      <Field name="currency" label={copy.currency} value={content?.currency ?? props.book.currency} maxLength={3} />
      <InputField name="currencyScale" label={copy.scale} type="number" min={0} max={6} step={1} required defaultValue={content?.currencyScale} />
    </Box>
    <Text tone="muted">{copy.identityNote}</Text>
    <IdentityFields {...props} prefix="seller" value={content?.seller} />
    <IdentityFields {...props} prefix="customer" value={content?.customer} />
    <Text tone="muted">{copy.optional}</Text>
    <Box display="grid" columns={1} columnsAtSm={2} gap="lg">
      <InputField name="plannedIssueDate" label={copy.plannedIssueDate} type="date" defaultValue={content?.plannedIssueDate ?? ""} />
      <InputField name="supplyDate" label={copy.supplyDate} type="date" defaultValue={content?.supplyDate ?? ""} />
      <InputField name="dueDate" label={copy.dueDate} type="date" defaultValue={content?.dueDate ?? ""} />
      <InputField name="paymentTerms" label={copy.terms} maxLength={1000} defaultValue={content?.paymentTerms ?? ""} />
      <InputField name="sourceTotalMinor" label={copy.sourceTotal} maxLength={38} defaultValue={content?.sourceTotalMinor ?? ""} />
    </Box>
    <Heading>{copy.lines}</Heading>
    <Text>{copy.lineHelp}</Text>
    {lines.map((line) => <Box key={line.id} as="fieldset" display="grid" gap="md" minWidth="zero" padding="lg">
      <legend>{line.id}</legend>
      <LineFields {...props} line={line} />
      <Box><Button type="button" size="xl" variant="outline" disabled={lines.length === 1} onClick={() => setLines((current) => current.filter((item) => item.id !== line.id))}>{copy.removeLine}</Button></Box>
    </Box>)}
    <Box><Button type="button" size="xl" variant="outline" disabled={lines.length >= 50} onClick={() => setLines((current) => [...current, { id: `draft_line_${crypto.randomUUID().replaceAll("-", "")}` }])}>{copy.addLine}</Button></Box>
  </CommandForm>;
}
function IdentityFields(props: CommerceProps & { prefix: "seller" | "customer"; value?: typeof Drafts.DraftIdentity.Type }) {
  const copy = invoiceDraftCopy(props.locale);
  const inputs = [
    ["legalName", copy.legalName, true, 200], ["registrationId", copy.registrationId, false, 200],
    ["taxId", copy.taxId, false, 200], ["address", copy.address, false, 1000],
    ["countryCode", copy.countryCode, false, 2], ["evidenceId", copy.evidenceId, true, 128],
  ] as const;
  return <Box as="fieldset" display="grid" gap="lg" minWidth="zero" padding="lg">
    <legend>{copy[props.prefix]}</legend>
    <Box display="grid" columns={1} columnsAtSm={2} gap="lg">
      {inputs.map(([name, label, required, maxLength]) => <InputField key={name} name={`${props.prefix}_${name}`} label={label} required={required} maxLength={maxLength} defaultValue={props.value?.[name] ?? ""} />)}
    </Box>
  </Box>;
}
function LineFields(props: CommerceProps & { line: EditableLine }) {
  const copy = invoiceDraftCopy(props.locale);
  const inputs = [
    ["description", copy.description, true, 200], ["quantity", copy.quantity, true, 19],
    ["unitPriceMinor", copy.unitPrice, false, 38], ["baseMinor", copy.base, true, 38],
    ["discountMinor", copy.discount, true, 38], ["chargeMinor", copy.charge, true, 38],
    ["taxMinor", copy.tax, false, 38], ["taxDescription", copy.taxDescription, false, 200],
    ["taxEvidenceId", copy.taxEvidence, false, 128], ["sourceGrossMinor", copy.sourceGross, false, 38],
  ] as const;
  return <Box display="grid" columns={1} columnsAtSm={2} gap="lg">
    {inputs.map(([name, label, required, maxLength]) => <InputField key={name} name={`${props.line.id}_${name}`} label={label} required={required} maxLength={maxLength} defaultValue={props.line.defaults?.[name] ?? ""} />)}
  </Box>;
}

function DraftDetail(props: CommerceProps & { id: string }) {
  const copy = invoiceDraftCopy(props.locale);
  const [revision, setRevision] = useState("");
  const [editing, setEditing] = useState<DraftRevision | null>(null);
  const view = useQuery({
    queryKey: [...commerceKey(props.book), "invoice-draft", props.id, revision],
    queryFn: async ({ signal }) => {
      const result = await readAccounting(`${commercePath(props.book)}/invoice-drafts/${encodeURIComponent(props.id)}${revision ? `?revision=${encodeURIComponent(revision)}` : ""}`, Drafts.InvoiceDraftView, { signal });
      checkScope(props.book, result.record.scope);
      if (result.record.id !== props.id) throw new Error("Invoice draft identity mismatch");
      return result;
    },
    retry: false,
  });
  const history = useQuery({
    queryKey: [...commerceKey(props.book), "invoice-draft-history", props.id],
    queryFn: async ({ signal }) => {
      const result = await readAccounting(`${commercePath(props.book)}/invoice-drafts/${encodeURIComponent(props.id)}/revisions`, Drafts.InvoiceDraftHistory, { signal });
      checkScope(props.book, result.scope);
      if (result.id !== props.id) throw new Error("Invoice draft history identity mismatch");
      return result;
    },
    retry: false,
  });
  return <Box display="grid" gap="lg" minWidth="zero">
    <Heading>{copy.id}: {props.id}</Heading>
    <Box><Button size="xl" variant="outline" disabled={view.isFetching} onClick={() => {
      if (revision) setRevision(""); else void view.refetch();
      void history.refetch();
    }}>{copy.current}</Button></Box>
    <AccountingStatus locale={props.locale} pending={view.isPending} error={view.error} />
    {view.isSuccess ? <>
      <Text>{copy.revision}: {view.data.record.revision} · {copy.currentRevision}: {view.data.currentRevision}</Text>
      <DraftFacts {...props} record={view.data.record} />
      {view.data.record.revision !== view.data.currentRevision ? <Text>{copy.historyReadOnly}</Text> : <Box>
        <Button size="xl" variant="outline" disabled={props.book.role !== "operator" || view.isFetching} onClick={() => setEditing(view.data.record)}>{copy.edit}</Button>
      </Box>}
    </> : null}
    {editing ? <Details title={copy.edit} open><DraftEditor {...props} key={`${editing.id}:${editing.revision}`} baseline={editing} onSaved={() => { setRevision(""); }} /></Details> : null}
    <Heading>{copy.history}</Heading>
    <AccountingStatus locale={props.locale} pending={history.isPending} error={history.error} />
    {history.isSuccess ? <DataTable title={copy.history} narrow="stack" columns={[
      { id: "revision", label: copy.revision }, { id: "created", label: copy.captured },
      { id: "gross", label: copy.gross, numeric: true }, { id: "digest", label: copy.digest },
    ]} rows={history.data.items.map((record) => ({ id: record.revision, cells: [
      <Button key="open" size="xl" variant="outline" onClick={() => setRevision(record.revision)}>{record.revision}</Button>,
      record.createdAt, record.grossMinor ?? copy.unknown, record.digest,
    ] }))} /> : null}
  </Box>;
}
function DraftFacts(props: CommerceProps & { record: DraftRevision }) {
  const copy = invoiceDraftCopy(props.locale);
  const record = props.record;
  return <Box display="grid" gap="md" minWidth="zero">
    <Text>{copy.boundary}</Text>
    <Text>{record.content.title} · {record.content.customer.legalName} · {record.content.currency} / {record.content.currencyScale}</Text>
    <Text>{copy.net}: {record.totals.netMinor} · {copy.tax}: {record.totals.taxMinor ?? copy.unknown} · {copy.gross}: {record.totals.grossMinor ?? copy.unknown}</Text>
    <Heading>{copy.blockers}</Heading>
    <ul>{record.blockers.map((blocker) => <li key={`${blocker.code}:${blocker.lineId ?? "draft"}`}>{invoiceDraftBlocker(blocker.code, props.locale)}{blocker.lineId ? ` · ${blocker.lineId}` : ""}</li>)}</ul>
    <Details title={copy.lines}>
      <DataTable title={copy.lines} narrow="stack" columns={[
        { id: "description", label: copy.description }, { id: "quantity", label: copy.quantity },
        { id: "unitPrice", label: copy.unitPrice, numeric: true }, { id: "base", label: copy.base, numeric: true },
        { id: "discount", label: copy.discount, numeric: true }, { id: "charge", label: copy.charge, numeric: true },
        { id: "net", label: copy.net, numeric: true }, { id: "tax", label: copy.tax, numeric: true },
        { id: "gross", label: copy.gross, numeric: true }, { id: "source", label: copy.sourceGross, numeric: true },
      ]} rows={record.content.lines.map((line) => {
        const calculated = record.calculatedLines.find((item) => item.id === line.id);
        return { id: line.id, cells: [line.description, line.quantity, line.unitPriceMinor ?? copy.unknown,
          line.baseMinor, line.discountMinor, line.chargeMinor, calculated?.netMinor ?? copy.unknown,
          line.taxMinor ?? copy.unknown, calculated?.grossMinor ?? copy.unknown, line.sourceGrossMinor ?? copy.unknown,
        ] };
      })} />
    </Details>
    <Facts title={copy.details} value={record} />
    <Details title={copy.seller}><Evidence {...props} reference={record.sellerEvidence} /></Details>
    <Details title={copy.customer}><Evidence {...props} reference={record.customerEvidence} /></Details>
    <Box><Button size="xl" variant="outline" onClick={() => {
      const url = URL.createObjectURL(new Blob([JSON.stringify(record, null, 2)], { type: "application/json" }));
      const link = document.createElement("a"); link.href = url; link.download = `${record.id}-revision-${record.revision}.json`;
      document.body.append(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 0);
    }}>{copy.download}</Button></Box>
  </Box>;
}
