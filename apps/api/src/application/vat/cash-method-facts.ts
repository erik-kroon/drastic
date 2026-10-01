import * as CashMethod from "@open-erp/contracts/cash-method";
import * as Vat from "@open-erp/contracts/vat-returns";
import * as Profiles from "@open-erp/contracts/company-profiles";
import type * as Commerce from "@open-erp/contracts/commerce";
import * as Effect from "effect/Effect";
import * as ProfileDb from "../../db/company-profiles";
import * as Db from "../../db/vat/returns";
import * as CreditsDb from "../../db/commerce/cash-credits";
import type { Transaction } from "../../db/transaction";
import { failure } from "../failures";
import { isoNow, newId } from "../posting";
import { liveInvoice } from "../commerce/register";
import {
  decode,
  toJsonObject,
  commandReceipt,
  type Principal,
  type Scope,
} from "../commerce/support";
import { digestBody } from "./basis";

const factEvidence = Effect.fn("vat.cashMethod.factEvidence")(function* (
  tx: Transaction,
  scope: Scope,
  witness: typeof Profiles.ProfileWitness.Type,
  kind: "accounting_method" | "vat_registration",
) {
  const rows = yield* ProfileDb.readFactRevisions(
    tx,
    scope.entityId,
    witness.selectorDate,
    witness.selectorDate,
  );

  const row = rows.find((row) => row.factKind === kind && witness.factRevisionIds.includes(row.id));

  if (!row) return yield* failure("StaleDependency");

  const fact = yield* decode(Profiles.FactRevision, row.body);
  const reference = fact.evidence[0];

  if (!reference) return yield* failure("MissingEvidence");

  return reference;
});

// Only the financial owner calls this tx port with a rederived, approved slice.
// It appends the existing VAT component/revision model, not another tax ledger.
const writeCashFact = Effect.fn("vat.cashMethod.writeOwnedFact")(function* (
  tx: Transaction,
  principal: Principal,
  command: {
    scope: Scope;
    recognitionId: string;
    factId: string;
    invoiceId: string;
    reviewEvidence: typeof Commerce.EvidenceReference.Type;
    taxPointOn: string;
    trigger: "actual_payment" | "year_end_unpaid";
    line: (typeof CashMethod.CashAllocationSelection.Type)["invoices"][number]["lines"][number];
    voucherId: string;
    taxLineId: string;
    witness: typeof Profiles.ProfileWitness.Type;
    receiptId: string;
  },
) {
  const invoice = yield* liveInvoice(tx, command.scope.bookId, command.invoiceId);
  const registration = yield* factEvidence(tx, command.scope, command.witness, "vat_registration");
  const method = yield* factEvidence(tx, command.scope, command.witness, "accounting_method");

  const input = yield* decode(Vat.VatFactInput, {
    sourceKey: `cash_method_${command.recognitionId}`,
    expectedDigest: null,
    recordClass: "synthetic",
    evidenceId: invoice.evidence.evidenceId,
    sourceLocator: command.recognitionId,
    description: `Owned cash recognition ${command.line.before.sourceLineId}`,
    reviewEvidenceId: command.reviewEvidence.evidenceId,
    reviewRationale: "Approved owned cash-method recognition over retained original treatment",
    treatment: "domestic_purchase",
    netMinor: command.line.netMinor,
    vatMinor: command.line.deductibleMinor,
    grossMinor: command.line.newGrossMinor,
    currency: "SEK",
    issuedOn: invoice.issuedOn,
    receivedOn: invoice.issuedOn,
    suppliedOn: invoice.issuedOn,
    taxPointOn: command.taxPointOn,
    dateBasis: command.trigger === "actual_payment" ? "cash_payment" : "cash_year_end",
    periodEvidenceId: command.reviewEvidence.evidenceId,
    registration: "registered",
    registrationEvidenceId: registration.evidenceId,
    method: "cash",
    methodEvidenceId: method.evidenceId,
    domesticEligibility: "confirmed",
    treatmentEvidenceId: invoice.evidence.evidenceId,
    fullDeduction: "confirmed",
    deductionEvidenceId: invoice.evidence.evidenceId,
    voucherId: command.voucherId,
    taxLineIds: [command.taxLineId],
    expenseLink: null,
  });

  const body = yield* digestBody(
    yield* toJsonObject({
      id: newId("vatfactrev"),
      factId: command.factId,
      revision: 1,
      previousDigest: null,
      scope: command.scope,
      input,
      recordedAt: yield* isoNow(tx),
      receipt: commandReceipt(command.receiptId, "cash_method_vat_fact", principal.actorId),
      evidenceRefs: [invoice.evidence, command.reviewEvidence, registration, method],
      expenseSourceDigest: null,
      expenseReviewDigest: null,
      cashMethodRecognition: {
        trigger: command.trigger,
        recognitionId: command.recognitionId,
        policy: "tax_first_cumulative_v1",
        originalGrossMinor: (
          BigInt(command.line.before.netMinor) + BigInt(command.line.before.taxMinor)
        ).toString(),
        originalTaxMinor: command.line.before.taxMinor,
        recognizedBeforeMinor: command.line.before.recognizedGrossMinor,
        recognizedAfterMinor: command.line.after.recognizedGrossMinor,
      },
    }),
  );

  const fact = yield* decode(Vat.VatFact, body);
  yield* Db.insertFactComponent(tx, {
    bookId: command.scope.bookId,
    id: command.factId,
    sourceKey: input.sourceKey,
    recordClass: "synthetic",
    cashMethodRecognitionId: command.recognitionId,
  });
  yield* Db.insertFactRevision(tx, {
    bookId: command.scope.bookId,
    factId: command.factId,
    revision: 1,
    id: fact.id,
    evidenceId: input.evidenceId,
    reviewEvidenceId: input.reviewEvidenceId,
    voucherId: command.voucherId,
    body,
  });

  return fact;
});

type Common = {
  scope: Scope;
  recognitionId: string;
  factId: string;
  invoiceId: string;
  line: (typeof CashMethod.CashAllocationSelection.Type)["invoices"][number]["lines"][number];
  voucherId: string;
  taxLineId: string;
  witness: typeof Profiles.ProfileWitness.Type;
  receiptId: string;
};

export const recordCashMethodFactInTransaction = Effect.fn("vat.cashMethod.recordPaymentFact")(
  function* (
    tx: Transaction,
    principal: Principal,
    command: Common & { source: typeof CashMethod.CashPaymentSource.Type },
  ) {
    return yield* writeCashFact(tx, principal, {
      ...command,
      reviewEvidence: { evidenceId: command.source.evidenceId, sha256: command.source.sha256 },
      taxPointOn: command.source.postingDate,
      trigger: "actual_payment",
    });
  },
);

export const recordCashYearEndFactInTransaction = Effect.fn("vat.cashMethod.recordYearEndFact")(
  function* (
    tx: Transaction,
    principal: Principal,
    command: Common & { reviewEvidence: typeof Commerce.EvidenceReference.Type; cutoffOn: string },
  ) {
    return yield* writeCashFact(tx, principal, {
      ...command,
      taxPointOn: command.cutoffOn,
      trigger: "year_end_unpaid",
    });
  },
);

// An owned negative component leaves the original positive fact intact. The
// credit owner writes this and its exact coverage/journal correction atomically.
export const recordCashCreditFactInTransaction = Effect.fn("vat.cashMethod.recordCreditFact")(
  function* (
    tx: Transaction,
    principal: Principal,
    command: {
      scope: Scope;
      creditLineId: string;
      factId: string;
      invoiceId: string;
      line: typeof CashMethod.CashCreditLine.Type;
      voucherId: string;
      taxLineId: string;
      witness: typeof Profiles.ProfileWitness.Type;
      receiptId: string;
      creditEvidence: typeof Commerce.EvidenceReference.Type;
      creditDate: string;
    },
  ) {
    const line = command.line;

    if (!line.originalRecognitionId || !line.originalVatFactId || !line.originalVoucherId)
      return yield* failure("StaleDependency");

    const retained = (yield* Db.readCurrentFactRevision(
      tx,
      command.scope.bookId,
      line.originalVatFactId,
    ))[0];

    if (!retained) return yield* failure("StaleDependency");

    const original = yield* decode(Vat.VatFact, retained.body);

    if (
      original.cashMethodRecognition?.recognitionId !== line.originalRecognitionId ||
      original.input.voucherId !== line.originalVoucherId ||
      original.revision !== 1 ||
      (yield* Db.readFactWithdrawal(tx, command.scope.bookId, original.factId))[0]?.body
    )
      return yield* failure("StaleDependency");

    const invoice = yield* liveInvoice(tx, command.scope.bookId, command.invoiceId);

    const registration = yield* factEvidence(
      tx,
      command.scope,
      command.witness,
      "vat_registration",
    );

    const method = yield* factEvidence(tx, command.scope, command.witness, "accounting_method");

    const input = yield* decode(Vat.VatFactInput, {
      ...original.input,
      sourceKey: `cash_credit_${command.creditLineId}`,
      sourceLocator: command.creditLineId,
      expectedDigest: null,
      evidenceId: command.creditEvidence.evidenceId,
      description: `Owned unpaid cash credit ${line.before.sourceLineId}`,
      reviewEvidenceId: command.creditEvidence.evidenceId,
      reviewRationale:
        "Approved linked unpaid suffix credit; retain the original positive VAT fact",
      netMinor: (-BigInt(line.correctionNetMinor)).toString(),
      vatMinor: (-BigInt(line.correctionDeductibleMinor)).toString(),
      grossMinor: (-BigInt(line.recognizedCorrectionMinor)).toString(),
      taxPointOn: command.creditDate,
      dateBasis: "cash_credit",
      periodEvidenceId: command.creditEvidence.evidenceId,
      registrationEvidenceId: registration.evidenceId,
      methodEvidenceId: method.evidenceId,
      voucherId: command.voucherId,
      taxLineIds: [command.taxLineId],
    });

    const body = yield* digestBody(
      yield* toJsonObject({
        id: newId("vatfactrev"),
        factId: command.factId,
        revision: 1,
        previousDigest: null,
        scope: command.scope,
        input,
        recordedAt: yield* isoNow(tx),
        receipt: commandReceipt(
          command.receiptId,
          "cash_method_credit_vat_fact",
          principal.actorId,
        ),
        evidenceRefs: [invoice.evidence, command.creditEvidence, registration, method],
        expenseSourceDigest: null,
        expenseReviewDigest: null,
        cashMethodCredit: {
          creditLineId: command.creditLineId,
          originalRecognitionId: line.originalRecognitionId,
          originalVatFactId: line.originalVatFactId,
          policy: "tax_first_cumulative_v1",
          originalGrossMinor: (
            BigInt(line.before.netMinor) + BigInt(line.before.taxMinor)
          ).toString(),
          originalTaxMinor: line.before.taxMinor,
          recognizedBeforeMinor: line.before.recognizedGrossMinor,
          recognizedAfterMinor: line.after.recognizedGrossMinor,
        },
      }),
    );

    const fact = yield* decode(Vat.VatFact, body);
    yield* CreditsDb.insertFactComponent(
      tx,
      command.scope.bookId,
      command.factId,
      command.creditLineId,
      input.sourceKey,
    );
    yield* Db.insertFactRevision(tx, {
      bookId: command.scope.bookId,
      factId: command.factId,
      revision: 1,
      id: fact.id,
      evidenceId: input.evidenceId,
      reviewEvidenceId: input.reviewEvidenceId,
      voucherId: command.voucherId,
      body,
    });

    return fact;
  },
);
