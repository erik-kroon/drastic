import * as Context from "@open-erp/domain/agent-context";
import * as Workspace from "@open-erp/contracts/workspace";
import { Capabilities } from "@open-erp/contracts/capabilities";
import { AccountingError, FailureCode } from "@open-erp/domain/errors";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
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

// NEXT-50. The read-only owner of an agent's book context.
//
// Three responsibilities and nothing else:
//   * derive one module summary per retained work domain from bounded reads,
//     so a module reporting nothing is either known empty or refused;
//   * derive one work row per retained unresolved item, with its severity read
//     from retained state rather than asserted by the caller;
//   * rank those rows for the caller's stated goal and seal the snapshot.
//
// The pure rules are in @open-erp/domain/agent-context: module completeness,
// goal-bound ranking with collapsed blockers, and scope-fenced deltas. This
// module owns the transaction, the mapping from a domain refusal to the public
// error family, and nothing about what an agent should do next.
//
// A severity is a retained-state fact, not an opinion:
//   * an item whose retained due moment already passed, or whose accounting
//     period already ended while it is still unposted, blocks the goal;
//   * every other retained unresolved item is material.
// Nothing retained and unresolved is routine, and nothing absent is zero.

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

// One already-admitted read returns at most 51 rows, and the 51st means there
// are more. A context that silently covered a partial inventory would report an
// unknown as complete, so a fuller inventory refuses instead of paging.
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

// The attention row is the existing workspace owner's type, reused rather than
// redeclared, so a new attention column cannot silently drift out of the index.
type AttentionRow = WorkspaceDb.AttentionItemRow;

type JournalRow = WorkspaceDb.WorkItemRow;

// The operational vocabulary of one retained unresolved item, read from the
// attention `reason` the existing workspace owner already records. It names
// what is blocked, what is still missing and which named operation runs next,
// so a ranked question always points at a real next step.
// A blocked operation names a registered capability an agent could call, because
// rankWork only ranks work its snapshot authorizes. An unposted change-set is
// unblocked by execution, so it names `changes_execute`. A review has no
// registered capability that would unblock it, so it names none rather than
// inventing one; the next human step is still recorded as preparation.
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

// One module summary per work domain the inventory covers. `rowCount` is the
// retained unresolved rows, `fullCount` is the retained rows, and coverage is
// known because the same bounded read produced both.
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

// Every retained unresolved shape the index knows is listed here. An item of
// an unknown shape refuses the whole index rather than entering under a
// guessed identity, and rather than being silently dropped while the index
// claims to be complete.
function workRefOfReview(item: AttentionRow, now: string): Context.WorkRef | "journal" | null {
  if (item.state !== "open") return null;

  // Journal proposals are indexed from the change-set source, not from the
  // attention read that also carries them. Any other unrecognized open shape
  // is unclassifiable rather than silently dropped.
  if (item.kind === "journal") return "journal";

  if (item.kind !== "invoice" && item.kind !== "expense") return null;

  const vocabulary = reviewVocabulary(item.reason);
  const overdue = item.assignmentDueOn !== null && item.assignmentDueOn < now;

  return {
    owner: item.kind,
    identity: item.id,
    revision: item.revision,
    kind: `${item.kind}_review`,
    severity: overdue ? "blocks_goal" : "material",
    affectedPeriod: null,
    blockedOperation: vocabulary.blockedOperation,
    missingInputs: [...vocabulary.missingInputs],
    nextPermittedPreparation: vocabulary.nextPermittedPreparation,
    immutableRef: item.id,
    digest: item.revision,
  };
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

    // The revision is the retained plan version, not the digest: the digest
    // is the content hash, and the two change independently.
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
    const ref = workRefOfReview(item, now);

    if (ref === null && item.state === "open") {
      return Result.fail({
        code: "IncompleteCoverageClaimed",
        message: `A retained ${item.kind} row cannot be classified, so the index is not complete.`,
      });
    }

    if (ref !== null && ref !== "journal") work.push(ref);
  }

  return Result.succeed(work);
}

// The accounting periods that already ended. An unposted item in one of them
// can no longer be posted in its own period, which is what makes it block the
// goal rather than merely waiting its turn.
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

// The server capability catalog is build configuration, not retained data: no
// per-actor capability grant table exists. The index therefore lists the
// capabilities this server build exposes, and says so.
function registeredCapabilities() {
  return Object.keys(Capabilities);
}

// The book context for one stated goal. Every identity, revision, amount of
// work and capability below comes from retained rows or the registered catalog;
// the caller supplies only the goal and the optional period filter.
export const getBookContext = Effect.fn("agent.getBookContext")(function* (
  token: string,
  command: {
    readonly scope: Scope;
    readonly input: typeof Workspace.AgentContextQuery.Type;
  },
) {
  return yield* withBook(token, command.scope, false, function* (transaction, principal) {
    yield* requireTableAccess(transaction, [...WorkspaceDb.workspaceTables], false);

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
      null,
      null,
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
