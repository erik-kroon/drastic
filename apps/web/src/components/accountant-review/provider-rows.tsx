import * as Review from "@open-erp/contracts/accountant-review";
import { Box } from "@open-erp/ui/components/box";
import { DataTable } from "@open-erp/ui/components/data-table";
import { Heading, Text } from "@open-erp/ui/components/typography";
import type { Locale } from "@/paraglide/runtime";
import { reviewCopy } from "./copy";

export function ReviewProviderRows({
  items,
  section,
  locale,
}: {
  items: ReadonlyArray<typeof Review.ReviewRow.Type>;
  section: typeof Review.ReviewSection.Type;
  locale: Locale;
}) {
  const copy = reviewCopy(locale);

  if (!["owner_sources", "owner_controls", "expense_tax"].includes(section)) return null;

  return (
    <Box display="grid" gap="lg" minWidth="zero">
      <Text>{copy.providerWarning}</Text>
      {section === "owner_sources"
        ? items
            .filter((row) => row.section === "owner_sources")
            .map((row) => (
              <Box
                key={row.source.id}
                display="grid"
                gap="md"
                padding="lg"
                borderWidth="thin"
                borderColor="default"
                borderRadius="surface"
                minWidth="zero"
              >
                <Heading>
                  {row.source.ownerName} · {row.source.sourceKey}
                </Heading>
                <Text>
                  {row.source.id} · {row.source.occurredOn} · {row.source.dataNature}
                </Text>
                <Text>
                  {row.revision.classification} / {row.revision.origin} · {copy.reviewState}:{" "}
                  {row.review?.id ?? copy.unknownValue}
                </Text>
                <Text>
                  {copy.originalAmount}: {row.source.amountMinor} {row.source.currency} ·{" "}
                  {copy.scale} {row.source.currencyScale}
                </Text>
                {row.disposition === "excluded_after_end" ? <Text>{copy.outsideOwner}</Text> : null}
                <Text>
                  {copy.refs}: {row.source.evidence.evidenceId}
                </Text>
                <details>
                  <summary>{copy.inspect}</summary>
                  <Box display="grid" minWidth="zero">
                    <textarea
                      aria-label={`${copy.owner_sources}: ${row.source.id}`}
                      readOnly
                      value={JSON.stringify(row, null, 2)}
                      rows={14}
                      cols={16}
                    />
                  </Box>
                </details>
              </Box>
            ))
        : null}
      {section === "owner_controls"
        ? items
            .filter((row) => row.section === "owner_controls")
            .map((row) => (
              <Box key={row.owner.id} display="grid" gap="lg" minWidth="zero">
                <Heading>
                  {row.owner.displayName} · {row.owner.id}
                </Heading>
                <Text>{copy.openingStatus}</Text>
                <Text>
                  {row.startsOn} – {row.endsOn} · {row.currency} · {copy.scale} {row.currencyScale}
                </Text>
                <Text>
                  {copy.unresolvedOwner}: {row.unlinkedRecordCount}
                </Text>
                <DataTable
                  title={copy.ownerBalance}
                  narrow="stack"
                  columns={[
                    { id: "account", label: copy.account },
                    { id: "registered", label: "recordedNetCreditMinor" },
                    { id: "expense", label: "openExpenseMinor" },
                    { id: "loan", label: "openLoanMinor" },
                    { id: "conditional", label: "conditionalContributionMinor" },
                    { id: "unconditional", label: "unconditionalContributionMinor" },
                  ]}
                  rows={row.ownerBalances.map((balance) => ({
                    id: balance.accountId,
                    cells: [
                      balance.accountId,
                      balance.recordedNetCreditMinor,
                      balance.openExpenseMinor,
                      balance.openLoanMinor,
                      balance.conditionalContributionMinor,
                      balance.unconditionalContributionMinor,
                    ],
                  }))}
                />
                <DataTable
                  title={copy.controlDifference}
                  narrow="stack"
                  columns={[
                    { id: "account", label: copy.account },
                    { id: "registered", label: "allOwnersRegisteredMinor" },
                    { id: "ledger", label: "ledgerCreditBalanceMinor" },
                    { id: "difference", label: "unexplainedMinor" },
                  ]}
                  rows={row.accountControls.map((control) => ({
                    id: control.accountId,
                    cells: [
                      control.accountId,
                      control.allOwnersRegisteredMinor,
                      control.ledgerCreditBalanceMinor,
                      control.unexplainedMinor,
                    ],
                  }))}
                />
                <Box as="ul" display="grid" gap="sm">
                  {row.blockers.map((blocker) => (
                    <Box as="li" key={blocker}>
                      {blocker}
                    </Box>
                  ))}
                </Box>
                <details>
                  <summary>{copy.inspect}</summary>
                  <Box display="grid" minWidth="zero">
                    <textarea
                      aria-label={`${copy.owner_controls}: ${row.owner.id}`}
                      readOnly
                      value={JSON.stringify(row, null, 2)}
                      rows={14}
                      cols={16}
                    />
                  </Box>
                </details>
              </Box>
            ))
        : null}
      {section === "expense_tax"
        ? items
            .filter((row) => row.section === "expense_tax")
            .map((row) => (
              <Box
                key={row.source.sourceId}
                display="grid"
                gap="md"
                padding="lg"
                borderWidth="thin"
                borderColor="default"
                borderRadius="surface"
                minWidth="zero"
              >
                <Heading>{row.source.sourceKey}</Heading>
                <Text>
                  {row.source.sourceId} · {row.source.facts.recordClass}
                </Text>
                <Text>{row.source.facts.description}</Text>
                <Text>
                  {copy.refs}: {row.source.facts.evidenceId}
                </Text>
                <Text>
                  {copy.reviewState}: {row.review?.id ?? copy.unknownValue} · {row.assessmentMode}
                </Text>
                <DataTable
                  title={copy.expense_tax}
                  narrow="stack"
                  columns={[
                    { id: "control", label: copy.code },
                    { id: "value", label: copy.detail },
                  ]}
                  rows={[
                    {
                      id: "source",
                      cells: [
                        copy.originalAmount,
                        row.source.facts.amounts.grossMinor ?? copy.unknownValue,
                      ],
                    },
                    {
                      id: "gross",
                      cells: [
                        copy.grossDifference,
                        row.assessment.controls.grossDifferenceMinor ?? copy.unknownValue,
                      ],
                    },
                    {
                      id: "net",
                      cells: [
                        copy.netDifference,
                        row.assessment.controls.netDifferenceMinor ?? copy.unknownValue,
                      ],
                    },
                    {
                      id: "vat",
                      cells: [
                        copy.vatDifference,
                        row.assessment.controls.vatDifferenceMinor ?? copy.unknownValue,
                      ],
                    },
                  ]}
                />
                <Text>{copy.exclusionReasons}</Text>
                <Box as="ul" display="grid" gap="sm">
                  {row.assessment.blockers.map((blocker) => (
                    <Box as="li" key={blocker}>
                      {blocker}
                    </Box>
                  ))}
                </Box>
                <details>
                  <summary>{copy.inspect}</summary>
                  <Box display="grid" minWidth="zero">
                    <textarea
                      aria-label={`${copy.expense_tax}: ${row.source.sourceId}`}
                      readOnly
                      value={JSON.stringify(row, null, 2)}
                      rows={14}
                      cols={16}
                    />
                  </Box>
                </details>
              </Box>
            ))
        : null}
    </Box>
  );
}
