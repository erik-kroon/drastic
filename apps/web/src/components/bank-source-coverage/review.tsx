import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import * as Schema from "effect/Schema";
import type * as Accounting from "@open-erp/contracts/accounting";
import * as Coverage from "@open-erp/contracts/bank-source-coverage";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { DataTable } from "@open-erp/ui/components/data-table";
import { InputField } from "@open-erp/ui/components/field";
import { Heading, Text } from "@open-erp/ui/components/typography";
import { AccountingStatus } from "@/components/accounting-status";
import { bookKey, bookPath, readAccounting } from "@/lib/accounting-api";
import type { Locale } from "@/paraglide/runtime";
import { sourceCoverageCopy } from "./copy";

export function BankSourceCoverageInspector({ book, locale, id }: {
  book: typeof Accounting.Book.Type; locale: Locale; id: string;
}) {
  const copy = sourceCoverageCopy(locale);
  const saved = useQuery({
    queryKey: [...bookKey(book), "bank-source-coverage", id],
    queryFn: async ({ signal }) => {
      const value = await readAccounting(`${bookPath(book)}/bank-source-coverage/${encodeURIComponent(id)}`, Coverage.BankSourceCoverageView, { signal });
      const bytes = new TextEncoder().encode(value.artifact.content);
      const sha256 = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
      const retained = Schema.decodeUnknownSync(Coverage.BankSourceCoverageReport)(JSON.parse(value.artifact.content));
      if (value.report.scope.bookId !== book.id || value.report.scope.entityId !== book.entityId || value.report.id !== id
        || retained.scope.bookId !== book.id || retained.scope.entityId !== book.entityId || retained.id !== id
        || retained.digest !== value.report.digest || bytes.length !== value.artifact.byteLength || sha256 !== value.artifact.sha256) {
        throw new Error(copy.artifactError);
      }
      return { ...value, report: retained };
    }, retry: false,
  });
  return <Box display="grid" gap="lg" minWidth="zero">
    <Heading>{copy.reportId}: {id}</Heading>
    <Box><Button type="button" variant="outline" disabled={saved.isFetching} onClick={() => { void saved.refetch(); }}>{copy.refresh}</Button></Box>
    <AccountingStatus locale={locale} pending={saved.isFetching} error={saved.error} />
    {saved.data ? <Contents value={saved.data} locale={locale}
      currentnessKnown={saved.isSuccess && saved.fetchStatus === "idle" && saved.isFetchedAfterMount} /> : null}
  </Box>;
}
function Contents({ value, locale, currentnessKnown }: {
  value: typeof Coverage.BankSourceCoverageView.Type; locale: Locale; currentnessKnown: boolean;
}) {
  const copy = sourceCoverageCopy(locale);
  const report = value.report;
  return <Box display="grid" gap="lg" minWidth="zero">
    <Text role="status">{currentnessKnown ? value.dependenciesCurrent ? copy.current : copy.historical : copy.currentnessUnknown}</Text>
    <Text>{report.hasReviewGaps ? copy.gaps : copy.noGaps}</Text><Text>{copy.warning}</Text>
    <Text>{report.input.startsOn} — {report.input.endsOn} · {copy.sequence}: {report.sequence}</Text>
    <Text>{copy.currency}: {report.currency} / {report.currencyScale} · {copy.units}</Text>
    <InputField label={copy.digest} value={report.digest} readOnly />
    <Text>{copy.inventory}: {report.inventory.id} · {copy.evidence}: {report.inventory.evidenceId}</Text>
    <Text>{report.inventory.declaredAt} · {report.inventory.actorId}</Text>
    {report.diagnostics.map((diagnostic) => <Text key={diagnostic}>{copy.diagnostics[diagnostic]}</Text>)}
    <Text>{copy.downloadWarning}</Text>
    <Box><Button type="button" variant="outline" onClick={() => {
      const url = URL.createObjectURL(new Blob([value.artifact.content], { type: value.artifact.mediaType }));
      const link = document.createElement("a"); link.href = url; link.download = `${report.id}.json`;
      document.body.append(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 0);
    }}>{copy.download}</Button></Box>
    <Heading>{copy.accounts}: {report.accounts.length}</Heading>
    <Text>{copy.adjacency}</Text>
    {report.accounts.map((account) => <AccountReview key={account.accountId} account={account} locale={locale} />)}
  </Box>;
}
function AccountReview({ account, locale }: { account: typeof Coverage.BankCoverageAccount.Type; locale: Locale }) {
  const copy = sourceCoverageCopy(locale);
  return <details><summary>{account.code} · {account.name} · {account.hasReviewGaps ? copy.gaps : copy.noGaps}</summary>
    <Box display="grid" gap="lg" paddingBlock="lg" minWidth="zero">
      <Text>{account.accountId} · {account.declared ? copy.declared : copy.notDeclared}</Text>
      <Text>{copy.accountVersion}: {account.accountVersion} · {copy.sourceRevision}: {account.sourceRevision ?? copy.missing}</Text>
      <Text>{copy.mappedSource}: {account.sourceBankAccountId ?? copy.missing}</Text>
      <Text>{copy.opening}: {account.openingMinor ?? copy.missing} · {copy.closing}: {account.closingMinor ?? copy.missing}</Text>
      {account.diagnostics.map((diagnostic) => <Text key={diagnostic}>{copy.diagnostics[diagnostic]}</Text>)}
      {account.gaps.length > 0 ? <Box display="grid" gap="sm">
        <Heading>{copy.intervalGaps}</Heading>
        {account.gaps.map((gap) => <Text key={`${gap.startsOn}:${gap.endsOn}`}>{gap.startsOn} — {gap.endsOn}</Text>)}
      </Box> : null}
      {account.overlaps.length > 0 ? <Box display="grid" gap="sm">
        <Heading>{copy.overlaps}</Heading>
        {account.overlaps.map((overlap) => <Text key={`${overlap.leftStatementId}:${overlap.rightStatementId}`}>
          {overlap.leftStatementId} / {overlap.rightStatementId}: {overlap.startsOn} — {overlap.endsOn}
        </Text>)}
      </Box> : null}
      <Heading>{copy.adjacent}</Heading>
      {account.adjacentBalances.length === 0 ? <Text>{copy.noPairs}</Text> : null}
      {account.adjacentBalances.map((pair) => <Box key={`${pair.leftStatementId}:${pair.rightStatementId}`} display="grid" gap="sm">
        <Text>{copy.left}: {pair.leftStatementId} · {copy.closing}: {pair.leftClosingMinor}</Text>
        <Text>{copy.right}: {pair.rightStatementId} · {copy.opening}: {pair.rightOpeningMinor}</Text>
        <Text>{copy.difference}: {pair.differenceMinor}</Text>
      </Box>)}
      <Heading>{copy.statements}: {account.statements.length}</Heading>
      {account.statements.map((item) => <StatementReview key={item.statement.id} item={item} locale={locale} />)}
    </Box>
  </details>;
}
function StatementReview({ item, locale }: { item: typeof Coverage.BankCoverageStatement.Type; locale: Locale }) {
  const copy = sourceCoverageCopy(locale);
  const [showRows, setShowRows] = useState(false);
  const statement = item.statement;
  return <details><summary>{statement.startsOn} — {statement.endsOn} · {statement.statementIdentifier}</summary>
    <Box display="grid" gap="md" paddingBlock="lg" minWidth="zero">
      <Text>{statement.id} · {copy.evidence}: {statement.evidenceId}</Text>
      <Text>{copy.opening}: {statement.openingMinor} · {copy.closing}: {statement.closingMinor}</Text>
      <Text>{copy.movement}: {item.movementMinor} · {copy.movementDifference}: {item.movementDifferenceMinor}</Text>
      <Text>{copy.rowCount}: {item.observedRowCount}</Text>
      <Text>{copy.basis}: {statement.completeness.basis}</Text>
      {item.diagnostics.map((diagnostic) => <Text key={diagnostic}>{copy.diagnostics[diagnostic]}</Text>)}
      <details onToggle={(event) => setShowRows(event.currentTarget.open)}><summary>{copy.rows}: {statement.rows.length}</summary>
        {showRows ? <Box paddingBlock="md" minWidth="zero"><DataTable title={copy.rows} narrow="stack" columns={[
          { id: "row", label: copy.row }, { id: "date", label: copy.date }, { id: "description", label: copy.description },
          { id: "amount", label: copy.amount, numeric: true }, { id: "provider", label: copy.provider },
        ]} rows={statement.rows.map((row) => ({ id: String(row.rowOrdinal), cells: [
          row.rowOrdinal, row.date, row.description, row.amountMinor, row.providerId ?? copy.missing,
        ] }))} /></Box> : null}
      </details>
    </Box>
  </details>;
}
