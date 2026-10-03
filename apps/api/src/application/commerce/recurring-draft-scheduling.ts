import * as Accounting from "@open-erp/contracts/accounting";
import * as Recurring from "@open-erp/contracts/recurring-invoices";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Result from "effect/Result";
import { admitPrincipal } from "../../db/identity";
import { databaseFailure, withTransaction, type Transaction } from "../../db/transaction";
import * as SchedulingDb from "../../db/commerce/recurring-draft-scheduling";
import * as RecurrenceDb from "../../db/commerce/recurring-invoices";
import { failure } from "../failures";
import { admitRunnerActor } from "../preparation-jobs";
import { newId, replay, saveCommand } from "../posting";
import {
  initializeRecurringScheduleInTransaction,
  inspectRecurringCycle,
  materializeRecurringOccurrenceInTransaction,
} from "./recurring-invoices";
import { decode, toJsonObject, withBook, type Scope } from "./support";

const Admission = Schema.Struct({
  agreementRevision: Schema.String,
  agreementDigest: Accounting.Digest,
  configurationDigest: Accounting.Digest,
  templateDigest: Schema.String,
  scheduleRevision: Schema.String,
  eventDigest: Accounting.Digest,
  eventOrdinal: Schema.Int,
  capturedAt: Schema.String,
  localDate: Accounting.AccountingDate,
  timeZone: Recurring.TimeZone,
  duePolicy: Schema.Literal("local_calendar_date_v1"),
  explicitCatchUp: Schema.Boolean,
});

type SchedulingCommand = {
  readonly scope: Scope;
  readonly agreementId: string;
  readonly idempotencyKey: string;
  readonly input: typeof Recurring.RecurringSchedulingInput.Type;
};

function delegation(transaction: Transaction, bookId: string, actorId: string) {
  return Effect.gen(function* () {
    const admission = (yield* SchedulingDb.lockDelegationAdmission(transaction, actorId))[0];

    const membership = (yield* SchedulingDb.lockDelegationMembership(
      transaction,
      bookId,
      actorId,
    ))[0];

    if (admission?.enabled === false) return "Unauthorized";

    return membership?.role === "operator" ? null : "Forbidden";
  });
}

function jobView(job: SchedulingDb.DraftJobRow) {
  return decode(Recurring.RecurringDraftJob, {
    id: job.id,
    cycleOrdinal: job.cycleOrdinal,
    cycleDate: job.admitted.cycleDate ?? null,
    generation: job.generation,
    state: job.state,
    reason: job.reason,
    draftId: job.draftId,
  });
}

function schedulingView(
  transaction: Transaction,
  scope: Scope,
  agreementId: string,
  after?: string,
  jobId?: string,
) {
  return Effect.gen(function* () {
    const row = (yield* SchedulingDb.readScheduling(transaction, scope.bookId, agreementId))[0];

    if (row === undefined) return yield* failure("NotFound");

    if (after !== undefined) {
      const anchor = (yield* SchedulingDb.readJob(transaction, scope.bookId, after, false))[0];

      if (anchor === undefined || anchor.agreementId !== agreementId)
        return yield* failure("NotFound");
    }

    const selected =
      jobId === undefined
        ? undefined
        : (yield* SchedulingDb.readJob(transaction, scope.bookId, jobId, false))[0];

    if (jobId !== undefined && (selected === undefined || selected.agreementId !== agreementId))
      return yield* failure("NotFound");

    const jobs = yield* SchedulingDb.readJobs(transaction, scope.bookId, agreementId, after);
    const items = jobs.slice(0, 200);

    const next = yield* inspectRecurringCycle(
      transaction,
      scope,
      agreementId,
      row.nextCycleOrdinal,
    );

    return yield* decode(Recurring.RecurringScheduling, {
      scope,
      agreementId,
      enabled: row.enabled,
      generation: row.generation,
      firstAutomaticCycle: row.firstAutomaticCycle,
      nextCycleOrdinal: row.nextCycleOrdinal,
      nextCycleDate: next.cycleDate,
      requestedBy: row.requestedBy,
      timeZone: next.timeZone,
      duePolicy: row.duePolicy,
      history: yield* Effect.forEach(items, jobView),
      selectedJob: selected === undefined ? null : yield* jobView(selected),
      continuation: jobs.length > 200 ? (items.at(-1)?.id ?? null) : null,
    });
  });
}

export const getRecurringDraftScheduling = Effect.fn("commerce.recurring.getScheduling")(function* (
  token: string,
  input: { scope: Scope; agreementId: string; after?: string; job?: string },
) {
  return yield* withBook(token, input.scope, false, function* (transaction) {
    return yield* schedulingView(
      transaction,
      input.scope,
      input.agreementId,
      input.after,
      input.job,
    );
  });
});

export const listRecurringAgreements = Effect.fn("commerce.recurring.listAgreements")(function* (
  token: string,
  input: { scope: Scope; after?: string },
) {
  return yield* withBook(token, input.scope, false, function* (transaction) {
    if (
      input.after !== undefined &&
      (yield* RecurrenceDb.readAgreement(transaction, input.scope.bookId, input.after)).length === 0
    )
      return yield* failure("NotFound");

    const rows = yield* SchedulingDb.readAgreementPage(
      transaction,
      input.scope.bookId,
      input.after,
    );

    const items = rows.slice(0, 100);

    return yield* decode(Recurring.RecurringAgreementPage, {
      scope: input.scope,
      items: yield* Effect.forEach(items, (row) => decode(Recurring.RecurringAgreement, row.body)),
      continuation: rows.length > 100 ? (items.at(-1)?.id ?? null) : null,
    });
  });
});

export const setRecurringDraftScheduling = Effect.fn("commerce.recurring.setScheduling")(function* (
  token: string,
  command: SchedulingCommand,
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (transaction, principal) {
      const operation = "set_recurring_draft_scheduling";

      const request = yield* replay(
        transaction,
        command.scope,
        command.idempotencyKey,
        operation,
        principal.actorId,
        yield* toJsonObject({ agreementId: command.agreementId, input: command.input }),
        Recurring.RecurringScheduling,
      );

      if (request.previous) return request.previous;
      const input = yield* decode(Recurring.RecurringSchedulingInput, command.input);

      const previous = (yield* SchedulingDb.readScheduling(
        transaction,
        command.scope.bookId,
        command.agreementId,
      ))[0];

      if (input.expectedGeneration !== (previous?.generation ?? "0"))
        return yield* failure("StaleDependency");

      if (previous !== undefined && input.firstAutomaticCycle !== previous.firstAutomaticCycle)
        return yield* failure("StaleDependency");

      yield* initializeRecurringScheduleInTransaction(
        transaction,
        command.scope,
        command.agreementId,
        { key: command.idempotencyKey, operation, actorId: principal.actorId },
        input.reason,
      );

      const current = yield* inspectRecurringCycle(
        transaction,
        command.scope,
        command.agreementId,
        previous?.nextCycleOrdinal ?? input.firstAutomaticCycle,
      );

      if (Result.isFailure(current.resolved)) return yield* failure("UnsupportedProfile");

      if (current.template !== undefined && !("kind" in current.template.template))
        return yield* failure("UnsupportedProfile");

      if (previous === undefined && current.template === undefined)
        return yield* failure("UnsupportedProfile");
      const capturedAt = yield* captureInstant(transaction);

      const time = (yield* SchedulingDb.readLocalDate(
        transaction,
        current.timeZone,
        capturedAt,
      ))[0];

      if (time?.localDate == null && input.enabled) return yield* failure("UnsupportedProfile");
      const generation = (BigInt(previous?.generation ?? "0") + 1n).toString();

      const row: SchedulingDb.SchedulingRow = {
        bookId: command.scope.bookId,
        agreementId: command.agreementId,
        enabled: input.enabled,
        generation,
        firstAutomaticCycle: input.firstAutomaticCycle,
        nextCycleOrdinal: previous?.nextCycleOrdinal ?? input.firstAutomaticCycle,
        requestedBy: principal.actorId,
        timeZone: current.timeZone,
        duePolicy: input.duePolicy,
      };

      const changedAt = capturedAt;

      if (previous === undefined) yield* SchedulingDb.insertScheduling(transaction, row, changedAt);
      else yield* SchedulingDb.changeScheduling(transaction, row, changedAt);
      yield* SchedulingDb.appendSchedulingEvent(
        transaction,
        row,
        yield* toJsonObject({
          input,
          actorId: principal.actorId,
          changedAt,
          localDate: time?.localDate ?? null,
          receipt: { key: command.idempotencyKey, operation, actorId: principal.actorId },
        }),
      );
      const result = yield* schedulingView(transaction, command.scope, command.agreementId);
      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
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

function captureInstant(transaction: Transaction) {
  return Effect.gen(function* () {
    const row = (yield* SchedulingDb.readCapturedInstant(transaction))[0];

    if (row === undefined) return yield* failure("Unavailable");

    return row.capturedAt;
  });
}

const SchedulingEvent = Schema.Struct({
  changedAt: Schema.String,
  input: Recurring.RecurringSchedulingInput,
});

function disabledOnCycleDate(
  transaction: Transaction,
  schedule: SchedulingDb.SchedulingRow,
  cycleDate: string,
  timeZone: string,
) {
  return Effect.gen(function* () {
    const rows = yield* SchedulingDb.readSchedulingEvents(
      transaction,
      schedule.bookId,
      schedule.agreementId,
    );

    const events = yield* Effect.forEach(rows, (row) =>
      Effect.gen(function* () {
        const event = yield* decode(SchedulingEvent, row.body);
        const time = (yield* SchedulingDb.readLocalDate(transaction, timeZone, event.changedAt))[0];

        if (time?.localDate == null) return yield* failure("UnsupportedProfile");

        return { input: event.input, localDate: time.localDate };
      }),
    );

    return events.some(
      (event, index) =>
        !event.input.enabled &&
        cycleDate >= event.localDate &&
        (events[index + 1] === undefined || cycleDate < (events[index + 1]?.localDate ?? "")),
    );
  });
}

function cycleDisposition(
  transaction: Transaction,
  input: {
    schedule: SchedulingDb.SchedulingRow;
    current: Effect.Success<ReturnType<typeof inspectRecurringCycle>>;
    localDate: string | null;
    explicitCatchUp: boolean;
    authorityReason: string | null;
    existing: boolean;
  },
) {
  return Effect.gen(function* () {
    let state: typeof Recurring.RecurringDraftJobState.Type = "ready";
    let reason: string | null = input.authorityReason;

    if (input.localDate === null) {
      state = "failed";
      reason = "unqualified_time_zone";
    } else if (
      !input.schedule.enabled ||
      (!input.explicitCatchUp &&
        (yield* disabledOnCycleDate(
          transaction,
          input.schedule,
          input.current.cycleDate,
          input.current.timeZone,
        )))
    ) {
      state = "skipped";
      reason = "scheduling_disabled";
    } else if (
      Result.isSuccess(input.current.resolved) &&
      input.current.resolved.success.disposition === "skipped"
    ) {
      state = "skipped";
      reason = input.current.resolved.success.reason;
    } else if (input.authorityReason !== null) state = "failed";
    else if (input.existing) state = "existing";
    else if (Result.isFailure(input.current.resolved)) {
      state = "failed";
      reason = input.current.resolved.failure.code;
    } else if (
      input.current.template === undefined ||
      !("kind" in input.current.template.template)
    ) {
      state = "failed";
      reason = "UnsupportedProfile";
    }

    return { state, reason };
  });
}

function admitCycle(
  transaction: Transaction,
  scope: Scope,
  schedule: SchedulingDb.SchedulingRow,
  cycleOrdinal: string,
  executorId: string,
  explicitCatchUp: boolean,
  authorityReason: string | null,
  capturedAt: string,
) {
  return Effect.gen(function* () {
    const prior = (yield* SchedulingDb.readCycleJobs(
      transaction,
      scope.bookId,
      schedule.agreementId,
      cycleOrdinal,
    ))[0];

    if (!explicitCatchUp && prior !== undefined)
      return prior.reason === "unqualified_time_zone" ? false : undefined;

    if (explicitCatchUp && prior?.state === "ready") return yield* failure("StaleDependency");

    const existing = (yield* RecurrenceDb.readOccurrence(
      transaction,
      scope.bookId,
      schedule.agreementId,
      cycleOrdinal,
    ))[0];

    const current = yield* inspectRecurringCycle(
      transaction,
      scope,
      schedule.agreementId,
      cycleOrdinal,
      explicitCatchUp,
    );

    const time = (yield* SchedulingDb.readLocalDate(transaction, current.timeZone, capturedAt))[0];

    if (time === undefined) return yield* failure("Unavailable");

    if (
      time.localDate === null &&
      (!schedule.enabled ||
        (Result.isSuccess(current.resolved) && current.resolved.success.disposition === "skipped"))
    )
      return false;

    if (explicitCatchUp && (time.localDate === null || current.cycleDate > time.localDate))
      return yield* failure("UnsupportedProfile");

    if (time.localDate !== null && current.cycleDate > time.localDate) return false;

    const { state, reason } = yield* cycleDisposition(transaction, {
      schedule,
      current,
      localDate: time.localDate,
      explicitCatchUp,
      authorityReason,
      existing: existing !== undefined,
    });

    if (explicitCatchUp && state === "skipped") return yield* failure("StaleDependency");
    const generation = (BigInt(prior?.generation ?? "0") + 1n).toString();
    yield* SchedulingDb.insertJob(transaction, {
      id: newId("recurring_draft_job"),
      bookId: scope.bookId,
      agreementId: schedule.agreementId,
      cycleOrdinal,
      generation,
      scheduleGeneration: schedule.generation,
      requestedBy: schedule.requestedBy,
      executorId,
      admitted: yield* toJsonObject({
        ...current.witness,
        capturedAt,
        cycleDate: current.cycleDate,
        localDate: time.localDate,
        timeZone: current.timeZone,
        duePolicy: schedule.duePolicy,
        explicitCatchUp,
      }),
      state,
      reason,
      draftId: state === "existing" ? (existing?.draftId ?? null) : null,
    });

    return time.localDate !== null;
  });
}

export const catchUpRecurringDrafts = Effect.fn("commerce.recurring.catchUpDrafts")(function* (
  token: string,
  command: {
    scope: Scope;
    agreementId: string;
    idempotencyKey: string;
    input: typeof Recurring.RecurringCatchUpInput.Type;
  },
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (transaction, principal) {
      const operation = "catch_up_recurring_drafts";

      const request = yield* replay(
        transaction,
        command.scope,
        command.idempotencyKey,
        operation,
        principal.actorId,
        yield* toJsonObject({ agreementId: command.agreementId, input: command.input }),
        Recurring.RecurringScheduling,
      );

      if (request.previous) return request.previous;

      const assigned = (yield* SchedulingDb.readAssignedExecutor(
        transaction,
        command.scope.bookId,
        command.agreementId,
      ))[0];

      if (assigned === undefined) return yield* failure("StaleDependency");
      const executorId = assigned.executorId;

      const schedule = (yield* SchedulingDb.readScheduling(
        transaction,
        command.scope.bookId,
        command.agreementId,
      ))[0];

      if (schedule === undefined) return yield* failure("NotFound");

      if (
        !schedule.enabled ||
        schedule.generation !== command.input.expectedGeneration ||
        new Set(command.input.cycleOrdinals).size !== command.input.cycleOrdinals.length
      )
        return yield* failure("StaleDependency");

      const currentEvents = yield* RecurrenceDb.readEvents(
        transaction,
        command.scope.bookId,
        command.agreementId,
      );

      if (currentEvents.some((event) => event.kind === "end"))
        return yield* failure("StaleDependency");

      const capturedAt = yield* captureInstant(transaction);

      for (const cycle of command.input.cycleOrdinals) {
        const prior = (yield* SchedulingDb.readCycleJobs(
          transaction,
          command.scope.bookId,
          command.agreementId,
          cycle,
        ))[0];

        if (
          BigInt(cycle) > BigInt(schedule.nextCycleOrdinal) ||
          (cycle === schedule.nextCycleOrdinal && prior?.state !== "failed")
        )
          return yield* failure("StaleDependency");
        yield* admitCycle(
          transaction,
          command.scope,
          { ...schedule, requestedBy: principal.actorId },
          cycle,
          executorId,
          true,
          null,
          capturedAt,
        );
      }

      const result = yield* schedulingView(transaction, command.scope, command.agreementId);
      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
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

export const scanDueRecurringDrafts = Effect.fn("commerce.recurring.scanDueDrafts")(function* (
  token: string,
  cursor: SchedulingDb.ScanCursor | null,
) {
  const page = yield* withTransaction((transaction) =>
    Effect.gen(function* () {
      const actorId = yield* admitRunnerActor(transaction, token);

      const capturedAt = cursor?.capturedAt ?? (yield* captureInstant(transaction));
      const rows = yield* SchedulingDb.readScanPage(transaction, actorId, cursor);

      return { rows, capturedAt };
    }).pipe(Effect.mapError(databaseFailure)),
  );

  const rows = page.rows.slice(0, 100);

  for (const row of rows) {
    yield* withTransaction((transaction) =>
      Effect.gen(function* () {
        const scope = { entityId: row.entityId, bookId: row.bookId };

        const principal = yield* admitPrincipal(
          transaction,
          { token },
          scope,
          {
            operatorOnly: false,
            beforeBook: (tx) =>
              delegation(tx, row.bookId, row.requestedBy).pipe(
                Effect.asVoid,
                Effect.mapError(databaseFailure),
              ),
          },
          "update",
        );

        const schedule = (yield* SchedulingDb.readScheduling(
          transaction,
          row.bookId,
          row.agreementId,
        ))[0];

        if (schedule === undefined || schedule.requestedBy !== row.requestedBy) return;
        const authorityReason = yield* delegation(transaction, row.bookId, row.requestedBy);
        let next = BigInt(schedule.nextCycleOrdinal);

        for (let count = 0; count < 20; count++) {
          const admitted = yield* admitCycle(
            transaction,
            scope,
            schedule,
            next.toString(),
            principal.actorId,
            false,
            authorityReason,
            page.capturedAt,
          );

          if (admitted === false) break;
          next++;
        }

        yield* SchedulingDb.advanceCursor(
          transaction,
          row.bookId,
          row.agreementId,
          next.toString(),
        );
      }).pipe(Effect.mapError(databaseFailure)),
    );
  }

  const last = rows.at(-1);

  return page.rows.length > 100 && last !== undefined
    ? { bookId: last.bookId, agreementId: last.agreementId, capturedAt: page.capturedAt }
    : null;
});

export const pendingRecurringDraftJobs = Effect.fn("commerce.recurring.pendingDraftJobs")(
  function* (token: string) {
    return yield* withTransaction((transaction) =>
      Effect.gen(function* () {
        const actorId = yield* admitRunnerActor(transaction, token);

        return yield* SchedulingDb.readReadyPage(transaction, actorId);
      }).pipe(Effect.mapError(databaseFailure)),
    );
  },
);

export const executeRecurringDraftJob = Effect.fn("commerce.recurring.executeDraftJob")(function* (
  token: string,
  payload: { scope: Scope; jobId: string; generation: string },
) {
  const attempt = yield* withTransaction((transaction) =>
    Effect.gen(function* () {
      const initial = (yield* SchedulingDb.readJob(
        transaction,
        payload.scope.bookId,
        payload.jobId,
        false,
      ))[0];

      if (initial === undefined) return yield* failure("NotFound");

      const executor = yield* admitPrincipal(
        transaction,
        { token },
        payload.scope,
        {
          operatorOnly: false,
          beforeBook: (tx) =>
            delegation(tx, payload.scope.bookId, initial.requestedBy).pipe(
              Effect.asVoid,
              Effect.mapError(databaseFailure),
            ),
        },
        "update",
      );

      const snapshot = (yield* SchedulingDb.readJob(
        transaction,
        payload.scope.bookId,
        payload.jobId,
      ))[0];

      if (snapshot === undefined) return yield* failure("NotFound");

      if (snapshot.executorId !== executor.actorId || snapshot.generation !== payload.generation)
        return yield* failure("Forbidden");

      const authorityReason = yield* delegation(
        transaction,
        payload.scope.bookId,
        snapshot.requestedBy,
      );

      if (authorityReason !== null) {
        if (snapshot.state !== "ready")
          return yield* failure(authorityReason === "Unauthorized" ? "Unauthorized" : "Forbidden");

        yield* SchedulingDb.settleJob(
          transaction,
          payload.scope.bookId,
          snapshot.id,
          "failed",
          authorityReason,
          null,
        );

        return "failed";
      }

      if (snapshot.state !== "ready") return snapshot.state;

      const existing = (yield* RecurrenceDb.readOccurrence(
        transaction,
        payload.scope.bookId,
        snapshot.agreementId,
        snapshot.cycleOrdinal,
      ))[0];

      if (existing !== undefined) {
        yield* SchedulingDb.settleJob(
          transaction,
          payload.scope.bookId,
          snapshot.id,
          "drafted",
          null,
          existing.draftId,
        );

        return "drafted";
      }

      const schedule = (yield* SchedulingDb.readScheduling(
        transaction,
        payload.scope.bookId,
        snapshot.agreementId,
      ))[0];

      if (
        schedule === undefined ||
        !schedule.enabled ||
        schedule.generation !== snapshot.scheduleGeneration
      ) {
        yield* SchedulingDb.settleJob(
          transaction,
          payload.scope.bookId,
          snapshot.id,
          "failed",
          "StaleDependency",
          null,
        );

        return "failed";
      }

      const admitted = yield* decode(Admission, snapshot.admitted);

      const occurrence = yield* materializeRecurringOccurrenceInTransaction(
        transaction,
        executor,
        {
          scope: payload.scope,
          agreementId: snapshot.agreementId,
          idempotencyKey: `recurring_cycle_${snapshot.agreementId}_${snapshot.cycleOrdinal}`,
          input: {
            cycleOrdinal: snapshot.cycleOrdinal,
            reason: "Scheduled recurring invoice draft.",
          },
        },
        admitted,
      );

      yield* SchedulingDb.settleJob(
        transaction,
        payload.scope.bookId,
        snapshot.id,
        "drafted",
        null,
        occurrence.draftId,
      );

      return "drafted";
    }).pipe(Effect.mapError(databaseFailure)),
  ).pipe(Effect.result);

  if (Result.isSuccess(attempt)) return attempt.success;

  if (["Unavailable", "TransactionRetry"].includes(attempt.failure.code))
    return yield* attempt.failure;
  yield* markRecurringDraftDeliveryFailure(token, payload, attempt.failure.code);

  return "failed";
});

export const markRecurringDraftDeliveryFailure = Effect.fn("commerce.recurring.stopDraftDelivery")(
  function* (
    token: string,
    payload: { scope: Scope; jobId: string; generation: string },
    reason = "Unavailable",
  ) {
    return yield* withBook(
      token,
      payload.scope,
      false,
      function* (transaction, principal) {
        const job = (yield* SchedulingDb.readJob(
          transaction,
          payload.scope.bookId,
          payload.jobId,
        ))[0];

        if (
          job === undefined ||
          job.executorId !== principal.actorId ||
          job.generation !== payload.generation
        )
          return yield* failure("Forbidden");

        if (job.state !== "ready") return;

        yield* SchedulingDb.settleJob(
          transaction,
          payload.scope.bookId,
          job.id,
          "failed",
          reason,
          null,
        );
      },
      "update",
    );
  },
);

export const acknowledgeRecurringDraftDispatch = Effect.fn(
  "commerce.recurring.acknowledgeDraftDispatch",
)(function* (token: string, payload: { scope: Scope; jobId: string; generation: string }) {
  return yield* withBook(
    token,
    payload.scope,
    false,
    function* (transaction, principal) {
      const job = (yield* SchedulingDb.readJob(
        transaction,
        payload.scope.bookId,
        payload.jobId,
      ))[0];

      if (
        job === undefined ||
        job.executorId !== principal.actorId ||
        job.generation !== payload.generation
      )
        return yield* failure("Forbidden");
      yield* SchedulingDb.acknowledgeDispatch(transaction, payload.scope.bookId, job.id);
    },
    "update",
  );
});
