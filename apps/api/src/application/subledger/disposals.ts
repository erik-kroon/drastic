import * as Accounting from "@open-erp/contracts/accounting";
import * as Contracts from "@open-erp/contracts/asset-disposals";
import { reversedLines } from "@open-erp/domain/posting";
import * as Subledgers from "@open-erp/contracts/subledgers";
import * as Ar from "@open-erp/contracts/ar-legal-issue";
import * as Vat from "@open-erp/contracts/vat-returns";
import * as Effect from "effect/Effect";
import * as Db from "../../db/subledger/disposals";
import * as Ledger from "../../db/posting";
import * as Invoices from "../../db/commerce/ar-legal";
import * as Schedules from "../../db/subledger/schedules";
import * as VatDb from "../../db/vat/returns";
import type { Transaction } from "../../db/transaction";
import { decode, withBook, type Scope, type Principal } from "../commerce/support";
import { failure } from "../failures";
import { digest } from "../json";
import { isoNow, replay, saveCommand } from "../command-receipts";
import { newId } from "../identifiers";
import {
  readBook,
  readPeriod,
  createEvidenceInTransaction,
  sealActionInTransaction,
  approveChangeInTransaction,
  executeChangeInTransaction,
} from "../posting";
import { applyOwnedBankAllocationInTransaction } from "../banking/allocations";
import {
  prepareBankMatchReversalInTransaction,
  approveBankMatchReversalInTransaction,
  executeBankMatchReversalInTransaction,
} from "../banking/match-reversals";
import { capture, correction, checked } from "./disposal-basis";
import { authorize } from "../authority";

type PrepareCommand = {
  readonly scope: Scope;
  readonly idempotencyKey: string;
  readonly input: typeof Contracts.Prepare.Type;
};

export const list = Effect.fn("subledger.listProceedsDisposals")(function* (
  token: string,
  command: { readonly scope: Scope; readonly id: string; readonly after?: string },
) {
  return yield* withBook(token, command.scope, false, function* (tx) {
    const { scope, id, after } = command;

    if (!(yield* Schedules.readCurrentRevision(tx, scope.bookId, id))[0])
      return yield* failure("NotFound");

    if (after) {
      const anchor = (yield* Db.readReview(tx, scope.bookId, after))[0];

      if (!anchor) return yield* failure("NotFound");

      const review = yield* decode(Contracts.Review, anchor.body);

      if (review.assetBasis.schedule.scheduleId !== id) return yield* failure("NotFound");
    }

    const rows = yield* Db.reviewsForSchedule(tx, scope.bookId, id, after);

    return yield* decode(Contracts.ReviewPage, {
      scope,
      scheduleId: id,
      items: rows.slice(0, 20).map((row) => row.body),
      next: rows.length > 20 ? (rows[19]?.id ?? null) : null,
    });
  });
});

export const invoiceSource = Effect.fn("subledger.getDisposalInvoiceSource")(function* (
  token: string,
  command: { readonly scope: Scope; readonly id: string },
) {
  return yield* withBook(token, command.scope, false, function* (tx) {
    const { scope, id } = command;
    const row = (yield* Invoices.readArLegalIssueById(tx, scope.bookId, id))[0];

    if (!row) return yield* failure("NotFound");

    const issue = yield* decode(Ar.ArLegalIssueReceipt, row.body);

    const claims = yield* Effect.forEach(issue.lines, (line) =>
      Effect.gen(function* () {
        const used = yield* Db.usedProceeds(tx, scope.bookId, `invoice:${issue.id}:${line.id}`);

        if (used.length > 1) return yield* failure("InternalError");
        const effectRow = used[0];

        if (!effectRow) return null;
        const effect = yield* decode(Contracts.DisposalEffect, effectRow.body);
        const reviewRow = (yield* Db.readReview(tx, scope.bookId, effect.reviewId))[0];

        if (!reviewRow) return yield* failure("InternalError");
        const review = yield* decode(Contracts.Review, reviewRow.body);

        return {
          lineId: line.id,
          effectId: effect.id,
          reviewId: effect.reviewId,
          scheduleId: effect.scheduleId,
          assetName: review.assetBasis.schedule.terms.name,
          series: review.input.series,
          postingReceipt: effect.postingReceipt,
        };
      }),
    );

    return yield* decode(Contracts.InvoiceSource, {
      scope,
      issue,
      blocked:
        (yield* Db.invoiceBlocked(
          tx,
          scope.bookId,
          issue.registerInvoiceId,
          issue.postingReceipt.voucherId,
        ))[0]?.blocked === true,
      claims: claims.filter((claim) => claim !== null),
    });
  });
});

type ReviewCommand = {
  readonly scope: Scope;
  readonly id: string;
  readonly idempotencyKey: string;
  readonly input: typeof Contracts.Approve.Type;
};

type ExecuteCommand = Omit<ReviewCommand, "input"> & {
  readonly input: typeof Contracts.Execute.Type;
};

export const prepare = Effect.fn("subledger.prepareProceedsDisposal")(function* (
  token: string,
  command: PrepareCommand,
) {
  return yield* withBook(
    token,
    command.scope,
    false,
    function* (tx, principal) {
      const { scope, input, idempotencyKey } = command;
      const operation = "prepare_asset_proceeds_disposal";

      const request = yield* replay(
        tx,
        scope,
        idempotencyKey,
        operation,
        principal.actorId,
        input,
        Contracts.Review,
      );

      if (request.previous) return request.previous;
      const id = newId("asset_proceeds_review");

      const current =
        input.kind === "disposal"
          ? yield* capture(tx, scope, input)
          : yield* correction(tx, scope, input);

      const original = current.original;

      const bankReversal = original?.bankAllocation
        ? yield* prepareBankMatchReversalInTransaction(
            tx,
            principal,
            {
              scope,
              idempotencyKey: `${id}_unmatch`,
              input: {
                target: { kind: "allocation", allocationPlanId: original.bankAllocation.planId },
                reason: input.rationale,
              },
            },
            id,
            original.id,
          )
        : null;

      const evidence = yield* createEvidenceInTransaction(tx, principal, {
        scope,
        idempotencyKey: `${id}_evidence`,
        input: {
          title: "Synthetic asset proceeds disposal review",
          mediaType: "application/json",
          content: JSON.stringify({ input, current, bankReversal }),
          origin: "Retained asset basis and exact observed sale proceeds",
        },
      });

      const period = yield* readPeriod(tx, scope, input.accountingPeriodId);
      const book = yield* readBook(tx, scope);
      const eventKey = `asset_proceeds_${id}`;

      const originalVoucher = original
        ? (yield* Ledger.readVoucher(tx, scope.bookId, original.postingReceipt.voucherId))[0]
        : null;

      const originalAction = originalVoucher
        ? yield* decode(Accounting.VoucherPostingAction, originalVoucher.action)
        : null;

      const event =
        originalVoucher ??
        (yield* Ledger.insertEvent(tx, scope.bookId, newId("event"), evidence.id, eventKey))[0];

      if (!event) return yield* failure("InternalError");

      const lines = originalAction
        ? reversedLines(originalAction.lines, () => newId("line"))
        : current.domainPlan.journal.map((line) => ({
            accountId: line.accountId,
            debitMinor: line.debitMinor,
            creditMinor: line.creditMinor,
            description: line.description,
            lineId: newId("line"),
          }));

      const actionBody = {
        kind: "post_voucher",
        correctsVoucherId: original?.postingReceipt.voucherId ?? null,
        eventId: originalVoucher?.eventId ?? event.id,
        postingPurpose: original ? "reversal" : "asset_proceeds_disposal_v1",
        occurrenceKey: original?.postingReceipt.voucherId ?? eventKey,
        fiscalYearId: period.fiscalYearId,
        accountingPeriodId: input.accountingPeriodId,
        postingDate: input.postingDate,
        series: input.series,
        currency: book.currency,
        description: original
          ? "Correct synthetic asset disposal"
          : "Dispose synthetic asset with proceeds",
        rationale: input.rationale,
        taxAssessment:
          !original && current.proceeds.kind === "unposted_cash_sale"
            ? "synthetic_asset_proceeds_25_v1"
            : "not_applicable",
        lines,
        evidenceRefs: originalAction?.evidenceRefs ?? [
          { evidenceId: evidence.id, sha256: evidence.sha256, locator: eventKey },
        ],
      };

      const action = yield* decode(
        Accounting.VoucherPostingAction,
        original
          ? actionBody
          : {
              ...actionBody,
              assetProceeds: {
                reviewId: id,
                mode: current.proceeds.kind,
                netMinor: current.proceeds.netMinor,
                vatMinor: current.proceeds.vatMinor,
                correctionOf: null,
              },
            },
      );

      const postingPlan = yield* sealActionInTransaction(
        tx,
        principal,
        scope,
        action,
        false,
        false,
        true,
      );

      const body = {
        id,
        scope,
        input,
        assetBasis: current.assetBasis,
        proceeds: current.proceeds,
        domainPlan: current.domainPlan,
        correctionOf: original?.id ?? null,
        originalEffectDigest: original?.digest ?? null,
        bankReversal,
        evidence,
        postingPlan,
        createdAt: yield* isoNow(tx),
        receipt: { key: idempotencyKey, operation, actorId: principal.actorId },
        legalPolicyApproved: false,
      };

      const review = yield* decode(Contracts.Review, { ...body, digest: yield* digest(body) });
      yield* Db.insertReview(tx, scope.bookId, review);
      yield* saveCommand(
        tx,
        scope,
        idempotencyKey,
        request.expected,
        operation,
        principal.actorId,
        review,
      );

      return review;
    },
    "update",
  );
});

export const approve = Effect.fn("subledger.approveProceedsDisposal")(function* (
  token: string,
  command: ReviewCommand,
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (tx, principal) {
      yield* authorize(principal, "approve_proceeds_disposal");
      const { scope, input, idempotencyKey, id } = command;
      const operation = "approve_asset_proceeds_disposal";

      const request = yield* replay(
        tx,
        scope,
        idempotencyKey,
        operation,
        principal.actorId,
        { id, input },
        Contracts.Approval,
      );

      if (request.previous) return request.previous;
      const review = yield* checked(tx, scope, id, input.digest);

      if ((yield* Db.approvals(tx, scope.bookId, id)).length >= 20)
        return yield* failure("UnsupportedProfile");

      const bankReversalApproval = review.bankReversal
        ? yield* approveBankMatchReversalInTransaction(
            tx,
            principal,
            {
              scope,
              planId: review.bankReversal.id,
              idempotencyKey: `${idempotencyKey}_unmatch`,
              input: { version: 1, digest: review.bankReversal.digest },
            },
            id,
          )
        : null;

      const postingApproval = yield* approveChangeInTransaction(tx, principal, {
        scope,
        changeSetId: review.postingPlan.id,
        idempotencyKey: `${idempotencyKey}_journal`,
        owner: { kind: "asset_proceeds_disposal", id },
        input: { version: 1, planDigest: review.postingPlan.planDigest },
      });

      const now = yield* isoNow(tx);

      const body = {
        id: newId("asset_proceeds_approval"),
        scope,
        reviewId: id,
        reviewDigest: review.digest,
        actorId: principal.actorId,
        expiresAt:
          bankReversalApproval?.expiresAt ?? new Date(Date.parse(now) + 3600000).toISOString(),
        bankReversalApproval,
        postingApproval,
        createdAt: now,
        legalPolicyApproved: false,
        receipt: { key: idempotencyKey, operation, actorId: principal.actorId },
      };

      const approval = yield* decode(Contracts.Approval, { ...body, digest: yield* digest(body) });
      yield* Db.insertApproval(tx, scope.bookId, approval);
      yield* saveCommand(
        tx,
        scope,
        idempotencyKey,
        request.expected,
        operation,
        principal.actorId,
        approval,
      );

      return approval;
    },
    "update",
  );
});

const writeSaleFact = Effect.fn("subledger.writeAssetSaleVatFact")(function* (
  tx: Transaction,
  principal: Principal,
  scope: Scope,
  review: typeof Contracts.Review.Type,
  voucherId: string,
) {
  const source = review.proceeds;

  if (source.kind !== "unposted_cash_sale" || review.input.kind !== "disposal")
    return yield* failure("InternalError");

  const line = review.postingPlan.groups[0]?.actions[0]?.lines.find(
    (line) => line.accountId === source.outputVatAccountId,
  );

  if (!line && BigInt(source.vatMinor) !== 0n) return yield* failure("InternalError");
  const factId = newId("asset_sale_fact");

  const input = yield* decode(Vat.VatFactInput, {
    sourceKey: `asset_proceeds_${review.id}`,
    expectedDigest: null,
    recordClass: "synthetic",
    evidenceId: source.evidence.evidenceId,
    sourceLocator: source.proceedsIdentity,
    description: "Owned synthetic asset cash sale",
    reviewEvidenceId: review.input.reviewEvidenceId,
    reviewRationale: review.input.rationale,
    treatment: "domestic_sale",
    netMinor: source.netMinor,
    vatMinor: source.vatMinor,
    grossMinor: source.grossMinor,
    currency: "SEK",
    issuedOn: source.observedOn,
    receivedOn: source.observedOn,
    suppliedOn: source.observedOn,
    taxPointOn: source.observedOn,
    dateBasis: "synthetic_asset_receipt_v1",
    periodEvidenceId: source.taxEvidence.evidenceId,
    registration: "registered",
    registrationEvidenceId: source.taxEvidence.evidenceId,
    method: "accrual",
    methodEvidenceId: source.taxEvidence.evidenceId,
    domesticEligibility: "confirmed",
    treatmentEvidenceId: source.taxEvidence.evidenceId,
    fullDeduction: "unknown",
    deductionEvidenceId: null,
    voucherId,
    taxLineIds: line ? [line.lineId] : [],
    expenseLink: null,
  });

  const body = {
    id: newId("asset_sale_revision"),
    factId,
    revision: 1,
    previousDigest: null,
    scope,
    input,
    recordedAt: yield* isoNow(tx),
    receipt: {
      key: `${review.id}_vat`,
      operation: "asset_proceeds_vat_fact",
      actorId: principal.actorId,
    },
    evidenceRefs: [source.evidence, source.taxEvidence],
    expenseSourceDigest: null,
    expenseReviewDigest: null,
  };

  const fact = yield* decode(Vat.VatFact, { ...body, digest: yield* digest(body) });
  yield* VatDb.insertFactComponent(tx, {
    bookId: scope.bookId,
    id: factId,
    sourceKey: input.sourceKey,
    recordClass: "synthetic",
  });
  yield* VatDb.insertFactRevision(tx, {
    bookId: scope.bookId,
    factId,
    revision: 1,
    id: fact.id,
    evidenceId: input.evidenceId,
    reviewEvidenceId: input.reviewEvidenceId,
    voucherId,
    body: fact,
  });

  return fact;
});

const withdrawFact = Effect.fn("subledger.withdrawAssetSaleFact")(function* (
  tx: Transaction,
  principal: Principal,
  scope: Scope,
  review: typeof Contracts.Review.Type,
  fact: typeof Vat.VatFact.Type,
) {
  const source = (yield* Ledger.readEvidence(tx, scope.bookId, review.input.reviewEvidenceId))[0];

  if (!source) return yield* failure("MissingEvidence");

  const input = {
    expectedDigest: fact.digest,
    evidenceId: source.id,
    rationale: review.input.rationale,
  };

  const body = {
    id: newId("asset_sale_withdrawal"),
    scope,
    factId: fact.factId,
    revisionId: fact.id,
    revision: fact.revision,
    revisionDigest: fact.digest,
    input,
    evidenceSha256: source.sha256,
    recordedAt: yield* isoNow(tx),
    permanent: true,
    receipt: {
      key: `${review.id}_vatwithdrawal`,
      operation: "asset_proceeds_vat_withdrawal",
      actorId: principal.actorId,
    },
  };

  const withdrawal = yield* decode(Vat.VatFactWithdrawal, { ...body, digest: yield* digest(body) });
  yield* VatDb.insertFactWithdrawal(tx, {
    bookId: scope.bookId,
    factId: fact.factId,
    revision: fact.revision,
    id: withdrawal.id,
    evidenceId: source.id,
    body: withdrawal,
  });

  return withdrawal;
});

export const execute = Effect.fn("subledger.executeProceedsDisposal")(function* (
  token: string,
  command: ExecuteCommand,
) {
  return yield* withBook(
    token,
    command.scope,
    false,
    function* (tx, principal) {
      const { scope, input, idempotencyKey, id } = command;
      const operation = "execute_asset_proceeds_disposal";

      const request = yield* replay(
        tx,
        scope,
        idempotencyKey,
        operation,
        principal.actorId,
        { id, input },
        Contracts.DisposalEffect,
      );

      if (request.previous) return request.previous;

      if ((yield* Db.effectForReview(tx, scope.bookId, id)).length)
        return yield* failure("AlreadyPosted");
      const review = yield* checked(tx, scope, id, input.digest);

      const saved = (yield* Db.approvals(tx, scope.bookId, id)).find(
        (row) => row.id === input.approvalId,
      );

      if (!saved) return yield* failure("ApprovalRequired");
      const approval = yield* decode(Contracts.Approval, saved.body);
      const now = yield* isoNow(tx);

      if (
        approval.reviewDigest !== review.digest ||
        Date.parse(approval.expiresAt) <= Date.parse(now)
      )
        return yield* failure("ApprovalRequired");

      const bankReversal =
        review.bankReversal && approval.bankReversalApproval
          ? yield* executeBankMatchReversalInTransaction(
              tx,
              principal,
              {
                scope,
                planId: review.bankReversal.id,
                idempotencyKey: `${id}_unmatch_execute`,
                input: {
                  version: 1,
                  digest: review.bankReversal.digest,
                  approvalId: approval.bankReversalApproval.id,
                },
              },
              id,
            )
          : null;

      const owner = { kind: "asset_proceeds_disposal" as const, id };

      const postingReceipt = yield* executeChangeInTransaction(tx, principal, {
        scope,
        changeSetId: review.postingPlan.id,
        idempotencyKey: `${approval.id}_journal_execution`,
        owner,
        input: {
          version: 1,
          planDigest: review.postingPlan.planDigest,
          approvalId: approval.postingApproval.id,
        },
      });

      const action = review.postingPlan.groups[0]?.actions[0];

      if (!action) return yield* failure("InternalError");
      const cash = review.proceeds.kind === "unposted_cash_sale" ? review.proceeds : null;

      const cashLine = cash
        ? action.lines.find(
            (line) => line.accountId === cash.accountId && line.debitMinor === cash.grossMinor,
          )
        : null;

      if (review.input.kind === "disposal" && cash && !cashLine)
        return yield* failure("InternalError");

      const bankAllocation =
        review.input.kind === "disposal" && cash && cashLine
          ? yield* applyOwnedBankAllocationInTransaction(tx, principal, {
              scope,
              ownerReviewId: id,
              ownerApprovalId: approval.id,
              sourceWitness: cash,
              leg: {
                statementId: cash.statementId,
                rowOrdinal: cash.rowOrdinal,
                voucherId: postingReceipt.voucherId,
                lineId: cashLine.lineId,
                amountMinor: cash.grossMinor,
              },
            })
          : null;

      const vatFact =
        review.input.kind === "disposal" && cash
          ? yield* writeSaleFact(tx, principal, scope, review, postingReceipt.voucherId)
          : null;

      const originalRow = review.correctionOf
        ? (yield* Db.effect(tx, scope.bookId, review.correctionOf))[0]
        : null;

      const original = originalRow
        ? yield* decode(Contracts.DisposalEffect, originalRow.body)
        : null;

      const vatWithdrawal = original?.vatFact
        ? yield* withdrawFact(tx, principal, scope, review, original.vatFact)
        : null;

      const effectId = newId("asset_proceeds_effect");

      const assetBody = {
        id: effectId,
        scope,
        scheduleId: review.assetBasis.schedule.scheduleId,
        reviewId: id,
        reviewDigest: review.digest,
        approvalId: approval.id,
        postingDate: review.input.postingDate,
        scheduleDigest: review.assetBasis.schedule.digest,
        basisDigest: review.assetBasis.carryingBasis.digest,
        originalCostMinor: review.assetBasis.originalCostMinor,
        openingAccumulatedMinor: review.assetBasis.openingAccumulatedMinor,
        recognizedMinor: review.assetBasis.recognizedMinor,
        impairmentMinorReleased: review.assetBasis.impairmentMinor ?? "0",
        totalAccumulatedMinor: review.assetBasis.totalAccumulatedMinor,
        carryingMinorReleased: review.assetBasis.carryingMinor,
        carryingMinor: "0",
        status: "synthetic_disposed",
        futureRecognitionBlocked: true,
        postingReceipt,
        coverage: "not_established",
        legalPolicyApproved: false,
        createdAt: now,
        receipt: { key: idempotencyKey, operation, actorId: principal.actorId },
      };

      const asset =
        review.input.kind === "disposal"
          ? yield* decode(Subledgers.AssetDisposal, {
              ...assetBody,
              digest: yield* digest(assetBody),
            })
          : null;

      const body = {
        id: effectId,
        scope,
        reviewId: id,
        approvalId: approval.id,
        kind: review.input.kind,
        correctionOf: review.correctionOf,
        scheduleId: review.assetBasis.schedule.scheduleId,
        carryingMinor: review.input.kind === "disposal" ? "0" : review.assetBasis.carryingMinor,
        futureRecognitionBlocked: review.input.kind === "disposal",
        proceeds: review.proceeds,
        domainPlan: review.domainPlan,
        asset,
        postingReceipt,
        bankAllocation,
        bankReversal,
        vatFact,
        vatWithdrawal,
        createdAt: now,
        receipt: { key: idempotencyKey, operation, actorId: principal.actorId },
        legalPolicyApproved: false,
      };

      const result = yield* decode(Contracts.DisposalEffect, {
        ...body,
        digest: yield* digest(body),
      });

      yield* Db.insertEffect(tx, scope.bookId, result, review.input.postingDate);

      yield* saveCommand(
        tx,
        scope,
        idempotencyKey,
        request.expected,
        operation,
        principal.actorId,
        result,
      );

      return result;
    },
    "update",
  );
});

export const get = Effect.fn("subledger.getProceedsDisposal")(function* (
  token: string,
  command: { readonly scope: Scope; readonly id: string },
) {
  return yield* withBook(token, command.scope, false, function* (tx) {
    const row = (yield* Db.readReview(tx, command.scope.bookId, command.id))[0];

    if (!row) return yield* failure("NotFound");

    return yield* decode(Contracts.View, {
      review: row.body,
      approvals: (yield* Db.approvals(tx, command.scope.bookId, command.id)).map((row) => row.body),
      effect: (yield* Db.effectForReview(tx, command.scope.bookId, command.id))[0]?.body ?? null,
    });
  });
});
