import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { Description, Identifier } from "./values";
import { MinorUnits, SignedMinorUnits } from "./money";
import { assertBalancedJournal, type PurchaseJournalLine } from "./purchasing";

// Pure financial-close math for one book and fiscal year. NEXT-23 leaf:
// current close controls, mechanical result-transfer delta and single-count
// opening carry-forward. Prerequisites NEXT-13 (statement snapshots) and
// NEXT-22 (corporate-tax bridge) are released; the named
// `closing/financial-years` owner does not exist in this checkout (closing
// work lives in proposals/inventories/fulfillment), so no owner is taken
// over: the atomic transfer/certificate/opening/lock transaction, balance
// reads and artifact rendering stay with the closing owners.
//
// No database and no runtime. P is the current after-tax year profit from
// NEXT-13 excluding owned transfers; F is the net credit to year-result
// equity from prior effective transfers for the same year. A bound failure
// is an error rather than a second transfer or a fabricated opening.

export const CloseFailureCode = Schema.Literals([
  "MissingRequiredControl",
  "UnbalancedJournal",
  "DoubleCountedOpening",
  "NominalOpeningCarryover",
  "OpeningMismatch",
  "StaleCloseBasis",
]);

export type CloseFailureCode = typeof CloseFailureCode.Type;

export const CloseFailure = Schema.Struct({
  code: CloseFailureCode,
  message: Description,
});

export type CloseFailure = typeof CloseFailure.Type;

export type Checked<A> = Result.Result<A, CloseFailure>;

function fail(code: CloseFailureCode, message: string): Checked<never> {
  return Result.fail({ code, message });
}

function refuse<A>(result: Checked<A>): Checked<never> {
  return Result.isFailure(result)
    ? Result.fail(result.failure)
    : fail("StaleCloseBasis", "A checked stage unexpectedly succeeded.");
}

function amount(value: bigint) {
  return value.toString();
}

export const FamilyControlStatus = Schema.Literals(["required_met", "not_applicable", "blocker"]);

export type FamilyControlStatus = typeof FamilyControlStatus.Type;

// One applicable-family control result. NotApplicable carries its dated
// evidence; Unknown/Unsupported arrives as a blocker, never as consent.
export const FamilyControl = Schema.Struct({
  familyId: Identifier,
  status: FamilyControlStatus,
  evidenceId: Schema.NullOr(Identifier),
});

export type FamilyControl = typeof FamilyControl.Type;

export const TransferRoles = Schema.Struct({
  nominalResultTransferAccountId: Identifier,
  yearResultEquityAccountId: Identifier,
});

export type TransferRoles = typeof TransferRoles.Type;

export const TransferInput = Schema.Struct({
  // Current after-tax year profit, excluding owned transfers.
  profitMinor: SignedMinorUnits,
  // Net credit to year-result equity from prior effective transfers.
  priorTransferMinor: SignedMinorUnits,
  roles: TransferRoles,
});

export type TransferInput = typeof TransferInput.Type;

export const TransferPlan = Schema.Struct({
  deltaMinor: SignedMinorUnits,
  journal: Schema.Array(
    Schema.Struct({
      sourceLineId: Schema.NullOr(Identifier),
      accountId: Identifier,
      debitMinor: MinorUnits,
      creditMinor: MinorUnits,
      description: Description,
    }),
  ),
  // A zero delta creates no fake voucher; the certificate, opening and
  // lock result remain atomic in the owning transaction.
  consumesVoucher: Schema.Boolean,
});

export type TransferPlan = typeof TransferPlan.Type;

function addSigned(
  lines: Array<PurchaseJournalLine>,
  line: {
    readonly accountId: string;
    readonly signedMinor: bigint;
    readonly description: string;
  },
) {
  if (line.signedMinor === 0n) return;

  lines.push({
    sourceLineId: null,
    accountId: line.accountId,
    debitMinor: amount(line.signedMinor > 0n ? line.signedMinor : 0n),
    creditMinor: amount(line.signedMinor < 0n ? -line.signedMinor : 0n),
    description: line.description,
  });
}

// D = P-F. A loss makes D negative and reverses the direction naturally.
// A reopened/reclosed year posts only this delta, never the whole revised
// profit on top of an earlier valid transfer.
export function compileResultTransfer(input: TransferInput): Checked<TransferPlan> {
  const delta = BigInt(input.profitMinor) - BigInt(input.priorTransferMinor);
  const journal: Array<PurchaseJournalLine> = [];

  addSigned(journal, {
    accountId: input.roles.nominalResultTransferAccountId,
    signedMinor: delta,
    description: "Year result transfer",
  });

  addSigned(journal, {
    accountId: input.roles.yearResultEquityAccountId,
    signedMinor: -delta,
    description: "Year result equity",
  });

  const finished = assertBalancedJournal(journal, delta === 0n ? 0 : 2);

  if (Result.isFailure(finished)) return fail("UnbalancedJournal", finished.failure.message);

  return Result.succeed({
    deltaMinor: amount(delta),
    journal: finished.success,
    consumesVoucher: finished.success.length > 0,
  });
}

export const FinalProposalInput = Schema.Struct({
  yearId: Identifier,
  controls: Schema.Array(FamilyControl).check(Schema.isMinLength(1)),
  taxBridgeReceiptId: Schema.NullOr(Identifier),
  transfer: TransferInput,
  closeBasisVersion: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
});

export type FinalProposalInput = typeof FinalProposalInput.Type;

export const FinalProposal = Schema.Struct({
  yearId: Identifier,
  transfer: TransferPlan,
  taxBridgeReceiptId: Identifier,
  closeBasisVersion: FinalProposalInput.fields.closeBasisVersion,
});

export type FinalProposal = typeof FinalProposal.Type;

// The final proposal is sealed only when every required family control is
// satisfied and the NEXT-22 tax bridge receipt is present. A missing
// required control yields no certificate, no transfer and no new opening.
export function sealFinalProposal(input: FinalProposalInput): Checked<FinalProposal> {
  const blocker = input.controls.find((control) => control.status === "blocker");

  if (blocker !== undefined) {
    return fail(
      "MissingRequiredControl",
      `Required control ${blocker.familyId} is not satisfied; no certificate is issued.`,
    );
  }

  if (input.taxBridgeReceiptId === null) {
    return fail(
      "MissingRequiredControl",
      "The approved current-tax bridge receipt is required before final close.",
    );
  }

  const transfer = compileResultTransfer(input.transfer);

  if (Result.isFailure(transfer)) return refuse(transfer);

  return Result.succeed({
    yearId: input.yearId,
    transfer: transfer.success,
    taxBridgeReceiptId: input.taxBridgeReceiptId,
    closeBasisVersion: input.closeBasisVersion,
  });
}

export const BalanceLine = Schema.Struct({
  accountId: Identifier,
  // Signed: BS debit-positive/credit-negative in one convention.
  balanceMinor: SignedMinorUnits,
  // Nominal (P&L) accounts never carry prior-year operating balances
  // into a new year's report under the qualified year partition.
  nominal: Schema.Boolean,
});

export type BalanceLine = typeof BalanceLine.Type;

export const OpeningProjectionInput = Schema.Struct({
  opening: Schema.Array(BalanceLine),
  // Actual next-year journals, EXCLUDING any journal already representing
  // the opening. The opening voucher of a migration into an empty book is
  // the basis once and is excluded from ordinary movements here.
  movementMinor: Schema.Array(
    Schema.Struct({
      accountId: Identifier,
      signedMinor: SignedMinorUnits,
    }),
  ),
  // Journals that already represent the opening must be excluded above.
  openingJournalIds: Schema.Array(Identifier),
  movementJournalIds: Schema.Array(Identifier),
});

export type OpeningProjectionInput = typeof OpeningProjectionInput.Type;

// closing = opening + movement. Generating the OpeningSet creates no new
// cash, asset or liability journal: old-year postings already establish
// those balances, so an extra cash journal refuses here.
export function projectClosing(input: OpeningProjectionInput): Checked<ReadonlyArray<BalanceLine>> {
  const doubleCounted = input.movementJournalIds.find((id) => input.openingJournalIds.includes(id));

  if (doubleCounted !== undefined) {
    return fail(
      "DoubleCountedOpening",
      "A journal already representing the opening cannot also be a next-year movement.",
    );
  }

  const movement = new Map<string, bigint>();

  for (const leg of input.movementMinor) {
    movement.set(leg.accountId, (movement.get(leg.accountId) ?? 0n) + BigInt(leg.signedMinor));
  }

  const closing: Array<BalanceLine> = [];

  for (const line of input.opening) {
    if (line.nominal && BigInt(line.balanceMinor) !== 0n) {
      return fail(
        "NominalOpeningCarryover",
        "Nominal accounts begin the new year at zero, not with prior-year operating balances.",
      );
    }

    const balance = BigInt(line.balanceMinor) + (movement.get(line.accountId) ?? 0n);

    closing.push({
      accountId: line.accountId,
      balanceMinor: amount(balance),
      nominal: line.nominal,
    });
  }

  return Result.succeed(closing);
}

export const OpeningDelta = Schema.Struct({
  deltaMinor: SignedMinorUnits,
});

export type OpeningDelta = typeof OpeningDelta.Type;

// After corrections and a revised close, the new OpeningSet revision is a
// projection replacement carrying the delta against the old opening for
// explanation. Old reports stay byte-identical: the old opening value object
// is never mutated, only superseded by reference.
export function openingDelta(oldOpeningMinor: string, newOpeningMinor: string): OpeningDelta {
  return { deltaMinor: amount(BigInt(newOpeningMinor) - BigInt(oldOpeningMinor)) };
}

export const CloseCurrent = Schema.Struct({
  closeBasisVersion: FinalProposalInput.fields.closeBasisVersion,
  controls: Schema.Array(FamilyControl),
});

export type CloseCurrent = typeof CloseCurrent.Type;

// Execution-time conservation inside the owning transaction: the sealed
// basis, measurements and required controls must still be current.
export function assertCloseConservation(
  plan: FinalProposal,
  current: CloseCurrent,
): Checked<FinalProposal> {
  if (current.closeBasisVersion !== plan.closeBasisVersion) {
    return fail("StaleCloseBasis", "The close basis moved after the final proposal was sealed.");
  }

  const blocker = current.controls.find((control) => control.status === "blocker");

  if (blocker !== undefined) {
    return fail(
      "MissingRequiredControl",
      `Required control ${blocker.familyId} opened after the final proposal was sealed.`,
    );
  }

  return Result.succeed(plan);
}
