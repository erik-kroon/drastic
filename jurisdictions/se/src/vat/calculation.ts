import type * as Vat from "@open-erp/contracts/vat-returns";

type Basis = typeof Vat.VatBasis.Type;
type Selection = typeof Vat.PrepareVatDraft.Type;
type Blocker = typeof Vat.VatBlocker.Type;

function repeatedKeys(basis: Basis) {
  const counts = new Map<string, number>();
  for (const { fact } of basis.facts) {
    const source = fact.input;
    const keys = [`source:${source.evidenceId}:${source.sourceLocator}`];
    if (source.expenseLink) keys.push(`expense:${source.expenseLink.sourceId}`);
    for (const id of source.taxLineIds) keys.push(`line:${source.voucherId}:${id}`);
    for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function profileBlockers(input: typeof Vat.VatFactInput.Type, basis: Basis, selection: Selection) {
  const blockers: Blocker[] = [];
  const purchase = input.treatment === "domestic_purchase";
  if (selection.mode === "actual_review") blockers.push("actual_profile_unapproved");
  if (input.recordClass !== (selection.mode === "actual_review" ? "actual_company" : "synthetic"))
    blockers.push("wrong_record_class");
  if (basis.bookProfile !== "synthetic-core-v1") blockers.push("unsupported_book");
  if (!purchase && input.treatment !== "domestic_sale") blockers.push("unsupported_treatment");
  if (input.currency !== "SEK" || basis.currency !== "SEK" || basis.currencyScale !== 2)
    blockers.push("currency_unsupported");
  return blockers;
}

function treatmentBlockers(input: typeof Vat.VatFactInput.Type, selection: Selection) {
  const blockers: Blocker[] = [];
  const purchase = input.treatment === "domestic_purchase";
  if (
    !input.issuedOn ||
    !input.suppliedOn ||
    !input.taxPointOn ||
    !input.dateBasis ||
    (purchase && !input.receivedOn)
  )
    blockers.push("missing_dates");
  if (
    input.taxPointOn &&
    (input.taxPointOn < selection.startsOn || input.taxPointOn > selection.endsOn)
  )
    blockers.push("outside_period");
  if (input.registration !== "registered" || !input.registrationEvidenceId)
    blockers.push("registration_unestablished");
  if (input.method !== "accrual" || !input.methodEvidenceId) blockers.push("method_unestablished");
  if (input.domesticEligibility !== "confirmed" || !input.treatmentEvidenceId)
    blockers.push("domestic_unestablished");
  if (purchase && (input.fullDeduction !== "confirmed" || !input.deductionEvidenceId))
    blockers.push("deduction_unestablished");
  if (!input.periodEvidenceId || !selection.periodEvidenceId) blockers.push("period_unestablished");
  return blockers;
}

function duplicateBlockers(input: typeof Vat.VatFactInput.Type, duplicates: Map<string, number>) {
  const blockers: Blocker[] = [];
  if (
    (duplicates.get(`source:${input.evidenceId}:${input.sourceLocator}`) ?? 0) > 1 ||
    (input.expenseLink && (duplicates.get(`expense:${input.expenseLink.sourceId}`) ?? 0) > 1)
  )
    blockers.push("duplicate_source_component");
  if (input.taxLineIds.some((id) => (duplicates.get(`line:${input.voucherId}:${id}`) ?? 0) > 1))
    blockers.push("overlapping_tax_lines");
  return blockers;
}

function assess(
  observation: typeof Vat.VatFactObservation.Type,
  basis: Basis,
  selection: Selection,
  duplicates: Map<string, number>,
): typeof Vat.VatAssessment.Type {
  const { fact } = observation;
  const input = fact.input;
  const net = BigInt(input.netMinor);
  const vat = BigInt(input.vatMinor);
  const sourceDifference = BigInt(input.grossMinor) - net - vat;
  const rateDifference = vat * 4n - net;
  const purchase = input.treatment === "domestic_purchase";
  const blockers = [
    ...profileBlockers(input, basis, selection),
    ...treatmentBlockers(input, selection),
  ];
  if (sourceDifference !== 0n) blockers.push("source_amount_difference");
  if (rateDifference !== 0n) blockers.push("rate_difference");
  if (!observation.expenseLinkCurrent) blockers.push("stale_expense_review");
  blockers.push(...duplicateBlockers(input, duplicates));
  const linked =
    input.voucherId !== null &&
    observation.taxLines.length > 0 &&
    observation.taxLines.length === input.taxLineIds.length;
  const ledgerTax = linked
    ? observation.taxLines.reduce(
        (total, line) =>
          total +
          (purchase
            ? BigInt(line.debitMinor) - BigInt(line.creditMinor)
            : BigInt(line.creditMinor) - BigInt(line.debitMinor)),
        0n,
      )
    : null;
  const ledgerDifference = ledgerTax === null ? null : ledgerTax - vat;
  if (!linked) blockers.push("missing_ledger_link");
  if (observation.voucherReversed) blockers.push("reversed_voucher");
  if (
    linked &&
    (ledgerDifference !== 0n ||
      observation.taxLines.some(
        (line) => BigInt(purchase ? line.creditMinor : line.debitMinor) !== 0n,
      ))
  )
    blockers.push("ledger_tax_difference");
  return {
    factId: fact.factId,
    sourceDigest: fact.digest,
    state: blockers.length === 0 ? "included_synthetic" : "excluded",
    blockers,
    sourceDifferenceMinor: sourceDifference.toString(),
    rateDifferenceNumerator: rateDifference.toString(),
    ledgerTaxMinor: ledgerTax?.toString() ?? null,
    ledgerDifferenceMinor: ledgerDifference?.toString() ?? null,
    contribution:
      blockers.length === 0
        ? {
            box05Minor: purchase ? "0" : net.toString(),
            box10Minor: purchase ? "0" : vat.toString(),
            box48Minor: purchase ? vat.toString() : "0",
          }
        : null,
  };
}
function taxBox(exact: bigint): typeof Vat.VatBox.Type {
  const reported = exact / 100n;
  return {
    exactMinor: exact.toString(),
    reportedKrona: reported.toString(),
    residualMinor: (exact - reported * 100n).toString(),
  };
}

// One monetary owner. Browser and SQL retain this result; neither recalculates it.
export function calculateVatDraft(
  basis: Basis,
  selection: Selection,
): typeof Vat.VatCalculation.Type {
  const duplicates = repeatedKeys(basis);
  const assessments = basis.facts.map((observation) =>
    assess(observation, basis, selection, duplicates),
  );
  const contributions = assessments.flatMap((assessment) =>
    assessment.contribution ? [assessment.contribution] : [],
  );
  const blockers: Array<(typeof Vat.VatCalculation.Type)["blockers"][number]> = [
    "legal_profile_unapproved",
    "coverage_unestablished",
    "ledger_reconciliation_unavailable",
    "period_registration_unverified",
  ];
  if (selection.otherBoxes !== "absent_in_synthetic_example") blockers.push("other_boxes_unknown");
  if (contributions.length === 0) blockers.push("no_included_facts");
  if (contributions.length !== assessments.length) blockers.push("excluded_facts");
  let syntheticBoxes: (typeof Vat.VatCalculation.Type)["syntheticBoxes"] = null;
  if (selection.mode === "synthetic_demonstration") {
    const totals = contributions.reduce(
      (sum, row) => ({
        box05: sum.box05 + BigInt(row.box05Minor),
        box10: sum.box10 + BigInt(row.box10Minor),
        box48: sum.box48 + BigInt(row.box48Minor),
      }),
      { box05: 0n, box10: 0n, box48: 0n },
    );
    const fractionalBasis = totals.box05 % 100n !== 0n;
    if (fractionalBasis) blockers.push("fractional_box05");
    const box05 = fractionalBasis
      ? { exactMinor: totals.box05.toString(), reportedKrona: null, residualMinor: null }
      : taxBox(totals.box05);
    const box10 = taxBox(totals.box10);
    const box48 = taxBox(totals.box48);
    const reportedNet = totals.box10 / 100n - totals.box48 / 100n;
    syntheticBoxes = {
      box05,
      box10,
      box48,
      box49:
        selection.otherBoxes === "absent_in_synthetic_example"
          ? {
              exactMinor: (totals.box10 - totals.box48).toString(),
              reportedKrona: reportedNet.toString(),
              residualMinor: (totals.box10 - totals.box48 - reportedNet * 100n).toString(),
            }
          : null,
    };
  }
  return {
    engine: "vat-return-draft-v1",
    assessments,
    includedCount: contributions.length,
    excludedCount: assessments.length - contributions.length,
    syntheticBoxes,
    blockers,
    coverageEstablished: false,
    ledgerReconciled: false,
    legalProfileActive: false,
    filingReady: false,
  };
}
