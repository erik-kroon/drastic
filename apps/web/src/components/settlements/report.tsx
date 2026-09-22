import { useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import * as Schema from "effect/Schema";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Bank from "@open-erp/contracts/reconciliation";
import * as Settlement from "@open-erp/contracts/settlements";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { DataTable } from "@open-erp/ui/components/data-table";
import { InputField, SelectField } from "@open-erp/ui/components/field";
import { Heading, Text } from "@open-erp/ui/components/typography";
import { AccountingStatus } from "@/components/accounting-status";
import { BankMatches, BankStatementDetails } from "@/components/bank-statement";
import { bookKey, bookPath, mutationOptions, readAccounting } from "@/lib/accounting-api";
import type { Locale } from "@/paraglide/runtime";
import { settlementCopy } from "./copy";

export function CapacityReports({
  book,
  setup,
  locale,
}: {
  book: typeof Accounting.Book.Type;
  setup: typeof Accounting.BookSetup.Type;
  locale: Locale;
}) {
  const copy = settlementCopy(locale);
  const [id, setId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const keys = useRef(new Map<string, string>());
  const mutation = useMutation({
    mutationFn: (input: typeof Bank.ReconcileBank.Type) => {
      const path = `${bookPath(book)}/bank-capacity-reconciliations`;
      return readAccounting(
        path,
        Settlement.BankCapacityReconciliation,
        mutationOptions(path, JSON.stringify(input), keys.current),
      );
    },
    onSuccess: (report) => setId(report.id),
  });
  return (
    <Box display="grid" gap="lg" minWidth="zero">
      <Heading>{copy.report}</Heading>
      <Text>{copy.intervalHelp}</Text>
      <Box
        as="form"
        display="grid"
        gap="md"
        onSubmit={(event) => {
          event.preventDefault();
          const fields = new FormData(event.currentTarget);
          const result = Schema.decodeUnknownOption(Bank.ReconcileBank)({
            accountId: fields.get("accountId"),
            startsOn: fields.get("startsOn"),
            endsOn: fields.get("endsOn"),
          });
          if (result._tag === "None") {
            setError(copy.invalid);
            return;
          }
          setError("");
          mutation.mutate(result.value);
        }}
      >
        <Box
          as="fieldset"
          display="grid"
          gap="md"
          borderWidth="none"
          padding="none"
          margin="none"
          minWidth="zero"
          disabled={mutation.isPending || mutation.isSuccess}
        >
          <SelectField
            label={copy.account}
            name="accountId"
            required
            options={setup.accounts.map((account) => ({
              value: account.id,
              label: `${account.code} · ${account.name} · ${account.id}`,
            }))}
          />
          <Box display="grid" columns={1} columnsAtSm={2} gap="md">
            <InputField label={copy.starts} name="startsOn" type="date" required />
            <InputField label={copy.ends} name="endsOn" type="date" required />
          </Box>
          <Box>
            <Button type="submit" size="xl">
              {copy.runReport}
            </Button>
          </Box>
        </Box>
        <Text role="status">{error}</Text>
        <AccountingStatus
          locale={locale}
          pending={mutation.isPending}
          error={mutation.error}
          write
        />
        {mutation.isSuccess ? (
          <Box>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                mutation.reset();
                keys.current.clear();
              }}
            >
              {copy.newReport}
            </Button>
          </Box>
        ) : null}
      </Box>
      <Box
        as="form"
        display="grid"
        gap="md"
        onSubmit={(event) => {
          event.preventDefault();
          const value = new FormData(event.currentTarget).get("reportId");
          if (Schema.is(Accounting.Identifier)(value)) setId(value);
        }}
      >
        <InputField
          label={copy.reportId}
          name="reportId"
          required
          pattern="[a-z][a-z0-9_\-]{2,127}"
        />
        <Box>
          <Button type="submit" size="xl" variant="outline">
            {copy.loadReport}
          </Button>
        </Box>
      </Box>
      {id ? <CapacityReport key={id} book={book} id={id} locale={locale} /> : null}
    </Box>
  );
}

function CapacityReport({
  book,
  id,
  locale,
}: {
  book: typeof Accounting.Book.Type;
  id: string;
  locale: Locale;
}) {
  const copy = settlementCopy(locale);
  const report = useQuery({
    queryKey: [...bookKey(book), "bank-capacity-reconciliation", id],
    retry: false,
    queryFn: async ({ signal }) => {
      const view = await readAccounting(
        `${bookPath(book)}/bank-capacity-reconciliations/${encodeURIComponent(id)}`,
        Settlement.BankCapacityReconciliationView,
        { signal },
      );
      if (
        view.report.id !== id ||
        view.report.scope.bookId !== book.id ||
        view.report.scope.entityId !== book.entityId
      )
        throw new Error("Bank report scope mismatch");
      return view;
    },
  });
  const view = report.data;
  const statuses = {
    complete: copy.complete,
    balanced_but_incomplete: copy.incomplete,
    differences: copy.differences,
  };
  return (
    <Box display="grid" gap="lg" minWidth="zero">
      <Box>
        <Button
          type="button"
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
      {view ? (
        <>
          <Text>
            {copy.reportId}: {view.report.id}
          </Text>
          <Text>
            {view.report.accountId} · {view.report.currency} / {view.report.currencyScale} ·{" "}
            {view.report.startsOn} – {view.report.endsOn}
          </Text>
          <Text>{statuses[view.report.status]}</Text>
          <Text role="status">
            {report.isError || report.isFetching
              ? copy.unknown
              : view.fresh
                ? copy.reportFresh
                : copy.reportStale}
          </Text>
          <Text>
            {copy.boundaries}: {view.report.openingDifferenceMinor ?? copy.unknownBalance} /{" "}
            {view.report.closingDifferenceMinor ?? copy.unknownBalance}
          </Text>
          {view.report.differences.map((difference) => (
            <Text key={difference}>{difference}</Text>
          ))}
          <Heading>{copy.gaps}</Heading>
          {view.report.coverageGaps.length ? (
            view.report.coverageGaps.map((gap) => <Text key={gap}>{gap}</Text>)
          ) : (
            <Text>{copy.noGaps}</Text>
          )}
          <DataTable
            title={copy.sources}
            narrow="stack"
            columns={[
              { id: "id", label: copy.source },
              { id: "amount", label: copy.total, numeric: true },
              { id: "allocated", label: copy.allocated, numeric: true },
              { id: "remaining", label: copy.remaining, numeric: true },
            ]}
            rows={view.report.sourceRows.map((row) => ({
              id: `${row.statementId}/${row.rowOrdinal}`,
              cells: [
                `${row.statementId}/${row.rowOrdinal} · ${row.date}`,
                row.amountMinor,
                row.allocatedMinor,
                row.remainingMinor,
              ],
            }))}
          />
          <DataTable
            title={copy.lines}
            narrow="stack"
            columns={[
              { id: "id", label: copy.ledger },
              { id: "amount", label: copy.total, numeric: true },
              { id: "allocated", label: copy.allocated, numeric: true },
              { id: "remaining", label: copy.remaining, numeric: true },
            ]}
            rows={view.report.ledgerLines.map((line) => ({
              id: `${line.voucherId}/${line.lineId}`,
              cells: [
                `${line.voucherId}/${line.lineId} · ${line.date}`,
                line.amountMinor,
                line.allocatedMinor,
                line.remainingMinor,
              ],
            }))}
          />
          <DataTable
            title={copy.savedLegs}
            narrow="stack"
            columns={[
              { id: "plan", label: copy.planId },
              { id: "source", label: copy.source },
              { id: "line", label: copy.ledger },
              { id: "amount", label: copy.amount, numeric: true },
            ]}
            rows={view.report.allocations.map((leg) => ({
              id: `${leg.planId}/${leg.ordinal}`,
              cells: [
                leg.planId,
                `${leg.statementId}/${leg.rowOrdinal}`,
                `${leg.voucherId}/${leg.lineId}`,
                leg.amountMinor,
              ],
            }))}
          />
          <Text>
            {copy.receipt}: {view.report.receipt.key} · {view.report.receipt.actorId}
          </Text>
          <details>
            <summary>{copy.details}</summary>
            <Box display="grid" gap="lg" paddingBlock="lg" minWidth="zero">
              <Heading>{copy.legacyMatches}</Heading>
              <BankMatches matches={view.report.matches} locale={locale} />
              {view.report.statements.map((statement) => (
                <BankStatementDetails
                  key={statement.id}
                  book={book}
                  statement={statement}
                  locale={locale}
                />
              ))}
            </Box>
          </details>
        </>
      ) : null}
    </Box>
  );
}
