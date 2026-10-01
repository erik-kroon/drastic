import * as Accounting from "@open-erp/contracts/accounting";
import * as Operation from "@open-erp/contracts/owner-operations";
import * as RecognitionContract from "@open-erp/contracts/supplier-recognition";
import {
  compileOwnerFunding,
  compileOwnerPayableTransfer,
  compileOwnerReimbursement,
  type OwnerJournalLine,
} from "@open-erp/domain/owner-funding";
import { compileDomesticPurchase, type PurchaseRecognitionPlan } from "@open-erp/domain/purchasing";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { liveInvoice } from "../commerce/register";
import { digest } from "../json";
import { admitAccountRole, admitLineOwner } from "../resource-admission";
import * as AcceptanceDb from "../../db/purchases/acceptance";
import * as PaymentDb from "../../db/purchases/payments";
import * as OperationDb from "../../db/subledger/owner-operations";
import * as OwnerDb from "../../db/subledger/owners";
import * as RecognitionDb from "../../db/purchases/recognition";
import * as Db from "../../db/posting";
import { databaseFailure, type Transaction } from "../../db/transaction";
import { failure } from "../failures";
import { withAdmittedPrincipal, type AuthorityLockMode, type VerifiedPrincipal } from "../identity";
import {
  approveChangeInTransaction,
  executeChangeInTransaction,
  isoNow,
  newId,
  prepareJournalInTransaction,
  replay,
  saveCommand,
  validatePlan,
} from "../posting";
import * as PurchaseShared from "../purchases/shared";
import * as Recognition from "../purchases/recognition";
import { readCapacity, sealOwnerAggregateInTransaction } from "./owners";

type Scope = typeof Accounting.Scope.Type;

type Principal = VerifiedPrincipal;

type Json = Schema.Json;

type Input = Operation.PrepareOwnerOperation;

type PurchaseInput = Extract<Input, { readonly mode: "owner_paid_purchase" }>;

type PayableInput = Extract<Input, { readonly mode: "owner_pays_payable" }>;

type ReimburseInput = Extract<Input, { readonly mode: "reimburse_owner" }>;

type FundingMode = Extract<Input, { readonly mode: "owner_loan" | "owner_contribution" }>;

type Review = typeof Operation.OwnerOperationReview.Type;

const ReviewSchema = Operation.OwnerOperationReview;

const ApprovalSchema = Operation.OwnerOperationApproval;

const ReceiptSchema = Operation.OwnerOperationReceipt;

const PaidPurchaseSchema = Operation.OwnerPurchaseRecognition;

const operation = "owners_execute_operation";

const prepareOperation = "owners_prepare_operation";

const approveOperation = "owners_approve_operation";

// The same account the supplier-paid purchase path resolves for this book. It is
// resolved here rather than taken from the caller, so who funded the purchase
// cannot change which input VAT account the purchase is recognized against.
const inputVatBasAccount = "2641";

const maximumAllocations = 50;

const maximumGroupsPerEvent = 50;

const approvalWindowMs = 60 * 60 * 1000;

function unsupported() {
  return failure("UnsupportedProfile");
}

function withOwnerBook<A>(
  token: string,
  scope: Scope,
  operatorOnly: boolean,
  operation_: (transaction: Transaction, principal: Principal) => Effect.Effect<A, unknown, never>,
  lockMode: AuthorityLockMode,
) {
  return withAdmittedPrincipal(
    { token },
    scope,
    { operatorOnly },
    (transaction, principal) =>
      operation_(transaction, principal).pipe(Effect.mapError(databaseFailure)),
    lockMode,
  );
}

// Every table this operation touches must be readable for the runtime role, and
// every table it writes must also be insertable. A missing grant is a refusal,
// not a partial write.
function requireOperationAccess(transaction: Transaction, write: boolean) {
  return Effect.gen(function* () {
    const owned = yield* OperationDb.readAccess(transaction);

    if (owned.length !== OperationDb.operationTables.length) return yield* unsupported();

    if (owned.some((row) => !row.canSelect || (write && !row.canInsert))) {
      return yield* unsupported();
    }

    const owner = yield* OwnerDb.readOwnerAccess(transaction);

    if (owner.length !== OwnerDb.ownerTables.length) return yield* unsupported();

    if (owner.some((row) => !row.canSelect)) return yield* unsupported();
  });
}

// The owner aggregate tables this operation seals into. It reuses the retained
// owner register, so its grants are the register's, and the same check applies.
const ownerAggregateTables = [
  "owner_records",
  "owner_revisions",
  "owner_reviews",
  "owner_control_accounts",
  "owner_effects",
] as const;

function requireOwnerWriteColumns(transaction: Transaction) {
  return PurchaseShared.requireColumns(transaction, [
    "books.profile_version",
    "books.writer_epoch",
    "accounts.version",
  ]).pipe(
    Effect.flatMap(() =>
      PurchaseShared.requireTables(transaction, ownerAggregateTables, ownerAggregateTables),
    ),
  );
}

function readBook(transaction: Transaction, scope: Scope) {
  return Db.readBook(transaction, scope).pipe(
    Effect.flatMap((rows) =>
      rows[0] === undefined ? failure("Forbidden") : Effect.succeed(rows[0]),
    ),
  );
}

function requireNativeProfile(book: { readonly profile: string; readonly authority: string }) {
  return PurchaseShared.requireNativeCommerceProfile(book.profile, book.authority);
}

function readOwner(transaction: Transaction, bookId: string, ownerId: string) {
  return OwnerDb.readOwner(transaction, bookId, ownerId).pipe(
    Effect.flatMap((rows) =>
      rows[0] === undefined ? failure("NotFound") : Effect.succeed(rows[0]),
    ),
  );
}

// The reviewed owner control account. It must be active and must not already
// belong to the bank, commerce, VAT or tax families, so an owner liability can
// never quietly be a supplier payable, a company bank account or a VAT account.
function requireOwnerControlAccount(
  transaction: Transaction,
  bookId: string,
  accountId: string,
  excluded: ReadonlyArray<string>,
) {
  return Effect.gen(function* () {
    if (excluded.includes(accountId)) return yield* failure("InvalidJournal");

    const account = (yield* Db.readAccounts(transaction, bookId, [accountId])).find(
      (row) => row.id === accountId,
    );

    if (account === undefined || !account.active) return yield* failure("InvalidJournal");

    yield* admitAccountRole(transaction, bookId, accountId, "owner");

    return account;
  });
}

// The company's own registered bank or cash account. It must be a reviewed bank
// source, so a reimbursement or a funding inflow is a company cash movement
// rather than a guessed account.
function requireCashAccount(transaction: Transaction, bookId: string, accountId: string) {
  return Effect.gen(function* () {
    const account = (yield* Db.readAccounts(transaction, bookId, [accountId])).find(
      (row) => row.id === accountId,
    );

    if (account === undefined || !account.active) return yield* failure("InvalidJournal");

    // This read reports whether the account is registered as a bank source, so
    // here presence is the requirement rather than a conflict.
    if (
      (yield* AcceptanceDb.readBankSourceConflict(transaction, bookId, [accountId]))[0]?.present !==
      true
    ) {
      return yield* failure("InvalidJournal");
    }

    yield* admitAccountRole(transaction, bookId, accountId, "bank");
  });
}

type CompiledLine = {
  readonly accountId: string;
  readonly debitMinor: string;
  readonly creditMinor: string;
  readonly description: string;
};

function journalLines(group: ReadonlyArray<OwnerJournalLine>): ReadonlyArray<CompiledLine> {
  return group.map((line) => ({
    accountId: line.accountId,
    debitMinor: line.debitMinor,
    creditMinor: line.creditMinor,
    description: line.description,
  }));
}

function controlSideOf(line: { readonly debitMinor: string; readonly creditMinor: string }) {
  return BigInt(line.debitMinor) > 0n ? ("debit" as const) : ("credit" as const);
}

// The one sealed line that carries the owner control account. Every compiled mode
// produces exactly one, and the executor re-locates it in the sealed plan.
function findControlLine<T extends { readonly accountId: string }>(
  lines: ReadonlyArray<T>,
  controlAccountId: string,
): T | undefined {
  const matches = lines.filter((line) => line.accountId === controlAccountId);

  return matches.length === 1 ? matches[0] : undefined;
}

function ownerFailure(code: string) {
  if (code === "UnsupportedOwnerTreatment") return unsupported();

  return code === "OwnerAmountExceedsCapacity"
    ? failure("StaleDependency")
    : failure("InvalidJournal");
}

type Compiled = {
  readonly input: Input;
  readonly lines: ReadonlyArray<CompiledLine>;
  readonly ownerEffect: typeof Operation.OwnerEffectIntent.Type;
  readonly controlAccountId: string;
  readonly recognition: Review["recognition"];
  readonly reimburses: Review["reimburses"];
  readonly discharges: Review["discharges"];
  readonly evidenceId: string;
  readonly witness: Json;
  readonly gaps: Json;
  readonly description: string;
};

function compiled(input: Input, body: Omit<Compiled, "input">) {
  return { ...body, input } satisfies Compiled;
}

// The common invoice projection includes both commerce allocations and owner
// discharges. Do not subtract the owner receipt a second time here.
const readPayableCapacity = Effect.fn("owner.operations.payableCapacity")(function* (
  transaction: Transaction,
  scope: Scope,
  book: { readonly currency: string; readonly currencyScale: number },
  payableId: string,
) {
  const invoice = yield* liveInvoice(transaction, scope.bookId, payableId);

  if (invoice.recognition === null) return yield* failure("UnsupportedProfile");

  if (
    invoice.direction !== "supplier" ||
    invoice.status === "cancelled" ||
    invoice.outstandingMinor === null
  ) {
    return yield* failure("InvalidJournal");
  }

  if (invoice.currency !== book.currency || invoice.currencyScale !== book.currencyScale) {
    return yield* failure("InvalidJournal");
  }

  const payable = (yield* Db.readAccounts(transaction, scope.bookId, [
    invoice.controlAccountId,
  ])).find((row) => row.id === invoice.controlAccountId);

  if (payable === undefined || !payable.active) return yield* failure("InvalidJournal");

  const payment = (yield* PaymentDb.readInvoicePaymentFacts(
    transaction,
    scope.bookId,
    payableId,
  ))[0];

  if (payment === undefined || payment.exported) return yield* failure("StaleDependency");

  const remaining = BigInt(invoice.outstandingMinor);

  if (remaining <= 0n) return yield* failure("StaleDependency");

  return { payableAccountId: invoice.controlAccountId, remaining };
});

// The transfer of an already recognized supplier obligation from the payable to
// the owner liability. It creates no expense, no tax component and no company
// bank movement: the owner used a private account, and the original invoice and
// its recognition stay exactly as they were.
const compilePayableTransfer = Effect.fn("owner.operations.payableTransfer")(function* (
  transaction: Transaction,
  scope: Scope,
  book: { readonly currency: string; readonly currencyScale: number },
  command: {
    readonly controlAccountId: string;
    readonly payableId: string;
    readonly amountMinor: string;
    readonly paidEvidenceId: string;
  },
) {
  const control = yield* requireOwnerControlAccount(
    transaction,
    scope.bookId,
    command.controlAccountId,
    [command.payableId],
  );

  const capacity = yield* readPayableCapacity(transaction, scope, book, command.payableId);
  const remaining = capacity.remaining;

  const transfer = compileOwnerPayableTransfer({
    currencyScale: book.currencyScale,
    supplierPayableAccountId: capacity.payableAccountId,
    ownerLiabilityAccountId: control.id,
    amountMinor: command.amountMinor,
    description: `Owner payment of supplier payable ${command.payableId}`,
  });

  if (Result.isFailure(transfer)) return yield* ownerFailure(transfer.failure.code);

  const moved = BigInt(transfer.success.amountMinor);

  if (moved > remaining) return yield* failure("StaleDependency");

  const lines = journalLines(transfer.success.journal);

  if (findControlLine(lines, control.id) === undefined) return yield* failure("InternalError");

  return {
    lines,
    ownerEffect: {
      accountId: control.id,
      side: "credit" as const,
      classification: "owner_expense" as const,
      amountMinor: transfer.success.amountMinor,
    },
    controlAccountId: control.id,
    recognition: null,
    reimburses: [],
    discharges: {
      invoiceId: command.payableId,
      amountMinor: transfer.success.amountMinor,
      outstandingAfterMinor: (remaining - moved).toString(),
    },
    evidenceId: command.paidEvidenceId,
    witness: null,
    gaps: [],
    description: transfer.success.journal[0]?.description ?? "Owner payment of supplier payable",
  };
});

// A new owner-paid purchase. The tax decision, the deduction decision and the
// signed components are the source-line purchase compiler's; only the funding
// role differs, so the funding leg is the reviewed owner liability instead of a
// supplier payable.
const compilePaidPurchase = Effect.fn("owner.operations.paidPurchase")(function* (
  transaction: Transaction,
  scope: Scope,
  book: { readonly currency: string; readonly currencyScale: number },
  input: PurchaseInput,
) {
  const control = yield* requireOwnerControlAccount(
    transaction,
    scope.bookId,
    input.controlAccountId,
    [],
  );

  const vat =
    (yield* AcceptanceDb.readBasAccount(transaction, scope.bookId, inputVatBasAccount))[0]?.id ??
    "";

  if (vat === "" || vat === control.id) return yield* failure("InvalidJournal");
  const purchase = input.purchase;

  if (purchase.taxPoint.taxPointOn > purchase.documentDate) return yield* failure("InvalidJournal");

  if (
    purchase.taxPoint.basis === "document_date" &&
    purchase.taxPoint.taxPointOn !== purchase.documentDate
  ) {
    return yield* failure("InvalidJournal");
  }

  if (new Set(purchase.lines.map((line) => line.lineId)).size !== purchase.lines.length) {
    return yield* failure("InvalidJournal");
  }

  for (const line of purchase.lines) {
    yield* Recognition.requireConsistentTreatment(
      line.treatment,
      line.netMinor,
      line.sourceTaxMinor,
    );

    if (
      (yield* AcceptanceDb.readExpenseAccount(transaction, scope.bookId, line.expenseAccountId, [
        control.id,
        vat,
      ])).length === 0
    ) {
      return yield* failure("InvalidJournal");
    }
  }

  const witness = yield* Recognition.readVatWitness(
    transaction,
    scope,
    purchase.taxPoint.taxPointOn,
  );

  const ruleReleaseId = PurchaseShared.textField(witness.witness, "ruleReleaseId") ?? null;

  const economicKey = Recognition.economicKey(
    purchase.counterpartyId,
    purchase.supplierDocumentNumber,
  );

  // The tax component identity is namespaced by the economic document, so two
  // owner-paid purchases never claim one component id for a reused line id.
  const componentPrefix = `owner_paid_${(yield* digest(economicKey)).replace("sha256:", "").slice(0, 32)}`;

  const compiledPurchase = compileDomesticPurchase({
    currencyScale: book.currencyScale,
    recognitionDate: purchase.documentDate,
    taxPoint: purchase.taxPoint,
    funding: {
      accountId: control.id,
      role: "owner_liability",
      inputVatAccountId: vat,
    },
    reportingObligationId: null,
    ruleReleaseId,
    taxComponentPrefix: componentPrefix,
    lines: purchase.lines.map((line) => ({
      sourceLineId: line.lineId,
      expenseAccountId: line.expenseAccountId,
      netMinor: line.netMinor,
      sourceTaxMinor: line.sourceTaxMinor,
      sourceGrossMinor: (BigInt(line.netMinor) + BigInt(line.sourceTaxMinor)).toString(),
      treatment: {
        treatmentId: line.treatment.basis,
        rate: line.treatment.rate,
        deduction: line.treatment.deduction,
        invoiceTaxRounding: line.treatment.invoiceTaxRounding,
        deductionRounding: line.treatment.deductionRounding,
        acceptancePolicy: line.treatment.acceptancePolicy,
        toleranceMinor: line.treatment.toleranceMinor,
        basis: line.treatment.basis,
      },
      sourceRefs: [
        { evidenceId: purchase.sourceEvidenceId, sourceKey: `owner_line:${line.lineId}` },
      ],
    })),
  });

  if (Result.isFailure(compiledPurchase)) {
    return yield* Recognition.refusalFor(compiledPurchase.failure.code);
  }

  const plan = wirePlan(compiledPurchase.success, purchase.lines);
  const lines = journalLines(compiledPurchase.success.journal);

  if (findControlLine(lines, control.id) === undefined) return yield* failure("InternalError");

  return {
    lines,
    ownerEffect: {
      accountId: control.id,
      side: "credit" as const,
      classification: "owner_expense" as const,
      amountMinor: compiledPurchase.success.payableMinor,
    },
    controlAccountId: control.id,
    recognition: {
      economicKey,
      counterpartyId: purchase.counterpartyId,
      supplierDocumentNumber: purchase.supplierDocumentNumber,
      recognitionDate: purchase.documentDate,
      taxPoint: purchase.taxPoint,
      grossMinor: compiledPurchase.success.payableMinor,
      plan,
      ruleReleaseId,
    },
    reimburses: [],
    discharges: null,
    evidenceId: purchase.sourceEvidenceId,
    witness: PurchaseShared.isJsonObject(witness.witness) ? witness.witness : null,
    gaps: witness.gaps,
    description: `Owner-paid purchase ${purchase.supplierDocumentNumber}`,
  };
});

// The sealed plan keeps the purchase compiler's exact lines, deduction decisions
// and signed tax components; only the deduction basis is restated in the wire
// vocabulary the source-line recognition owner already publishes.
function wirePlan(
  plan: PurchaseRecognitionPlan,
  lines: ReadonlyArray<{
    readonly lineId: string;
    readonly treatment: { readonly basis: typeof RecognitionContract.DeductionBasis.Type };
  }>,
): typeof RecognitionContract.RecognitionPlan.Type {
  return {
    totalNetMinor: plan.totalNetMinor,
    totalSourceTaxMinor: plan.totalSourceTaxMinor,
    totalDeductibleTaxMinor: plan.totalDeductibleTaxMinor,
    totalNonDeductibleTaxMinor: plan.totalNonDeductibleTaxMinor,
    payableMinor: plan.payableMinor,
    lines: plan.lines.map((line) => ({ ...line })),
    taxFacts: plan.taxFacts.map((fact) => ({
      sourceLineId: fact.sourceLineId,
      componentRole: fact.componentRole,
      taxComponentId: fact.taxComponentId,
      // The identity the component is persisted and referenced under. A later
      // credit's adjustment names it, so it must survive the restatement into the
      // wire vocabulary rather than being dropped.
      taxFactId: fact.taxFactId,
      signedBaseMinor: fact.signedBaseMinor,
      signedOutputTaxMinor: fact.signedOutputTaxMinor,
      signedDeductibleTaxMinor: fact.signedDeductibleTaxMinor,
      sourceTaxMinor: fact.sourceTaxMinor,
      nonDeductibleTaxMinor: fact.nonDeductibleTaxMinor,
      basis:
        lines.find((line) => line.lineId === fact.sourceLineId)?.treatment.basis ?? "no_tax_exempt",
      taxPointOn: fact.taxPointOn,
      sourceRefs: fact.sourceRefs,
      adjustsTaxFactId: fact.adjustsTaxFactId,
    })),
    journal: plan.journal.map((line) => ({ ...line })),
  } satisfies typeof RecognitionContract.RecognitionPlan.Type;
}

// One exact group per mode, decided from the current books, accounts, evidence
// and capacities. Nothing here is calculated from a bank description, an owner
// identity or a document total.
const compileOperation = Effect.fn("owner.operations.compile")(function* (
  transaction: Transaction,
  scope: Scope,
  input: Input,
) {
  const book = yield* readBook(transaction, scope);
  yield* readOwner(transaction, scope.bookId, input.ownerId);
  const description = `${input.mode} ${input.reason}`.slice(0, 2000);

  if (input.mode === "owner_paid_purchase") {
    const existing = (yield* RecognitionDb.readRecognitionByCounterpartyDocument(
      transaction,
      scope.bookId,
      input.purchase.counterpartyId,
      input.purchase.supplierDocumentNumber,
    ))[0];

    // The same economic document is never recognized twice. When a supplier
    // recognition already owns it, the owner's payment is the discharge of that
    // obligation rather than a second purchase.
    if (existing !== undefined) {
      if (existing.eventOwner !== "supplier_purchase") return yield* unsupported();

      if (
        (yield* OperationDb.readRecognitionByEconomicKey(
          transaction,
          scope.bookId,
          existing.economicKey,
        ))[0]?.present === true
      ) {
        return yield* failure("AlreadyPosted");
      }

      if (
        (yield* OperationDb.readPaidPurchaseByDocument(
          transaction,
          scope.bookId,
          input.purchase.counterpartyId,
          input.purchase.supplierDocumentNumber,
        ))[0]?.present === true
      ) {
        return yield* failure("AlreadyPosted");
      }

      const capacity = yield* readPayableCapacity(transaction, scope, book, existing.payableId);

      const derived: PayableInput = {
        ownerId: input.ownerId,
        controlAccountId: input.controlAccountId,
        accountingPeriodId: input.accountingPeriodId,
        postingDate: input.postingDate,
        series: input.series,
        reason: input.reason,
        mode: "owner_pays_payable",
        amountMinor: capacity.remaining.toString(),
        evidence: {
          payableId: existing.payableId,
          paidEvidenceId: input.evidence.paidEvidenceId,
          reason: input.reason,
        },
      };

      return compiled(
        derived,
        yield* compilePayableTransfer(transaction, scope, book, {
          controlAccountId: input.controlAccountId,
          payableId: existing.payableId,
          amountMinor: derived.amountMinor,
          paidEvidenceId: input.evidence.paidEvidenceId,
        }),
      );
    }

    if (
      (yield* OperationDb.readRecognitionByEconomicKey(
        transaction,
        scope.bookId,
        Recognition.economicKey(
          input.purchase.counterpartyId,
          input.purchase.supplierDocumentNumber,
        ),
      ))[0]?.present === true
    ) {
      return yield* failure("AlreadyPosted");
    }

    return compiled(input, yield* compilePaidPurchase(transaction, scope, book, input));
  }

  if (input.mode === "owner_pays_payable") {
    return compiled(
      input,
      yield* compilePayableTransfer(transaction, scope, book, {
        controlAccountId: input.controlAccountId,
        payableId: input.evidence.payableId,
        amountMinor: input.amountMinor,
        paidEvidenceId: input.evidence.paidEvidenceId,
      }),
    );
  }

  if (input.mode === "reimburse_owner") {
    return compiled(input, yield* compileReimbursement(transaction, scope, book, input));
  }

  return compiled(input, yield* compileFunding(transaction, scope, book, input, description));
});

// One payment may consume several owner claims. Every leg is positive, bounded by
// its own claim's current remaining capacity, and a claim appears once. A claim
// keeps its original source and its prior allocations.
const compileReimbursement = Effect.fn("owner.operations.reimbursement")(function* (
  transaction: Transaction,
  scope: Scope,
  book: { readonly currency: string; readonly currencyScale: number },
  input: ReimburseInput,
) {
  const control = yield* requireOwnerControlAccount(
    transaction,
    scope.bookId,
    input.controlAccountId,
    [input.cashAccountId],
  );

  yield* requireCashAccount(transaction, scope.bookId, input.cashAccountId);

  if (input.evidence.allocations.length > maximumAllocations)
    return yield* failure("InvalidJournal");

  const seen = new Set<string>();
  const capacities: Array<{ claimId: string; remainingMinor: string }> = [];

  for (const leg of input.evidence.allocations) {
    if (seen.has(leg.claimId)) return yield* failure("InvalidJournal");

    seen.add(leg.claimId);

    const claim = yield* readCapacity(transaction, scope, leg.claimId);
    const effect = claim.effect;

    if (
      effect.classification !== "owner_expense" ||
      effect.side !== "credit" ||
      effect.ownerId !== input.ownerId ||
      effect.accountId !== control.id ||
      effect.currency !== book.currency ||
      effect.currencyScale !== book.currencyScale ||
      effect.postingDate > input.postingDate
    ) {
      return yield* failure("InvalidJournal");
    }

    capacities.push({ claimId: leg.claimId, remainingMinor: claim.remainingMinor });
  }

  const payment = compileOwnerReimbursement({
    currencyScale: book.currencyScale,
    ownerLiabilityAccountId: control.id,
    cashAccountId: input.cashAccountId,
    description: `Owner reimbursement ${input.ownerId}`,
    legs: input.evidence.allocations,
    capacities,
  });

  if (Result.isFailure(payment)) return yield* ownerFailure(payment.failure.code);

  const lines = journalLines(payment.success.journal);

  if (findControlLine(lines, control.id) === undefined) return yield* failure("InternalError");

  return {
    lines,
    ownerEffect: {
      accountId: control.id,
      side: "debit" as const,
      classification: "owner_reimbursement" as const,
      amountMinor: payment.success.totalMinor,
    },
    controlAccountId: control.id,
    recognition: null,
    reimburses: payment.success.legs.map((leg) => ({
      claimId: leg.claimId,
      amountMinor: leg.amountMinor,
    })),
    discharges: null,
    evidenceId: input.evidence.cashEvidenceId,
    witness: null,
    gaps: [],
    description: `Owner reimbursement ${payment.success.totalMinor}`,
  };
});

// A reviewed company cash inflow. A loan creates a principal obligation whose
// interest is a separate, unsupported question. A supported contribution credits
// the reviewed equity account and is not reimbursable. An unresolved or
// unsupported classification produces no financial plan at all.
const compileFunding = Effect.fn("owner.operations.funding")(function* (
  transaction: Transaction,
  scope: Scope,
  book: { readonly currency: string; readonly currencyScale: number },
  input: FundingMode,
  description: string,
) {
  const control = yield* requireOwnerControlAccount(
    transaction,
    scope.bookId,
    input.controlAccountId,
    [input.cashAccountId],
  );

  yield* requireCashAccount(transaction, scope.bookId, input.cashAccountId);

  // A contribution never becomes a loan and shareholder funding never silently
  // becomes a loan: the mode and the reviewed legal classification must agree.
  if (
    (input.mode === "owner_loan" && input.evidence.legalForm !== "shareholder_loan") ||
    (input.mode === "owner_contribution" &&
      input.evidence.legalForm !== "conditional_contribution" &&
      input.evidence.legalForm !== "unconditional_contribution")
  ) {
    return yield* failure("InvalidJournal");
  }

  const funding = compileOwnerFunding({
    currencyScale: book.currencyScale,
    cashAccountId: input.cashAccountId,
    liabilityAccountId: control.id,
    amountMinor: input.amountMinor,
    legalForm: input.evidence.legalForm,
    description,
  });

  if (Result.isFailure(funding)) return yield* ownerFailure(funding.failure.code);

  const lines = journalLines(funding.success.journal);

  if (findControlLine(lines, control.id) === undefined) return yield* failure("InternalError");

  return {
    lines,
    ownerEffect: {
      accountId: control.id,
      side: "credit" as const,
      classification: funding.success.ownerClassification,
      amountMinor: funding.success.amountMinor,
    },
    controlAccountId: control.id,
    recognition: null,
    reimburses: [],
    discharges: null,
    evidenceId: input.evidence.fundingEvidenceId,
    witness: null,
    gaps: [],
    description,
  };
});

// The retained source locator of one owner mode. It never contains a document
// number, an amount or an owner identity, so a locator is not a second key.
function locatorOf(mode: Input["mode"]) {
  return mode.replaceAll("_", "-");
}

function sourceKindOf(mode: Input["mode"]) {
  if (mode === "reimburse_owner") return "settlement" as const;

  return mode === "owner_loan" || mode === "owner_contribution"
    ? ("funding" as const)
    : ("expense" as const);
}

export const prepareOwnerOperation = Effect.fn("owner.operations.prepare")(function* (
  token: string,
  command: { readonly scope: Scope; readonly idempotencyKey: string; readonly input: Input },
) {
  return yield* withOwnerBook(
    token,
    command.scope,
    false,
    (transaction, principal) =>
      Effect.gen(function* () {
        const payload = yield* PurchaseShared.toJsonObject(command.input);

        const request = yield* replay(
          transaction,
          command.scope,
          command.idempotencyKey,
          prepareOperation,
          principal.actorId,
          payload,
          ReviewSchema,
        );

        if (request.previous) return request.previous;
        yield* requireOperationAccess(transaction, true);
        yield* requireOwnerWriteColumns(transaction);
        yield* Db.lockBookForUpdate(transaction, command.scope);
        const book = yield* readBook(transaction, command.scope);
        yield* requireNativeProfile(book);

        const decision = yield* compileOperation(transaction, command.scope, command.input);
        const evidenceId = decision.evidenceId;

        if (
          yield* PurchaseShared.evidenceHasPostedHistory(
            transaction,
            command.scope.bookId,
            evidenceId,
          )
        ) {
          return yield* failure("AlreadyPosted");
        }

        const eventKey = (yield* digest({
          operation: prepareOperation,
          evidenceId,
          mode: decision.input.mode,
          input: yield* PurchaseShared.toJsonObject(decision.input),
        })).replace("sha256:", "");

        const existing = (yield* Db.readEvent(
          transaction,
          command.scope.bookId,
          evidenceId,
          eventKey,
        ))[0];

        if (existing !== undefined) {
          if (
            (yield* OperationDb.readReviewByEvent(transaction, command.scope.bookId, existing.id))
              .length > 0
          ) {
            return yield* failure("IdempotencyConflict");
          }

          return yield* failure("AlreadyPosted");
        }

        const evidence = yield* PurchaseShared.readEvidenceReference(
          transaction,
          command.scope.bookId,
          evidenceId,
        );

        const plan = yield* prepareJournalInTransaction(transaction, principal, {
          scope: command.scope,
          idempotencyKey: `oo_${command.idempotencyKey}_journal`,
          input: {
            kind: "manual_journal",
            evidenceId,
            eventKey,
            accountingPeriodId: command.input.accountingPeriodId,
            postingDate: command.input.postingDate,
            series: command.input.series,
            description: decision.description,
            rationale: command.input.reason,
            taxAssessment: "not_applicable",
            lines: decision.lines.map((line) => ({ ...line })),
          },
        });

        const action = plan.groups[0]?.actions[0];

        if (action === undefined) return yield* failure("InternalError");

        const controlLine = findControlLine(action.lines, decision.controlAccountId);

        if (controlLine === undefined) return yield* failure("InternalError");

        const counted = (yield* OperationDb.countReviews(
          transaction,
          command.scope.bookId,
          action.eventId,
        ))[0];

        if (counted === undefined) return yield* failure("InternalError");

        const ordinal = counted.total + 1;

        if (ordinal > maximumGroupsPerEvent) return yield* failure("InvalidJournal");

        const body = yield* PurchaseShared.toJsonObject({
          id: newId("owner_operation_review"),
          scope: command.scope,
          version: 1,
          mode: decision.input.mode,
          ownerId: command.input.ownerId,
          ordinal,
          input: decision.input,
          postingPlan: plan,
          controlLine: {
            lineId: controlLine.lineId,
            accountId: decision.controlAccountId,
            side: controlSideOf(controlLine),
          },
          ownerEffect: decision.ownerEffect,
          recognition: decision.recognition,
          reimburses: decision.reimburses,
          discharges: decision.discharges,
          evidence,
          profileWitness: decision.witness,
          profileGaps: decision.gaps,
          changeSetId: plan.id,
          eventId: action.eventId,
          createdAt: yield* isoNow(transaction),
          receipt: {
            key: command.idempotencyKey,
            operation: prepareOperation,
            actorId: principal.actorId,
          },
        });

        const review = yield* PurchaseShared.decode(ReviewSchema, {
          ...body,
          digest: yield* digest(body),
        });

        yield* OperationDb.insertReview(transaction, {
          bookId: command.scope.bookId,
          id: review.id,
          mode: review.mode,
          ownerId: review.ownerId,
          ordinal: review.ordinal,
          changeSetId: review.changeSetId,
          eventId: review.eventId,
          evidenceId,
          body: yield* PurchaseShared.toJsonObject(review),
          digest: review.digest,
          createdAt: review.createdAt,
        });
        yield* saveCommand(
          transaction,
          command.scope,
          command.idempotencyKey,
          request.expected,
          prepareOperation,
          principal.actorId,
          yield* PurchaseShared.toJsonObject(review),
        );

        return review;
      }),
    "update",
  );
});

// Every reason the sealed group is no longer executable, stated rather than
// assumed. A committed group keeps its own immutable result regardless.
const reviewBlockers = Effect.fn("owner.operations.blockers")(function* (
  transaction: Transaction,
  scope: Scope,
  review: Review,
) {
  const blockers: Array<string> = [];

  if ((yield* OperationDb.readReceiptForReview(transaction, scope.bookId, review.id)).length > 0) {
    blockers.push("This owner group has already committed.");

    return blockers;
  }

  blockers.push(
    ...(yield* validatePlan(transaction, scope, review.postingPlan).pipe(
      Effect.match({ onFailure: (error) => [error.message], onSuccess: () => [] }),
    )),
  );

  const control = (yield* Db.readAccounts(transaction, scope.bookId, [
    review.ownerEffect.accountId,
  ])).find((row) => row.id === review.ownerEffect.accountId);

  if (control === undefined || !control.active) {
    blockers.push("The reviewed owner control account is no longer active.");
  }

  if (review.discharges !== null) {
    const invoice = yield* liveInvoice(transaction, scope.bookId, review.discharges.invoiceId);

    const payment = (yield* PaymentDb.readInvoicePaymentFacts(
      transaction,
      scope.bookId,
      review.discharges.invoiceId,
    ))[0];

    if (payment === undefined || payment.exported) {
      blockers.push(
        "The supplier payable has an exported payment instruction or unavailable payment state.",
      );
    }

    if (invoice.outstandingMinor === null || invoice.status === "cancelled") {
      blockers.push("The recognized supplier payable is no longer an open obligation.");
    } else if (BigInt(review.discharges.amountMinor) > BigInt(invoice.outstandingMinor)) {
      blockers.push("The supplier payable no longer has this much unconsumed capacity.");
    }
  }

  for (const leg of review.reimburses) {
    const claim = yield* readCapacity(transaction, scope, leg.claimId).pipe(
      Effect.match({ onFailure: () => undefined, onSuccess: (value) => value }),
    );

    if (claim === undefined) {
      blockers.push(`Claim ${leg.claimId} is no longer a current owner effect.`);
    } else if (BigInt(leg.amountMinor) > BigInt(claim.remainingMinor)) {
      blockers.push(`Claim ${leg.claimId} has less remaining than this group consumes.`);
    }
  }

  if (review.recognition !== null) {
    if (
      (yield* OperationDb.readRecognitionByEconomicKey(
        transaction,
        scope.bookId,
        review.recognition.economicKey,
      ))[0]?.present === true
    ) {
      blockers.push("This purchase economic key is already recognized in this book.");
    }

    if (
      (yield* RecognitionDb.readCounterpartyDocumentRecognition(
        transaction,
        scope.bookId,
        review.recognition.counterpartyId,
        review.recognition.supplierDocumentNumber,
      ))[0]?.present === true
    ) {
      blockers.push("A supplier-funded recognition of this document already exists.");
    }
  }

  return blockers;
});

/**
 * The owner approval as a transaction-passing port.
 *
 * It performs the owner's own approval rules — exact review digest, an
 * independent reviewer who is not the preparer, and no outstanding blocker — and
 * writes the owner's own approval row. It opens no transaction of its own, so a
 * caller that already holds a book-scoped transaction can approve inside it
 * without nesting a second financial transaction.
 *
 * `NEXT-16` uses this to approve exact sealed batch members under each owner's
 * rules. An owner that has not released such a port has no batch approval, and
 * this is the only shape that counts as one.
 */
export const approveOwnerOperationInTransaction = Effect.fn(
  "owner.operations.approveInTransaction",
)(function* (
  transaction: Transaction,
  principal: Principal,
  command: {
    readonly scope: Scope;
    readonly id: string;
    readonly idempotencyKey: string;
    readonly input: typeof Operation.ApproveOwnerOperation.Type;
  },
) {
  const request = yield* replay(
    transaction,
    command.scope,
    command.idempotencyKey,
    approveOperation,
    principal.actorId,
    { id: command.id, input: command.input },
    ApprovalSchema,
  );

  if (request.previous) return request.previous;

  yield* requireOperationAccess(transaction, true);
  yield* requireOwnerWriteColumns(transaction);
  yield* Db.lockBookForUpdate(transaction, command.scope);

  const row = (yield* OperationDb.readReview(transaction, command.scope.bookId, command.id))[0];

  if (row === undefined) return yield* failure("NotFound");

  const review = yield* PurchaseShared.decode(ReviewSchema, row.body);

  if (command.input.version !== 1 || command.input.digest !== review.digest) {
    return yield* failure("StaleDependency");
  }

  // The reviewer is the preparer's own decision, so an independent operator
  // reviews it. Approval never executes and never mints a receipt.
  if (review.receipt.actorId === principal.actorId) return yield* failure("ApprovalRequired");

  if ((yield* reviewBlockers(transaction, command.scope, review)).length > 0) {
    return yield* failure("StaleDependency");
  }

  const now = yield* isoNow(transaction);

  const body = yield* PurchaseShared.toJsonObject({
    id: newId("owner_operation_approval"),
    scope: command.scope,
    version: 1,
    reviewId: review.id,
    reviewDigest: review.digest,
    actorId: principal.actorId,
    expiresAt: new Date(Date.parse(now) + approvalWindowMs).toISOString(),
    createdAt: now,
    receipt: {
      key: command.idempotencyKey,
      operation: approveOperation,
      actorId: principal.actorId,
    },
  });

  const approval = yield* PurchaseShared.decode(ApprovalSchema, body);
  const sealed = { ...body, digest: yield* digest(body) };

  yield* OperationDb.insertApproval(transaction, {
    bookId: command.scope.bookId,
    id: approval.id,
    reviewId: approval.reviewId,
    actorId: approval.actorId,
    digest: sealed.digest,
    expiresAt: approval.expiresAt,
    body: yield* PurchaseShared.toJsonObject(sealed),
    createdAt: approval.createdAt,
  });
  yield* saveCommand(
    transaction,
    command.scope,
    command.idempotencyKey,
    request.expected,
    approveOperation,
    principal.actorId,
    yield* PurchaseShared.toJsonObject(approval),
  );

  return approval;
});

export const approveOwnerOperation = Effect.fn("owner.operations.approve")(function* (
  token: string,
  command: {
    readonly scope: Scope;
    readonly id: string;
    readonly idempotencyKey: string;
    readonly input: typeof Operation.ApproveOwnerOperation.Type;
  },
) {
  return yield* withOwnerBook(
    token,
    command.scope,
    true,
    (transaction, principal) => approveOwnerOperationInTransaction(transaction, principal, command),
    "update",
  );
});

// The exact current approval for this sealed group: the bound digest, the
// reviewer's own current operator membership, admission, non-revocation and
// expiry. An approval is consumed exactly once by the receipt that names it.
const requireApproval = Effect.fn("owner.operations.approval")(function* (
  transaction: Transaction,
  scope: Scope,
  review: Review,
  approvalId: string,
) {
  const approval = (yield* OperationDb.lockApproval(transaction, scope.bookId, approvalId))[0];

  if (
    approval === undefined ||
    approval.reviewId !== review.id ||
    approval.reviewDigest !== review.digest ||
    approval.actorId === review.receipt.actorId
  ) {
    return yield* failure("ApprovalRequired");
  }

  if (
    (yield* Db.readOperatorMembership(transaction, scope.bookId, approval.actorId)).length === 0
  ) {
    return yield* failure("ApprovalRequired");
  }

  const admission = yield* Db.readActorAdmission(transaction, approval.actorId);

  if (admission[0]?.enabled === false) return yield* failure("ApprovalRequired");

  if (Date.parse(approval.expiresAt) <= Date.parse(yield* isoNow(transaction))) {
    return yield* failure("ApprovalRequired");
  }

  return approval;
});

// The complete committed group, in the caller's transaction: the journal, the
// owner aggregate and its control effect, any reimbursement allocation, any
// supplier payable discharge and the owner-funded purchase recognition.
const commitOwnerGroup = Effect.fn("owner.operations.commit")(function* (
  transaction: Transaction,
  principal: Principal,
  review: Review,
  approvalId: string,
  receiptKey: string,
) {
  const scope = review.scope;
  const sealedPlan = yield* PurchaseShared.decode(Accounting.ChangeSet, review.postingPlan);

  const kernel = yield* approveChangeInTransaction(transaction, principal, {
    scope,
    changeSetId: review.changeSetId,
    idempotencyKey: `oo_${review.id}_approve`,
    input: { version: 1, planDigest: sealedPlan.planDigest },
  });

  const posted = yield* executeChangeInTransaction(transaction, principal, {
    scope,
    changeSetId: review.changeSetId,
    idempotencyKey: `oo_${review.id}_post`,
    input: { version: 1, planDigest: sealedPlan.planDigest, approvalId: kernel.id },
    owner: { kind: "owner_operation", id: review.id },
  });

  const action = sealedPlan.groups[0]?.actions[0];
  const control = action?.lines.find((line) => line.lineId === review.controlLine.lineId);

  if (action === undefined || control === undefined) return yield* failure("StaleDependency");

  if (control.accountId !== review.controlLine.accountId) {
    return yield* failure("StaleDependency");
  }

  if (
    BigInt(control.debitMinor) + BigInt(control.creditMinor) !==
    BigInt(review.ownerEffect.amountMinor)
  ) {
    return yield* failure("StaleDependency");
  }

  const side = controlSideOf(control);

  if (side !== review.controlLine.side || side !== review.ownerEffect.side) {
    return yield* failure("StaleDependency");
  }

  const book = yield* readBook(transaction, scope);
  const recordId = newId("owner_record");
  const ownerReviewId = newId("owner_review");

  const ownerDataNature = PurchaseShared.textField(
    (yield* readOwner(transaction, scope.bookId, review.ownerId)).body,
    "dataNature",
  );

  if (ownerDataNature !== "synthetic_example" && ownerDataNature !== "company_record") {
    return yield* failure("StaleDependency");
  }

  const aggregate = yield* sealOwnerAggregateInTransaction(transaction, {
    scope,
    actorId: principal.actorId,
    operation,
    idempotencyKey: receiptKey,
    ownerId: review.ownerId,
    recordId,
    reviewId: ownerReviewId,
    sourceKey: `owner_operation:${review.id}`,
    locator: locatorOf(review.mode),
    evidenceId: review.evidence.evidenceId,
    occurredOn: review.input.postingDate,
    currency: book.currency,
    currencyScale: book.currencyScale,
    amountMinor: review.ownerEffect.amountMinor,
    sourceKind: sourceKindOf(review.mode),
    dataNature: ownerDataNature,
    classification: review.ownerEffect.classification,
    description: action.description,
    reason: review.input.reason,
    controlAccountId: review.ownerEffect.accountId,
    counterparty:
      review.recognition === null
        ? null
        : {
            sourceKey: review.recognition.counterpartyId,
            displayName: review.recognition.supplierDocumentNumber,
          },
  });

  yield* admitLineOwner(transaction, scope.bookId, posted.voucherId, control.lineId, "owner");

  const effectBody = yield* PurchaseShared.toJsonObject({
    id: newId("owner_effect"),
    scope,
    reviewId: ownerReviewId,
    voucherId: posted.voucherId,
    lineId: control.lineId,
    createdAt: posted.committedAt,
    receipt: { key: receiptKey, operation, actorId: principal.actorId },
    recordId,
    ownerId: review.ownerId,
    revisionDigest: aggregate.revisionDigest,
    accountId: control.accountId,
    postingDate: action.postingDate,
    occurredOn: review.input.postingDate,
    locator: locatorOf(review.mode),
    eventId: action.eventId,
    changeSetId: review.changeSetId,
    classification: review.ownerEffect.classification,
    origin: "current",
    side,
    amountMinor: review.ownerEffect.amountMinor,
    currency: book.currency,
    currencyScale: book.currencyScale,
    evidence: review.evidence,
  });

  const effect = PurchaseShared.textField(effectBody, "id") ?? "";

  yield* OwnerDb.insertEffect(transaction, {
    bookId: scope.bookId,
    id: effect,
    recordId,
    ownerId: review.ownerId,
    reviewId: ownerReviewId,
    voucherId: posted.voucherId,
    lineId: control.lineId,
    accountId: control.accountId,
    postingDate: action.postingDate,
    side,
    classification: review.ownerEffect.classification,
    origin: "current",
    amountMinor: review.ownerEffect.amountMinor,
    body: { ...effectBody, digest: yield* digest(effectBody) },
  });

  const receiptId = newId("owner_operation_receipt");

  const recognition = yield* writePaidPurchaseRecognition(
    transaction,
    principal,
    review,
    approvalId,
    { recordId, effectId: effect, voucherId: posted.voucherId },
    receiptKey,
  );

  const body = yield* PurchaseShared.toJsonObject({
    id: receiptId,
    scope,
    reviewId: review.id,
    reviewDigest: review.digest,
    approvalId,
    mode: review.mode,
    ownerId: review.ownerId,
    ownerRecordId: recordId,
    ownerEffectId: effect,
    ownerClaimMinor: review.ownerEffect.amountMinor,
    postingReceipt: posted,
    recognitionId: recognition === null ? null : recognition.recognitionId,
    taxFactIds: recognition === null ? [] : recognition.taxFactIds,
    reimburses: review.reimburses,
    dischargedInvoiceId: review.discharges?.invoiceId ?? null,
    committedAt: posted.committedAt,
    receipt: { key: receiptKey, operation, actorId: principal.actorId },
  });

  const sealed = yield* PurchaseShared.toJsonObject({
    ...body,
    digest: yield* digest(body),
  });

  const result = yield* PurchaseShared.decode(ReceiptSchema, sealed);

  yield* OperationDb.insertReceipt(transaction, {
    bookId: scope.bookId,
    id: result.id,
    reviewId: result.reviewId,
    approvalId,
    mode: result.mode,
    ownerId: result.ownerId,
    ownerRecordId: recordId,
    ownerEffectId: effect,
    voucherId: posted.voucherId,
    controlLineId: control.lineId,
    recognitionId: result.recognitionId,
    invoiceId: result.dischargedInvoiceId,
    amountMinor: result.ownerClaimMinor,
    body: sealed,
    digest: PurchaseShared.textField(sealed, "digest") ?? "",
    committedAt: result.committedAt,
  });

  // The legs are children of the committed receipt, so they follow it.
  yield* OperationDb.insertAllocations(
    transaction,
    review.reimburses.map((leg, index) => ({
      bookId: scope.bookId,
      receiptId,
      ordinal: index + 1,
      claimId: leg.claimId,
      amountMinor: leg.amountMinor,
    })),
  );

  return result;
});

// The owner-funded purchase recognition and its signed input tax components
// commit with the voucher and the owner effect. It publishes the components the
// source-line purchase compiler produced for this funding role; it does not
// re-derive a rate or a deduction fraction.
const writePaidPurchaseRecognition = Effect.fn("owner.operations.paidPurchase")(function* (
  transaction: Transaction,
  principal: Principal,
  review: Review,
  approvalId: string,
  written: { readonly recordId: string; readonly effectId: string; readonly voucherId: string },
  receiptKey: string,
) {
  if (review.recognition === null || review.mode !== "owner_paid_purchase") {
    return { recognitionId: null, taxFactIds: [] } as const;
  }

  const recognition = review.recognition;
  const plan = recognition.plan;
  const recordedAt = yield* isoNow(transaction);
  const recognitionId = newId("owner_purchase_recognition");
  const book = yield* readBook(transaction, review.scope);
  const deductible = plan.lines.reduce((sum, line) => sum + BigInt(line.deductibleTaxMinor), 0n);

  const body = yield* PurchaseShared.toJsonObject({
    id: recognitionId,
    scope: review.scope,
    version: 1,
    eventOwner: "owner_paid_purchase",
    economicKey: recognition.economicKey,
    ownerId: review.ownerId,
    ownerRecordId: written.recordId,
    ownerEffectId: written.effectId,
    counterpartyId: recognition.counterpartyId,
    supplierDocumentNumber: recognition.supplierDocumentNumber,
    currency: book.currency,
    currencyScale: book.currencyScale,
    recognitionDate: recognition.recognitionDate,
    taxPoint: recognition.taxPoint,
    grossMinor: recognition.grossMinor,
    deductibleTaxMinor: deductible.toString(),
    plan,
    voucherId: written.voucherId,
    changeSetId: review.changeSetId,
    approvalId,
    profileWitness: review.profileWitness,
    recordedBy: principal.actorId,
    recordedAt,
    receipt: { key: receiptKey, operation, actorId: principal.actorId },
  });

  const sealed = yield* PurchaseShared.decode(PaidPurchaseSchema, {
    ...body,
    digest: yield* digest(body),
  });

  yield* OperationDb.insertRecognition(transaction, {
    bookId: review.scope.bookId,
    id: sealed.id,
    economicKey: sealed.economicKey,
    ownerId: sealed.ownerId,
    ownerRecordId: written.recordId,
    ownerEffectId: written.effectId,
    counterpartyId: sealed.counterpartyId,
    documentNumber: sealed.supplierDocumentNumber,
    voucherId: written.voucherId,
    changeSetId: review.changeSetId,
    approvalId,
    recognitionDate: sealed.recognitionDate,
    taxPointOn: sealed.taxPoint.taxPointOn,
    grossMinor: sealed.grossMinor,
    deductibleTaxMinor: sealed.deductibleTaxMinor,
    body: yield* PurchaseShared.toJsonObject(sealed),
    digest: sealed.digest,
    recordedAt,
  });

  for (const fact of plan.taxFacts) {
    const factBody = yield* PurchaseShared.toJsonObject({
      id: fact.taxComponentId,
      recognitionId,
      sourceLineId: fact.sourceLineId,
      componentRole: fact.componentRole,
      taxComponentId: fact.taxComponentId,
      voucherId: written.voucherId,
      signedBaseMinor: fact.signedBaseMinor,
      signedOutputTaxMinor: fact.signedOutputTaxMinor,
      signedDeductibleTaxMinor: fact.signedDeductibleTaxMinor,
      sourceTaxMinor: fact.sourceTaxMinor,
      nonDeductibleTaxMinor: fact.nonDeductibleTaxMinor,
      basis: fact.basis,
      taxPointOn: fact.taxPointOn,
      reportingObligationId: null,
      ruleReleaseId: recognition.ruleReleaseId,
      sourceRefs: fact.sourceRefs,
      adjustsTaxFactId: fact.adjustsTaxFactId,
      recordedAt,
    });

    const sealedFact = yield* PurchaseShared.decode(RecognitionContract.RecordedTaxFact, {
      ...factBody,
      digest: yield* digest(factBody),
    });

    yield* OperationDb.insertTaxFact(transaction, {
      bookId: review.scope.bookId,
      id: sealedFact.id,
      recognitionId,
      sourceLineId: sealedFact.sourceLineId,
      componentRole: sealedFact.componentRole,
      taxComponentId: sealedFact.taxComponentId,
      voucherId: written.voucherId,
      signedBaseMinor: sealedFact.signedBaseMinor,
      signedOutputTaxMinor: sealedFact.signedOutputTaxMinor,
      signedDeductibleTaxMinor: sealedFact.signedDeductibleTaxMinor,
      sourceTaxMinor: sealedFact.sourceTaxMinor,
      nonDeductibleTaxMinor: sealedFact.nonDeductibleTaxMinor,
      taxPointOn: sealedFact.taxPointOn,
      adjustsTaxFactId: sealedFact.adjustsTaxFactId,
      body: yield* PurchaseShared.toJsonObject(sealedFact),
      digest: sealedFact.digest,
      recordedAt,
    });
  }

  return {
    recognitionId,
    taxFactIds: plan.taxFacts.map((fact) => fact.taxComponentId),
  } as const;
});

export const executeOwnerOperation = Effect.fn("owner.operations.execute")(function* (
  token: string,
  command: {
    readonly scope: Scope;
    readonly id: string;
    readonly idempotencyKey: string;
    readonly input: typeof Operation.ExecuteOwnerOperation.Type;
  },
) {
  return yield* withOwnerBook(
    token,
    command.scope,
    true,
    (transaction, principal) =>
      Effect.gen(function* () {
        const request = yield* replay(
          transaction,
          command.scope,
          command.idempotencyKey,
          operation,
          principal.actorId,
          { id: command.id, input: command.input },
          ReceiptSchema,
        );

        if (request.previous) return request.previous;
        yield* requireOperationAccess(transaction, true);
        yield* requireOwnerWriteColumns(transaction);
        yield* Db.lockBookForUpdate(transaction, command.scope);

        const row = (yield* OperationDb.readReview(
          transaction,
          command.scope.bookId,
          command.id,
        ))[0];

        if (row === undefined) return yield* failure("NotFound");

        const review = yield* PurchaseShared.decode(ReviewSchema, row.body);

        if (command.input.version !== 1 || command.input.digest !== review.digest) {
          return yield* failure("StaleDependency");
        }

        const committed = (yield* OperationDb.readReceiptForReview(
          transaction,
          command.scope.bookId,
          review.id,
        ))[0];

        if (committed !== undefined)
          return yield* PurchaseShared.decode(ReceiptSchema, committed.body);

        if ((yield* reviewBlockers(transaction, command.scope, review)).length > 0) {
          return yield* failure("StaleDependency");
        }

        const approval = yield* requireApproval(
          transaction,
          command.scope,
          review,
          command.input.approvalId,
        );

        const result = yield* commitOwnerGroup(
          transaction,
          principal,
          review,
          approval.id,
          command.idempotencyKey,
        );

        yield* saveCommand(
          transaction,
          command.scope,
          command.idempotencyKey,
          request.expected,
          operation,
          principal.actorId,
          yield* PurchaseShared.toJsonObject(result),
        );

        return result;
      }),
    "update",
  );
});

export const getOwnerOperation = Effect.fn("owner.operations.get")(function* (
  token: string,
  command: { readonly scope: Scope; readonly id: string },
) {
  return yield* withOwnerBook(
    token,
    command.scope,
    false,
    (transaction) =>
      Effect.gen(function* () {
        yield* requireOperationAccess(transaction, false);
        yield* Db.lockBookForShare(transaction, command.scope);

        const row = (yield* OperationDb.readReview(
          transaction,
          command.scope.bookId,
          command.id,
        ))[0];

        if (row === undefined) return yield* failure("NotFound");

        const review = yield* PurchaseShared.decode(ReviewSchema, row.body);

        const approval = (yield* OperationDb.readApprovalByReview(
          transaction,
          command.scope.bookId,
          review.id,
        ))[0];

        const committed = (yield* OperationDb.readReceiptForReview(
          transaction,
          command.scope.bookId,
          review.id,
        ))[0];

        const blockers = yield* reviewBlockers(transaction, command.scope, review);
        const now = yield* isoNow(transaction);

        return yield* PurchaseShared.decode(Operation.OwnerOperationView, {
          review,
          approval:
            approval === undefined
              ? null
              : yield* PurchaseShared.decode(ApprovalSchema, approval.body),
          result:
            committed === undefined
              ? null
              : yield* PurchaseShared.decode(ReceiptSchema, committed.body),
          blockers: [...blockers],
          dependenciesCurrent: blockers.length === 0,
          approvalUsable:
            approval !== undefined &&
            approval.reviewDigest === review.digest &&
            approval.actorId !== review.receipt.actorId &&
            Date.parse(approval.expiresAt) > Date.parse(now) &&
            committed === undefined &&
            blockers.length === 0,
        });
      }),
    "share",
  );
});

export const getOwnerPaidPurchase = Effect.fn("owner.operations.getPaidPurchase")(function* (
  token: string,
  command: { readonly scope: Scope; readonly id: string },
) {
  return yield* withOwnerBook(
    token,
    command.scope,
    false,
    (transaction) =>
      Effect.gen(function* () {
        yield* requireOperationAccess(transaction, false);
        yield* Db.lockBookForShare(transaction, command.scope);

        const row = (yield* OperationDb.readRecognition(
          transaction,
          command.scope.bookId,
          command.id,
        ))[0];

        if (row === undefined) return yield* failure("NotFound");

        return yield* PurchaseShared.decode(Operation.OwnerPurchaseRecognitionView, {
          recognition: yield* PurchaseShared.decode(PaidPurchaseSchema, row.body),
          taxFacts: yield* Effect.forEach(
            yield* OperationDb.readTaxFacts(transaction, command.scope.bookId, command.id),
            (fact) => PurchaseShared.decode(RecognitionContract.RecordedTaxFact, fact.body),
          ),
        });
      }),
    "share",
  );
});
