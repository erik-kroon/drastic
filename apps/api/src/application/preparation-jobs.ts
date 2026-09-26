import * as Accounting from "@open-erp/contracts/accounting";
import * as Automation from "@open-erp/contracts/automation";
import { sql } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { failure } from "./failures";
import { hashToken } from "../db/human-actor";
import { admitPrincipal, type VerifiedPrincipal } from "../db/identity";
import { lockBookForUpdate } from "../db/posting";
import * as JobDb from "../db/preparation-jobs";
import * as RecurringDb from "../db/recurring-rules";
import * as WorkDb from "../db/evidence-work";
import { databaseFailure, withTransaction, type Transaction } from "../db/transaction";
import { RequestEnvironment } from "../runtime/environment";
import {
  digest,
  isoNow,
  newId,
  prepareJournalInTransaction,
  replay,
  saveCommand,
  validatePlan,
} from "./posting";
import { calendarDate } from "./recurring-rules";
import {
  decode,
  exactKeys,
  toJsonObject,
  unsupported,
  withBook,
  type JsonObject,
  type Scope,
} from "./commerce/support";

const maximumCheckpoint = 49;

const maximumChunk = 20;

const maximumSelectedObservations = 1000;

const reasonLimit = 2000;

const digestPrefix = "sha256:";

const advanceActions = ["continue", "cancel", "resume"] as const;

const policyBlockedMessage =
  "The preparation policy could not be checked. No pending row was processed.";

const stepBlockedMessage =
  "The preparation step failed. The observation remains pending and no partial proposal was retained.";

const blockerCodes: readonly string[] = [
  "Unauthorized",
  "Forbidden",
  "NotFound",
  "InvalidJournal",
  "MissingEvidence",
  "PeriodLocked",
  "StaleDependency",
  "IdempotencyConflict",
  "AlreadyPosted",
  "ApprovalRequired",
  "UnsupportedProfile",
  "InternalError",
];

const FrozenObservation = Schema.Struct({
  statementId: Schema.String,
  rowOrdinal: Schema.Int,
  evidenceId: Schema.String,
  date: Schema.String,
  description: Schema.String,
  amountMinor: Schema.String,
  accountingPeriodId: Schema.String,
  periodVersion: Schema.String,
});

const RulePolicy = Schema.Struct({
  id: Schema.String,
  digest: Schema.String,
  input: Schema.Struct({
    accountId: Schema.String,
    counterpartAccountId: Schema.String,
    sourceBankAccountId: Schema.String,
    description: Schema.String,
    sign: Schema.String,
    series: Schema.String,
  }),
  dependencies: Schema.Array(
    Schema.Struct({
      kind: Schema.String,
      resourceId: Schema.String,
      version: Schema.String,
    }),
  ),
});

type Observation = typeof FrozenObservation.Type;

type Policy = typeof RulePolicy.Type;

function requireJobAccess(transaction: Transaction, write: boolean) {
  return Effect.gen(function* () {
    const rows = yield* JobDb.readJobAccess(transaction);

    const denied = JobDb.jobTables.some((name) => {
      const access = rows.find((row) => row.tableName === name);

      return access === undefined || !access.canSelect;
    });

    if (denied) return yield* unsupported();

    if (!write) return;

    const missingInsert = JobDb.jobInsertTables.some(
      (name) => !rows.some((row) => row.tableName === name && row.canInsert),
    );

    if (missingInsert) return yield* unsupported();
    const columns = yield* JobDb.readJobColumnAccess(transaction);

    if (columns.length !== JobDb.jobUpdateColumns.length) return yield* unsupported();

    if (columns.some((row) => !row.canUpdate)) return yield* unsupported();
  });
}

function requireAdvanceAccess(transaction: Transaction) {
  return JobDb.readAdvanceAccess(transaction).pipe(
    Effect.flatMap((rows) => {
      const denied = JobDb.advanceTables.some((name) => {
        const access = rows.find((row) => row.tableName === name);

        return access === undefined || !access.canSelect;
      });

      return denied ? unsupported() : Effect.void;
    }),
  );
}

function requireRunAccess(transaction: Transaction, write: boolean) {
  return Effect.gen(function* () {
    yield* requireJobAccess(transaction, write);
    const rows = yield* JobDb.readRunTableAccess(transaction);

    const denied = JobDb.runReadTables.some((name) => {
      const access = rows.find((row) => row.tableName === name);

      return access === undefined || !access.canSelect;
    });

    if (denied) return yield* unsupported();

    if (!write) return;
    const inserts = yield* JobDb.readRunInsertAccess(transaction);

    if (
      JobDb.runInsertTables.some(
        (name) => !inserts.some((row) => row.tableName === name && row.canInsert),
      )
    ) {
      return yield* unsupported();
    }
  });
}

function hasAgentRole(transaction: Transaction, bookId: string, actorId: string) {
  return JobDb.readAgentMembership(transaction, bookId, actorId).pipe(
    Effect.map((rows) => rows.length > 0),
  );
}

function jobBody(row: JobDb.JobRow) {
  return decode(Automation.PreparationJob, {
    id: row.id,
    scope: { entityId: row.entityId, bookId: row.bookId },
    runId: row.runId,
    requestedBy: row.requestedBy,
    executorId: row.executorId,
    checkpoint: row.checkpoint,
    state: row.state,
    reason: row.reason,
    createdAt: row.createdAt,
    checkedAt: row.checkedAt,
    requiresPostingApproval: true,
  });
}

function runBody(transaction: Transaction, bookId: string, runId: string) {
  return Effect.gen(function* () {
    const run = (yield* JobDb.readRunState(transaction, bookId, runId))[0];

    if (!run) return yield* failure("NotFound");
    const rule = (yield* JobDb.readRule(transaction, bookId, run.ruleId))[0];

    if (!rule) return yield* failure("NotFound");
    const scope = rule.body.scope;
    const ruleDigest = rule.body.digest;

    if (scope === undefined || ruleDigest === undefined) return yield* failure("InternalError");
    const audit = yield* JobDb.readRunAudit(transaction, bookId, runId);

    return yield* decode(Automation.PreparationRun, {
      id: run.id,
      scope,
      ruleId: run.ruleId,
      ruleDigest,
      activationId: run.activationId,
      selection: run.selection,
      state: run.state,
      cursor: run.cursor,
      total: run.total,
      results: run.results,
      blocker: run.blocker,
      requiresPostingApproval: true,
      audit: audit.map((row) => row.body),
    });
  });
}

function auditRun(
  transaction: Transaction,
  bookId: string,
  runId: string,
  actorId: string,
  key: string,
  operation: string,
  action: string,
) {
  return Effect.gen(function* () {
    const run = (yield* JobDb.readRunState(transaction, bookId, runId))[0];

    if (!run) return yield* failure("NotFound");
    const ordinal = (yield* countAudit(transaction, bookId, runId)) + 1;
    yield* JobDb.insertRunAudit(
      transaction,
      bookId,
      runId,
      ordinal,
      yield* toJsonObject({
        index: ordinal,
        action,
        state: run.state,
        cursor: run.cursor,
        blocker: run.blocker,
        actorId,
        recordedAt: yield* isoNow(transaction),
        receipt: { key, operation, actorId },
      }),
    );

    return yield* runBody(transaction, bookId, runId);
  });
}

function countAudit(transaction: Transaction, bookId: string, runId: string) {
  return JobDb.countAudit(transaction, bookId, runId).pipe(
    Effect.map((rows) => rows[0]?.total ?? 0),
  );
}

function submitterAuthority(transaction: Transaction, bookId: string, row: JobDb.JobRow) {
  return Effect.gen(function* () {
    const live =
      row.credentialHash === null
        ? ((yield* JobDb.readLiveSession(transaction, row.sessionId ?? ""))[0]?.actorId ?? null)
        : ((yield* JobDb.readLiveCredential(transaction, row.credentialHash))[0]?.actorId ?? null);

    const enabled = (yield* JobDb.readSubmitterAdmission(transaction, row.requestedBy))[0]?.enabled;
    const members = yield* JobDb.readSubmitterMembership(transaction, bookId, row.requestedBy);

    return { actorId: live, enabled: enabled ?? null, member: members.length > 0 };
  });
}

function replacementReason(
  transaction: Transaction,
  bookId: string,
  previous: JobDb.JobRow,
  executorId: string,
  audit: number,
) {
  return Effect.gen(function* () {
    if (previous.executorId !== executorId) {
      return "Stopped by explicit replacement admission with a different configured executor.";
    }

    if (!(yield* hasAgentRole(transaction, bookId, previous.executorId))) {
      return "The previous executor no longer has the agent role.";
    }

    const authority = yield* submitterAuthority(transaction, bookId, previous);

    if (!authority.member || authority.enabled === false || authority.actorId === null) {
      return "The previous submitting authority is missing, expired or revoked.";
    }

    if (previous.expectedAudit !== audit) {
      return "The preparation run was changed manually before explicit replacement admission.";
    }

    return null;
  });
}

function insertJob(
  transaction: Transaction,
  scope: Scope,
  runId: string,
  requester: VerifiedPrincipal,
  executorId: string,
  audit: number,
) {
  return Effect.gen(function* () {
    const id = newId("job");
    yield* JobDb.insertJob(transaction, {
      bookId: scope.bookId,
      id,
      runId,
      requestedBy: requester.actorId,
      executorId,
      credentialHash: requester.kind === "apiCredential" ? requester.credentialHash : null,
      sessionId: requester.kind === "betterAuthSession" ? requester.sessionId : null,
      expectedAudit: audit,
    });
    const row = (yield* JobDb.readJob(transaction, scope.bookId, id))[0];

    return row === undefined ? yield* failure("InternalError") : yield* jobBody(row);
  });
}

export const startPreparationJob = Effect.fn("Preparation.startJob")(function* (
  token: string,
  input: { scope: Scope; runId: string; idempotencyKey: string },
) {
  const { bindings } = yield* RequestEnvironment;
  const executorToken = bindings.OPENERP_PREPARATION_TOKEN;

  if (!executorToken) return yield* failure("Unavailable");

  return yield* withTransaction((transaction) =>
    Effect.gen(function* () {
      const requester = yield* admitPrincipal(
        transaction,
        { token },
        input.scope,
        { operatorOnly: false },
        "update",
      );

      const executor = yield* admitPrincipal(
        transaction,
        { token: executorToken },
        input.scope,
        { operatorOnly: false },
        "update",
      );

      yield* requireJobAccess(transaction, true);

      if (!(yield* hasAgentRole(transaction, input.scope.bookId, executor.actorId))) {
        return yield* failure("Forbidden");
      }

      const payload: JsonObject = yield* toJsonObject({
        runId: input.runId,
        executorId: executor.actorId,
      });

      const request = yield* replay(
        transaction,
        input.scope,
        input.idempotencyKey,
        "admit_preparation_job",
        requester.actorId,
        payload,
        Automation.PreparationJob,
      );

      if (request.previous) return request.previous;
      yield* lockBookForUpdate(transaction, input.scope);
      const run = (yield* JobDb.readRun(transaction, input.scope.bookId, input.runId))[0];

      if (!run) return yield* failure("NotFound");

      if (run.state !== "ready") return yield* failure("InvalidJournal");
      const audit = yield* countAudit(transaction, input.scope.bookId, run.id);
      const existing = (yield* JobDb.lockReadyJob(transaction, input.scope.bookId, run.id))[0];

      if (existing) {
        const reason = yield* replacementReason(
          transaction,
          input.scope.bookId,
          existing,
          executor.actorId,
          audit,
        );

        if (reason === null) return yield* failure("InvalidJournal");
        yield* JobDb.stopJob(transaction, input.scope.bookId, existing.id, reason);
      }

      const job = yield* insertJob(
        transaction,
        input.scope,
        run.id,
        requester,
        executor.actorId,
        audit,
      );

      yield* saveCommand(
        transaction,
        input.scope,
        input.idempotencyKey,
        request.expected,
        "admit_preparation_job",
        requester.actorId,
        job,
      );

      return job;
    }).pipe(Effect.mapError(databaseFailure)),
  );
});

export const readPreparationJob = Effect.fn("Preparation.readJob")(function* (
  token: string,
  command: { scope: Scope; runId: string },
) {
  return yield* withBook(token, command.scope, false, function* (transaction) {
    yield* requireJobAccess(transaction, false);
    const job = (yield* JobDb.readLatestJob(transaction, command.scope.bookId, command.runId))[0];

    if (!job) return null;

    return yield* jobBody(job);
  });
});

export const getPreparationRun = Effect.fn("Preparation.getRun")(function* (
  token: string,
  command: { scope: Scope; runId: string },
) {
  return yield* withBook(token, command.scope, false, function* (transaction) {
    yield* requireRunAccess(transaction, false);

    return yield* runBody(transaction, command.scope.bookId, command.runId);
  });
});

type SavepointOutcome<A> =
  | { readonly state: "committed"; readonly result: A }
  | { readonly state: "refused"; readonly error: Accounting.AccountingError };

function savepointed<A>(
  transaction: Transaction,
  operation: Effect.Effect<A, unknown>,
): Effect.Effect<SavepointOutcome<A>, Accounting.AccountingError> {
  return Effect.gen(function* () {
    yield* transaction
      .execute(sql`SAVEPOINT preparation_step`)
      .pipe(Effect.mapError(databaseFailure));

    const outcome = yield* operation.pipe(
      Effect.mapError(databaseFailure),
      Effect.map((value) => ({ state: "committed", result: value }) as const),
      Effect.catch((error) =>
        transaction
          .execute(sql`ROLLBACK TO SAVEPOINT preparation_step`)
          .pipe(Effect.mapError(databaseFailure), Effect.as({ state: "refused", error } as const)),
      ),
    );

    yield* transaction
      .execute(sql`RELEASE SAVEPOINT preparation_step`)
      .pipe(Effect.mapError(databaseFailure));

    return outcome;
  });
}

function blocker(error: Accounting.AccountingError, message: string): JsonObject {
  return {
    code: blockerCodes.includes(error.code) ? error.code : "InternalError",
    message,
  };
}

function dependenciesCurrent(
  transaction: Transaction,
  bookId: string,
  rule: Policy,
  ruleBody: JsonObject,
) {
  return Effect.gen(function* () {
    const sealed = Object.fromEntries(Object.entries(ruleBody).filter(([key]) => key !== "digest"));

    if ((yield* digest(sealed)) !== rule.digest) return false;
    const book = (yield* JobDb.readPolicy(transaction, bookId))[0];

    if (!book || book.profile !== "synthetic-core-v1" || book.authority !== "native") return false;

    const accounts = new Map(
      (yield* JobDb.readActiveAccountVersions(transaction, bookId, [
        rule.input.accountId,
        rule.input.counterpartAccountId,
      ])).map((row) => [row.id, row.version]),
    );

    for (const dependency of rule.dependencies) {
      let current: string | undefined;

      if (dependency.kind === "profile") current = book.profileVersion;

      if (dependency.kind === "writer_epoch") current = book.writerEpoch;

      if (dependency.kind === "account") current = accounts.get(dependency.resourceId);

      if (current !== dependency.version) return false;
    }

    const source = (yield* JobDb.readBankSource(transaction, bookId, rule.input.accountId))[0];

    return source !== undefined && source.sourceBankAccountId === rule.input.sourceBankAccountId;
  });
}

function checkPolicy(transaction: Transaction, bookId: string, run: JobDb.RunProgressRow) {
  return Effect.gen(function* () {
    const stored = (yield* JobDb.readRule(transaction, bookId, run.ruleId))[0];

    if (!stored) return yield* failure("NotFound");
    const rule = yield* decode(RulePolicy, stored.body);

    const activation = yield* JobDb.readActiveOperatorActivation(
      transaction,
      bookId,
      run.activationId,
      run.ruleId,
    );

    if (activation.length === 0) return yield* failure("ApprovalRequired");
    yield* JobDb.lockSelectionPeriods(transaction, bookId, run.rows);
    yield* JobDb.lockRuleAccounts(transaction, bookId, [
      rule.input.accountId,
      rule.input.counterpartAccountId,
    ]);
    const current = yield* dependenciesCurrent(transaction, bookId, rule, stored.body);

    const overlaps = yield* JobDb.readOverlappingRuleIds(
      transaction,
      bookId,
      run.ruleId,
      rule.input.accountId,
      rule.input.description,
      rule.input.sign,
    );

    if (!current || overlaps.length > 0) return yield* failure("StaleDependency");

    return rule;
  });
}

function prepareObservation(
  transaction: Transaction,
  scope: Scope,
  principal: VerifiedPrincipal,
  rule: Policy,
  row: Observation,
) {
  return Effect.gen(function* () {
    const statementId = row.statementId;
    const rowOrdinal = row.rowOrdinal;

    const allocated = (yield* JobDb.readAllocatedSource(
      transaction,
      scope.bookId,
      statementId,
      rowOrdinal,
    ))[0]?.total;

    if (allocated !== undefined && BigInt(allocated) !== 0n) {
      return yield* toJsonObject({
        statementId,
        rowOrdinal,
        state: "skipped_matched",
        changeSetId: null,
        planDigest: null,
        voucherId: null,
      });
    }

    const eventKey = `bank_${statementId}_${rowOrdinal}`;

    const eventId = (yield* JobDb.readEventByKey(
      transaction,
      scope.bookId,
      row.evidenceId,
      eventKey,
    ))[0]?.id;

    if (eventId !== undefined) {
      const voucher = (yield* JobDb.readPostedAdjustmentVoucher(
        transaction,
        scope.bookId,
        eventId,
      ))[0];

      if (voucher) {
        const digestRow = (yield* JobDb.readPlanDigest(
          transaction,
          scope.bookId,
          voucher.changeSetId,
        ))[0];

        return yield* toJsonObject({
          statementId,
          rowOrdinal,
          state: "already_posted",
          changeSetId: voucher.changeSetId,
          planDigest: digestRow?.planDigest ?? null,
          voucherId: voucher.id,
        });
      }
    }

    const prepared = (yield* JobDb.readPreparation(
      transaction,
      scope.bookId,
      statementId,
      rowOrdinal,
    ))[0];

    if (prepared) {
      if (prepared.ruleId !== rule.id) {
        return yield* failure("InvalidJournal");
      }

      const stored = (yield* JobDb.readPlanBody(
        transaction,
        scope.bookId,
        prepared.changeSetId,
      ))[0];

      if (!stored) return yield* failure("NotFound");
      const plan = yield* decode(Accounting.ChangeSet, stored.body);
      yield* validatePlan(transaction, scope, plan);

      return yield* toJsonObject({
        statementId,
        rowOrdinal,
        state: "recovered",
        changeSetId: prepared.changeSetId,
        planDigest: plan.planDigest,
        voucherId: null,
      });
    }

    if (eventId !== undefined) {
      const duplicate = yield* JobDb.readProposalForEvent(transaction, scope.bookId, eventId);

      if (duplicate.length > 0) return yield* failure("InvalidJournal");
    }

    const period = (yield* JobDb.lockPeriod(transaction, scope.bookId, row.accountingPeriodId))[0];

    if (!period || period.version !== row.periodVersion) return yield* failure("StaleDependency");

    if (period.locked) return yield* failure("PeriodLocked");
    const amount = BigInt(row.amountMinor);
    const magnitude = (amount < 0n ? -amount : amount).toString();
    const bankDebit = amount > 0n ? magnitude : "0";
    const bankCredit = amount < 0n ? magnitude : "0";

    const commandKey = `auto_${(yield* digest({
      bookId: scope.bookId,
      statementId,
      rowOrdinal,
    })).slice(digestPrefix.length)}`;

    const plan = yield* prepareJournalInTransaction(transaction, principal, {
      scope,
      idempotencyKey: commandKey,
      input: {
        kind: "manual_journal",
        evidenceId: row.evidenceId,
        eventKey,
        accountingPeriodId: period.id,
        postingDate: row.date,
        series: rule.input.series,
        description: row.description,
        rationale: `Prepared by recurring rule ${rule.id}; separate operator approval is required.`,
        taxAssessment: "not_applicable",
        lines: [
          {
            accountId: rule.input.accountId,
            description: row.description,
            debitMinor: bankDebit,
            creditMinor: bankCredit,
          },
          {
            accountId: rule.input.counterpartAccountId,
            description: row.description,
            debitMinor: bankCredit,
            creditMinor: bankDebit,
          },
        ],
      },
    });

    yield* JobDb.insertPreparation(transaction, {
      bookId: scope.bookId,
      statementId,
      rowOrdinal,
      ruleId: rule.id,
      changeSetId: plan.id,
    });

    return yield* toJsonObject({
      statementId,
      rowOrdinal,
      state: "prepared",
      changeSetId: plan.id,
      planDigest: plan.planDigest,
      voucherId: null,
    });
  });
}

function advancePreparationRun(
  transaction: Transaction,
  scope: Scope,
  principal: VerifiedPrincipal,
  run: JobDb.RunProgressRow,
  limit: number,
) {
  return Effect.gen(function* () {
    const checked = yield* savepointed(transaction, checkPolicy(transaction, scope.bookId, run));
    let state = run.state;
    let cursor = run.cursor;
    let results: readonly JsonObject[] = run.results;
    let current: JsonObject | null = run.blocker;
    let reason: string | null = null;

    if (checked.state === "refused") {
      state = "blocked";
      current = blocker(checked.error, policyBlockedMessage);
      reason = policyBlockedMessage;
    } else {
      const rule = checked.result;
      state = "ready";
      current = null;
      let processed = 0;

      while (state === "ready" && cursor < run.rows.length && processed < limit) {
        const frozen = run.rows[cursor];

        if (frozen === undefined) return yield* failure("InternalError");
        const observation = yield* decode(FrozenObservation, frozen);

        const prepared = yield* savepointed(
          transaction,
          prepareObservation(transaction, scope, principal, rule, observation),
        );

        if (prepared.state === "refused") {
          state = "blocked";
          current = blocker(prepared.error, stepBlockedMessage);
          reason = stepBlockedMessage;
          break;
        }

        results = [...results, prepared.result];
        cursor = cursor + 1;
        processed = processed + 1;
      }

      if (state === "ready" && cursor === run.rows.length) state = "completed";
    }

    yield* JobDb.writeRunProgress(transaction, {
      bookId: scope.bookId,
      runId: run.id,
      state,
      cursor,
      results,
      blocker: current,
    });

    return { state, cursor, blocker: current, reason };
  });
}

export const createPreparationRun = Effect.fn("Preparation.createRun")(function* (
  token: string,
  command: {
    scope: Scope;
    idempotencyKey: string;
    input: typeof Automation.CreatePreparationRun.Type;
  },
) {
  return yield* withBook(
    token,
    command.scope,
    false,
    function* (transaction, principal) {
      const input = yield* toJsonObject(command.input);
      yield* exactKeys(input, ["activationId", "startsOn", "endsOn"]);

      const request = yield* replay(
        transaction,
        command.scope,
        command.idempotencyKey,
        "create_preparation_run",
        principal.actorId,
        input,
        Automation.PreparationRun,
      );

      if (request.previous) return request.previous;
      yield* requireRunAccess(transaction, true);
      const bookId = command.scope.bookId;

      const activation = (yield* WorkDb.readActivation(
        transaction,
        bookId,
        command.input.activationId,
      ))[0];

      if (!activation) return yield* failure("NotFound");

      const active = yield* JobDb.readActiveOperatorActivation(
        transaction,
        bookId,
        activation.id,
        activation.ruleId,
      );

      if (active.length === 0) return yield* failure("ApprovalRequired");
      const rule = (yield* JobDb.readRule(transaction, bookId, activation.ruleId))[0];

      if (!rule) return yield* failure("NotFound");
      const policy = yield* decode(RulePolicy, rule.body);
      const startsOn = calendarDate(command.input.startsOn);
      const endsOn = calendarDate(command.input.endsOn);

      if (startsOn === null || endsOn === null || startsOn > endsOn) {
        return yield* failure("InvalidJournal");
      }

      yield* RecurringDb.lockSelectionAccounts(transaction, bookId, [
        policy.input.accountId,
        policy.input.counterpartAccountId,
      ]);
      yield* RecurringDb.lockSelectionPeriods(transaction, bookId, startsOn, endsOn);

      const selected = (yield* RecurringDb.readSelection(
        transaction,
        bookId,
        rule.body,
        startsOn,
        endsOn,
      ))[0];

      if (!selected?.current || selected.selection === null) {
        return yield* failure("StaleDependency");
      }

      const selection = yield* decode(Automation.SimulationSelection, selected.selection);

      if (selection.matchingCount > maximumSelectedObservations) {
        return yield* failure("InvalidJournal");
      }

      const firstBlocker = selection.blockers[0];

      const state =
        firstBlocker !== undefined
          ? "blocked"
          : selection.rows.length === 0
            ? "completed"
            : "ready";

      const blocker =
        firstBlocker === undefined ? null : { code: "InvalidJournal", message: firstBlocker };

      const id = newId("run");
      yield* JobDb.insertRun(transaction, {
        bookId,
        id,
        ruleId: activation.ruleId,
        activationId: activation.id,
        selection: selected.selection,
        state,
        blocker,
      });

      const result = yield* auditRun(
        transaction,
        bookId,
        id,
        principal.actorId,
        command.idempotencyKey,
        "create_preparation_run",
        "create",
      );

      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        request.expected,
        "create_preparation_run",
        principal.actorId,
        result,
      );

      return result;
    },
    "update",
  );
});

export const advanceRun = Effect.fn("Preparation.advanceRun")(function* (
  token: string,
  command: {
    scope: Scope;
    runId: string;
    idempotencyKey: string;
    input: typeof Automation.AdvancePreparationRun.Type;
  },
) {
  return yield* withBook(
    token,
    command.scope,
    false,
    function* (transaction, principal) {
      const input = yield* toJsonObject(command.input);
      yield* exactKeys(input, ["action", "maxItems"]);

      const request = yield* replay(
        transaction,
        command.scope,
        command.idempotencyKey,
        "advance_preparation_run",
        principal.actorId,
        yield* toJsonObject({ id: command.runId, input }),
        Automation.PreparationRun,
      );

      if (request.previous) return request.previous;
      yield* requireRunAccess(transaction, true);

      if (!advanceActions.some((choice) => choice === command.input.action)) {
        return yield* failure("InvalidJournal");
      }

      const limit = command.input.maxItems;

      if (!Number.isInteger(limit) || limit < 1 || limit > maximumChunk) {
        return yield* failure("InvalidJournal");
      }

      const bookId = command.scope.bookId;
      const run = (yield* JobDb.lockRun(transaction, bookId, command.runId))[0];

      if (!run) return yield* failure("NotFound");

      if (run.state !== "completed") {
        if (command.input.action === "cancel") {
          yield* JobDb.writeRunProgress(transaction, {
            bookId,
            runId: run.id,
            state: "cancelled",
            cursor: run.cursor,
            results: run.results,
            blocker: null,
          });
        } else {
          if (
            command.input.action === "continue" &&
            (run.state === "cancelled" || run.state === "blocked")
          ) {
            return yield* failure("InvalidJournal");
          }

          yield* requireAdvanceAccess(transaction);
          yield* advancePreparationRun(transaction, command.scope, principal, run, limit);
        }
      }

      const result = yield* auditRun(
        transaction,
        bookId,
        run.id,
        principal.actorId,
        command.idempotencyKey,
        "advance_preparation_run",
        command.input.action,
      );

      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        request.expected,
        "advance_preparation_run",
        principal.actorId,
        result,
      );

      return result;
    },
    "update",
  );
});

export const stopPreparationJob = Effect.fn("Preparation.stopJob")(function* (
  token: string,
  command: {
    scope: Scope;
    jobId: string;
    idempotencyKey: string;
    input: typeof Automation.StopPreparationJob.Type;
  },
) {
  return yield* withBook(
    token,
    command.scope,
    false,
    function* (transaction, principal) {
      const input = yield* toJsonObject(command.input);

      const request = yield* replay(
        transaction,
        command.scope,
        command.idempotencyKey,
        "stop_preparation_job",
        principal.actorId,
        yield* toJsonObject({ jobId: command.jobId, input }),
        Automation.PreparationJobStop,
      );

      if (request.previous) return request.previous;
      yield* requireJobAccess(transaction, true);
      yield* exactKeys(input, ["reason"]);
      const reason = input.reason;

      if (typeof reason !== "string" || reason.trim().length < 1 || reason.length > reasonLimit) {
        return yield* failure("InvalidJournal");
      }

      const bookId = command.scope.bookId;
      const job = (yield* JobDb.lockJob(transaction, bookId, command.jobId))[0];

      if (!job) return yield* failure("NotFound");
      const outcome = job.state === "ready" ? "stopped" : "already_terminal";

      if (outcome === "stopped") yield* JobDb.stopJob(transaction, bookId, job.id, reason);

      const current =
        outcome === "stopped" ? (yield* JobDb.readJob(transaction, bookId, job.id))[0] : job;

      if (!current) return yield* failure("InternalError");

      const result = yield* decode(Automation.PreparationJobStop, {
        job: yield* jobBody(current),
        outcome,
        receipt: {
          key: command.idempotencyKey,
          operation: "stop_preparation_job",
          actorId: principal.actorId,
        },
      });

      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        request.expected,
        "stop_preparation_job",
        principal.actorId,
        result,
      );

      return result;
    },
    "update",
  );
});

function stopReason(
  authority: {
    readonly actorId: string | null;
    readonly enabled: boolean | null;
    readonly member: boolean;
  },
  executorIsAgent: boolean,
  audit: number,
  row: JobDb.JobRow,
  runState: string,
) {
  if (authority.actorId !== row.requestedBy || !authority.member) {
    return "Submitting authority expired or was revoked.";
  }

  if (authority.enabled === false) return "The submitting identity is disabled.";

  if (!executorIsAgent) return "Executor no longer has the agent role.";

  if (audit !== row.expectedAudit) {
    return "The preparation run was changed manually. Start a new background job explicitly.";
  }

  return runState === "ready" ? null : "The preparation run is no longer ready.";
}

export const executePreparationJob = Effect.fn("Preparation.executeJob")(function* (
  payload: { jobId: string; scope: Scope },
  step: number,
) {
  const { bindings } = yield* RequestEnvironment;
  const executorToken = bindings.OPENERP_PREPARATION_TOKEN;

  if (!executorToken) return yield* failure("Unavailable");

  return yield* withTransaction((transaction) =>
    Effect.gen(function* () {
      const executor = yield* admitPrincipal(
        transaction,
        { token: executorToken },
        payload.scope,
        { operatorOnly: false },
        "update",
      );

      yield* requireJobAccess(transaction, true);
      const job = (yield* JobDb.readJob(transaction, payload.scope.bookId, payload.jobId))[0];

      if (!job || job.executorId !== executor.actorId) return yield* failure("Forbidden");

      if (!Number.isInteger(step) || step < 0 || step > maximumCheckpoint) {
        return yield* failure("InvalidJournal");
      }

      const authority = yield* submitterAuthority(transaction, payload.scope.bookId, job);

      const executorIsAgent = yield* hasAgentRole(
        transaction,
        payload.scope.bookId,
        executor.actorId,
      );

      yield* lockBookForUpdate(transaction, payload.scope);
      const locked = (yield* JobDb.readJob(transaction, payload.scope.bookId, payload.jobId))[0];

      if (!locked) return yield* failure("NotFound");

      if (locked.state !== "ready" || step < locked.checkpoint) return yield* jobBody(locked);

      if (step !== locked.checkpoint) return yield* failure("InvalidJournal");
      const run = (yield* JobDb.readRun(transaction, payload.scope.bookId, locked.runId))[0];

      if (!run) return yield* failure("NotFound");
      const audit = yield* countAudit(transaction, payload.scope.bookId, locked.runId);
      const reason = stopReason(authority, executorIsAgent, audit, locked, run.state);

      if (reason !== null) {
        yield* JobDb.stopJob(transaction, payload.scope.bookId, locked.id, reason);
        const stopped = (yield* JobDb.readJob(transaction, payload.scope.bookId, locked.id))[0];

        return stopped === undefined ? yield* failure("InternalError") : yield* jobBody(stopped);
      }

      yield* requireAdvanceAccess(transaction);
      const progress = (yield* JobDb.lockRun(transaction, payload.scope.bookId, locked.runId))[0];

      if (!progress) return yield* failure("NotFound");

      const advanced = yield* advancePreparationRun(
        transaction,
        payload.scope,
        executor,
        progress,
        maximumChunk,
      );

      const ordinal = audit + 1;
      yield* JobDb.insertRunAudit(
        transaction,
        payload.scope.bookId,
        locked.runId,
        ordinal,
        yield* toJsonObject({
          index: ordinal,
          action: "continue",
          state: advanced.state,
          cursor: advanced.cursor,
          blocker: advanced.blocker,
          actorId: executor.actorId,
          recordedAt: yield* isoNow(transaction),
          receipt: {
            key: `${locked.id}_step_${step}`,
            operation: "advance_preparation_run",
            actorId: executor.actorId,
          },
        }),
      );
      yield* JobDb.advanceJob(
        transaction,
        payload.scope.bookId,
        locked.id,
        step + 1,
        ordinal,
        advanced.state === "ready" || advanced.state === "completed" ? advanced.state : "blocked",
        advanced.reason,
      );
      const next = (yield* JobDb.readJob(transaction, payload.scope.bookId, locked.id))[0];

      return next === undefined ? yield* failure("InternalError") : yield* jobBody(next);
    }).pipe(Effect.mapError(databaseFailure)),
  );
});

function admitRunnerActor(transaction: Transaction, token: string) {
  return Effect.gen(function* () {
    if (token.length < 32 || token.length > 512) return yield* failure("Unauthorized");
    const credential = (yield* JobDb.readLiveCredential(transaction, yield* hashToken(token)))[0];

    if (!credential) return yield* failure("Unauthorized");
    const admission = (yield* JobDb.readSubmitterAdmission(transaction, credential.actorId))[0];

    if (admission?.enabled === false) return yield* failure("Unauthorized");

    return credential.actorId;
  });
}

export const claimPendingPreparationJobs = Effect.fn("Preparation.claimPending")(function* (
  token: string,
) {
  return yield* withTransaction((transaction) =>
    Effect.gen(function* () {
      const actorId = yield* admitRunnerActor(transaction, token);
      yield* requireJobAccess(transaction, true);
      const rows = yield* JobDb.claimReadyJobs(transaction, actorId);

      return yield* Effect.forEach(rows, (row) => jobBody(row));
    }).pipe(Effect.mapError(databaseFailure)),
  );
});

// A late terminal delivery must not stop a job that has advanced its checkpoint.
export const stopFailedPreparationDelivery = Effect.fn("Preparation.stopFailedDelivery")(
  function* (payload: { jobId: string; scope: Scope; checkpoint: number }) {
    const { bindings } = yield* RequestEnvironment;
    const token = bindings.OPENERP_PREPARATION_TOKEN;

    if (!token) return yield* failure("Unavailable");

    return yield* withTransaction((transaction) =>
      Effect.gen(function* () {
        const executor = yield* admitPrincipal(
          transaction,
          { token },
          payload.scope,
          { operatorOnly: false },
          "update",
        );

        if (!(yield* hasAgentRole(transaction, payload.scope.bookId, executor.actorId))) {
          return yield* failure("Forbidden");
        }

        const job = (yield* JobDb.readJob(transaction, payload.scope.bookId, payload.jobId))[0];

        if (!job || job.executorId !== executor.actorId) return yield* failure("Forbidden");

        if (job.state !== "ready" || job.checkpoint !== payload.checkpoint) return;
        yield* JobDb.stopJob(
          transaction,
          payload.scope.bookId,
          job.id,
          "Background delivery exhausted its retries or was cancelled. Start a new background job explicitly.",
        );
      }).pipe(Effect.mapError(databaseFailure)),
    );
  },
);
