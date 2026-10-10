import * as Accounting from "@open-erp/contracts/accounting";
import * as Service from "@open-erp/contracts/service-purchases";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core/errors";
import {
  compileCrossBorderService,
  type ServiceFailureCode,
  type ServicePurchasePlan,
} from "@open-erp/domain/service-purchases";
import * as Effect from "effect/Effect";
import * as Match from "effect/Match";
import * as Result from "effect/Result";
import type * as Schema from "effect/Schema";
import { failure } from "../failures";
import { questionSummary, requireResolvedSupplierQuestions } from "../work-questions";
import { digest } from "../json";
import {
  approveChangeInTransaction,
  executeChangeInTransaction,
  prepareJournalInTransaction,
  validatePlan,
} from "../posting";
import { isoNow, replay, saveCommand } from "../command-receipts";
import { newId } from "../identifiers";
import { sha256Hex } from "../hashing";
import { decodeRelease } from "../company-profile-basis";
import * as CompanyDb from "../../db/company-profiles";
import { createInvoiceInTransaction } from "../commerce/register";
import * as AcceptanceDb from "../../db/purchases/acceptance";
import * as Db from "../../db/purchases/service-purchases";
import * as Recognition from "./recognition";
import * as Shared from "./shared";

type Scope = typeof Accounting.Scope.Type;

type Transaction = import("../../db/transaction").Transaction;

type Json = Schema.Json;

type JsonObject = Schema.JsonObject;

type Principal = Shared.Principal;

const ReviewSchema = Service.ServicePurchaseReview;

const ApprovalSchema = Service.ServicePurchaseApproval;

const RecognitionSchema = Service.ServicePurchaseRecognition;

const TaxFactSchema = Service.RecordedServiceTaxFact;

const ViewSchema = Service.ServicePurchaseView;

const HistorySchema = Service.ServicePurchaseHistory;

const RecognitionViewSchema = Service.ServicePurchaseRecognitionView;

type Plan = typeof Service.ServiceRecognitionPlan.Type;

type QueryFailure = Accounting.AccountingError | EffectDrizzleQueryError;

type Review = typeof Service.ServicePurchaseReview.Type;

type ReleaseSelection = typeof Service.ServiceReleaseSelection.Type;

const serviceTables = [
  "books",
  "accounts",
  "periods",
  "evidence",
  "events",
  "change_sets",
  "execution_receipts",
  "command_receipts",
  "commerce_counterparties",
  "commerce_counterparty_revisions",
  "commerce_control_accounts",
  "commerce_invoices",
  "supplier_invoice_drafts",
  "supplier_invoice_draft_revisions",
  "service_purchase_reviews",
  "service_purchase_approvals",
  "service_purchases",
  "bank_sources",
  "service_purchase_recognitions",
  "service_purchase_tax_facts",
];

const serviceInserts = [
  "service_purchase_reviews",
  "service_purchase_approvals",
  "change_sets",
  "events",
  "command_receipts",
  "service_purchase_recognitions",
  "service_purchase_tax_facts",
];

const legalBlockers = [
  "legal_identity_not_verified",
  "tax_profile_not_activated",
  "general_rule_release_not_qualified",
  "payment_not_initiated",
] as const;

const maximumReviews = 50;

const maximumApprovals = 50;

const maximumReviewBytes = 262144;

const approvalWindowMs = 60 * 60 * 1000;

const recoverableBlockers = new Set([
  "acceptance_not_implemented",
  "recognition_not_implemented",
  "legal_identity_not_verified",
  "tax_profile_not_activated",
  "supplier_document_number_missing",
  "supplier_identity_fields_missing",
  "buyer_identity_fields_missing",
  "tax_inputs_unreviewed",
]);

function serviceDraftAcceptable(body: JsonObject) {
  const totals = Shared.objectField(body, "totals");
  const content = Shared.objectField(body, "content");

  if (Shared.arrayField(body, "blockers").some((entry) => !tolerableBlocker(entry))) return false;

  if (content.supplierDocumentNumber === null || content.supplierDocumentNumber === undefined) {
    return false;
  }

  if (!/^[1-9][0-9]{0,37}$/.test(Shared.textField(totals, "grossMinor") ?? "")) return false;

  if (totals.sourceTotalMatches !== true) return false;

  return Shared.arrayField(body, "calculatedLines").every(
    (line) => Shared.isJsonObject(line) && line.sourceGrossMatches === true,
  );
}

function tolerableBlocker(entry: Json) {
  const code = Shared.textField(entry, "code");

  return code !== undefined && recoverableBlockers.has(code);
}

type ServicePosting = {
  readonly lines: ReadonlyArray<JsonObject>;
  readonly originalLines: ReadonlyArray<ServiceSelection>;
  readonly recognition: Plan;
  readonly releaseSelection: ReleaseSelection;
  readonly profileWitness: Json;
  readonly profileGaps: Json;
  readonly inputVatAccountId: string;
  readonly outputVatAccountId: string;
};

type ServiceSelection = {
  readonly lineId: string;
  readonly expenseAccountId: string;
  readonly originalNetMinor: string;
  readonly originalCurrency: string;
  readonly originalScale: number;
  readonly sourceTaxMinor: string;
  readonly taxComponentId: string;
  readonly serviceKind: string;
  readonly jurisdictionClass: "EU_OTHER" | "NON_EU";
  readonly deduction: { readonly numerator: string; readonly denominator: string };
  readonly accountingRate: { readonly numerator: string; readonly denominator: string };
  readonly accountingRateScheme: string;
  readonly taxPointRate: { readonly numerator: string; readonly denominator: string };
  readonly taxPointRateScheme: string;
};

const planJournalLines = (plan: Plan) =>
  plan.journal.map((line) => ({
    accountId: line.accountId,
    debitMinor: line.debitMinor,
    creditMinor: line.creditMinor,
    description: line.description,
  }));

const unsupportedFailures = new Set<ServiceFailureCode>([
  "UnsupportedServiceKind",
  "UnsupportedJurisdictionClass",
  "PlaceOfSupplyException",
  "UnsupportedForeignTax",
]);

function refusalFor(code: ServiceFailureCode) {
  return unsupportedFailures.has(code) ? Shared.unsupported() : failure("InvalidJournal");
}

// The reviewed accounts must be real, active and outside the bank and control
// roles before any amount is compiled for them. The payable control and the
// input VAT account resolve to the retained domestic purchase controls, so a
// service recognition posts against the same controls the VAT return already
// reconciles; only the reverse-charge output account is operator-placed, and
// the return's control reconciliation is the backstop for it.
function serviceAccounts(
  transaction: Transaction,
  bookId: string,
  assignments: ReadonlyArray<{ readonly expenseAccountId: string }>,
  control: string,
  input: string,
  output: string,
): Effect.Effect<void, QueryFailure> {
  return Effect.gen(function* () {
    if (new Set([control, input, output]).size !== 3) return yield* failure("InvalidJournal");

    for (const accountId of [input, output]) {
      const account = (yield* Db.readActiveAccount(transaction, bookId, accountId))[0];

      if (account === undefined || account.id !== accountId) {
        return yield* failure("InvalidJournal");
      }
    }

    if (
      (yield* AcceptanceDb.readBankSourceConflict(transaction, bookId, [control, input, output]))[0]
        ?.present === true
    ) {
      return yield* failure("InvalidJournal");
    }

    yield* Effect.forEach(assignments, (assignment) =>
      Effect.gen(function* () {
        const account = (yield* AcceptanceDb.readExpenseAccount(
          transaction,
          bookId,
          assignment.expenseAccountId,
          [control, input, output],
        ))[0];

        if (account === undefined || account.id !== assignment.expenseAccountId) {
          return yield* failure("InvalidJournal");
        }

        if (
          (yield* AcceptanceDb.readBankSourceConflict(transaction, bookId, [
            assignment.expenseAccountId,
          ]))[0]?.present === true ||
          (yield* AcceptanceDb.readControlAccountConflict(
            transaction,
            bookId,
            [assignment.expenseAccountId],
            "supplier",
          ))[0]?.present === true
        ) {
          return yield* failure("InvalidJournal");
        }
      }),
    );
  });
}

// The qualified general-rule section is read from the one `vat` rule release
// the company admission owner resolved for the tax point date. A release
// without the section, an unknown rate row, or a service outside the
// qualified kinds and classes is a refusal, never a default.
function readReleaseSelection(
  transaction: Transaction,
  scope: Scope,
  taxPointOn: string,
  rateId: string,
): Effect.Effect<{ selection: ReleaseSelection; witness: Json; gaps: Json }, QueryFailure> {
  return Effect.gen(function* () {
    const admission = yield* Recognition.readVatWitness(transaction, scope, taxPointOn);

    if (admission.witness === null) return yield* Shared.unsupported();

    const ruleReleaseId = Shared.textField(
      Shared.isJsonObject(admission.witness) ? admission.witness : {},
      "ruleReleaseId",
    );

    if (ruleReleaseId === undefined) return yield* Shared.unsupported();

    const rows = yield* CompanyDb.readRuleReleases(transaction, "vat");

    const decoded = rows
      .map((row) => ({ row, release: decodeRelease(row) }))
      .find((entry) => entry.release !== null && entry.row.id === ruleReleaseId);

    const section = decoded?.release?.vat?.generalRuleServices;

    if (section === undefined) return yield* Shared.unsupported();

    const rate = section.rates.find((entry) => entry.rateId === rateId);

    if (rate === undefined) return yield* Shared.unsupported();

    return {
      selection: {
        rateId: rate.rateId,
        rate: { numerator: rate.numerator, denominator: rate.denominator },
        euBasisBox: section.euBasisBox,
        nonEuBasisBox: section.nonEuBasisBox,
        outputBox: rate.outputBox,
        inputBox: section.inputBox,
        taxRounding: section.taxRounding,
        deductionRounding: section.deductionRounding,
        supportedServiceKinds: [...section.supportedServiceKinds],
        supportedClasses: [...section.supportedClasses],
      } satisfies ReleaseSelection,
      witness: admission.witness,
      gaps: yield* Shared.toJson(admission.gaps),
    };
  });
}

function draftLineNet(line: Json) {
  if (!Shared.isJsonObject(line)) return null;

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

// Every assigned line must be the retained draft line it names: the same
// line id, the same net from the draft's own base, discount and charge, the
// same asserted tax and the same currency and scale. The assigned lines must
// then foot exactly to the draft's retained gross.
function reconcileServiceLines(
  draft: JsonObject,
  input: typeof Service.PrepareServicePurchase.Type,
): Effect.Effect<ReadonlyArray<ServiceSelection>, Accounting.AccountingError> {
  return Effect.gen(function* () {
    const content = Shared.objectField(draft, "content");
    const draftLines = Shared.arrayField(content, "lines");
    const draftCurrency = Shared.textField(content, "currency");
    const draftScale = Shared.numberField(content, "currencyScale");
    const selections: Array<ServiceSelection> = [];

    for (const assignment of input.lineAssignments) {
      selections.push(
        yield* reconcileServiceLine(draftLines, draftCurrency, draftScale, assignment),
      );
    }

    const unique = new Set(selections.map((entry) => entry.lineId));

    if (
      selections.length === 0 ||
      unique.size !== selections.length ||
      input.lineAssignments.length !== selections.length
    ) {
      return yield* Shared.unsupported();
    }

    const assignedTotal = selections.reduce(
      (total, selection) => total + BigInt(selection.originalNetMinor),
      0n,
    );

    if (
      assignedTotal.toString() !==
      Shared.textField(Shared.objectField(draft, "totals"), "grossMinor")
    ) {
      return yield* failure("InvalidJournal");
    }

    return selections;
  });
}

function reconcileServiceLine(
  draftLines: ReadonlyArray<Json>,
  draftCurrency: string | undefined,
  draftScale: number | undefined,
  assignment: typeof Service.ServiceLineAssignment.Type,
): Effect.Effect<ServiceSelection, Accounting.AccountingError> {
  return Effect.gen(function* () {
    const draftLine = draftLines.find((line) => Shared.textField(line, "id") === assignment.lineId);
    const amounts = draftLineNet(draftLine ?? null);

    if (
      draftLine === undefined ||
      amounts === null ||
      amounts.net !== assignment.originalNetMinor ||
      amounts.tax !== assignment.sourceTaxMinor ||
      assignment.originalCurrency !== draftCurrency ||
      assignment.originalScale !== draftScale
    ) {
      return yield* failure("InvalidJournal");
    }

    if (assignment.sourceTaxMinor !== "0") return yield* Shared.unsupported();

    return {
      lineId: assignment.lineId,
      expenseAccountId: assignment.expenseAccountId,
      originalNetMinor: assignment.originalNetMinor,
      originalCurrency: assignment.originalCurrency,
      originalScale: assignment.originalScale,
      sourceTaxMinor: assignment.sourceTaxMinor,
      taxComponentId: "",
      serviceKind: assignment.serviceKind,
      jurisdictionClass: assignment.jurisdictionClass,
      deduction: {
        numerator: assignment.deduction.numerator,
        denominator: assignment.deduction.denominator,
      },
      accountingRate: {
        numerator: assignment.accountingRate.numerator,
        denominator: assignment.accountingRate.denominator,
      },
      accountingRateScheme: assignment.accountingRateScheme,
      taxPointRate: {
        numerator: assignment.taxPointRate.numerator,
        denominator: assignment.taxPointRate.denominator,
      },
      taxPointRateScheme: assignment.taxPointRateScheme,
    } satisfies ServiceSelection;
  });
}

function serviceRecognition(
  transaction: Transaction,
  scope: Scope,
  book: { currency: string; currencyScale: number },
  draft: JsonObject,
  input: typeof Service.PrepareServicePurchase.Type,
): Effect.Effect<ServicePosting, QueryFailure> {
  return Effect.gen(function* () {
    if (book.currency !== "SEK" || book.currencyScale !== 2) {
      return yield* Shared.unsupported();
    }

    const control = (yield* AcceptanceDb.readBasAccount(transaction, scope.bookId, "2440"))[0]?.id;
    const vat = (yield* AcceptanceDb.readBasAccount(transaction, scope.bookId, "2641"))[0]?.id;

    if (control === null || control === undefined || control !== input.controlAccountId) {
      return yield* failure("InvalidJournal");
    }

    if (vat === null || vat === undefined || vat !== input.inputVatAccountId) {
      return yield* failure("InvalidJournal");
    }

    const content = Shared.objectField(draft, "content");
    const documentDate = Shared.textField(content, "documentDate");
    const counterpartyId = Shared.textField(content, "counterpartyId");
    const supplierDocumentNumber = Shared.textField(content, "supplierDocumentNumber");

    if (documentDate === undefined || input.taxPoint.taxPointOn > documentDate) {
      return yield* failure("InvalidJournal");
    }

    // The tax point must be a date the retained supplier document actually
    // carries. A received-date basis has no draft evidence in this owner and
    // is refused rather than assumed.
    const expectedTaxPoint = Match.value(input.taxPoint.basis).pipe(
      Match.when("document_date", () => Shared.textField(content, "documentDate")),
      Match.when("supply_date", () => Shared.textField(content, "supplyDate")),
      Match.orElse(() => undefined),
    );

    if (expectedTaxPoint === undefined || expectedTaxPoint !== input.taxPoint.taxPointOn) {
      return yield* Shared.unsupported();
    }

    if (counterpartyId === undefined || supplierDocumentNumber === undefined) {
      return yield* failure("InvalidJournal");
    }

    const sourceEvidenceId = Shared.textField(content, "sourceEvidenceId");

    if (sourceEvidenceId === undefined) return yield* failure("MissingEvidence");

    const selections = yield* reconcileServiceLines(draft, input);

    yield* serviceAccounts(
      transaction,
      scope.bookId,
      selections,
      input.controlAccountId,
      input.inputVatAccountId,
      input.outputVatAccountId,
    );

    const key = serviceEconomicKey(counterpartyId, supplierDocumentNumber);
    const recognitionId = yield* serviceRecognitionId(key);

    yield* Shared.readEvidenceReference(transaction, scope.bookId, sourceEvidenceId);

    const resolved = yield* readReleaseSelection(
      transaction,
      scope,
      input.taxPoint.taxPointOn,
      input.rateId,
    );

    const result = compileCrossBorderService({
      currencyScale: book.currencyScale,
      bookCurrency: book.currency,
      recognitionDate: documentDate,
      taxPoint: input.taxPoint,
      payableAccountId: input.controlAccountId,
      inputVatAccountId: input.inputVatAccountId,
      outputVatAccountId: input.outputVatAccountId,
      reportingObligationId: null,
      ruleReleaseId:
        Shared.textField(
          Shared.isJsonObject(resolved.witness) ? resolved.witness : {},
          "ruleReleaseId",
        ) ?? null,
      taxComponentPrefix: recognitionId,
      release: resolved.selection,
      lines: selections.map((selection) => ({
        sourceLineId: selection.lineId,
        expenseAccountId: selection.expenseAccountId,
        originalNetMinor: selection.originalNetMinor,
        originalCurrency: selection.originalCurrency,
        originalScale: selection.originalScale,
        sourceTaxMinor: selection.sourceTaxMinor,
        serviceKind: selection.serviceKind,
        jurisdictionClass: selection.jurisdictionClass,
        exceptionAssessment: "none" as const,
        deduction: selection.deduction,
        accountingRate: selection.accountingRate,
        accountingRateScheme: selection.accountingRateScheme,
        taxPointRate: selection.taxPointRate,
        taxPointRateScheme: selection.taxPointRateScheme,
        sourceRefs: [
          {
            evidenceId: sourceEvidenceId,
            sourceKey: `supplier_line:${selection.lineId}`,
          },
        ],
      })),
    });

    if (Result.isFailure(result)) return yield* refusalFor(result.failure.code);

    const withComponents = selections.map((selection) => ({
      ...selection,
      taxComponentId: `${recognitionId}_${selection.lineId}`,
    }));

    return {
      lines: planJournalLines(result.success),
      originalLines: withComponents,
      recognition: wirePlan(result.success),
      releaseSelection: resolved.selection,
      profileWitness: resolved.witness,
      profileGaps: resolved.gaps,
      inputVatAccountId: input.inputVatAccountId,
      outputVatAccountId: input.outputVatAccountId,
    } satisfies ServicePosting;
  });
}

function wirePlan(plan: ServicePurchasePlan) {
  return {
    currencyScale: plan.currencyScale,
    bookCurrency: plan.bookCurrency,
    recognitionDate: plan.recognitionDate,
    totalAccountingValueMinor: plan.totalAccountingValueMinor,
    totalTaxBaseMinor: plan.totalTaxBaseMinor,
    totalOutputTaxMinor: plan.totalOutputTaxMinor,
    totalDeductibleTaxMinor: plan.totalDeductibleTaxMinor,
    totalNonDeductibleTaxMinor: plan.totalNonDeductibleTaxMinor,
    payableMinor: plan.payableMinor,
    payableAccountId: plan.payableAccountId,
    inputVatAccountId: plan.inputVatAccountId,
    outputVatAccountId: plan.outputVatAccountId,
    lines: plan.lines.map((line) => ({ ...line })),
    taxFacts: plan.taxFacts.map((fact) => ({ ...fact })),
    journal: plan.journal.map((line) => ({ ...line })),
  } satisfies Plan;
}

// One recognized economic event has one identity, derived from the reviewed
// supplier identity rather than drawn at write time. Prepare, approval and
// execution therefore agree on it, and every tax component is namespaced by
// it, so a second invoice's local line ids cannot collide with the first
// invoice's.
function derivedId(prefix: string, economicKey: string) {
  return Effect.map(sha256Hex(economicKey), (hash) => `${prefix}_${hash.slice(0, 24)}`);
}

export function serviceEconomicKey(counterpartyId: string, documentNumber: string) {
  return `service_purchase:${counterpartyId}:${documentNumber}`;
}

export function serviceRecognitionId(key: string) {
  return derivedId("service_purchase_recognition", key);
}

type RecognitionWrite = {
  readonly scope: Scope;
  readonly bookId: string;
  readonly actorId: string;
  readonly receipt: JsonObject;
  readonly recognitionId: string;
  readonly economicKey: string;
  readonly reviewId: string;
  readonly draftId: string;
  readonly draftRevision: string;
  readonly draftDigest: string;
  readonly counterpartyId: string;
  readonly documentNumber: string;
  readonly approvalId: string;
  readonly changeSetId: string;
  readonly voucherId: string;
  readonly payableId: string;
  readonly currency: string;
  readonly currencyScale: number;
  readonly recognitionDate: string;
  readonly taxPoint: { readonly taxPointOn: string; readonly basis: string };
  readonly plan: Plan;
  readonly selections: ReadonlyArray<ServiceSelection>;
  readonly releaseSelection: ReleaseSelection;
  readonly inputVatAccountId: string;
  readonly outputVatAccountId: string;
  readonly witness: Json;
  readonly gaps: Json;
};

// The immutable recognition and its signed reverse-charge components commit
// with the journal and the payable in the same transaction.
export const recordServiceRecognitionInTransaction = Effect.fn(
  "purchases.service-purchases.recordInTransaction",
)(function* (transaction: Transaction, command: RecognitionWrite) {
  const recordedAt = yield* isoNow(transaction);

  const ruleReleaseId = Shared.textField(
    Shared.isJsonObject(command.witness) ? command.witness : {},
    "ruleReleaseId",
  );

  const body = yield* Shared.toJsonObject({
    id: command.recognitionId,
    scope: command.scope,
    version: 1,
    eventOwner: "service_purchase",
    economicKey: command.economicKey,
    reviewId: command.reviewId,
    draftId: command.draftId,
    draftRevision: command.draftRevision,
    draftDigest: command.draftDigest,
    counterpartyId: command.counterpartyId,
    supplierDocumentNumber: command.documentNumber,
    currency: command.currency,
    currencyScale: command.currencyScale,
    recognitionDate: command.recognitionDate,
    taxPoint: command.taxPoint,
    profileWitness: command.witness,
    profileGaps: command.gaps,
    releaseSelection: command.releaseSelection,
    changeSetId: command.changeSetId,
    approvalId: command.approvalId,
    voucherId: command.voucherId,
    payableId: command.payableId,
    taxFactIds: command.plan.taxFacts.map((fact) => fact.taxFactId),
    plan: command.plan,
    recordedBy: command.actorId,
    recordedAt,
    receipt: command.receipt,
  });

  const sealed = yield* Shared.decode(RecognitionSchema, {
    ...body,
    digest: yield* digest(body),
  });

  yield* Db.insertRecognition(transaction, command.bookId, {
    id: sealed.id,
    economicKey: sealed.economicKey,
    draftId: sealed.draftId,
    draftRevision: sealed.draftRevision,
    counterpartyId: sealed.counterpartyId,
    documentNumber: sealed.supplierDocumentNumber,
    voucherId: sealed.voucherId,
    payableId: sealed.payableId,
    changeSetId: sealed.changeSetId,
    approvalId: sealed.approvalId,
    recognitionDate: sealed.recognitionDate,
    taxPointOn: command.taxPoint.taxPointOn,
    grossMinor: sealed.plan.payableMinor,
    deductibleTaxMinor: sealed.plan.totalDeductibleTaxMinor,
    body: yield* Shared.toJsonObject(sealed),
    digest: sealed.digest,
    recordedAt,
  });

  for (const fact of command.plan.taxFacts) {
    const factBody = yield* Shared.toJsonObject({
      id: fact.taxFactId,
      recognitionId: sealed.id,
      sourceLineId: fact.sourceLineId,
      componentRole: fact.componentRole,
      taxComponentId: fact.taxComponentId,
      voucherId: sealed.voucherId,
      signedBaseMinor: fact.signedBaseMinor,
      signedOutputTaxMinor: fact.signedOutputTaxMinor,
      signedDeductibleTaxMinor: fact.signedDeductibleTaxMinor,
      sourceTaxMinor: fact.sourceTaxMinor,
      nonDeductibleTaxMinor: fact.nonDeductibleTaxMinor,
      serviceKind: fact.serviceKind,
      jurisdictionClass: fact.jurisdictionClass,
      rateId: fact.rateId,
      basisBox: fact.basisBox,
      outputBox: fact.outputBox,
      inputBox: fact.inputBox,
      taxPointOn: fact.taxPointOn,
      reportingObligationId: null,
      ruleReleaseId: ruleReleaseId ?? null,
      sourceRefs: fact.sourceRefs,
      adjustsTaxFactId: null,
      recordedAt,
    });

    const recorded = yield* Shared.decode(TaxFactSchema, {
      ...factBody,
      digest: yield* digest(factBody),
    });

    yield* Db.insertTaxFact(transaction, command.bookId, {
      id: recorded.id,
      recognitionId: sealed.id,
      sourceLineId: recorded.sourceLineId,
      taxComponentId: recorded.taxComponentId,
      voucherId: sealed.voucherId,
      signedBaseMinor: recorded.signedBaseMinor,
      signedOutputTaxMinor: recorded.signedOutputTaxMinor,
      signedDeductibleTaxMinor: recorded.signedDeductibleTaxMinor,
      sourceTaxMinor: recorded.sourceTaxMinor,
      nonDeductibleTaxMinor: recorded.nonDeductibleTaxMinor,
      taxPointOn: recorded.taxPointOn,
      body: yield* Shared.toJsonObject(recorded),
      digest: recorded.digest,
      recordedAt,
    });
  }

  return sealed;
});

function readDraftForService(transaction: Transaction, bookId: string, draftId: string) {
  return AcceptanceDb.readDraftHead(transaction, bookId, draftId).pipe(
    Effect.flatMap((rows) => {
      const head = rows[0];

      return head ? Effect.succeed(head) : failure("NotFound");
    }),
  );
}

function readReview(transaction: Transaction, bookId: string, reviewId: string) {
  return Db.readReview(transaction, bookId, reviewId).pipe(
    Effect.flatMap((rows) => {
      const review = rows[0];

      return review ? Effect.succeed(review) : failure("NotFound");
    }),
  );
}

export const prepareServicePurchase = Effect.fn("purchases.service-purchases.prepare")(function* (
  token: string,
  command: {
    readonly scope: Scope;
    readonly idempotencyKey: string;
    readonly input: typeof Service.PrepareServicePurchase.Type;
  },
) {
  return yield* Shared.withBook(token, command.scope, true, "update", (transaction, principal) =>
    Effect.gen(function* () {
      yield* Shared.requireTables(transaction, serviceTables, serviceInserts);
      yield* Shared.requireColumns(transaction, Shared.accountColumns);
      const book = yield* Shared.readBook(transaction, command.scope.bookId);
      yield* Shared.requireNativeCommerceProfile(book.profile, book.authority);

      const request = yield* replay(
        transaction,
        command.scope,
        command.idempotencyKey,
        "prepare_service_purchase",
        principal.actorId,
        yield* Shared.toJsonObject(command.input),
        ReviewSchema,
      );

      if (request.previous) return request.previous;

      const head = yield* readDraftForService(
        transaction,
        command.scope.bookId,
        command.input.draftId,
      );

      if (
        command.input.expectedRevision !== head.currentRevision ||
        command.input.expectedDigest !== Shared.textField(head.body, "digest")
      ) {
        return yield* failure("StaleDependency");
      }

      yield* requireResolvedSupplierQuestions(transaction, command.scope, command.input.draftId);

      if (
        (yield* Db.readAcceptanceForDraft(
          transaction,
          command.scope.bookId,
          command.input.draftId,
        ))[0]?.present === true
      ) {
        return yield* failure("AlreadyPosted");
      }

      if (!serviceDraftAcceptable(head.body)) return yield* Shared.unsupported();

      const ordinal =
        (yield* Db.readReviewCount(transaction, command.scope.bookId, command.input.draftId))[0]!
          .total + 1;

      if (ordinal > maximumReviews) return yield* failure("InvalidJournal");

      const sourceEvidenceId =
        Shared.textField(Shared.objectField(head.body, "content"), "sourceEvidenceId") ?? "";

      const evidence = yield* Shared.readEvidenceReference(
        transaction,
        command.scope.bookId,
        sourceEvidenceId,
      );

      if (
        yield* Shared.evidenceHasPostedHistory(transaction, command.scope.bookId, sourceEvidenceId)
      ) {
        return yield* failure("AlreadyPosted");
      }

      const content = Shared.objectField(head.body, "content");
      const reviewId = newId("service_review");

      const posting = yield* serviceRecognition(
        transaction,
        command.scope,
        book,
        head.body,
        command.input,
      );

      const plan = yield* prepareJournalInTransaction(transaction, principal, {
        scope: command.scope,
        idempotencyKey: `sp_${reviewId}_prepare`,
        input: {
          kind: "manual_journal",
          evidenceId: sourceEvidenceId,
          eventKey: `service_purchase_${Shared.textField(head.body, "id") ?? ""}`,
          accountingPeriodId: command.input.accountingPeriodId,
          postingDate: Shared.textField(content, "documentDate") ?? "",
          series: command.input.series,
          description: `Cross-border service: ${Shared.textField(content, "title") ?? ""}`,
          rationale: command.input.reason,
          taxAssessment: "not_applicable",
          lines: posting.lines.map((line) => ({
            accountId: Shared.textField(line, "accountId") ?? "",
            debitMinor: Shared.textField(line, "debitMinor") ?? "0",
            creditMinor: Shared.textField(line, "creditMinor") ?? "0",
            description: Shared.textField(line, "description") ?? "",
          })),
        },
      });

      const body: JsonObject = {
        id: reviewId,
        scope: command.scope,
        version: 1,
        profile: command.input.profile,
        ordinal,
        input: yield* Shared.toJsonObject(command.input),
        draftSnapshot: head.body,
        postingPlan: yield* Shared.toJsonObject(plan),
        evidence,
        originalLines: yield* Shared.toJson(posting.originalLines),
        recognition: yield* Shared.toJsonObject(posting.recognition),
        releaseSelection: yield* Shared.toJsonObject(posting.releaseSelection),
        profileWitness: yield* Shared.toJsonObject(posting.profileWitness),
        profileGaps: yield* Shared.toJson(posting.profileGaps),
        inputVatAccountId: posting.inputVatAccountId,
        outputVatAccountId: posting.outputVatAccountId,
        legalBlockers,
        createdAt: yield* isoNow(transaction),
        receipt: Shared.receipt(
          command.idempotencyKey,
          "prepare_service_purchase",
          principal.actorId,
        ),
      };

      const sealed = Object.assign({}, body, { digest: yield* digest(body) });

      if (Shared.byteLength(JSON.stringify(sealed)) > maximumReviewBytes) {
        return yield* failure("InvalidJournal");
      }

      const review = yield* Shared.decode(ReviewSchema, sealed);
      const planId = plan.id;
      const firstAction = plan.groups[0]?.actions[0];

      if (planId === "" || firstAction === undefined) {
        return yield* failure("InternalError");
      }

      yield* Db.insertReview(transaction, {
        bookId: command.scope.bookId,
        id: reviewId,
        draftId: command.input.draftId,
        draftRevision: head.currentRevision,
        ordinal,
        changeSetId: planId,
        eventId: firstAction.eventId,
        evidenceId: sourceEvidenceId,
        body: sealed,
      });
      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        request.expected,
        "prepare_service_purchase",
        principal.actorId,
        yield* Shared.toJsonObject(review),
      );

      return review;
    }),
  );
});

function serviceBlockers(transaction: Transaction, scope: Scope, review: Db.ReviewRow) {
  const bookId = scope.bookId;

  return Effect.gen(function* () {
    const body = review.body;
    const input = Shared.objectField(body, "input");
    const evidenceId = Shared.textField(Shared.objectField(body, "evidence"), "evidenceId") ?? "";

    if (
      (yield* Db.readAcceptanceForDraft(
        transaction,
        bookId,
        Shared.textField(input, "draftId") ?? "",
      ))[0]?.present === true
    ) {
      return ["This draft already has a retained service purchase."] as const;
    }

    if (yield* Shared.evidenceHasPostedHistory(transaction, bookId, evidenceId)) {
      return [
        "The original supplier source already has posted history; a second recognition is refused.",
      ] as const;
    }

    const blockers: string[] = [];

    const questions = yield* questionSummary(transaction, scope, {
      kind: "supplier",
      recordId: Shared.textField(input, "draftId") ?? "",
    });

    if (questions.summary.unresolved > 0)
      blockers.push("The supplier task has unresolved questions.");

    const head = yield* AcceptanceDb.readDraftHead(
      transaction,
      bookId,
      Shared.textField(input, "draftId") ?? "",
    );

    if (!head[0]) {
      blockers.push("The reviewed supplier draft is no longer available.");
    } else if (
      Shared.textField(input, "expectedRevision") !== head[0].currentRevision ||
      Shared.textField(input, "expectedDigest") !== Shared.textField(head[0].body, "digest")
    ) {
      blockers.push("The supplier draft changed after this review was prepared.");
    } else if (!serviceDraftAcceptable(head[0].body)) {
      blockers.push("The reviewed supplier draft is no longer acceptable for recognition.");
    }

    if (
      (yield* Db.readReviewByChangeSet(transaction, bookId, review.changeSetId))[0]?.present ===
      true
    ) {
      return ["The linked posting already executed. A second recognition is refused."] as const;
    }

    const plan = yield* Shared.decode(
      Accounting.ChangeSet,
      Shared.objectField(body, "postingPlan"),
    );

    blockers.push(
      ...(yield* validatePlan(transaction, scope, plan).pipe(
        Effect.match({
          onFailure: (error) => [error.message],
          onSuccess: () => [],
        }),
      )),
    );

    if (blockers.length > 0) return blockers;

    if (blockers.length === 0) {
      const codes = Shared.arrayField(head[0]?.body ?? {}, "blockers").flatMap((entry) => {
        const code = Shared.textField(entry, "code");

        return code === undefined || recoverableBlockers.has(code) ? [] : [code];
      });

      blockers.push(...codes);
    }

    return blockers;
  });
}

export const approveServicePurchaseInTransaction = Effect.fn(
  "purchases.service-purchases.approveInTransaction",
)(function* (
  transaction: Transaction,
  principal: Principal,
  command: {
    readonly scope: Scope;
    readonly reviewId: string;
    readonly idempotencyKey: string;
    readonly input: typeof Service.ApproveServicePurchase.Type;
  },
) {
  return yield* Effect.gen(function* () {
    yield* Shared.requireTables(transaction, serviceTables, serviceInserts);
    yield* Shared.requireColumns(transaction, Shared.accountColumns);
    const book = yield* Shared.readBook(transaction, command.scope.bookId);
    void book;

    const request = yield* replay(
      transaction,
      command.scope,
      command.idempotencyKey,
      "approve_service_purchase",
      principal.actorId,
      {
        reviewId: command.reviewId,
        input: yield* Shared.toJsonObject(command.input),
      } satisfies JsonObject,
      ApprovalSchema,
    );

    if (request.previous) return request.previous;

    const review = yield* readReview(transaction, command.scope.bookId, command.reviewId);

    if (command.input.digest !== Shared.textField(review.body, "digest")) {
      return yield* failure("StaleDependency");
    }

    yield* requireResolvedSupplierQuestions(
      transaction,
      command.scope,
      Shared.textField(Shared.objectField(review.body, "input"), "draftId") ?? "",
    );

    const blockers = yield* serviceBlockers(transaction, command.scope, review);

    if (blockers.length > 0) return yield* failure("StaleDependency");

    const ordinal =
      (yield* Db.readApprovalCount(transaction, command.scope.bookId, command.reviewId))[0]!.total +
      1;

    if (ordinal > maximumApprovals) return yield* failure("InvalidJournal");
    const now = (yield* AcceptanceDb.readDatabaseTime(transaction))[0]?.now;

    if (now === undefined) return yield* failure("InternalError");

    const body = Object.assign(
      {},
      {
        id: newId("service_approval"),
        scope: command.scope,
        reviewId: command.reviewId,
        digest: Shared.textField(review.body, "digest") ?? "",
        version: 1,
        actorId: principal.actorId,
        ordinal,
        expiresAt: new Date(Date.parse(now) + approvalWindowMs).toISOString(),
        createdAt: yield* isoNow(transaction),
        receipt: Shared.receipt(
          command.idempotencyKey,
          "approve_service_purchase",
          principal.actorId,
        ),
      },
    ) satisfies JsonObject;

    const approval = yield* Shared.decode(ApprovalSchema, body);
    yield* Db.insertApproval(transaction, {
      bookId: command.scope.bookId,
      id: Shared.textField(body, "id") ?? "",
      reviewId: command.reviewId,
      ordinal,
      actorId: principal.actorId,
      digest: Shared.textField(body, "digest") ?? "",
      expiresAt: Shared.textField(body, "expiresAt") ?? "",
      body: yield* Shared.toJsonObject(body),
    });
    yield* saveCommand(
      transaction,
      command.scope,
      command.idempotencyKey,
      request.expected,
      "approve_service_purchase",
      principal.actorId,
      yield* Shared.toJsonObject(approval),
    );

    return approval;
  });
});

export const approveServicePurchase = Effect.fn("purchases.service-purchases.approve")(function* (
  token: string,
  command: Parameters<typeof approveServicePurchaseInTransaction>[2],
) {
  return yield* Shared.withBook(token, command.scope, true, "update", (transaction, principal) =>
    approveServicePurchaseInTransaction(transaction, principal, command),
  );
});

// The reviewed supplier identity of one recognition. A second recognition of
// the same economic key is refused; a further evidence document about it is
// not.
const requireServiceIdentity = Effect.fn("purchases.service-purchases.identity")(function* (
  transaction: Transaction,
  scope: Scope,
  review: Review,
) {
  const documentNumber = review.draftSnapshot.content.supplierDocumentNumber;
  const counterpartyId = review.draftSnapshot.content.counterpartyId;

  if (documentNumber === null || review.recognition === undefined) {
    return yield* failure("InvalidJournal");
  }

  const key = serviceEconomicKey(counterpartyId, documentNumber);

  if (
    (yield* Db.readCounterpartyDocumentRecognition(
      transaction,
      scope.bookId,
      counterpartyId,
      documentNumber,
    ))[0]?.present === true
  ) {
    return yield* failure("AlreadyPosted");
  }

  return { key, documentNumber };
});

export const executeServicePurchase = Effect.fn("purchases.service-purchases.execute")(function* (
  token: string,
  command: {
    readonly scope: Scope;
    readonly reviewId: string;
    readonly idempotencyKey: string;
    readonly input: typeof Service.ExecuteServicePurchase.Type;
  },
) {
  return yield* Shared.withBook(token, command.scope, true, "update", (transaction, principal) =>
    Effect.gen(function* () {
      const { scope, reviewId, input, idempotencyKey } = command,
        operation = "execute_service_purchase";

      const request = yield* replay(
        transaction,
        scope,
        idempotencyKey,
        operation,
        principal.actorId,
        { reviewId, input },
        Service.ServicePurchaseReceipt,
      );

      if (request.previous) return request.previous;
      yield* Shared.requireTables(transaction, serviceTables, serviceInserts);
      const book = yield* Shared.readBook(transaction, scope.bookId);
      const row = yield* readReview(transaction, scope.bookId, reviewId);
      const review = yield* Shared.decode(ReviewSchema, row.body);

      if (review.digest !== input.digest) return yield* failure("StaleDependency");

      yield* requireResolvedSupplierQuestions(transaction, scope, review.input.draftId);

      if ((yield* serviceBlockers(transaction, scope, row)).length)
        return yield* failure("StaleDependency");

      const approval = (yield* Db.readApprovalById(
        transaction,
        scope.bookId,
        input.approvalId,
        reviewId,
      ))[0];

      if (
        !approval ||
        approval.actorId !== principal.actorId ||
        approval.digest !== review.digest ||
        Date.parse(approval.expiresAt) <= Date.parse(yield* isoNow(transaction)) ||
        (yield* Db.readAcceptanceByApproval(transaction, scope.bookId, approval.id))[0]?.present
      )
        return yield* failure("ApprovalRequired");

      const identity = yield* requireServiceIdentity(transaction, scope, review);

      const kernel = yield* approveChangeInTransaction(transaction, principal, {
        scope,
        changeSetId: review.postingPlan.id,
        idempotencyKey: newId("service_approve"),
        input: { version: 1, planDigest: review.postingPlan.planDigest },
      });

      const postingReceipt = yield* executeChangeInTransaction(transaction, principal, {
        scope,
        changeSetId: review.postingPlan.id,
        idempotencyKey: newId("service_post"),
        input: { version: 1, planDigest: review.postingPlan.planDigest, approvalId: kernel.id },
        owner: { kind: "service_purchase", id: reviewId },
      });

      const draft = review.draftSnapshot;

      const line = review.postingPlan.groups[0]?.actions[0]?.lines.find(
        (line) =>
          line.accountId === review.input.controlAccountId &&
          line.creditMinor === review.recognition.payableMinor,
      );

      if (
        !line ||
        draft.content.documentDate === null ||
        draft.content.dueDate === null ||
        draft.content.supplierDocumentNumber === null
      )
        return yield* failure("InvalidJournal");

      const invoice = yield* createInvoiceInTransaction(transaction, principal, {
        scope,
        idempotencyKey: newId("service_register"),
        input: {
          kind: "synthetic_invoice_v1",
          direction: "supplier",
          counterpartyId: draft.content.counterpartyId,
          counterpartyRevision: draft.content.counterpartyRevision,
          documentNumber: draft.content.supplierDocumentNumber,
          issuedOn: draft.content.documentDate,
          dueOn: draft.content.dueDate,
          currency: draft.content.currency,
          amountMinor: review.recognition.payableMinor,
          controlAccountId: review.input.controlAccountId,
          recognitionVoucherId: postingReceipt.voucherId,
          recognitionLineId: line.lineId,
          evidenceId: review.evidence.evidenceId,
          description: `Cross-border service: ${draft.content.title}`,
        },
      });

      const owned = yield* recordServiceRecognitionInTransaction(transaction, {
        scope,
        bookId: scope.bookId,
        actorId: principal.actorId,
        receipt: Shared.receipt(idempotencyKey, operation, principal.actorId),
        recognitionId: yield* serviceRecognitionId(identity.key),
        economicKey: identity.key,
        reviewId: review.id,
        draftId: draft.id,
        draftRevision: draft.revision,
        draftDigest: draft.digest,
        counterpartyId: draft.content.counterpartyId,
        documentNumber: draft.content.supplierDocumentNumber ?? "",
        approvalId: approval.id,
        changeSetId: review.postingPlan.id,
        voucherId: postingReceipt.voucherId,
        payableId: invoice.id,
        currency: book.currency,
        currencyScale: book.currencyScale,
        recognitionDate: draft.content.documentDate ?? "",
        taxPoint: {
          taxPointOn: review.recognition.lines[0]?.taxPointOn ?? "",
          basis: review.input.taxPoint.basis,
        },
        plan: review.recognition,
        selections: review.originalLines,
        releaseSelection: review.releaseSelection,
        inputVatAccountId: review.inputVatAccountId,
        outputVatAccountId: review.outputVatAccountId,
        witness: review.profileWitness ?? null,
        gaps: review.profileGaps ?? [],
      });

      const body = {
        id: newId("service_purchase"),
        scope,
        reviewId,
        reviewDigest: review.digest,
        approvalId: approval.id,
        profile: review.profile,
        draftId: draft.id,
        draftRevision: draft.revision,
        draftDigest: draft.digest,
        supplierDocumentNumber: draft.content.supplierDocumentNumber ?? "",
        accepted: true,
        recognized: true,
        paid: false,
        postingReceipt,
        registerInvoiceId: invoice.id,
        recognitionId: owned.id,
        taxFactIds: owned.taxFactIds,
        legalBlockers: review.legalBlockers,
        createdAt: yield* isoNow(transaction),
        receipt: Shared.receipt(idempotencyKey, operation, principal.actorId),
      };

      const result = yield* Shared.decode(Service.ServicePurchaseReceipt, {
        ...body,
        digest: yield* digest(body),
      });

      yield* Db.insertServicePurchase(transaction, scope.bookId, result);
      yield* saveCommand(
        transaction,
        scope,
        idempotencyKey,
        request.expected,
        operation,
        principal.actorId,
        result,
      );

      return result;
    }),
  );
});

export const getServicePurchaseReview = Effect.fn("purchases.service-purchases.get")(function* (
  token: string,
  command: { readonly scope: Scope; readonly reviewId: string },
) {
  return yield* Shared.withBook(token, command.scope, false, "share", (transaction, principal) =>
    Effect.gen(function* () {
      yield* Shared.requireTables(transaction, serviceTables);
      yield* Shared.requireColumns(transaction, Shared.accountColumns);

      const book = (yield* Shared.PurchaseDb.lockBook(
        transaction,
        command.scope.bookId,
        "share",
      ))[0];

      if (!book) return yield* failure("Forbidden");
      const review = yield* readReview(transaction, command.scope.bookId, command.reviewId);

      const approval = (yield* Db.readApproval(
        transaction,
        command.scope.bookId,
        command.reviewId,
      ))[0];

      const acceptance = (yield* Db.readAcceptanceByReview(
        transaction,
        command.scope.bookId,
        command.reviewId,
      ))[0];

      const blockers = yield* serviceBlockers(transaction, command.scope, review);
      const now = (yield* AcceptanceDb.readDatabaseTime(transaction))[0]?.now ?? "";

      const usable =
        approval !== undefined &&
        approval.actorId === principal.actorId &&
        Date.parse(approval.expiresAt) > Date.parse(now) &&
        acceptance === undefined &&
        blockers.length === 0;

      return yield* Shared.decode(ViewSchema, {
        plan: yield* Shared.decode(ReviewSchema, review.body),
        approval: approval ? yield* Shared.decode(ApprovalSchema, approval.body) : null,
        acceptance: acceptance ? acceptance.body : null,
        blockers,
        dependenciesCurrent: blockers.length === 0,
        approvalUsable: usable,
      });
    }),
  );
});

export const servicePurchaseHistory = Effect.fn("purchases.service-purchases.history")(function* (
  token: string,
  command: { readonly scope: Scope; readonly draftId: string },
) {
  return yield* Shared.withBook(token, command.scope, false, "share", (transaction) =>
    Effect.gen(function* () {
      yield* Shared.requireTables(transaction, serviceTables);

      const book = (yield* Shared.PurchaseDb.lockBook(
        transaction,
        command.scope.bookId,
        "share",
      ))[0];

      if (!book) return yield* failure("Forbidden");

      if (
        (yield* AcceptanceDb.readDraftExists(transaction, command.scope.bookId, command.draftId))[0]
          ?.present !== true
      ) {
        return yield* failure("NotFound");
      }

      const rows = yield* Db.readHistory(transaction, command.scope.bookId, command.draftId);

      if (rows.length > maximumReviews) return yield* failure("InvalidJournal");

      return yield* Shared.decode(HistorySchema, {
        scope: command.scope,
        draftId: command.draftId,
        complete: true,
        count: rows.length,
        items: rows.map((row) => ({
          id: row.id,
          ordinal: row.ordinal,
          draftRevision: row.draftRevision,
          digest: row.digest,
          createdAt: row.createdAt,
          acceptanceId: row.acceptanceId,
          supplierDocumentNumber: row.supplierDocumentNumber,
        })),
      });
    }),
  );
});

export const getServicePurchaseRecognition = Effect.fn(
  "purchases.service-purchases.getRecognition",
)(function* (token: string, command: { readonly scope: Scope; readonly recognitionId: string }) {
  return yield* Shared.withBook(token, command.scope, false, "share", (transaction) =>
    Effect.gen(function* () {
      yield* Shared.requireTables(transaction, serviceTables);

      const book = (yield* Shared.PurchaseDb.lockBook(
        transaction,
        command.scope.bookId,
        "share",
      ))[0];

      if (!book) return yield* failure("Forbidden");

      const rows = yield* Db.readRecognition(
        transaction,
        command.scope.bookId,
        command.recognitionId,
      );

      const head = rows[0];

      if (!head) return yield* failure("NotFound");

      const facts = yield* Db.readTaxFacts(transaction, command.scope.bookId, head.id);

      return yield* Shared.decode(RecognitionViewSchema, {
        recognition: yield* Shared.decode(RecognitionSchema, head.body),
        taxFacts: yield* Effect.forEach(facts, (fact) => Shared.decode(TaxFactSchema, fact.body)),
        blockers: [],
        dependenciesCurrent: true,
      });
    }),
  );
});
