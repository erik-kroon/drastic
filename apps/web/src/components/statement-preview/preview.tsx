import { useId, useRef, useState } from "react";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { DataTable } from "@open-erp/ui/components/data-table";
import { InputField, SelectField } from "@open-erp/ui/components/field";
import { Link } from "@open-erp/ui/components/link";
import { Heading, Text } from "@open-erp/ui/components/typography";
import { previewSebStatement, StatementProblem, type StatementPreview } from "@/lib/seb-statement";
import type { Locale } from "@/paraglide/runtime";
import { statementCopy } from "./copy";

type PreviewState =
  | { status: "empty" }
  | { status: "reading" }
  | { status: "error"; problem: StatementProblem }
  | { status: "ready"; statement: StatementPreview };

export function StatementFilePreview({ locale }: { locale: Locale }) {
  const copy = statementCopy(locale);
  const fileInput = useRef<HTMLInputElement>(null);
  const selection = useRef(0);
  const errorId = useId();
  const helpId = useId();
  const [state, setState] = useState<PreviewState>({ status: "empty" });
  const [currency, setCurrency] = useState<string | null>(null);

  function clear() {
    selection.current++;
    setState({ status: "empty" });
  }

  async function review(file: File) {
    const current = ++selection.current;
    setState({ status: "reading" });

    try {
      const statement = await previewSebStatement(file);

      if (current === selection.current) setState({ status: "ready", statement });
    } catch (error) {
      if (current !== selection.current) return;
      setState({
        status: "error",
        problem: error instanceof StatementProblem ? error : new StatementProblem("read"),
      });
      fileInput.current?.focus();
    }
  }

  return (
    <Box display="grid" gap="2xl" minWidth="zero">
      <Text>{copy.local}</Text>
      <Box
        as="form"
        display="grid"
        gap="lg"
        maxWidth="content"
        onSubmit={(event) => {
          event.preventDefault();
          const file = fileInput.current?.files?.[0];

          if (file && currency === "SEK") void review(file);
        }}
      >
        <InputField
          ref={fileInput}
          label={copy.file}
          name="statement"
          type="file"
          accept=".csv,text/csv"
          required
          aria-invalid={state.status === "error"}
          aria-describedby={`${helpId} ${errorId}`}
          onChange={clear}
        />
        <Text id={helpId} tone="muted">
          {copy.format}
        </Text>
        <SelectField
          label={copy.currency}
          placeholder={copy.chooseCurrency}
          name="currency"
          required
          value={currency}
          options={[{ value: "SEK", label: "SEK" }]}
          onValueChange={(value) => {
            clear();
            setCurrency(value);
          }}
        />
        <Text tone="muted">{copy.currencyHelp}</Text>
        <Box display="flex" flexWrap="wrap" gap="md">
          <Button type="submit" size="xl" disabled={state.status === "reading"}>
            {copy.inspect}
          </Button>
          <Button
            type="button"
            size="xl"
            variant="outline"
            onClick={() => {
              clear();

              if (fileInput.current) fileInput.current.value = "";
              fileInput.current?.focus();
            }}
          >
            {copy.clear}
          </Button>
        </Box>
        <Text id={errorId} role="alert">
          {state.status === "error"
            ? `${copy.errors[state.problem.code]} ${copy.line}: ${state.problem.line}.`
            : ""}
        </Text>
        <Text role="status">
          {state.status === "reading" ? copy.reading : state.status === "ready" ? copy.ready : ""}
        </Text>
      </Box>
      {state.status === "ready" ? (
        <StatementDetails
          key={state.statement.source.sha256}
          statement={state.statement}
          locale={locale}
        />
      ) : null}
    </Box>
  );
}

function money(minor: string, locale: Locale) {
  const value = BigInt(minor);
  const absolute = value < 0n ? -value : value;

  return `${value < 0n ? "−" : ""}${new Intl.NumberFormat(locale).format(absolute / 100n)}${locale === "sv" ? "," : "."}${String(absolute % 100n).padStart(2, "0")}`;
}

function StatementDetails({ statement, locale }: { statement: StatementPreview; locale: Locale }) {
  const copy = statementCopy(locale);
  const [page, setPage] = useState(0);
  const pageSize = 100;
  const start = page * pageSize;
  const end = Math.min(start + pageSize, statement.rows.length);

  const summary = [
    { id: "count", cells: [copy.count, String(statement.rows.length)] },
    {
      id: "incoming",
      cells: [copy.incoming, `${money(statement.controls.depositsMinor, locale)} SEK`],
    },
    {
      id: "outgoing",
      cells: [copy.outgoing, `${money(statement.controls.withdrawalsMinor, locale)} SEK`],
    },
    {
      id: "opening",
      cells: [copy.opening, `${money(statement.controls.inferredOpeningMinor, locale)} SEK`],
    },
    {
      id: "closing",
      cells: [
        copy.closing,
        `${money(statement.controls.lastObservedMinor, locale)} SEK · ${statement.rows[0]?.bookedOn}`,
      ],
    },
  ];

  return (
    <Box as="section" display="grid" gap="lg" minWidth="zero">
      <Heading>{copy.controls}</Heading>
      <Text>
        {copy.source}: {statement.source.name}
      </Text>
      <DataTable
        title={copy.controls}
        columns={[
          { id: "field", label: copy.field },
          { id: "value", label: copy.value, numeric: true },
        ]}
        rows={summary}
      />
      <Text>
        {statement.controls.balanceDifferenceRows.length === 0
          ? copy.consistent
          : `${copy.differences} ${statement.controls.balanceDifferenceRows.join(", ")}`}
      </Text>
      <Text>{copy.coverage}</Text>
      <Box>
        <Link
          href={`data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(statement, null, 2))}`}
          download={`statement-review-${statement.source.sha256.slice(0, 12)}.json`}
        >
          {copy.download}
        </Link>
      </Box>
      <Text tone="muted">{copy.downloadHelp}</Text>
      <Text tone="muted">
        {copy.hash}: {statement.source.sha256}
      </Text>
      <DataTable
        title={copy.transactions}
        narrow="stack"
        columns={[
          { id: "row", label: copy.row },
          { id: "booked", label: copy.booked },
          { id: "valued", label: copy.valued },
          { id: "description", label: copy.description },
          { id: "type", label: copy.type },
          { id: "amount", label: copy.amount, numeric: true },
          { id: "balance", label: copy.balance, numeric: true },
        ]}
        rows={statement.rows.slice(start, end).map((row) => ({
          id: String(row.ordinal),
          cells: [
            String(row.ordinal),
            row.bookedOn,
            row.valuedOn,
            row.description,
            row.transactionType,
            money(row.amountMinor, locale),
            money(row.balanceMinor, locale),
          ],
        }))}
      />
      {statement.rows.length > pageSize ? (
        <Box display="flex" flexWrap="wrap" gap="md" alignItems="center">
          <Button
            size="xl"
            variant="outline"
            disabled={page === 0}
            onClick={() => setPage(page - 1)}
          >
            {copy.previous}
          </Button>
          <Text role="status">
            {start + 1}–{end} / {statement.rows.length}
          </Text>
          <Button
            size="xl"
            variant="outline"
            disabled={end === statement.rows.length}
            onClick={() => setPage(page + 1)}
          >
            {copy.next}
          </Button>
        </Box>
      ) : null}
    </Box>
  );
}
