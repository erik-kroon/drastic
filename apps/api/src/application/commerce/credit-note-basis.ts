import * as Credits from "@open-erp/contracts/customer-credit-notes";
import * as Effect from "effect/Effect";
import { failure } from "../failures";
import { digest } from "../json";
import { decode } from "./support";

type Scope = typeof Credits.CustomerCreditCapacity.Type.scope;

type OriginalLine = {
  readonly id: string;
  readonly description: string;
  readonly quantity: string;
  readonly netMinor: string;
  readonly taxMinor: string;
  readonly grossMinor: string;
  readonly vatTreatment: "se-domestic-standard-25-v1";
};

type PriorCredit = {
  readonly originalLineId: string;
  readonly netMinor: string;
  readonly taxMinor: string;
};

type Unpaid = {
  readonly registerInvoiceId: string;
  readonly currency: string;
  readonly currencyScale: number;
  readonly amountMinor: string;
  readonly recordedAllocatedMinor: string;
  readonly outstandingMinor: string;
  readonly blocked: boolean;
  readonly status: string;
};

type TaxPeriod = {
  readonly accountingPeriodId: string;
  readonly fiscalYearId: string;
  readonly startsOn: string;
  readonly endsOn: string;
  readonly qualifiedOn: string;
};

type Recognition = {
  readonly voucherId: string;
  readonly controlLineId: string;
  readonly eventId: string;
  readonly postingDate: string;
  readonly controlAccountId: string;
  readonly revenueAccountId: string;
  readonly outputVatAccountId: string;
  readonly posted: boolean;
};

type TaxWitness = typeof Credits.CustomerCreditTaxWitness.Type;

export type OriginalLineCreditBasis = {
  readonly originalLines: ReadonlyArray<OriginalLine>;
  readonly priorCredits: ReadonlyArray<PriorCredit>;
  readonly unpaidCapacity: Unpaid;
  readonly taxPeriod: TaxPeriod;
  readonly recognition: Recognition;
  readonly taxWitness: TaxWitness;
};

export type CompiledCapacity = {
  readonly lines: ReadonlyArray<typeof Credits.OriginalLineCreditCapacity.Type>;
  readonly totals: typeof Credits.CustomerCreditTotals.Type;
  readonly unpaidCapacity: Unpaid;
  readonly taxPeriod: TaxPeriod;
  readonly recognition: Recognition;
  readonly taxWitness: TaxWitness;
  readonly creditCount: number;
  readonly completelyExhausted: boolean;
};

export type LineIds = {
  readonly revenueLineId: string;
  readonly outputVatLineId: string;
};

// The decoded capacity record and the compiled capacity describe the same remaining
// capacity, so one selection contract consumes either without a second shape.
export type CreditCapacityBasis = {
  readonly lines: ReadonlyArray<typeof Credits.OriginalLineCreditCapacity.Type>;
  readonly unpaidCapacity: { readonly outstandingMinor: string };
};

// The reviewed domestic standard rate and the reviewed line-tax rounding contract.
// They are qualified inputs carried by the retained policy, never a choice this owner
// may make, and a different rate or rounding method is a different profile.
const qualifiedRatePercent = 25n;

function lineTax(net: bigint) {
  return (net * qualifiedRatePercent + 50n) / 100n;
}

function exactMinor(value: string) {
  return /^(0|[1-9][0-9]{0,37})$/.test(value) ? BigInt(value) : null;
}

function byIdentifier(a: string, b: string) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The original-line credit capacity of one issued legal customer invoice.
 *
 * Pure. No database, network or caller-supplied calculated effect is read. Every
 * remaining amount is the exact difference between the frozen original line and the
 * credits already consumed, so a retained rounding residual is never rounded away and
 * a partial credit never silently re-prices the line.
 */
export const compileOriginalLineCreditCapacity = Effect.fn("commerce.customerCredit.capacity")(
  function* (input: OriginalLineCreditBasis) {
    if (input.originalLines.length === 0) return yield* failure("UnsupportedProfile");

    if (new Set(input.originalLines.map((line) => line.id)).size !== input.originalLines.length)
      return yield* failure("InvalidJournal");

    const prior = new Map<string, { net: bigint; tax: bigint }>();

    for (const entry of input.priorCredits) {
      const net = exactMinor(entry.netMinor);
      const tax = exactMinor(entry.taxMinor);

      if (net === null || tax === null) return yield* failure("StaleDependency");

      const existing = prior.get(entry.originalLineId) ?? { net: 0n, tax: 0n };

      prior.set(entry.originalLineId, { net: existing.net + net, tax: existing.tax + tax });
    }

    const lines: Array<typeof Credits.OriginalLineCreditCapacity.Type> = [];

    let netTotal = 0n,
      taxTotal = 0n,
      grossTotal = 0n,
      priorNet = 0n,
      priorTax = 0n,
      remainingNet = 0n,
      remainingTax = 0n;

    for (const line of input.originalLines) {
      const net = exactMinor(line.netMinor);
      const tax = exactMinor(line.taxMinor);
      const gross = exactMinor(line.grossMinor);

      if (net === null || tax === null || gross === null) return yield* failure("StaleDependency");

      // The frozen original line must still satisfy its own qualified rate and rounding
      // contract. A line that does not is not a creditable basis.
      if (gross !== net + tax || lineTax(net) !== tax) return yield* failure("StaleDependency");

      const consumed = prior.get(line.id) ?? { net: 0n, tax: 0n };
      const leftNet = net - consumed.net;
      const leftTax = tax - consumed.tax;

      if (leftNet < 0n || leftTax < 0n) return yield* failure("StaleDependency");

      lines.push({
        originalLineId: line.id,
        description: line.description,
        quantity: line.quantity,
        vatTreatment: line.vatTreatment,
        netMinor: line.netMinor,
        taxMinor: line.taxMinor,
        grossMinor: line.grossMinor,
        priorCreditedNetMinor: consumed.net.toString(),
        priorCreditedTaxMinor: consumed.tax.toString(),
        remainingNetMinor: leftNet.toString(),
        remainingTaxMinor: leftTax.toString(),
        remainingGrossMinor: (leftNet + leftTax).toString(),
        qualifiedTaxMinor: lineTax(leftNet).toString(),
        exhausted: leftNet === 0n && leftTax === 0n,
      });

      netTotal += net;
      taxTotal += tax;
      grossTotal += gross;
      priorNet += consumed.net;
      priorTax += consumed.tax;
      remainingNet += leftNet;
      remainingTax += leftTax;
    }

    if (priorNet > netTotal || priorTax > taxTotal) return yield* failure("StaleDependency");

    return {
      lines,
      totals: {
        netMinor: netTotal.toString(),
        taxMinor: taxTotal.toString(),
        grossMinor: grossTotal.toString(),
        priorCreditedNetMinor: priorNet.toString(),
        priorCreditedTaxMinor: priorTax.toString(),
        remainingNetMinor: remainingNet.toString(),
        remainingTaxMinor: remainingTax.toString(),
        remainingGrossMinor: (remainingNet + remainingTax).toString(),
      },
      unpaidCapacity: input.unpaidCapacity,
      taxPeriod: input.taxPeriod,
      recognition: input.recognition,
      taxWitness: input.taxWitness,
      creditCount: input.priorCredits.length,
      completelyExhausted: remainingNet === 0n && remainingTax === 0n,
    } satisfies CompiledCapacity;
  },
);

/**
 * The exact credit a request consumes from the original lines.
 *
 * Pure. Each original source line may appear at most once, a credit must be positive
 * and bounded by the line's exact remaining net and tax, and a credit that exhausts
 * the remaining net carries that line's exact remaining tax rather than a freshly
 * recomputed one, so a retained rounding residual is credited exactly once.
 */
export const compileSelectedCredit = Effect.fn("commerce.customerCredit.selected")(function* (
  capacity: CreditCapacityBasis,
  selected: ReadonlyArray<typeof Credits.SelectedCreditLine.Type>,
  lineIds: ReadonlyMap<string, LineIds>,
) {
  if (selected.length === 0 || selected.length > 50) return yield* failure("InvalidJournal");

  if (new Set(selected.map((line) => line.originalLineId)).size !== selected.length)
    return yield* failure("InvalidJournal");

  const capacityById = new Map(capacity.lines.map((line) => [line.originalLineId, line] as const));

  const lines: Array<typeof Credits.CustomerCreditLine.Type> = [];

  let netTotal = 0n,
    taxTotal = 0n;

  for (const request of [...selected].sort((a, b) =>
    byIdentifier(a.originalLineId, b.originalLineId),
  )) {
    const capacityLine = capacityById.get(request.originalLineId);

    if (!capacityLine) return yield* failure("NotFound");

    const creditedNet = exactMinor(request.creditedNetMinor);
    const creditedTax = exactMinor(request.creditedTaxMinor);
    const leftNet = exactMinor(capacityLine.remainingNetMinor);
    const leftTax = exactMinor(capacityLine.remainingTaxMinor);
    const ids = lineIds.get(request.originalLineId);

    if (
      creditedNet === null ||
      creditedTax === null ||
      leftNet === null ||
      leftTax === null ||
      !ids
    )
      return yield* failure("InvalidJournal");

    if (creditedNet + creditedTax <= 0n) return yield* failure("InvalidJournal");

    if (creditedNet > leftNet) return yield* failure("InvalidJournal");

    if (creditedTax > leftTax) return yield* failure("InvalidJournal");

    const final = creditedNet === leftNet;

    // A full final credit on a line carries that line's exact remaining tax, so a
    // retained rounding residual is credited exactly once and never recomputed. Any
    // other credit must equal the qualified original rate and rounding contract applied
    // to the credited net, so a rounded proposal is refused rather than posted at an
    // unreviewed amount.
    if (final ? creditedTax !== leftTax : creditedTax !== lineTax(creditedNet))
      return yield* failure("InvalidJournal");

    lines.push({
      originalLineId: capacityLine.originalLineId,
      description: capacityLine.description,
      quantity: capacityLine.quantity,
      vatTreatment: capacityLine.vatTreatment,
      remainingNetMinor: capacityLine.remainingNetMinor,
      remainingTaxMinor: capacityLine.remainingTaxMinor,
      creditedNetMinor: creditedNet.toString(),
      creditedTaxMinor: creditedTax.toString(),
      creditedGrossMinor: (creditedNet + creditedTax).toString(),
      finalLineCredit: final,
      revenueLineId: ids.revenueLineId,
      outputVatLineId: creditedTax === 0n ? null : ids.outputVatLineId,
    });

    netTotal += creditedNet;
    taxTotal += creditedTax;
  }

  const gross = netTotal + taxTotal;
  const outstanding = exactMinor(capacity.unpaidCapacity.outstandingMinor);

  if (outstanding === null) return yield* failure("StaleDependency");

  // The bounded path refuses paid-principal excess. It never opens a customer credit
  // balance and never promises a refund.
  if (gross > outstanding) return yield* failure("InvalidJournal");

  return {
    lines,
    netMinor: netTotal.toString(),
    taxMinor: taxTotal.toString(),
    grossMinor: gross.toString(),
    unpaidBeforeMinor: capacity.unpaidCapacity.outstandingMinor,
    unpaidAfterMinor: (outstanding - gross).toString(),
  };
});

/**
 * The exact negative tax effect of one credited line.
 *
 * Pure. The base and the output tax are the exact negatives of the credited net and
 * the credited tax, and the row binds the original recognition component and the
 * qualified tax period a VAT-return owner would consume. It is not a return, not a box
 * mapping and not a statutory conclusion: no VAT return, amendment or reclassification
 * owner is released, so no filing consequence is computed or implied here.
 */
export function negativeTaxEffect(
  line: typeof Credits.CustomerCreditLine.Type,
  context: {
    readonly id: string;
    readonly ordinal: number;
    readonly originalVoucherId: string;
    readonly originalControlLineId: string;
    readonly originalPostingDate: string;
    readonly originalEvidenceId: string;
    readonly taxPeriod: TaxPeriod;
    readonly creditVoucherId: string | null;
    readonly controlLineId: string | null;
  },
): typeof Credits.CustomerCreditTaxCorrection.Type {
  return {
    id: context.id,
    ordinal: context.ordinal,
    originalLineId: line.originalLineId,
    originalVoucherId: context.originalVoucherId,
    originalControlLineId: context.originalControlLineId,
    originalPostingDate: context.originalPostingDate,
    originalEvidenceId: context.originalEvidenceId,
    qualifiedTaxPeriod: context.taxPeriod,
    treatment: line.vatTreatment,
    baseMinor: (-BigInt(line.creditedNetMinor)).toString(),
    outputTaxMinor: (-BigInt(line.creditedTaxMinor)).toString(),
    creditVoucherId: context.creditVoucherId,
    revenueLineId: line.revenueLineId,
    outputVatLineId: line.outputVatLineId,
    controlLineId: context.controlLineId,
    vatReturnOwner: "not_released",
    vatReturnConsequence: "unobserved_pending_next_04",
  };
}

export type CreditDocumentInput = {
  readonly scope: Scope;
  readonly documentId: string;
  readonly creditId: string;
  readonly creditSeries: string;
  readonly creditNumber: string;
  readonly creditDate: string;
  readonly originalLegalIssueId: string;
  readonly originalDocumentNumber: string;
  readonly originalDocumentHash: string;
  readonly originalIssuedOn: string;
  readonly originalCreditNoteReference: string | null;
  readonly counterpartyId: string;
  readonly counterpartyRevision: string;
  readonly counterpartyName: string;
  readonly currency: string;
  readonly currencyScale: number;
  readonly reason: string;
  readonly evidence: typeof Credits.CustomerCreditDecisionIdentity.Type;
  readonly seller: typeof Credits.CustomerCreditParty.Type;
  readonly customer: typeof Credits.CustomerCreditParty.Type;
  readonly lines: ReadonlyArray<typeof Credits.CustomerCreditLine.Type>;
  readonly netMinor: string;
  readonly taxMinor: string;
  readonly grossMinor: string;
  readonly taxWitness: TaxWitness;
  readonly createdAt: string;
};

/**
 * The frozen legal document identity of one credit.
 *
 * Pure. It copies the frozen original recognition identity, the reviewed parties and
 * the exact credited amounts. It never re-prices a line, never fetches a current
 * catalog price and never reopens a converted order quantity, so rendering from this
 * revision can never produce a different total than the one that was issued.
 */
export const freezeCreditDocument = Effect.fn("commerce.customerCredit.document")(function* (
  input: CreditDocumentInput,
) {
  const withoutDigest = {
    revision: "1",
    kind: "legal_customer_credit_note_v1" as const,
    profile: "se-domestic-b2b-sek-25-accrual-credit-v1" as const,
    documentId: input.documentId,
    documentNumber: `${input.creditSeries}-${input.creditNumber}`,
    documentSeries: input.creditSeries,
    creditDate: input.creditDate,
    creditId: input.creditId,
    originalLegalIssueId: input.originalLegalIssueId,
    originalDocumentNumber: input.originalDocumentNumber,
    originalDocumentHash: input.originalDocumentHash,
    originalIssuedOn: input.originalIssuedOn,
    originalCreditNoteReference: input.originalCreditNoteReference,
    counterpartyId: input.counterpartyId,
    counterpartyRevision: input.counterpartyRevision,
    counterpartyName: input.counterpartyName,
    currency: input.currency,
    currencyScale: input.currencyScale,
    reason: input.reason,
    evidence: { evidenceId: input.evidence.evidenceId, sha256: input.evidence.sha256 },
    seller: input.seller,
    customer: input.customer,
    lines: input.lines,
    totals: {
      netMinor: input.netMinor,
      taxMinor: input.taxMinor,
      grossMinor: input.grossMinor,
    },
    taxWitness: input.taxWitness,
    createdAt: input.createdAt,
  };

  return yield* decode(Credits.CustomerCreditSemanticDocument, {
    ...withoutDigest,
    digest: yield* digest(withoutDigest),
  });
});
