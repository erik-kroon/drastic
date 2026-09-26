import * as Subledgers from "@open-erp/contracts/subledgers";
import { equalJson } from "@open-erp/domain/canonicalization";
import * as Effect from "effect/Effect";
import * as Db from "../db/posting-admission";
import * as Impact from "../db/posting-corrections";
import * as Schedules from "../db/subledger/schedules";
import type { Transaction } from "../db/transaction";
import { failure } from "./failures";
import { isoNow } from "./posting";
import { readPostingBasis } from "./subledger/schedules";
import { ownerRequireReady, validateOwnerLine } from "./subledger/owners";
import { decode, objectField, textField, type JsonObject, type Scope } from "./commerce/support";

// Only an owning application operation can supply this context. It is never part
// of a transport contract, stored plan, credential or queue payload.
export type PostingOwner = {
  readonly kind:
    | "invoice_issue"
    | "invoice_cancellation"
    | "legal_issue"
    | "supplier_acceptance"
    | "supplier_credit"
    | "asset_disposal"
    | "asset_impairment"
    | "historical_import"
    | "commerce_fx"
    | "vat_reclassification";
  readonly id: string;
};

export const admitPosting = Effect.fn("posting.admitOwnedSources")(function* (
  tx: Transaction,
  scope: Scope,
  changeId: string,
  action: JsonObject,
  owner?: PostingOwner,
) {
  const eventId = textField(action, "eventId"),
    year = textField(action, "fiscalYearId"),
    date = textField(action, "postingDate");

  if (!eventId || !year || !date || !Array.isArray(action.evidenceRefs))
    return yield* failure("InvalidJournal");

  if (action.foreignCurrency !== undefined && owner?.kind !== "commerce_fx")
    return yield* failure("UnsupportedProfile");

  if (
    action.postingPurpose === "vat_control_reclassification_v1" &&
    owner?.kind !== "vat_reclassification"
  )
    return yield* failure("UnsupportedProfile");

  if (action.postingPurpose === "legal_ar_recognition" && owner?.kind !== "legal_issue")
    return yield* failure("UnsupportedProfile");

  if (
    action.postingPurpose === "adjustment" &&
    (yield* Db.readRecurringCapacity(tx, scope.bookId, eventId)).some(
      (r) => BigInt(r.amount) !== 0n,
    )
  )
    return yield* failure("StaleDependency");
  yield* admitSources(tx, scope, changeId, eventId, action, owner);
  yield* admitHistoricalPosting(tx, scope, year, changeId, date, owner);
  yield* admitCorrectionsAndSchedules(tx, scope, changeId, eventId, date, action, owner);

  for (const link of yield* Db.readOwnerAttachments(tx, scope.bookId, changeId, eventId)) {
    if (!link.reviewId || link.linkReviewId !== link.reviewId || !link.lineId)
      return yield* failure("StaleDependency");
    const ready = yield* ownerRequireReady(tx, scope, link.recordId, link.reviewId, false);

    if (link.revisionDigest !== ready.digest) return yield* failure("StaleDependency");
    yield* validateOwnerLine(tx, scope, ready, action, link.lineId);
  }
});

const admitSources = Effect.fn("posting.admitSources")(function* (tx: Transaction, scope: Scope, changeId: string, eventId: string, action: JsonObject, owner?: PostingOwner){
  const evidence = (Array.isArray(action.evidenceRefs) ? action.evidenceRefs : []).flatMap((ref) =>
    typeof ref === "object" &&
    ref !== null &&
    !Array.isArray(ref) &&
    typeof ref.evidenceId === "string"
      ? [ref.evidenceId]
      : [],
  );

  const ownership = yield* Db.readOwnedSources(tx, scope.bookId, changeId, eventId, evidence);

  if (ownership.length > 1000) return yield* failure("UnsupportedProfile");

  for (const source of ownership) {
    if (source.kind === "invoice_issue" && owner?.kind === "invoice_cancellation") continue;

    if (source.kind !== owner?.kind) return yield* failure("ApprovalRequired");
  }

  const retained = ownership.find((r) => r.kind === owner?.kind && r.id === owner?.id);

  if (ownership.length && owner?.kind !== "invoice_cancellation") {
    if (!retained) return yield* failure("StaleDependency");

    if (retained.kind !== "legal_issue") {
      const plan = objectField(retained.body, "postingPlan");

      if (retained.changeId !== changeId || !Array.isArray(plan.groups))
        return yield* failure("StaleDependency");
      const first = plan.groups[0];

      if (
        typeof first !== "object" ||
        first === null ||
        Array.isArray(first) ||
        !Array.isArray(first.actions) ||
        !equalJson(first.actions[0], action)
      )
        return yield* failure("StaleDependency");
    } else if (textField(objectField(action, "legalIssue"), "reviewId") !== retained.id)
      return yield* failure("StaleDependency");
  }

});

const admitHistoricalPosting = Effect.fn("posting.admitHistoricalPosting")(function* (tx: Transaction, scope: Scope, year: string, changeId: string, date: string, owner?: PostingOwner){
  const state = (yield* Db.readHistoricalPostingState(tx, scope.bookId, year, changeId))[0];

  if (!state) return yield* failure("InternalError");

  if (state.superseded) return yield* failure("StaleDependency");
  const basis = state.basis;

  if (basis?.mode === "opening_set") {
    if (basis.change_set_id === changeId) {
      if (basis.opening_voucher_id !== null || date !== basis.cutover_on)
        return yield* failure("AlreadyPosted");
    } else if (basis.opening_voucher_id === null || date < (textField(basis, "cutover_on") ?? ""))
      return yield* failure("ApprovalRequired");
  }

  const now = Date.parse(yield* isoNow(tx));

  for (const run of state.runs) {
    if (
      owner?.kind !== "historical_import" ||
      owner.id !== run.id ||
      !(Date.parse(textField(run, "leaseUntil") ?? "") > now)
    )
      return yield* failure("StaleDependency");
  }

  for (const proposal of state.proposals) {
    if (
      owner?.kind !== "historical_import" ||
      proposal.runId !== owner.id ||
      proposal.posted === true ||
      !state.runs.some((r) => r.id === owner.id)
    )
      return yield* failure("StaleDependency");
  }

});

const admitCorrectionsAndSchedules = Effect.fn("posting.admitCorrectionsAndSchedules")(function* (tx: Transaction, scope: Scope, changeId: string, eventId: string, date: string, action: JsonObject, owner?: PostingOwner){
  const original = textField(action, "correctsVoucherId");

  if (original) {
    const protectedRows = yield* Db.readProtectedCorrections(tx, scope.bookId, original);

    if (protectedRows.some((r) => !(owner?.kind === "commerce_fx" && r.kind === "fx_settlement")))
      return yield* failure("UnsupportedProfile");
    const impacts = yield* Impact.readImpactResources(tx, scope.bookId, original, date);

    if (
      impacts.length > 1000 ||
      impacts.some(
        ({ resource }) =>
          resource.blocks &&
          !(owner?.kind === "invoice_cancellation" && resource.kind === "invoice"),
      )
    )
      return yield* failure("UnsupportedProfile");
  } else {
    const preparation = (yield* Db.readSchedulePreparation(tx, scope.bookId, changeId))[0];

    if (preparation) {
      const row = (yield* Schedules.readCurrentRevision(
        tx,
        scope.bookId,
        preparation.scheduleId,
      ))[0];

      if (!row) return yield* failure("StaleDependency");
      const revision = yield* decode(Subledgers.ScheduleRevision, row.body);
      const current = yield* readPostingBasis(tx, scope, revision);

      if (
        !current.supported ||
        revision.revision !== preparation.revision ||
        !(
          equalJson(preparation.basis, current) ||
          (preparation.basis === null && current.mode === "standalone_synthetic")
        )
      )
        return yield* failure("StaleDependency");
    } else if ((yield* Db.readLinkedScheduleEvents(tx, scope.bookId, changeId, eventId)).length)
      return yield* failure("StaleDependency");
  }

});
