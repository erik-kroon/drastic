import * as Controls from "@open-erp/contracts/subledger-controls";
import * as Subledgers from "@open-erp/contracts/subledgers";
import * as Effect from "effect/Effect";
import * as Db from "../../db/subledger/valuations";
import * as Schedules from "../../db/subledger/schedules";
import { decode, withBook, type Scope } from "../commerce/support";
import { failure } from "../failures";
import {
  approveChangeInTransaction,
  executeChangeInTransaction,
  createEvidenceInTransaction,
  prepareJournalInTransaction,
  digest,
  isoNow,
  newId,
  replay,
  saveCommand,
  validatePlan,
} from "../posting";
import { valuationBasis, checkedValuation } from "./valuation-basis";

type PrepareCommand = {
  readonly scope: Scope;
  readonly idempotencyKey: string;
  readonly input: typeof Controls.PrepareAssetValuation.Type;
};

type ReviewCommand = {
  readonly scope: Scope;
  readonly id: string;
  readonly idempotencyKey: string;
  readonly input: typeof Controls.ApproveAssetValuation.Type;
};

type ExecuteCommand = Omit<ReviewCommand, "input"> & {
  readonly input: typeof Controls.ExecuteAssetValuation.Type;
};

export const prepare = Effect.fn("subledger.prepareValuation")(function* (
  token: string,
  command: PrepareCommand,
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (tx, principal) {
      const { scope, input, idempotencyKey } = command;
      const operation = "prepare_asset_valuation";

      const request = yield* replay(
        tx,
        scope,
        idempotencyKey,
        operation,
        principal.actorId,
        input,
        Controls.AssetValuationReview,
      );

      if (request.previous) return request.previous;

      if ((yield* Db.decision(tx, scope.bookId, input.decisionKey)).length)
        return yield* failure("IdempotencyConflict");
      const basis = yield* valuationBasis(tx, scope, input);
      const ordinal = (yield* Db.reviews(tx, scope.bookId, input.scheduleId)).length + 1;

      if (ordinal > 20 || basis.schedule.revision >= 20)
        return yield* failure("UnsupportedProfile");
      const id = newId("asset_valuation_review");
      const now = yield* isoNow(tx);

      const occurrences = basis.occurrences
        .filter((row) => row.state === "posted" || row.state === "reversed")
        .map((row) => ({
          ordinal: row.ordinal,
          postingDate: row.postingDate,
          accountingPeriodId: row.accountingPeriodId,
          eventKey: row.eventKey,
          amountMinor: row.amountMinor,
        }));

      for (const installment of input.installments) {
        occurrences.push({
          ...installment,
          ordinal: occurrences.length + 1,
          eventKey: newId("valuation_occurrence"),
        });
      }

      if (occurrences.length > 120) return yield* failure("UnsupportedProfile");

      const revisionBody = {
        ...Object.fromEntries(
          Object.entries(basis.schedule).filter(([key]) => key !== "digest" && key !== "amendment"),
        ),
        revision: basis.schedule.revision + 1,
        previousDigest: basis.schedule.digest,
        state: basis.state,
        allocatedMinor: occurrences
          .filter(
            (row) =>
              !basis.occurrences.some(
                (old) => old.eventKey === row.eventKey && old.state === "reversed",
              ),
          )
          .reduce((sum, row) => sum + BigInt(row.amountMinor), 0n)
          .toString(),
        terms: {
          ...basis.schedule.terms,
          usefulPeriods: occurrences.length,
          periods: occurrences.map(({ postingDate, accountingPeriodId }) => ({
            postingDate,
            accountingPeriodId,
          })),
          residualMinor: input.residualMinor,
          allocationPolicy: "explicit_remaining_minor_v1",
        },
        occurrences,
        amendment: {
          kind: "valuation_v1",
          reviewId: id,
          netImpairmentMinor: basis.resultingImpairmentMinor,
          basisDigest: basis.carryingBasis.digest,
          basisScheduleDigest: basis.carryingBasis.scheduleDigest,
        },
        createdAt: now,
        receipt: { key: idempotencyKey, operation, actorId: principal.actorId },
      };

      const proposedRevision = yield* decode(Subledgers.ScheduleRevision, {
        ...revisionBody,
        digest: yield* digest(revisionBody),
      });

      const evidence = yield* createEvidenceInTransaction(tx, principal, {
        scope,
        idempotencyKey: `${id}_evidence`,
        input: {
          title: "Synthetic asset valuation decision",
          mediaType: "application/json",
          content: JSON.stringify({ input, basis, proposedRevision }),
          origin: "Retained synthetic economic valuation and counterfactual witness",
        },
      });

      const increase = basis.direction === "increase";

      const postingPlan = yield* prepareJournalInTransaction(tx, principal, {
        scope,
        idempotencyKey: `${id}_plan`,
        input: {
          kind: "manual_journal",
          evidenceId: evidence.id,
          eventKey: `asset_valuation_${(yield* digest(input.decisionKey)).slice(7)}`,
          accountingPeriodId: input.accountingPeriodId,
          postingDate: input.postingDate,
          series: input.series,
          description: "Synthetic asset valuation",
          rationale: input.rationale,
          taxAssessment: "not_applicable",
          lines: [
            {
              accountId: input.accumulatedImpairmentAccountId,
              debitMinor: increase ? "0" : basis.magnitudeMinor,
              creditMinor: increase ? basis.magnitudeMinor : "0",
              description: "Change accumulated impairment",
            },
            {
              accountId: input.incomeOrLossAccountId,
              debitMinor: increase ? basis.magnitudeMinor : "0",
              creditMinor: increase ? "0" : basis.magnitudeMinor,
              description: "Recognize valuation income or loss",
            },
          ],
        },
      });

      const body = {
        id,
        scope,
        ordinal,
        input,
        basis,
        proposedRevision,
        evidence,
        postingPlan,
        createdAt: now,
        legalPolicyApproved: false,
        receipt: { key: idempotencyKey, operation, actorId: principal.actorId },
      };

      const result = yield* decode(Controls.AssetValuationReview, {
        ...body,
        digest: yield* digest(body),
      });

      yield* Db.insertReview(tx, scope.bookId, result);
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

export const approve = Effect.fn("subledger.approveValuation")(function* (
  token: string,
  command: ReviewCommand,
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (tx, principal) {
      const { scope, input, idempotencyKey, id } = command;
      const operation = "approve_asset_valuation";

      const request = yield* replay(
        tx,
        scope,
        idempotencyKey,
        operation,
        principal.actorId,
        { id, input },
        Controls.AssetValuationApproval,
      );

      if (request.previous) return request.previous;
      const review = yield* checkedValuation(tx, scope, id, input.digest);
      yield* validatePlan(tx, scope, review.postingPlan);
      const ordinal = (yield* Db.approvals(tx, scope.bookId, id)).length + 1;

      if (ordinal > 20) return yield* failure("UnsupportedProfile");
      const now = yield* isoNow(tx);

      const body = {
        id: newId("asset_valuation_approval"),
        scope,
        reviewId: id,
        reviewDigest: review.digest,
        actorId: principal.actorId,
        expiresAt: new Date(Date.parse(now) + 3600000).toISOString(),
        createdAt: now,
        legalPolicyApproved: false,
        receipt: { key: idempotencyKey, operation, actorId: principal.actorId },
      };

      const result = yield* decode(Controls.AssetValuationApproval, {
        ...body,
        digest: yield* digest(body),
      });

      yield* Db.insertApproval(tx, scope.bookId, result, ordinal);
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

export const execute = Effect.fn("subledger.executeValuation")(function* (
  token: string,
  command: ExecuteCommand,
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (tx, principal) {
      const { scope, input, idempotencyKey, id } = command;
      const operation = "execute_asset_valuation";

      const request = yield* replay(
        tx,
        scope,
        idempotencyKey,
        operation,
        principal.actorId,
        { id, input },
        Subledgers.AssetValuationEvent,
      );

      if (request.previous) return request.previous;

      if (
        (yield* Db.events(
          tx,
          scope.bookId,
          (yield* decode(
            Controls.AssetValuationReview,
            (yield* Db.readReview(tx, scope.bookId, id))[0]?.body ?? {},
          )).input.scheduleId,
        )).some((row) => row.body.reviewId === id)
      )
        return yield* failure("AlreadyPosted");
      const review = yield* checkedValuation(tx, scope, id, input.digest);

      const saved = (yield* Db.approvals(tx, scope.bookId, id)).find(
        (row) => row.body.id === input.approvalId,
      );

      if (!saved) return yield* failure("ApprovalRequired");
      const approval = yield* decode(Controls.AssetValuationApproval, saved.body);
      const now = yield* isoNow(tx);

      if (
        approval.actorId !== principal.actorId ||
        approval.reviewDigest !== review.digest ||
        Date.parse(approval.expiresAt) <= Date.parse(now)
      )
        return yield* failure("ApprovalRequired");

      const approved = yield* approveChangeInTransaction(tx, principal, {
        scope,
        changeSetId: review.postingPlan.id,
        idempotencyKey: `${approval.id}_approve`,
        owner: { kind: "asset_valuation", id },
        input: { version: 1, planDigest: review.postingPlan.planDigest },
      });

      const postingReceipt = yield* executeChangeInTransaction(tx, principal, {
        scope,
        changeSetId: review.postingPlan.id,
        idempotencyKey: `${approval.id}_post`,
        owner: { kind: "asset_valuation", id },
        input: { version: 1, planDigest: review.postingPlan.planDigest, approvalId: approved.id },
      });

      yield* Schedules.insertRevision(tx, {
        bookId: scope.bookId,
        scheduleId: review.input.scheduleId,
        revision: review.proposedRevision.revision,
        evidenceId: review.proposedRevision.terms.evidenceId,
        body: review.proposedRevision,
      });

      const body = {
        id: newId("asset_valuation"),
        scope,
        scheduleId: review.input.scheduleId,
        reviewId: id,
        approvalId: approval.id,
        decisionKey: review.input.decisionKey,
        kind: review.input.kind,
        direction: review.basis.direction,
        correctionOf: review.input.correctionOf,
        magnitudeMinor: review.basis.magnitudeMinor,
        netImpairmentMinor: review.basis.resultingImpairmentMinor,
        carryingMinor: review.input.targetCarryingMinor,
        accumulatedImpairmentAccountId: review.input.accumulatedImpairmentAccountId,
        incomeOrLossAccountId: review.input.incomeOrLossAccountId,
        postingDate: review.input.postingDate,
        scheduleRevision: review.proposedRevision.revision,
        scheduleDigest: review.proposedRevision.digest,
        postingReceipt,
        state: review.basis.state,
        legalPolicyApproved: false,
        createdAt: now,
        receipt: { key: idempotencyKey, operation, actorId: principal.actorId },
      };

      const result = yield* decode(Subledgers.AssetValuationEvent, {
        ...body,
        digest: yield* digest(body),
      });

      const action = review.postingPlan.groups[0]?.actions[0];

      if (!action?.lines[0] || !action.lines[1]) return yield* failure("InternalError");
      yield* Db.insertEvent(
        tx,
        scope.bookId,
        result,
        action.eventId,
        action.lines[0].lineId,
        action.lines[1].lineId,
      );

      for (const occurrence of review.basis.occurrences.filter(
        (row) => row.state === "unprepared" || row.state === "prepared",
      ))
        yield* Db.retire(tx, scope.bookId, result.scheduleId, occurrence.eventKey, result.id);
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

export const get = Effect.fn("subledger.getValuation")(function* (
  token: string,
  command: { readonly scope: Scope; readonly id: string },
) {
  return yield* withBook(token, command.scope, true, function* (tx) {
    const row = (yield* Db.readReview(tx, command.scope.bookId, command.id))[0];

    if (!row) return yield* failure("NotFound");

    const review = yield* decode(Controls.AssetValuationReview, row.body);

    const approvals = yield* Effect.forEach(
      yield* Db.approvals(tx, command.scope.bookId, command.id),
      (row) => decode(Controls.AssetValuationApproval, row.body),
    );

    const eventRow = (yield* Db.events(tx, command.scope.bookId, review.input.scheduleId)).find(
      (row) => row.body.reviewId === command.id,
    );

    const event = eventRow ? yield* decode(Subledgers.AssetValuationEvent, eventRow.body) : null;

    const approval = event ? approvals.find((value) => value.id === event.approvalId) : undefined;

    if (event && !approval) return yield* failure("InternalError");

    const actorIds = [
      ...new Set([
        review.receipt.actorId,
        ...(approval ? [approval.actorId] : []),
        ...(event ? [event.receipt.actorId] : []),
      ]),
    ];

    const names = yield* Db.participants(tx, actorIds);

    return yield* decode(Controls.AssetValuationView, {
      review,
      approvals,
      event,
      participants: actorIds.map((actorId) => ({
        actorId,
        name: names.find((row) => row.actorId === actorId)?.name ?? null,
      })),
    });
  });
});

export const list = Effect.fn("subledger.listValuations")(function* (
  token: string,
  command: { readonly scope: Scope; readonly id: string },
) {
  return yield* withBook(token, command.scope, true, function* (tx) {
    if (!(yield* Schedules.readCurrentRevision(tx, command.scope.bookId, command.id))[0])
      return yield* failure("NotFound");

    const rows = yield* Db.reviews(tx, command.scope.bookId, command.id);

    if (rows.length > 20) return yield* failure("UnsupportedProfile");

    return yield* decode(Controls.AssetValuationReviewList, {
      scope: command.scope,
      scheduleId: command.id,
      items: rows.map((row) => row.body),
    });
  });
});
