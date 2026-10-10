import { digest as digestNative } from "../json";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Subledgers from "@open-erp/contracts/subledgers";

import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import * as SchedulesDb from "../../db/subledger/schedules";
import * as OccurrenceCorrections from "../../db/subledger/occurrence-corrections";
import { type Transaction } from "../../db/transaction";
import { failure } from "../failures";

export type Scope = typeof Accounting.Scope.Type;

export type JsonObject = Schema.JsonObject;

export type Revision = typeof Subledgers.ScheduleRevision.Type;

export type OccurrenceState = typeof Subledgers.OccurrenceState.Type;

export const throughAll = "9999-12-31";

const amendmentKinds = [
  "future_dates_v1",
  "remaining_estimate_v1",
  "remaining_lifetime_v1",
  "impairment_v1",
  "valuation_v1",
];

export function decode<A>(schema: Schema.Decoder<A>, value: JsonObject) {
  return Schema.decodeEffect(schema)(value).pipe(
    Effect.mapError((cause) => failure("InternalError", cause)),
  );
}

export function toJsonObject(value: unknown) {
  return Schema.decodeUnknownEffect(Schema.JsonObject)(value).pipe(
    Effect.mapError((cause) => failure("InternalError", cause)),
  );
}

function toJsonList(value: unknown) {
  return Schema.decodeUnknownEffect(Schema.Array(Schema.JsonObject))(value).pipe(
    Effect.mapError((cause) => failure("InternalError", cause)),
  );
}

export function textField(value: JsonObject | undefined, key: string) {
  const candidate = value?.[key];

  return typeof candidate === "string" ? candidate : undefined;
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function objectField(value: JsonObject | undefined, key: string): JsonObject {
  const candidate = value?.[key];

  return isJsonObject(candidate) ? candidate : {};
}

export function withoutKey(value: JsonObject, key: string): JsonObject {
  return Object.fromEntries(Object.entries(value).filter(([name]) => name !== key));
}

export function digestValue(value: Schema.Json) {
  return toJsonObject(value).pipe(Effect.flatMap((object) => digestNative(object)));
}

export function merge(...sources: ReadonlyArray<JsonObject>): JsonObject {
  return Object.assign({}, ...sources);
}

export function minor(value: string) {
  return BigInt(value);
}

export function readOccurrenceStates(
  transaction: Transaction,
  scope: Scope,
  revision: Revision,
  through: string,
) {
  return Effect.gen(function* () {
    const occurrences = yield* toJsonList(revision.occurrences);

    const rows = yield* SchedulesDb.readOccurrenceStates(
      transaction,
      scope.bookId,
      revision.scheduleId,
      revision.terms.evidenceId,
      occurrences,
      through,
    );

    const states: Array<OccurrenceState> = [];

    for (const row of rows) {
      const occurrence = revision.occurrences[row.ordinal - 1];

      if (occurrence === undefined) return yield* failure("InternalError");

      const correctionRows = yield* OccurrenceCorrections.readHistory(
        transaction,
        scope.bookId,
        revision.scheduleId,
        occurrence.ordinal,
        through,
      );

      if (correctionRows.length > 200) return yield* failure("UnsupportedProfile");

      const corrections = yield* Effect.forEach(correctionRows, (retained) =>
        decode(Subledgers.OccurrenceCorrectionSummary, retained.body),
      );

      const currentCorrection =
        correctionRows.at(-1)?.current === true ? corrections.at(-1) : undefined;

      let state =
        row.voucherId !== null && row.linked === false
          ? ("conflicted" as const)
          : row.reversalVoucherId !== null
            ? ("reversed" as const)
            : row.voucherId !== null
              ? ("posted" as const)
              : row.changeSetId !== null
                ? ("prepared" as const)
                : ("unprepared" as const);

      if (state !== "conflicted" && currentCorrection) state = "posted";

      states.push({
        ordinal: occurrence.ordinal,
        postingDate: occurrence.postingDate,
        accountingPeriodId: occurrence.accountingPeriodId,
        eventKey: occurrence.eventKey,
        amountMinor: occurrence.amountMinor,
        changeSetId: row.voucherChangeSetId ?? row.changeSetId,
        planDigest: row.planDigest,
        voucherId: row.voucherId,
        reversalVoucherId: row.reversalVoucherId,
        effectiveVoucherId: currentCorrection?.replacementVoucherId ?? row.voucherId,
        corrections,
        state,
      });
    }

    return states;
  });
}

export function basisMatchesRevision(basis: JsonObject, revision: Revision) {
  return Effect.gen(function* () {
    const basisDigest = textField(basis, "digest");
    const revisionDigest = revision.digest;

    if (basisDigest === undefined) return false;

    if ((yield* digestValue(withoutKey(basis, "digest"))) !== basisDigest) return false;

    if ((yield* digestValue(withoutKey(revision, "digest"))) !== revisionDigest) {
      return false;
    }

    const scheduleDigest = textField(basis, "scheduleDigest");

    if (scheduleDigest === revisionDigest) return true;
    const amendment = objectField(revision, "amendment");
    const kind = textField(amendment, "kind");

    return (
      kind !== undefined &&
      amendmentKinds.includes(kind) &&
      textField(amendment, "basisDigest") === basisDigest &&
      textField(amendment, "basisScheduleDigest") === scheduleDigest
    );
  });
}

export function estimateCurrent(transaction: Transaction, scope: Scope, revision: Revision) {
  return Effect.gen(function* () {
    if (revision.terms.allocationPolicy !== "explicit_remaining_minor_v1") return true;
    const states = yield* readOccurrenceStates(transaction, scope, revision, throughAll);

    if (states.length !== revision.occurrences.length) return false;

    for (const state of states) {
      if (!["unprepared", "prepared", "posted", "reversed"].includes(state.state)) return false;

      if (state.state === "reversed" && state.reversalVoucherId !== null) {
        const purpose = (yield* SchedulesDb.readVoucherPurpose(
          transaction,
          scope.bookId,
          state.reversalVoucherId,
        ))[0];

        if (purpose?.postingPurpose !== "reversal") return false;
      }

      if (state.voucherId !== null) {
        const correction = (yield* SchedulesDb.readCorrectionForVoucher(
          transaction,
          scope.bookId,
          state.voucherId,
        ))[0];

        if (correction !== undefined) return false;
      }
    }

    let effective = 0n;

    for (const state of states) {
      if (state.state !== "reversed") effective += minor(state.amountMinor);
    }

    const amendment = objectField(revision, "amendment");
    let impairment = 0n;

    if (["impairment_v1", "valuation_v1"].includes(textField(amendment, "kind") ?? "")) {
      const net = textField(amendment, "netImpairmentMinor");

      if (net === undefined) return false;
      impairment = minor(net);
    } else {
      for (const row of yield* SchedulesDb.listBookImpairments(transaction, scope.bookId)) {
        if (row.scheduleId === revision.scheduleId) impairment += minor(row.impairmentMinor);
      }
    }

    return (
      effective + impairment + minor(revision.terms.residualMinor) ===
        minor(revision.terms.costMinor) && effective === minor(revision.allocatedMinor)
    );
  });
}

export function readPostingBasis(transaction: Transaction, scope: Scope, revision: Revision) {
  return Effect.gen(function* () {
    const basis = (yield* SchedulesDb.readBasis(transaction, scope.bookId, revision.scheduleId))[0];

    if (basis === undefined) {
      return yield* decode(Subledgers.SchedulePostingBasis, {
        mode: "standalone_synthetic",
        supported: true,
        basisDigest: null,
        basisVoucherId: null,
        blocker: null,
        legalPolicyApproved: false,
      });
    }

    let blocker: string | null = null;

    if (
      (yield* SchedulesDb.readDisposal(transaction, scope.bookId, revision.scheduleId)).length > 0
    ) {
      blocker = "disposed";
    } else if (
      (yield* SchedulesDb.readReversalForVoucher(transaction, scope.bookId, basis.voucherId))
        .length > 0
    ) {
      blocker = "basis_reversed_or_corrected";
    } else if (!(yield* basisMatchesRevision(basis.body, revision))) {
      blocker = "basis_mismatch";
    } else if (!(yield* estimateCurrent(transaction, scope, revision))) {
      blocker = "estimate_history_changed";
    }

    const value: JsonObject = {
      mode: "linked_basis",
      supported: blocker === null,
      basisDigest: textField(basis.body, "digest") ?? null,
      basisVoucherId: basis.voucherId,
      blocker,
      legalPolicyApproved: false,
    };

    if (revision.amendment !== undefined) {
      return yield* decode(
        Subledgers.SchedulePostingBasis,
        merge(value, { scheduleDigest: revision.digest }),
      );
    }

    return yield* decode(Subledgers.SchedulePostingBasis, value);
  });
}
