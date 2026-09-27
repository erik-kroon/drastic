import type * as Release from "@open-erp/contracts/vat-filing-release";
import type * as Vat from "@open-erp/contracts/vat-returns";
import { roundRational } from "@open-erp/domain/purchasing";

// The pure owner of the actual domestic VAT calculation. It reads retained
// values, applies the reviewed rule release and returns exact, reported and
// residual amounts per box plus the independent control reconciliation. It
// opens no transaction, starts no runtime and establishes no tax position: a
// rate, a box, a filing unit, a period and the coverage evidence are qualified
// inputs, and this module refuses rather than supplies one.

type Basis = typeof Vat.VatActualBasis.Type;

type Calculation = typeof Vat.VatActualCalculation.Type;

type Contribution = typeof Vat.VatActualContribution.Type;

type Exclusion = typeof Vat.VatActualExclusion.Type;

type Reconciliation = typeof Vat.VatControlReconciliation.Type;

type ControlRow = typeof Vat.VatControlRowDifference.Type;

type BridgeRow = typeof Vat.VatTimingBridgeRow.Type;

type Blocker = typeof Vat.VatActualBlocker.Type;

type Reason = typeof Vat.VatActualExclusionReason.Type;

type Rule = typeof Release.VatFactMappingRule.Type;

type Rate = typeof Release.VatQualifiedRate.Type;

type Rounding = (typeof Release.VatFilingRuleRelease.Type)["rounding"];

type Selected = typeof Vat.VatSelectedFact.Type;

type Box = typeof Release.VatReportBox.Type;

const netBox = "49";

const basisBox: Box = "05";

const inputBox: Box = "48";

const primitiveBoxes: ReadonlyArray<Box> = ["05", "10", "11", "12", "48"];

const saleOutputBoxes: ReadonlyArray<Box> = ["10", "11", "12"];

// Exact rational rounding over bigint. The release owns the mode, a tie is never
// truncated silently, and an amount never becomes a JavaScript number.
function round(numerator: bigint, denominator: bigint, mode: Rounding) {
  const result = roundRational(numerator, denominator, mode);

  return result._tag === "Success" ? result.success : null;
}

function taxed(basisMinor: bigint, rate: Rate, mode: Rounding) {
  return round(basisMinor * BigInt(rate.numerator), BigInt(rate.denominator), mode);
}

// A box is reported in the release's filing unit. The residual is retained, so
// the exact total and the reported total are both readable and the reported
// figure is never re-derived from the exact one.
function reportedIn(exact: bigint, unit: bigint, mode: Rounding) {
  const reported = round(exact, unit, mode);

  if (reported === null) return null;

  return { reported, residual: exact - reported * unit };
}

function mappingFor(rules: ReadonlyArray<Rule>, treatment: Selected["treatment"]) {
  const matching = rules.filter((rule) => rule.treatment === treatment);

  return matching.length === 1 ? (matching[0] ?? null) : null;
}

function rateFor(release: typeof Release.VatFilingRuleRelease.Type, rateId: string) {
  return release.rates.find((rate) => rate.rateId === rateId) ?? null;
}

function rowKey(voucherId: string, lineId: string) {
  return JSON.stringify([voucherId, lineId]);
}

function taxAmountsAgree(fact: Selected, rate: Rate, mode: Rounding) {
  if (fact.sourceTaxMinor === undefined) return false;

  const sourceTax = BigInt(fact.sourceTaxMinor);
  const tax = BigInt(fact.taxMinor);

  if (taxed(BigInt(fact.basisMinor), rate, mode) !== sourceTax) return false;

  if (fact.treatment === "domestic_sale") return tax === sourceTax;

  return sourceTax < 0n ? tax <= 0n && tax >= sourceTax : tax >= 0n && tax <= sourceTax;
}

function controlAllocationAgrees(fact: Selected) {
  const sale = fact.treatment === "domestic_sale";
  const role = sale ? "output_vat_control" : "input_vat_control";

  if (
    fact.controlComponents.some(
      (entry) => entry.voucherId !== fact.voucherId || entry.role !== role,
    )
  ) {
    return false;
  }

  const posted = fact.controlComponents.reduce((sum, entry) => sum + BigInt(entry.signedMinor), 0n);

  return posted === (sale ? -BigInt(fact.taxMinor) : BigInt(fact.taxMinor));
}

function voucherCounts(facts: ReadonlyArray<Selected>) {
  const counts = new Map<string, number>();

  for (const fact of facts) counts.set(fact.voucherId, (counts.get(fact.voucherId) ?? 0) + 1);

  return counts;
}

function periodVerified(basis: Basis) {
  const period = basis.registeredPeriod;

  return (
    period.startsOn <= period.endsOn &&
    period.periodEvidenceSha256.length > 0 &&
    period.factRevisionDigest.length > 0
  );
}

// A fact is declared by its qualified tax point and contributes through the
// reviewed mapping release. A withdrawn observation is an explained exclusion; a
// posted negative component is an ordinary signed contribution. A correction is
// therefore represented exactly once and never as a removal plus a second
// negative adjustment.
function assess(
  facts: ReadonlyArray<Selected>,
  release: typeof Release.VatFilingRuleRelease.Type,
  releaseId: string,
  repeats: Map<string, number>,
) {
  const contributions: Array<Contribution> = [];
  const exclusions: Array<Exclusion> = [];
  const blockers: Array<Blocker> = [];
  const declared: Array<string> = [];
  let ordinal = 0;

  function exclude(fact: Selected, reason: Reason, detail: string, blocker: Blocker) {
    exclusions.push({
      ordinal: exclusions.length + 1,
      factId: fact.factId,
      origin: fact.origin,
      revisionId: fact.revisionId,
      reason,
      detail,
    });
    blockers.push(blocker);
  }

  function publish(fact: Selected, rule: Rule, rate: Rate, box: Box, signedMinor: bigint) {
    ordinal += 1;

    return {
      ordinal,
      factId: fact.factId,
      origin: fact.origin,
      mappingRuleId: rule.mappingRuleId,
      rateId: rate.rateId,
      box,
      signedMinor: signedMinor.toString(),
      basisMinor: fact.basisMinor,
      taxMinor: fact.taxMinor,
      revisionId: fact.revisionId,
      digest: fact.digest,
    } satisfies Contribution;
  }

  for (const fact of facts) {
    if (fact.observation.withdrawn) {
      exclude(
        fact,
        "withdrawn_fact",
        "The admitted observation was withdrawn. Its general ledger control lines still roll forward.",
        "excluded_mandatory_fact",
      );
      continue;
    }

    if (fact.observation.recordClass !== "actual_company") {
      exclude(
        fact,
        "synthetic_record_class",
        "A synthetic observation never declares an actual company return.",
        "excluded_mandatory_fact",
      );
      continue;
    }

    if (fact.observation.voucherReversed) {
      exclude(
        fact,
        "voucher_reversed",
        "The linked voucher was reversed, so its retained amounts are not declared here.",
        "excluded_mandatory_fact",
      );
      continue;
    }

    if (!fact.observation.withinLedgerBoundary) {
      exclude(
        fact,
        "voucher_outside_ledger_boundary",
        "The linked voucher is past the captured ledger boundary.",
        "excluded_mandatory_fact",
      );
      continue;
    }

    if (fact.treatment === null || fact.observation.treatment === null) {
      exclude(
        fact,
        "unsupported_treatment",
        "The retained treatment is outside the supported domestic families.",
        "no_supported_mapping_for_treatment",
      );
      continue;
    }

    if (fact.observation.treatment !== fact.treatment) {
      exclude(
        fact,
        "unsupported_treatment",
        "The selected and the retained treatment disagree.",
        "no_supported_mapping_for_treatment",
      );
      continue;
    }

    if (fact.ruleReleaseId !== null && fact.ruleReleaseId !== releaseId) {
      exclude(
        fact,
        "rule_release_mismatch",
        "The component was published under another rule release.",
        "rule_release_mismatch",
      );
      continue;
    }

    if (fact.origin === "manual_admission" && (repeats.get(fact.voucherId) ?? 0) > 1) {
      exclude(
        fact,
        "duplicate_source_component",
        "Two admitted facts share one voucher, so one economic event would be declared twice.",
        "excluded_mandatory_fact",
      );
      continue;
    }

    if (!controlAllocationAgrees(fact)) {
      exclude(
        fact,
        "unlinked_control_component",
        "The fact's exact VAT component allocation does not agree with its retained tax amount.",
        "excluded_mandatory_fact",
      );
      continue;
    }

    if (!release.supportedTreatments.includes(fact.treatment)) {
      exclude(
        fact,
        "unmapped_treatment",
        "The release supports no mapping for this treatment.",
        "no_supported_mapping_for_treatment",
      );
      continue;
    }

    const rule = mappingFor(release.mappingRules, fact.treatment);

    if (rule === null) {
      exclude(
        fact,
        "unmapped_treatment",
        "The release declares no single rule for this treatment.",
        "no_supported_mapping_for_treatment",
      );
      continue;
    }

    const rate = rateFor(release, rule.rateId);

    if (rate === null) {
      exclude(
        fact,
        "rate_absent_from_release",
        "The mapping rule names a rate the release does not declare.",
        "rate_absent_from_release",
      );
      continue;
    }

    const basisMinor = BigInt(fact.basisMinor);
    const taxMinor = BigInt(fact.taxMinor);

    if (!taxAmountsAgree(fact, rate, release.rounding)) {
      exclude(
        fact,
        "published_tax_not_the_qualified_rate",
        "Source tax must match the qualified rate; the retained deduction must have the same sign and not exceed it.",
        "rate_absent_from_release",
      );
      continue;
    }

    const taxBox = fact.treatment === "domestic_sale" ? rate.salesBox : rule.inputBox;

    if (taxBox === null) {
      exclude(
        fact,
        "basis_box_absent_from_release",
        "The mapping rule declares no tax box for this treatment.",
        "no_supported_mapping_for_treatment",
      );
      continue;
    }

    if (rule.basisBox === basisBox && basisMinor !== 0n) {
      contributions.push(publish(fact, rule, rate, basisBox, basisMinor));
    }

    if (taxMinor !== 0n) contributions.push(publish(fact, rule, rate, taxBox, taxMinor));
    declared.push(fact.factId);
  }

  return { contributions, exclusions, blockers, declaredCount: declared.length };
}

function boxRows(
  release: typeof Release.VatFilingRuleRelease.Type,
  contributions: ReadonlyArray<Contribution>,
  declareNet: boolean,
  currencyScale: number,
) {
  if (release.filingUnitScale > currencyScale) return [];

  const unit = 10n ** BigInt(currencyScale - release.filingUnitScale);
  const totals = new Map<string, bigint>();

  for (const contribution of contributions) {
    const value = BigInt(contribution.signedMinor);

    totals.set(contribution.box, (totals.get(contribution.box) ?? 0n) + value);
  }

  const rows: Array<typeof Vat.VatActualBox.Type> = [];

  for (const box of primitiveBoxes) {
    if (!totals.has(box)) continue;
    const exact = totals.get(box) ?? 0n;
    const scaled = reportedIn(exact, unit, release.rounding);

    if (scaled === null) continue;

    rows.push({
      box,
      kind: "primitive",
      exactMinor: exact.toString(),
      reportedMinor: scaled.reported.toString(),
      residualMinor: scaled.residual.toString(),
    });
  }

  // The net is derived from the reported primitive boxes, not from the exact net,
  // because a filing reports whole units. Both are retained and their difference
  // is the residual. Assume nothing about the reported figure equalling the
  // rounded exact figure.
  if (!declareNet) return rows;

  let exactNet = 0n;
  let reportedNet = 0n;

  for (const box of saleOutputBoxes) {
    if (!totals.has(box)) continue;
    const exact = totals.get(box) ?? 0n;
    const scaled = reportedIn(exact, unit, release.rounding);

    if (scaled === null) return rows;

    exactNet += exact;
    reportedNet += scaled.reported;
  }

  if (totals.has(inputBox)) {
    const exact = totals.get(inputBox) ?? 0n;
    const scaled = reportedIn(exact, unit, release.rounding);

    if (scaled === null) return rows;

    exactNet -= exact;
    reportedNet -= scaled.reported;
  }

  rows.push({
    box: netBox,
    kind: "net",
    exactMinor: exactNet.toString(),
    reportedMinor: reportedNet.toString(),
    residualMinor: (exactNet - reportedNet * unit).toString(),
  });

  return rows;
}

// Every VAT control rolls forward independently over its own general ledger
// interval, from its reviewed opening balance. Two opposite unexplained rows
// still block: their zero net cannot conceal them.
function reconcile(
  basis: Basis,
  expectedFor: (accountId: string) => ReadonlyArray<{
    readonly voucherId: string;
    readonly lineId: string;
    readonly postingDate: string;
    readonly signedMinor: string;
  }>,
) {
  const controls: Array<Reconciliation> = [];
  const timingBridge: Array<BridgeRow> = [];
  let componentConflict = false;

  for (const snapshot of basis.controls) {
    const expected = expectedFor(snapshot.accountId);
    const expectedByKey = new Map<string, (typeof expected)[number]>();
    let consistent = true;

    for (const entry of expected) {
      const key = rowKey(entry.voucherId, entry.lineId);
      const previous = expectedByKey.get(key);

      if (
        previous !== undefined &&
        (previous.signedMinor !== entry.signedMinor || previous.postingDate !== entry.postingDate)
      ) {
        consistent = false;
      } else {
        expectedByKey.set(key, entry);
      }
    }

    const actualByKey = new Map(
      snapshot.movements.map((entry) => [rowKey(entry.voucherId, entry.lineId), entry]),
    );

    if (actualByKey.size !== snapshot.movements.length) consistent = false;

    const unexplainedRows: Array<ControlRow> = [];
    const missingRows: Array<ControlRow> = [];
    let expectedClosing = BigInt(snapshot.reviewedOpeningMinor);

    for (const entry of expectedByKey.values()) {
      expectedClosing += BigInt(entry.signedMinor);

      const actual = actualByKey.get(rowKey(entry.voucherId, entry.lineId));

      if (actual !== undefined) {
        if (actual.signedMinor !== entry.signedMinor || actual.postingDate !== entry.postingDate) {
          consistent = false;
        }

        continue;
      }

      missingRows.push({
        state: "missing",
        voucherId: entry.voucherId,
        lineId: entry.lineId,
        postingDate: entry.postingDate,
        signedMinor: entry.signedMinor,
      });
    }

    for (const movement of snapshot.movements) {
      if (expectedByKey.has(rowKey(movement.voucherId, movement.lineId))) continue;
      unexplainedRows.push({
        state: "unexplained",
        voucherId: movement.voucherId,
        lineId: movement.lineId,
        postingDate: movement.postingDate,
        signedMinor: movement.signedMinor,
      });
    }

    const closing = BigInt(snapshot.frozenGlClosingMinor);
    const difference = closing - expectedClosing;

    controls.push({
      role: snapshot.role,
      accountId: snapshot.accountId,
      reviewedOpeningMinor: snapshot.reviewedOpeningMinor,
      expectedClosingMinor: expectedClosing.toString(),
      frozenGlClosingMinor: snapshot.frozenGlClosingMinor,
      differenceMinor: difference.toString(),
      unexplainedRows,
      missingRows,
      reconciled:
        consistent && unexplainedRows.length === 0 && missingRows.length === 0 && difference === 0n,
    });

    if (!consistent) componentConflict = true;
  }

  // A declaration fact whose control component sits in the opening balance or
  // belongs to another accounting period is a timing bridge. Its amounts are
  // already carried, so its component is never added to the opening balance
  // again and it is never an unexplained or a missing row.
  for (const fact of basis.facts) {
    if (fact.controlComponents.length === 0) continue;

    if (fact.controlComponents.some((component) => component.withinControlInterval)) continue;

    const before = fact.controlComponents.filter(
      (component) => component.postingDate < basis.registeredPeriod.startsOn,
    );

    timingBridge.push({
      factId: fact.factId,
      origin: fact.origin,
      revisionId: fact.revisionId,
      taxPointOn: fact.taxPointOn,
      reason:
        before.length === fact.controlComponents.length
          ? "opening_balance_component"
          : "control_component_outside_interval",
      componentPostingDates: fact.controlComponents.map((component) => component.postingDate),
    });
  }

  return { controls, timingBridge, componentConflict };
}

function coverageState(basis: Basis) {
  const stated = new Map(basis.sourceCoverage.map((entry) => [entry.family, entry]));
  const blockers: Array<Blocker> = [];

  for (const family of basis.mappingRelease.vat.requiredSourceFamilies) {
    const entry = stated.get(family);

    if (entry === undefined || entry.state === "unknown") blockers.push("source_coverage_unknown");

    if (entry?.state === "unavailable") blockers.push("source_coverage_unavailable");
  }

  const complete = basis.mappingRelease.vat.requiredSourceFamilies.every((family) => {
    const entry = stated.get(family);

    return entry !== undefined && entry.state === "current" && entry.evidenceSha256 !== null;
  });

  return { blockers, complete };
}

// The single monetary owner. It returns exact, reported and residual amounts and
// the retained readiness reasons. It never returns a submitted, assessed or paid
// state, and it never asserts a statutory position.
export function calculateActualVat(basis: Basis): Calculation {
  const release = basis.mappingRelease.vat;

  const assessed = assess(
    basis.facts,
    release,
    basis.mappingRelease.releaseId,
    voucherCounts(basis.facts),
  );

  const coverage = coverageState(basis);

  const rolled = reconcile(basis, (accountId) => [
    ...basis.facts.flatMap((fact) =>
      fact.controlComponents.filter(
        (component) => component.accountId === accountId && component.withinControlInterval,
      ),
    ),
    ...basis.ownedEffects.flatMap((effect) =>
      effect.controlComponents.filter(
        (component) => component.accountId === accountId && component.withinControlInterval,
      ),
    ),
  ]);

  // Every fact in the captured population was assessed, so an unclassified fact
  // means the population is not the whole one and nothing may be declared from
  // it.
  const populationComplete = basis.population.withoutTaxPoint === 0;
  const filingUnitSupported = release.filingUnitScale <= basis.currencyScale;
  const supported = populationComplete && assessed.blockers.length === 0 && filingUnitSupported;
  const rows = boxRows(release, assessed.contributions, supported, basis.currencyScale);
  const reconciled = rolled.controls.every((control) => control.reconciled);
  const blockers: Array<Blocker> = [...assessed.blockers];

  if (!populationComplete) blockers.push("unclassified_fact_population");

  if (!filingUnitSupported) blockers.push("no_supported_mapping_for_treatment");

  if (rolled.componentConflict) blockers.push("control_component_conflict");

  for (const control of rolled.controls) {
    if (control.unexplainedRows.length > 0) blockers.push("control_unexplained_rows");

    if (control.missingRows.length > 0) blockers.push("control_missing_rows");

    if (control.differenceMinor !== "0") blockers.push("control_opening_difference");
  }

  blockers.push(...coverage.blockers);

  const unique = [...new Set(blockers)].sort();
  const verified = periodVerified(basis);

  return {
    engine: "vat-actual-return-v1",
    basisDigest: basis.digest,
    boxes: rows,
    contributions: assessed.contributions,
    exclusions: assessed.exclusions,
    controls: rolled.controls,
    timingBridge: rolled.timingBridge,
    sourceCoverage: basis.sourceCoverage,
    blockers: unique,
    assessedCount: basis.facts.length,
    includedCount: assessed.declaredCount,
    excludedCount: assessed.exclusions.length,
    calculationSupported: supported,
    coverageComplete: coverage.complete,
    controlsReconciled: reconciled,
    periodVerified: verified,
    filingReady: supported && coverage.complete && reconciled && verified && unique.length === 0,
  };
}
