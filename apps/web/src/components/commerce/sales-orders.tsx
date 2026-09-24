import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import * as Sales from "@open-erp/contracts/sales-orders";
import * as Drafts from "@open-erp/contracts/invoice-drafts";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { Link } from "@open-erp/ui/components/link";
import { InputField } from "@open-erp/ui/components/field";
import { Text } from "@open-erp/ui/components/typography";
import { AccountingStatus } from "@/components/accounting-status";
import { readAccounting } from "@/lib/accounting-api";
import { workspacePath } from "@/lib/book-context";
import { CommandForm, checkScope, commerceKey, commercePath, type CommerceProps } from "./shared";

export function SalesOrders({ book, locale }: CommerceProps) {
  const sv = locale === "sv";
  const path = `${commercePath(book)}/sales-documents`;
  const [sourceId, setSourceId] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [source, setSource] = useState<typeof Drafts.InvoiceDraftRevision.Type | null>(null);
  const [sourceError, setSourceError] = useState<Error | null>(null);
  const list = useQuery({
    queryKey: [...commerceKey(book), "sales-documents"],
    queryFn: async ({ signal }) => {
      const result = await readAccounting(path, Sales.SalesDocumentList, { signal });
      checkScope(book, result.scope);
      return result;
    }, retry: false,
  });
  const record = list.data?.items.find(item => item.id === selectedId);
  const detail = useQuery({
    queryKey: [...commerceKey(book), "sales-document", selectedId],
    queryFn: async ({ signal }) => readAccounting(`${path}/${encodeURIComponent(selectedId)}`,
      Sales.SalesDocumentView, { signal }),
    enabled: !!selectedId, retry: false,
  });
  return <Box display="grid" gap="xl" minWidth="zero">
    <h2>{sv ? "Offerter och order" : "Quotes and orders"}</h2>
    <Text tone="muted">{sv ? "En accepterad order kan delas upp i granskade fakturautkast. Ingen faktura skapas vid accept." : "Split an accepted order into reviewed invoice drafts. Acceptance does not issue an invoice."}</Text>
    <Box as="form" display="grid" gap="md" onSubmit={event => {
      event.preventDefault(); setSourceError(null); setSource(null);
      void readAccounting(`${commercePath(book)}/invoice-drafts/${encodeURIComponent(sourceId)}`,
        Drafts.InvoiceDraftView).then(result => {
        checkScope(book, result.record.scope);
        setSource(result.record);
      }).catch((error: unknown) => setSourceError(error instanceof Error ? error : new Error("Unable to load source draft")));
    }}>
      <InputField label={sv ? "Befintligt fakturautkast-ID" : "Existing invoice draft ID"}
        name="draftId" required value={sourceId} onChange={event => setSourceId(event.target.value)} />
      <Button type="submit" variant="outline">{sv ? "Hämta underlag" : "Review source draft"}</Button>
      <AccountingStatus locale={locale} error={sourceError} />
    </Box>
    {source ? <Box display="grid" gap="md">
      <Text>{source.content.title} · {source.content.customer.legalName}</Text>
      <Text tone="muted">{sv ? "Kopierar innehållet som en ny offert. Källutkastet ändras inte." : "Copies this content into a new quote. The source draft remains unchanged."}</Text>
      <CommandForm book={book} locale={locale} path={path} schema={Sales.CreateSalesDocument} output={Sales.SalesDocument}
        input={() => ({ kind: "quote", content: source.content })} label={sv ? "Skapa offert" : "Create quote"}
        allowed={book.role === "operator"} onSuccess={result => setSelectedId(result.id)} />
    </Box> : null}
    <AccountingStatus locale={locale} pending={list.isPending} error={list.error} />
    {list.data?.items.map(item => <Button key={item.id} variant={selectedId === item.id ? "secondary" : "ghost"}
      onClick={() => setSelectedId(item.id)}>{item.kind === "quote" ? (sv ? "Offert" : "Quote") : (sv ? "Order" : "Order")}: {item.content.title} · {item.state}</Button>)}
    {record ? <SalesOrderDetail book={book} locale={locale} record={record} detail={detail} path={path} source={source} /> : null}
  </Box>;
}

function SalesOrderDetail(props: CommerceProps & {
  record: typeof Sales.SalesDocument.Type;
  detail: ReturnType<typeof useQuery<typeof Sales.SalesDocumentView.Type>>;
  path: string;
  source: typeof Drafts.InvoiceDraftRevision.Type | null;
}) {
  const { book, locale, record, detail } = props;
  const source = props.source;
  const path = props.path;
  const sv = locale === "sv";
  const converted = detail.data?.conversions ?? [];
  const remaining = record.kind === "order" ? record.content.lines.map(line => {
    const used = converted.flatMap(conversion => conversion.portions).reduce((total, portion) =>
      portion.id === line.id ? total + Number(portion.quantity) : total, 0);
    return { line, available: Number(line.quantity) - used };
  }) : [];
  return     <Box display="grid" gap="lg">
      <h3>{record.content.title} · {record.kind} · {record.state}</h3>
      <Text tone="muted">{sv ? "Källa och revision" : "Source and revision"}: {record.sourceQuoteId ?? "—"} · {record.revision}</Text>
      <AccountingStatus locale={locale} pending={detail.isPending} error={detail.error} />
      {record.state === "draft" && record.kind === "quote" && source ?
        <ReviseQuote book={book} locale={locale} record={record} source={source} path={path} /> : null}

      {record.state === "draft" || (record.state === "accepted" && record.kind === "quote") ||
       (record.state === "accepted" && record.kind === "order" && converted.length === 0) ?
        <CommandForm book={book} locale={locale} path={`${path}/${record.id}/transitions`}
          recoveryId={record.id} schema={Sales.TransitionSalesDocument}
          output={Sales.SalesDocument} allowed={book.role === "operator"}
          input={fields => ({ expectedRevision: record.revision, expectedDigest: record.digest,
            action: fields.get("action") })} label={sv ? "Spara beslut" : "Save decision"}>
          <Box as="label" display="grid" gap="sm">{sv ? "Beslut" : "Decision"}
            <select name="action" required>
              {record.state === "draft" ? <option value="accept">{sv ? "Acceptera" : "Accept"}</option> : null}
              {record.kind === "quote" && record.state === "accepted" ? <option value="order_from_quote">{sv ? "Skapa order från offert" : "Create order from quote"}</option> : null}
              <option value="cancel">{sv ? "Avbryt" : "Cancel"}</option>
            </select>
          </Box>
        </CommandForm> : null}
      {record.kind === "order" && record.state === "accepted" && detail.isSuccess ? <>
        <h3>{sv ? "Konvertera del av order" : "Convert part of order"}</h3>
        <Text tone="muted">{sv ? "Välj återstående antal per rad. Beloppen delas exakt och fakturan sparas bara som utkast." : "Choose remaining quantities per line. Amounts must split exactly; this saves only an invoice draft."}</Text>
        <CommandForm key={`${record.id}-${converted.length}`} book={book} locale={locale} path={`${path}/${record.id}/conversions`}
          recoveryId={record.id} schema={Sales.ConvertSalesOrder}
          output={Sales.OrderConversion} allowed={book.role === "operator"}
          input={fields => ({ expectedRevision: record.revision, expectedDigest: record.digest,
            draftKey: fields.get("draftKey"), lines: remaining.flatMap(({ line }) => {
              const raw = fields.get(`quantity_${line.id}`);
              const quantity = typeof raw === "string" ? raw.trim() : "";
              return quantity ? [{ id: line.id, quantity }] : [];
            }) })} label={sv ? "Skapa fakturautkast" : "Create invoice draft"}>
          <InputField name="draftKey" label={sv ? "Unik utkastnyckel" : "Unique draft key"} required />
          {remaining.map(({ line, available }) => <InputField key={line.id} name={`quantity_${line.id}`}
            label={`${line.description} (${sv ? "återstår" : "remaining"} ${available})`}
            disabled={available <= 0} maxLength={20} />)}
        </CommandForm>
        {converted.map(item => <Link key={item.draftId}
            href={`${workspacePath(book)}/sales?record=${encodeURIComponent(item.draftId)}&kind=draft`}>
            {sv ? "Granska fakturautkast" : "Review invoice draft"}: {item.draftId}
          </Link>)}
      </> : null}
    </Box>;
}

function ReviseQuote(props: CommerceProps & {
  record: typeof Sales.SalesDocument.Type;
  source: typeof Drafts.InvoiceDraftRevision.Type;
  path: string;
}) {
  const { book, locale, record, source } = props;
  const path = props.path;
  return <CommandForm key={`${record.id}-${source.id}`} book={book} locale={locale}
    path={`${path}/${record.id}/revisions`} recoveryId={record.id}
    schema={Sales.ReviseSalesDocument} output={Sales.SalesDocument}
    input={fields => ({ expectedRevision: record.revision, expectedDigest: record.digest,
      content: source.content, reason: fields.get("reason") })}
    allowed={book.role === "operator"} label={locale === "sv" ? "Spara ny offertrevision" : "Save new quote revision"}>
    <Text tone="muted">{locale === "sv" ? "Ersätt innehållet med det hämtade utkastet. Tidigare revision sparas." : "Replace the content with the reviewed source draft. The previous revision remains."}</Text>
    <InputField name="reason" label={locale === "sv" ? "Skäl till ändring" : "Reason for change"} required />
  </CommandForm>;
}
