import type * as Accounting from "@open-erp/contracts/accounting";
import type * as Vat from "@open-erp/contracts/vat-returns";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { DataTable } from "@open-erp/ui/components/data-table";
import { Heading, Text } from "@open-erp/ui/components/typography";
import { EvidenceInspector } from "@/components/evidence-inspector";
import type { Locale } from "@/paraglide/runtime";
import { vatCopy } from "./copy";
import { vatBlocker } from "./blockers";

type Common = { book: typeof Accounting.Book.Type; locale: Locale };
export function VatFactSummary({ fact, book, locale }: Common & { fact: typeof Vat.VatFact.Type }) {
  const copy = vatCopy(locale);
  const input = fact.input;
  const fields = [
    "sourceKey",
    "sourceLocator",
    "netMinor",
    "vatMinor",
    "grossMinor",
    "currency",
    "issuedOn",
    "receivedOn",
    "suppliedOn",
    "taxPointOn",
    "dateBasis",
    "reviewRationale",
    "registration",
    "method",
    "treatment",
    "domesticEligibility",
    "fullDeduction",
    "voucherId",
  ] as const;
  const evidence = [
    ...new Map(fact.evidenceRefs.map((reference) => [reference.evidenceId, reference])).values(),
  ];
  return (
    <Box display="grid" gap="md" minWidth="zero">
      <Text>{input.recordClass === "synthetic" ? copy.synthetic : copy.actual}</Text>
      <DataTable
        title={input.description}
        narrow="stack"
        columns={[
          { id: "field", label: copy.facts },
          { id: "value", label: copy.state },
        ]}
        rows={fields.map((name) => ({
          id: name,
          cells: [copy[name], input[name] ?? copy.unknown],
        }))}
      />
      <details>
        <summary>{copy.evidenceId}</summary>
        <Box display="grid" gap="md" paddingBlock="lg" minWidth="zero">
          {evidence.map((reference) => (
            <EvidenceInspector
              key={reference.evidenceId}
              book={book}
              locale={locale}
              reference={{ ...reference, locator: input.sourceLocator }}
            />
          ))}
        </Box>
      </details>
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
  return (
    <Box display="grid" gap="lg" minWidth="zero">
      <Heading>{copy.drafts}</Heading>
      <Text>
        {draft.id} · {draft.recordedAt}
      </Text>
      <Text>
        {draft.input.mode === "actual_review" ? copy.actual : copy.synthetic} ·{" "}
        {draft.input.startsOn} – {draft.input.endsOn}
      </Text>
      <Text>{basisCurrent ? copy.current : copy.stale}</Text>
      <Text>
        {copy.sequence}: {draft.basis.bookSequence}
      </Text>
      <Text>
        {copy.digest}: {draft.basis.digest}
      </Text>
      <Text>{copy.boundary}</Text>
      <Box>
        <Button
          size="xl"
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
      </Box>
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
      <Heading>{copy.blockers}</Heading>
      <Box as="ul" display="grid" gap="sm">
        {draft.calculation.blockers.map((code) => (
          <Box as="li" key={code}>
            <Text>{vatBlocker(code, locale)}</Text>
          </Box>
        ))}
      </Box>
      <Heading>{copy.contributions}</Heading>
      {draft.basis.facts.map((observation) => {
        const assessment = draft.calculation.assessments.find(
          (row) => row.factId === observation.fact.factId,
        );
        return (
          <details key={observation.fact.factId}>
            <summary>
              {observation.fact.input.description} ·{" "}
              {assessment?.state === "included_synthetic" ? copy.included : copy.excluded}
            </summary>
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
                    {copy.ledgerDifference}: {assessment.ledgerDifferenceMinor ?? copy.unavailable}
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
          </details>
        );
      })}
    </Box>
  );
}
