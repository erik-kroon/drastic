import * as Accounting from "@open-erp/contracts/accounting";
import * as Acceptance from "@open-erp/contracts/supplier-acceptance";
import * as Credits from "@open-erp/contracts/supplier-credits";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type { Transaction } from "../../db/transaction";
import * as Db from "../../db/purchases/credits";
import * as Ledger from "../../db/posting";
import * as Assets from "../../db/subledger/assets";
import { liveInvoice } from "../commerce/register";
import { failure } from "../failures";
import { digest, validatePlan } from "../posting";
import * as Shared from "./shared";

type Scope = typeof Accounting.Scope.Type;

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

const OriginalLine = Schema.Struct({
  lineId: Accounting.Identifier,
  expenseAccountId: Accounting.Identifier,
  netMinor: Accounting.MinorUnits,
  taxMinor: Accounting.MinorUnits,
  vatRatePercent: Schema.Literals([0, 6, 12, 25]),
});

function signatures(
  lines: ReadonlyArray<{ accountId: string; debitMinor: string; creditMinor: string }>,
) {
  return lines
    .map((line) => `${line.accountId}:${line.debitMinor}:${line.creditMinor}`)
    .sort()
    .join("|");
}

function requireMatchingAcceptanceProfile(input: CreditInput, acceptedProfile: string) {
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
  input: CreditInput,
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
  input: CreditInput,
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
  input: CreditInput,
) {
  const evidence = (yield* Ledger.readEvidence(tx, scope.bookId, input.creditEvidenceId))[0];

  if (!evidence) return yield* failure("MissingEvidence");

  return evidence;
});

const readCreditPosting = Effect.fn("purchases.credits.posting")(function* (
  tx: Transaction,
  scope: Scope,
  input: CreditInput,
  invoice: Invoice,
) {
  const voucher = (yield* Ledger.readVoucher(tx, scope.bookId, invoice.recognition.voucherId))[0];

  if (!voucher || input.creditDate < invoice.issuedOn || input.creditDate < voucher.postingDate)
    return yield* failure("InvalidJournal");

  const date = Date.parse(`${input.creditDate}T00:00:00Z`);

  if (!Number.isFinite(date) || new Date(date).toISOString().slice(0, 10) !== input.creditDate)
    return yield* failure("InvalidJournal");

  const action = yield* Shared.decode(Accounting.VoucherPostingAction, voucher.action);
  const control = action.lines.find((line) => line.lineId === invoice.recognition.lineId);

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

const creditLineSelection = Effect.fn("purchases.credits.lineSelection")(function* (
  tx: Transaction,
  scope: Scope,
  invoiceId: string,
  input: CreditInput,
  original: ReadonlyArray<typeof OriginalLine.Type>,
  partial: boolean,
) {
  if (!partial) return original;

  if (
    !input.creditLines?.length ||
    new Set(input.creditLines.map((line) => line.lineId)).size !== input.creditLines.length
  )
    return yield* failure("InvalidJournal");

  const previous = yield* Effect.forEach(
    yield* Db.readPriorCreditLines(tx, scope.bookId, invoiceId),
    (row) => Shared.decode(Credits.SupplierCreditSnapshot, row.snapshot),
  );

  const creditLines: Array<typeof OriginalLine.Type> = [];

  for (const requested of input.creditLines) {
    const line = original.find((line) => line.lineId === requested.lineId);

    if (!line) return yield* failure("InvalidJournal");

    const net = BigInt(requested.netMinor),
      tax = BigInt(requested.taxMinor),
      expectedTax = (net * BigInt(line.vatRatePercent) + 50n) / 100n;

    const used = previous
      .flatMap((snapshot) => snapshot.creditLines ?? [])
      .filter((prior) => prior.lineId === line.lineId);

    if (
      net <= 0n ||
      tax < expectedTax - 1n ||
      tax > expectedTax + 1n ||
      net + used.reduce((sum, prior) => sum + BigInt(prior.netMinor), 0n) > BigInt(line.netMinor) ||
      tax + used.reduce((sum, prior) => sum + BigInt(prior.taxMinor), 0n) > BigInt(line.taxMinor)
    )
      return yield* failure("InvalidJournal");
    creditLines.push({ ...line, netMinor: requested.netMinor, taxMinor: requested.taxMinor });
  }

  return creditLines;
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
) {
  if (!review.originalLines?.length || !review.inputVatAccountId)
    return yield* failure("UnsupportedProfile");

  if (
    !partial &&
    (amount !== BigInt(common.invoice.amountMinor) ||
      prior.length ||
      input.creditLines !== undefined)
  )
    return yield* failure("UnsupportedProfile");

  const original = review.originalLines;
  const originalTax = original.reduce((sum, line) => sum + BigInt(line.taxMinor), 0n);

  const actual = action.lines.filter(
    (line) =>
      line.accountId !== common.invoice.controlAccountId &&
      line.accountId !== review.inputVatAccountId,
  );

  if (
    signatures(actual) !==
      signatures(
        original.map((line) => ({
          accountId: line.expenseAccountId,
          debitMinor: line.netMinor,
          creditMinor: "0",
        })),
      ) ||
    (originalTax > 0n &&
      !action.lines.some(
        (line) =>
          line.accountId === review.inputVatAccountId &&
          line.debitMinor === originalTax.toString() &&
          line.creditMinor === "0",
      )) ||
    action.lines.length !== original.length + 1 + (originalTax > 0n ? 1 : 0)
  )
    return yield* failure("StaleDependency");

  const creditLines = yield* creditLineSelection(
    tx,
    scope,
    common.invoice.id,
    input,
    original,
    partial,
  );

  const tax = creditLines.reduce((sum, line) => sum + BigInt(line.taxMinor), 0n);

  if (
    creditLines.reduce((sum, line) => sum + BigInt(line.netMinor) + BigInt(line.taxMinor), 0n) !==
      amount ||
    (input.taxMinor !== undefined && input.taxMinor !== tax.toString())
  )
    return yield* failure("InvalidJournal");

  const snapshot = {
    ...common,
    originalLines: original,
    inputVatAccountId: review.inputVatAccountId,
    taxMinor: tax.toString(),
  };

  if (!partial) return yield* Shared.decode(Credits.SupplierCreditSnapshot, snapshot);

  return yield* Shared.decode(Credits.SupplierCreditSnapshot, { ...snapshot, creditLines });
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
