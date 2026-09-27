import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { Description, Digest, Identifier } from "./values";
import { MinorUnits, SignedMinorUnits } from "./money";
import { assertBalancedJournal, type PurchaseJournalLine } from "./purchasing";

// Pure disposal-with-proceeds math for one asset and book currency.
// NEXT-19 leaf: proceeds, tax and post-impairment disposal conservation.
// The WIP-AST03-UI asset owner (impairment-aware ordinary recognition,
// controls and disposal reads over 9150) is reserved and not released in
// this checkout, so there is no second asset register here: the
// impairment-aware disposition basis arrives as a reviewed exact input
// captured through the released WIP owner, and schedule retirement,
// disposition persistence and proceeds-right storage stay with that owner.
//
// No database and no runtime. P is the qualified NET proceeds, never gross
// cash including VAT; V is the separately qualified output VAT. A bound
// failure is an error rather than a partial disposal or an inferred rate.

export const DisposalFailureCode = Schema.Literals([
  "StaleDispositionBasis",
  "NegativeCarrying",
  "NonPositiveProceedsCash",
  "ProceedsMismatch",
  "UnsupportedProceedsMode",
  "UnsupportedProceedsAccounting",
  "DoubleProceedsUse",
  "UnbalancedJournal",
]);

export type DisposalFailureCode = typeof DisposalFailureCode.Type;

export const DisposalFailure = Schema.Struct({
  code: DisposalFailureCode,
  message: Description,
});

export type DisposalFailure = typeof DisposalFailure.Type;

export type Checked<A> = Result.Result<A, DisposalFailure>;

function fail(code: DisposalFailureCode, message: string): Checked<never> {
  return Result.fail({ code, message });
}

function refuse<A>(result: Checked<A>): Checked<never> {
  return Result.isFailure(result)
    ? Result.fail(result.failure)
    : fail("StaleDispositionBasis", "A checked stage unexpectedly succeeded.");
}

function amount(value: bigint) {
  return value.toString();
}

// Impairment-aware disposition basis as captured by the reserved asset
// owner: G gross cost, A imported ordinary accumulation plus later
// effective ordinary recognition, I effective impairment. B = G-A-I.
export const DispositionBasis = Schema.Struct({
  assetId: Identifier,
  bookId: Identifier,
  grossMinor: MinorUnits,
  ordinaryAccumulationMinor: MinorUnits,
  impairmentMinor: MinorUnits,
  basisDigest: Digest,
  basisVersion: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  basisCurrent: Schema.Boolean,
});

export type DispositionBasis = typeof DispositionBasis.Type;

export const ProceedsIdentity = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(200),
);

export const UnpostedCashProceeds = Schema.Struct({
  kind: Schema.Literal("unposted_cash_sale"),
  netMinor: MinorUnits,
  vatMinor: MinorUnits,
  cashAccountId: Identifier,
  outputVatAccountId: Identifier,
  evidenceId: Identifier,
  proceedsIdentity: ProceedsIdentity,
});

export const InvoicedProceeds = Schema.Struct({
  kind: Schema.Literal("existing_legal_invoice"),
  netMinor: MinorUnits,
  taxMinor: MinorUnits,
  invoiceLineId: Identifier,
  // Exactly one of the two accounting modes below is selected.
  clearingAccountId: Schema.NullOr(Identifier),
  originalRevenueAccountId: Schema.NullOr(Identifier),
  reclassificationSupported: Schema.Boolean,
  proceedsIdentity: ProceedsIdentity,
});

export const Proceeds = Schema.Union([UnpostedCashProceeds, InvoicedProceeds]);

export type Proceeds = typeof Proceeds.Type;

export const DisposalRoles = Schema.Struct({
  grossAssetAccountId: Identifier,
  ordinaryAccumulationAccountId: Identifier,
  impairmentContraAccountId: Identifier,
  disposalGainAccountId: Identifier,
  disposalLossAccountId: Identifier,
});

export type DisposalRoles = typeof DisposalRoles.Type;

export const DisposalInput = Schema.Struct({
  basis: DispositionBasis,
  proceeds: Proceeds,
  roles: DisposalRoles,
  // Proceeds identities the asset owner already consumed. The first profile
  // rejects allocating one undivided invoice line to several assets unless
  // an explicit allocation owner supplies conserved shares.
  knownProceedsIdentities: Schema.Array(ProceedsIdentity),
  disposalId: Identifier,
});

export type DisposalInput = typeof DisposalInput.Type;

export const SaleTaxFact = Schema.Struct({
  baseMinor: MinorUnits,
  outputMinor: MinorUnits,
});

export type SaleTaxFact = typeof SaleTaxFact.Type;

export const DisposalPlan = Schema.Struct({
  disposalId: Identifier,
  assetId: Identifier,
  carryingRemovedMinor: MinorUnits,
  profitMinor: SignedMinorUnits,
  usedProceedsIdentity: ProceedsIdentity,
  basisDigest: Digest,
  saleTaxFacts: Schema.Array(SaleTaxFact),
  newCashReceivableOrVatFacts: Schema.Boolean,
  journal: Schema.Array(
    Schema.Struct({
      sourceLineId: Schema.NullOr(Identifier),
      accountId: Identifier,
      debitMinor: MinorUnits,
      creditMinor: MinorUnits,
      description: Description,
    }),
  ),
  stopFutureOccurrences: Schema.Boolean,
});

export type DisposalPlan = typeof DisposalPlan.Type;

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

// B = G-A-I. A negative carrying is a broken basis, never a disposal.
function carryingOf(basis: DispositionBasis): Checked<bigint> {
  const carrying =
    BigInt(basis.grossMinor) -
    BigInt(basis.ordinaryAccumulationMinor) -
    BigInt(basis.impairmentMinor);

  if (carrying < 0n) {
    return fail(
      "NegativeCarrying",
      "The disposition carrying cannot go negative; the asset basis is not current.",
    );
  }

  return Result.succeed(carrying);
}

export function compileDisposal(input: DisposalInput): Checked<DisposalPlan> {
  if (!input.basis.basisCurrent) {
    return fail(
      "StaleDispositionBasis",
      "The disposition basis must be exact and current at the cutoff.",
    );
  }

  if (input.knownProceedsIdentities.includes(input.proceeds.proceedsIdentity)) {
    return fail(
      "DoubleProceedsUse",
      "These proceeds were already consumed by a disposal; one economic relationship per disposal.",
    );
  }

  const carrying = carryingOf(input.basis);

  if (Result.isFailure(carrying)) return refuse(carrying);

  const profit = BigInt(input.proceeds.netMinor) - carrying.success;
  const journal: Array<PurchaseJournalLine> = [];
  const saleTaxFacts: Array<SaleTaxFact> = [];
  let newFacts = false;

  if (input.proceeds.kind === "unposted_cash_sale") {
    const cash = BigInt(input.proceeds.netMinor) + BigInt(input.proceeds.vatMinor);

    if (cash <= 0n) {
      return fail(
        "NonPositiveProceedsCash",
        "An unposted cash sale needs an observed positive cash receipt.",
      );
    }

    addSigned(journal, {
      accountId: input.proceeds.cashAccountId,
      signedMinor: cash,
      description: "Asset sale cash receipt",
    });

    addSigned(journal, {
      accountId: input.proceeds.outputVatAccountId,
      signedMinor: -BigInt(input.proceeds.vatMinor),
      description: "Asset sale output VAT",
    });

    saleTaxFacts.push({
      baseMinor: input.proceeds.netMinor,
      outputMinor: input.proceeds.vatMinor,
    });

    newFacts = true;
  } else if (input.proceeds.kind === "existing_legal_invoice") {
    if (input.proceeds.clearingAccountId !== null) {
      addSigned(journal, {
        accountId: input.proceeds.clearingAccountId,
        signedMinor: BigInt(input.proceeds.netMinor),
        description: "Asset proceeds clearing",
      });
    } else if (
      input.proceeds.originalRevenueAccountId !== null &&
      input.proceeds.reclassificationSupported
    ) {
      // Offsets the already-recognized revenue P exactly once, replacing
      // its P&L effect with the disposal gain/loss below. The invoice's
      // genuine sales and VAT facts are not reversed.
      addSigned(journal, {
        accountId: input.proceeds.originalRevenueAccountId,
        signedMinor: BigInt(input.proceeds.netMinor),
        description: "Reclassify invoiced asset proceeds",
      });
    } else {
      return fail(
        "UnsupportedProceedsAccounting",
        "An invoiced disposal needs a dedicated clearing role or an explicitly supported revenue reclassification.",
      );
    }
  } else {
    return fail(
      "UnsupportedProceedsMode",
      "Only an unposted cash sale or an existing legal invoice starts a disposal.",
    );
  }

  addSigned(journal, {
    accountId: input.roles.ordinaryAccumulationAccountId,
    signedMinor: BigInt(input.basis.ordinaryAccumulationMinor),
    description: "Clear ordinary accumulation",
  });

  addSigned(journal, {
    accountId: input.roles.impairmentContraAccountId,
    signedMinor: BigInt(input.basis.impairmentMinor),
    description: "Clear impairment contra",
  });

  addSigned(journal, {
    accountId: input.roles.grossAssetAccountId,
    signedMinor: -BigInt(input.basis.grossMinor),
    description: "Remove gross asset",
  });

  if (profit > 0n) {
    addSigned(journal, {
      accountId: input.roles.disposalGainAccountId,
      signedMinor: -profit,
      description: "Disposal gain",
    });
  }

  if (profit < 0n) {
    addSigned(journal, {
      accountId: input.roles.disposalLossAccountId,
      signedMinor: -profit,
      description: "Disposal loss",
    });
  }

  const finished = assertBalancedJournal(journal, 4);

  if (Result.isFailure(finished)) return fail("UnbalancedJournal", finished.failure.message);

  return Result.succeed({
    disposalId: input.disposalId,
    assetId: input.basis.assetId,
    carryingRemovedMinor: amount(carrying.success),
    profitMinor: amount(profit),
    usedProceedsIdentity: input.proceeds.proceedsIdentity,
    basisDigest: input.basis.basisDigest,
    saleTaxFacts,
    newCashReceivableOrVatFacts: newFacts,
    journal: finished.success,
    stopFutureOccurrences: true,
  });
}

export const DisposalCurrent = Schema.Struct({
  basisVersion: DispositionBasis.fields.basisVersion,
  basisDigest: Digest,
  assetDisposed: Schema.Boolean,
  knownProceedsIdentities: DisposalInput.fields.knownProceedsIdentities,
});

export type DisposalCurrent = typeof DisposalCurrent.Type;

// Execution-time conservation inside the owning transaction: the asset is
// still undisposed, no intervening basis moved, and the proceeds identity
// is still unused.
export function assertDisposalConservation(
  plan: DisposalPlan,
  basis: DispositionBasis,
  current: DisposalCurrent,
): Checked<DisposalPlan> {
  if (!basis.basisCurrent || basis.basisDigest !== plan.basisDigest) {
    return fail(
      "StaleDispositionBasis",
      "An intervening installment, estimate or impairment moved the basis after the plan was sealed.",
    );
  }

  if (current.assetDisposed) {
    return fail(
      "StaleDispositionBasis",
      "The asset was already disposed after the plan was sealed.",
    );
  }

  if (current.knownProceedsIdentities.includes(plan.usedProceedsIdentity)) {
    return fail(
      "DoubleProceedsUse",
      "The proceeds identity was consumed after the plan was sealed.",
    );
  }

  return Result.succeed(plan);
}
