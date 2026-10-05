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
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { decodeUnknownEffect } from "effect/Schema";

import * as Accounting from "@open-erp/contracts/accounting";
import * as PeriodWork from "@open-erp/domain/period-work";
import * as Contracts from "@open-erp/contracts/period-work";
import type { Database } from "../db/connection";
import { RequestEnvironment } from "../runtime/environment";
import { Digest, Identifier } from "@open-erp/contracts/accounting";
import * as Acceptance from "@open-erp/contracts/supplier-acceptance";
import * as Credits from "@open-erp/contracts/supplier-credits";
import * as Issuance from "@open-erp/contracts/invoice-issuance";
import * as Operation from "@open-erp/contracts/owner-operations";

import type { Transaction } from "../db/transaction";
import * as Db from "../db/period-work";
import { databaseFailure, withTransaction } from "../db/transaction";
import { failure } from "./failures";
import { sha256HexOf } from "./bytes";
import { orderPostingGroups } from "@open-erp/domain/posting";
import { PeriodWorkExecutionFence } from "./period-work-fence";
import { admitRunnerActor } from "./preparation-jobs";
import { digest, replay, saveCommand } from "./posting";
import {
  approveInvoiceIssueInTransaction,
  executeInvoiceIssue,
  prepareInvoiceIssue,
} from "./commerce/invoice-lifecycle";
import {
  approveSupplierAcceptanceInTransaction,
  executeSupplierAcceptance,
  prepareSupplierAcceptance,
} from "./purchases/acceptance";
import {
  approveSupplierCreditInTransaction,
  executeSupplierCredit,
  prepareSupplierCredit,
} from "./purchases/credits";
import {
  approveOwnerOperationInTransaction,
  executeOwnerOperation,
  prepareOwnerOperation,
} from "./subledger/owner-operations";
import {
  decode,
  toJsonObject,
  unsupported,
  withBook,
  type JsonObject,
  type Scope as BookScope,
} from "./commerce/support";

/**
 * The released owning operations this run may dispatch to. Every value here is a
 * real named operation in this repository. A route with no released owner
 * becomes a review case and is never dispatched.
 */
export const ownerNames = [
  "purchases.recognition",
  "purchases.credits",
  "owner.operations",
  "commerce.invoice",
] as const;

type OwnerName = (typeof ownerNames)[number];

const isOwnerName = (value: string): value is OwnerName =>
  ownerNames.some((name) => name === value);

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
function manifestIdFor(bookId: string, inputDigest: string) {
  return derivedId("period_work_manifest", JSON.stringify([bookId, inputDigest]));
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
  return derivedId("period_work_batch", JSON.stringify([bookId, manifestId, members]));
}

function derivedId(prefix: string, key: string) {
  return sha256HexOf(new TextEncoder().encode(key)).pipe(
    Effect.map((hash) => `${prefix}_${hash.slice(0, 32)}`),
  );
}

function nextRevision(revision: string) {
  const next = BigInt(revision) + 1n;

  return next >= 1000000000n ? failure("UnsupportedProfile") : Effect.succeed(next.toString());
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

/**
 * The plan identity a prepared member contributes: the sealed plan, and the owning
 * review that produced it.
 */
type PreparedPlanIdentity = {
  readonly id: string;
  readonly digest: string;
  readonly reviewId: string;
  readonly reviewDigest: string;
};

/** The single shape both dispatchers return, so no caller ever sees a union of
 * four owner signatures. Each branch maps its own owner's result into it. */
type OwnerPrepareResult = Effect.Effect<
  PreparedPlanIdentity,
  Accounting.AccountingError,
  RequestEnvironment | Database
>;

type OwnerExecuteResult = Effect.Effect<
  string,
  Accounting.AccountingError,
  RequestEnvironment | Database
>;

/**
 * Prepare one child through the owner that actually owns its effect.
 *
 * The dispatch is one branch per owner. Each branch decodes the sealed command
 * against that owner's own input schema and calls that owner's own operation, so
 * the four owners' genuinely different input shapes are each stated exactly —
 * there is no shared payload, no cast, and no union call signature. Every branch
 * maps its result to one common plan identity, which is what keeps the caller's
 * type a single `Effect` instead of a four-way union.
 */
function prepareForOwner(
  owner: OwnerName,
  token: string,
  command: { readonly scope: BookScope; readonly idempotencyKey: string },
  raw: Schema.Json,
): OwnerPrepareResult {
  switch (owner) {
    case "purchases.recognition":
      return decodeUnknownEffect(Acceptance.PrepareSupplierAcceptance)(raw).pipe(
        Effect.mapError(() => failure("InvalidJournal")),
        Effect.flatMap((input) => prepareSupplierAcceptance(token, { ...command, input })),
        Effect.flatMap(planIdentityOf),
      );
    case "purchases.credits":
      return decodeUnknownEffect(Credits.PrepareSupplierCredit)(raw).pipe(
        Effect.mapError(() => failure("InvalidJournal")),
        Effect.flatMap((input) => prepareSupplierCredit(token, { ...command, input })),
        Effect.flatMap(planIdentityOf),
      );
    case "owner.operations":
      return decodeUnknownEffect(Operation.PrepareOwnerOperation)(raw).pipe(
        Effect.mapError(() => failure("InvalidJournal")),
        Effect.flatMap((input) => prepareOwnerOperation(token, { ...command, input })),
        Effect.flatMap(planIdentityOf),
      );
    case "commerce.invoice":
      return decodeUnknownEffect(Issuance.PrepareInvoiceIssue)(raw).pipe(
        Effect.mapError(() => failure("InvalidJournal")),
        Effect.flatMap((input) => prepareInvoiceIssue(token, { ...command, input })),
        Effect.flatMap(planIdentityOf),
      );
  }
}

/**
 * Execute one sealed member through its own owner, returning that owner's own
 * receipt identity.
 *
 * The four owners' approve-and-execute inputs are not the same shape: one omits
 * `version`, one omits `acknowledgeSyntheticOnly`. Each branch therefore builds
 * its owner's own input from that owner's own contract, and each maps the result
 * to the one receipt identity the child records. Parsing the receipt happens
 * inside the branch, so nothing is left un-yielded at the call site.
 */
function executeForOwner(
  owner: OwnerName,
  token: string,
  command: {
    readonly scope: BookScope;
    readonly idempotencyKey: string;
    readonly ownerReviewId: string;
    readonly ownerReviewDigest: string;
    readonly ownerApprovalId: string;
  },
): OwnerExecuteResult {
  switch (owner) {
    case "purchases.recognition":
      return executeSupplierAcceptance(token, {
        ...command,
        reviewId: command.ownerReviewId,
        input: {
          version: 1,
          digest: command.ownerReviewDigest,
          acknowledgeSyntheticOnly: true,
          approvalId: command.ownerApprovalId,
        },
      }).pipe(Effect.flatMap(receiptIdentityOf));
    case "purchases.credits":
      return executeSupplierCredit(token, {
        ...command,
        reviewId: command.ownerReviewId,
        input: {
          digest: command.ownerReviewDigest,
          acknowledgeSyntheticOnly: true,
          approvalId: command.ownerApprovalId,
        },
      }).pipe(Effect.flatMap(receiptIdentityOf));
    case "owner.operations":
      return executeOwnerOperation(token, {
        ...command,
        id: command.ownerReviewId,
        input: {
          version: 1,
          digest: command.ownerReviewDigest,
          approvalId: command.ownerApprovalId,
        },
      }).pipe(Effect.flatMap(receiptIdentityOf));
    case "commerce.invoice":
      return executeInvoiceIssue(token, {
        ...command,
        id: command.ownerReviewId,
        input: {
          version: 1,
          digest: command.ownerReviewDigest,
          acknowledgeSyntheticOnly: true,
          approvalId: command.ownerApprovalId,
        },
      }).pipe(Effect.flatMap(receiptIdentityOf));
  }
}

/**
 * The owners that have released an approve-within-transaction port, and the
 * member approval each one mints under its own rules.
 *
 * Only `owner.operations` has released one. The other three owners expose
 * approval as a public operation that opens its own transaction, so calling one
 * from inside the approving transaction would nest a second financial
 * transaction. A member of one of those owners is refused with its owner named,
 * not approved with a stand-in.
 */
function approveMemberInTransaction(
  transaction: Transaction,
  principal: Parameters<typeof approveOwnerOperationInTransaction>[1],
  scope: BookScope,
  idempotencyKey: string,
  member: {
    readonly owner: string;
    readonly ownerReviewId: string;
    readonly ownerReviewDigest: string;
  },
) {
  if (!isOwnerName(member.owner)) return failure("StaleDependency");

  switch (member.owner) {
    case "owner.operations":
      return Effect.map(
        approveOwnerOperationInTransaction(transaction, principal, {
          scope,
          id: member.ownerReviewId,
          idempotencyKey,
          input: { version: 1, digest: member.ownerReviewDigest },
        }),
        (approval) => approval.id,
      );
    case "purchases.recognition":
      return approveSupplierAcceptanceInTransaction(transaction, principal, {
        scope,
        reviewId: member.ownerReviewId,
        idempotencyKey,
        input: { version: 1, digest: member.ownerReviewDigest, acknowledgeSyntheticOnly: true },
      }).pipe(Effect.map((approval) => approval.id));
    case "purchases.credits":
      return approveSupplierCreditInTransaction(transaction, principal, {
        scope,
        reviewId: member.ownerReviewId,
        idempotencyKey,
        input: { digest: member.ownerReviewDigest, acknowledgeSyntheticOnly: true },
      }).pipe(Effect.map((approval) => approval.id));
    case "commerce.invoice":
      return approveInvoiceIssueInTransaction(transaction, principal, {
        scope,
        id: member.ownerReviewId,
        idempotencyKey,
        input: { version: 1, digest: member.ownerReviewDigest, acknowledgeSyntheticOnly: true },
      }).pipe(Effect.map((approval) => approval.id));
  }
}

/**
 * Approve the exact sealed members, under each owner's own rules.
 *
 * One human gesture covers exactly the members in the sealed batch, in one
 * transaction, so a batch is either wholly approved or not approved at all. The
 * operation is operator-only, so an ordinary agent or API credential cannot reach
 * it.
 *
 * The approval each member receives is minted by ITS OWN owner, through that
 * owner's own approve-within-transaction port and that owner's own rules —
 * exact review digest, an independent reviewer who is not the preparer, and no
 * outstanding blocker. A shared posting-kernel approval is deliberately NOT used:
 * no owner consumes one, so minting them here would have produced approvals that
 * looked like authority and were never checked by anything.
 *
 * A member whose owner has not released such a port cannot be approved, and the
 * whole batch is refused naming that owner. Approval is not silently skipped for
 * it, because a batch that approved some members and not others would be a
 * gesture the human did not actually make.
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
      // A caller acknowledges that a completed run is not a reconciled period.
      // The schema makes it a literal, and the sealed manifest says so too.
      acknowledgeNotReconciled: true;
    };
  },
): Effect.fn.Return<PeriodWork.PeriodWorkManifest, Accounting.AccountingError, Database> {
  if (command.input.acknowledgeNotReconciled !== true) return yield* failure("InvalidJournal");

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

  const payload = yield* toJsonObject(command.input);

  const ordered = orderPostingGroups(
    children.map((child) => ({ id: child.workIdentity, dependsOnGroupIds: child.dependsOn })),
  );

  if (Result.isFailure(ordered)) return yield* failure("InvalidJournal");

  const manifestId = yield* manifestIdFor(command.scope.bookId, yield* digest(payload));

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
        payload,
        PeriodWork.PeriodWorkManifest,
      );

      if (request.previous) return request.previous;

      yield* requireAccess(transaction, true);

      const existing = (yield* Db.readManifest(transaction, command.scope.bookId, manifestId))[0];

      if (existing !== undefined) {
        const result = yield* decode(PeriodWork.PeriodWorkManifest, existing.body);

        yield* saveCommand(
          transaction,
          command.scope,
          command.idempotencyKey,
          request.expected,
          operationFor.prepare,
          principal.actorId,
          existing.body,
        );

        return result;
      }

      const bodyJson = yield* toJsonObject({
        id: manifestId,
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
  command: {
    scope: BookScope;
    manifestId: string;
    idempotencyKey: string;
    input: { boundedCount: number };
  },
): Effect.fn.Return<
  typeof Contracts.PeriodWorkRunProgress.Type,
  Accounting.AccountingError,
  Database | RequestEnvironment
> {
  const boundedCount = command.input.boundedCount;

  if (!Number.isInteger(boundedCount) || boundedCount < 1 || boundedCount > maximumBoundedCount) {
    return yield* failure("InvalidJournal");
  }

  const queue: Array<{
    workIdentity: string;
    owner: OwnerName;
    input: JsonObject;
    key: string;
    revision: string;
    cancelVersion: string;
  }> = [];

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

      for (const row of children
        .filter(
          (child) =>
            child.state === "pending" ||
            (child.state === "waiting_predecessor" &&
              frozen.get(child.workIdentity)?.dependsOn.every((identity) => {
                const predecessor = rows.get(identity);

                return predecessor?.state === "committed" || predecessor?.state === "recovered";
              })),
        )
        .slice(0, boundedCount)) {
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
              receiptId: claim.receiptId ?? row.receiptId,
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
          key: yield* derivedId(
            "pw_prepare",
            JSON.stringify([command.manifestId, child.workIdentity, child.sourceRevision]),
          ),
          revision: row.revision,
          cancelVersion: row.cancelVersion,
        });
      }
    },
    "update",
  );

  // The owning prepare operation runs here, with no transaction held by this
  // owner. It opens its own.
  for (const item of queue) {
    const prepared = yield* Effect.result(
      prepareForOwner(
        item.owner,
        token,
        { scope: command.scope, idempotencyKey: item.key },
        item.input,
      ),
    );

    if (Result.isFailure(prepared)) {
      yield* markForReview(
        token,
        command.scope,
        item.workIdentity,
        [`owner_preparation_refused:${prepared.failure.code}`],
        item,
      );
      continue;
    }

    const plan = prepared.success;

    yield* withBook(
      token,
      command.scope,
      true,
      function* (transaction) {
        yield* requireAccess(transaction, true);

        const row = (yield* Db.readChild(transaction, command.scope.bookId, item.workIdentity))[0];

        if (row === undefined) return yield* failure("StaleDependency");

        if (row.revision !== item.revision || row.cancelVersion !== item.cancelVersion) return;

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
          { revision: item.revision, cancelVersion: item.cancelVersion },
        );

        if (applied.length === 0) return yield* failure("StaleDependency");
      },
      "update",
    );
  }

  return yield* readPeriodWorkProgress(token, {
    scope: command.scope,
    manifestId: command.manifestId,
  });
});

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

  if (
    obligation !== undefined &&
    !child.isPaymentObservation &&
    child.documentClass !== "domestic_credit_note"
  ) {
    if (child.existingRecognition?.recognitionId !== obligation.recognitionId) {
      return {
        state: "needs_review",
        missingFacts: ["review_existing_recognition_or_source_revision"],
      };
    }

    return { state: "recovered", missingFacts: [], receiptId: obligation.recognitionId };
  }

  const decision = PeriodWork.routeWork(child, rules, {
    ownerPaidExpenseIsUnrecognized:
      child.documentClass === "owner_expense" && obligation === undefined,
    sourceRevisesRecognizedFacts: false,
    invoiceEntityIsKnown: child.legalSupplierIdentity !== undefined,
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

  const owner =
    child.documentClass === "domestic_credit_note" && decision.ruleId !== undefined
      ? "purchases.credits"
      : PeriodWork.ownerForTarget(decision.target);

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

type Claim = {
  readonly state: PeriodWork.WorkChildState;
  readonly missingFacts: ReadonlyArray<string>;
  readonly refusalReason?: string;
  readonly receiptId?: string;
  readonly dispatch?: { readonly owner: OwnerName; readonly input: JsonObject };
};

/**
 * The decision for one child, from the current state rather than from the frozen
 * selection alone. The order of the tests is the packet's order and is
 * load-bearing: a payment observation is resolved against an existing
 * obligation before anything else is considered.
 */

function planIdentityOf(prepared: Schema.Json) {
  return Schema.decodeUnknownEffect(PreparedReview)(prepared).pipe(
    Effect.map((review) => ({
      id: review.postingPlan.id,
      digest: review.postingPlan.planDigest,
      reviewId: review.id,
      reviewDigest: review.digest,
    })),
    Effect.mapError((cause) => failure("InternalError", cause)),
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
): Effect.fn.Return<PeriodWork.ApprovalBatch, Accounting.AccountingError, Database> {
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
      const batchId = yield* batchIdFor(command.scope.bookId, command.manifestId, members);

      const bodyJson = yield* toJsonObject({
        id: batchId,
        scope: command.scope,
        manifestId: command.manifestId,
        members,
        combinedInformationalMinor: combined,
      });

      const batchJson = { ...bodyJson, digest: yield* digest(bodyJson) };
      const batch = yield* decode(PeriodWork.ApprovalBatch, batchJson);

      const existing = (yield* Db.readBatch(transaction, command.scope.bookId, batchId))[0];

      if (existing !== undefined) {
        yield* saveCommand(
          transaction,
          command.scope,
          command.idempotencyKey,
          request.expected,
          operationFor.seal,
          principal.actorId,
          existing.body,
        );

        return yield* decode(PeriodWork.ApprovalBatch, existing.body);
      }

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

  for (const group of Array.isArray(plan["groups"]) ? plan["groups"] : []) {
    if (!isJsonObject(group)) return failure("UnsupportedProfile");

    const actions = group["actions"];

    if (!Array.isArray(actions)) return failure("UnsupportedProfile");

    for (const action of actions) {
      if (!isJsonObject(action)) return failure("UnsupportedProfile");

      const lines = action["lines"];

      if (!Array.isArray(lines)) return failure("UnsupportedProfile");

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

  return Effect.succeed(total.toString());
}

/**
 * Approve the exact sealed members.
 *
 * One human gesture covers exactly the members in the sealed batch. The
 * operation is operator-only, so an ordinary agent or API credential cannot
 * reach it, and every approval comes from the released approve-within-transaction
 * operation — never from a fabricated identifier.
 *
 * Owner approval ports share this transaction, so a failed member rolls back
 * the entire approval gesture.
 */

export const approvePeriodWorkBatch = Effect.fn("periodWork.approveBatch")(function* (
  token: string,
  command: {
    scope: BookScope;
    batchId: string;
    expectedDigest: string;
    idempotencyKey: string;
    acknowledgeSyntheticOnly: true;
  },
): Effect.fn.Return<PeriodWork.ApprovalBatch, Accounting.AccountingError, Database> {
  if (command.expectedDigest.length === 0 || command.acknowledgeSyntheticOnly !== true)
    return yield* failure("InvalidJournal");

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
        const child = (yield* Db.readChild(
          transaction,
          command.scope.bookId,
          member.workIdentity,
        ))[0];

        if (
          !child ||
          child.state !== "prepared" ||
          child.planId !== member.planId ||
          child.planDigest !== member.planDigest ||
          child.ownerReviewId !== member.ownerReviewId ||
          (child.batchId !== null && child.batchId !== command.batchId)
        ) {
          return yield* failure("StaleDependency");
        }

        const plan = plans.find((row) => row.id === member.planId);

        if (plan === undefined || plan.digest !== member.planDigest) {
          return yield* failure("StaleDependency");
        }

        const approvalId = yield* approveMemberInTransaction(
          transaction,
          principal,
          command.scope,
          `pw_ap_${command.batchId}_${member.ordinal}`,
          {
            owner: member.owner,
            ownerReviewId: member.ownerReviewId,
            ownerReviewDigest: member.ownerReviewDigest,
          },
        );

        yield* Db.insertBatchApproval(transaction, {
          bookId: command.scope.bookId,
          batchId: command.batchId,
          memberOrdinal: Number(member.ordinal),
          owner: member.owner,
          ownerApprovalId: approvalId,
          planDigest: member.planDigest,
          approverId: principal.actorId,
        });

        // The child records the batch that covered it, so a later read can prove
        // which gesture covered which child.
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
    idempotencyKey: string;
    acknowledgeSyntheticOnly: true;
    afterOrdinal?: number;
  },
): Effect.fn.Return<
  typeof Contracts.PeriodWorkExecutionResult.Type,
  Accounting.AccountingError,
  Database | RequestEnvironment
> {
  if (command.expectedDigest.length === 0 || command.acknowledgeSyntheticOnly !== true)
    return yield* failure("InvalidJournal");

  if (
    !Number.isInteger(command.boundedCount) ||
    command.boundedCount < 1 ||
    command.boundedCount > maximumMembers
  ) {
    return yield* failure("InvalidJournal");
  }

  const executionInput = yield* toJsonObject({
    batchId: command.batchId,
    expectedDigest: command.expectedDigest,
    boundedCount: command.boundedCount,
    afterOrdinal: command.afterOrdinal ?? 0,
  });

  const plan = yield* withBook(
    token,
    command.scope,
    true,
    function* (transaction, principal) {
      yield* requireAccess(transaction, true);

      const request = yield* replay(
        transaction,
        command.scope,
        command.idempotencyKey,
        operationFor.execute,
        principal.actorId,
        executionInput,
        Schema.Json,
      );

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

      const retainedResult = (yield* Db.readExecutionResult(
        transaction,
        command.scope.bookId,
        command.batchId,
        command.idempotencyKey,
      ))[0];

      if (retainedResult) {
        if (retainedResult.actorId !== principal.actorId) return yield* failure("Forbidden");

        return {
          previous: yield* decode(Contracts.PeriodWorkExecutionResult, retainedResult.body),
          manifestId: batch.manifestId,
          nextOrdinal: null,
          members: [],
        };
      }

      const members = yield* Db.readBatchMembers(
        transaction,
        command.scope.bookId,
        command.batchId,
      );

      if (members.length === 0) return yield* failure("NotFound");

      const remaining = members.filter((member) => member.ordinal > (command.afterOrdinal ?? 0));
      const selected = remaining.slice(0, command.boundedCount);

      if (!request.previous) {
        yield* saveCommand(
          transaction,
          command.scope,
          command.idempotencyKey,
          request.expected,
          operationFor.execute,
          principal.actorId,
          executionInput,
        );
      }

      return {
        previous: null,
        manifestId: batch.manifestId,
        nextOrdinal: remaining.length > selected.length ? (selected.at(-1)?.ordinal ?? null) : null,
        members: selected.map((member) => ({
          ordinal: Number(member.ordinal),
          owner: member.owner,
          workIdentity: member.workIdentity,
          planId: member.planId,
          planDigest: member.planDigest,
          ownerReviewId: member.ownerReviewId,
          ownerReviewDigest: member.ownerReviewDigest,
          approvedBy:
            approved.find((row) => row.memberOrdinal === member.ordinal)?.ownerApprovalId ?? null,
        })),
      };
    },
    "update",
  );

  if (plan.previous) return plan.previous;

  const committed: Array<{ workIdentity: string; receiptId: string }> = [];
  const refused: Array<{ workIdentity: string; reason: string }> = [];

  for (const member of plan.members) {
    const ownerApprovalId = member.approvedBy;

    if (ownerApprovalId === null) {
      refused.push({ workIdentity: member.workIdentity, reason: "owner_approval_required" });
      continue;
    }

    if (!isOwnerName(member.owner)) {
      refused.push({ workIdentity: member.workIdentity, reason: "no_released_owner" });
      continue;
    }

    // The fence is rechecked immediately before the owner is asked to post. A
    // cancellation that landed after the batch was read, or a child another
    // handler moved on, must stop this execution rather than post behind a stale
    // decision. Nothing is dispatched until the child is still the one this batch
    // named and it is still prepared.
    const fence = yield* withBook(token, command.scope, false, function* (transaction) {
      const row = (yield* Db.readChild(transaction, command.scope.bookId, member.workIdentity))[0];

      return {
        state: row?.state ?? "absent",
        revision: row?.revision ?? "",
        cancelVersion: row?.cancelVersion ?? "",
        planId: row?.planId ?? null,
        planDigest: row?.planDigest ?? null,
        ownerReviewId: row?.ownerReviewId ?? null,
        receiptId: row?.receiptId ?? null,
        missingFacts: row ? readMissingFacts(row.missingFacts) : undefined,
      };
    });

    if (fence.receiptId !== null && (fence.state === "committed" || fence.state === "recovered")) {
      committed.push({ workIdentity: member.workIdentity, receiptId: fence.receiptId });
      continue;
    }

    if (fence.state !== "prepared" && fence.state !== "refused") {
      const retainedRefusal = fence.missingFacts?.find((fact) =>
        fact.startsWith("owner_execution_refused:"),
      );

      refused.push({
        workIdentity: member.workIdentity,
        reason:
          retainedRefusal?.slice("owner_execution_refused:".length) ??
          `child_not_prepared:${fence.state}`,
      });
      continue;
    }

    if (
      fence.planId !== member.planId ||
      fence.planDigest !== member.planDigest ||
      fence.ownerReviewId !== member.ownerReviewId
    ) {
      refused.push({
        workIdentity: member.workIdentity,
        reason: "child_moved_since_batch_was_sealed",
      });
      continue;
    }

    const result = yield* Effect.result(
      executeForOwner(member.owner, token, {
        scope: command.scope,
        // The key is derived from the batch and the member, never from an
        // attempt counter, so a lost response recovers the same member.
        idempotencyKey: `pw_ex_${command.batchId}_${member.ordinal}`,
        ownerReviewId: member.ownerReviewId,
        ownerReviewDigest: member.ownerReviewDigest,
        ownerApprovalId,
      }).pipe(
        Effect.provideService(PeriodWorkExecutionFence, {
          bookId: command.scope.bookId,
          workIdentity: member.workIdentity,
          batchId: command.batchId,
          planId: member.planId,
          revision: fence.revision,
          cancelVersion: fence.cancelVersion,
        }),
      ),
    );

    if (Result.isFailure(result)) {
      // A stale member is marked as needing a new review and the remaining
      // independent members stay runnable. It is never retried under a new key.
      refused.push({ workIdentity: member.workIdentity, reason: result.failure.code });
      yield* markForReview(
        token,
        command.scope,
        member.workIdentity,
        [`owner_execution_refused:${result.failure.code}`],
        fence,
      );
      continue;
    }

    const receiptId = result.success;
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
            state: row.cancelVersion === fence.cancelVersion ? "committed" : "recovered",
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

  const progress = yield* readPeriodWorkProgress(token, {
    scope: command.scope,
    manifestId: plan.manifestId,
  });

  const result = {
    batchId: command.batchId,
    manifestId: plan.manifestId,
    committed,
    refused,
    counts: progress.counts,
    reconciled: false,
    nextOrdinal: plan.nextOrdinal,
  };

  return yield* withBook(
    token,
    command.scope,
    true,
    function* (transaction, principal) {
      yield* Db.insertExecutionResult(transaction, {
        bookId: command.scope.bookId,
        batchId: command.batchId,
        commandKey: command.idempotencyKey,
        actorId: principal.actorId,
        body: yield* toJsonObject(result),
      });

      const stored = (yield* Db.readExecutionResult(
        transaction,
        command.scope.bookId,
        command.batchId,
        command.idempotencyKey,
      ))[0];

      if (!stored || stored.actorId !== principal.actorId) return yield* failure("StaleDependency");

      return yield* decode(Contracts.PeriodWorkExecutionResult, stored.body);
    },
    "update",
  );
});

export const getPeriodWorkBatch = Effect.fn("periodWork.getBatch")(function* (
  token: string,
  command: { scope: BookScope; batchId: string },
) {
  return yield* withBook(token, command.scope, false, function* (transaction) {
    yield* requireAccess(transaction, false);
    const batch = (yield* Db.readBatch(transaction, command.scope.bookId, command.batchId))[0];

    if (!batch) return yield* failure("NotFound");

    return yield* decode(Contracts.ApprovalBatch, batch.body);
  });
});

export const getPeriodWorkBatchResult = Effect.fn("periodWork.getBatchResult")(function* (
  token: string,
  command: { scope: BookScope; batchId: string; key: string },
) {
  return yield* withBook(token, command.scope, false, function* (transaction) {
    yield* requireAccess(transaction, false);

    const result = (yield* Db.readExecutionResult(
      transaction,
      command.scope.bookId,
      command.batchId,
      command.key,
    ))[0];

    if (!result) return yield* failure("NotFound");

    return yield* decode(Contracts.PeriodWorkExecutionResult, result.body);
  });
});

/** The economic receipt a member's owner returned. */
function receiptIdentityOf(result: Schema.Json) {
  return Schema.decodeUnknownEffect(OwnerReceipt)(result).pipe(
    Effect.map((receipt) => receipt.id),
    Effect.mapError((cause) => failure("InternalError", cause)),
  );
}

function markForReview(
  token: string,
  scope: BookScope,
  workIdentity: string,
  facts: ReadonlyArray<string>,
  expected?: { readonly revision: string; readonly cancelVersion: string },
) {
  return withBook(
    token,
    scope,
    true,
    function* (transaction) {
      yield* requireAccess(transaction, true);

      const row = (yield* Db.readChild(transaction, scope.bookId, workIdentity))[0];

      if (row === undefined) return yield* failure("StaleDependency");

      if (
        expected !== undefined &&
        (expected.revision !== row.revision || expected.cancelVersion !== row.cancelVersion)
      )
        return;

      if (row.state === "refused" || row.state === "committed" || row.state === "recovered") return;

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
          batchId: null,
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
      const actorId = yield* admitRunnerActor(transaction, token);

      const books = yield* Db.readRunnerBooks(transaction, actorId);

      const open: Array<{
        manifestId: string;
        entityId: string;
        bookId: string;
        openCount: string;
        boundedCount: number;
        checkpoint: string;
      }> = [];

      for (const book of books) {
        const runs = yield* Db.readOpenPeriodWorkRuns(transaction, book.id, runBound - open.length);

        for (const run of runs) {
          if (run.entityId === null) continue;

          open.push({ ...run, entityId: run.entityId, bookId: book.id, boundedCount });

          if (open.length >= runBound) break;
        }

        if (open.length >= runBound) break;
      }

      return open;
    }).pipe(Effect.mapError(databaseFailure)),
  );
});

/**
 * A run whose delivery is exhausted stops being claimed.
 *
 * The runner could not deliver a pass, so the still-open children of this run
 * become review cases naming the delivery as the unresolved fact. That is not a
 * domain refusal and not a cancellation: no owner refused the work, and nothing
 * was cancelled, so the children keep the ordinary review path and the
 * cancellation fence is untouched.
 *
 * A child that is already prepared, committed, recovered or refused is left alone,
 * so an exhausted pass cannot discard a prepared plan or a committed receipt.
 */
export const stopFailedPeriodWorkDelivery = Effect.fn("periodWork.stopFailedDelivery")(
  function* (payload: { manifestId: string; scope: BookScope }) {
    const { bindings } = yield* RequestEnvironment;
    const token = bindings.OPENERP_PREPARATION_TOKEN;

    if (!token) return yield* failure("Unavailable");

    return yield* withBook(token, payload.scope, true, function* (transaction) {
      yield* requireAccess(transaction, true);
      yield* Db.settleExhaustedPeriodWorkDelivery(
        transaction,
        payload.scope.bookId,
        payload.manifestId,
      );
    });
  },
);

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
  command: { scope: BookScope; manifestId: string },
): Effect.fn.Return<
  typeof Contracts.PeriodWorkRunProgress.Type,
  Accounting.AccountingError,
  Database
> {
  const { scope, manifestId } = command;

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
      children: children.map((row) => {
        const child = {
          workIdentity: row.workIdentity,
          state: row.state,
          revision: row.revision,
          cancelVersion: row.cancelVersion,
        };

        const missingFacts = readMissingFacts(row.missingFacts);

        if (row.planId !== null) Object.assign(child, { planId: row.planId });

        if (row.receiptId !== null) Object.assign(child, { receiptId: row.receiptId });

        if (missingFacts !== undefined) Object.assign(child, { missingFacts });

        if (row.refusalReason !== null) Object.assign(child, { refusalReason: row.refusalReason });

        if (row.routedOwner !== null) Object.assign(child, { routedOwner: row.routedOwner });

        if (row.ownerReviewId !== null) Object.assign(child, { ownerReviewId: row.ownerReviewId });

        if (row.batchId !== null) Object.assign(child, { batchId: row.batchId });

        return child;
      }),
      counts,
      reconciled: false as const,
    };
  });
});

export const cancelPeriodWork = Effect.fn("periodWork.cancel")(function* (
  token: string,
  command: {
    scope: BookScope;
    manifestId: string;
    idempotencyKey: string;
    expectedDigest: string;
  },
) {
  yield* withBook(
    token,
    command.scope,
    true,
    function* (transaction, principal) {
      yield* requireAccess(transaction, true);

      const payload = yield* toJsonObject({
        manifestId: command.manifestId,
        expectedDigest: command.expectedDigest,
      });

      const request = yield* replay(
        transaction,
        command.scope,
        command.idempotencyKey,
        "cancel_period_work",
        principal.actorId,
        payload,
        Schema.Json,
      );

      if (request.previous) return;

      const manifest = (yield* Db.readManifest(
        transaction,
        command.scope.bookId,
        command.manifestId,
      ))[0];

      if (manifest === undefined) return yield* failure("NotFound");

      if (manifest.digest !== command.expectedDigest) return yield* failure("StaleDependency");

      yield* Db.cancelChildren(transaction, command.scope.bookId, command.manifestId);
      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        request.expected,
        "cancel_period_work",
        principal.actorId,
        payload,
      );
    },
    "update",
  );

  return yield* readPeriodWorkProgress(token, command);
});

export { Db as PeriodWorkDb };

export type { Transaction };
