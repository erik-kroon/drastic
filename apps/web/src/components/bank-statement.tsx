import { lazy, Suspense, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Schema from "effect/Schema";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Bank from "@open-erp/contracts/reconciliation";
import { workQueryOptions, formatMinorAmount } from "@/lib/workspace-api";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { DataTable } from "@open-erp/ui/components/data-table";
import { InputField, SelectField } from "@open-erp/ui/components/field";
import { Heading, Text } from "@open-erp/ui/components/typography";
import { AccountingStatus } from "@/components/accounting-status";
import { EvidenceInspector } from "@/components/evidence-inspector";
import { bookKey, bookPath, mutationOptions, readAccounting } from "@/lib/accounting-api";
import { accountingCopy } from "@/lib/accounting-copy";
import type { Locale } from "@/paraglide/runtime";
import { RecordHeading, RecordSummary, RecordFact } from "@open-erp/ui/components/record-layout";
import { Disclosure } from "@open-erp/ui/components/workflow";
import { PageAction, PageCaption } from "@open-erp/ui/components/accounting-page";
import { workspacePath } from "@/lib/book-context";

const BankCandidateResults = lazy(() =>
  import("@/components/bank-match-candidates/results").then((module) => ({
    default: module.BankCandidateResults,
  })),
);

type StatementReviewProps = {
  book: typeof Accounting.Book.Type;
  id: string;
  locale: Locale;
};

export function BankStatementReview(props: StatementReviewProps) {
  return <StatementReview key={`${props.book.entityId}:${props.book.id}:${props.id}`} {...props} />;
}

function StatementReview({ book, id, locale }: StatementReviewProps) {
  const copy = accountingCopy(locale);
  const [candidateRow, setCandidateRow] = useState<number | null>(null);
  const candidateLabel = locale === "sv" ? "Hitta matchning" : "Find match";
  const metadata = useQuery(workQueryOptions(book, {}));
  const scale = metadata.data?.currencyScale;
  const statement = useQuery({
    queryKey: [...bookKey(book), "bank-statement", id],
    queryFn: async ({ signal }) => {
      const result = await readAccounting(
        `${bookPath(book)}/bank-statements/${encodeURIComponent(id)}`,
        Bank.BankStatementView,
        { signal },
      );
      if (result.statement.id !== id || result.matches.some((match) => match.statementId !== id)) {
        throw new Error("Bank statement response identity mismatch");
      }
      return result;
    },
    retry: false,
  });
  return (
    <Box as="section" display="grid" gap="lg" minWidth="zero">
      <RecordHeading
        title={copy.bank_statement}
        action={
          <Button
            static
            variant="outline"
            disabled={statement.isFetching}
            onClick={() => {
              void statement.refetch();
            }}
          >
            {copy.journal_refresh}
          </Button>
        }
      />
      <AccountingStatus locale={locale} pending={statement.isPending} error={statement.error} />
      {statement.data ? (
        <>
          <BankStatementDetails book={book} statement={statement.data.statement} locale={locale} />
          <DataTable
            title={copy.bank_rows}
            narrow="stack"
            columns={[
              { id: "ordinal", label: locale === "sv" ? "Rad" : "Row" },
              { id: "provider", label: locale === "sv" ? "Referens" : "Reference" },
              { id: "date", label: copy.journal_date },
              { id: "description", label: copy.journal_description },
              {
                id: "amount",
                label: `${locale === "sv" ? "Belopp" : "Amount"} · ${book.currency}`,
                numeric: true,
              },
              { id: "candidates", label: candidateLabel },
            ]}
            rows={statement.data.statement.rows.map((row) => ({
              id: String(row.rowOrdinal),
              cells: [
                String(row.rowOrdinal),
                row.providerId ?? "—",
                row.date,
                row.description,
                scale === undefined ? "—" : formatMinorAmount(row.amountMinor, scale, locale),
                <Button
                  key="candidates"
                  static
                  variant="outline"
                  aria-label={`${candidateLabel} · ${row.description}`}
                  onClick={() => setCandidateRow(row.rowOrdinal)}
                >
                  {candidateLabel}
                </Button>,
              ],
            }))}
          />
          {candidateRow !== null ? (
            <Suspense fallback={<AccountingStatus locale={locale} pending error={null} />}>
              <BankCandidateResults
                key={candidateRow}
                book={book}
                locale={locale}
                source={{ statementId: id, rowOrdinal: candidateRow }}
              />
            </Suspense>
          ) : null}
          <Box>
            <PageAction href={`${workspacePath(book)}/accounts?view=matching`}>
              {locale === "sv" ? "Öppna matchning" : "Matching workspace"}
            </PageAction>
          </Box>
          <Disclosure
            title={
              locale === "sv"
                ? "Direkta matchningar och manuell återställning"
                : "Direct matches and manual recovery"
            }
          >
            <Text tone="muted">
              {copy.bank_checkpoint}: {statement.data.checkpoint.sequence} /{" "}
              {statement.data.checkpoint.sourceRevision}
            </Text>
            <BankMatches matches={statement.data.matches} locale={locale} />
            <BankMatchForm book={book} statement={statement.data} locale={locale} />
          </Disclosure>
        </>
      ) : null}
    </Box>
  );
}

export function BankStatementDetails({
  book,
  statement,
  locale,
}: {
  book: typeof Accounting.Book.Type;
  statement: typeof Bank.BankStatement.Type;
  locale: Locale;
}) {
  const copy = accountingCopy(locale);
  const metadata = useQuery(workQueryOptions(book, {}));
  const setup = useQuery({
    queryKey: [...bookKey(book), "setup"],
    queryFn: ({ signal }) =>
      readAccounting(`${bookPath(book)}/setup`, Accounting.BookSetup, { signal }),
    retry: false,
  });
  const account = setup.data?.accounts.find((item) => item.id === statement.accountId);
  const amount = (value: string) =>
    metadata.data
      ? `${formatMinorAmount(value, metadata.data.currencyScale, locale)} ${statement.currency}`
      : "—";
  const sv = locale === "sv";
  return (
    <Box display="grid" gap="md" minWidth="zero">
      <PageCaption>
        {account
          ? `${account.code} · ${account.name}`
          : sv
            ? "Konto ej tillgängligt"
            : "Account unavailable"}{" "}
        · {statement.startsOn} – {statement.endsOn}
      </PageCaption>
      <RecordSummary>
        <RecordFact label={sv ? "Ingående saldo" : "Opening balance"}>
          {amount(statement.openingMinor)}
        </RecordFact>
        <RecordFact label={sv ? "Utgående saldo" : "Closing balance"}>
          {amount(statement.closingMinor)}
        </RecordFact>
        <RecordFact label={sv ? "Transaktioner" : "Transactions"}>
          {statement.rows.length}
        </RecordFact>
      </RecordSummary>
      <PageCaption>
        {statement.completeness.declaredComplete ? copy.bank_declared : copy.bank_not_declared} ·{" "}
        {statement.completeness.basis}
      </PageCaption>
      <Disclosure title={sv ? "Underlag och referenser" : "Source and references"}>
        <Text>
          {copy.bank_statement_id}: {statement.id} · {statement.statementIdentifier}
        </Text>
        <Text>
          {copy.bank_source_account}: {statement.sourceBankAccountId}
        </Text>
        <EvidenceInspector
          book={book}
          locale={locale}
          reference={{
            evidenceId: statement.evidenceId,
            sha256: statement.evidenceSha256,
            locator: "$",
          }}
        />
      </Disclosure>
    </Box>
  );
}

export function BankMatches({
  matches,
  locale,
}: {
  matches: readonly (typeof Bank.BankMatch.Type)[];
  locale: Locale;
}) {
  const copy = accountingCopy(locale);
  return (
    <Box display="grid" gap="md" minWidth="zero">
      <DataTable
        title={copy.bank_matches}
        narrow="stack"
        columns={[
          { id: "statement", label: copy.bank_statement_id },
          { id: "ordinal", label: copy.bank_ordinal },
          { id: "voucher", label: copy.journal_voucher },
          { id: "line", label: copy.bank_line_id },
          { id: "origin", label: copy.journal_origin },
        ]}
        rows={matches.map((match) => ({
          id: `${match.statementId}/${match.rowOrdinal}`,
          cells: [
            match.statementId,
            String(match.rowOrdinal),
            match.voucherId,
            match.lineId,
            `${match.origin} · ${match.actorId}`,
          ],
        }))}
      />
      {matches.length === 0 ? <Text tone="muted">{copy.bank_empty}</Text> : null}
    </Box>
  );
}

function BankMatchForm({
  book,
  statement,
  locale,
}: {
  book: typeof Accounting.Book.Type;
  statement: typeof Bank.BankStatementView.Type;
  locale: Locale;
}) {
  const copy = accountingCopy(locale);
  const matchedRows = new Set(statement.matches.map((match) => match.rowOrdinal));
  const hasUnmatched = statement.statement.rows.some((row) => !matchedRows.has(row.rowOrdinal));
  const keys = useRef(new Map<string, string>());
  const client = useQueryClient();
  const [inputError, setInputError] = useState("");
  const match = useMutation({
    mutationFn: (payload: typeof Bank.BankMatchInput.Type) => {
      const path = `${bookPath(book)}/bank-matches`;
      return readAccounting(
        path,
        Bank.BankMatchReceipt,
        mutationOptions(path, JSON.stringify(payload), keys.current),
      );
    },
    onSuccess: () => {
      void client.invalidateQueries({
        queryKey: [...bookKey(book), "bank-statement", statement.statement.id],
      });
      void client.invalidateQueries({ queryKey: [...bookKey(book), "bank-reconciliation"] });
    },
  });
  return (
    <Box
      as="form"
      display="grid"
      gap="lg"
      onSubmit={(event) => {
        event.preventDefault();
        const fields = new FormData(event.currentTarget);
        const decoded = Schema.decodeUnknownOption(Bank.BankMatchInput)({
          statementId: statement.statement.id,
          rowOrdinal: Number(fields.get("rowOrdinal")),
          voucherId: fields.get("voucherId"),
          lineId: fields.get("lineId"),
        });
        if (decoded._tag === "None") {
          setInputError(copy.bank_invalid);
          return;
        }
        setInputError("");
        match.mutate(decoded.value);
      }}
    >
      <Heading>{copy.bank_match}</Heading>
      <Text tone="muted">{copy.bank_match_help}</Text>
      <Text tone="muted">{copy.bank_match_rules}</Text>
      {!hasUnmatched ? <Text>{copy.bank_no_unmatched}</Text> : null}
      <Box
        as="fieldset"
        disabled={match.isPending || !hasUnmatched}
        borderWidth="none"
        padding="none"
        margin="none"
        minWidth="zero"
        display="grid"
        gap="lg"
      >
        <SelectField
          label={copy.bank_ordinal}
          name="rowOrdinal"
          required
          options={statement.statement.rows.map((row) => ({
            value: String(row.rowOrdinal),
            label: `${row.rowOrdinal} · ${row.date} · ${row.amountMinor} · ${row.description}`,
            disabled: matchedRows.has(row.rowOrdinal),
          }))}
        />
        <InputField
          label={copy.journal_voucher}
          name="voucherId"
          required
          pattern="[a-z][a-z0-9_\-]{2,127}"
        />
        <InputField
          label={copy.bank_line_id}
          name="lineId"
          required
          pattern="[a-z][a-z0-9_\-]{2,127}"
        />
        <Box>
          <Button type="submit" size="xl" variant="outline">
            {copy.bank_match}
          </Button>
        </Box>
      </Box>
      <Text role="status">{inputError}</Text>
      <AccountingStatus write locale={locale} pending={match.isPending} error={match.error} />
      {match.data ? (
        <Box role="status" display="grid" gap="sm">
          <Text>
            {copy.bank_matched}: {match.data.match.rowOrdinal} → {match.data.match.voucherId} /{" "}
            {match.data.match.lineId}
          </Text>
          <Text tone="muted">
            {copy.bank_receipt}: {match.data.receipt.key} · {match.data.receipt.actorId}
          </Text>
        </Box>
      ) : null}
    </Box>
  );
}
