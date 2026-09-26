import * as Accounting from "@open-erp/contracts/accounting";
import * as Controls from "@open-erp/contracts/subledger-controls";
import * as Subledgers from "@open-erp/contracts/subledgers";
import * as Effect from "effect/Effect";
import * as Db from "../../db/subledger/assets";
import * as Ledger from "../../db/posting";
import * as Schedules from "../../db/subledger/schedules";
import type { Transaction } from "../../db/transaction";
import { decode, withBook, type Scope, type Principal } from "../commerce/support";
import { failure } from "../failures";
import {
  createEvidenceInTransaction,
  prepareJournalInTransaction,
  digest,
  isoNow,
  newId,
  replay,
  saveCommand,
  validatePlan,
} from "../posting";
import { impairmentBasis, disposalBasis } from "./asset-basis";

export type Identified = { readonly scope: Scope; readonly id: string };

export type ReviewCommand = Identified & {
  readonly idempotencyKey: string;
  readonly input: typeof Controls.ApproveAssetDisposal.Type;
};

export const readReview = Effect.fn("subledger.readAssetReview")(function* (
  tx: Transaction,
  scope: Scope,
  kind: Db.Kind,
  id: string,
) {
  const row = (yield* Db.readReview(tx, scope.bookId, kind, id))[0];

  if (!row) return yield* failure("NotFound");

  return kind === "impairment"
    ? yield* decode(Controls.AssetImpairmentReview, row.body)
    : yield* decode(Controls.AssetDisposalReview, row.body);
});

export const checkedReview = Effect.fn("subledger.checkAssetReview")(function* (
  tx: Transaction,
  scope: Scope,
  kind: Db.Kind,
  id: string,
  input: typeof Controls.ApproveAssetDisposal.Type,
) {
  const review = yield* readReview(tx, scope, kind, id);

  if (input.version !== 1 || !input.acknowledgeSyntheticOnly || review.digest !== input.digest)
    return yield* failure("StaleDependency");

  const basis =
    review.input.profile === "synthetic_asset_impairment_v1"
      ? yield* impairmentBasis(tx, scope, review.input)
      : yield* disposalBasis(tx, scope, review.input);

  if ((yield* digest(basis)) !== (yield* digest(review.basis)))
    return yield* failure("StaleDependency");
  yield* validatePlan(tx, scope, review.postingPlan);

  return review;
});

const preparePosting = Effect.fn("subledger.prepareAssetPosting")(function* (
  tx: Transaction,
  principal: Principal,
  scope: Scope,
  id: string,
  input: typeof Controls.PrepareAssetDisposal.Type | typeof Controls.PrepareAssetImpairment.Type,
  lines: typeof Accounting.PrepareJournal.Type.lines,
  snapshot: string,
) {
  const impairment = input.profile === "synthetic_asset_impairment_v1";

  const evidence = yield* createEvidenceInTransaction(tx, principal, {
    scope,
    idempotencyKey: `${id}_evidence`,
    input: {
      title: impairment ? "Synthetic asset impairment review" : "Synthetic asset disposal review",
      mediaType: "application/json",
      content: snapshot,
      origin: "Retained synthetic asset decision and carrying controls",
    },
  });

  const eventKey = `${impairment ? "asset_impairment" : "asset_disposal"}_${(yield* digest(impairment ? id : input.scheduleId)).slice(7)}`;

  const postingPlan = yield* prepareJournalInTransaction(tx, principal, {
    scope,
    idempotencyKey: `${id}_prepare`,
    input: {
      kind: "manual_journal",
      evidenceId: evidence.id,
      eventKey,
      accountingPeriodId: input.accountingPeriodId,
      postingDate: input.postingDate,
      series: input.series,
      description: impairment
        ? "Synthetic asset impairment"
        : "Synthetic no-proceeds asset disposal",
      rationale: input.rationale,
      taxAssessment: "not_applicable",
      lines,
    },
  });

  return { evidence, postingPlan };
});

export const prepareDisposal = Effect.fn("subledger.prepareDisposal")(function* (
  token: string,
  command: {
    scope: Scope;
    idempotencyKey: string;
    input: typeof Controls.PrepareAssetDisposal.Type;
  },
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (tx, principal) {
      const { scope, input, idempotencyKey } = command;
      const operation = "prepare_subledger_disposal";

      const request = yield* replay(
        tx,
        scope,
        idempotencyKey,
        operation,
        principal.actorId,
        input,
        Controls.AssetDisposalReview,
      );

      if (request.previous) return request.previous;
      const basis = yield* disposalBasis(tx, scope, input);

      const ordinal =
        (yield* Db.listReviews(tx, scope.bookId, "disposal", input.scheduleId)).length + 1;

      if (ordinal > 20) return yield* failure("UnsupportedProfile");
      const id = newId("asset_disposal_review");

      const lines: Array<(typeof Accounting.PrepareJournal.Type.lines)[number]> =
        basis.carryingBasis.lines
          .filter((line) => BigInt(line.debitMinor) > 0n)
          .map((line) => ({
            accountId: line.accountId,
            debitMinor: "0",
            creditMinor: line.debitMinor,
            description: "Release gross asset control",
          }));

      if (BigInt(basis.totalAccumulatedMinor) > 0n)
        lines.push({
          accountId: basis.schedule.terms.creditAccountId,
          debitMinor: basis.totalAccumulatedMinor,
          creditMinor: "0",
          description: "Release accumulated recognition",
        });

      if (BigInt(basis.impairmentMinor ?? "0") > 0n) {
        if (!basis.impairmentAccountId) return yield* failure("InternalError");
        lines.push({
          accountId: basis.impairmentAccountId,
          debitMinor: basis.impairmentMinor ?? "0",
          creditMinor: "0",
          description: "Release accumulated impairment",
        });
      }

      if (BigInt(basis.carryingMinor) > 0n)
        lines.push({
          accountId: input.lossAccountId,
          debitMinor: basis.carryingMinor,
          creditMinor: "0",
          description: "Recognize disposal loss",
        });

      const posting = yield* preparePosting(
        tx,
        principal,
        scope,
        id,
        input,
        lines,
        JSON.stringify({ reviewId: id, input, basisSnapshotDigest: yield* digest(basis) }),
      );

      const body = {
        id,
        scope,
        ordinal,
        version: 1,
        input,
        basis,
        ...posting,
        coverage: "not_established",
        legalPolicyApproved: false,
        requiresPostingApproval: true,
        createdAt: yield* isoNow(tx),
        receipt: { key: idempotencyKey, operation, actorId: principal.actorId },
      };

      const result = yield* decode(Controls.AssetDisposalReview, {
        ...body,
        digest: yield* digest(body),
      });

      if (new TextEncoder().encode(JSON.stringify(result)).length > 1048576)
        return yield* failure("UnsupportedProfile");
      yield* Db.insertDisposalReview(tx, scope.bookId, result);
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

export const prepareImpairment = Effect.fn("subledger.prepareImpairment")(function* (
  token: string,
  command: {
    scope: Scope;
    idempotencyKey: string;
    input: typeof Controls.PrepareAssetImpairment.Type;
  },
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (tx, principal) {
      const { scope, input, idempotencyKey } = command;
      const operation = "prepare_subledger_impairment";

      const request = yield* replay(
        tx,
        scope,
        idempotencyKey,
        operation,
        principal.actorId,
        input,
        Controls.AssetImpairmentReview,
      );

      if (request.previous) return request.previous;

      if ((yield* Db.readDecision(tx, scope.bookId, input.decisionKey)).length)
        return yield* failure("IdempotencyConflict");
      const basis = yield* impairmentBasis(tx, scope, input);
      const current = basis.schedule;

      const ordinal =
        (yield* Db.listReviews(tx, scope.bookId, "impairment", input.scheduleId)).length + 1;

      if (ordinal > 20 || current.revision >= 20) return yield* failure("UnsupportedProfile");

      const id = newId("asset_impairment_review"),
        now = yield* isoNow(tx);

      const prefix = basis.occurrences.filter(
        (row) => row.state === "posted" || row.state === "reversed",
      ).length;

      const occurrences = current.occurrences.slice(0, prefix);

      const periods = yield* Schedules.readPeriods(
        tx,
        scope.bookId,
        input.installments.map((p) => p.accountingPeriodId),
      );

      const years = yield* Ledger.readAllFiscalYears(tx, scope.bookId);

      let last =
        [now.slice(0, 10), input.postingDate, basis.carryingBasis.input.effectiveOn]
          .sort()
          .at(-1) ?? input.postingDate;

      for (const period of input.installments) {
        const retained = periods.find((row) => row.id === period.accountingPeriodId);
        const year = years.find((row) => row.id === retained?.fiscalYearId);
        const instant = Date.parse(`${period.postingDate}T00:00:00Z`);

        if (
          !Number.isFinite(instant) ||
          new Date(instant).toISOString().slice(0, 10) !== period.postingDate ||
          period.postingDate <= last ||
          !retained ||
          !year ||
          retained.startsOn < year.startsOn ||
          retained.endsOn > year.endsOn ||
          period.postingDate < retained.startsOn ||
          period.postingDate > retained.endsOn ||
          BigInt(period.amountMinor) <= 0n
        )
          return yield* failure("InvalidJournal");

        if (retained.locked) return yield* failure("PeriodLocked");
        last = period.postingDate;
        occurrences.push({
          ...period,
          ordinal: occurrences.length + 1,
          eventKey: newId("impairment_occurrence"),
        });
      }

      if (occurrences.length > 120) return yield* failure("InvalidJournal");

      const priorRevision = Object.fromEntries(
        Object.entries(current).filter(([name]) => name !== "digest" && name !== "amendment"),
      );

      const revisionBody = {
        ...priorRevision,
        revision: current.revision + 1,
        previousDigest: current.digest,
        allocatedMinor: (BigInt(basis.recognizedMinor) + BigInt(input.futureMinor)).toString(),
        terms: {
          ...current.terms,
          periods: occurrences.map(({ postingDate, accountingPeriodId }) => ({
            postingDate,
            accountingPeriodId,
          })),
          residualMinor: input.residualMinor,
          allocationPolicy: "explicit_remaining_minor_v1",
          usefulPeriods: occurrences.length,
        },
        occurrences,
        amendment: {
          kind: "impairment_v1",
          reviewId: id,
          input,
          recognizedMinor: basis.recognizedMinor,
          reversedMinor: basis.reversedMinor,
          priorImpairmentMinor: basis.priorImpairmentMinor,
          impairmentMinor: input.impairmentMinor,
          netImpairmentMinor: (
            BigInt(basis.priorImpairmentMinor) + BigInt(input.impairmentMinor)
          ).toString(),
          basisDigest: basis.carryingBasis.digest,
          basisScheduleDigest: basis.carryingBasis.scheduleDigest,
          sourceSha256: basis.sourceSha256,
          reviewSha256: basis.reviewSha256,
          reviewedOn: now.slice(0, 10),
        },
        createdAt: now,
        receipt: { key: idempotencyKey, operation, actorId: principal.actorId },
      };

      const proposedRevision = yield* decode(Subledgers.ScheduleRevision, {
        ...revisionBody,
        digest: yield* digest(revisionBody),
      });

      const posting = yield* preparePosting(
        tx,
        principal,
        scope,
        id,
        input,
        [
          {
            accountId: input.lossAccountId,
            debitMinor: input.impairmentMinor,
            creditMinor: "0",
            description: "Synthetic asset impairment loss",
          },
          {
            accountId: input.accumulatedImpairmentAccountId,
            debitMinor: "0",
            creditMinor: input.impairmentMinor,
            description: "Synthetic accumulated impairment",
          },
        ],
        JSON.stringify({
          reviewId: id,
          input,
          basisDigest: yield* digest(basis),
          proposedRevisionDigest: proposedRevision.digest,
        }),
      );

      const body = {
        id,
        scope,
        ordinal,
        version: 1,
        input,
        basis,
        proposedRevision,
        ...posting,
        coverage: "not_established",
        legalPolicyApproved: false,
        requiresPostingApproval: true,
        createdAt: now,
        receipt: { key: idempotencyKey, operation, actorId: principal.actorId },
      };

      const result = yield* decode(Controls.AssetImpairmentReview, {
        ...body,
        digest: yield* digest(body),
      });

      if (new TextEncoder().encode(JSON.stringify(result)).length > 1048576)
        return yield* failure("UnsupportedProfile");
      yield* Db.insertImpairmentReview(tx, scope.bookId, result);
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
