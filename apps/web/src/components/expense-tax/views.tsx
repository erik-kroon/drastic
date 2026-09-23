import type * as Accounting from "@open-erp/contracts/accounting";
import type * as Tax from "@open-erp/contracts/expense-tax";
import { Box } from "@open-erp/ui/components/box";
import { DataTable } from "@open-erp/ui/components/data-table";
import { Text } from "@open-erp/ui/components/typography";
import { EvidenceInspector } from "@/components/evidence-inspector";
import type { Locale } from "@/paraglide/runtime";
import { formatMinorAmount } from "@/lib/workspace-api";
import { expenseTaxCopy } from "./copy";
import { expenseTaxBlockers } from "./blockers";

export function TaxFactsTable({
  facts,
  locale,
}: {
  facts: typeof Tax.TaxSourceFacts.Type | typeof Tax.TaxReviewFacts.Type;
  locale: Locale;
}) {
  const copy = expenseTaxCopy(locale);
  const sv = locale === "sv";
  const scale = "currencyScale" in facts ? facts.currencyScale : null;
  const currency = "currency" in facts ? facts.currency : "";
  const amount = (value: string | null) =>
    value !== null && scale !== null
      ? `${formatMinorAmount(value, scale, locale)} ${currency ?? ""}`
      : copy.unknown;
  const labels = new Map(
    Object.entries({
      ...copy,
      recordClass: copy.sourceClass,
      supplierJurisdiction: sv ? "Leverantörsland" : "Supplier country",
      supplyJurisdiction: sv ? "Leveransland" : "Supply country",
      receivedOn: sv ? "Mottaget" : "Received",
    }),
  );
  const visible =
    "recordClass" in facts
      ? ["supplierJurisdiction", "supplyJurisdiction", "receivedOn", "suppliedOn", "taxPointOn"]
      : [
          "rationale",
          "registration",
          "method",
          "treatment",
          "suppliedOn",
          "taxPointOn",
          "deductionBasis",
        ];
  return (
    <Box display="grid" gap="lg">
      <DataTable
        title={copy.title}
        narrow="stack"
        columns={[
          { id: "name", label: copy.description },
          { id: "value", label: copy.value },
        ]}
        rows={[
          ...(scale !== null
            ? [
                { id: "gross", cells: [sv ? "Totalt" : "Total", amount(facts.amounts.grossMinor)] },
                {
                  id: "net",
                  cells: [sv ? "Exkl. moms" : "Before tax", amount(facts.amounts.netMinor)],
                },
                { id: "vat", cells: [sv ? "Moms" : "Tax", amount(facts.amounts.vatMinor)] },
              ]
            : []),
          ...Object.entries(facts)
            .filter(([name]) => visible.includes(name))
            .map(([name, value]) => ({
              id: name,
              cells: [
                labels.get(name) ?? name,
                value === null
                  ? copy.unknown
                  : typeof value === "string"
                    ? value.replaceAll("_", " ")
                    : JSON.stringify(value),
              ],
            })),
        ]}
      />
      <details>
        <summary>{sv ? "Tekniska uppgifter" : "Technical details"}</summary>
        <Box paddingBlock="md">
          <pre>{JSON.stringify(facts, null, 2)}</pre>
        </Box>
      </details>
    </Box>
  );
}

export function TaxSnapshotEntry(props: {
  entry: (typeof Tax.TaxSnapshot.Type)["entries"][number];
  book: typeof Accounting.Book.Type;
  locale: Locale;
}) {
  const { entry, book, locale } = props;
  const copy = expenseTaxCopy(locale);
  const reasons = expenseTaxBlockers(locale);
  const controls = entry.assessment.controls;
  const controlNames = [
    "sourceBalanceDifferenceMinor",
    "reviewBalanceDifferenceMinor",
    "grossDifferenceMinor",
    "netDifferenceMinor",
    "vatDifferenceMinor",
    "calculatedVatDifferenceMinor",
  ] as const;
  const calculation = entry.assessment.calculation;
  return (
    <details>
      <summary>
        {entry.source.sourceKey} · {entry.source.facts.description} ·{" "}
        {entry.assessment.state === "included_synthetic" ? copy.synthetic : copy.excluded}
      </summary>
      <Box display="grid" gap="lg" paddingBlock="lg" minWidth="zero">
        <Text>{entry.source.digest}</Text>
        <Text>{entry.review?.digest ?? copy.staleReview}</Text>
        {entry.assessment.blockers.length > 0 ? (
          <Box display="grid" gap="sm">
            <Text>{copy.excludedReasons}</Text>
            {entry.assessment.blockers.map((reason) => (
              <Text key={reason}>{reasons[reason]}</Text>
            ))}
          </Box>
        ) : null}
        <DataTable
          title={copy.controls}
          narrow="stack"
          columns={[
            { id: "kind", label: copy.amountColumn },
            { id: "source", label: copy.sourceColumn, numeric: true },
            { id: "review", label: copy.reviewColumn, numeric: true },
            { id: "calculated", label: copy.calculatedColumn, numeric: true },
          ]}
          rows={[
            {
              id: "gross",
              cells: [
                copy.gross,
                entry.source.facts.amounts.grossMinor ?? copy.unknown,
                entry.review?.facts.amounts.grossMinor ?? copy.unknown,
                entry.assessment.contribution?.grossMinor ?? copy.unknown,
              ],
            },
            {
              id: "net",
              cells: [
                copy.net,
                entry.source.facts.amounts.netMinor ?? copy.unknown,
                entry.review?.facts.amounts.netMinor ?? copy.unknown,
                entry.assessment.contribution?.netMinor ?? copy.unknown,
              ],
            },
            {
              id: "vat",
              cells: [
                copy.vat,
                entry.source.facts.amounts.vatMinor ?? copy.unknown,
                entry.review?.facts.amounts.vatMinor ?? copy.unknown,
                calculation?.calculatedVatMinor ?? copy.unknown,
              ],
            },
          ]}
        />
        <DataTable
          title={copy.difference}
          narrow="stack"
          columns={[
            { id: "control", label: copy.controls },
            { id: "difference", label: copy.difference, numeric: true },
          ]}
          rows={controlNames.map((name) => ({
            id: name,
            cells: [copy[name], controls[name] ?? copy.unknown],
          }))}
        />
        {calculation ? (
          <Box display="grid" gap="sm">
            <Text>{copy.calculation}</Text>
            <Text>
              {calculation.taxProductNumerator} / {calculation.rateDenominator} · {copy.remainder}:{" "}
              {calculation.taxRemainder}
            </Text>
            {calculation.deductionProductNumerator !== null ? (
              <Text>
                {calculation.deductionProductNumerator} / {calculation.deductionDenominator} ·{" "}
                {copy.remainder}: {calculation.deductionRemainder}
              </Text>
            ) : null}
            <Text>
              {copy.deductible}: {calculation.deductibleMinor ?? copy.unknown}
            </Text>
            <Text>
              {copy.nonDeductible}: {calculation.nonDeductibleMinor ?? copy.unknown}
            </Text>
            <Text>
              {copy.expense}: {calculation.expenseMinor ?? copy.unknown}
            </Text>
          </Box>
        ) : null}
        <EvidenceInspector
          book={book}
          locale={locale}
          reference={{
            evidenceId: entry.source.facts.evidenceId,
            sha256: entry.source.evidenceSha256,
            locator: entry.source.facts.sourceLocator,
          }}
        />
        <details>
          <summary>{copy.sourceTitle}</summary>
          <TaxFactsTable facts={entry.source.facts} locale={locale} />
        </details>
        {entry.review ? (
          <details>
            <summary>{copy.reviewTitle}</summary>
            <Box display="grid" gap="md" paddingBlock="lg" minWidth="zero">
              <Text>
                {copy.reviewedBy}: {entry.review.receipt.actorId} · {entry.review.recordedAt}
              </Text>
              <TaxFactsTable facts={entry.review.facts} locale={locale} />
              {entry.review.evidenceRefs.map((ref) => (
                <EvidenceInspector
                  key={ref.evidenceId}
                  book={book}
                  locale={locale}
                  reference={{ ...ref, locator: entry.review?.id ?? "" }}
                />
              ))}
            </Box>
          </details>
        ) : null}
      </Box>
    </details>
  );
}
