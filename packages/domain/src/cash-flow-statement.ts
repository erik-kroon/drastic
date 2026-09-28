import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { AccountingDate, Description, Identifier } from "./values";
import { SignedMinorUnits } from "./money";

// Pure direct cash-flow classification and closing-cash reconciliation.
// NEXT-45 leaf: historical actual cash-flow leaves with a full bridge to
// closing cash. Not a forecast, not an estimate, and not an indirect
// statement.
//
// Direct flows use actual receipts and payments, never invoiced revenue or
// P&L expense; a depreciation entry is noncash and refuses here. Two equal
// opposite amounts are never inferred as an internal transfer: elimination
// needs the owned transfer identity with both legs explained. No
// unclassified item defaults to operating to force completeness. The cash
// perimeter is reviewed, never inferred from account names. Presentation
// and statutory applicability need their own company/framework release.

export const CashFlowFailureCode = Schema.Literals([
  "NonCashRow",
  "SplitMismatch",
  "MissingTransferCounterpart",
  "CurrencyMismatch",
  "PerimeterBreach",
]);

export type CashFlowFailureCode = typeof CashFlowFailureCode.Type;

export const CashFlowFailure = Schema.Struct({
  code: CashFlowFailureCode,
  message: Description,
});

export type CashFlowFailure = typeof CashFlowFailure.Type;

export type Checked<A> = Result.Result<A, CashFlowFailure>;

function fail(code: CashFlowFailureCode, message: string): Checked<never> {
  return Result.fail({ code, message });
}

function amount(value: bigint) {
  return value.toString();
}

export const CashActivity = Schema.Literals(["operating", "investing", "financing"]);

export type CashActivity = typeof CashActivity.Type;

export const CashRowKind = Schema.Literals([
  "external",
  "internal_transfer",
  "valuation_effect",
  "perimeter_change",
]);

export type CashRowKind = typeof CashRowKind.Type;

// One actual posted cash component inside the selected perimeter and
// cutoff. Classification splits arrive resolved from exact settlement,
// purchase, payroll, asset and funding relationships.
export const CashRow = Schema.Struct({
  rowId: Identifier,
  signedCashMinor: SignedMinorUnits,
  kind: CashRowKind,
  activity: Schema.NullOr(CashActivity),
  originRef: Schema.NullOr(Identifier),
  transferId: Schema.NullOr(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200))),
  witnessRef: Schema.NullOr(Identifier),
});

export type CashRow = typeof CashRow.Type;

export const CashFlowInput = Schema.Struct({
  periodStartsOn: AccountingDate,
  periodEndsOn: AccountingDate,
  recordedCutoff: Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)),
  openingCashMinor: SignedMinorUnits,
  actualClosingCashMinor: SignedMinorUnits,
  sourceControlsComplete: Schema.Boolean,
  rows: Schema.Array(CashRow).check(Schema.isMaxLength(5000)),
});

export type CashFlowInput = typeof CashFlowInput.Type;

export const CashFlowStatement = Schema.Struct({
  operatingNetMinor: SignedMinorUnits,
  investingNetMinor: SignedMinorUnits,
  financingNetMinor: SignedMinorUnits,
  exchangeEffectsMinor: SignedMinorUnits,
  perimeterChangesMinor: SignedMinorUnits,
  expectedClosingMinor: SignedMinorUnits,
  actualClosingMinor: SignedMinorUnits,
  reconciliationDifferenceMinor: SignedMinorUnits,
  unclassifiedRowIds: Schema.Array(Identifier),
  complete: Schema.Boolean,
});

export type CashFlowStatement = typeof CashFlowStatement.Type;

// Classifying every row once across external flows, eliminations and
// bridge categories, then reconciling to actual closing cash.
export function calculateCashFlow(input: CashFlowInput): Checked<CashFlowStatement> {
  const seen = new Set<string>();
  const transfers = new Map<string, Array<{ rowId: string; signed: bigint }>>();
  const unclassified: Array<string> = [];
  const totals = { operating: 0n, investing: 0n, financing: 0n, exchange: 0n, perimeter: 0n };

  for (const row of input.rows) {
    if (seen.has(row.rowId)) {
      return fail("SplitMismatch", `Cash row ${row.rowId} is classified twice.`);
    }

    seen.add(row.rowId);

    const signed = BigInt(row.signedCashMinor);

    if (signed === 0n) {
      return fail("NonCashRow", `Cash row ${row.rowId} carries no cash movement.`);
    }

    if (row.kind === "valuation_effect") {
      if (row.witnessRef === null) {
        return fail("NonCashRow", `Valuation row ${row.rowId} needs its exact owner witness.`);
      }

      totals.exchange += signed;
      continue;
    }

    if (row.kind === "perimeter_change") {
      totals.perimeter += signed;
      continue;
    }

    if (row.kind === "internal_transfer") {
      if (row.transferId === null) {
        unclassified.push(row.rowId);
        continue;
      }

      const legs = transfers.get(row.transferId);

      if (legs === undefined) {
        transfers.set(row.transferId, [{ rowId: row.rowId, signed }]);
      } else {
        legs.push({ rowId: row.rowId, signed });
      }

      continue;
    }

    if (row.activity === null || row.originRef === null) {
      unclassified.push(row.rowId);
      continue;
    }

    totals[row.activity] += signed;
  }

  let missingCounterparts = false;

  for (const [transferId, legs] of transfers) {
    const net = legs.reduce((sum, leg) => sum + leg.signed, 0n);

    if (legs.length < 2 || net !== 0n) {
      missingCounterparts = true;

      for (const leg of legs) unclassified.push(leg.rowId);

      continue;
    }

    // A complete internal movement inside the perimeter contributes zero
    // external flow. Its legs stay explained, never dropped silently: they
    // are retained by the transfer identity outside the external totals.
    void transferId;
  }

  const external = totals.operating + totals.investing + totals.financing;
  const opening = BigInt(input.openingCashMinor);

  const expected = opening + external + totals.exchange + totals.perimeter;

  const actual = BigInt(input.actualClosingCashMinor);

  const difference = actual - expected;

  const complete =
    unclassified.length === 0 &&
    !missingCounterparts &&
    difference === 0n &&
    input.sourceControlsComplete;

  return Result.succeed({
    operatingNetMinor: amount(totals.operating),
    investingNetMinor: amount(totals.investing),
    financingNetMinor: amount(totals.financing),
    exchangeEffectsMinor: amount(totals.exchange),
    perimeterChangesMinor: amount(totals.perimeter),
    expectedClosingMinor: amount(expected),
    actualClosingMinor: input.actualClosingCashMinor,
    reconciliationDifferenceMinor: amount(difference),
    unclassifiedRowIds: [...unclassified].sort(),
    complete,
  });
}
