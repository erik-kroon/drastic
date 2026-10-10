import * as PayrollInputDb from "../../db/payroll/inputs";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Recognition from "@open-erp/contracts/supplier-recognition";
import {
  compileDomesticPurchase,
  type OriginalLineCapacity,
  type PurchaseFailureCode,
  type PurchaseRecognitionPlan,
} from "@open-erp/domain/purchasing";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import type * as Schema from "effect/Schema";
import { failure } from "../failures";
import { digest } from "../json";
import { isoNow } from "../command-receipts";
import { sha256Hex } from "../hashing";
import { resolveCompanyProfileInTransaction } from "../company-profiles";
import * as Db from "../../db/purchases/recognition";
import type { Transaction } from "../../db/transaction";
import * as Shared from "./shared";
import { resolveSelectedPurchaseCategory } from "./vat-categories";

type Scope = typeof Accounting.Scope.Type;

type Json = Schema.Json;

type DraftTaxPoint = typeof Recognition.DraftTaxPoint.Type;

type CreditLineRelease = typeof Recognition.CreditLineRelease.Type;

type JsonObject = Schema.JsonObject;

type Plan = typeof Recognition.RecognitionPlan.Type;

type Treatment = typeof Recognition.ReviewedTreatment.Type;

const ViewSchema = Recognition.PurchaseRecognitionView;

const RecognitionSchema = Recognition.PurchaseRecognition;

const CreditRecognitionSchema = Recognition.PurchaseCreditRecognition;

const TaxFactSchema = Recognition.RecordedTaxFact;

const CapacitySchema = Recognition.LineCapacity;

const TreatmentSchema = Recognition.ReviewedTreatment;

// Each basis code allows exactly one deduction fraction. A treatment that
// disagrees with its own basis is refused instead of being rounded into meaning.
const basisFractions = new Map<typeof Recognition.DeductionBasis.Type, string>([
  ["full_deduction", "1/1"],
  ["half_deduction", "1/2"],
  ["no_deduction_exclusion", "0/1"],
  ["no_tax_exempt", "0/1"],
]);

const unsupportedFailures = new Set<PurchaseFailureCode>([
  "UnsupportedTreatment",
  "UnsupportedRounding",
  "IncompleteSourceSelection",
  "DuplicateSourceLine",
  "DuplicateCreditLine",
]);

// One recognized economic event has one identity, derived from the reviewed
// supplier identity rather than drawn at write time. Prepare, approval and
// execution therefore agree on it, and every tax component and fact is
// namespaced by it, so a second invoice's local line ids cannot collide with the
// first invoice's. The suffix is bounded: 24 hex characters keep every derived
// identifier inside the identifier contract's length.
function derivedId(prefix: string, economicKey: string) {
  return Effect.map(sha256Hex(economicKey), (hash) => `${prefix}_${hash.slice(0, 24)}`);
}

export function economicKey(counterpartyId: string, documentNumber: string) {
  return `supplier_purchase:${counterpartyId}:${documentNumber}`;
}

// A supplier credit is identified by the credit document the supplier actually
// issued, not by the review that happened to recognize it, so re-reviewing one
// credit document resolves to the same recognition identity.
export function creditEconomicKey(counterpartyId: string, supplierCreditNumber: string) {
  return `supplier_credit:${counterpartyId}:${supplierCreditNumber}`;
}

export function purchaseRecognitionId(key: string) {
  return derivedId("purchase_recognition", key);
}

export function creditRecognitionId(key: string) {
  return derivedId("purchase_credit_recognition", key);
}

export function refusalFor(code: PurchaseFailureCode) {
  return unsupportedFailures.has(code) ? Shared.unsupported() : failure("InvalidJournal");
}

export function requireConsistentTreatment(
  treatment: Treatment,
  netMinor: string,
  sourceTaxMinor: string,
) {
  const fraction = basisFractions.get(treatment.basis);

  if (fraction === null) return Shared.unsupported();

  if (`${treatment.deduction.numerator}/${treatment.deduction.denominator}` !== fraction) {
    return failure("InvalidJournal");
  }

  if (
    treatment.basis === "no_tax_exempt" &&
    (treatment.rate.numerator !== "0" || sourceTaxMinor !== "0")
  ) {
    return failure("InvalidJournal");
  }

  if (netMinor === "0" && sourceTaxMinor === "0") return failure("InvalidJournal");

  if (treatment.acceptancePolicy === "qualified_tolerance" && treatment.toleranceMinor === "0") {
    return failure("InvalidJournal");
  }

  return Effect.void;
}

// The tax point is the reviewed date this operation itself uses, and it must be
// one the retained supplier document actually carries.
function taxPointDate(content: JsonObject, requested: DraftTaxPoint) {
  const field = requested.basis === "document_date" ? "documentDate" : "supplyDate";

  return Shared.textField(content, field) === requested.taxPointOn
    ? Effect.succeed(requested)
    : failure("InvalidJournal");
}

// The tax family is admitted by NEXT-02's owner on the tax point date this
// operation uses. An unadmitted family is retained as its exact gaps, never as a
// fabricated witness and never as a default rate.
export const readVatWitness = Effect.fn("purchases.recognition.vatWitness")(function* (
  transaction: Transaction,
  scope: Scope,
  taxPointOn: string,
) {
  const resolved = yield* resolveCompanyProfileInTransaction(transaction, scope, "actual_company", {
    postingOn: null,
    taxPointOn,
    paymentOn: null,
    reportOn: null,
  });

  const family = resolved.families.find((entry) => entry.family === "vat");

  return { witness: family?.witness ?? null, gaps: family?.gaps ?? [] };
});

function draftLineAmounts(line: JsonObject) {
  const base = Shared.textField(line, "baseMinor");
  const discount = Shared.textField(line, "discountMinor");
  const charge = Shared.textField(line, "chargeMinor");
  const tax = Shared.textField(line, "taxMinor");

  if (
    base === undefined ||
    discount === undefined ||
    charge === undefined ||
    tax === undefined ||
    !Shared.minorPattern.test(base) ||
    !Shared.minorPattern.test(discount) ||
    !Shared.minorPattern.test(charge) ||
    !Shared.minorPattern.test(tax)
  ) {
    return null;
  }

  const net = BigInt(base) - BigInt(discount) + BigInt(charge);

  return net < 0n ? null : { net: net.toString(), tax };
}

export type PurchaseLineSelection = {
  readonly lineId: string;
  readonly expenseAccountId: string;
  readonly netMinor: string;
  readonly sourceTaxMinor: string;
  readonly sourceGrossMinor: string;
  readonly taxComponentId: string;
  readonly treatment: Treatment;
};

export type CompiledPurchase = {
  readonly plan: Plan;
  readonly recognitionId: string;
  readonly witness: Json;
  readonly gaps: Json;
  readonly selections: ReadonlyArray<PurchaseLineSelection>;
  readonly inputVatAccountId: string;
};

export const compilePurchasePlan = Effect.fn("purchases.recognition.compile")(function* (
  transaction: Transaction,
  scope: Scope,
  command: {
    readonly recognitionId: string;
    readonly book: { readonly currency: string; readonly currencyScale: number };
    readonly content: JsonObject;
    readonly draftLines: ReadonlyArray<Json>;
    readonly assignments: ReadonlyArray<{
      readonly lineId: string;
      readonly expenseAccountId: string;
      readonly treatment: Treatment;
    }>;
    readonly allowPurchaseCategory?: boolean;
    readonly controlAccountId: string;
    readonly inputVatAccountId: string;
    readonly taxPoint: DraftTaxPoint;
    readonly recognitionDate: string;
  },
) {
  const sourceEvidenceId = Shared.textField(command.content, "sourceEvidenceId");

  if (sourceEvidenceId === undefined) return yield* failure("MissingEvidence");

  const reviewed = yield* taxPointDate(command.content, command.taxPoint);
  const witness = yield* readVatWitness(transaction, scope, reviewed.taxPointOn);
  const selections: Array<PurchaseLineSelection> = [];

  for (const line of command.draftLines) {
    const lineId = Shared.textField(line, "id");
    const amounts = Shared.isJsonObject(line) ? draftLineAmounts(line) : null;
    const assignment = command.assignments.find((entry) => entry.lineId === lineId);

    if (lineId === undefined || amounts === null || assignment === undefined) {
      return yield* failure("InvalidJournal");
    }

    if (assignment.treatment.category !== undefined && command.allowPurchaseCategory !== true) {
      return yield* Shared.unsupported();
    }

    yield* requireConsistentTreatment(assignment.treatment, amounts.net, amounts.tax);
    yield* Shared.readEvidenceReference(
      transaction,
      scope.bookId,
      Shared.textField(line, "taxEvidenceId") ?? sourceEvidenceId,
    );

    const treatment = yield* resolveSelectedPurchaseCategory(transaction, {
      bookId: scope.bookId,
      sourceEvidenceId,
      taxPointOn: reviewed.taxPointOn,
      lineCount: command.draftLines.length,
      netMinor: amounts.net,
      taxMinor: amounts.tax,
      treatment: assignment.treatment,
      witness: witness.witness,
    });

    selections.push({
      lineId,
      expenseAccountId: assignment.expenseAccountId,
      netMinor: amounts.net,
      sourceTaxMinor: amounts.tax,
      sourceGrossMinor: (BigInt(amounts.net) + BigInt(amounts.tax)).toString(),
      taxComponentId: `${command.recognitionId}_${lineId}`,
      treatment,
    });
  }

  const unique = new Set(selections.map((entry) => entry.lineId));

  if (
    selections.length === 0 ||
    unique.size !== selections.length ||
    command.assignments.length !== selections.length
  ) {
    return yield* Shared.unsupported();
  }

  const result = compileDomesticPurchase({
    currencyScale: command.book.currencyScale,
    recognitionDate: command.recognitionDate,
    taxPoint: reviewed,
    funding: {
      accountId: command.controlAccountId,
      role: "supplier_payable",
      inputVatAccountId: command.inputVatAccountId,
    },
    reportingObligationId: null,
    ruleReleaseId:
      Shared.textField(
        Shared.isJsonObject(witness.witness) ? witness.witness : {},
        "ruleReleaseId",
      ) ?? null,
    // Every tax component of this recognition is namespaced by the recognition's
    // own preallocated identity, so two invoices that both number their local
    // first line `line_1` still publish distinct components.
    taxComponentPrefix: command.recognitionId,
    lines: selections.map((selection) => ({
      sourceLineId: selection.lineId,
      expenseAccountId: selection.expenseAccountId,
      netMinor: selection.netMinor,
      sourceTaxMinor: selection.sourceTaxMinor,
      sourceGrossMinor: selection.sourceGrossMinor,
      treatment: compilerTreatment(selection.treatment),
      sourceRefs: [
        { evidenceId: sourceEvidenceId, sourceKey: `supplier_line:${selection.lineId}` },
      ],
    })),
  });

  if (Result.isFailure(result)) return yield* refusalFor(result.failure.code);

  return {
    plan: wirePlan(result.success, selections),
    recognitionId: command.recognitionId,
    witness: yield* jsonOrNull(witness.witness),
    gaps: yield* Shared.toJson(witness.gaps),
    selections,
    inputVatAccountId: command.inputVatAccountId,
  } satisfies CompiledPurchase;
});

function jsonOrNull(value: Json | null) {
  return value === null ? Effect.succeed(null) : Shared.toJsonObject(value);
}

function basisFor(selections: ReadonlyArray<PurchaseLineSelection>, lineId: string) {
  const selection = selections.find((entry) => entry.lineId === lineId);

  return selection === undefined ? "no_deduction_exclusion" : selection.treatment.basis;
}

function compilerTreatment(treatment: Treatment) {
  return {
    treatmentId: treatment.basis,
    rate: treatment.rate,
    deduction: treatment.deduction,
    invoiceTaxRounding: treatment.invoiceTaxRounding,
    deductionRounding: treatment.deductionRounding,
    acceptancePolicy: treatment.acceptancePolicy,
    toleranceMinor: treatment.toleranceMinor,
    basis: treatment.basis,
  };
}

function wirePlan(plan: PurchaseRecognitionPlan, selections: ReadonlyArray<PurchaseLineSelection>) {
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
      taxFactId: fact.taxFactId,
      signedBaseMinor: fact.signedBaseMinor,
      signedOutputTaxMinor: fact.signedOutputTaxMinor,
      signedDeductibleTaxMinor: fact.signedDeductibleTaxMinor,
      sourceTaxMinor: fact.sourceTaxMinor,
      nonDeductibleTaxMinor: fact.nonDeductibleTaxMinor,
      basis: basisFor(selections, fact.sourceLineId),
      taxPointOn: fact.taxPointOn,
      sourceRefs: fact.sourceRefs,
      adjustsTaxFactId: fact.adjustsTaxFactId,
    })),
    journal: plan.journal.map((line) => ({ ...line })),
  } satisfies Plan;
}

function sealedFact(
  fact: Plan["taxFacts"][number],
  factId: string,
  recognitionId: string,
  voucherId: string,
  recordedAt: string,
  ruleReleaseId: string | null,
) {
  return {
    id: factId,
    recognitionId,
    sourceLineId: fact.sourceLineId,
    componentRole: fact.componentRole,
    taxComponentId: fact.taxComponentId,
    voucherId,
    signedBaseMinor: fact.signedBaseMinor,
    signedOutputTaxMinor: fact.signedOutputTaxMinor,
    signedDeductibleTaxMinor: fact.signedDeductibleTaxMinor,
    sourceTaxMinor: fact.sourceTaxMinor,
    nonDeductibleTaxMinor: fact.nonDeductibleTaxMinor,
    basis: fact.basis,
    taxPointOn: fact.taxPointOn,
    reportingObligationId: null,
    ruleReleaseId,
    sourceRefs: fact.sourceRefs,
    adjustsTaxFactId: fact.adjustsTaxFactId,
    recordedAt,
  } satisfies JsonObject;
}

function writeTaxFact(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly factId: string;
    readonly recognitionId: string;
    readonly voucherId: string;
    readonly fact: Plan["taxFacts"][number];
    readonly recordedAt: string;
    readonly ruleReleaseId: string | null;
  },
) {
  return Effect.gen(function* () {
    const body = yield* Shared.toJsonObject(
      sealedFact(
        row.fact,
        row.factId,
        row.recognitionId,
        row.voucherId,
        row.recordedAt,
        row.ruleReleaseId,
      ),
    );

    const sealed = yield* Shared.decode(TaxFactSchema, { ...body, digest: yield* digest(body) });

    yield* Db.insertTaxFact(transaction, row.bookId, {
      id: sealed.id,
      recognitionId: row.recognitionId,
      sourceLineId: sealed.sourceLineId,
      componentRole: sealed.componentRole,
      taxComponentId: sealed.taxComponentId,
      voucherId: sealed.voucherId,
      signedBaseMinor: sealed.signedBaseMinor,
      signedOutputTaxMinor: sealed.signedOutputTaxMinor,
      signedDeductibleTaxMinor: sealed.signedDeductibleTaxMinor,
      sourceTaxMinor: sealed.sourceTaxMinor,
      nonDeductibleTaxMinor: sealed.nonDeductibleTaxMinor,
      taxPointOn: sealed.taxPointOn,
      adjustsTaxFactId: sealed.adjustsTaxFactId,
      body: yield* Shared.toJsonObject(sealed),
      digest: sealed.digest,
      recordedAt: sealed.recordedAt,
    });

    return sealed;
  });
}

export type RecognitionWrite = {
  readonly scope: Scope;
  readonly bookId: string;
  readonly actorId: string;
  readonly receipt: JsonObject;
  readonly recognitionId: string;
  readonly economicKey: string;
  readonly draftId: string;
  readonly draftRevision: string;
  readonly draftDigest: string;
  readonly counterpartyId: string;
  readonly documentNumber: string;
  readonly reviewId: string;
  readonly approvalId: string;
  readonly changeSetId: string;
  readonly voucherId: string;
  readonly payableId: string;
  readonly recognitionDate: string;
  readonly taxPoint: DraftTaxPoint;
  readonly currency: string;
  readonly currencyScale: number;
  readonly plan: Plan;
  readonly selections: ReadonlyArray<PurchaseLineSelection>;
  readonly inputVatAccountId: string;
  readonly witness: Json;
  readonly gaps: Json;
};

// The immutable recognition, its signed tax components and its original-line
// capacities commit in the caller's transaction with the journal and payable.
export const recordRecognitionInTransaction = Effect.fn(
  "purchases.recognition.recordInTransaction",
)(function* (transaction: Transaction, command: RecognitionWrite) {
  if (
    (yield* PayrollInputDb.readComponents(transaction, command.bookId, [
      `purchase:${command.economicKey}`,
    ])).length > 0
  )
    return yield* failure("AlreadyPosted");

  const recordedAt = yield* isoNow(transaction);
  const recognitionId = command.recognitionId;

  const ruleReleaseId =
    Shared.textField(
      Shared.isJsonObject(command.witness) ? command.witness : {},
      "ruleReleaseId",
    ) ?? null;

  const body = yield* Shared.toJsonObject({
    id: recognitionId,
    scope: command.scope,
    version: 1,
    eventOwner: "supplier_purchase",
    economicKey: command.economicKey,
    draftId: command.draftId,
    draftRevision: command.draftRevision,
    draftDigest: command.draftDigest,
    supplierInvoiceRevision: command.draftRevision,
    counterpartyId: command.counterpartyId,
    supplierDocumentNumber: command.documentNumber,
    currency: command.currency,
    currencyScale: command.currencyScale,
    recognitionDate: command.recognitionDate,
    taxPoint: command.taxPoint,
    plan: command.plan,
    profileWitness: command.witness,
    profileGaps: command.gaps,
    reviewId: command.reviewId,
    approvalId: command.approvalId,
    changeSetId: command.changeSetId,
    voucherId: command.voucherId,
    payableId: command.payableId,
    taxFactIds: command.plan.taxFacts.map((fact) => fact.taxFactId),
    recordedBy: command.actorId,
    recordedAt,
    receipt: command.receipt,
  });

  const sealed = yield* Shared.decode(RecognitionSchema, { ...body, digest: yield* digest(body) });

  yield* Db.insertRecognition(transaction, command.bookId, {
    eventOwner: "supplier_purchase",
    id: sealed.id,
    economicKey: sealed.economicKey,
    originalRecognitionId: null,
    draftId: sealed.draftId,
    draftRevision: sealed.supplierInvoiceRevision,
    counterpartyId: sealed.counterpartyId,
    documentNumber: sealed.supplierDocumentNumber,
    voucherId: sealed.voucherId,
    payableId: sealed.payableId,
    changeSetId: sealed.changeSetId,
    approvalId: sealed.approvalId,
    recognitionDate: sealed.recognitionDate,
    taxPointOn: command.taxPoint.taxPointOn,
    // The stored columns are the sealed plan's own totals, so the body, the
    // numeric columns and the stored digest cannot disagree about the gross.
    grossMinor: sealed.plan.payableMinor,
    deductibleTaxMinor: sealed.plan.totalDeductibleTaxMinor,
    body: yield* Shared.toJsonObject(sealed),
    digest: sealed.digest,
    recordedAt,
  });

  for (const fact of command.plan.taxFacts) {
    yield* writeTaxFact(transaction, {
      bookId: command.bookId,
      factId: fact.taxFactId,
      recognitionId,
      voucherId: command.voucherId,
      fact,
      recordedAt,
      ruleReleaseId,
    });
  }

  for (const line of command.plan.lines) {
    const selection = command.selections.find((entry) => entry.lineId === line.sourceLineId);

    if (selection === undefined) return yield* failure("InternalError");

    const capacity = yield* Shared.decode(CapacitySchema, {
      recognitionId,
      sourceLineId: line.sourceLineId,
      expenseAccountId: line.expenseAccountId,
      inputVatAccountId: command.inputVatAccountId,
      originalNetMinor: line.netMinor,
      originalSourceTaxMinor: line.sourceTaxMinor,
      originalDeductibleTaxMinor: line.deductibleTaxMinor,
      creditedNetMinor: "0",
      creditedSourceTaxMinor: "0",
      releasedDeductionMinor: "0",
      remainingNetMinor: line.netMinor,
      remainingSourceTaxMinor: line.sourceTaxMinor,
      remainingDeductionMinor: line.deductibleTaxMinor,
      treatment: selection.treatment,
      taxComponentId: line.taxComponentId,
      taxFactId: line.taxFactId,
      version: "1",
      updatedAt: recordedAt,
    });

    yield* Db.insertCapacity(transaction, command.bookId, {
      recognitionId,
      sourceLineId: line.sourceLineId,
      expenseAccountId: line.expenseAccountId,
      inputVatAccountId: command.inputVatAccountId,
      originalNetMinor: line.netMinor,
      originalSourceTaxMinor: line.sourceTaxMinor,
      originalDeductibleTaxMinor: line.deductibleTaxMinor,
      body: yield* Shared.toJsonObject(capacity),
      updatedAt: recordedAt,
    });
  }

  return sealed;
});

export type CreditRecognitionWrite = {
  readonly scope: Scope;
  readonly bookId: string;
  readonly actorId: string;
  readonly receipt: JsonObject;
  readonly recognitionId: string;
  readonly originalRecognitionId: string;
  readonly invoiceId: string;
  readonly supplierCreditNumber: string;
  readonly reviewId: string;
  readonly approvalId: string;
  readonly changeSetId: string;
  readonly voucherId: string;
  readonly counterpartyId: string;
  readonly creditDate: string;
  readonly taxPoint: DraftTaxPoint;
  readonly currency: string;
  readonly currencyScale: number;
  readonly creditGrossMinor: string;
  readonly releasedDeductionMinor: string;
  readonly lineReleases: ReadonlyArray<CreditLineRelease>;
  readonly taxAdjustments: ReadonlyArray<Plan["taxFacts"][number]>;
  readonly creditEvidence: JsonObject;
  readonly witness: Json;
  readonly gaps: Json;
};

// A recognized credit is its own economic event: it appends negative signed
// components that adjust the original recognition and consumes its original-line
// capacity, in the caller's transaction.
export const recordCreditRecognitionInTransaction = Effect.fn(
  "purchases.recognition.recordCreditInTransaction",
)(function* (transaction: Transaction, command: CreditRecognitionWrite) {
  const recordedAt = yield* isoNow(transaction);
  const recognitionId = command.recognitionId;
  const economicKey = creditEconomicKey(command.counterpartyId, command.supplierCreditNumber);

  const ruleReleaseId =
    Shared.textField(
      Shared.isJsonObject(command.witness) ? command.witness : {},
      "ruleReleaseId",
    ) ?? null;

  const body = yield* Shared.toJsonObject({
    id: recognitionId,
    scope: command.scope,
    version: 1,
    eventOwner: "supplier_credit",
    economicKey,
    originalRecognitionId: command.originalRecognitionId,
    invoiceId: command.invoiceId,
    supplierCreditNumber: command.supplierCreditNumber,
    reviewId: command.reviewId,
    counterpartyId: command.counterpartyId,
    creditGrossMinor: command.creditGrossMinor,
    releasedDeductionMinor: command.releasedDeductionMinor,
    lineReleases: command.lineReleases,
    creditDate: command.creditDate,
    creditEvidence: command.creditEvidence,
    // A credit carries the original recognition's currency and scale. An empty
    // currency and scale 0 would make the credit's own amounts unreadable.
    currency: command.currency,
    currencyScale: command.currencyScale,
    recognitionDate: command.creditDate,
    taxPoint: command.taxPoint,
    profileWitness: command.witness,
    profileGaps: command.gaps,
    changeSetId: command.changeSetId,
    approvalId: command.approvalId,
    voucherId: command.voucherId,
    payableId: command.invoiceId,
    taxFactIds: command.taxAdjustments.map((adjustment) => adjustment.taxFactId),
    recordedBy: command.actorId,
    recordedAt,
    receipt: command.receipt,
  });

  const sealed = yield* Shared.decode(CreditRecognitionSchema, {
    ...body,
    digest: yield* digest(body),
  });

  yield* Db.insertRecognition(transaction, command.bookId, {
    eventOwner: "supplier_credit",
    id: sealed.id,
    economicKey: sealed.economicKey,
    originalRecognitionId: sealed.originalRecognitionId,
    draftId: null,
    draftRevision: null,
    counterpartyId: sealed.counterpartyId,
    documentNumber: sealed.supplierCreditNumber,
    voucherId: sealed.voucherId,
    payableId: sealed.payableId,
    changeSetId: sealed.changeSetId,
    approvalId: sealed.approvalId,
    recognitionDate: sealed.creditDate,
    taxPointOn: command.taxPoint.taxPointOn,
    grossMinor: sealed.creditGrossMinor,
    deductibleTaxMinor: sealed.releasedDeductionMinor,
    body: yield* Shared.toJsonObject(sealed),
    digest: sealed.digest,
    recordedAt,
  });

  for (const adjustment of command.taxAdjustments) {
    yield* writeTaxFact(transaction, {
      bookId: command.bookId,
      factId: adjustment.taxFactId,
      recognitionId,
      voucherId: command.voucherId,
      fact: adjustment,
      recordedAt,
      ruleReleaseId,
    });
  }

  return sealed;
});

// Consumption is exact and versioned. A capacity another writer already moved
// is a refusal, never an overwrite.
export const consumeLineCapacities = Effect.fn("purchases.recognition.consumeCapacities")(
  function* (
    transaction: Transaction,
    command: {
      readonly bookId: string;
      readonly recognitionId: string;
      readonly recordedAt: string;
      readonly releases: ReadonlyArray<CreditLineRelease>;
    },
  ) {
    for (const release of command.releases) {
      const locked = (yield* Db.lockCapacities(transaction, command.bookId, command.recognitionId, [
        release.sourceLineId,
      ]))[0];

      if (!locked) return yield* failure("StaleDependency");

      const body = yield* Shared.decode(
        CapacitySchema,
        Object.assign({}, locked.body, {
          creditedNetMinor: release.creditedNetAfterMinor,
          creditedSourceTaxMinor: release.creditedSourceTaxAfterMinor,
          releasedDeductionMinor: release.releasedDeductionAfterMinor,
          remainingNetMinor: remaining(locked.originalNetMinor, release.creditedNetAfterMinor),
          remainingSourceTaxMinor: remaining(
            locked.originalSourceTaxMinor,
            release.creditedSourceTaxAfterMinor,
          ),
          remainingDeductionMinor: remaining(
            locked.originalDeductibleTaxMinor,
            release.releasedDeductionAfterMinor,
          ),
          version: (BigInt(locked.version) + 1n).toString(),
          updatedAt: command.recordedAt,
        }),
      );

      const moved = yield* Db.consumeCapacity(
        transaction,
        command.bookId,
        command.recognitionId,
        {
          sourceLineId: release.sourceLineId,
          creditedNetMinor: release.creditNetMinor,
          creditedSourceTaxMinor: release.creditSourceTaxMinor,
          releasedDeductionMinor: release.releasedDeductionMinor,
          version: locked.version,
        },
        yield* Shared.toJsonObject(body),
        command.recordedAt,
      );

      if (moved.length !== 1) return yield* failure("StaleDependency");
    }
  },
);

// A retained capacity row is the single authority for one original source line:
// its reviewed treatment, the deduction the recognition recorded and what later
// credits have already consumed.
export const capacityFor = Effect.fn("purchases.recognition.capacityFor")(function* (
  row: Db.CapacityRow,
) {
  const treatment = yield* Shared.decode(
    TreatmentSchema,
    Shared.objectField(row.body, "treatment"),
  );

  return {
    sourceLineId: row.sourceLineId,
    expenseAccountId: row.expenseAccountId,
    inputVatAccountId: row.inputVatAccountId,
    originalNetMinor: row.originalNetMinor,
    originalSourceTaxMinor: row.originalSourceTaxMinor,
    originalDeductibleTaxMinor: row.originalDeductibleTaxMinor,
    creditedNetMinor: row.creditedNetMinor,
    creditedSourceTaxMinor: row.creditedSourceTaxMinor,
    releasedDeductionMinor: row.releasedDeductionMinor,
    treatment: compilerTreatment(treatment),
    taxComponentId: Shared.textField(row.body, "taxComponentId") ?? row.sourceLineId,
    taxFactId: Shared.textField(row.body, "taxFactId") ?? row.sourceLineId,
  } satisfies OriginalLineCapacity;
});

function remaining(original: string, consumed: string) {
  const left = BigInt(original) - BigInt(consumed);

  return left < 0n ? "0" : left.toString();
}

const readRecognitionView = Effect.fn("purchases.recognition.view")(function* (
  transaction: Transaction,
  bookId: string,
  row: Db.RecognitionRow,
) {
  const recognition =
    row.body.eventOwner === "supplier_credit"
      ? yield* Shared.decode(CreditRecognitionSchema, row.body)
      : yield* Shared.decode(RecognitionSchema, row.body);

  const taxFacts = yield* Effect.forEach(
    yield* Db.readTaxFacts(transaction, bookId, row.id),
    (fact) => Shared.decode(TaxFactSchema, fact.body),
  );

  const capacities = yield* Effect.forEach(
    yield* Db.readCapacities(transaction, bookId, row.id),
    (capacity) => Shared.decode(CapacitySchema, capacity.body),
  );

  const adjustments = yield* Effect.forEach(
    yield* Db.readAdjustmentTaxFacts(transaction, bookId, row.id),
    (fact) => Shared.decode(TaxFactSchema, fact.body),
  );

  return yield* Shared.decode(
    ViewSchema,
    yield* Shared.toJsonObject({
      recognition,
      taxFacts,
      capacities,
      adjustments,
      blockers: [],
      dependenciesCurrent: true,
    }),
  );
});

export const getPurchaseRecognition = Effect.fn("purchases.recognition.get")(function* (
  token: string,
  command: { readonly scope: Scope; readonly recognitionId: string },
) {
  return yield* Shared.withBook(token, command.scope, false, "share", (transaction) =>
    Effect.gen(function* () {
      yield* Shared.requireTables(transaction, [...Db.recognitionTables]);

      const book = yield* Shared.PurchaseDb.lockBook(transaction, command.scope.bookId, "share");

      if (!book) return yield* failure("Forbidden");

      const row = (yield* Db.readRecognition(
        transaction,
        command.scope.bookId,
        command.recognitionId,
      ))[0];

      if (!row) return yield* failure("NotFound");

      return yield* readRecognitionView(transaction, command.scope.bookId, row);
    }),
  );
});

export const getPurchaseRecognitionByDraft = Effect.fn("purchases.recognition.getByDraft")(
  function* (token: string, command: { readonly scope: Scope; readonly draftId: string }) {
    return yield* Shared.withBook(token, command.scope, false, "share", (transaction) =>
      Effect.gen(function* () {
        yield* Shared.requireTables(transaction, [...Db.recognitionTables]);

        const book = yield* Shared.PurchaseDb.lockBook(transaction, command.scope.bookId, "share");

        if (!book) return yield* failure("Forbidden");

        const row = (yield* Db.readRecognitionByDraft(
          transaction,
          command.scope.bookId,
          command.draftId,
        ))[0];

        if (!row) return yield* failure("NotFound");

        return yield* readRecognitionView(transaction, command.scope.bookId, row);
      }),
    );
  },
);
