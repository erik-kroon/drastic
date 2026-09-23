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
import { PageAction } from "@open-erp/ui/components/accounting-page";
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
  const candidateLabel = locale === "sv" ? "Visa matchningsförslag" : "Show matching candidates";
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
      <Heading>{copy.bank_statement}</Heading>
      <Box>
        <Button
          size="xl"
          variant="outline"
          disabled={statement.isFetching}
          onClick={() => {
            void statement.refetch();
          }}
        >
          {copy.journal_refresh}
        </Button>
      </Box>
      <AccountingStatus locale={locale} pending={statement.isPending} error={statement.error} />
      {statement.data ? (
        <>
          <BankStatementDetails book={book} statement={statement.data.statement} locale={locale} />
          <Text tone="muted">
            {copy.bank_checkpoint}: {statement.data.checkpoint.sequence} /{" "}
            {statement.data.checkpoint.sourceRevision}
          </Text>
          <DataTable
            title={copy.bank_rows}
            narrow="stack"
            columns={[
              { id: "ordinal", label: copy.bank_ordinal },
              { id: "provider", label: copy.bank_provider_id },
              { id: "date", label: copy.journal_date },
              { id: "description", label: copy.journal_description },
              { id: "amount", label: copy.bank_amount, numeric: true },
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
                  variant="outline"
                  onClick={() => setCandidateRow(row.rowOrdinal)}
                >
                  {candidateLabel} · {row.rowOrdinal}
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
          <PageAction href={`${workspacePath(book)}/accounts?view=matching`}>
            {locale === "sv"
              ? "Öppna granskad matchning och återföring"
              : "Open reviewed matching and unmatch"}
          </PageAction>
          <BankMatches matches={statement.data.matches} locale={locale} />
          <BankMatchForm book={book} statement={statement.data} locale={locale} />
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
  const amount = (value: string) =>
    metadata.data ? formatMinorAmount(value, metadata.data.currencyScale, locale) : "—";
  return (
    <Box display="grid" gap="md" minWidth="zero">
      <Text>
        {copy.bank_statement_id}: {statement.id} · {statement.statementIdentifier}
      </Text>
      <Text>
        {copy.bank_source_account}: {statement.sourceBankAccountId} · {copy.journal_account}:{" "}
        {statement.accountId} · {statement.currency}
      </Text>
      <Text>
        {copy.bank_interval}: {statement.startsOn} – {statement.endsOn}
      </Text>
      <Text>
        {copy.bank_opening}: {amount(statement.openingMinor)} · {copy.bank_closing}:{" "}
        {amount(statement.closingMinor)}
      </Text>
      <Text>
        {statement.completeness.declaredComplete ? copy.bank_declared : copy.bank_not_declared}
      </Text>
      <Text>
        {copy.bank_basis}: {statement.completeness.basis}
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
