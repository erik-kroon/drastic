import * as Context from "@open-erp/domain/agent-context";
import * as Workspace from "@open-erp/contracts/workspace";
import { Capabilities } from "@open-erp/contracts/capabilities";
import { AccountingError, FailureCode } from "@open-erp/domain/errors";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as WorkspaceDb from "../../db/workspace";
import * as ContextDb from "../../db/agent-context";
import * as PostingDb from "../../db/posting";
import type { Transaction } from "../../db/transaction";
import {
  decode,
  requireTableAccess,
  toJsonObject,
  withBook,
  type Scope,
} from "../commerce/support";
import { digest, isoNow } from "../posting";
import { failure } from "../failures";

type Refusal = { readonly code: Context.ContextFailureCode; readonly message: string };

type PublicFailureCode = typeof FailureCode.Type;

const refusals = {
  ScopeFingerprintChanged: "StaleDependency",
  ContextVersionMismatch: "StaleDependency",
  GoalSemanticsMismatch: "InvalidJournal",
  UnavailableAsZero: "InvalidJournal",
  IncompleteCoverageClaimed: "InvalidJournal",
  BlockerHidden: "InvalidJournal",
  EffectsMerged: "InvalidJournal",
  ApprovalForged: "InvalidJournal",
} satisfies Record<Context.ContextFailureCode, PublicFailureCode>;

function refuse(outcome: Refusal): Effect.Effect<never, AccountingError> {
  return Effect.fail(
    new AccountingError({ code: refusals[outcome.code], message: outcome.message }),
  );
}

const inventoryBound = 50;

function bounded<T>(rows: ReadonlyArray<T>, what: string) {
  if (rows.length > inventoryBound) {
    return {
      ok: false as const,
      refusal: {
        code: "UnsupportedProfile",
        message: `More than ${inventoryBound} ${what} are retained; this read does not page an index.`,
      } satisfies { readonly code: PublicFailureCode; readonly message: string },
    };
  }

  return { ok: true as const, rows };
}

type AttentionRow = WorkspaceDb.AttentionItemRow;

type JournalRow = WorkspaceDb.WorkItemRow;

function journalVocabulary() {
  return {
    blockedOperation: "changes_execute",
    missingInputs: ["approval", "execution"],
    nextPermittedPreparation: "approve_change_set",
  };
}

function reviewVocabulary(reason: string) {
  if (reason === "invoice_draft") {
    return {
      blockedOperation: null,
      missingInputs: ["issue_decision"],
      nextPermittedPreparation: "issue_invoice",
    };
  }

  return {
    blockedOperation: null,
    missingInputs: ["review_decision"],
    nextPermittedPreparation: "submit_expense_review",
  };
}

function deriveModuleSummaries(
  kinds: ReadonlyArray<string>,
  rows: ReadonlyArray<AttentionRow>,
): Array<Context.ModuleSummary> {
  return kinds.map((kind) => {
    const covered = rows.filter((row) => row.kind === kind);

    return {
      owner: kind,
      status: "available",
      rowCount: String(covered.filter((row) => row.state === "open").length),
      fullCount: String(covered.length),
      hasContinuation: false,
      coverageKnown: true,
      ownerVersion: null,
    } satisfies Context.ModuleSummary;
  });
}

function incompleteFacts(): Context.Checked<never> {
  return Result.fail({
    code: "IncompleteCoverageClaimed",
    message:
      "A retained work row has unsupported revision or digest facts, so the index is not complete.",
  });
}

function workRefOfReview(
  item: AttentionRow,
  now: string,
): Context.Checked<Context.WorkRef | "journal" | null> {
  if (item.state !== "open") return Result.succeed(null);

  if (item.kind === "journal") return Result.succeed("journal");

  if (item.kind !== "invoice" && item.kind !== "expense") return incompleteFacts();

  const ownerVersion = item.sourceRevision;
  const ownerDigest = item.revision;

  if (
    !Schema.is(Workspace.AgentContextWorkRef.fields.revision)(ownerVersion) ||
    !Schema.is(Workspace.AgentContextWorkRef.fields.digest)(ownerDigest) ||
    ownerVersion === "0" ||
    BigInt(ownerVersion) > (item.kind === "invoice" ? 50n : 20n)
  )
    return incompleteFacts();

  const vocabulary = reviewVocabulary(item.reason);
  const overdue = item.assignmentDueOn !== null && item.assignmentDueOn < now;

  return Result.succeed({
    owner: item.kind,
    identity: item.id,
    revision: ownerVersion,
    kind: `${item.kind}_review`,
    severity: overdue ? "blocks_goal" : "material",
    affectedPeriod: null,
    blockedOperation: vocabulary.blockedOperation,
    missingInputs: [...vocabulary.missingInputs],
    nextPermittedPreparation: vocabulary.nextPermittedPreparation,
    immutableRef: item.id,
    digest: ownerDigest,
  });
}

function deriveWorkRefs(
  journals: ReadonlyArray<JournalRow>,
  reviews: ReadonlyArray<AttentionRow>,
  closedPeriods: ReadonlySet<string>,
  now: string,
): Context.Checked<Array<Context.WorkRef>> {
  const work: Array<Context.WorkRef> = [];

  for (const item of journals) {
    if (item.postingStatus !== "unposted_at_check") continue;

    const blocked = item.periodId !== null && closedPeriods.has(item.periodId);

    if (item.planVersion === null) {
      return Result.fail({
        code: "IncompleteCoverageClaimed",
        message: "A retained change-set carries no plan version, so its revision is unknown.",
      });
    }

    work.push({
      owner: "change_sets",
      identity: item.id,
      revision: item.planVersion,
      kind: "unposted_change_set",
      severity: blocked ? "blocks_goal" : "material",
      affectedPeriod: item.periodId,
      blockedOperation: journalVocabulary().blockedOperation,
      missingInputs: [...journalVocabulary().missingInputs],
      nextPermittedPreparation: journalVocabulary().nextPermittedPreparation,
      immutableRef: item.id,
      digest: item.revision,
    });
  }

  for (const item of reviews) {
    const checked = workRefOfReview(item, now);

    if (Result.isFailure(checked)) return Result.fail(checked.failure);

    const ref = checked.success;

    if (ref !== null && ref !== "journal") work.push(ref);
  }

  return Result.succeed(work);
}

function readClosedPeriods(transaction: Transaction, bookId: string, now: string) {
  return Effect.gen(function* () {
    const periods = yield* PostingDb.readAllPeriods(transaction, bookId);

    return new Set(
      periods
        .filter((period) => period.endsOn !== null && period.endsOn < now.slice(0, 10))
        .map((period) => period.id),
    );
  });
}

function registeredCapabilities() {
  return Object.keys(Capabilities);
}

export const getBookContext = Effect.fn("agent.getBookContext")(function* (
  token: string,
  command: {
    readonly scope: Scope;
    readonly input: typeof Workspace.AgentContextQuery.Type;
  },
) {
  return yield* withBook(token, command.scope, false, function* (transaction, principal) {
    yield* requireTableAccess(transaction, [...WorkspaceDb.workspaceTables], false);

    const period =
      command.input.period === null
        ? null
        : (yield* WorkspaceDb.readPeriod(
            transaction,
            command.scope.bookId,
            command.input.period,
          ))[0];

    if (period === undefined) return yield* failure("NotFound");

    const attention = yield* WorkspaceDb.listAttentionItems(
      transaction,
      command.scope.bookId,
      {
        kind: "all",
        period: command.input.period,
        status: "all",
        sort: "oldest",
        search: "",
        after: null,
      },
      period === null ? null : period.startsOn,
      period === null ? null : period.endsOn,
    );

    const attentionBound = bounded(attention, "attention rows");

    if (!attentionBound.ok) {
      return yield* Effect.fail(
        new AccountingError({
          code: attentionBound.refusal.code,
          message: attentionBound.refusal.message,
        }),
      );
    }

    const journals = yield* WorkspaceDb.listWorkItems(transaction, command.scope.bookId, {
      period: command.input.period,
      status: "all",
      sort: "oldest",
      search: "",
      anchor: null,
    });

    const journalsBound = bounded(journals, "work rows");

    if (!journalsBound.ok) {
      return yield* Effect.fail(
        new AccountingError({
          code: journalsBound.refusal.code,
          message: journalsBound.refusal.message,
        }),
      );
    }

    const now = yield* isoNow(transaction);
    const kinds = [...new Set(attention.map((row) => row.kind))].sort();

    const modules = deriveModuleSummaries(kinds, attention);

    for (const module of modules) {
      const checked = Context.assertModuleCompleteness(module);

      if (Result.isFailure(checked)) return yield* refuse(checked.failure);
    }

    const closed = yield* readClosedPeriods(transaction, command.scope.bookId, now);
    const derived = deriveWorkRefs(journals, attention, closed, now);

    if (Result.isFailure(derived)) return yield* refuse(derived.failure);

    const work = derived.success;

    const boundary = (yield* ContextDb.readLedgerBoundary(transaction, command.scope.bookId))[0];

    const fingerprint = yield* digest({
      actorId: principal.actorId,
      entityId: command.scope.entityId,
      bookId: command.scope.bookId,
    });

    const snapshot = {
      id: `book_context_${fingerprint.slice(7, 23)}`,
      principalScopeFingerprint: fingerprint,
      bookId: command.scope.bookId,
      goal: command.input.goal,
      recordedCutoff: now,
      ledgerBoundary: `sequence_${boundary?.boundary ?? "0"}`,
      contextVersion: "1",
      modules,
      work,
      allowedCapabilities: registeredCapabilities(),
    };

    const contentDigest = yield* digest({ ...snapshot, recordedCutoff: now });

    const ranked = Context.rankWork({
      snapshot: { ...snapshot, contentDigest },
      goal: command.input.goal,
      period: command.input.period,
      deadlineUrgency: work
        .filter((entry) => entry.severity === "blocks_goal")
        .map((entry, index) => ({ identity: entry.identity, dueRank: String(index + 1) })),
    });

    if (Result.isFailure(ranked)) return yield* refuse(ranked.failure);

    return yield* decode(
      Workspace.BookContextView,
      yield* toJsonObject({
        scope: command.scope,
        snapshot: { ...snapshot, contentDigest },
        ranked: ranked.success,
      }),
    );
  });
});
