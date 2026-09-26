import * as Accounting from "@open-erp/contracts/accounting";
import * as Impact from "@open-erp/contracts/rule-impact";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { failure } from "../failures";
import { isoNow, newId, replay, saveCommand, versionedDigest } from "../posting";
import { decodeRelease } from "../company-profile-basis";
import { decode, toJsonObject, unsupported, withBook } from "../commerce/support";
import * as Db from "../../db/rule-impact";
import * as Basis from "./fulfillment-basis";
import type { Transaction } from "../../db/transaction";

type Scope = typeof Accounting.Scope.Type;

type JsonObject = Schema.JsonObject;

type ExecutionState = typeof Impact.ImpactTarget.Type.executionState;

type DecisionKind = typeof Impact.ImpactDecisionKind.Type;

const NoticeSchema = Impact.RuleChangeNotice;

const NoticeListSchema = Impact.RuleChangeNoticeList;

const HeaderSchema = Impact.ImpactSnapshotHeader;

const SnapshotSchema = Impact.ImpactSnapshot;

const SnapshotListSchema = Impact.ImpactSnapshotList;

const DecisionSchema = Impact.ImpactDecision;

const DecisionListSchema = Impact.ImpactDecisionList;

const TargetSchema = Impact.ImpactTarget;

const SuccessorSchema = Impact.ProposedSuccessor;

const TargetListSchema = Schema.Array(TargetSchema);

function decodeList<A>(schema: Schema.Decoder<ReadonlyArray<A>>, value: unknown) {
  return Schema.decodeUnknownEffect(schema)(value).pipe(
    Effect.mapError(() => failure("InternalError")),
  );
}

// One page of targets, and the bound a capture must stay under. A wider selection
// is refused so the operator names a narrower partition explicitly.
const targetPage = 100;

const captureBound = 500;

function requireImpactAccess(transaction: Transaction, write: boolean) {
  const readTables = [...Db.ruleImpactReadTables];
  const insertTables = new Set<string>(Db.ruleImpactInsertTables);

  return Effect.gen(function* () {
    const rows = yield* Db.readRuleImpactAccess(transaction);

    if (rows.length !== readTables.length) return yield* unsupported();

    if (rows.some((row) => !row.canSelect)) return yield* unsupported();

    if (!write) return;

    if (rows.some((row) => insertTables.has(row.tableName) && !row.canInsert)) {
      return yield* unsupported();
    }
  });
}

function isDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
}

// A notice is only about a rule a reviewer qualified. A missing or undecodable
// release is a refusal, never a default.
function readRelease(transaction: Transaction, id: string, reviewed: boolean) {
  return Effect.gen(function* () {
    const row = (yield* Db.readRelease(transaction, id))[0];

    if (!row) return yield* failure("NotFound");

    const release = decodeRelease(row);

    if (release === null) return yield* failure("UnsupportedProfile");

    if (reviewed && release.qualificationStatus !== "reviewed") {
      return yield* failure("UnsupportedProfile");
    }

    return row;
  });
}

function deadlineExecutionState(recorded: boolean, outcomeKind: string | null): ExecutionState {
  if (!recorded) return "not_recorded";

  return outcomeKind === "accepted"
    ? "recorded_accepted"
    : outcomeKind === "submitted"
      ? "recorded_submitted"
      : "recorded_prepared";
}

function targetBody(input: {
  readonly ordinal: number;
  readonly targetKind: typeof Impact.TargetKind.Type;
  readonly targetId: string;
  readonly targetRevision: string;
  readonly family: string;
  readonly periodId: string | null;
  readonly periodStartsOn: string | null;
  readonly periodEndsOn: string | null;
  readonly usedRule: string;
  readonly basisDigest: string;
  readonly impactKind: typeof Impact.ImpactKind.Type;
  readonly executionState: ExecutionState;
  readonly suggestedDecision: DecisionKind;
}): JsonObject {
  return {
    ordinal: input.ordinal,
    targetKind: input.targetKind,
    targetId: input.targetId,
    targetRevision: input.targetRevision,
    family: input.family,
    periodId: input.periodId,
    periodStartsOn: input.periodStartsOn,
    periodEndsOn: input.periodEndsOn,
    usedRule: input.usedRule,
    basisDigest: input.basisDigest,
    impactKind: input.impactKind,
    executionState: input.executionState,
    suggestedDecision: input.suggestedDecision,
    decisionKind: null,
    decisionReason: null,
  };
}

function classify(
  changeKind: typeof Impact.RuleChangeKind.Type,
  effectiveFrom: string,
  effectiveTo: string | null,
  periodStartsOn: string | null,
  periodEndsOn: string | null,
  executionState: ExecutionState,
) {
  if (periodStartsOn === null || periodEndsOn === null) return Basis.undetermined();

  return Basis.classifyImpact({
    changeKind,
    effectiveFrom,
    effectiveTo,
    periodStartsOn,
    periodEndsOn,
    executionState,
  });
}

export const listNotices = Effect.fn("ruleImpact.listNotices")(function* (
  token: string,
  command: { scope: Scope },
) {
  return yield* withBook(token, command.scope, false, function* (transaction) {
    yield* requireImpactAccess(transaction, false);
    const rows = yield* Db.listNotices(transaction, command.scope.bookId);

    return yield* decodeList(
      NoticeListSchema,
      rows.map((row) => row.body),
    );
  });
});

export const recordNotice = Effect.fn("ruleImpact.recordNotice")(function* (
  token: string,
  command: {
    scope: Scope;
    idempotencyKey: string;
    input: typeof Impact.RecordRuleChangeNotice.Type;
  },
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (transaction, principal) {
      const payload = yield* toJsonObject(command.input);

      const request = yield* replay(
        transaction,
        command.scope,
        command.idempotencyKey,
        "rule_change_notice_record",
        principal.actorId,
        payload,
        NoticeSchema,
      );

      if (request.previous) return request.previous;
      yield* requireImpactAccess(transaction, true);

      const input = command.input;
      const oldRelease = yield* readRelease(transaction, input.oldReleaseId, false);
      const newRelease = yield* readRelease(transaction, input.newReleaseId, true);

      if (
        oldRelease.jurisdiction !== newRelease.jurisdiction ||
        oldRelease.family !== newRelease.family ||
        newRelease.version <= oldRelease.version
      ) {
        return yield* failure("InvalidJournal");
      }

      if (!isDate(input.effectiveFrom)) return yield* failure("InvalidJournal");

      if (input.effectiveTo !== undefined && !isDate(input.effectiveTo)) {
        return yield* failure("InvalidJournal");
      }

      if (input.effectiveTo !== undefined && input.effectiveTo < input.effectiveFrom) {
        return yield* failure("InvalidJournal");
      }

      const capturedAt = yield* isoNow(transaction);

      const unsealed = yield* toJsonObject({
        id: newId("rule_change_notice"),
        scope: command.scope,
        oldReleaseId: oldRelease.id,
        newReleaseId: newRelease.id,
        oldReleaseChecksum: oldRelease.checksum,
        newReleaseChecksum: newRelease.checksum,
        changeKind: input.changeKind,
        effectiveFrom: input.effectiveFrom,
        effectiveTo: input.effectiveTo ?? null,
        reason: input.reason,
        qualificationEvidence: input.qualificationEvidence,
        changedSelectors: [...input.changedSelectors],
        capturedBy: principal.actorId,
        capturedAt,
      });

      const notice = yield* decode(NoticeSchema, {
        ...unsealed,
        digest: yield* versionedDigest(unsealed),
      });

      yield* Db.insertNotice(transaction, {
        bookId: command.scope.bookId,
        id: notice.id,
        oldReleaseId: oldRelease.id,
        newReleaseId: newRelease.id,
        changeKind: input.changeKind,
        effectiveFrom: input.effectiveFrom,
        effectiveTo: input.effectiveTo ?? null,
        reason: input.reason,
        qualificationEvidence: yield* toJsonObject({ statement: input.qualificationEvidence }),
        changedSelectors: input.changedSelectors,
        capturedBy: principal.actorId,
        capturedAt,
        digest: notice.digest,
        body: yield* toJsonObject(notice),
      });

      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        request.expected,
        "rule_change_notice_record",
        principal.actorId,
        notice,
      );

      return notice;
    },
    "update",
  );
});

export const captureImpact = Effect.fn("ruleImpact.captureImpact")(function* (
  token: string,
  command: {
    scope: Scope;
    idempotencyKey: string;
    noticeId: string;
    periodFrom: string;
    periodTo: string;
  },
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (transaction, principal) {
      const payload = yield* toJsonObject({
        noticeId: command.noticeId,
        periodFrom: command.periodFrom,
        periodTo: command.periodTo,
      });

      const request = yield* replay(
        transaction,
        command.scope,
        command.idempotencyKey,
        "rule_impact_capture",
        principal.actorId,
        payload,
        HeaderSchema,
      );

      if (request.previous) return request.previous;
      yield* requireImpactAccess(transaction, true);

      if (!isDate(command.periodFrom) || !isDate(command.periodTo)) {
        return yield* failure("InvalidJournal");
      }

      if (command.periodTo < command.periodFrom) return yield* failure("InvalidJournal");

      const locked = (yield* Db.lockNotice(transaction, command.scope.bookId, command.noticeId))[0];

      if (!locked) return yield* failure("NotFound");

      const notice = yield* decode(NoticeSchema, locked.body);
      const recordedCutoff = yield* isoNow(transaction);

      const deadlines = yield* Db.selectDeadlineTargets(
        transaction,
        command.scope.bookId,
        notice.oldReleaseId,
        command.periodFrom,
        command.periodTo,
      );

      const activations = yield* Db.selectActivationTargets(
        transaction,
        command.scope.bookId,
        notice.oldReleaseId,
        command.periodFrom,
        command.periodTo,
      );

      if (deadlines.length + activations.length > captureBound) {
        return yield* failure("InvalidJournal");
      }

      const today = recordedCutoff.slice(0, 10);
      const snapshotId = newId("rule_impact_snapshot");
      const total = deadlines.length + activations.length;

      const unsealedHeader = yield* toJsonObject({
        id: snapshotId,
        scope: command.scope,
        noticeId: notice.id,
        recordedCutoff,
        completeTargetMembership: true,
        totalTargets: total,
        decidedTargets: 0,
        continuation: null,
      });

      const header = yield* decode(HeaderSchema, unsealedHeader);

      yield* Db.insertSnapshot(transaction, {
        bookId: command.scope.bookId,
        id: snapshotId,
        noticeId: notice.id,
        recordedCutoff,
        completeTargetMembership: true,
        totalTargets: total,
        body: yield* toJsonObject(header),
      });

      let ordinal = 0;

      for (const row of deadlines) {
        ordinal += 1;

        const executionState = deadlineExecutionState(row.outcomeRecorded, row.outcomeKind);

        const classified = classify(
          notice.changeKind,
          notice.effectiveFrom,
          notice.effectiveTo,
          row.periodStartsOn,
          row.periodEndsOn,
          executionState,
        );

        const basisDigest = yield* versionedDigest(row.statutoryBasis);

        yield* Db.insertTarget(transaction, {
          bookId: command.scope.bookId,
          snapshotId,
          ordinal,
          targetKind: "deadline_obligation",
          targetId: row.targetId,
          targetRevision: row.targetRevision,
          family: row.family,
          periodId: row.periodId,
          periodStartsOn: row.periodStartsOn,
          periodEndsOn: row.periodEndsOn,
          usedRule: row.usedRule,
          basisDigest,
          impactKind: classified.impactKind,
          body: targetBody({
            ordinal,
            targetKind: "deadline_obligation",
            targetId: row.targetId,
            targetRevision: row.targetRevision,
            family: row.family,
            periodId: row.periodId,
            periodStartsOn: row.periodStartsOn,
            periodEndsOn: row.periodEndsOn,
            usedRule: row.usedRule,
            basisDigest,
            impactKind: classified.impactKind,
            executionState,
            suggestedDecision: classified.decision,
          }),
        });
      }

      for (const row of activations) {
        ordinal += 1;

        const executionState =
          row.effectiveFrom <= today ? "activation_effective" : "activation_pending";

        const classified = classify(
          notice.changeKind,
          notice.effectiveFrom,
          notice.effectiveTo,
          row.periodStartsOn,
          row.periodEndsOn,
          executionState,
        );

        yield* Db.insertTarget(transaction, {
          bookId: command.scope.bookId,
          snapshotId,
          ordinal,
          targetKind: "company_activation",
          targetId: row.targetId,
          targetRevision: row.targetRevision,
          family: row.family,
          periodId: null,
          periodStartsOn: row.periodStartsOn,
          periodEndsOn: row.periodEndsOn,
          usedRule: row.usedRule,
          basisDigest: row.digest,
          impactKind: classified.impactKind,
          body: targetBody({
            ordinal,
            targetKind: "company_activation",
            targetId: row.targetId,
            targetRevision: row.targetRevision,
            family: row.family,
            periodId: null,
            periodStartsOn: row.periodStartsOn,
            periodEndsOn: row.periodEndsOn,
            usedRule: row.usedRule,
            basisDigest: row.digest,
            impactKind: classified.impactKind,
            executionState,
            suggestedDecision: classified.decision,
          }),
        });
      }

      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        request.expected,
        "rule_impact_capture",
        principal.actorId,
        header,
      );

      return header;
    },
    "update",
  );
});

export const listImpact = Effect.fn("ruleImpact.listImpact")(function* (
  token: string,
  command: { scope: Scope },
) {
  return yield* withBook(token, command.scope, false, function* (transaction) {
    yield* requireImpactAccess(transaction, false);
    const rows = yield* Db.listSnapshots(transaction, command.scope.bookId);

    return yield* decodeList(
      SnapshotListSchema,
      rows.map((row) => ({
        id: row.id,
        scope: command.scope,
        noticeId: row.noticeId,
        recordedCutoff: row.recordedCutoff,
        completeTargetMembership: row.completeTargetMembership,
        totalTargets: row.totalTargets,
        decidedTargets: Number(row.decidedTargets),
        continuation: null,
      })),
    );
  });
});

export const getImpactSnapshot = Effect.fn("ruleImpact.getSnapshot")(function* (
  token: string,
  command: { scope: Scope; snapshotId: string; after?: string },
) {
  return yield* withBook(token, command.scope, false, function* (transaction) {
    yield* requireImpactAccess(transaction, false);

    const snapshot = (yield* Db.readSnapshot(
      transaction,
      command.scope.bookId,
      command.snapshotId,
    ))[0];

    if (!snapshot) return yield* failure("NotFound");

    const after = command.after === undefined ? 0 : Number(command.after);

    if (!Number.isInteger(after) || after < 0) return yield* failure("InvalidJournal");

    const rows = yield* Db.listTargets(
      transaction,
      command.scope.bookId,
      command.snapshotId,
      after,
      targetPage + 1,
    );

    const page = rows.slice(0, targetPage);
    const more = rows.length > targetPage;

    const decided =
      (yield* Db.countSnapshotDecisions(transaction, command.scope.bookId, command.snapshotId))[0]
        ?.decided ?? 0;

    const targets = yield* Effect.forEach(page, (row) =>
      Effect.gen(function* () {
        const frozen = yield* decode(TargetSchema, row.body);

        return {
          ...frozen,
          decisionKind: row.decisionKind,
          decisionReason: row.decisionReason,
        };
      }),
    );

    const decoded = yield* decodeList(TargetListSchema, targets);

    return yield* decode(SnapshotSchema, {
      id: snapshot.id,
      scope: command.scope,
      noticeId: snapshot.noticeId,
      recordedCutoff: snapshot.recordedCutoff,
      completeTargetMembership: snapshot.completeTargetMembership,
      totalTargets: snapshot.totalTargets,
      decidedTargets: decided,
      targets: decoded,
      continuation: more ? String(page[page.length - 1]?.ordinal ?? after) : null,
    });
  });
});

export const listDecisions = Effect.fn("ruleImpact.listDecisions")(function* (
  token: string,
  command: { scope: Scope; noticeId: string },
) {
  return yield* withBook(token, command.scope, false, function* (transaction) {
    yield* requireImpactAccess(transaction, false);

    if ((yield* Db.readNotice(transaction, command.scope.bookId, command.noticeId)).length === 0) {
      return yield* failure("NotFound");
    }

    const rows = yield* Db.listDecisions(transaction, command.scope.bookId, command.noticeId);

    return yield* decodeList(
      DecisionListSchema,
      rows.map((row) => row.body),
    );
  });
});

export const decideTarget = Effect.fn("ruleImpact.decideTarget")(function* (
  token: string,
  command: {
    scope: Scope;
    idempotencyKey: string;
    snapshotId: string;
    input: typeof Impact.RecordImpactDecision.Type;
  },
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (transaction, principal) {
      const payload = yield* toJsonObject({
        snapshotId: command.snapshotId,
        input: command.input,
      });

      const request = yield* replay(
        transaction,
        command.scope,
        command.idempotencyKey,
        "rule_impact_decision",
        principal.actorId,
        payload,
        DecisionSchema,
      );

      if (request.previous) return request.previous;
      yield* requireImpactAccess(transaction, true);

      const input = command.input;

      const snapshot = (yield* Db.lockSnapshot(
        transaction,
        command.scope.bookId,
        command.snapshotId,
      ))[0];

      if (!snapshot) return yield* failure("NotFound");

      const target = (yield* Db.readTarget(
        transaction,
        command.scope.bookId,
        command.snapshotId,
        input.targetKind,
        input.targetId,
      ))[0];

      if (!target || target.targetRevision !== input.targetRevision) {
        return yield* failure("StaleDependency");
      }

      const notice = yield* decode(
        NoticeSchema,
        (yield* Db.lockNotice(transaction, command.scope.bookId, snapshot.noticeId))[0]!.body,
      );

      const frozen = yield* decode(TargetSchema, target.body);

      const classified = classify(
        notice.changeKind,
        notice.effectiveFrom,
        notice.effectiveTo,
        target.periodStartsOn,
        target.periodEndsOn,
        frozen.executionState,
      );

      // A recorded decision may follow the analysis or escalate it, never narrow it.
      if (input.decisionKind !== classified.decision && input.decisionKind !== "human_review") {
        return yield* failure("InvalidJournal");
      }

      if ((input.decisionKind === "amend") !== (input.proposedSuccessor !== undefined)) {
        return yield* failure("InvalidJournal");
      }

      const successor =
        input.proposedSuccessor === undefined
          ? null
          : yield* decode(SuccessorSchema, input.proposedSuccessor);

      if (successor !== null) {
        if (!isDate(successor.dueAt) || successor.basis.periodId !== successor.periodId) {
          return yield* failure("InvalidJournal");
        }

        if (frozen.periodId !== null && frozen.periodId === successor.periodId) {
          return yield* failure("InvalidJournal");
        }
      }

      const existing = (yield* Db.readDecisionCase(
        transaction,
        command.scope.bookId,
        notice.id,
        input.targetKind,
        input.targetId,
        input.targetRevision,
      ))[0];

      // A restart converges on the recorded case instead of opening a second one.
      if (existing) {
        return yield* decode(
          DecisionSchema,
          (yield* Db.readDecision(transaction, command.scope.bookId, existing.id))[0]!.body,
        );
      }

      const recordedAt = yield* isoNow(transaction);

      const unsealed = yield* toJsonObject({
        id: newId("rule_impact_decision"),
        scope: command.scope,
        snapshotId: command.snapshotId,
        noticeId: notice.id,
        targetKind: input.targetKind,
        targetId: input.targetId,
        targetRevision: input.targetRevision,
        decisionKind: input.decisionKind,
        reason: input.reason,
        evidence: input.evidence,
        proposedSuccessor: successor,
        reviewer: principal.actorId,
        recordedAt,
      });

      const decision = yield* decode(DecisionSchema, {
        ...unsealed,
        digest: yield* versionedDigest(unsealed),
      });

      yield* Db.insertDecision(transaction, {
        bookId: command.scope.bookId,
        id: decision.id,
        snapshotId: command.snapshotId,
        noticeId: notice.id,
        targetKind: input.targetKind,
        targetId: input.targetId,
        targetRevision: input.targetRevision,
        decisionKind: input.decisionKind,
        reason: input.reason,
        evidence: yield* toJsonObject({ statement: input.evidence }),
        proposedSuccessor: successor === null ? null : yield* toJsonObject(successor),
        reviewer: principal.actorId,
        recordedAt,
        digest: decision.digest,
        body: yield* toJsonObject(decision),
      });

      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        request.expected,
        "rule_impact_decision",
        principal.actorId,
        decision,
      );

      return decision;
    },
    "update",
  );
});
