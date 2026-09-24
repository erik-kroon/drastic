import { useRef, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import * as Collections from "@open-erp/contracts/collections";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { InputField } from "@open-erp/ui/components/field";
import { Text } from "@open-erp/ui/components/typography";
import { AccountingStatus } from "@/components/accounting-status";
import { readAccounting } from "@/lib/accounting-api";
import { CommandForm, checkScope, commerceKey, commercePath, type CommerceProps } from "./shared";

type CollectionHistoryData = Pick<
  typeof Collections.CollectionHistory.Type,
  "scope" | "customerId" | "statements" | "disputes" | "events"
>;

export function CollectionsWorkspace({ book, locale }: CommerceProps) {
  const sv = locale === "sv";
  const [entry, setEntry] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [invoiceId, setInvoiceId] = useState("");
  const base = `${commercePath(book)}/collections`;
  const history = useInfiniteQuery({
    queryKey: [...commerceKey(book), "collections", customerId],
    enabled: !!customerId,
    initialPageParam: "",
    queryFn: async ({ signal, pageParam }) => {
      const result = await readAccounting(
        `${base}/customers/${encodeURIComponent(customerId)}/history${pageParam ? `?after=${encodeURIComponent(pageParam)}` : ""}`,
        Collections.CollectionHistoryPage,
        { signal },
      );
      checkScope(book, result.scope);
      if (result.customerId !== customerId) throw new Error("Collection history identity mismatch");
      return result;
    },
    getNextPageParam: page => page.nextCursor ?? undefined,
    retry: false,
  });
  const pages = history.data?.pages ?? [];
  const firstPage = pages[0];
  const data: CollectionHistoryData | null = firstPage ? {
    scope: firstPage.scope,
    customerId: firstPage.customerId,
    statements: pages.flatMap(page => page.statements),
    disputes: pages.flatMap(page => page.disputes),
    events: pages.flatMap(page => page.events),
  } : null;
  return <Box display="grid" gap="xl" minWidth="zero">
    <h2>{sv ? "Krav och kundutdrag" : "Collections and statements"}</h2>
    <Text tone="muted">{sv ? "Utdrag är oföränderliga ögonblicksbilder. Betalningar efter bryttiden ändrar inte äldre utdrag. Påminnelser förbereds här; arbetsflödet skickar eller registrerar ingen leverans." : "Statements are immutable snapshots. Later payments do not change an earlier snapshot. Reminders are prepared here; this workflow does not send or record delivery."}</Text>
    <Box as="form" display="flex" flexWrap="wrap" gap="md" alignItems="end" onSubmit={event => {
      event.preventDefault(); setCustomerId(entry.trim()); setInvoiceId("");
    }}>
      <InputField name="customerId" label={sv ? "Kund-ID" : "Customer ID"} required value={entry}
        onChange={event => setEntry(event.target.value)} />
      <Button type="submit" variant="outline">{sv ? "Visa historik" : "View history"}</Button>
    </Box>
    <AccountingStatus locale={locale} pending={history.isPending && !!customerId} error={history.error} />
    {data ? <>
      <CollectionHistory book={book} locale={locale} base={base} data={data} customerId={customerId} />
      {history.hasNextPage ? <Box display="grid" gap="sm">
        <Text tone="muted">{sv
          ? "Äldre historik är inte inläst. Åtgärder kontrollerar aktuella tvister och saldo på servern."
          : "Older history is not loaded. Action admission rechecks current disputes and balance on the server."}</Text>
        <Button type="button" variant="outline" disabled={history.isFetchingNextPage}
          onClick={() => void history.fetchNextPage()}>{sv ? "Läs in äldre historik" : "Load older history"}</Button>
      </Box> : null}
      <CollectionActions book={book} locale={locale} base={base} data={data} invoiceId={invoiceId} onInvoiceId={setInvoiceId} />
    </> : null}
  </Box>;
}

function CollectionHistory(props: CommerceProps & {
  base: string;
  data: CollectionHistoryData;
  customerId: string;
}) {
  const { book, locale, base, data } = props;
  const sv = locale === "sv";
  const statementKeys = useRef(new Map<string, string>());
  return <>
      <Text>{sv ? "Kund" : "Customer"}: {data.customerId}</Text>
      <CommandForm book={book} locale={locale} path={`${base}/statements`}
        schema={Collections.CaptureCollectionStatement} output={Collections.CollectionStatement}
        recoveryId={`statement:${props.customerId}`} keys={statementKeys.current}
        allowed={book.role === "operator"} label={sv ? "Skapa oföränderligt utdrag" : "Capture immutable statement"}
        onNewCommand={() => statementKeys.current.clear()}
        input={fields => ({ customerId: props.customerId, asOf: fields.get("asOf") })}>
        <InputField name="asOf" type="date" required label={sv ? "Per datum" : "As of date"} />
      </CommandForm>
      <h3>{sv ? "Sparade utdrag" : "Saved statements"}</h3>
      {data.statements.length === 0 ? <Text tone="muted">{sv ? "Inga utdrag ännu." : "No statements yet."}</Text> : null}
      {data.statements.map(statement => <Box key={statement.id} display="grid" gap="sm" minWidth="zero">
        <strong>{statement.asOf} · {statement.id}</strong>
        <Text tone="muted">{sv ? "Bryttid" : "Cutoff"}: {statement.cutoffAt}</Text>
        {statement.items.length === 0 ? <Text>{sv ? "Inga öppna fakturor vid bryttiden." : "No open invoices at this cutoff."}</Text> : null}
        {statement.items.map(item => <Text key={item.invoiceId}>
          {item.number} · {sv ? "Belopp" : "Amount"} {item.amountMinor} · {sv ? "Betalt" : "Allocated"} {item.allocatedMinor} · {sv ? "Kvar" : "Outstanding"} {item.outstandingMinor} {item.currency ? `${item.currency} (${sv ? "minsta enhet" : "minor units"})` : (sv ? "Valuta saknas i äldre utdrag" : "Currency absent in older statement")}{item.disputed ? " · disputed" : ""}
        </Text>)}
      </Box>)}
      <h3>{sv ? "Tvister och spärrar" : "Disputes and holds"}</h3>
      {data.disputes.map(dispute => <Text key={dispute.id}>{dispute.invoiceId} · {dispute.reason} · {dispute.holdReminders ? (sv ? "Pausad påminnelse" : "Reminder held") : (sv ? "Ingen spärr" : "No hold")} · {data.events.some(event => event.kind === "dispute_resolved" && event.disputeId === dispute.id) ? (sv ? "Löst" : "Resolved") : (sv ? "Öppen" : "Open")}</Text>)}
      <h3>{sv ? "Åtgärdshistorik" : "Action history"}</h3>
      <Text tone="muted">{sv
        ? "Förberedda påminnelser är förberedningsposter. Det här arbetsflödet registrerar ingen leverans."
        : "Prepared reminders are preparation records. This workflow records no delivery."}</Text>
      {data.events.map(event => <Text key={event.id}>{event.createdAt} · {event.invoiceId} · {event.kind === "reminder_prepared"
        ? (sv ? "Påminnelse förberedd · leverans ej godkänd eller registrerad" : "Reminder prepared · delivery not authorized or recorded")
        : event.kind} · {event.note}{event.outstandingMinor !== null ? ` · ${sv ? "Kvar" : "Outstanding"} ${event.outstandingMinor}` : ""}</Text>)}
  </>;
}

function CollectionActions(props: CommerceProps & {
  base: string;
  data: CollectionHistoryData;
  invoiceId: string;
  onInvoiceId: (id: string) => void;
}) {
  const { book, locale, base, data } = props;
  const sv = locale === "sv";
  const disputeKeys = useRef(new Map<string, string>());
  const actionKeys = useRef(new Map<string, string>());
  const invoices = data.statements.flatMap(statement => statement.items)
    .filter((item, index, all) => all.findIndex(other => other.invoiceId === item.invoiceId) === index);
  const activeHolds = data.disputes.filter(dispute => dispute.invoiceId === props.invoiceId && dispute.holdReminders &&
    !data.events.some(event => event.kind === "dispute_resolved" && event.disputeId === dispute.id));
  return <>
      <InputField name="invoiceId" label={sv ? "Faktura-ID för ny åtgärd" : "Invoice ID for new action"}
        value={props.invoiceId} onChange={event => props.onInvoiceId(event.target.value)} />
      {invoices.length ? <Box display="flex" flexWrap="wrap" gap="sm">{invoices.map(item =>
        <Button key={item.invoiceId} variant="outline" onClick={() => props.onInvoiceId(item.invoiceId)}>{item.number}</Button>)}</Box> : null}
      {props.invoiceId ? <>
        <Text tone="muted">{sv
          ? "Kontrollera aktuell reskontra före påminnelse. Servern kontrollerar saldo och aktiva tvisters spärrar igen. Ett tidigare utdrag är inte ett aktuellt saldo."
          : "Check the live receivable before preparing a reminder. The server rechecks balance and active dispute holds. An earlier statement is not a current balance."}</Text>
        <CommandForm key={`dispute-${props.invoiceId}`} book={book} locale={locale} path={`${base}/disputes`}
          schema={Collections.OpenCollectionDispute} output={Collections.CollectionDispute}
          recoveryId={`dispute:${props.invoiceId}`} keys={disputeKeys.current}
          allowed={book.role === "operator"} label={sv ? "Registrera tvist" : "Record dispute"}
          onNewCommand={() => disputeKeys.current.clear()}
          input={fields => ({ invoiceId: props.invoiceId, reason: fields.get("reason"), evidenceId: fields.get("evidenceId"),
            ownerId: fields.get("ownerId"), holdReminders: fields.get("holdReminders") === "on" })}>
          <InputField name="reason" required label={sv ? "Orsak" : "Reason"} />
          <InputField name="evidenceId" required label={sv ? "Bevis-ID" : "Evidence ID"} />
          <InputField name="ownerId" required label={sv ? "Ansvarig aktör-ID" : "Owner actor ID"} />
          <label><input type="checkbox" name="holdReminders" /> {sv ? "Pausa påminnelser" : "Hold reminders"}</label>
        </CommandForm>
        <CommandForm key={`action-${props.invoiceId}`} book={book} locale={locale} path={`${base}/actions`}
          schema={Collections.RecordCollectionAction} output={Collections.CollectionAction}
          recoveryId={`action:${props.invoiceId}`} keys={actionKeys.current}
          allowed={book.role === "operator"} label={sv ? "Spara åtgärd" : "Record action"}
          onNewCommand={() => actionKeys.current.clear()}
          input={fields => ({ invoiceId: props.invoiceId, kind: fields.get("kind"), note: fields.get("note"),
            ownerId: fields.get("ownerId"), disputeId: fields.get("disputeId") || null })}>
          <label>{sv ? "Åtgärd" : "Action"}<select name="kind" required>
            <option value="contact">{sv ? "Kontakt" : "Contact"}</option>
            <option value="follow_up">{sv ? "Uppföljning" : "Follow-up"}</option>
            <option value="dispute_resolved">{sv ? "Lös tvist" : "Resolve dispute"}</option>
            <option value="reminder_prepared" disabled={activeHolds.length > 0}>{sv ? "Förbered påminnelse (ingen leverans)" : "Prepare reminder (no delivery)"}</option>
          </select></label>
          <InputField name="note" required label={sv ? "Anteckning" : "Note"} />
          <InputField name="ownerId" required label={sv ? "Ansvarig aktör-ID" : "Owner actor ID"} />
          <label>{sv ? "Tvist att lösa (endast vid lösning)" : "Dispute to resolve (resolution only)"}<select name="disputeId">
            <option value="">{sv ? "Ingen" : "None"}</option>
            {data.disputes.filter(dispute => dispute.invoiceId === props.invoiceId &&
              !data.events.some(event => event.kind === "dispute_resolved" && event.disputeId === dispute.id))
              .map(dispute => <option key={dispute.id} value={dispute.id}>{dispute.reason} · {dispute.id}</option>)}
          </select></label>
          {activeHolds.length ? <Text tone="muted">{sv ? "Aktiv tvist spärrar påminnelse." : "An active dispute holds reminders."}</Text> : null}
        </CommandForm>
      </> : null}
  </>;
}
