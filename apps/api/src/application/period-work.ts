// NEXT-16: the period-work application owner.
//
// Evidence-aware period preparation over the operations that already own each
// economic effect. This owner posts nothing itself. It freezes a selection,
// routes each child to the operation that already owns that effect, records
// exactly what happened, and presents a fixed manifest for one human approval.
//
// The rules that shape every operation here:
//
//   - A queue claim belongs to effect-mq. A child revision fence is what stops a
//     redelivered handler publishing a result twice, and the fence is a database
//     column compared in the UPDATE's WHERE clause, not an in-memory flag.
//   - The owning prepare and execute operations are called OUTSIDE any
//     transaction this owner holds. They open their own, so holding one here
//     would nest a second financial transaction, which the repository forbids.
//     A child is therefore claimed in one short transaction and checkpointed in
//     another, and a crash between them is repaired by the stable command key.
//   - A batch approval covers exactly the sealed members it lists. It never
//     covers a later arrival, and it is never an ordinary-agent power.
//   - A child whose financial effect depends on an unknown predecessor cannot
//     enter a preapproved batch. It is prepared after the predecessor commits.
//   - A cancellation after preparation keeps the prepared plan as retained
//     evidence but prevents the stale handler publishing new work.

import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import * as PeriodWork from "@open-erp/domain/period-work";
import { Digest, Identifier } from "@open-erp/contracts/accounting";

import type { Transaction } from "../db/connection";
import * as Db from "../db/period-work";
import { databaseFailure, withTransaction } from "../db/transaction";
import { failure } from "./failures";
import { admitRunnerActor } from "./preparation-jobs";
import { approveChangeInTransaction, digest, replay, saveCommand } from "./posting";
import { prepareInvoiceIssue } from "./commerce/invoice-lifecycle";
import { executeInvoiceIssue } from "./commerce/invoice-lifecycle";
import { prepareSupplierAcceptance, executeSupplierAcceptance } from "./purchases/acceptance";
import { prepareSupplierCredit, executeSupplierCredit } from "./purchases/credits";
import { prepareOwnerOperation, executeOwnerOperation } from "./subledger/owner-operations";
import {
  decode,
  toJsonObject,
  unsupported,
  withBook,
  type JsonObject,
  type Scope as BookScope,
} from "./commerce/support";

const operationFor = {
  prepare: "prepare_period_work_manifest",
  advance: "advance_period_work",
  seal: "prepare_period_work_batch",
  approve: "approve_period_work_batch",
  execute: "execute_period_work_batch",
} as const;

const maximumChildren = PeriodWork.periodWorkBoundary.maximumChildren;

const maximumMembers = PeriodWork.periodWorkBoundary.maximumMembers;

const maximumBoundedCount = 50;

const minorCeiling = 10n ** 38n;

/**
 * The released operations this run may dispatch to. Every entry is a real named
 * operation in this repository; a route with no entry becomes a review case
 * naming the gap rather than a dispatch to an absent owner.
 *
 * A period child carries no financial inputs, so the exact reviewed command is
 * sealed in the manifest as `prepareInput` and passed through untouched. Nothing
 * here fills in an account, a date, a rate or an amount.
 */
const prepareOwners = {
  "purchases.recognition": prepareSupplierAcceptance,
  "purchases.credits": prepareSupplierCredit,
  "owner.operations": prepareOwnerOperation,
  "commerce.invoice": prepareInvoiceIssue,
} as const;

const executeOwners = {
  "purchases.recognition": executeSupplierAcceptance,
  "purchases.credits": executeSupplierCredit,
  "owner.operations": executeOwnerOperation,
  "commerce.invoice": executeInvoiceIssue,
} as const;

type OwnerName = keyof typeof prepareOwners;

const isOwnerName = (value: string): value is OwnerName => value in prepareOwners;

const compare = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);

const isJsonObject = (value: Schema.Json): value is Schema.JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// Every released prepare operation returns a review that names the sealed plan it
// created. Parsing that shape here is the boundary: a review this owner does not
// recognise refuses rather than being read by property access.
const PreparedReview = Schema.Struct({
  id: Identifier,
  digest: Digest,
  postingPlan: Schema.Struct({ id: Identifier, planDigest: Digest }),
});

// Every released execute operation returns an economic receipt with its own
// identity. The receipt is what the child records, so it is parsed rather than
// picked apart.
const OwnerReceipt = Schema.Struct({ id: Identifier });

/** Access. The insert privilege is asked for on the writable set only. */
function requireAccess(transaction: Transaction, write: boolean) {
  return Db.readPeriodWorkAccess(transaction).pipe(
    Effect.flatMap((rows) => {
      if (rows.length !== Db.periodWorkTables.length) return unsupported();

      const denied = rows.some((row) => {
        if (!row.canSelect) return true;

        return write && Db.isPeriodWorkWritable(row.tableName) && !row.canInsert;
      });

      return denied ? unsupported() : Effect.void;
    }),
  );
}

/**
 * The manifest identity is derived from the book, the interval and the cutoff,
 * never from a clock or an attempt counter, so re-preparing the same request
 * lands on the same immutable manifest instead of forking a second one.
 */
function manifestIdFor(bookId: string, startsOn: string, cutoff: string): string {
  return derivedId("period_work_manifest", `${bookId}|${startsOn}|${cutoff}`);
}

/**
 * The batch identity is derived from its exact ordered member list, so the same
 * selection seals the same batch and any different selection is a different one.
 */
function batchIdFor(
  bookId: string,
  manifestId: string,
  members: ReadonlyArray<PeriodWork.BatchMember>,
) {
  const key = members
    .map((member) => `${member.workIdentity}:${member.owner}:${member.planId}`)
    .join("|");

  return derivedId("period_work_batch", `${bookId}|${manifestId}|${key}`);
}

function derivedId(prefix: string, key: string): string {
  let hash = 2166136261;

  for (const character of key) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619) >>> 0;
  }

  return `${prefix}_${hash.toString(16).padStart(8, "0").repeat(4)}`;
}

function nextRevision(revision: string) {
  const next = BigInt(revision) + 1n;

  return next >= 1000000000n ? failure("UnsupportedProfile") : next.toString();
}

/** A review case records the exact facts a human must supply. It is never empty
 * and it never stands in for silence. */
function missingFactsOf(facts: ReadonlyArray<string>): JsonObject | null {
  return facts.length === 0 ? null : { facts: [...facts] };
}

function readMissingFacts(value: JsonObject | null): ReadonlyArray<string> | undefined {
  if (value === null) return undefined;

  const facts = value["facts"];

  return Array.isArray(facts)
    ? facts.filter((fact): fact is string => typeof fact === "string")
    : undefined;
}

/**
 * Freeze the selection for one requested interval.
 *
 * The children and the rules are computed by the caller from one consistent
 * capture and handed in as reviewed input. This operation does not read sources
 * itself, because a selection and a capture must not be two different
 * snapshots. Membership is frozen here: a source that arrives after this returns
 * is not in it, and selecting it needs a new manifest.
 */
export const preparePeriodWorkManifest = Effect.fn("periodWork.prepareManifest")(function* (
  token: string,
  command: {
    scope: BookScope;
    idempotencyKey: string;
    input: {
      startsOn: string;
      endsOn: string;
      cutoff: string;
      children: ReadonlyArray<PeriodWork.WorkChild>;
      rules: ReadonlyArray<PeriodWork.PreparationRule>;
      populationComplete: boolean;
      excluded: ReadonlyArray<{ sourceId: string; reason: string }>;
    };
  },
) {
  if (command.input.startsOn > command.input.endsOn) return yield* failure("InvalidJournal");
  // The cutoff is when the selection was captured, so it cannot precede the
  // interval the work covers. A cutoff inside the interval is a different
  // capture and therefore a different manifest.

  if (command.input.cutoff < command.input.endsOn) return yield* failure("InvalidJournal");

  if (command.input.children.length > maximumChildren) return yield* failure("UnsupportedProfile");

  if (command.input.rules.length > PeriodWork.periodWorkBoundary.maximumRules) {
    return yield* failure("UnsupportedProfile");
  }

  if (command.input.excluded.length > PeriodWork.periodWorkBoundary.maximumExcluded) {
    return yield* failure("UnsupportedProfile");
  }

  const children = [...command.input.children].sort((left, right) =>
    compare(left.workIdentity, right.workIdentity),
  );

  const workIdentities = new Set<string>();
  const economicIdentities = new Set<string>();

  for (const child of children) {
    // Two children of one economic identity would let one gesture cover a
    // duplicate effect, and the frozen selection must not contain one.
    if (workIdentities.has(child.workIdentity)) return yield* failure("InvalidJournal");

    if (economicIdentities.has(child.economicIdentity)) return yield* failure("InvalidJournal");

    if (
      child.prepareInput !== undefined &&
      (child.intendedOwner === undefined || !isOwnerName(child.intendedOwner))
    ) {
      return yield* failure("InvalidJournal");
    }

    if (child.existingMatches.length > PeriodWork.periodWorkBoundary.maximumMatchesPerChild) {
      return yield* failure("UnsupportedProfile");
    }

    if (child.dependsOn.length > PeriodWork.periodWorkBoundary.maximumDependencies) {
      return yield* failure("UnsupportedProfile");
    }

    workIdentities.add(child.workIdentity);
    economicIdentities.add(child.economicIdentity);
  }

  for (const child of children) {
    // A child cannot depend on itself, and its predecessors must be inside the
    // same frozen selection: a predecessor outside the manifest could never
    // commit, so the child would wait forever.
    for (const dependency of child.dependsOn) {
      if (!workIdentities.has(dependency)) return yield* failure("InvalidJournal");
    }
  }

  const manifestId = manifestIdFor(
    command.scope.bookId,
    command.input.startsOn,
    command.input.cutoff,
  );

  return yield* withBook(
    token,
    command.scope,
    true,
    function* (transaction, principal) {
      const request = yield* replay(
        transaction,
        command.scope,
        command.idempotencyKey,
        operationFor.prepare,
        principal.actorId,
        yield* toJsonObject({
          startsOn: command.input.startsOn,
          endsOn: command.input.endsOn,
          cutoff: command.input.cutoff,
          manifestId,
          populationComplete: command.input.populationComplete,
        }),
        PeriodWork.PeriodWorkManifest,
      );

      if (request.previous) return request.previous;

      yield* requireAccess(transaction, true);

      const bodyJson = yield* toJsonObject({
        scope: command.scope,
        requestedInterval: {
          startsOn: command.input.startsOn,
          endsOn: command.input.endsOn,
        },
        cutoff: command.input.cutoff,
        sourceCoverage: {
          populationComplete: command.input.populationComplete,
          selectedCount: children.length,
          excluded: [...command.input.excluded].sort((left, right) =>
            compare(left.sourceId, right.sourceId),
          ),
        },
        children,
        // The rules in force at the cutoff are part of the same capture, so they
        // are sealed with the selection. A rule that changes later produces a
        // new manifest rather than re-deciding a frozen child.
        rules: command.input.rules,
      });

      const manifestJson = { ...bodyJson, digest: yield* digest(bodyJson) };
      const manifest = yield* decode(PeriodWork.PeriodWorkManifest, manifestJson);

      yield* Db.insertManifest(transaction, {
        bookId: command.scope.bookId,
        id: manifestId,
        startsOn: command.input.startsOn,
        endsOn: command.input.endsOn,
        cutoff: command.input.cutoff,
        populationComplete: command.input.populationComplete,
        selectedCount: children.length,
        body: manifestJson,
        digest: manifest.digest,
      });

      yield* Db.insertChildren(
        transaction,
        children.map((child) => ({
          bookId: command.scope.bookId,
          workIdentity: child.workIdentity,
          manifestId,
          economicIdentity: child.economicIdentity,
          sourceRevision: child.sourceRevision,
        })),
      );

      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        request.expected,
        operationFor.prepare,
        principal.actorId,
        manifestJson,
      );

      return manifest;
    },
    "update",
  );
});

/**
 * Advance the run.
 *
 * This is the operation the effect-mq Bun handler calls. It visits a bounded
 * number of children in a fixed order and each child is handled in three short
 * transactions with the owning prepare operation between them, exactly as the
 * packet requires:
 *
 *   1. claim: read the manifest, the child and its current dependencies, and
 *      record the decision. No lock is held afterwards.
 *   2. prepare: call the owning public prepare operation. It opens its own
 *      transaction, so this owner holds none while it runs.
 *   3. checkpoint: in a new short transaction, re-read the child, recheck the
 *      revision and cancellation version the claim observed, and persist the
 *      plan reference and the child state together.
 *
 * A crash between 2 and 3 is repaired by the stable command key: the next pass
 * calls the same command and recovers the same review instead of minting a
 * second one.
 */
export const advancePeriodWork = Effect.fn("periodWork.advance")(function* (
  token: string,
  command: { scope: BookScope; manifestId: string; boundedCount: number },
) {
  if (
    !Number.isInteger(command.boundedCount) ||
    command.boundedCount < 1 ||
    command.boundedCount > maximumBoundedCount
  ) {
    return yield* failure("InvalidJournal");
  }

  const queue: Array<{ workIdentity: string; owner: OwnerName; input: JsonObject; key: string }> =
    [];

  yield* withBook(
    token,
    command.scope,
    true,
    function* (transaction) {
      yield* requireAccess(transaction, true);

      const manifest = (yield* Db.readManifest(
        transaction,
        command.scope.bookId,
        command.manifestId,
      ))[0];

      if (manifest === undefined) return yield* failure("NotFound");

      const manifestBody = yield* decode(PeriodWork.PeriodWorkManifest, manifest.body);

      const children = yield* Db.readChildren(
        transaction,
        command.scope.bookId,
        command.manifestId,
      );

      if (children.length === 0) return yield* failure("NotFound");

      const frozen = new Map(manifestBody.children.map((child) => [child.workIdentity, child]));
      const rows = new Map(children.map((row) => [row.workIdentity, row]));

      // The current obligations are re-read here, in this transaction, so a
      // decision is made against current state and not against the frozen
      // selection alone. One bounded set, not a lookup per child.
      const obligations = yield* Db.readRecognizedObligations(
        transaction,
        command.scope.bookId,
        children.map((row) => row.economicIdentity),
      );

      const recognized = new Map(obligations.map((row) => [row.economicIdentity, row]));

      for (const row of children.slice(0, command.boundedCount)) {
        const child = frozen.get(row.workIdentity);

        if (child === undefined) return yield* failure("StaleDependency");

        const observed = { revision: row.revision, cancelVersion: row.cancelVersion };
        const claim = decideChild(row, child, recognized, rows, manifestBody.rules);

        if (claim.dispatch === undefined) {
          if (claim.state === row.state) continue;

          yield* Db.advanceChild(
            transaction,
            {
              bookId: command.scope.bookId,
              workIdentity: row.workIdentity,
              state: claim.state,
              revision: yield* nextRevision(row.revision),
              cancelVersion: row.cancelVersion,
              planId: row.planId,
              planDigest: row.planDigest,
              receiptId: row.receiptId,
              missingFacts: missingFactsOf(claim.missingFacts),
              refusalReason: claim.refusalReason ?? null,
              batchId: row.batchId,
              routedOwner: row.routedOwner,
              ownerReviewId: row.ownerReviewId,
              ownerReviewDigest: row.ownerReviewDigest,
            },
            observed,
          );

          continue;
        }

        queue.push({
          workIdentity: row.workIdentity,
          owner: claim.dispatch.owner,
          input: claim.dispatch.input,
          key: PeriodWork.childCommandKey(command.manifestId, child),
        });
      }
    },
    "update",
  );

  // The owning prepare operation runs here, with no transaction held by this
  // owner. It opens its own.
  for (const item of queue) {
    const plan = planIdentityOf(
      yield* prepareOwners[item.owner](token, {
        scope: command.scope,
        idempotencyKey: item.key,
        input: item.input,
      }),
    );

    yield* withBook(
      token,
      command.scope,
      true,
      function* (transaction) {
        yield* requireAccess(transaction, true);

        const row = (yield* Db.readChild(transaction, command.scope.bookId, item.workIdentity))[0];

        if (row === undefined) return yield* failure("StaleDependency");

        // Recheck the fence the claim observed. A cancellation that landed while
        // the owner was preparing keeps the prepared plan as retained evidence
        // and stops this stale handler publishing it as runnable work.
        const applied = yield* Db.advanceChild(
          transaction,
          {
            bookId: command.scope.bookId,
            workIdentity: item.workIdentity,
            state: "prepared",
            revision: yield* nextRevision(row.revision),
            cancelVersion: row.cancelVersion,
            planId: plan.id,
            planDigest: plan.digest,
            receiptId: null,
            missingFacts: null,
            refusalReason: null,
            batchId: row.batchId,
            routedOwner: item.owner,
            ownerReviewId: plan.reviewId,
            ownerReviewDigest: plan.reviewDigest,
          },
          { revision: row.revision, cancelVersion: row.cancelVersion },
        );

        if (applied.length === 0) return yield* failure("StaleDependency");
      },
      "update",
    );
  }

  return yield* readPeriodWorkProgress(token, command.scope, command.manifestId);
});

type Claim = {
  readonly state: PeriodWork.WorkChildState;
  readonly missingFacts: ReadonlyArray<string>;
  readonly refusalReason?: string;
  readonly dispatch?: { readonly owner: OwnerName; readonly input: JsonObject };
};

/**
 * The decision for one child, from the current state rather than from the frozen
 * selection alone. The order of the tests is the packet's order and is
 * load-bearing: a payment observation is resolved against an existing
 * obligation before anything else is considered.
 */
function decideChild(
  row: Db.ChildRow,
  child: PeriodWork.WorkChild,
  recognized: ReadonlyMap<string, Db.RecognizedObligation>,
  rows: ReadonlyMap<string, Db.ChildRow>,
  rules: ReadonlyArray<PeriodWork.PreparationRule>,
): Claim {
  const state = row.state;

  // A terminal state is final. A redelivered queue message must not reopen a
  // prepared, committed, recovered or refused child.
  if (state !== "pending" && state !== "waiting_predecessor" && state !== "needs_review") {
    return { state, missingFacts: [] };
  }

  const obligation = recognized.get(child.economicIdentity);

  const decision = PeriodWork.routeWork(child, rules, {
    ownerPaidExpenseIsUnrecognized:
      child.documentClass === "owner_expense" && obligation === undefined,
    sourceRevisesRecognizedFacts:
      obligation !== undefined && child.documentClass === "domestic_credit_note",
    invoiceEntityIsKnown: true,
    committedPurchaseExists: obligation !== undefined,
  });

  if (decision.failure !== undefined) {
    return {
      state: "needs_review",
      missingFacts: PeriodWork.boundedMissingFacts([
        ...decision.missingFacts,
        `routing_failure:${decision.failure}`,
      ]),
    };
  }

  // A child that depends on an uncommitted predecessor is neither a review case
  // nor a refusal. It waits, and the run continues with independent children.
  const uncommitted = child.dependsOn.filter((dependency) => {
    const predecessor = rows.get(dependency);

    return (
      predecessor !== undefined &&
      predecessor.state !== "committed" &&
      predecessor.state !== "recovered"
    );
  });

  if (uncommitted.length > 0) {
    return {
      state: "waiting_predecessor",
      missingFacts: PeriodWork.boundedMissingFacts(
        uncommitted.map((dependency) => `uncommitted_predecessor:${dependency}`),
      ),
    };
  }

  const owner = PeriodWork.ownerForTarget(decision.target);

  if (owner === undefined) {
    return {
      state: "needs_review",
      missingFacts: PeriodWork.boundedMissingFacts([
        ...decision.missingFacts,
        `no_released_owner_for_target:${decision.target}`,
      ]),
    };
  }

  // The intended owner is a reviewed expectation. A disagreement is a case, not
  // a silent substitution.
  if (child.intendedOwner !== undefined && child.intendedOwner !== owner) {
    return {
      state: "needs_review",
      missingFacts: [`intended_owner_disagrees:${child.intendedOwner}:routed_owner:${owner}`],
    };
  }

  // No reviewed command means no dispatch. The run states exactly which owner's
  // inputs are absent instead of fabricating an account, a date, a rate or an
  // amount. An AI may propose them; it may not supply them.
  if (child.prepareInput === undefined) {
    return {
      state: "needs_review",
      missingFacts: PeriodWork.boundedMissingFacts([`missing_prepare_input_for_owner:${owner}`]),
    };
  }

  return { state: "pending", missingFacts: [], dispatch: { owner, input: child.prepareInput } };
}

/** The plan identity and the owning review a prepare operation returned. */
function planIdentityOf(prepared: Schema.Json) {
  return Schema.decodeUnknownEffect(PreparedReview)(prepared).pipe(
    Effect.map((review) => ({
      id: review.postingPlan.id,
      digest: review.postingPlan.planDigest,
      reviewId: review.id,
      reviewDigest: review.digest,
    })),
    Effect.mapError(() => failure("InternalError")),
  );
}

/**
 * Seal the fixed manifest a human will approve.
 *
 * Only children that already carry a sealed plan, a routed owner and the owning
 * review that produced it can be members. A child still waiting on a predecessor
 * is refused here rather than smuggled into the batch.
 */
export const preparePeriodWorkBatch = Effect.fn("periodWork.prepareBatch")(function* (
  token: string,
  command: {
    scope: BookScope;
    idempotencyKey: string;
    manifestId: string;
    workIdentities: ReadonlyArray<string>;
  },
) {
  if (command.workIdentities.length === 0) return yield* failure("InvalidJournal");

  if (command.workIdentities.length > maximumMembers) return yield* failure("UnsupportedProfile");

  if (new Set(command.workIdentities).size !== command.workIdentities.length) {
    return yield* failure("InvalidJournal");
  }

  const workIdentities = [...command.workIdentities].sort(compare);

  return yield* withBook(
    token,
    command.scope,
    true,
    function* (transaction, principal) {
      const request = yield* replay(
        transaction,
        command.scope,
        command.idempotencyKey,
        operationFor.seal,
        principal.actorId,
        yield* toJsonObject({ manifestId: command.manifestId, workIdentities }),
        PeriodWork.ApprovalBatch,
      );

      if (request.previous) return request.previous;

      yield* requireAccess(transaction, true);

      if (
        (yield* Db.readManifest(transaction, command.scope.bookId, command.manifestId)).length === 0
      ) {
        return yield* failure("NotFound");
      }

      const children = yield* Db.readChildren(
        transaction,
        command.scope.bookId,
        command.manifestId,
      );

      const byIdentity = new Map(children.map((row) => [row.workIdentity, row]));
      const selected: Array<PeriodWork.BatchMember> = [];

      for (const identity of workIdentities) {
        const child = byIdentity.get(identity);

        if (child === undefined) return yield* failure("NotFound");

        // A dependent child is not a member until its predecessor committed.
        if (child.state === "waiting_predecessor") return yield* failure("StaleDependency");

        // The owner, the plan and the review are read from the child's own
        // record, never from the caller's word. A child whose plan is not sealed
        // is not a member.
        if (
          child.state !== "prepared" ||
          child.planId === null ||
          child.planDigest === null ||
          child.routedOwner === null ||
          child.ownerReviewId === null ||
          child.ownerReviewDigest === null
        ) {
          return yield* failure("ApprovalRequired");
        }

        // The routed owner is a real named operation or the run has a defect.
        // Narrowing here rather than asserting means a new owner value can never
        // be dispatched to a map that has no entry for it.
        if (!isOwnerName(child.routedOwner)) return yield* failure("StaleDependency");

        selected.push({
          owner: child.routedOwner,
          planId: child.planId,
          planDigest: child.planDigest,
          inputIdentity: child.economicIdentity,
          workIdentity: child.workIdentity,
          ownerReviewId: child.ownerReviewId,
          ownerReviewDigest: child.ownerReviewDigest,
        });
      }

      // The exact plans load in one bounded set and each digest is checked, so a
      // plan that moved since the child was prepared cannot be sealed into a
      // gesture.
      const plans = yield* Db.readPlans(
        transaction,
        command.scope.bookId,
        selected.map((member) => member.planId),
      );

      if (plans.length !== selected.length) return yield* failure("StaleDependency");

      const amounts: Array<{ amountMinor: string }> = [];

      for (const member of selected) {
        const plan = plans.find((row) => row.id === member.planId);

        if (plan === undefined || plan.digest !== member.planDigest) {
          return yield* failure("StaleDependency");
        }

        const total = yield* planDebitTotal(plan.plan);

        amounts.push({ amountMinor: total });
      }

      const members = PeriodWork.orderBatchMembers(selected);
      // Informational only, and a sum of exact minor units. It is never a
      // journal line and never a balancing figure.
      const combined = PeriodWork.combinedInformationalMinor(amounts);
      const batchId = batchIdFor(command.scope.bookId, command.manifestId, members);

      const bodyJson = yield* toJsonObject({
        scope: command.scope,
        manifestId: command.manifestId,
        members,
        combinedInformationalMinor: combined,
      });

      const batchJson = { ...bodyJson, digest: yield* digest(bodyJson) };
      const batch = yield* decode(PeriodWork.ApprovalBatch, batchJson);

      yield* Db.insertBatch(transaction, {
        bookId: command.scope.bookId,
        id: batchId,
        manifestId: command.manifestId,
        memberCount: members.length,
        combinedInformationalMinor: combined,
        body: batchJson,
        digest: batch.digest,
      });

      yield* Db.insertBatchMembers(
        transaction,
        members.map((member, index) => ({
          bookId: command.scope.bookId,
          batchId,
          ordinal: index + 1,
          owner: member.owner,
          planId: member.planId,
          planDigest: member.planDigest,
          inputIdentity: member.inputIdentity,
          workIdentity: member.workIdentity,
          ownerReviewId: member.ownerReviewId,
          ownerReviewDigest: member.ownerReviewDigest,
        })),
      );

      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        request.expected,
        operationFor.seal,
        principal.actorId,
        batchJson,
      );

      return batch;
    },
    "update",
  );
});

/**
 * The total a member contributes to the informational figure shown beside a
 * batch: the exact sum of the sealed plan's own debit amounts, read from the
 * bytes the approval will cover. It is informational. It is never posted and
 * never balanced against, and a plan whose line shape cannot be read refuses
 * rather than contributing a guess.
 */
function planDebitTotal(plan: JsonObject) {
  let total = 0n;

  for (const group of Schema.isArray(plan["groups"]) ? plan["groups"] : []) {
    if (!isJsonObject(group)) return failure("UnsupportedProfile");

    const actions = group["actions"];

    if (!Schema.isArray(actions)) return failure("UnsupportedProfile");

    for (const action of actions) {
      if (!isJsonObject(action)) return failure("UnsupportedProfile");

      const lines = action["lines"];

      if (!Schema.isArray(lines)) return failure("UnsupportedProfile");

      for (const line of lines) {
        if (!isJsonObject(line)) return failure("UnsupportedProfile");

        const debit = line["debitMinor"];

        if (typeof debit !== "string" || !/^[0-9]{1,38}$/.test(debit)) {
          return failure("UnsupportedProfile");
        }

        const amount = BigInt(debit);

        if (amount >= minorCeiling) return failure("UnsupportedProfile");

        total += amount;
      }
    }
  }

  return total.toString();
}

/**
 * Approve the exact sealed members.
 *
 * One human gesture covers exactly the members in the sealed batch. The
 * operation is operator-only, so an ordinary agent or API credential cannot
 * reach it, and every approval comes from the released approve-within-transaction
 * operation — never from a fabricated identifier.
 *
 * It deliberately does NOT mint each owner's own approval. Those owners expose
 * approval only as public operations that open their own transaction, and
 * calling one from inside this transaction would nest a second financial
 * transaction. Each member's own approval therefore stays with its owner, and it
 * is what that owner's execute consumes.
 */
export const approvePeriodWorkBatch = Effect.fn("periodWork.approveBatch")(function* (
  token: string,
  command: { scope: BookScope; batchId: string; expectedDigest: string; idempotencyKey: string },
) {
  if (command.expectedDigest.length === 0) return yield* failure("InvalidJournal");

  return yield* withBook(
    token,
    command.scope,
    true,
    function* (transaction, principal) {
      const request = yield* replay(
        transaction,
        command.scope,
        command.idempotencyKey,
        operationFor.approve,
        principal.actorId,
        yield* toJsonObject({ batchId: command.batchId, digest: command.expectedDigest }),
        PeriodWork.ApprovalBatch,
      );

      if (request.previous) return request.previous;

      yield* requireAccess(transaction, true);

      const batch = (yield* Db.readBatch(transaction, command.scope.bookId, command.batchId))[0];

      if (batch === undefined) return yield* failure("NotFound");

      if (batch.digest !== command.expectedDigest) return yield* failure("StaleDependency");

      if (
        (yield* Db.readBatchApproval(transaction, command.scope.bookId, command.batchId)).length > 0
      ) {
        return yield* failure("AlreadyPosted");
      }

      const members = yield* Db.readBatchMembers(
        transaction,
        command.scope.bookId,
        command.batchId,
      );

      if (members.length === 0) return yield* failure("NotFound");

      const plans = yield* Db.readPlans(
        transaction,
        command.scope.bookId,
        members.map((member) => member.planId),
      );

      if (plans.length !== members.length) return yield* failure("StaleDependency");

      for (const member of members) {
        const plan = plans.find((row) => row.id === member.planId);

        if (plan === undefined || plan.digest !== member.planDigest) {
          return yield* failure("StaleDependency");
        }

        // The released approval owner mints the approval for this exact plan
        // digest, inside this transaction, opening none of its own. Its
        // idempotency key is derived from the member, so a retry recovers the
        // same approval instead of minting a second one.
        const approval = yield* approveChangeInTransaction(transaction, principal, {
          scope: command.scope,
          changeSetId: member.planId,
          idempotencyKey: `pw_ap_${command.batchId}_${member.ordinal}`,
          input: { version: 1, planDigest: member.planDigest },
        });

        yield* Db.insertBatchApproval(transaction, {
          bookId: command.scope.bookId,
          batchId: command.batchId,
          memberOrdinal: Number(member.ordinal),
          approvalId: approval.id,
          planDigest: member.planDigest,
          approverId: principal.actorId,
        });

        // The child records the batch that covered it, so a later read can prove
        // which gesture covered which child.
        const child = (yield* Db.readChild(
          transaction,
          command.scope.bookId,
          member.workIdentity,
        ))[0];

        if (child === undefined) return yield* failure("StaleDependency");

        const applied = yield* Db.advanceChild(
          transaction,
          {
            bookId: command.scope.bookId,
            workIdentity: child.workIdentity,
            state: child.state,
            revision: yield* nextRevision(child.revision),
            cancelVersion: child.cancelVersion,
            planId: child.planId,
            planDigest: child.planDigest,
            receiptId: child.receiptId,
            missingFacts: child.missingFacts,
            refusalReason: child.refusalReason,
            batchId: command.batchId,
            routedOwner: child.routedOwner,
            ownerReviewId: child.ownerReviewId,
            ownerReviewDigest: child.ownerReviewDigest,
          },
          { revision: child.revision, cancelVersion: child.cancelVersion },
        );

        if (applied.length === 0) return yield* failure("StaleDependency");
      }

      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        request.expected,
        operationFor.approve,
        principal.actorId,
        batch.body,
      );

      return yield* decode(PeriodWork.ApprovalBatch, batch.body);
    },
    "update",
  );
});

/**
 * Execute the approved batch.
 *
 * Each member is dispatched to its own owning execution and to nothing else,
 * with a key derived from the batch and the member ordinal, so a lost response
 * recovers the same member rather than moving to a new key. A member whose
 * owner refuses as stale is marked as needing a new review and the other
 * independent members stay runnable. Every receipt is persisted as it arrives,
 * and the returned progress is the honest partial result, not a summary that
 * claims more than happened.
 */
export const executePeriodWorkBatch = Effect.fn("periodWork.executeBatch")(function* (
  token: string,
  command: {
    scope: BookScope;
    batchId: string;
    expectedDigest: string;
    boundedCount: number;
    // The owning operation's own approval for each member. The batch approval is
    // a human gesture over the exact members; the owner approval is the owner's,
    // and the owner refuses to execute without it.
    ownerApprovals: ReadonlyArray<{ workIdentity: string; approvalId: string }>;
  },
) {
  if (command.expectedDigest.length === 0) return yield* failure("InvalidJournal");

  if (
    !Number.isInteger(command.boundedCount) ||
    command.boundedCount < 1 ||
    command.boundedCount > maximumMembers
  ) {
    return yield* failure("InvalidJournal");
  }

  const approvals = new Map(
    command.ownerApprovals.map((entry) => [entry.workIdentity, entry.approvalId]),
  );

  const plan = yield* withBook(token, command.scope, false, function* (transaction) {
    yield* requireAccess(transaction, false);

    const batch = (yield* Db.readBatch(transaction, command.scope.bookId, command.batchId))[0];

    if (batch === undefined) return yield* failure("NotFound");

    if (batch.digest !== command.expectedDigest) return yield* failure("StaleDependency");

    // Execution requires the human gesture. A batch that was never approved
    // is not executed, whatever else the caller supplies.
    const approved = yield* Db.readBatchApproval(
      transaction,
      command.scope.bookId,
      command.batchId,
    );

    if (approved.length === 0) return yield* failure("ApprovalRequired");

    const members = yield* Db.readBatchMembers(transaction, command.scope.bookId, command.batchId);

    if (members.length === 0) return yield* failure("NotFound");

    const selected = members.slice(0, command.boundedCount);

    return {
      manifestId: batch.manifestId,
      members: selected.map((member) => ({
        ordinal: Number(member.ordinal),
        owner: member.owner,
        workIdentity: member.workIdentity,
        planId: member.planId,
        planDigest: member.planDigest,
        ownerReviewId: member.ownerReviewId,
        ownerReviewDigest: member.ownerReviewDigest,
        approvedBy:
          approved.find((row) => row.memberOrdinal === member.ordinal)?.approvalId ?? null,
      })),
    };
  });

  const committed: Array<{ workIdentity: string; receiptId: string }> = [];
  const refused: Array<{ workIdentity: string; reason: string }> = [];

  for (const member of plan.members) {
    const ownerApprovalId = approvals.get(member.workIdentity);

    if (ownerApprovalId === undefined || member.approvedBy === null) {
      refused.push({ workIdentity: member.workIdentity, reason: "owner_approval_required" });
      continue;
    }

    if (!isOwnerName(member.owner)) {
      refused.push({ workIdentity: member.workIdentity, reason: "no_released_owner" });
      continue;
    }

    const result = yield* Effect.either(
      executeOwners[member.owner](token, {
        scope: command.scope,
        // The key is derived from the batch and the member, never from an
        // attempt counter, so a lost response recovers the same member.
        idempotencyKey: `pw_ex_${command.batchId}_${member.ordinal}`,
        ...(member.owner === "owner.operations" || member.owner === "commerce.invoice"
          ? { id: member.ownerReviewId }
          : { reviewId: member.ownerReviewId }),
        input: {
          version: 1,
          digest: member.ownerReviewDigest,
          approvalId: ownerApprovalId,
        },
      }),
    );

    if (result._tag === "Left") {
      // A stale member is marked as needing a new review and the remaining
      // independent members stay runnable. It is never retried under a new key.
      refused.push({ workIdentity: member.workIdentity, reason: result.left.code });
      yield* markForReview(token, command.scope, member.workIdentity, [
        `owner_execution_refused:${result.left.code}`,
      ]);
      continue;
    }

    const receiptId = receiptIdentityOf(result.right);
    committed.push({ workIdentity: member.workIdentity, receiptId });

    yield* withBook(
      token,
      command.scope,
      true,
      function* (transaction) {
        yield* requireAccess(transaction, true);

        const row = (yield* Db.readChild(
          transaction,
          command.scope.bookId,
          member.workIdentity,
        ))[0];

        if (row === undefined) return yield* failure("StaleDependency");

        const applied = yield* Db.advanceChild(
          transaction,
          {
            bookId: command.scope.bookId,
            workIdentity: member.workIdentity,
            state: "committed",
            revision: yield* nextRevision(row.revision),
            cancelVersion: row.cancelVersion,
            planId: member.planId,
            planDigest: member.planDigest,
            receiptId,
            missingFacts: null,
            refusalReason: null,
            batchId: command.batchId,
            routedOwner: member.owner,
            ownerReviewId: member.ownerReviewId,
            ownerReviewDigest: member.ownerReviewDigest,
          },
          { revision: row.revision, cancelVersion: row.cancelVersion },
        );

        if (applied.length === 0) return yield* failure("StaleDependency");
      },
      "update",
    );
  }

  const progress = yield* readPeriodWorkProgress(token, command.scope, plan.manifestId);

  return {
    batchId: command.batchId,
    manifestId: plan.manifestId,
    committed,
    refused,
    counts: progress.counts,
    reconciled: false,
  };
});

/** The economic receipt a member's owner returned. */
function receiptIdentityOf(result: Schema.Json) {
  return Schema.decodeUnknownEffect(OwnerReceipt)(result).pipe(
    Effect.map((receipt) => receipt.id),
    Effect.mapError(() => failure("InternalError")),
  );
}

function markForReview(
  token: string,
  scope: BookScope,
  workIdentity: string,
  facts: ReadonlyArray<string>,
) {
  return withBook(
    token,
    scope,
    true,
    function* (transaction) {
      yield* requireAccess(transaction, true);

      const row = (yield* Db.readChild(transaction, scope.bookId, workIdentity))[0];

      if (row === undefined) return yield* failure("StaleDependency");

      const applied = yield* Db.advanceChild(
        transaction,
        {
          bookId: scope.bookId,
          workIdentity,
          state: "needs_review",
          revision: yield* nextRevision(row.revision),
          cancelVersion: row.cancelVersion,
          planId: row.planId,
          planDigest: row.planDigest,
          receiptId: null,
          missingFacts: missingFactsOf(facts),
          refusalReason: null,
          batchId: row.batchId,
          routedOwner: null,
          ownerReviewId: null,
          ownerReviewDigest: null,
        },
        { revision: row.revision, cancelVersion: row.cancelVersion },
      );

      if (applied.length === 0) return yield* failure("StaleDependency");
    },
    "update",
  );
}

/**
 * Rediscover the runs this book still has open work in.
 *
 * The runner calls this instead of holding a queue row per manifest. The
 * admission is the child state itself, so a lost enqueue is picked up on the
 * next poll and a redelivery cannot publish twice, because the child revision
 * fence is inside the advance rather than inside the queue.
 */
export const claimOpenPeriodWorkRuns = Effect.fn("periodWork.claimOpenRuns")(function* (
  token: string,
  runBound: number,
  boundedCount: number,
) {
  if (!Number.isInteger(runBound) || runBound < 1 || runBound > 200) {
    return yield* failure("InvalidJournal");
  }

  if (!Number.isInteger(boundedCount) || boundedCount < 1 || boundedCount > maximumBoundedCount) {
    return yield* failure("InvalidJournal");
  }

  return yield* withTransaction((transaction) =>
    Effect.gen(function* () {
      yield* admitRunnerActor(transaction, token);

      const books = yield* Db.readRunnerBooks(transaction);

      const open: Array<{
        manifestId: string;
        entityId: string;
        bookId: string;
        openCount: string;
        boundedCount: number;
      }> = [];

      for (const book of books) {
        const runs = yield* Db.readOpenPeriodWorkRuns(transaction, book.id, runBound - open.length);

        for (const run of runs) {
          if (run.entityId === null) continue;

          open.push({ ...run, entityId: run.entityId, boundedCount });

          if (open.length >= runBound) break;
        }

        if (open.length >= runBound) break;
      }

      return open;
    }).pipe(Effect.mapError(databaseFailure)),
  );
});

/**
 * Read the current progress projection.
 *
 * Counts stay distinct from a reconciliation claim. A run whose children were
 * all visited is still not a reconciled period, and this projection never
 * claims otherwise: only the separate source and control inventory can, and
 * that inventory is not this owner's to assert.
 */
export const readPeriodWorkProgress = Effect.fn("periodWork.readProgress")(function* (
  token: string,
  scope: BookScope,
  manifestId: string,
) {
  return yield* withBook(token, scope, false, function* (transaction) {
    yield* requireAccess(transaction, false);

    const manifest = (yield* Db.readManifest(transaction, scope.bookId, manifestId))[0];

    if (manifest === undefined) return yield* failure("NotFound");

    const children = yield* Db.readChildren(transaction, scope.bookId, manifestId);

    const counts = PeriodWork.countChildStates(children.map((row) => row.state));

    return {
      scope,
      manifestId,
      digest: manifest.digest,
      populationComplete: manifest.populationComplete,
      children: children.map((row) => ({
        workIdentity: row.workIdentity,
        state: row.state,
        planId: row.planId ?? undefined,
        receiptId: row.receiptId ?? undefined,
        missingFacts: readMissingFacts(row.missingFacts),
        refusalReason: row.refusalReason ?? undefined,
        routedOwner: row.routedOwner ?? undefined,
        ownerReviewId: row.ownerReviewId ?? undefined,
        batchId: row.batchId ?? undefined,
        revision: row.revision,
        cancelVersion: row.cancelVersion,
      })),
      counts,
      reconciled: false,
    };
  });
});

export { Db as PeriodWorkDb };

export type { Transaction };
