import * as Automation from "@open-erp/contracts/automation";
import { Box } from "@open-erp/ui/components/box";
import { DataTable } from "@open-erp/ui/components/data-table";
import { Heading, Text } from "@open-erp/ui/components/typography";
import { accountingCopy } from "@/lib/accounting-copy";
import type { Locale } from "@/paraglide/runtime";

export function PreparationSelection({
  selection,
  locale,
}: {
  selection: typeof Automation.SimulationSelection.Type;
  locale: Locale;
}) {
  const copy = accountingCopy(locale);
  return (
    <Box display="grid" gap="lg" minWidth="zero">
      <Text>
        {copy.bank_interval}: {selection.startsOn} – {selection.endsOn}
      </Text>
      <Text tone="muted">
        {copy.bank_checkpoint}: {selection.sequence} / {selection.sourceRevision}
      </Text>
      <Text>
        {copy.auto_matching_count}: {selection.matchingCount} · {copy.auto_unmatched_count}:{" "}
        {selection.unmatchedCount} · {copy.auto_matched_count}: {selection.alreadyMatchedCount}
      </Text>
      <Text>
        {copy.auto_total}: {selection.totalMinor}
      </Text>
      <Heading>{copy.auto_conflicts}</Heading>
      {selection.overlappingRuleIds.length === 0 ? (
        <Text>{copy.auto_no_conflicts}</Text>
      ) : (
        selection.overlappingRuleIds.map((id) => <Text key={id}>{id}</Text>)
      )}
      <Heading>{copy.auto_blockers}</Heading>
      {selection.blockers.length === 0 ? (
        <Text>{copy.auto_no_blockers}</Text>
      ) : (
        selection.blockers.map((blocker) => <Text key={blocker}>{blocker}</Text>)
      )}
      <DataTable
        title={copy.auto_selection}
        narrow="stack"
        columns={[
          { id: "source", label: copy.bank_statement_id },
          { id: "ordinal", label: copy.bank_ordinal },
          { id: "evidence", label: copy.journal_evidence_refs },
          { id: "date", label: copy.journal_date },
          { id: "description", label: copy.journal_description },
          { id: "amount", label: copy.bank_amount, numeric: true },
          { id: "period", label: copy.auto_period_version },
        ]}
        rows={selection.rows.map((row) => ({
          id: `${row.statementId}/${row.rowOrdinal}`,
          cells: [
            row.statementId,
            String(row.rowOrdinal),
            row.evidenceId,
            row.date,
            row.description,
            row.amountMinor,
            `${row.accountingPeriodId ?? copy.bank_missing} / ${row.periodVersion ?? copy.bank_missing}`,
          ],
        }))}
      />
      {selection.rows.length === 0 ? <Text>{copy.bank_empty}</Text> : null}
    </Box>
  );
}
