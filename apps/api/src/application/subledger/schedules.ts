import * as Accounting from "@open-erp/contracts/accounting";
import * as Subledgers from "@open-erp/contracts/subledgers";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { digestJson } from "../../db/commerce/access";
import * as Db from "../../db/posting";
import * as SchedulesDb from "../../db/subledger/schedules";
import { databaseFailure, type Transaction } from "../../db/transaction";
import { failure } from "../failures";
import { withAdmittedPrincipal, type AuthorityLockMode, type VerifiedPrincipal } from "../identity";
import {
  isoNow,
  newId,
  prepareJournalInTransaction,
  replay,
  saveCommand,
  validatePlan,
} from "../posting";

type Scope = typeof Accounting.Scope.Type;
type Principal = VerifiedPrincipal;
type JsonObject = Schema.JsonObject;
type Revision = typeof Subledgers.ScheduleRevision.Type;
type Terms = typeof Subledgers.ScheduleTerms.Type;
type FutureDatesInput = typeof Subledgers.AmendScheduleFutureDates.Type;
type EstimateInput = typeof Subledgers.AmendScheduleEstimate.Type;
type OccurrenceState = typeof Subledgers.OccurrenceState.Type;

const RevisionSchema = Subledgers.ScheduleRevision;
const ViewSchema = Subledgers.ScheduleView;
const PageSchema = Subledgers.SchedulePage;
const PreparationSchema = Subledgers.SchedulePreparation;

const throughAll = "9999-12-31";
const schedulePageBound = 25;
const revisionBound = 20;
const basisLineBound = 20;
const occurrenceBound = 120;
const attemptBound = 100;
const amendmentKinds = [
  "future_dates_v1",
  "remaining_estimate_v1",
  "remaining_lifetime_v1",
  "impairment_v1",
];

function unsupported() {
  return failure("UnsupportedProfile");
}

function decode<A>(schema: Schema.Decoder<A>, value: JsonObject) {
  return Schema.decodeEffect(schema)(value).pipe(Effect.mapError(() => failure("InternalError")));
}

function toJsonObject(value: unknown) {
  return Schema.decodeUnknownEffect(Schema.JsonObject)(value).pipe(
    Effect.mapError(() => failure("InternalError")),
  );
}

function toJsonList(value: unknown) {
  return Schema.decodeUnknownEffect(Schema.Array(Schema.JsonObject))(value).pipe(
    Effect.mapError(() => failure("InternalError")),
  );
}

function textField(value: JsonObject | undefined, key: string) {
  const candidate = value?.[key];
  return typeof candidate === "string" ? candidate : undefined;
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function objectField(value: JsonObject | undefined, key: string): JsonObject {
  const candidate = value?.[key];
  return isJsonObject(candidate) ? candidate : {};
}

function withoutKey(value: JsonObject, key: string): JsonObject {
  return Object.fromEntries(Object.entries(value).filter(([name]) => name !== key));
}

function digestValue(transaction: Transaction, value: Schema.Json) {
  return toJsonObject(value).pipe(
    Effect.flatMap((object) => digestJson(transaction, object)),
    Effect.flatMap((rows) => {
      const digest = rows[0]?.digest;
      return digest === undefined ? failure("InternalError") : Effect.succeed(digest);
    }),
  );
}

function merge(...sources: ReadonlyArray<JsonObject>): JsonObject {
  return Object.assign({}, ...sources);
}

function digestBody(transaction: Transaction, body: JsonObject) {
  return digestValue(transaction, body).pipe(Effect.map((digest) => merge(body, { digest })));
}

function minor(value: string) {
  return BigInt(value);
}

function isCalendarDate(value: string) {
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
}

function withSubledgerBook<A>(
  token: string,
  scope: Scope,
  operatorOnly: boolean,
  operation: (transaction: Transaction, principal: Principal) => Effect.Effect<A, unknown, never>,
  lockMode: AuthorityLockMode = "share",
) {
  return withAdmittedPrincipal(
    { token },
    scope,
    { operatorOnly },
    (transaction, principal) =>
      operation(transaction, principal).pipe(Effect.mapError(databaseFailure)),
    lockMode,
  );
}

function readBook(transaction: Transaction, scope: Scope) {
  return Effect.gen(function* () {
    const book = (yield* Db.readBook(transaction, scope))[0];
    if (book === undefined) return yield* failure("Forbidden");
    if (book.profile !== "synthetic-core-v1" || book.authority !== "native") {
      return yield* unsupported();
    }
    return book;
  });
}

function requireScheduleAccess(transaction: Transaction, write: boolean) {
  return SchedulesDb.readScheduleAccess(transaction).pipe(
    Effect.flatMap((rows) => {
      if (rows.length !== SchedulesDb.scheduleTables.length) return unsupported();
      const denied = rows.some((row) => !row.canSelect || (write && !row.canInsert));
      return denied ? unsupported() : Effect.void;
    }),
  );
}

function readCurrentRevision(transaction: Transaction, scope: Scope, scheduleId: string) {
  return Effect.gen(function* () {
    const row = (yield* SchedulesDb.readCurrentRevision(transaction, scope.bookId, scheduleId))[0];
    if (row === undefined) return yield* failure("NotFound");
    return yield* decode(RevisionSchema, row.body);
  });
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
      const state =
        row.voucherId !== null && row.linked === false
          ? ("conflicted" as const)
          : row.reversalVoucherId !== null
            ? ("reversed" as const)
            : row.voucherId !== null
              ? ("posted" as const)
              : row.changeSetId !== null
                ? ("prepared" as const)
                : ("unprepared" as const);
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
        state,
      });
    }
    return states;
  });
}

function recognizedMinor(states: ReadonlyArray<OccurrenceState>) {
  let total = 0n;
  for (const state of states) {
    if (state.state === "posted") total += minor(state.amountMinor);
  }
  return total;
}

export function basisMatchesRevision(
  transaction: Transaction,
  basis: JsonObject,
  revision: Revision,
) {
  return Effect.gen(function* () {
    const basisDigest = textField(basis, "digest");
    const revisionDigest = revision.digest;
    if (basisDigest === undefined) return false;
    if ((yield* digestValue(transaction, withoutKey(basis, "digest"))) !== basisDigest)
      return false;
    if ((yield* digestValue(transaction, withoutKey(revision, "digest"))) !== revisionDigest) {
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

function estimateCurrent(transaction: Transaction, scope: Scope, revision: Revision) {
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
    if (textField(amendment, "kind") === "impairment_v1") {
      const net = textField(amendment, "netImpairmentMinor");
      if (net === undefined) return false;
      impairment = minor(net);
    } else {
      for (const row of yield* SchedulesDb.readImpairments(
        transaction,
        scope.bookId,
        revision.scheduleId,
      )) {
        impairment += minor(row.impairmentMinor);
      }
    }
    return (
      effective + impairment + minor(revision.terms.residualMinor) ===
        minor(revision.terms.costMinor) && effective === minor(revision.allocatedMinor)
    );
  });
}

function readPostingBasis(transaction: Transaction, scope: Scope, revision: Revision) {
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
    } else if (!(yield* basisMatchesRevision(transaction, basis.body, revision))) {
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

function readTaxMatches(transaction: Transaction, scope: Scope, scheduleId: string) {
  return Effect.gen(function* () {
    const count = (yield* SchedulesDb.readBasisLineCount(transaction, scope.bookId, scheduleId))[0];
    if ((count?.total ?? 0) > basisLineBound) return yield* unsupported();
    const rows = yield* SchedulesDb.readBasisTaxMatches(transaction, scope.bookId, scheduleId);
    return yield* decode(Subledgers.ScheduleBasisTaxMatches, {
      roleCompatibility: "not_assessed",
      matches: rows.map((row) => ({
        voucherId: row.voucherId,
        lineId: row.lineId,
        matchId: row.matchId,
        eventId: row.eventId,
        matchDigest: row.matchDigest,
      })),
    });
  });
}

function revisionAllowed(transaction: Transaction, scope: Scope, revision: Revision) {
  return Effect.gen(function* () {
    if (revision.revision >= revisionBound) return false;
    if ((yield* SchedulesDb.readBasis(transaction, scope.bookId, revision.scheduleId)).length > 0) {
      return false;
    }
    const preparations = yield* SchedulesDb.countPreparations(
      transaction,
      scope.bookId,
      revision.scheduleId,
    );
    if ((preparations[0]?.total ?? 0) > 0) return false;
    const events = yield* SchedulesDb.readEventIdsForKeys(
      transaction,
      scope.bookId,
      revision.terms.evidenceId,
      revision.occurrences.map((occurrence) => occurrence.eventKey),
    );
    return events.length === 0;
  });
}

function readScheduleTerms(
  transaction: Transaction,
  scope: Scope,
  scheduleId: string,
  sourceKey: string,
  revision: number,
  previousDigest: string | null,
  terms: Terms,
  idempotencyKey: string,
  operation: string,
  actorId: string,
) {
  return Effect.gen(function* () {
    const book = yield* readBook(transaction, scope);
    if (terms.debitAccountId === terms.creditAccountId) return yield* failure("InvalidJournal");
    const count = terms.usefulPeriods;
    if (count < 1 || count > occurrenceBound || terms.periods.length !== count) {
      return yield* failure("InvalidJournal");
    }
    const cost = minor(terms.costMinor);
    const residual = minor(terms.residualMinor);
    if (cost - residual < BigInt(count)) return yield* failure("InvalidJournal");
    const evidence = (yield* Db.readEvidence(transaction, scope.bookId, terms.evidenceId))[0];
    if (evidence === undefined) return yield* failure("MissingEvidence");
    const accounts = yield* Db.readAccounts(transaction, scope.bookId, [
      terms.debitAccountId,
      terms.creditAccountId,
    ]);
    if (accounts.length !== 2 || accounts.some((account) => !account.active)) {
      return yield* failure("InvalidJournal");
    }
    const periodRows = yield* SchedulesDb.readPeriods(
      transaction,
      scope.bookId,
      terms.periods.map((period) => period.accountingPeriodId),
    );
    const periodById = new Map(periodRows.map((period) => [period.id, period]));
    const fiscalYears = yield* Db.readAllFiscalYears(transaction, scope.bookId);
    const yearById = new Map(fiscalYears.map((year) => [year.id, year]));
    const base = (cost - residual) / BigInt(count);
    const occurrences: Array<JsonObject> = [];
    let lastDate = "";
    let total = 0n;
    for (const [index, period] of terms.periods.entries()) {
      if (!isCalendarDate(period.postingDate)) return yield* failure("InvalidJournal");
      if (lastDate !== "" && period.postingDate <= lastDate) {
        return yield* failure("InvalidJournal");
      }
      const retained = periodById.get(period.accountingPeriodId);
      if (retained === undefined) return yield* failure("InvalidJournal");
      if (retained.locked) return yield* failure("PeriodLocked");
      const fiscalYear = yearById.get(retained.fiscalYearId);
      if (
        fiscalYear === undefined ||
        retained.startsOn < fiscalYear.startsOn ||
        retained.endsOn > fiscalYear.endsOn ||
        period.postingDate < retained.startsOn ||
        period.postingDate > retained.endsOn
      ) {
        return yield* failure("InvalidJournal");
      }
      lastDate = period.postingDate;
      const ordinal = index + 1;
      const amount = ordinal === count ? cost - residual - base * BigInt(count - 1) : base;
      total += amount;
      occurrences.push({
        postingDate: period.postingDate,
        accountingPeriodId: period.accountingPeriodId,
        ordinal,
        eventKey: `${scheduleId}_${ordinal}`,
        amountMinor: amount.toString(),
      });
    }
    if (total + residual !== cost) return yield* failure("InvalidJournal");
    return yield* digestBody(transaction, {
      scheduleId,
      sourceKey,
      revision,
      scope,
      terms: yield* toJsonObject(terms),
      currency: book.currency,
      currencyScale: book.currencyScale,
      sourceSha256: evidence.sha256,
      previousDigest,
      occurrences,
      allocatedMinor: total.toString(),
      createdAt: yield* isoNow(transaction),
      receipt: { key: idempotencyKey, operation, actorId },
    });
  });
}

export const createSchedule = Effect.fn("subledger.createSchedule")(function* (
  token: string,
  command: { scope: Scope; idempotencyKey: string; input: typeof Subledgers.CreateSchedule.Type },
) {
  return yield* withSubledgerBook(
    token,
    command.scope,
    false,
    (transaction, principal) =>
      Effect.gen(function* () {
        const payload = yield* toJsonObject(command.input);
        const request = yield* replay(
          transaction,
          command.scope,
          command.idempotencyKey,
          "create_schedule",
          principal.actorId,
          payload,
          RevisionSchema,
        );
        if (request.previous) return request.previous;
        yield* requireScheduleAccess(transaction, true);
        yield* Db.lockBookForUpdate(transaction, command.scope);
        if (
          (yield* SchedulesDb.readScheduleBySourceKey(
            transaction,
            command.scope.bookId,
            command.input.sourceKey,
          )).length > 0
        ) {
          return yield* failure("IdempotencyConflict");
        }
        const scheduleId = newId("schedule");
        const body = yield* readScheduleTerms(
          transaction,
          command.scope,
          scheduleId,
          command.input.sourceKey,
          1,
          null,
          command.input.terms,
          command.idempotencyKey,
          "create_schedule",
          principal.actorId,
        );
        const revision = yield* decode(RevisionSchema, body);
        yield* SchedulesDb.insertSchedule(transaction, {
          bookId: command.scope.bookId,
          id: scheduleId,
          sourceKey: command.input.sourceKey,
        });
        yield* SchedulesDb.insertRevision(transaction, {
          bookId: command.scope.bookId,
          scheduleId,
          revision: 1,
          evidenceId: command.input.terms.evidenceId,
          body,
        });
        yield* saveCommand(
          transaction,
          command.scope,
          command.idempotencyKey,
          request.expected,
          "create_schedule",
          principal.actorId,
          revision,
        );
        return revision;
      }),
    "update",
  );
});

export const listSchedules = Effect.fn("subledger.listSchedules")(function* (
  token: string,
  command: { scope: Scope; after?: string },
) {
  return yield* withSubledgerBook(token, command.scope, false, (transaction) =>
    Effect.gen(function* () {
      yield* requireScheduleAccess(transaction, false);
      yield* Db.lockBookForShare(transaction, command.scope);
      yield* readBook(transaction, command.scope);
      const after = command.after ?? "";
      if (after !== "" && !/^[a-z][a-z0-9_-]{2,127}$/.test(after)) {
        return yield* failure("InvalidJournal");
      }
      const rows = yield* SchedulesDb.readSchedulePage(
        transaction,
        command.scope.bookId,
        after,
        schedulePageBound,
      );
      const items: Array<JsonObject> = [];
      for (const row of rows) {
        const revision = yield* decode(RevisionSchema, row.body);
        items.push(
          yield* toJsonObject({
            id: revision.scheduleId,
            sourceKey: revision.sourceKey,
            name: revision.terms.name,
            kind: revision.terms.kind,
            revision: revision.revision,
            digest: revision.digest,
          }),
        );
      }
      const last = rows.at(-1)?.id ?? "";
      const more =
        last === "" ||
        (yield* SchedulesDb.readScheduleIdsAfter(transaction, command.scope.bookId, last)).length >
          0;
      return yield* decode(PageSchema, { items, next: more && last !== "" ? last : null });
    }),
  );
});

export const getSchedule = Effect.fn("subledger.getSchedule")(function* (
  token: string,
  command: { scope: Scope; scheduleId: string },
) {
  return yield* withSubledgerBook(token, command.scope, false, (transaction) =>
    Effect.gen(function* () {
      yield* requireScheduleAccess(transaction, false);
      yield* Db.lockBookForShare(transaction, command.scope);
      const current = yield* readCurrentRevision(transaction, command.scope, command.scheduleId);
      const revisionRows = yield* SchedulesDb.readRevisions(
        transaction,
        command.scope.bookId,
        command.scheduleId,
      );
      const revisions = yield* Effect.forEach(revisionRows, (row) =>
        decode(RevisionSchema, row.body),
      );
      const states = yield* readOccurrenceStates(transaction, command.scope, current, throughAll);
      const recognized = recognizedMinor(states);
      const basis = (yield* SchedulesDb.readBasis(
        transaction,
        command.scope.bookId,
        command.scheduleId,
      ))[0];
      const disposal = (yield* SchedulesDb.readDisposal(
        transaction,
        command.scope.bookId,
        command.scheduleId,
      ))[0];
      const impairmentRows = yield* SchedulesDb.readImpairments(
        transaction,
        command.scope.bookId,
        command.scheduleId,
      );
      const impairments = yield* Effect.forEach(impairmentRows, (row) => toJsonObject(row.body));
      let netImpairment = 0n;
      for (const row of impairmentRows) netImpairment += minor(row.impairmentMinor);
      let basisReversed = false;
      if (basis !== undefined) {
        const voucherId = textField(objectField(basis.body, "input"), "voucherId");
        if (voucherId !== undefined) {
          basisReversed =
            (yield* SchedulesDb.readReversalForVoucher(
              transaction,
              command.scope.bookId,
              voucherId,
            )).length > 0;
        }
      }
      const carryingBasis = textField(objectField(basis?.body ?? {}, "input"), "carryingMinor");
      const carrying =
        basis === undefined || basisReversed || carryingBasis === undefined
          ? null
          : minor(carryingBasis) - recognized - netImpairment;
      return yield* decode(ViewSchema, {
        basisTaxMatches: yield* readTaxMatches(transaction, command.scope, command.scheduleId),
        disposal: disposal === undefined ? null : disposal.body,
        current,
        revisions,
        occurrences: states,
        recognizedMinor: recognized.toString(),
        remainingMinor:
          disposal === undefined ? (minor(current.terms.costMinor) - recognized).toString() : "0",
        carryingMinor:
          disposal !== undefined ? "0" : carrying === null ? null : carrying.toString(),
        netImpairmentMinor: netImpairment.toString(),
        impairments,
        revisionAllowed: yield* revisionAllowed(transaction, command.scope, current),
        postingBasis: yield* readPostingBasis(transaction, command.scope, current),
        controlAccountReconciled: false,
        requiresPostingApproval: true,
      });
    }),
  );
});

export const reviseSchedule = Effect.fn("subledger.reviseSchedule")(function* (
  token: string,
  command: {
    scope: Scope;
    scheduleId: string;
    idempotencyKey: string;
    input: typeof Subledgers.ReviseSchedule.Type;
  },
) {
  return yield* withSubledgerBook(
    token,
    command.scope,
    false,
    (transaction, principal) =>
      Effect.gen(function* () {
        const payload = yield* toJsonObject({ id: command.scheduleId, input: command.input });
        const request = yield* replay(
          transaction,
          command.scope,
          command.idempotencyKey,
          "revise_schedule",
          principal.actorId,
          payload,
          RevisionSchema,
        );
        if (request.previous) return request.previous;
        yield* requireScheduleAccess(transaction, true);
        yield* Db.lockBookForUpdate(transaction, command.scope);
        const current = yield* readCurrentRevision(transaction, command.scope, command.scheduleId);
        if (command.input.expectedDigest !== current.digest) {
          return yield* failure("StaleDependency");
        }
        const preparations = yield* SchedulesDb.countPreparations(
          transaction,
          command.scope.bookId,
          command.scheduleId,
        );
        const events = yield* SchedulesDb.readEventIdsForKeys(
          transaction,
          command.scope.bookId,
          current.terms.evidenceId,
          current.occurrences.map((occurrence) => occurrence.eventKey),
        );
        if ((preparations[0]?.total ?? 0) > 0 || events.length > 0) {
          return yield* unsupported();
        }
        const periods = yield* SchedulesDb.readPeriods(
          transaction,
          command.scope.bookId,
          current.occurrences.map((occurrence) => occurrence.accountingPeriodId),
        );
        if (periods.some((period) => period.locked)) return yield* failure("PeriodLocked");
        const revision = current.revision + 1;
        if (revision > revisionBound) return yield* unsupported();
        const body = yield* readScheduleTerms(
          transaction,
          command.scope,
          command.scheduleId,
          current.sourceKey,
          revision,
          current.digest,
          command.input.terms,
          command.idempotencyKey,
          "revise_schedule",
          principal.actorId,
        );
        const revised = yield* decode(RevisionSchema, body);
        yield* SchedulesDb.insertRevision(transaction, {
          bookId: command.scope.bookId,
          scheduleId: command.scheduleId,
          revision,
          evidenceId: command.input.terms.evidenceId,
          body,
        });
        yield* saveCommand(
          transaction,
          command.scope,
          command.idempotencyKey,
          request.expected,
          "revise_schedule",
          principal.actorId,
          revised,
        );
        return revised;
      }),
    "update",
  );
});

export const prepareScheduleOccurrence = Effect.fn("subledger.prepareScheduleOccurrence")(
  function* (
    token: string,
    command: {
      scope: Scope;
      scheduleId: string;
      idempotencyKey: string;
      input: typeof Subledgers.PrepareScheduleOccurrence.Type;
    },
  ) {
    return yield* withSubledgerBook(
      token,
      command.scope,
      false,
      (transaction, principal) =>
        Effect.gen(function* () {
          const payload = yield* toJsonObject({ id: command.scheduleId, input: command.input });
          const request = yield* replay(
            transaction,
            command.scope,
            command.idempotencyKey,
            "prepare_schedule_occurrence",
            principal.actorId,
            payload,
            PreparationSchema,
          );
          if (request.previous) return request.previous;
          yield* requireScheduleAccess(transaction, true);
          yield* Db.lockBookForUpdate(transaction, command.scope);
          const current = yield* readCurrentRevision(
            transaction,
            command.scope,
            command.scheduleId,
          );
          if (command.input.expectedDigest !== current.digest) {
            return yield* failure("StaleDependency");
          }
          const ordinal = command.input.ordinal;
          const occurrence = current.occurrences[ordinal - 1];
          if (occurrence === undefined) return yield* failure("NotFound");
          const posted = yield* SchedulesDb.readPostedOccurrenceVouchers(
            transaction,
            command.scope.bookId,
            current.terms.evidenceId,
            occurrence.eventKey,
          );
          if (posted.length > 0) return yield* failure("AlreadyPosted");
          void (yield* Db.readPeriod(
            transaction,
            command.scope.bookId,
            occurrence.accountingPeriodId,
          ));
          void (yield* Db.readAccounts(transaction, command.scope.bookId, [
            current.terms.debitAccountId,
            current.terms.creditAccountId,
          ]));
          const retained = (yield* SchedulesDb.readLatestPreparation(
            transaction,
            command.scope.bookId,
            command.scheduleId,
            ordinal,
          ))[0];
          let attempt = retained?.attempt ?? 0;
          let changeSetId = retained?.changeSetId;
          let planDigest = retained?.planDigest;
          let current_ = false;
          if (changeSetId !== undefined) {
            const plan = yield* decode(Accounting.ChangeSet, retained?.plan ?? {});
            const validated = yield* validateDependencies(transaction, command.scope, plan);
            if (validated) {
              planDigest = plan.planDigest;
              current_ = true;
            } else {
              changeSetId = undefined;
            }
          }
          if (!current_) {
            attempt += 1;
            if (attempt > attemptBound) return yield* unsupported();
            const derived = `sl_${(yield* digestValue(transaction, {
              actor: principal.actorId,
              key: command.idempotencyKey,
              id: command.scheduleId,
            })).slice(8)}`;
            const rationale =
              `Schedule ${command.scheduleId} revision ${current.revision} occurrence ${ordinal}: ${current.terms.rationale}`.slice(
                0,
                2000,
              );
            const plan = yield* prepareJournalInTransaction(transaction, principal, {
              scope: command.scope,
              idempotencyKey: derived,
              input: {
                kind: "manual_journal",
                evidenceId: current.terms.evidenceId,
                eventKey: occurrence.eventKey,
                accountingPeriodId: occurrence.accountingPeriodId,
                postingDate: occurrence.postingDate,
                series: current.terms.series,
                description: current.terms.name,
                rationale,
                taxAssessment: "not_applicable",
                lines: [
                  {
                    accountId: current.terms.debitAccountId,
                    debitMinor: occurrence.amountMinor,
                    creditMinor: "0",
                    description: current.terms.name,
                  },
                  {
                    accountId: current.terms.creditAccountId,
                    debitMinor: "0",
                    creditMinor: occurrence.amountMinor,
                    description: current.terms.name,
                  },
                ],
              },
            });
            changeSetId = plan.id;
            planDigest = plan.planDigest;
            yield* SchedulesDb.insertPreparation(transaction, {
              bookId: command.scope.bookId,
              scheduleId: command.scheduleId,
              revision: current.revision,
              ordinal,
              attempt,
              changeSetId: plan.id,
            });
          }
          if (changeSetId === undefined || planDigest === undefined) {
            return yield* failure("InternalError");
          }
          const result = yield* decode(PreparationSchema, {
            scheduleId: command.scheduleId,
            revisionDigest: current.digest,
            ordinal,
            changeSetId,
            planDigest,
            requiresPostingApproval: true,
            receipt: {
              key: command.idempotencyKey,
              operation: "prepare_schedule_occurrence",
              actorId: principal.actorId,
            },
          });
          yield* saveCommand(
            transaction,
            command.scope,
            command.idempotencyKey,
            request.expected,
            "prepare_schedule_occurrence",
            principal.actorId,
            result,
          );
          return result;
        }),
      "update",
    );
  },
);

function validateDependencies(
  transaction: Transaction,
  scope: Scope,
  plan: typeof Accounting.ChangeSet.Type,
) {
  return validatePlan(transaction, scope, plan).pipe(
    Effect.match({
      onFailure: () => false,
      onSuccess: () => true,
    }),
  );
}

type AmendmentCommand = {
  readonly scope: Scope;
  readonly scheduleId: string;
  readonly idempotencyKey: string;
};

const amendSchedule = Effect.fn("subledger.amendSchedule")(function* (
  token: string,
  command: AmendmentCommand,
  change: { readonly kind: "dates"; readonly input: FutureDatesInput } |
    { readonly kind: "estimate"; readonly input: EstimateInput },
) {
  return yield* withSubledgerBook(token, command.scope, true, (transaction, principal) =>
    Effect.gen(function* () {
      const { scope, scheduleId, idempotencyKey } = command;
      const { input } = change;
      const operation = change.kind === "dates" ? "amend_schedule_future_dates" : "amend_schedule_estimate";
      const request = yield* replay(transaction, scope, idempotencyKey, operation,
        principal.actorId, { id: scheduleId, input }, RevisionSchema);
      if (request.previous) return request.previous;
      yield* readBook(transaction, scope);
      const current = yield* readCurrentRevision(transaction, scope, scheduleId);
      const basis = (yield* SchedulesDb.readBasis(transaction, scope.bookId, scheduleId))[0];
      if (!basis) return yield* unsupported();
      if (current.digest !== input.expectedDigest || textField(basis.body, "digest") !== input.expectedBasisDigest ||
        !(yield* basisMatchesRevision(transaction, basis.body, current)) ||
        (yield* SchedulesDb.readReversalForVoucher(transaction, scope.bookId, basis.voucherId)).length) {
        return yield* failure("StaleDependency");
      }
      if ((yield* SchedulesDb.readDisposal(transaction, scope.bookId, scheduleId)).length)
        return yield* failure("AlreadyPosted");
      if (change.kind === "dates" && !(yield* readPostingBasis(transaction, scope, current)).supported)
        return yield* failure("StaleDependency");
      const evidence = (yield* Db.readEvidence(transaction, scope.bookId, input.reviewEvidenceId))[0];
      if (!evidence) return yield* failure("MissingEvidence");
      const now = yield* isoNow(transaction);
      const today = now.slice(0, 10);
      const first = input.firstOrdinal;
      const replacement = change.kind === "dates" ? change.input.periods : change.input.installments;
      const count = current.occurrences.length;
      const newCount = first - 1 + replacement.length;
      if (current.revision >= revisionBound) return yield* unsupported();
      if (first < 1 || first > count || replacement.length < 1 || newCount > occurrenceBound ||
        (change.kind === "dates" && newCount !== count)) return yield* failure("InvalidJournal");
      const oldSuffix = current.occurrences.slice(first - 1);
      const periods = yield* SchedulesDb.readPeriods(transaction, scope.bookId,
        [...oldSuffix, ...replacement].map((period) => period.accountingPeriodId));
      const periodById = new Map(periods.map((period) => [period.id, period]));
      const years = yield* Db.readAllFiscalYears(transaction, scope.bookId);
      const yearById = new Map(years.map((year) => [year.id, year]));
      const accounts = yield* Db.readAccounts(transaction, scope.bookId,
        [current.terms.debitAccountId, current.terms.creditAccountId]);
      if (accounts.length !== 2 || accounts.some((account) => !account.active))
        return yield* failure("InvalidJournal");
      const states = yield* readOccurrenceStates(transaction, scope, current, throughAll);
      if (states.length !== count) return yield* unsupported();
      let recognized = 0n;
      let reversed = 0n;
      let last = "";
      for (const state of states) {
        if (state.ordinal < first) {
          if (state.state !== "posted" && !(change.kind === "estimate" && state.state === "reversed"))
            return yield* unsupported();
          if (state.state === "reversed") {
            const voucher = state.reversalVoucherId === null ? undefined :
              (yield* Db.readVoucher(transaction, scope.bookId, state.reversalVoucherId))[0];
            if (!voucher || voucher.postingPurpose !== "reversal" || state.voucherId === null ||
              (yield* SchedulesDb.readCorrectionForVoucher(transaction, scope.bookId, state.voucherId)).length)
              return yield* unsupported();
            reversed += minor(state.amountMinor);
            if (voucher.postingDate > last) last = voucher.postingDate;
          } else recognized += minor(state.amountMinor);
          if (state.postingDate > last) last = state.postingDate;
        } else {
          if (!["unprepared", "prepared"].includes(state.state) || state.voucherId !== null)
            return yield* failure("AlreadyPosted");
          if (state.postingDate <= today) return yield* unsupported();
          if (periodById.get(state.accountingPeriodId)?.locked) return yield* failure("PeriodLocked");
        }
      }
      const lifetime = newCount !== count;
      const occurrences = [...current.occurrences.slice(0, first - 1)];
      let remaining = 0n;
      const effectiveOn = textField(objectField(basis.body, "input"), "effectiveOn");
      if (!effectiveOn) return yield* failure("InternalError");
      for (const [index, period] of replacement.entries()) {
        const retained = periodById.get(period.accountingPeriodId);
        const year = retained === undefined ? undefined : yearById.get(retained.fiscalYearId);
        if (!isCalendarDate(period.postingDate) || period.postingDate <= today || period.postingDate <= last ||
          period.postingDate <= effectiveOn || !retained || !year ||
          retained.startsOn < year.startsOn || retained.endsOn > year.endsOn ||
          period.postingDate < retained.startsOn || period.postingDate > retained.endsOn)
          return yield* failure("InvalidJournal");
        if (retained.locked) return yield* failure("PeriodLocked");
        last = period.postingDate;
        const old = current.occurrences[first - 1 + index];
        const amount = change.kind === "estimate" ? change.input.installments[index]?.amountMinor : old?.amountMinor;
        if (amount === undefined || minor(amount) <= 0n) return yield* failure("InvalidJournal");
        const eventKey = lifetime ? newId("occurrence") : old?.eventKey;
        if (eventKey === undefined) return yield* failure("InternalError");
        remaining += minor(amount);
        occurrences.push({ postingDate: period.postingDate, accountingPeriodId: period.accountingPeriodId,
          ordinal: first + index, eventKey, amountMinor: amount });
      }
      const residual = change.kind === "estimate" ? change.input.residualMinor : current.terms.residualMinor;
      const impairments = yield* SchedulesDb.readImpairments(transaction, scope.bookId, scheduleId);
      const impaired = impairments.reduce((total, row) => total + minor(row.impairmentMinor), 0n);
      if (remaining !== minor(input.remainingMinor) || remaining + recognized + minor(residual) + impaired !== minor(current.terms.costMinor))
        return yield* failure("StaleDependency");
      if ((yield* digestValue(transaction, { occurrences, residual })) ===
        (yield* digestValue(transaction, { occurrences: current.occurrences, residual: current.terms.residualMinor })) &&
        (change.kind === "dates" || (yield* estimateCurrent(transaction, scope, current))))
        return yield* failure("InvalidJournal");
      const terms = { ...current.terms,
        periods: occurrences.map(({ postingDate, accountingPeriodId }) => ({ postingDate, accountingPeriodId })),
        residualMinor: residual, usefulPeriods: newCount,
        allocationPolicy: change.kind === "estimate" ? "explicit_remaining_minor_v1" : current.terms.allocationPolicy };
      const amendment = { kind: change.kind === "dates" ? "future_dates_v1" :
        lifetime ? "remaining_lifetime_v1" : "remaining_estimate_v1", input,
        basisDigest: input.expectedBasisDigest, basisScheduleDigest: textField(basis.body, "scheduleDigest"),
        reviewSha256: evidence.sha256, reviewedOn: today,
        ...(change.kind === "estimate" ? { recognizedMinor: recognized.toString(), reversedMinor: reversed.toString() } : {}) };
      const body = yield* toJsonObject({ ...withoutKey(current, "digest"), revision: current.revision + 1,
        previousDigest: current.digest, terms, occurrences, allocatedMinor: (recognized + remaining).toString(),
        amendment, createdAt: now, receipt: { key: idempotencyKey, operation, actorId: principal.actorId } });
      const result = yield* decode(RevisionSchema, yield* digestBody(transaction, withoutKey(body, "digest")));
      yield* SchedulesDb.insertRevision(transaction, { bookId: scope.bookId, scheduleId,
        revision: result.revision, evidenceId: result.terms.evidenceId, body: result });
      yield* saveCommand(transaction, scope, idempotencyKey, request.expected, operation, principal.actorId, result);
      return result;
    }), "update");
});

export const amendFutureDates = Effect.fn("subledger.amendFutureDates")(function* (
  token: string, command: AmendmentCommand & { readonly input: FutureDatesInput },
) {
  return yield* amendSchedule(token, command, { kind: "dates", input: command.input });
});

export const amendEstimate = Effect.fn("subledger.amendEstimate")(function* (
  token: string, command: AmendmentCommand & { readonly input: EstimateInput },
) {
  return yield* amendSchedule(token, command, { kind: "estimate", input: command.input });
});
