import { useRef, useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import * as Collections from "@open-erp/contracts/collections";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { DataTable } from "@open-erp/ui/components/data-table";
import { InputField } from "@open-erp/ui/components/field";
import { PageCaption, PageEmpty } from "@open-erp/ui/components/accounting-page";
import { Text } from "@open-erp/ui/components/typography";
import { AccountingStatus } from "@/components/accounting-status";
import { readAccounting } from "@/lib/accounting-api";
import { formatMinorAmount } from "@/lib/workspace-api";
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
  const [worklistPage, setWorklistPage] = useState(1);
  const base = `${commercePath(book)}/collections`;

  const worklist = useQuery({
    queryKey: [...commerceKey(book), "collection-worklist", worklistPage],
    queryFn: async ({ signal }) => {
      const result = await readAccounting(
        `${base}/worklist?page=${worklistPage}`,
        Collections.CollectionWorklist,
        { signal },
      );

      checkScope(book, result.scope);

      return result;
    },
    retry: false,
  });

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
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    retry: false,
  });

  const pages = history.data?.pages ?? [];
  const firstPage = pages[0];

  const data: CollectionHistoryData | null = firstPage
    ? {
        scope: firstPage.scope,
        customerId: firstPage.customerId,
        statements: pages.flatMap((page) => page.statements),
        disputes: pages.flatMap((page) => page.disputes),
        events: pages.flatMap((page) => page.events),
      }
    : null;

  return (
    <Box display="grid" gap="xl" minWidth="zero">
      <h2>{sv ? "Krav och kundutdrag" : "Collections and statements"}</h2>
      <Text tone="muted">
        {sv
          ? "Utdrag är oföränderliga ögonblicksbilder. Betalningar efter bryttiden ändrar inte äldre utdrag. Påminnelser förbereds här; arbetsflödet skickar eller registrerar ingen leverans."
          : "Statements are immutable snapshots. Later payments do not change an earlier snapshot. Reminders are prepared here; this workflow does not send or record delivery."}
      </Text>
      <ReceivableWorklist
        locale={locale}
        data={worklist.data}
        pending={worklist.isPending}
        error={worklist.error}
        page={worklistPage}
        onPage={setWorklistPage}
      />
      <Box
        as="form"
        display="flex"
        flexWrap="wrap"
        gap="md"
        alignItems="end"
        onSubmit={(event) => {
          event.preventDefault();
          setCustomerId(entry.trim());
          setInvoiceId("");
        }}
      >
        <InputField
          name="customerId"
          label={sv ? "Kund-ID" : "Customer ID"}
          required
          value={entry}
          onChange={(event) => setEntry(event.target.value)}
        />
        <Button type="submit" variant="outline">
          {sv ? "Visa historik" : "View history"}
        </Button>
      </Box>
      <AccountingStatus
        locale={locale}
        pending={history.isPending && !!customerId}
        error={history.error}
      />
      {data ? (
        <>
          <CollectionHistory
            book={book}
            locale={locale}
            base={base}
            data={data}
            customerId={customerId}
          />
          {history.hasNextPage ? (
            <Box display="grid" gap="sm">
              <Text tone="muted">
                {sv
                  ? "Äldre historik är inte inläst. Åtgärder kontrollerar aktuella tvister och saldo på servern."
                  : "Older history is not loaded. Action admission rechecks current disputes and balance on the server."}
              </Text>
              <Button
                type="button"
                variant="outline"
                disabled={history.isFetchingNextPage}
                onClick={() => void history.fetchNextPage()}
              >
                {sv ? "Läs in äldre historik" : "Load older history"}
              </Button>
            </Box>
          ) : null}
          <CollectionActions
            book={book}
            locale={locale}
            base={base}
            data={data}
            invoiceId={invoiceId}
            onInvoiceId={setInvoiceId}
          />
        </>
      ) : null}
    </Box>
  );
}

function ReceivableWorklist(
  props: Omit<CommerceProps, "book"> & {
    data?: typeof Collections.CollectionWorklist.Type;
    pending: boolean;
    error: Error | null;
    page: number;
    onPage: (page: number) => void;
  },
) {
  const { locale, data, pending, error } = props;
  const page = props.page;
  const sv = locale === "sv";

  const actions = sv
    ? {
        review_hold: "Granska påminnelsespärr",
        review_dispute: "Granska tvist",
        review_blocked_invoice: "Granska blockerad faktura",
        follow_up_overdue: "Följ upp förfallen faktura",
        follow_up: "Följ upp",
      }
    : {
        review_hold: "Review reminder hold",
        review_dispute: "Review dispute",
        review_blocked_invoice: "Review blocked invoice",
        follow_up_overdue: "Follow up overdue invoice",
        follow_up: "Follow up",
      };

  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / 50));

  return (
    <Box display="grid" gap="md" minWidth="zero">
      <Box display="flex" justifyContent="between" alignItems="center" gap="lg" flexWrap="wrap">
        <h3>{sv ? "Kundreskontra" : "Customer receivables"}</h3>
        {data ? (
          <PageCaption>
            {data.total} {sv ? "fakturor" : "invoices"}
          </PageCaption>
        ) : null}
      </Box>
      <AccountingStatus locale={locale} pending={pending} error={error} />
      {data ? (
        data.items.length ? (
          <DataTable
            title={sv ? "Kundreskontra" : "Customer receivables"}
            narrow="stack"
            columns={[
              { id: "invoice", label: sv ? "Faktura" : "Invoice" },
              { id: "due", label: sv ? "Förfallodatum" : "Due date" },
              { id: "residual", label: sv ? "Kvarvarande" : "Residual", numeric: true },
              { id: "dispute", label: sv ? "Tvist / spärr" : "Dispute / hold" },
              { id: "action", label: sv ? "Nästa åtgärd" : "Next action" },
            ]}
            rows={data.items.map((item) => ({
              id: item.invoiceId,
              cells: [
                <Box key="invoice" display="grid" gap="xs">
                  <Text>{item.invoiceNumber}</Text>
                  <Text tone="muted">{item.customerName}</Text>
                </Box>,
                item.dueOn,
                item.residualMinor === null
                  ? "—"
                  : `${formatMinorAmount(item.residualMinor, item.currencyScale, locale)} ${item.currency}`,
                <Text key="dispute">
                  {item.disputed ? (sv ? "Tvist" : "Disputed") : sv ? "Ingen tvist" : "No dispute"}
                  {item.holdReminders ? (sv ? " · Påminnelsespärr" : " · Reminder held") : ""}
                </Text>,
                actions[item.nextAction],
              ],
            }))}
          />
        ) : (
          <PageEmpty
            title={sv ? "Inga öppna kundreskontra" : "No open customer receivables"}
            detail={
              sv
                ? "Alla kundfakturor är reglerade eller blockeras inte."
                : "All customer invoices are settled or not blocked."
            }
          />
        )
      ) : null}
      {data && pages > 1 ? (
        <Box display="flex" justifyContent="between" alignItems="center" gap="lg" flexWrap="wrap">
          <PageCaption>
            {page} / {pages}
          </PageCaption>
          <Box display="flex" gap="sm">
            <Button
              variant="ghost"
              size="sm"
              disabled={page <= 1}
              onClick={() => props.onPage(page - 1)}
            >
              {sv ? "Föregående" : "Previous"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={page >= pages}
              onClick={() => props.onPage(page + 1)}
            >
              {sv ? "Nästa" : "Next"}
            </Button>
          </Box>
        </Box>
      ) : null}
    </Box>
  );
}

function CollectionHistory(
  props: CommerceProps & {
    base: string;
    data: CollectionHistoryData;
    customerId: string;
  },
) {
  const { book, locale, base, data } = props;
  const sv = locale === "sv";
  const statementKeys = useRef(new Map<string, string>());
  const [downloadError, setDownloadError] = useState<Error | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);

  const download = async (statementId: string) => {
    setDownloadError(null);
    setDownloading(statementId);

    try {
      await downloadCollectionStatement(book, base, statementId);
    } catch (error: unknown) {
      setDownloadError(error instanceof Error ? error : new Error("Unable to download statement"));
    } finally {
      setDownloading(null);
    }
  };

  return (
    <>
      <Text>
        {sv ? "Kund" : "Customer"}: {data.customerId}
      </Text>
      <CommandForm
        book={book}
        locale={locale}
        path={`${base}/statements`}
        schema={Collections.CaptureCollectionStatement}
        output={Collections.CollectionStatement}
        recoveryId={`statement:${props.customerId}`}
        keys={statementKeys.current}
        allowed={book.role === "operator"}
        label={sv ? "Skapa oföränderligt utdrag" : "Capture immutable statement"}
        onNewCommand={() => statementKeys.current.clear()}
        input={(fields) => ({ customerId: props.customerId, asOf: fields.get("asOf") })}
      >
        <InputField name="asOf" type="date" required label={sv ? "Per datum" : "As of date"} />
      </CommandForm>
      <h3>{sv ? "Sparade utdrag" : "Saved statements"}</h3>
      <AccountingStatus locale={locale} error={downloadError} />
      {data.statements.length === 0 ? (
        <Text tone="muted">{sv ? "Inga utdrag ännu." : "No statements yet."}</Text>
      ) : null}
      {data.statements.map((statement) => (
        <Box key={statement.id} display="grid" gap="sm" minWidth="zero">
          <Box display="flex" justifyContent="between" alignItems="center" gap="md" flexWrap="wrap">
            <strong>
              {statement.asOf} · {statement.id}
            </strong>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={downloading === statement.id}
              onClick={() => void download(statement.id)}
            >
              {downloading === statement.id
                ? sv
                  ? "Laddar ner…"
                  : "Downloading…"
                : sv
                  ? "Ladda ner utdrag"
                  : "Download statement"}
            </Button>
          </Box>
          <Text tone="muted">
            {sv ? "Bryttid" : "Cutoff"}: {statement.cutoffAt}
          </Text>
          {statement.items.length === 0 ? (
            <Text>
              {sv ? "Inga öppna fakturor vid bryttiden." : "No open invoices at this cutoff."}
            </Text>
          ) : null}
          {statement.items.map((item) => (
            <Text key={item.invoiceId}>
              {item.number} · {sv ? "Belopp" : "Amount"} {item.amountMinor} ·{" "}
              {sv ? "Betalt" : "Allocated"} {item.allocatedMinor} · {sv ? "Kvar" : "Outstanding"}{" "}
              {item.outstandingMinor}{" "}
              {item.currency
                ? `${item.currency} (${sv ? "minsta enhet" : "minor units"})`
                : sv
                  ? "Valuta saknas i äldre utdrag"
                  : "Currency absent in older statement"}
              {item.disputed ? " · disputed" : ""}
            </Text>
          ))}
        </Box>
      ))}
      <h3>{sv ? "Tvister och spärrar" : "Disputes and holds"}</h3>
      {data.disputes.map((dispute) => (
        <Text key={dispute.id}>
          {dispute.invoiceId} · {dispute.reason} ·{" "}
          {dispute.holdReminders
            ? sv
              ? "Pausad påminnelse"
              : "Reminder held"
            : sv
              ? "Ingen spärr"
              : "No hold"}{" "}
          ·{" "}
          {data.events.some(
            (event) => event.kind === "dispute_resolved" && event.disputeId === dispute.id,
          )
            ? sv
              ? "Löst"
              : "Resolved"
            : sv
              ? "Öppen"
              : "Open"}
        </Text>
      ))}
      <h3>{sv ? "Åtgärdshistorik" : "Action history"}</h3>
      <Text tone="muted">
        {sv
          ? "Förberedda påminnelser är förberedningsposter. Det här arbetsflödet registrerar ingen leverans."
          : "Prepared reminders are preparation records. This workflow records no delivery."}
      </Text>
      {data.events.map((event) => (
        <Text key={event.id}>
          {event.createdAt} · {event.invoiceId} ·{" "}
          {event.kind === "reminder_prepared"
            ? sv
              ? "Påminnelse förberedd · leverans ej godkänd eller registrerad"
              : "Reminder prepared · delivery not authorized or recorded"
            : event.kind}{" "}
          · {event.note}
          {event.outstandingMinor !== null
            ? ` · ${sv ? "Kvar" : "Outstanding"} ${event.outstandingMinor}`
            : ""}
        </Text>
      ))}
    </>
  );
}

async function downloadCollectionStatement(
  book: CommerceProps["book"],
  base: string,
  statementId: string,
) {
  const result = await readAccounting(
    `${base}/statements/${encodeURIComponent(statementId)}/export`,
    Collections.CollectionStatementExport,
  );

  checkScope(book, result.scope);

  if (result.statementId !== statementId) throw new Error("Collection statement identity mismatch");
  const bytes = new TextEncoder().encode(result.body);

  const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((byte) => Number(byte).toString(16).padStart(2, "0"))
    .join("");

  if (bytes.byteLength !== result.byteLength || hash !== result.sha256)
    throw new Error("Collection statement bytes do not match the retained hash");
  const url = URL.createObjectURL(new Blob([bytes], { type: result.mediaType }));
  const link = document.createElement("a");
  link.href = url;
  link.download = result.filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function CollectionActions(
  props: CommerceProps & {
    base: string;
    data: CollectionHistoryData;
    invoiceId: string;
    onInvoiceId: (id: string) => void;
  },
) {
  const { book, locale, base, data } = props;
  const sv = locale === "sv";
  const disputeKeys = useRef(new Map<string, string>());
  const actionKeys = useRef(new Map<string, string>());

  const invoices = data.statements
    .flatMap((statement) => statement.items)
    .filter(
      (item, index, all) => all.findIndex((other) => other.invoiceId === item.invoiceId) === index,
    );

  const activeHolds = data.disputes.filter(
    (dispute) =>
      dispute.invoiceId === props.invoiceId &&
      dispute.holdReminders &&
      !data.events.some(
        (event) => event.kind === "dispute_resolved" && event.disputeId === dispute.id,
      ),
  );

  return (
    <>
      <InputField
        name="invoiceId"
        label={sv ? "Faktura-ID för ny åtgärd" : "Invoice ID for new action"}
        value={props.invoiceId}
        onChange={(event) => props.onInvoiceId(event.target.value)}
      />
      {invoices.length ? (
        <Box display="flex" flexWrap="wrap" gap="sm">
          {invoices.map((item) => (
            <Button
              key={item.invoiceId}
              variant="outline"
              onClick={() => props.onInvoiceId(item.invoiceId)}
            >
              {item.number}
            </Button>
          ))}
        </Box>
      ) : null}
      {props.invoiceId ? (
        <>
          <Text tone="muted">
            {sv
              ? "Kontrollera aktuell reskontra före påminnelse. Servern kontrollerar saldo och aktiva tvisters spärrar igen. Ett tidigare utdrag är inte ett aktuellt saldo."
              : "Check the live receivable before preparing a reminder. The server rechecks balance and active dispute holds. An earlier statement is not a current balance."}
          </Text>
          <CommandForm
            key={`dispute-${props.invoiceId}`}
            book={book}
            locale={locale}
            path={`${base}/disputes`}
            schema={Collections.OpenCollectionDispute}
            output={Collections.CollectionDispute}
            recoveryId={`dispute:${props.invoiceId}`}
            keys={disputeKeys.current}
            allowed={book.role === "operator"}
            label={sv ? "Registrera tvist" : "Record dispute"}
            onNewCommand={() => disputeKeys.current.clear()}
            input={(fields) => ({
              invoiceId: props.invoiceId,
              reason: fields.get("reason"),
              evidenceId: fields.get("evidenceId"),
              ownerId: fields.get("ownerId"),
              holdReminders: fields.get("holdReminders") === "on",
            })}
          >
            <InputField name="reason" required label={sv ? "Orsak" : "Reason"} />
            <InputField name="evidenceId" required label={sv ? "Bevis-ID" : "Evidence ID"} />
            <InputField
              name="ownerId"
              required
              label={sv ? "Ansvarig aktör-ID" : "Owner actor ID"}
            />
            <label>
              <input type="checkbox" name="holdReminders" />{" "}
              {sv ? "Pausa påminnelser" : "Hold reminders"}
            </label>
          </CommandForm>
          <CommandForm
            key={`action-${props.invoiceId}`}
            book={book}
            locale={locale}
            path={`${base}/actions`}
            schema={Collections.RecordCollectionAction}
            output={Collections.CollectionAction}
            recoveryId={`action:${props.invoiceId}`}
            keys={actionKeys.current}
            allowed={book.role === "operator"}
            label={sv ? "Spara åtgärd" : "Record action"}
            onNewCommand={() => actionKeys.current.clear()}
            input={(fields) => ({
              invoiceId: props.invoiceId,
              kind: fields.get("kind"),
              note: fields.get("note"),
              ownerId: fields.get("ownerId"),
              disputeId: fields.get("disputeId") || null,
            })}
          >
            <label>
              {sv ? "Åtgärd" : "Action"}
              <select name="kind" required>
                <option value="contact">{sv ? "Kontakt" : "Contact"}</option>
                <option value="follow_up">{sv ? "Uppföljning" : "Follow-up"}</option>
                <option value="dispute_resolved">{sv ? "Lös tvist" : "Resolve dispute"}</option>
                <option value="reminder_prepared" disabled={activeHolds.length > 0}>
                  {sv ? "Förbered påminnelse (ingen leverans)" : "Prepare reminder (no delivery)"}
                </option>
              </select>
            </label>
            <InputField name="note" required label={sv ? "Anteckning" : "Note"} />
            <InputField
              name="ownerId"
              required
              label={sv ? "Ansvarig aktör-ID" : "Owner actor ID"}
            />
            <label>
              {sv ? "Tvist att lösa (endast vid lösning)" : "Dispute to resolve (resolution only)"}
              <select name="disputeId">
                <option value="">{sv ? "Ingen" : "None"}</option>
                {data.disputes
                  .filter(
                    (dispute) =>
                      dispute.invoiceId === props.invoiceId &&
                      !data.events.some(
                        (event) =>
                          event.kind === "dispute_resolved" && event.disputeId === dispute.id,
                      ),
                  )
                  .map((dispute) => (
                    <option key={dispute.id} value={dispute.id}>
                      {dispute.reason} · {dispute.id}
                    </option>
                  ))}
              </select>
            </label>
            {activeHolds.length ? (
              <Text tone="muted">
                {sv ? "Aktiv tvist spärrar påminnelse." : "An active dispute holds reminders."}
              </Text>
            ) : null}
          </CommandForm>
        </>
      ) : null}
    </>
  );
}
