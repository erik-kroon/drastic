import * as Controls from "@open-erp/contracts/subledger-controls";
import * as Effect from "effect/Effect";
import * as Db from "../../db/subledger/assets";
import * as Schedules from "../../db/subledger/schedules";
import { decode, withBook, type Scope } from "../commerce/support";
import { failure } from "../failures";
import { readReview } from "./asset-reviews";

type Command = { readonly scope: Scope; readonly id: string };

export const getDisposalReview = Effect.fn("subledger.getDisposalReview")(function* (
  token: string,
  command: Command,
) {
  return yield* withBook(token, command.scope, false, function* (tx) {
    const review = yield* readReview(tx, command.scope, "disposal", command.id);
    const approvals = yield* Db.listApprovals(tx, command.scope.bookId, "disposal", command.id);

    const effects = yield* Db.listEffects(
      tx,
      command.scope.bookId,
      "disposal",
      review.input.scheduleId,
    );

    return yield* decode(Controls.AssetDisposalReviewView, {
      review,
      approvals: approvals.map((row) => row.body),
      disposal: effects.find((row) => row.body.reviewId === command.id)?.body ?? null,
      liveAuthorizationChecked: false,
    });
  });
});

export const getImpairmentReview = Effect.fn("subledger.getImpairmentReview")(function* (
  token: string,
  command: Command,
) {
  return yield* withBook(token, command.scope, false, function* (tx) {
    const review = yield* readReview(tx, command.scope, "impairment", command.id);
    const approvals = yield* Db.listApprovals(tx, command.scope.bookId, "impairment", command.id);

    const effects = yield* Db.listEffects(
      tx,
      command.scope.bookId,
      "impairment",
      review.input.scheduleId,
    );

    return yield* decode(Controls.AssetImpairmentReviewView, {
      review,
      approvals: approvals.map((row) => row.body),
      impairment: effects.find((row) => row.body.reviewId === command.id)?.body ?? null,
      liveAuthorizationChecked: false,
    });
  });
});

export const listDisposalReviews = Effect.fn("subledger.listDisposalReviews")(function* (
  token: string,
  command: Command,
) {
  return yield* withBook(token, command.scope, false, function* (tx) {
    if (!(yield* Schedules.readCurrentRevision(tx, command.scope.bookId, command.id))[0])
      return yield* failure("NotFound");
    const reviews = yield* Db.listReviews(tx, command.scope.bookId, "disposal", command.id);

    if (reviews.length > 20) return yield* failure("UnsupportedProfile");

    const items = yield* Effect.forEach(reviews, (row) =>
      decode(Controls.AssetDisposalReview, row.body),
    );

    const effects = yield* Db.listEffects(tx, command.scope.bookId, "disposal", command.id);

    return yield* decode(Controls.AssetDisposalReviewList, {
      scope: command.scope,
      scheduleId: command.id,
      items: items.map((review) => ({
        id: review.id,
        ordinal: review.ordinal,
        digest: review.digest,
        createdAt: review.createdAt,
        postingDate: review.input.postingDate,
      })),
      disposal: effects[0]?.body ?? null,
      coverage: "not_established",
    });
  });
});

export const listImpairmentReviews = Effect.fn("subledger.listImpairmentReviews")(function* (
  token: string,
  command: Command,
) {
  return yield* withBook(token, command.scope, false, function* (tx) {
    if (!(yield* Schedules.readCurrentRevision(tx, command.scope.bookId, command.id))[0])
      return yield* failure("NotFound");
    const reviews = yield* Db.listReviews(tx, command.scope.bookId, "impairment", command.id);

    if (reviews.length > 20) return yield* failure("UnsupportedProfile");

    const items = yield* Effect.forEach(reviews, (row) =>
      decode(Controls.AssetImpairmentReview, row.body),
    );

    const effects = yield* Db.listEffects(tx, command.scope.bookId, "impairment", command.id);

    return yield* decode(Controls.AssetImpairmentReviewList, {
      scope: command.scope,
      scheduleId: command.id,
      items: items.map((review) => ({
        id: review.id,
        ordinal: review.ordinal,
        decisionKey: review.input.decisionKey,
        digest: review.digest,
        createdAt: review.createdAt,
        postingDate: review.input.postingDate,
      })),
      impairments: effects.map((row) => row.body),
      coverage: "not_established",
    });
  });
});
