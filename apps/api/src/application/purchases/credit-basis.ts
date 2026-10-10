import * as Accounting from "@open-erp/contracts/accounting";
import * as Acceptance from "@open-erp/contracts/supplier-acceptance";
import * as Credits from "@open-erp/contracts/supplier-credits";
import * as Refunds from "@open-erp/contracts/supplier-refunds";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import type * as Schema from "effect/Schema";
import { compileUnpaidPurchaseCredit } from "@open-erp/domain/purchasing";
import {
  compilePaidSupplierCredit,
  type PaidPositionInput,
  type RefundFailureCode,
} from "@open-erp/domain/supplier-refunds";
import type { Transaction } from "../../db/transaction";
import * as Db from "../../db/purchases/credits";
import * as RefundDb from "../../db/purchases/refunds";
import * as RecognitionDb from "../../db/purchases/recognition";
import * as RecognitionContract from "@open-erp/contracts/supplier-recognition";
import * as Recognition from "./recognition";
import * as Ledger from "../../db/posting";
import * as Assets from "../../db/subledger/assets";
import { liveInvoice } from "../commerce/register";
import { failure } from "../failures";
import { digest } from "../json";
import { validatePlan } from "../posting";
import * as Shared from "./shared";

type Scope = typeof Accounting.Scope.Type;

type JsonObject = Schema.JsonObject;

type CreditInput = typeof Credits.PrepareSupplierCredit.Type;

type Invoice = Effect.Success<ReturnType<typeof liveInvoice>>;

type Action = typeof Accounting.VoucherPostingAction.Type;

type Review = typeof Acceptance.SupplierAcceptanceReview.Type;

type Receipt = typeof Credits.SupplierCreditReceipt.Type;

type CreditCommon = Pick<
  typeof Credits.SupplierCreditSnapshot.Type,
  | "invoice"
  | "acceptanceDigest"
  | "originalVoucherId"
  | "creditEvidence"
  | "amountMinor"
  | "creditDate"
  | "supplierCreditNumber"
>;

// The posted cost of a recognized source line: its net plus the tax the
// deduction decision did not allow.
function expenseOf(line: {
  readonly netMinor: string;
  readonly sourceTaxMinor: string;
  readonly deductibleTaxMinor: string;
}) {
  const nonDeductible = BigInt(line.sourceTaxMinor) - BigInt(line.deductibleTaxMinor);

  if (nonDeductible < 0n) return null;

  return (BigInt(line.netMinor) + nonDeductible).toString();
}

function signatures(
  lines: ReadonlyArray<{ accountId: string; debitMinor: string; creditMinor: string }>,
) {
  return lines
    .map((line) => `${line.accountId}:${line.debitMinor}:${line.creditMinor}`)
    .sort()
    .join("|");
}

function requireMatchingAcceptanceProfile(
  input: { readonly profile: string },
  acceptedProfile: string,
) {
  const purchase =
    input.profile === "swedish-purchase-full-credit-v1" ||
    input.profile === "swedish-purchase-partial-credit-v1";

  if (purchase && acceptedProfile !== "swedish-purchase-v1") return failure("UnsupportedProfile");

  if (
    input.profile === "synthetic-zero-tax-supplier-credit-v1" &&
    acceptedProfile !== "synthetic-manual-supplier-v1"
  )
    return failure("UnsupportedProfile");

  if (
    input.profile === "synthetic-gross-cost-supplier-credit-v1" &&
    acceptedProfile !== "synthetic-gross-cost-supplier-v1"
  )
    return failure("UnsupportedProfile");

  return Effect.void;
}

const readCreditParty = Effect.fn("purchases.credits.party")(function* (
  tx: Transaction,
  scope: Scope,
  input: { readonly invoiceId: string; readonly profile: string },
) {
  const accepted = (yield* Db.readAcceptance(tx, scope.bookId, input.invoiceId))[0];

  if (!accepted) return yield* failure("UnsupportedProfile");

  const acceptance = yield* Shared.decode(
    Acceptance.SupplierAcceptanceReceipt,
    accepted.acceptance,
  );

  const review = yield* Shared.decode(Acceptance.SupplierAcceptanceReview, accepted.review);

  yield* requireMatchingAcceptanceProfile(input, acceptance.profile);

  return { acceptance, review };
});

const requireUnconflictedCredit = Effect.fn("purchases.credits.unconflicted")(function* (
  tx: Transaction,
  scope: Scope,
  input: { readonly supplierCreditNumber: string; readonly creditEvidenceId: string },
  invoice: Invoice,
) {
  const conflicts = (yield* Db.readCreditConflicts(
    tx,
    scope.bookId,
    invoice.id,
    invoice.counterpartyId,
    input.supplierCreditNumber,
    input.creditEvidenceId,
  ))[0];

  if (!conflicts) return yield* failure("InternalError");

  if (conflicts.exported) return yield* failure("StaleDependency");

  if (conflicts.numberUsed) return yield* failure("IdempotencyConflict");

  if (conflicts.evidencePosted) return yield* failure("AlreadyPosted");
});

const requireCreditEvidence = Effect.fn("purchases.credits.evidence")(function* (
  tx: Transaction,
  scope: Scope,
  input: { readonly creditEvidenceId: string },
) {
  const evidence = (yield* Ledger.readEvidence(tx, scope.bookId, input.creditEvidenceId))[0];

  if (!evidence) return yield* failure("MissingEvidence");

  return evidence;
});

const readCreditPosting = Effect.fn("purchases.credits.posting")(function* (
  tx: Transaction,
  scope: Scope,
  input: { readonly creditDate: string },
  invoice: Invoice,
) {
  if (invoice.recognition === null) return yield* failure("UnsupportedProfile");
  const recognition = invoice.recognition;
  const voucher = (yield* Ledger.readVoucher(tx, scope.bookId, invoice.recognition.voucherId))[0];

  if (!voucher || input.creditDate < invoice.issuedOn || input.creditDate < voucher.postingDate)
    return yield* failure("InvalidJournal");

  if (!Accounting.isCalendarDate(input.creditDate)) return yield* failure("InvalidJournal");

  const action = yield* Shared.decode(Accounting.VoucherPostingAction, voucher.action);
  const control = action.lines.find((line) => line.lineId === recognition.lineId);

  if (
    !control ||
    control.accountId !== invoice.controlAccountId ||
    control.creditMinor !== invoice.amountMinor ||
    control.debitMinor !== "0"
  )
    return yield* failure("StaleDependency");

  return { voucher, action };
});

const syntheticCreditSnapshot = Effect.fn("purchases.credits.syntheticSnapshot")(function* (
  tx: Transaction,
  scope: Scope,
  input: CreditInput,
  action: Action,
  prior: ReadonlyArray<Receipt>,
  review: Review,
  amount: bigint,
  common: CreditCommon,
) {
  if (
    input.creditLines !== undefined ||
    (input.profile === "synthetic-gross-cost-supplier-credit-v1" && input.taxMinor === undefined)
  )
    return yield* failure("InvalidJournal");

  if (review.draftSnapshot.totals.taxMinor === null) return yield* failure("UnsupportedProfile");

  const tax = BigInt(input.taxMinor ?? "0");

  if (
    (input.profile === "synthetic-zero-tax-supplier-credit-v1" && tax !== 0n) ||
    tax > amount ||
    tax + prior.reduce((sum, credit) => sum + BigInt(credit.taxMinor), 0n) >
      BigInt(review.draftSnapshot.totals.taxMinor)
  )
    return yield* failure("InvalidJournal");

  const expense = action.lines.find(
    (line) =>
      line.accountId !== common.invoice.controlAccountId &&
      line.debitMinor === common.invoice.amountMinor &&
      line.creditMinor === "0",
  );

  if (!expense || action.lines.length !== 2) return yield* failure("UnsupportedProfile");

  if (
    (yield* Assets.readReservedAccounts(tx, scope.bookId)).some((a) => a.id === expense.accountId)
  )
    return yield* failure("StaleDependency");

  return yield* Shared.decode(Credits.SupplierCreditSnapshot, {
    ...common,
    expenseAccountId: expense.accountId,
    taxMinor: tax.toString(),
  });
});

// The locked original-line capacities a credit consumes, in recognition
// order. Both the unpaid and the paid credit paths share them: the only
// authority for how much of a source line may still be credited.
const loadCapacities = Effect.fn("purchases.credits.capacities")(function* (
  tx: Transaction,
  scope: Scope,
  creditLines: CreditInput["creditLines"],
  review: Review,
  recognition: typeof RecognitionContract.PurchaseRecognition.Type,
) {
  const originalLines = review.originalLines;

  if (!originalLines?.length || review.inputVatAccountId === undefined) {
    return yield* failure("UnsupportedProfile");
  }

  const counterparty = recognition.counterpartyId;

  if (counterparty === null) return yield* failure("UnsupportedProfile");

  const selected = creditLines ?? [];

  if (
    creditLines === undefined &&
    (selected.length !== 0 ||
      new Set(originalLines.map((line) => line.lineId)).size !== originalLines.length)
  ) {
    return yield* failure("InvalidJournal");
  }

  if (
    new Set(selected.map((line) => line.lineId)).size !== selected.length ||
    selected.some((line) => !originalLines.some((original) => original.lineId === line.lineId))
  ) {
    return yield* failure("InvalidJournal");
  }

  const capacities = yield* Effect.forEach(
    yield* RecognitionDb.lockCapacities(
      tx,
      scope.bookId,
      recognition.id,
      recognition.plan.lines.map((line) => line.sourceLineId),
    ),
    Recognition.capacityFor,
  );

  if (capacities.length !== recognition.plan.lines.length) {
    return yield* failure("StaleDependency");
  }

  return { capacities, counterparty, selected };
});

// A purchase credit releases the deduction the original recognition actually
// recorded, in proportion to the credited source tax, from the recognized
// original-line capacity. It never re-derives a rate of its own.
const purchaseCreditPlan = Effect.fn("purchases.credits.purchaseCreditPlan")(function* (
  tx: Transaction,
  scope: Scope,
  input: CreditInput,
  review: Review,
  recognition: typeof RecognitionContract.PurchaseRecognition.Type,
  payableAccountId: string,
  amounts: { readonly amount: bigint; readonly unpaidResidual: bigint },
) {
  const { capacities, counterparty, selected } = yield* loadCapacities(
    tx,
    scope,
    input.creditLines,
    review,
    recognition,
  );

  const creditIdentity = yield* Recognition.creditRecognitionId(
    Recognition.creditEconomicKey(counterparty, input.supplierCreditNumber),
  );

  const compiled = compileUnpaidPurchaseCredit({
    currencyScale: recognition.currencyScale,
    taxPoint: {
      taxPointOn: input.creditDate,
      basis: "document_date",
    },
    reportingObligationId: null,
    ruleReleaseId: recognition.profileWitness?.ruleReleaseId ?? null,
    // The credit's components are namespaced by the credit document's own
    // recognition identity, so re-reviewing one supplier credit document
    // resolves to the same components instead of forking new ones.
    taxComponentPrefix: creditIdentity,
    creditEvidence: {
      evidenceId: input.creditEvidenceId,
      sourceKey: `supplier_credit:${creditIdentity}`,
    },
    original: capacities,
    requested:
      selected.length > 0
        ? selected.map((line) => ({
            sourceLineId: line.lineId,
            creditNetMinor: line.netMinor,
            creditSourceTaxMinor: line.sourceTaxMinor,
          }))
        : capacities.map((capacity) => ({
            sourceLineId: capacity.sourceLineId,
            creditNetMinor: remainingOf(capacity.originalNetMinor, capacity.creditedNetMinor),
            creditSourceTaxMinor: remainingOf(
              capacity.originalSourceTaxMinor,
              capacity.creditedSourceTaxMinor,
            ),
          })),
    payableAccountId,
    unpaidResidualMinor: amounts.unpaidResidual.toString(),
  });

  if (Result.isFailure(compiled)) return yield* Recognition.refusalFor(compiled.failure.code);

  if (BigInt(compiled.success.creditGrossMinor) !== amounts.amount) {
    return yield* failure("InvalidJournal");
  }

  return {
    recognition,
    capacities,
    plan: compiled.success,
    releases: compiled.success.lines,
    adjustments: compiled.success.taxAdjustments,
  };
});

// A domain refund failure is an application refusal, never a truncation. The
// mapping keeps the existing public error family; no code is renamed.
function refundRefusalFor(code: RefundFailureCode) {
  switch (code) {
    case "DuplicateCreditIdentity":
      return failure("IdempotencyConflict");
    case "InsufficientLineCapacity":
    case "UnbalancedJournal":
    case "NonPositiveRefund":
      return failure("InvalidJournal");
    case "UnsupportedRefundSource":
      return failure("UnsupportedProfile");
    case "CreditExceedsOriginal":
    case "PaymentExceedsOriginal":
    case "RefundExceedsPrincipal":
    case "ExportReservationUnresolved":
    case "RefundCapacityExceeded":
    case "UnsupportedConsumedHistory":
      return failure("StaleDependency");
  }
}

type PaidCreditInput = typeof Refunds.PreparePaidSupplierCredit.Type;

// A paid credit compiles the same original-line releases as the unpaid path
// but splits the counterpart: the unpaid part releases the payable and the
// remainder raises an explicit refund receivable, with conservation against
// the live paid position. No FX, advances or general netting.
const paidCreditPlan = Effect.fn("purchases.credits.paidCreditPlan")(function* (
  tx: Transaction,
  scope: Scope,
  input: PaidCreditInput,
  review: Review,
  recognition: typeof RecognitionContract.PurchaseRecognition.Type,
  payableAccountId: string,
  position: PaidPositionInput,
  knownCreditNoteIdentities: ReadonlyArray<string>,
) {
  const { capacities, counterparty, selected } = yield* loadCapacities(
    tx,
    scope,
    input.creditLines,
    review,
    recognition,
  );

  const creditIdentity = yield* Recognition.creditRecognitionId(
    Recognition.creditEconomicKey(counterparty, input.supplierCreditNumber),
  );

  const compiled = compilePaidSupplierCredit({
    currencyScale: recognition.currencyScale,
    taxPoint: {
      taxPointOn: input.creditDate,
      basis: "document_date",
    },
    reportingObligationId: null,
    ruleReleaseId: recognition.profileWitness?.ruleReleaseId ?? null,
    taxComponentPrefix: creditIdentity,
    creditEvidence: {
      evidenceId: input.creditEvidenceId,
      sourceKey: `supplier_credit:${creditIdentity}`,
    },
    original: capacities,
    requested:
      selected.length > 0
        ? selected.map((line) => ({
            sourceLineId: line.lineId,
            creditNetMinor: line.netMinor,
            creditSourceTaxMinor: line.sourceTaxMinor,
          }))
        : capacities.map((capacity) => ({
            sourceLineId: capacity.sourceLineId,
            creditNetMinor: remainingOf(capacity.originalNetMinor, capacity.creditedNetMinor),
            creditSourceTaxMinor: remainingOf(
              capacity.originalSourceTaxMinor,
              capacity.creditedSourceTaxMinor,
            ),
          })),
    payableControlAccountId: payableAccountId,
    refundReceivableAccountId: input.refundReceivableAccountId,
    reservedMinor: "0",
    position,
    creditNoteIdentity: input.supplierCreditNumber,
    knownCreditNoteIdentities: [...knownCreditNoteIdentities],
  });

  if (Result.isFailure(compiled)) return yield* refundRefusalFor(compiled.failure.code);

  if (BigInt(compiled.success.creditGrossMinor) !== BigInt(input.amountMinor)) {
    return yield* failure("InvalidJournal");
  }

  return {
    recognition,
    capacities,
    plan: compiled.success,
    releases: compiled.success.lines,
    adjustments: compiled.success.taxAdjustments,
  };
});

function remainingOf(original: string, consumed: string) {
  const left = BigInt(original) - BigInt(consumed);

  if (left <= 0n) return "0";

  return left.toString();
}

// The retained purchase basis a credit adjusts: the owned recognition and
// the proof that the posted voucher still carries exactly the recognized
// expense and input-VAT shape. Both the unpaid and the paid credit paths
// share it, so a corrected original refuses in both.
const loadPurchaseBasis = Effect.fn("purchases.credits.purchaseBasis")(function* (
  tx: Transaction,
  scope: Scope,
  action: Action,
  common: CreditCommon,
  review: Review,
) {
  const row = (yield* RecognitionDb.readRecognitionByPayable(
    tx,
    scope.bookId,
    common.invoice.id,
  ))[0];

  if (!row) return yield* failure("UnsupportedProfile");

  const recognition = yield* Shared.decode(RecognitionContract.PurchaseRecognition, row.body);
  const original = recognition.plan.lines;
  const originalTax = original.reduce((sum, line) => sum + BigInt(line.sourceTaxMinor), 0n);
  const deductible = original.reduce((sum, line) => sum + BigInt(line.deductibleTaxMinor), 0n);

  const actual = action.lines.filter(
    (line) =>
      line.accountId !== common.invoice.controlAccountId &&
      line.accountId !== review.inputVatAccountId,
  );

  const postedExpenses = original.map((line) => expenseOf(line));

  if (
    postedExpenses.some((expense) => expense === null) ||
    signatures(actual) !==
      signatures(
        original.map((line, index) => ({
          accountId: line.expenseAccountId,
          debitMinor: postedExpenses[index] ?? "0",
          creditMinor: "0",
        })),
      ) ||
    (deductible > 0n &&
      !action.lines.some(
        (line) =>
          line.accountId === review.inputVatAccountId &&
          line.debitMinor === deductible.toString() &&
          line.creditMinor === "0",
      )) ||
    action.lines.length !== original.length + 1 + (deductible > 0n ? 1 : 0)
  ) {
    return yield* failure("StaleDependency");
  }

  return { recognition, original, originalTax, deductible };
});

const purchaseCreditSnapshot = Effect.fn("purchases.credits.purchaseSnapshot")(function* (
  tx: Transaction,
  scope: Scope,
  input: CreditInput,
  action: Action,
  prior: ReadonlyArray<Receipt>,
  review: Review,
  partial: boolean,
  amount: bigint,
  common: CreditCommon,
  unpaidResidual: bigint,
) {
  if (!review.originalLines?.length || review.inputVatAccountId === undefined) {
    return yield* failure("UnsupportedProfile");
  }

  if (
    !partial &&
    (amount !== BigInt(common.invoice.amountMinor) ||
      prior.length ||
      input.creditLines !== undefined)
  ) {
    return yield* failure("UnsupportedProfile");
  }

  const basis = yield* loadPurchaseBasis(tx, scope, action, common, review);

  const compiled = yield* purchaseCreditPlan(
    tx,
    scope,
    input,
    review,
    basis.recognition,
    common.invoice.controlAccountId,
    {
      amount,
      unpaidResidual,
    },
  );

  const tax = compiled.adjustments.reduce(
    (sum, adjustment) => sum + BigInt(adjustment.sourceTaxMinor),
    0n,
  );

  if (
    basis.originalTax < 0n ||
    (input.taxMinor !== undefined && input.taxMinor !== tax.toString())
  ) {
    return yield* failure("InvalidJournal");
  }

  const witnessFields: JsonObject =
    basis.recognition.profileWitness === null
      ? {}
      : { profileWitness: yield* Shared.toJsonObject(basis.recognition.profileWitness) };

  return yield* Shared.decode(
    Credits.SupplierCreditSnapshot,
    Object.assign({}, common, witnessFields, {
      recognitionId: basis.recognition.id,
      originalLines: compiled.capacities.map((capacity) => ({
        lineId: capacity.sourceLineId,
        expenseAccountId: capacity.expenseAccountId,
        netMinor: capacity.originalNetMinor,
        sourceTaxMinor: capacity.originalSourceTaxMinor,
        deductibleTaxMinor: capacity.originalDeductibleTaxMinor,
        creditedNetMinor: capacity.creditedNetMinor,
        creditedSourceTaxMinor: capacity.creditedSourceTaxMinor,
        releasedDeductionMinor: capacity.releasedDeductionMinor,
        taxComponentId: capacity.taxComponentId,
        taxFactId: capacity.taxFactId,
      })),
      inputVatAccountId: review.inputVatAccountId,
      lineReleases: compiled.releases.map((release) => ({
        sourceLineId: release.sourceLineId,
        expenseAccountId: release.expenseAccountId,
        inputVatAccountId: release.inputVatAccountId,
        creditNetMinor: release.creditNetMinor,
        creditSourceTaxMinor: release.creditSourceTaxMinor,
        releasedDeductionMinor: release.releasedDeductionMinor,
        expenseMinor: release.expenseMinor,
        taxComponentId: release.taxComponentId,
        creditedNetAfterMinor: release.creditedNetAfterMinor,
        creditedSourceTaxAfterMinor: release.creditedSourceTaxAfterMinor,
        releasedDeductionAfterMinor: release.releasedDeductionAfterMinor,
      })),
      taxAdjustments: compiled.adjustments.map((adjustment) => ({
        sourceLineId: adjustment.sourceLineId,
        componentRole: adjustment.componentRole,
        taxComponentId: adjustment.taxComponentId,
        taxFactId: adjustment.taxFactId,
        signedBaseMinor: adjustment.signedBaseMinor,
        signedOutputTaxMinor: adjustment.signedOutputTaxMinor,
        signedDeductibleTaxMinor: adjustment.signedDeductibleTaxMinor,
        sourceTaxMinor: adjustment.sourceTaxMinor,
        nonDeductibleTaxMinor: adjustment.nonDeductibleTaxMinor,
        basis: adjustment.treatmentId,
        taxPointOn: adjustment.taxPointOn,
        sourceRefs: adjustment.sourceRefs,
        adjustsTaxFactId: adjustment.adjustsTaxFactId,
      })),
      taxMinor: tax.toString(),
    }),
  );
});

// The refund receivable is an explicit reviewed account: active, never a
// reserved control, bank, tax or VAT account, and never the payable or
// input-VAT account of the credit it belongs to.
const checkRefundAccount = Effect.fn("purchases.credits.refundAccount")(function* (
  tx: Transaction,
  scope: Scope,
  input: PaidCreditInput,
  invoice: { readonly controlAccountId: string },
  review: Review,
) {
  const refundAccount = (yield* RefundDb.readActiveAccount(
    tx,
    scope.bookId,
    input.refundReceivableAccountId,
  ))[0];

  if (!refundAccount || !refundAccount.active) return yield* failure("StaleDependency");

  if (
    input.refundReceivableAccountId === invoice.controlAccountId ||
    input.refundReceivableAccountId === review.inputVatAccountId ||
    (yield* RefundDb.readReservedAccounts(tx, scope.bookId)).some(
      (reserved) => reserved.id === input.refundReceivableAccountId,
    )
  )
    return yield* failure("StaleDependency");
});

// The live paid position a paid credit compiles against: exact G/K/P/Q,
// the operator's expectations, the export-reservation fence and the
// single-account rule, all checked before any line is compiled.
const loadPaidPosition = Effect.fn("purchases.credits.paidPosition")(function* (
  tx: Transaction,
  scope: Scope,
  input: PaidCreditInput,
  invoice: Effect.Success<ReturnType<typeof liveInvoice>>,
  party: { readonly acceptance: { readonly digest: string } },
) {
  const positionRow = (yield* RefundDb.readPaidPosition(tx, scope.bookId, input.invoiceId))[0];

  if (!positionRow) return yield* failure("NotFound");

  const live = {
    originalGrossMinor: positionRow.grossMinor,
    creditedMinor: positionRow.creditedMinor,
    paidMinor: (
      BigInt(positionRow.allocatedLegsMinor) + BigInt(positionRow.ownerDischargeMinor)
    ).toString(),
    refundedMinor: positionRow.refundedMinor,
  };

  if (
    invoice.blockers.length ||
    live.originalGrossMinor !== input.expectedPosition.originalGrossMinor ||
    live.creditedMinor !== input.expectedPosition.creditedMinor ||
    live.paidMinor !== input.expectedPosition.paidMinor ||
    live.refundedMinor !== input.expectedPosition.refundedMinor ||
    invoice.allocationVersion !== input.expectedAllocationVersion ||
    invoice.currentRevision.revision !== input.expectedInvoiceRevision ||
    party.acceptance.digest !== input.acceptanceDigest
  )
    return yield* failure("StaleDependency");

  // One refund-receivable account per payable. A second account would fork
  // the receivable the refund receipts settle.
  if (
    positionRow.accountCount > 1 ||
    (positionRow.refundAccountId !== null &&
      positionRow.refundAccountId !== input.refundReceivableAccountId)
  )
    return yield* failure("StaleDependency");

  return { positionRow, live };
});

export const paidCreditSnapshot = Effect.fn("purchases.credits.paidSnapshot")(function* (
  tx: Transaction,
  scope: Scope,
  input: PaidCreditInput,
) {
  const book = yield* Shared.readBook(tx, scope.bookId);

  if (book.profile !== "synthetic-core-v1" || book.authority !== "native")
    return yield* failure("UnsupportedProfile");

  const invoice = yield* liveInvoice(tx, scope.bookId, input.invoiceId);

  if (invoice.direction !== "supplier") return yield* failure("NotFound");

  if (invoice.status === "cancelled") return yield* failure("StaleDependency");

  if (invoice.currency !== book.currency) return yield* failure("UnsupportedProfile");

  const party = yield* readCreditParty(tx, scope, input);

  const { live } = yield* loadPaidPosition(tx, scope, input, invoice, party);

  yield* requireUnconflictedCredit(tx, scope, input, invoice);

  const amount = BigInt(input.amountMinor);

  if (amount <= 0n) return yield* failure("InvalidJournal");

  const evidence = yield* requireCreditEvidence(tx, scope, input);
  const posting = yield* readCreditPosting(tx, scope, input, invoice);

  const prior = yield* Effect.forEach(yield* Db.listCredits(tx, scope.bookId, invoice.id), (row) =>
    Shared.decode(Credits.SupplierCreditReceipt, row.body),
  );

  const purchase =
    input.profile === "swedish-purchase-full-credit-v1" ||
    input.profile === "swedish-purchase-partial-credit-v1";

  if (!purchase) return yield* failure("UnsupportedProfile");

  if (
    input.profile === "swedish-purchase-full-credit-v1" &&
    (amount !== BigInt(live.originalGrossMinor) || prior.length || input.creditLines !== undefined)
  ) {
    return yield* failure("UnsupportedProfile");
  }

  if (!party.review.originalLines?.length || party.review.inputVatAccountId === undefined) {
    return yield* failure("UnsupportedProfile");
  }

  yield* checkRefundAccount(tx, scope, input, invoice, party.review);

  const common: CreditCommon = {
    invoice,
    acceptanceDigest: party.acceptance.digest,
    originalVoucherId: posting.voucher.id,
    creditEvidence: { evidenceId: evidence.id, sha256: evidence.sha256 },
    amountMinor: input.amountMinor,
    creditDate: input.creditDate,
    supplierCreditNumber: input.supplierCreditNumber,
  };

  const basis = yield* loadPurchaseBasis(tx, scope, posting.action, common, party.review);

  const compiled = yield* paidCreditPlan(
    tx,
    scope,
    input,
    party.review,
    basis.recognition,
    invoice.controlAccountId,
    live,
    prior.map((credit) => credit.supplierCreditNumber),
  );

  const tax = compiled.adjustments.reduce(
    (sum, adjustment) => sum + BigInt(adjustment.sourceTaxMinor),
    0n,
  );

  if (
    basis.originalTax < 0n ||
    (input.taxMinor !== undefined && input.taxMinor !== tax.toString())
  ) {
    return yield* failure("InvalidJournal");
  }

  const witnessFields: JsonObject =
    basis.recognition.profileWitness === null
      ? {}
      : { profileWitness: yield* Shared.toJsonObject(basis.recognition.profileWitness) };

  return yield* Shared.decode(
    Refunds.PaidSupplierCreditSnapshot,
    Object.assign({}, common, witnessFields, {
      recognitionId: basis.recognition.id,
      originalLines: compiled.capacities.map((capacity) => ({
        lineId: capacity.sourceLineId,
        expenseAccountId: capacity.expenseAccountId,
        netMinor: capacity.originalNetMinor,
        sourceTaxMinor: capacity.originalSourceTaxMinor,
        deductibleTaxMinor: capacity.originalDeductibleTaxMinor,
        creditedNetMinor: capacity.creditedNetMinor,
        creditedSourceTaxMinor: capacity.creditedSourceTaxMinor,
        releasedDeductionMinor: capacity.releasedDeductionMinor,
        taxComponentId: capacity.taxComponentId,
        taxFactId: capacity.taxFactId,
      })),
      inputVatAccountId: party.review.inputVatAccountId,
      lineReleases: compiled.releases.map((release) => ({
        sourceLineId: release.sourceLineId,
        expenseAccountId: release.expenseAccountId,
        inputVatAccountId: release.inputVatAccountId,
        creditNetMinor: release.creditNetMinor,
        creditSourceTaxMinor: release.creditSourceTaxMinor,
        releasedDeductionMinor: release.releasedDeductionMinor,
        expenseMinor: release.expenseMinor,
        taxComponentId: release.taxComponentId,
        creditedNetAfterMinor: release.creditedNetAfterMinor,
        creditedSourceTaxAfterMinor: release.creditedSourceTaxAfterMinor,
        releasedDeductionAfterMinor: release.releasedDeductionAfterMinor,
      })),
      taxAdjustments: compiled.adjustments.map((adjustment) => ({
        sourceLineId: adjustment.sourceLineId,
        componentRole: adjustment.componentRole,
        taxComponentId: adjustment.taxComponentId,
        taxFactId: adjustment.taxFactId,
        signedBaseMinor: adjustment.signedBaseMinor,
        signedOutputTaxMinor: adjustment.signedOutputTaxMinor,
        signedDeductibleTaxMinor: adjustment.signedDeductibleTaxMinor,
        sourceTaxMinor: adjustment.sourceTaxMinor,
        nonDeductibleTaxMinor: adjustment.nonDeductibleTaxMinor,
        basis: adjustment.treatmentId,
        taxPointOn: adjustment.taxPointOn,
        sourceRefs: adjustment.sourceRefs,
        adjustsTaxFactId: adjustment.adjustsTaxFactId,
      })),
      taxMinor: tax.toString(),
      paid: {
        apReleaseMinor: compiled.plan.apReleaseMinor,
        refundPrincipalIncreaseMinor: compiled.plan.refundPrincipalIncreaseMinor,
        refundReceivableAccountId: input.refundReceivableAccountId,
        positionBefore: live,
        positionAfter: {
          originalGrossMinor: live.originalGrossMinor,
          creditedMinor: (
            BigInt(live.creditedMinor) + BigInt(compiled.plan.creditGrossMinor)
          ).toString(),
          paidMinor: live.paidMinor,
          refundedMinor: live.refundedMinor,
        },
        unpaidAfterMinor: compiled.plan.positionAfter.unpaidMinor,
        refundPrincipalAfterMinor: compiled.plan.positionAfter.refundPrincipalMinor,
        refundDueAfterMinor: compiled.plan.positionAfter.refundDueMinor,
      },
    }),
  );
});

export const checkedPaidCredit = Effect.fn("purchases.credits.checkedPaid")(function* (
  tx: Transaction,
  scope: Scope,
  id: string,
  expected: string,
) {
  const row = (yield* Db.readCreditReview(tx, scope.bookId, id))[0];

  if (!row) return yield* failure("NotFound");
  const review = yield* Shared.decode(Refunds.PaidSupplierCreditReview, row.body);
  const body = Object.fromEntries(Object.entries(review).filter(([name]) => name !== "digest"));
  const saved = review.digest;

  if (
    saved !== expected ||
    (yield* digest(body)) !== saved ||
    (yield* Db.readCreditByReview(tx, scope.bookId, id)).length
  )
    return yield* failure("StaleDependency");
  const snapshot = yield* paidCreditSnapshot(tx, scope, review.input);

  if ((yield* digest(snapshot)) !== (yield* digest(review.snapshot)))
    return yield* failure("StaleDependency");
  yield* validatePlan(tx, scope, review.postingPlan);

  return review;
});

export const creditSnapshot = Effect.fn("purchases.credits.snapshot")(function* (
  tx: Transaction,
  scope: Scope,
  input: CreditInput,
) {
  const book = yield* Shared.readBook(tx, scope.bookId);

  if (book.profile !== "synthetic-core-v1" || book.authority !== "native")
    return yield* failure("UnsupportedProfile");

  const invoice = yield* liveInvoice(tx, scope.bookId, input.invoiceId);

  if (invoice.direction !== "supplier") return yield* failure("NotFound");

  const party = yield* readCreditParty(tx, scope, input);

  if (
    invoice.blockers.length ||
    invoice.outstandingMinor === null ||
    invoice.outstandingMinor !== input.expectedOutstandingMinor ||
    invoice.allocationVersion !== input.expectedAllocationVersion ||
    invoice.currentRevision.revision !== input.expectedInvoiceRevision ||
    party.acceptance.digest !== input.acceptanceDigest
  )
    return yield* failure("StaleDependency");

  yield* requireUnconflictedCredit(tx, scope, input, invoice);

  const amount = BigInt(input.amountMinor);

  if (amount <= 0n || amount > BigInt(invoice.outstandingMinor))
    return yield* failure("StaleDependency");

  const evidence = yield* requireCreditEvidence(tx, scope, input);
  const posting = yield* readCreditPosting(tx, scope, input, invoice);

  const prior = yield* Effect.forEach(yield* Db.listCredits(tx, scope.bookId, invoice.id), (row) =>
    Shared.decode(Credits.SupplierCreditReceipt, row.body),
  );

  const common: CreditCommon = {
    invoice,
    acceptanceDigest: party.acceptance.digest,
    originalVoucherId: posting.voucher.id,
    creditEvidence: { evidenceId: evidence.id, sha256: evidence.sha256 },
    amountMinor: input.amountMinor,
    creditDate: input.creditDate,
    supplierCreditNumber: input.supplierCreditNumber,
  };

  const purchase =
    input.profile === "swedish-purchase-full-credit-v1" ||
    input.profile === "swedish-purchase-partial-credit-v1";

  if (!purchase) {
    return yield* syntheticCreditSnapshot(
      tx,
      scope,
      input,
      posting.action,
      prior,
      party.review,
      amount,
      common,
    );
  }

  return yield* purchaseCreditSnapshot(
    tx,
    scope,
    input,
    posting.action,
    prior,
    party.review,
    input.profile === "swedish-purchase-partial-credit-v1",
    amount,
    common,
    BigInt(invoice.outstandingMinor),
  );
});

export const checkedCredit = Effect.fn("purchases.credits.checked")(function* (
  tx: Transaction,
  scope: Scope,
  id: string,
  expected: string,
) {
  const row = (yield* Db.readCreditReview(tx, scope.bookId, id))[0];

  if (!row) return yield* failure("NotFound");
  const review = yield* Shared.decode(Credits.SupplierCreditReview, row.body);
  const body = Object.fromEntries(Object.entries(review).filter(([name]) => name !== "digest"));
  const saved = review.digest;

  if (
    saved !== expected ||
    (yield* digest(body)) !== saved ||
    (yield* Db.readCreditByReview(tx, scope.bookId, id)).length
  )
    return yield* failure("StaleDependency");
  const snapshot = yield* creditSnapshot(tx, scope, review.input);

  if ((yield* digest(snapshot)) !== (yield* digest(review.snapshot)))
    return yield* failure("StaleDependency");
  yield* validatePlan(tx, scope, review.postingPlan);

  return review;
});
