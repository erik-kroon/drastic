import * as Contracts from "@open-erp/contracts/asset-disposals";
import * as Domain from "@open-erp/domain/asset-disposals";
import { roundHalfUp } from "@open-erp/domain/money";
import * as Ar from "@open-erp/contracts/ar-legal-issue";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Db from "../../db/subledger/disposals";
import * as Assets from "../../db/subledger/assets";
import * as Ledger from "../../db/posting";
import * as Statement from "../../db/banking/statements";
import * as Allocations from "../../db/banking/allocations";
import * as Bank from "../../db/banking/shared";
import * as Revisions from "../../db/banking/foreign-cash";
import * as Invoices from "../../db/commerce/ar-legal";
import * as Vat from "../../db/vat/returns";
import type { Transaction } from "../../db/transaction";
import { decode, type Scope, textField } from "../commerce/support";
import { failure } from "../failures";
import { digest, readBook, readPeriod, validatePlan } from "../posting";
import { disposalBasis } from "./asset-basis";

export function assetInput(input: typeof Contracts.PrepareDisposal.Type) {
  return {
    ...input,
    profile: "synthetic_no_proceeds_asset_disposal_v1" as const,
    proceedsMinor: "0" as const,
    taxAssessment: "not_applicable" as const,
  };
}

export const captureProceeds = Effect.fn("subledger.captureDisposalProceeds")(function* (
  tx: Transaction,
  scope: Scope,
  input: typeof Contracts.PrepareDisposal.Type,
) {
  const selection = input.proceeds;
  const book = yield* readBook(tx, scope);

  if (book.currency !== "SEK" || book.currencyScale !== 2)
    return yield* failure("UnsupportedProfile");

  if (selection.kind === "unposted_cash_sale") {
    const statement = (yield* Statement.readStatement(tx, scope.bookId, selection.statementId))[0];

    const row = (yield* Statement.readObservation(
      tx,
      scope.bookId,
      selection.statementId,
      selection.rowOrdinal,
    ))[0];

    if (!statement || !row) return yield* failure("NotFound");

    if (
      statement.source.currency !== book.currency ||
      BigInt(row.amountMinor) <= 0n ||
      input.postingDate < row.observedOn ||
      input.postingDate < row.startsOn ||
      input.postingDate > row.endsOn
    )
      return yield* failure("UnsupportedProfile");

    if (
      BigInt(
        (yield* Allocations.readAllocatedSource(
          tx,
          scope.bookId,
          selection.statementId,
          selection.rowOrdinal,
        ))[0]?.allocated ?? "0",
      ) !== 0n
    )
      return yield* failure("AlreadyPosted");

    const heads = yield* Revisions.readNativeSourceRevisions(
      tx,
      scope.bookId,
      selection.statementId,
      selection.rowOrdinal,
    );

    if (
      heads.length > 1 ||
      heads.some((head) => head.changeKind === "removed" || head.amountMinor !== row.amountMinor)
    )
      return yield* failure("StaleDependency");

    const sourceRevision = textField(
      (yield* Bank.readVersions(tx, scope.bookId, row.accountId))[0]?.versions,
      "sourceRevision",
    );

    const tax = (yield* Ledger.readEvidence(tx, scope.bookId, selection.taxEvidenceId))[0];

    if (!tax) return yield* failure("MissingEvidence");

    if (!sourceRevision) return yield* failure("StaleDependency");
    const gross = BigInt(row.amountMinor);
    const net = roundHalfUp(gross * 4n, 5n);

    return yield* decode(Contracts.ProceedsWitness, {
      kind: selection.kind,
      statementId: selection.statementId,
      rowOrdinal: selection.rowOrdinal,
      accountId: row.accountId,
      observedOn: row.observedOn,
      startsOn: row.startsOn,
      endsOn: row.endsOn,
      grossMinor: gross.toString(),
      netMinor: net.toString(),
      vatMinor: (gross - net).toString(),
      outputVatAccountId: selection.outputVatAccountId,
      sourceRevision,
      sourceHeadsDigest: yield* digest(heads),
      evidence: { evidenceId: row.evidenceId, sha256: row.evidenceSha256 },
      taxEvidence: { evidenceId: tax.id, sha256: tax.sha256 },
      proceedsIdentity: `bank:${selection.statementId}:${selection.rowOrdinal}`,
    });
  }

  const row = (yield* Invoices.readArLegalIssueById(tx, scope.bookId, selection.issueId))[0];

  if (!row) return yield* failure("NotFound");
  const issue = yield* decode(Ar.ArLegalIssueReceipt, row.body);
  const line = issue.lines.find((line) => line.id === selection.lineId);

  if (!line) return yield* failure("NotFound");

  if (
    issue.issuedOn > input.postingDate ||
    (yield* Db.invoiceBlocked(
      tx,
      scope.bookId,
      issue.registerInvoiceId,
      issue.postingReceipt.voucherId,
    ))[0]?.blocked
  )
    return yield* failure("StaleDependency");
  const posted = (yield* Ledger.readVoucher(tx, scope.bookId, issue.postingReceipt.voucherId))[0];

  if (!posted || posted.postingPurpose !== "legal_ar_recognition")
    return yield* failure("UnsupportedProfile");

  return yield* decode(Contracts.ProceedsWitness, {
    kind: selection.kind,
    issue,
    lineId: line.id,
    netMinor: line.netMinor,
    vatMinor: line.taxMinor,
    grossMinor: line.grossMinor,
    revenueAccountId: issue.accountingProfileSnapshot.input.revenueAccountId,
    proceedsIdentity: `invoice:${issue.id}:${line.id}`,
  });
});

export const capture = Effect.fn("subledger.captureProceedsDisposal")(function* (
  tx: Transaction,
  scope: Scope,
  input: typeof Contracts.PrepareDisposal.Type,
) {
  const basis = yield* disposalBasis(tx, scope, assetInput(input));
  const proceeds = yield* captureProceeds(tx, scope, input);

  if ((yield* Db.usedProceeds(tx, scope.bookId, proceeds.proceedsIdentity)).length)
    return yield* failure("AlreadyPosted");
  const gross = basis.carryingBasis.lines.filter((line) => BigInt(line.debitMinor) > 0n);

  const grossLine = gross[0];

  if (gross.length !== 1 || !grossLine) return yield* failure("UnsupportedProfile");

  const accounts = [
    input.gainAccountId,
    input.lossAccountId,
    grossLine.accountId,
    basis.schedule.terms.creditAccountId,
    basis.impairmentAccountId,
    ...(proceeds.kind === "unposted_cash_sale"
      ? [proceeds.accountId, proceeds.outputVatAccountId]
      : [proceeds.revenueAccountId]),
  ].filter((id): id is string => typeof id === "string");

  if (new Set(accounts).size !== accounts.length) return yield* failure("InvalidJournal");
  const selected = yield* Ledger.readAccounts(tx, scope.bookId, accounts);

  const protectedRoles = new Set(
    (yield* Assets.readReservedAccounts(tx, scope.bookId)).map((row) => row.id),
  );

  const carryingRoles = new Set(
    (yield* Assets.readCarryingAccounts(tx, scope.bookId)).map((row) => row.id),
  );

  if (
    selected.length !== accounts.length ||
    selected.some((row) => !row.active) ||
    [input.gainAccountId, input.lossAccountId].some(
      (id) => protectedRoles.has(id) || carryingRoles.has(id),
    )
  )
    return yield* failure("InvalidJournal");

  const compiled = Domain.compileDisposal({
    basis: {
      assetId: input.scheduleId,
      bookId: scope.bookId,
      grossMinor: basis.originalCostMinor,
      ordinaryAccumulationMinor: basis.totalAccumulatedMinor,
      impairmentMinor: basis.impairmentMinor ?? "0",
      basisDigest: yield* digest(basis),
      basisVersion: basis.schedule.revision.toString(),
      basisCurrent: true,
    },
    proceeds:
      proceeds.kind === "unposted_cash_sale"
        ? {
            kind: proceeds.kind,
            netMinor: proceeds.netMinor,
            vatMinor: proceeds.vatMinor,
            cashAccountId: proceeds.accountId,
            outputVatAccountId: proceeds.outputVatAccountId,
            evidenceId: proceeds.evidence.evidenceId,
            proceedsIdentity: proceeds.proceedsIdentity,
          }
        : {
            kind: proceeds.kind,
            netMinor: proceeds.netMinor,
            taxMinor: proceeds.vatMinor,
            invoiceLineId: proceeds.lineId,
            clearingAccountId: null,
            originalRevenueAccountId: proceeds.revenueAccountId,
            reclassificationSupported: true,
            proceedsIdentity: proceeds.proceedsIdentity,
          },
    roles: {
      grossAssetAccountId: grossLine.accountId,
      ordinaryAccumulationAccountId: basis.schedule.terms.creditAccountId,
      impairmentContraAccountId: basis.impairmentAccountId ?? basis.schedule.terms.creditAccountId,
      disposalGainAccountId: input.gainAccountId,
      disposalLossAccountId: input.lossAccountId,
    },
    knownProceedsIdentities: [],
    disposalId: input.scheduleId,
  });

  if (Result.isFailure(compiled)) return yield* failure("InvalidJournal");

  return { assetBasis: basis, proceeds, domainPlan: compiled.success, original: null };
});

export const correction = Effect.fn("subledger.captureDisposalCorrection")(function* (
  tx: Transaction,
  scope: Scope,
  input: typeof Contracts.PrepareCorrection.Type,
) {
  const row = (yield* Db.effect(tx, scope.bookId, input.disposalId))[0];

  if (!row) return yield* failure("NotFound");
  const original = yield* decode(Contracts.DisposalEffect, row.body);
  const reviewRow = (yield* Db.readReview(tx, scope.bookId, original.reviewId))[0];

  if (!reviewRow) return yield* failure("InternalError");
  const review = yield* decode(Contracts.Review, reviewRow.body);

  if (
    original.kind !== "disposal" ||
    review.input.kind !== "disposal" ||
    original.digest !== input.expectedDigest ||
    input.postingDate < review.input.postingDate
  )
    return yield* failure("StaleDependency");
  const current = yield* disposalBasis(tx, scope, assetInput(review.input), original.asset.id);

  if (
    (yield* digest(current)) !== (yield* digest(review.assetBasis)) ||
    (yield* Db.correctionBlocked(
      tx,
      scope.bookId,
      original.id,
      original.postingReceipt.voucherId,
      original.vatFact?.factId ?? null,
      original.scheduleId,
      original.createdAt,
    ))[0]?.blocked
  )
    return yield* failure("StaleDependency");
  const period = yield* readPeriod(tx, scope, review.input.accountingPeriodId);

  if (period.locked) return yield* failure("PeriodLocked");

  if (
    original.proceeds.kind === "existing_legal_invoice" &&
    (yield* Db.invoiceBlocked(
      tx,
      scope.bookId,
      original.proceeds.issue.registerInvoiceId,
      original.proceeds.issue.postingReceipt.voucherId,
    ))[0]?.blocked
  )
    return yield* failure("StaleDependency");

  if (original.proceeds.kind === "unposted_cash_sale") {
    const source = original.proceeds;

    const observation = (yield* Statement.readObservation(
      tx,
      scope.bookId,
      source.statementId,
      source.rowOrdinal,
    ))[0];

    const heads = yield* Revisions.readNativeSourceRevisions(
      tx,
      scope.bookId,
      source.statementId,
      source.rowOrdinal,
    );

    if (
      !observation ||
      observation.amountMinor !== source.grossMinor ||
      observation.accountId !== source.accountId ||
      observation.observedOn !== source.observedOn ||
      observation.evidenceSha256 !== source.evidence.sha256 ||
      (yield* digest(heads)) !== source.sourceHeadsDigest
    )
      return yield* failure("StaleDependency");
  }

  if (original.vatFact) {
    const fact = (yield* Vat.readCurrentFactRevision(tx, scope.bookId, original.vatFact.factId))[0];

    if (
      !fact ||
      fact.body.digest !== original.vatFact.digest ||
      (yield* Vat.readFactWithdrawal(tx, scope.bookId, original.vatFact.factId)).length
    )
      return yield* failure("StaleDependency");
  }

  return {
    original,
    review,
    assetBasis: current,
    proceeds: original.proceeds,
    domainPlan: {
      ...original.domainPlan,
      profitMinor: (-BigInt(original.domainPlan.profitMinor)).toString(),
      stopFutureOccurrences: false,
      newCashReceivableOrVatFacts: false,
      saleTaxFacts: [],
      journal: original.domainPlan.journal.map((line) => ({
        ...line,
        debitMinor: line.creditMinor,
        creditMinor: line.debitMinor,
      })),
    },
  };
});

export const checked = Effect.fn("subledger.checkedProceedsReview")(function* (
  tx: Transaction,
  scope: Scope,
  id: string,
  expectedDigest: string,
) {
  const row = (yield* Db.readReview(tx, scope.bookId, id))[0];

  if (!row) return yield* failure("NotFound");
  const review = yield* decode(Contracts.Review, row.body);

  if (review.digest !== expectedDigest) return yield* failure("StaleDependency");
  const period = yield* readPeriod(tx, scope, review.input.accountingPeriodId);

  if (period.locked) return yield* failure("PeriodLocked");

  const current =
    review.input.kind === "disposal"
      ? yield* capture(tx, scope, review.input)
      : yield* correction(tx, scope, review.input);

  if (
    (yield* digest(current.assetBasis)) !== (yield* digest(review.assetBasis)) ||
    (yield* digest(current.proceeds)) !== (yield* digest(review.proceeds)) ||
    (yield* digest(current.domainPlan)) !== (yield* digest(review.domainPlan))
  )
    return yield* failure("StaleDependency");
  yield* validatePlan(tx, scope, review.postingPlan, false, false, true);

  return review;
});
