import { useRef, useState, type ComponentProps } from "react";
import { useQuery } from "@tanstack/react-query";
import * as Reports from "@open-erp/contracts/register-reports";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { DataTable } from "@open-erp/ui/components/data-table";
import { Heading, Text } from "@open-erp/ui/components/typography";
import { AccountingStatus } from "@/components/accounting-status";
import { readAccounting } from "@/lib/accounting-api";
import { commerceCopy } from "./copy";
import {
  CommandForm,
  Details,
  Facts,
  Field,
  Lookup,
  checkScope,
  commerceKey,
  commercePath,
  type CommerceProps,
} from "./shared";

export function RegisterReports(props: CommerceProps) {
  const { book, locale } = props;
  const copy = commerceCopy(locale);
  const [after, setAfter] = useState("");
  const [inventoryVersion, setInventoryVersion] = useState(0);
  const firstCursor = useRef({ version: 0, value: "" });
  const [selected, setSelected] = useState("");
  const page = useQuery({
    queryKey: [...commerceKey(book), "register-reports", inventoryVersion, after],
    queryFn: async ({ signal }) => {
      const cursor =
        after ||
        (firstCursor.current.version === inventoryVersion ? firstCursor.current.value : "");
      const result = await readAccounting(
        `${commercePath(book)}/register-snapshots${cursor ? `?after=${encodeURIComponent(cursor)}` : ""}`,
        Reports.RegisterReportPage,
        { signal },
      );
      checkScope(book, result.scope);
      result.items.forEach((report) => checkScope(book, report.scope));
      // Keep first-page retries/invalidation in the same inventory, too.
      if (firstCursor.current.version === inventoryVersion && !firstCursor.current.value) {
        firstCursor.current.value = result.first;
      }
      return result;
    },
    retry: false,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
  });
  return (
    <Box display="grid" gap="lg" minWidth="zero">
      <Text>{copy.registerBasis}</Text>
      <Text tone="muted">{copy.registerLimits}</Text>
      <Details title={copy.captureRegister}>
        <CommandForm
          {...props}
          path={`${commercePath(book)}/register-snapshots`}
          schema={Reports.CreateRegisterReport}
          output={Reports.RegisterReport}
          label={copy.captureRegister}
          input={(fields) => ({ asOfDate: fields.get("asOfDate") })}
          onSuccess={(report) => setSelected(report.id)}
        >
          <Field name="asOfDate" label={copy.asOfDate} type="date" />
        </CommandForm>
      </Details>
      <Lookup label={copy.open} onOpen={setSelected} />
      <Box display="flex" flexWrap="wrap" gap="md">
        <Button
          size="xl"
          variant="outline"
          disabled={page.isFetching}
          onClick={() => {
            firstCursor.current = { version: inventoryVersion + 1, value: "" };
            setAfter("");
            setInventoryVersion((version) => version + 1);
          }}
        >
          {copy.refresh}
        </Button>
        <Button
          size="xl"
          variant="outline"
          disabled={!after || !page.isSuccess || after === page.data.first || page.isFetching}
          onClick={() => {
            if (page.data) setAfter(page.data.first);
          }}
        >
          {copy.first}
        </Button>
        <Button
          size="xl"
          variant="outline"
          disabled={!page.isSuccess || page.isFetching || !page.data.next}
          onClick={() => {
            if (page.data?.next) setAfter(page.data.next);
          }}
        >
          {copy.next}
        </Button>
      </Box>
      <Text tone="muted">{copy.registerListNote}</Text>
      {page.isSuccess ? (
        <Text>
          {copy.registerInventoryCount}: {page.data.total} · {copy.registerInventoryCutoff}:{" "}
          {page.data.cutoff}
        </Text>
      ) : null}
      <AccountingStatus locale={locale} pending={page.isPending} error={page.error} />
      {page.isSuccess ? (
        <DataTable
          title={copy.registerReports}
          narrow="stack"
          columns={[
            { id: "id", label: copy.id },
            { id: "date", label: copy.asOfDate },
            { id: "created", label: copy.capturedAt },
            { id: "sequence", label: copy.ledgerSequence },
          ]}
          rows={page.data.items.map((report) => ({
            id: report.id,
            cells: [
              <Button key="open" size="xl" variant="outline" onClick={() => setSelected(report.id)}>
                {report.id}
              </Button>,
              report.asOfDate,
              report.createdAt,
              report.sequence,
            ],
          }))}
        />
      ) : null}
      {page.isSuccess && page.data.items.length === 0 ? <Text>{copy.empty}</Text> : null}
      {selected ? <SavedRegisterReport {...props} key={selected} id={selected} /> : null}
    </Box>
  );
}

function SavedRegisterReport(props: CommerceProps & { id: string }) {
  const { book, locale, id } = props;
  const copy = commerceCopy(locale);
  const report = useQuery({
    queryKey: [...commerceKey(book), "register-report", id],
    queryFn: async ({ signal }) => {
      const result = await readAccounting(
        `${commercePath(book)}/register-snapshots/${encodeURIComponent(id)}`,
        Reports.RegisterReport,
        { signal },
      );
      checkScope(book, result.scope);
      if (result.id !== id) throw new Error("Register snapshot identity mismatch");
      return result;
    },
    retry: false,
  });
  return (
    <Box display="grid" gap="lg" minWidth="zero">
      <Heading>{copy.registerReports}</Heading>
      <Text>
        {copy.id}: {id}
      </Text>
      <Box>
        <Button
          size="xl"
          variant="outline"
          disabled={report.isFetching}
          onClick={() => {
            void report.refetch();
          }}
        >
          {copy.refresh}
        </Button>
      </Box>
      <AccountingStatus locale={locale} pending={report.isPending} error={report.error} />
      {report.isSuccess ? <ReportContents {...props} report={report.data} /> : null}
    </Box>
  );
}

function ReportContents({
  locale,
  report,
}: CommerceProps & { report: typeof Reports.RegisterReport.Type }) {
  const copy = commerceCopy(locale);
  const statuses = {
    balanced: copy.registerBalanced,
    differences: copy.registerDifferences,
    no_declared_accounts: copy.registerNoAccounts,
  };
  return (
    <Box display="grid" gap="lg" minWidth="zero">
      <Text role="status">{statuses[report.status]}</Text>
      <Text>
        {copy.asOfDate}: {report.asOfDate} · {copy.capturedAt}: {report.createdAt}
      </Text>
      <Text>
        {copy.ledgerSequence}: {report.sequence} · {copy.units} {report.currency} · {copy.scale}:{" "}
        {report.currencyScale}
      </Text>
      <Text>{copy.registerSign}</Text>
      <Text>
        {copy.digest}: {report.digest}
      </Text>
      <Box>
        <Button
          size="xl"
          variant="outline"
          onClick={() => {
            const url = URL.createObjectURL(
              new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }),
            );
            const link = document.createElement("a");
            link.href = url;
            link.download = `${report.id}.json`;
            document.body.append(link);
            link.click();
            link.remove();
            window.setTimeout(() => URL.revokeObjectURL(url), 0);
          }}
        >
          {copy.registerDownload}
        </Button>
      </Box>
      <ReportTable
        locale={locale}
        title={copy.registerControls}
        columns={[
          { id: "account", label: copy.account },
          { id: "direction", label: copy.role },
          { id: "outstanding", label: copy.outstanding, numeric: true },
          { id: "ledger", label: copy.ledgerAmount, numeric: true },
          { id: "difference", label: copy.registerDifference, numeric: true },
          { id: "unexplained", label: copy.unexplainedLines, numeric: true },
        ]}
        rows={report.controls.map((control) => ({
          id: control.accountId,
          cells: [
            `${control.code} · ${control.name} · ${control.accountId}`,
            copy[control.direction],
            control.outstandingMinor,
            control.ledgerMinor,
            control.differenceMinor,
            control.unexplainedLineCount,
          ],
        }))}
      />
      <ReportTable
        locale={locale}
        title={copy.registerAgeing}
        columns={[
          { id: "account", label: copy.account },
          { id: "current", label: copy.notDue, numeric: true },
          { id: "30", label: copy.days1To30, numeric: true },
          { id: "60", label: copy.days31To60, numeric: true },
          { id: "90", label: copy.days61To90, numeric: true },
          { id: "old", label: copy.over90, numeric: true },
        ]}
        rows={report.controls.map((control) => ({
          id: control.accountId,
          cells: [
            control.code,
            control.ageing.not_due,
            control.ageing.days_1_30,
            control.ageing.days_31_60,
            control.ageing.days_61_90,
            control.ageing.over_90,
          ],
        }))}
      />
      <Details title={copy.registerInvoices}>
        <ReportTable
          locale={locale}
          title={copy.registerInvoices}
          columns={[
            { id: "invoice", label: copy.document },
            { id: "party", label: copy.name },
            { id: "due", label: copy.due },
            { id: "revision", label: copy.revision },
            { id: "days", label: copy.daysOverdue, numeric: true },
            { id: "amount", label: copy.outstanding, numeric: true },
          ]}
          rows={report.invoices.map((invoice) => ({
            id: invoice.id,
            cells: [
              `${invoice.documentNumber} · ${invoice.id}`,
              invoice.counterpartyName,
              invoice.revision.dueOn,
              invoice.revision.revision,
              invoice.daysOverdue,
              invoice.outstandingMinor,
            ],
          }))}
        />
      </Details>
      <Details title={copy.registerLedger}>
        {report.status === "differences" ? <Text>{copy.registerDifferences}</Text> : null}
        <ReportTable
          locale={locale}
          title={copy.registerLedger}
          columns={[
            { id: "voucher", label: copy.voucher },
            { id: "line", label: copy.line },
            { id: "date", label: copy.postingDate },
            { id: "account", label: copy.account },
            { id: "effect", label: copy.registerEffect, numeric: true },
            { id: "difference", label: copy.unexplainedAmount, numeric: true },
          ]}
          rows={report.ledgerLines.map((line) => ({
            id: `${line.voucherId}:${line.lineId}`,
            cells: [
              line.voucherId,
              line.lineId,
              line.postingDate,
              line.accountId,
              line.registerEffectMinor,
              line.unexplainedMinor,
            ],
          }))}
        />
      </Details>
      <Details title={copy.registerAllocations}>
        <ReportTable
          locale={locale}
          title={copy.registerAllocations}
          columns={[
            { id: "receipt", label: copy.allocationReceipt },
            { id: "invoice", label: copy.invoiceId },
            { id: "voucher", label: copy.voucher },
            { id: "date", label: copy.postingDate },
            { id: "amount", label: copy.amount, numeric: true },
          ]}
          rows={report.allocations.map((leg) => ({
            id: `${leg.receiptId}:${leg.ordinal}`,
            cells: [
              `${leg.receiptId} / ${leg.ordinal}`,
              leg.invoiceId,
              leg.paymentVoucherId,
              leg.postingDate,
              leg.amountMinor,
            ],
          }))}
        />
      </Details>
      <Facts title={copy.facts} value={report} />
    </Box>
  );
}

function ReportTable(
  props: ComponentProps<typeof DataTable> & { locale: CommerceProps["locale"] },
) {
  const copy = commerceCopy(props.locale);
  const rows = props.rows;
  const [page, setPage] = useState(0);
  return (
    <Box display="grid" gap="md" minWidth="zero">
      <DataTable
        title={props.title}
        columns={props.columns}
        narrow="stack"
        rows={rows.slice(page * 50, (page + 1) * 50)}
      />
      {rows.length === 0 ? <Text>{copy.empty}</Text> : null}
      {rows.length > 50 ? (
        <>
          <Text tone="muted">{copy.registerPage}</Text>
          <Box display="flex" flexWrap="wrap" gap="md">
            <Button
              size="xl"
              variant="outline"
              disabled={page === 0}
              onClick={() => setPage((value) => value - 1)}
            >
              {copy.previous}
            </Button>
            <Button
              size="xl"
              variant="outline"
              disabled={(page + 1) * 50 >= rows.length}
              onClick={() => setPage((value) => value + 1)}
            >
              {copy.next}
            </Button>
          </Box>
        </>
      ) : null}
    </Box>
  );
}
