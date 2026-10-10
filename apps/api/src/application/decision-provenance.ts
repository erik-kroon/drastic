import * as Contract from "@open-erp/contracts/decision-provenance";
import * as Effect from "effect/Effect";
import type * as Schema from "effect/Schema";
import type { Transaction } from "../db/transaction";
import type { VerifiedPrincipal } from "../db/identity";
import * as Db from "../db/decision-provenance";
import { failure } from "./failures";
import { digest, newId } from "./posting";
import { decode, toJsonObject } from "./purchases/shared";

type Subject = typeof Contract.DecisionSubject.Type;

type Options = typeof Contract.SuggestionOptions.Type;

export type Comparison = {
  readonly coverage: "complete" | "partial";
  readonly comparison: "unchanged" | "changed" | "not_comparable";
  readonly dimensions: Schema.JsonObject;
};

function identity(subject: Subject) {
  switch (subject.kind) {
    case "supplier_draft":
      return `supplier:${subject.draftId}`;
    case "extraction_attempt":
      return `extraction:${subject.occurrenceId}:${subject.requestId}:${subject.attemptId}`;
    case "bank_row":
      return `bank:${subject.statementId}:${subject.rowOrdinal}`;
  }
}

function sessionId(principal: VerifiedPrincipal) {
  return "sessionId" in principal ? principal.sessionId : null;
}

export const recordSuggestion = Effect.fn("decisions.recordSuggestion")(function* (
  transaction: Transaction,
  bookId: string,
  principal: VerifiedPrincipal,
  subject: Subject,
  ranked: Options,
) {
  const record = {
    id: newId("suggestion"),
    subject,
    actorId: principal.actorId,
    sessionId: sessionId(principal),
    optionSetDigest: yield* digest(ranked),
    ranked,
  };

  yield* Db.insertSuggestion(transaction, {
    bookId,
    id: record.id,
    actorId: principal.actorId,
    sessionId: record.sessionId,
    identity: identity(subject),
    subjectDigest: yield* digest(subject),
    body: yield* toJsonObject(record),
  });

  return record.id;
});

export const citedSuggestions = Effect.fn("decisions.citedSuggestions")(function* (
  transaction: Transaction,
  bookId: string,
  principal: VerifiedPrincipal,
  subjects: readonly Subject[],
  ids: readonly string[],
) {
  if (ids.length > 32 || new Set(ids).size !== ids.length) return yield* failure("InvalidJournal");

  const subjectDigests = yield* Effect.forEach(subjects, (subject) => digest(subject));

  const records = [];

  for (const id of ids) {
    const row = (yield* Db.readCitedSuggestion(transaction, bookId, id))[0];

    if (
      !row ||
      row.actorId !== principal.actorId ||
      row.sessionId !== sessionId(principal) ||
      !subjectDigests.includes(row.subjectDigest)
    )
      return yield* failure("Forbidden");
    const record = yield* decode(Contract.SuggestionRecord, row.body);

    if (record.ranked.options.length > 0) records.push(record);
  }

  let uncited = false;

  for (const subject of subjects) {
    const observation = (yield* Db.readExposure(
      transaction,
      bookId,
      principal.actorId,
      identity(subject),
      ids,
    ))[0];

    if (!observation) return yield* failure("InternalError");
    uncited ||= observation.uncited;
  }

  return { records, uncited };
});

export const inheritedSuggestionIds = Effect.fn("decisions.inheritedSuggestionIds")(function* (
  transaction: Transaction,
  bookId: string,
  principal: VerifiedPrincipal,
  ids: readonly string[],
) {
  const retained: string[] = [];

  for (const id of ids) {
    const row = (yield* Db.readCitedSuggestion(transaction, bookId, id))[0];

    if (row?.actorId === principal.actorId && row.sessionId === sessionId(principal))
      retained.push(id);
  }

  return retained;
});

export const recordDecision = Effect.fn("decisions.recordDecision")(function* (
  transaction: Transaction,
  input: {
    readonly bookId: string;
    readonly actorId: string;
    readonly kind:
      | "supplier_approval"
      | "bank_match"
      | "bank_allocation"
      | "extraction_field"
      | "batch_member"
      | "historical_voucher";
    readonly id: string;
    readonly subject: Schema.JsonObject;
    readonly selected: Schema.JsonObject;
    readonly exposure?: {
      readonly records: readonly (typeof Contract.SuggestionRecord.Type)[];
      readonly uncited: boolean;
    };
    readonly comparisons?: readonly Comparison[];
    readonly forced?: "batch_approved" | "historical_import";
  },
) {
  const comparisons = input.comparisons ?? [];

  const exposure = input.exposure;

  const classification =
    input.forced ??
    (exposure === undefined || exposure.uncited
      ? "unknown_exposure"
      : exposure.records.length === 0
        ? "independent"
        : comparisons.length !== exposure.records.length ||
            comparisons.some(
              (item) => item.coverage !== "complete" || item.comparison === "not_comparable",
            )
          ? "unknown_exposure"
          : comparisons.every((item) => item.comparison === "unchanged")
            ? "accepted_unchanged"
            : "corrected");

  yield* Db.insertProvenance(transaction, {
    bookId: input.bookId,
    actorId: input.actorId,
    kind: input.kind,
    id: input.id,
    classification,
    body: yield* toJsonObject({
      captureVersion: "decision_provenance_v1",
      subject: input.subject,
      selected: input.selected,
      presentedSuggestionIds: exposure?.records.map((record) => record.id) ?? [],
      comparisons,
      uncitedExposure: exposure?.uncited ?? null,
    }),
  });
});
