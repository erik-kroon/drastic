import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import type * as Accounting from "@open-erp/contracts/accounting";
import * as Vat from "@open-erp/contracts/vat-returns";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { DataTable } from "@open-erp/ui/components/data-table";
import { Badge } from "@open-erp/ui/components/badge";
import { Disclosure } from "@open-erp/ui/components/disclosure";
import {
  RecordHeading,
  RecordSummary,
  RecordFact,
  RecordSection,
  RecordColumns,
} from "@open-erp/ui/components/record-layout";
import { PageCaption } from "@open-erp/ui/components/accounting-page";
import { bookKey, bookPath, readAccounting } from "@/lib/accounting-api";
import { formatMinorAmount } from "@/lib/workspace-api";
import { Heading, Text } from "@open-erp/ui/components/typography";
import { EvidenceInspector } from "@/components/evidence-inspector";
import type { Locale } from "@/paraglide/runtime";
import { vatCopy } from "./copy";
import { vatBlocker } from "./blockers";

type Common = { book: typeof Accounting.Book.Type; locale: Locale };
export function VatFactSummary({
  fact,
  book,
  locale,
  action,
}: Common & { fact: typeof Vat.VatFact.Type; action?: ReactNode }) {
  const copy = vatCopy(locale);
  const input = fact.input;
  const sv = locale === "sv";
  const basis = useQuery({
    queryKey: [...bookKey(book), "vat-returns", "basis"],
    queryFn: ({ signal }) =>
      readAccounting(`${bookPath(book)}/vat-returns/facts`, Vat.VatBasis, { signal }),
    retry: false,
  });
  const labels = {
    unknown: copy.unknown,
    registered: copy.registered,
    not_registered: copy.notRegistered,
    accrual: copy.accrual,
    cash: copy.cash,
    domestic_sale: copy.sale,
    domestic_purchase: copy.purchase,
    unsupported: copy.unsupported,
    confirmed: copy.confirmed,
  };
  const amount = (minor: string) =>
    basis.data
      ? `${formatMinorAmount(minor, basis.data.currencyScale, locale)} ${input.currency ?? ""}`
      : `${minor} ${sv ? "öre" : "minor units"}`;
  const evidence = [
    ...new Map(fact.evidenceRefs.map((reference) => [reference.evidenceId, reference])).values(),
  ];
  return (
    <Box display="grid" gap="md" minWidth="zero">
      <RecordHeading title={input.description} subtitle={input.sourceLocator} action={action} />
      <Box>
        <Badge variant="secondary">
          {input.recordClass === "synthetic" ? copy.synthetic : copy.actual}
        </Badge>
      </Box>
      <RecordSummary>
        <RecordFact label={sv ? "Totalt" : "Total"}>{amount(input.grossMinor)}</RecordFact>
        <RecordFact label={sv ? "Exkl. moms" : "Before VAT"}>{amount(input.netMinor)}</RecordFact>
        <RecordFact label={sv ? "Moms" : "VAT"}>{amount(input.vatMinor)}</RecordFact>
        <RecordFact label={copy.taxPointOn}>{input.taxPointOn ?? copy.unknown}</RecordFact>
      </RecordSummary>
      <RecordColumns>
        <RecordSection title={sv ? "Momsbedömning" : "VAT assessment"}>
          <DataTable
            title={copy.facts}
            narrow="stack"
            columns={[
              { id: "field", label: copy.facts },
              { id: "value", label: copy.state },
            ]}
            rows={(
              [
                "treatment",
                "registration",
                "method",
                "domesticEligibility",
                "fullDeduction",
              ] as const
            ).map((name) => ({
              id: name,
              cells: [copy[name], labels[input[name]] ?? input[name]],
            }))}
          />
          <Text>{input.reviewRationale}</Text>
        </RecordSection>
        <RecordSection title={sv ? "Datum och period" : "Dates and period"}>
          <DataTable
            title={sv ? "Datum" : "Dates"}
            narrow="stack"
            columns={[
              { id: "field", label: sv ? "Datum" : "Date" },
              { id: "value", label: copy.state },
            ]}
            rows={(["issuedOn", "receivedOn", "suppliedOn"] as const).map((name) => ({
              id: name,
              cells: [copy[name], input[name] ?? copy.unknown],
            }))}
          />
          <Text tone="muted">{input.dateBasis ?? copy.optional}</Text>
        </RecordSection>
      </RecordColumns>
      <Disclosure
        label={sv ? "Underlag och bokföringsreferenser" : "Evidence and ledger references"}
      >
        <Box display="grid" gap="lg" paddingBlock="lg">
          {evidence.map((reference) => (
            <EvidenceInspector
              key={reference.evidenceId}
              book={book}
              locale={locale}
              expanded
              compact
              reference={{ ...reference, locator: input.sourceLocator }}
            />
          ))}
          <PageCaption>
            {copy.sourceKey}: {input.sourceKey} · {copy.voucherId}:{" "}
            {input.voucherId ?? copy.unknown}
          </PageCaption>
        </Box>
      </Disclosure>
    </Box>
  );
}
export function VatDraftView({
  draft,
  basisCurrent,
  book,
  locale,
}: Common & { draft: typeof Vat.VatDraft.Type; basisCurrent: boolean }) {
  const copy = vatCopy(locale);
  const boxes = draft.calculation.syntheticBoxes;
  const sv = locale === "sv";
  const [selectedFact, setSelectedFact] = useState<string | null>(null);
  return (
    <Box display="grid" gap="lg" minWidth="zero">
      <RecordHeading
        title={`${draft.input.startsOn} – ${draft.input.endsOn}`}
        subtitle={draft.input.mode === "actual_review" ? copy.actual : copy.synthetic}
        action={
          <Button
            variant="outline"
            onClick={() => {
              const url = URL.createObjectURL(
                new Blob([JSON.stringify(draft, null, 2)], { type: "application/json" }),
              );
              const link = document.createElement("a");
              link.href = url;
              link.download = `${draft.id}.json`;
              link.click();
              URL.revokeObjectURL(url);
            }}
          >
            {copy.download}
          </Button>
        }
      />
      <Box>
        <Badge variant={basisCurrent ? "secondary" : "warning"}>
          {basisCurrent
            ? sv
              ? "Aktuellt underlag"
              : "Current basis"
            : sv
              ? "Behöver uppdateras"
              : "Needs updating"}
        </Badge>
      </Box>
      {!basisCurrent ? <PageCaption>{copy.stale}</PageCaption> : null}
      <RecordSummary>
        <RecordFact label={sv ? "Momsunderlag" : "Source records"}>
          {draft.basis.facts.length}
        </RecordFact>
        <RecordFact label={copy.blockers}>{draft.calculation.blockers.length}</RecordFact>
        <RecordFact label={sv ? "Sparat" : "Saved"}>
          {new Date(draft.recordedAt).toLocaleDateString(locale)}
        </RecordFact>
      </RecordSummary>
      <PageCaption>{copy.boundary}</PageCaption>

      <RecordColumns>
        <RecordSection title={copy.boxes}>
          {boxes ? (
            <DataTable
              title={copy.boxes}
              narrow="stack"
              columns={[
                { id: "box", label: copy.box },
                { id: "exact", label: copy.exact, numeric: true },
                { id: "reported", label: copy.reported, numeric: true },
                { id: "residual", label: copy.residual, numeric: true },
              ]}
              rows={(["box05", "box10", "box48", "box49"] as const).map((id) => ({
                id,
                cells: [
                  id.slice(3),
                  boxes[id]?.exactMinor ?? copy.unavailable,
                  boxes[id]?.reportedKrona ?? copy.unavailable,
                  boxes[id]?.residualMinor ?? copy.unavailable,
                ],
              }))}
            />
          ) : (
            <Text>{copy.actualBlocked}</Text>
          )}
        </RecordSection>
        <RecordSection title={copy.blockers}>
          <Box as="ul" display="grid" gap="sm">
            {draft.calculation.blockers.map((code) => (
              <Box as="li" key={code}>
                <Text>{vatBlocker(code, locale)}</Text>
              </Box>
            ))}
          </Box>
        </RecordSection>
      </RecordColumns>
      <Heading>{copy.contributions}</Heading>
      <DataTable
        title={copy.contributions}
        narrow="stack"
        columns={[
          { id: "description", label: copy.description },
          { id: "status", label: copy.state },
          { id: "amount", label: sv ? "Moms" : "VAT", numeric: true },
        ]}
        rows={draft.basis.facts.map(({ fact }) => ({
          id: fact.factId,
          cells: [
            <Button
              key="open"
              variant="ghost"
              onClick={() => setSelectedFact(selectedFact === fact.factId ? null : fact.factId)}
            >
              {fact.input.description}
            </Button>,
            draft.calculation.assessments.find((row) => row.factId === fact.factId)?.state ===
            "included_synthetic"
              ? copy.included
              : copy.excluded,
            `${formatMinorAmount(fact.input.vatMinor, draft.basis.currencyScale, locale)} ${fact.input.currency ?? ""}`,
          ],
        }))}
      />
      {draft.basis.facts
        .filter((observation) => observation.fact.factId === selectedFact)
        .map((observation) => {
          const assessment = draft.calculation.assessments.find(
            (row) => row.factId === observation.fact.factId,
          );
          return (
            <RecordSection key={observation.fact.factId} title={copy.facts}>
              <Box display="grid" gap="md" paddingBlock="lg" minWidth="zero">
                <VatFactSummary book={book} locale={locale} fact={observation.fact} />
                {assessment ? (
                  <>
                    <Text>
                      {copy.sourceDifference}: {assessment.sourceDifferenceMinor}
                    </Text>
                    <Text>
                      {copy.rateDifference}: {assessment.rateDifferenceNumerator}
                    </Text>
                    <Text>
                      {copy.ledgerDifference}:{" "}
                      {assessment.ledgerDifferenceMinor ?? copy.unavailable}
                    </Text>
                    <Box as="ul" display="grid" gap="sm">
                      {assessment.blockers.map((code) => (
                        <Box as="li" key={code}>
                          <Text>{vatBlocker(code, locale)}</Text>
                        </Box>
                      ))}
                    </Box>
                    {assessment.contribution ? (
                      <DataTable
                        title={copy.contributions}
                        narrow="stack"
                        columns={[
                          { id: "box", label: copy.box },
                          { id: "amount", label: copy.exact, numeric: true },
                        ]}
                        rows={[
                          { id: "05", cells: ["05", assessment.contribution.box05Minor] },
                          { id: "10", cells: ["10", assessment.contribution.box10Minor] },
                          { id: "48", cells: ["48", assessment.contribution.box48Minor] },
                        ]}
                      />
                    ) : null}
                  </>
                ) : (
                  <Text>{copy.unavailable}</Text>
                )}
                <DataTable
                  title={copy.ledger}
                  narrow="stack"
                  columns={[
                    { id: "line", label: copy.taxLineIds },
                    { id: "amount", label: copy.exact },
                  ]}
                  rows={observation.taxLines.map((line) => ({
                    id: line.id,
                    cells: [
                      `${line.id} · ${line.accountId}`,
                      `${line.debitMinor} / ${line.creditMinor}`,
                    ],
                  }))}
                />
              </Box>
            </RecordSection>
          );
        })}
      <Disclosure label={sv ? "Sparat beräkningsunderlag" : "Saved calculation basis"}>
        <Box display="grid" gap="sm" paddingBlock="md">
          <PageCaption>
            {draft.id} · {draft.recordedAt}
          </PageCaption>
          <PageCaption>
            {copy.sequence}: {draft.basis.bookSequence}
          </PageCaption>
          <PageCaption>
            {copy.digest}: {draft.basis.digest}
          </PageCaption>
        </Box>
      </Disclosure>
    </Box>
  );
}
