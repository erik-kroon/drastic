// NEXT-16: tx-passing persistence for period work.
//
// Every function here takes the caller's transaction. None of them opens one,
// starts a runtime, calls HTTP or commits. The application owner decides
// admission, routing and progression; this module only reads and writes the
// frozen manifest, the child checkpoint and the sealed batch.

import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type * as EffectSchema from "effect/Schema";
import * as Effect from "effect/Effect";

import type { Transaction } from "./transaction";
import * as Schema from "./schema";
import { readTableAccess } from "./commerce/access";
import { textArray } from "./sql-values";
import type { WorkChildState } from "@open-erp/domain/period-work";

type JsonObject = EffectSchema.JsonObject;

export function readExecutionResult(
  transaction: Transaction,
  bookId: string,
  batchId: string,
  commandKey: string,
) {
  return transaction
    .select()
    .from(Schema.periodWorkExecutionResults)
    .where(
      and(
        eq(Schema.periodWorkExecutionResults.bookId, bookId),
        eq(Schema.periodWorkExecutionResults.batchId, batchId),
        eq(Schema.periodWorkExecutionResults.commandKey, commandKey),
      ),
    );
}

export function insertExecutionResult(
  transaction: Transaction,
  input: {
    bookId: string;
    batchId: string;
    commandKey: string;
    actorId: string;
    body: JsonObject;
  },
) {
  return transaction.insert(Schema.periodWorkExecutionResults).values(input).onConflictDoNothing();
}

export type TableAccess = {
  readonly tableName: string;
  readonly canSelect: boolean;
  readonly canInsert: boolean;
  readonly canUpdate: boolean;
};

// The tables this owner reads and writes. The writable subset is what the
// insert privilege is asked for, so the required write tables are never the
// only ones denied.
export const periodWorkTables = [
  "period_work_manifests",
  "period_work_children",
  "period_work_batches",
  "period_work_batch_members",
  "period_work_batch_approvals",
  "period_work_execution_results",
] as const;

const writable = new Set<string>([
  "period_work_manifests",
  "period_work_children",
  "period_work_batches",
  "period_work_batch_members",
  "period_work_batch_approvals",
  "period_work_execution_results",
]);

export function isPeriodWorkWritable(tableName: string): boolean {
  return writable.has(tableName);
}

export function readPeriodWorkAccess(transaction: Transaction) {
  return readTableAccess(transaction, periodWorkTables);
}

export type ManifestRow = {
  readonly bookId: string;
  readonly id: string;
  readonly startsOn: string;
  readonly endsOn: string;
  readonly cutoff: string;
  readonly populationComplete: boolean;
  readonly selectedCount: number;
  readonly body: JsonObject;
  readonly digest: string;
};

export function readManifest(transaction: Transaction, bookId: string, id: string) {
  return transaction
    .select()
    .from(Schema.periodWorkManifests)
    .where(
      and(eq(Schema.periodWorkManifests.bookId, bookId), eq(Schema.periodWorkManifests.id, id)),
    );
}

export function insertManifest(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly startsOn: string;
    readonly endsOn: string;
    readonly cutoff: string;
    readonly populationComplete: boolean;
    readonly selectedCount: number;
    readonly body: JsonObject;
    readonly digest: string;
  },
) {
  return transaction.insert(Schema.periodWorkManifests).values([row]);
}

/**
 * The books this runner may advance. The run token is admitted first, so this
 * read is only reachable by the runner actor and it is bounded rather than a
 * full sweep of the installation.
 */
export function readRunnerBooks(transaction: Transaction) {
  return transaction.execute<{ readonly id: string }>(
    sql`
       select distinct b.id
        from openerp.books b
         join openerp.period_work_manifests m on m.book_id = b.id
         join openerp.period_work_children c on c.book_id = m.book_id and c.manifest_id = m.id
        where c.state in ('pending', 'waiting_predecessor')
       order by b.id
       limit 50
    `,
    "objects",
  );
}

/**
 * The manifests this book still has open work in, rediscovered from the children
 * themselves rather than from a queue row. effect-mq owns the claim, the retry
 * and the lease; this read only answers "what is still runnable", so a lost
 * enqueue is picked up again on the next poll rather than stranding the run.
 */
export function readOpenPeriodWorkRuns(transaction: Transaction, bookId: string, bounded: number) {
  return transaction.execute<{
    readonly manifestId: string;
    readonly entityId: string | null;
    readonly openCount: string;
    readonly checkpoint: string;
  }>(
    sql`
      select m.id as "manifestId", b.entity_id as "entityId",
        count(*) filter (where c.state in ('pending', 'waiting_predecessor'))::text as "openCount",
        sum(c.revision)::text as checkpoint
        from openerp.period_work_manifests m
        join openerp.books b on b.id = m.book_id
        join openerp.period_work_children c on c.book_id = m.book_id and c.manifest_id = m.id
       where m.book_id = ${bookId}
       group by m.id, b.entity_id
        having count(*) filter (where c.state in ('pending', 'waiting_predecessor')) > 0
       order by m.id
       limit ${bounded}
    `,
    "objects",
  );
}

export function cancelChildren(transaction: Transaction, bookId: string, manifestId: string) {
  return transaction.execute(sql`
    update openerp.period_work_children
    set state = 'refused', refusal_reason = 'cancelled',
      revision = revision + 1, cancel_version = cancel_version + 1, updated_at = clock_timestamp()
    where book_id = ${bookId} and manifest_id = ${manifestId}
      and state not in ('committed', 'recovered', 'refused')
  `);
}

/**
 * A run whose delivery is exhausted becomes a review case, one child at a time.
 *
 * Only the children the claim query treats as open are moved, so a child that is
 * already prepared, committed, recovered or refused is never touched here. The
 * child names the fact a human must resolve, which is the delivery itself and not
 * a domain block, so it lands in `needs_review` rather than `refused` and keeps
 * the ordinary review path. `cancel_version` is deliberately not advanced: that
 * column is the cancellation fence, and no cancellation happened.
 *
 * This is a plain statement rather than the observed-pair `advanceChild` fence
 * because it is a whole-run decision taken under the book lock, not a claim about
 * one child's current progress. Its effect is the same as a fence: a handler
 * holding an older revision updates zero rows.
 */
export function settleExhaustedPeriodWorkDelivery(
  transaction: Transaction,
  bookId: string,
  manifestId: string,
) {
  return transaction.execute<{ readonly workIdentity: string }>(
    sql`
      update openerp.period_work_children
      set state = 'needs_review',
        missing_facts = jsonb_build_object('facts', array['delivery_exhausted']::text[]),
        batch_id = null, revision = revision + 1, updated_at = clock_timestamp()
      where book_id = ${bookId} and manifest_id = ${manifestId}
        and state in ('pending', 'waiting_predecessor')
      returning work_identity as "workIdentity"
    `,
    "objects",
  );
}

// The state column carries a CHECK constraint that admits exactly the seven
// period-work states, so the narrowed type is the database's own guarantee and
// not an assertion at the call site.
export type ChildRow = {
  readonly bookId: string;
  readonly workIdentity: string;
  readonly manifestId: string;
  readonly economicIdentity: string;
  readonly sourceRevision: string;
  readonly state: WorkChildState;
  readonly revision: string;
  readonly cancelVersion: string;
  readonly planId: string | null;
  readonly planDigest: string | null;
  readonly receiptId: string | null;
  readonly missingFacts: JsonObject | null;
  readonly refusalReason: string | null;
  readonly batchId: string | null;
  readonly routedOwner: string | null;
  readonly ownerReviewId: string | null;
  readonly ownerReviewDigest: string | null;
};

const childColumns = {
  bookId: Schema.periodWorkChildren.bookId,
  workIdentity: Schema.periodWorkChildren.workIdentity,
  manifestId: Schema.periodWorkChildren.manifestId,
  economicIdentity: Schema.periodWorkChildren.economicIdentity,
  sourceRevision: Schema.periodWorkChildren.sourceRevision,
  state: Schema.periodWorkChildren.state,
  revision: sql<string>`${Schema.periodWorkChildren.revision}::text`,
  cancelVersion: sql<string>`${Schema.periodWorkChildren.cancelVersion}::text`,
  planId: Schema.periodWorkChildren.planId,
  planDigest: Schema.periodWorkChildren.planDigest,
  receiptId: Schema.periodWorkChildren.receiptId,
  missingFacts: Schema.periodWorkChildren.missingFacts,
  refusalReason: Schema.periodWorkChildren.refusalReason,
  batchId: Schema.periodWorkChildren.batchId,
  routedOwner: Schema.periodWorkChildren.routedOwner,
  ownerReviewId: Schema.periodWorkChildren.ownerReviewId,
  ownerReviewDigest: Schema.periodWorkChildren.ownerReviewDigest,
};

export function insertChildren(
  transaction: Transaction,
  rows: ReadonlyArray<{
    readonly bookId: string;
    readonly workIdentity: string;
    readonly manifestId: string;
    readonly economicIdentity: string;
    readonly sourceRevision: string;
  }>,
) {
  if (rows.length === 0) return transaction.execute(sql`select 1`, "objects");

  return transaction
    .insert(Schema.periodWorkChildren)
    .values(rows.map((row) => ({ ...row, state: "pending" as const })));
}

export function readChildren(transaction: Transaction, bookId: string, manifestId: string) {
  return transaction
    .select(childColumns)
    .from(Schema.periodWorkChildren)
    .where(
      and(
        eq(Schema.periodWorkChildren.bookId, bookId),
        eq(Schema.periodWorkChildren.manifestId, manifestId),
      ),
    )
    .orderBy(asc(Schema.periodWorkChildren.workIdentity));
}

export function readChild(transaction: Transaction, bookId: string, workIdentity: string) {
  return transaction
    .select(childColumns)
    .from(Schema.periodWorkChildren)
    .where(
      and(
        eq(Schema.periodWorkChildren.bookId, bookId),
        eq(Schema.periodWorkChildren.workIdentity, workIdentity),
      ),
    );
}

/**
 * Lock one child for update. The lock is taken after the book lock, in the
 * shared global order, and it is what makes the revision comparison below a
 * real fence rather than a hopeful read.
 */
export function lockChild(transaction: Transaction, bookId: string, workIdentity: string) {
  return transaction.execute(
    sql`select work_identity from openerp.period_work_children
        where book_id = ${bookId} and work_identity = ${workIdentity}
        for update`,
    "objects",
  );
}

export type ChildAdvance = {
  readonly bookId: string;
  readonly workIdentity: string;
  readonly state: WorkChildState;
  readonly revision: string;
  readonly cancelVersion: string;
  readonly planId: string | null;
  readonly planDigest: string | null;
  readonly receiptId: string | null;
  readonly missingFacts: JsonObject | null;
  readonly refusalReason: string | null;
  readonly batchId: string | null;
  readonly routedOwner: string | null;
  readonly ownerReviewId: string | null;
  readonly ownerReviewDigest: string | null;
};

/**
 * Advance one child, fenced on the revision the caller observed.
 *
 * The WHERE clause names the observed revision and cancellation version, so a
 * handler that captured stale progress updates zero rows rather than
 * overwriting a newer state. The caller must treat a zero-row result as stale
 * and must not publish a result it computed from the older state.
 *
 * `revision` and `cancelVersion` in the payload are the *new* values the caller
 * wants; the fence is the pair it observed, passed separately as `observed`.
 */
export function advanceChild(
  transaction: Transaction,
  advance: ChildAdvance,
  observed: { readonly revision: string; readonly cancelVersion: string },
) {
  return transaction
    .update(Schema.periodWorkChildren)
    .set({
      state: advance.state,
      revision: BigInt(advance.revision),
      cancelVersion: BigInt(advance.cancelVersion),
      planId: advance.planId,
      planDigest: advance.planDigest,
      receiptId: advance.receiptId,
      missingFacts: advance.missingFacts,
      refusalReason: advance.refusalReason,
      batchId: advance.batchId,
      routedOwner: advance.routedOwner,
      ownerReviewId: advance.ownerReviewId,
      ownerReviewDigest: advance.ownerReviewDigest,
      updatedAt: sql`clock_timestamp()`,
    })
    .where(
      and(
        eq(Schema.periodWorkChildren.bookId, advance.bookId),
        eq(Schema.periodWorkChildren.workIdentity, advance.workIdentity),
        eq(Schema.periodWorkChildren.revision, BigInt(observed.revision)),
        eq(Schema.periodWorkChildren.cancelVersion, BigInt(observed.cancelVersion)),
      ),
    )
    .returning({ workIdentity: Schema.periodWorkChildren.workIdentity });
}

export function readTerminalReceipts(
  transaction: Transaction,
  bookId: string,
  workIdentities: ReadonlyArray<string>,
) {
  return transaction
    .select({
      workIdentity: Schema.periodWorkChildren.workIdentity,
      state: Schema.periodWorkChildren.state,
      receiptId: Schema.periodWorkChildren.receiptId,
    })
    .from(Schema.periodWorkChildren)
    .where(
      workIdentities.length === 0
        ? sql`false`
        : and(
            eq(Schema.periodWorkChildren.bookId, bookId),
            inArray(Schema.periodWorkChildren.workIdentity, [...workIdentities]),
          ),
    );
}

export function insertBatch(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly manifestId: string;
    readonly memberCount: number;
    readonly combinedInformationalMinor: string;
    readonly body: JsonObject;
    readonly digest: string;
  },
) {
  return transaction.insert(Schema.periodWorkBatches).values([row]);
}

export function readBatch(transaction: Transaction, bookId: string, id: string) {
  return transaction
    .select({
      bookId: Schema.periodWorkBatches.bookId,
      id: Schema.periodWorkBatches.id,
      manifestId: Schema.periodWorkBatches.manifestId,
      memberCount: Schema.periodWorkBatches.memberCount,
      combinedInformationalMinor: Schema.periodWorkBatches.combinedInformationalMinor,
      body: Schema.periodWorkBatches.body,
      digest: Schema.periodWorkBatches.digest,
      recordedAt: Schema.periodWorkBatches.recordedAt,
    })
    .from(Schema.periodWorkBatches)
    .where(and(eq(Schema.periodWorkBatches.bookId, bookId), eq(Schema.periodWorkBatches.id, id)));
}

export function insertBatchMembers(
  transaction: Transaction,
  rows: ReadonlyArray<{
    readonly bookId: string;
    readonly batchId: string;
    readonly ordinal: number;
    readonly owner: string;
    readonly planId: string;
    readonly planDigest: string;
    readonly inputIdentity: string;
    readonly workIdentity: string;
    readonly ownerReviewId: string;
    readonly ownerReviewDigest: string;
  }>,
) {
  if (rows.length === 0) return transaction.execute(sql`select 1`, "objects");

  return transaction.insert(Schema.periodWorkBatchMembers).values([...rows]);
}

export function readBatchMembers(transaction: Transaction, bookId: string, batchId: string) {
  return transaction
    .select()
    .from(Schema.periodWorkBatchMembers)
    .where(
      and(
        eq(Schema.periodWorkBatchMembers.bookId, bookId),
        eq(Schema.periodWorkBatchMembers.batchId, batchId),
      ),
    )
    .orderBy(asc(Schema.periodWorkBatchMembers.ordinal));
}

export function insertBatchApproval(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly batchId: string;
    readonly memberOrdinal: number;
    readonly owner: string;
    readonly ownerApprovalId: string;
    readonly planDigest: string;
    readonly approverId: string;
  },
) {
  return transaction.insert(Schema.periodWorkBatchApprovals).values([row]);
}

export type BatchApprovalRow = {
  readonly bookId: string;
  readonly batchId: string;
  readonly memberOrdinal: string;
  readonly approvalId: string;
  readonly planDigest: string;
  readonly approverId: string;
};

export function readBatchApproval(transaction: Transaction, bookId: string, batchId: string) {
  return transaction
    .select({
      bookId: Schema.periodWorkBatchApprovals.bookId,
      batchId: Schema.periodWorkBatchApprovals.batchId,
      memberOrdinal: Schema.periodWorkBatchApprovals.memberOrdinal,
      owner: Schema.periodWorkBatchApprovals.owner,
      ownerApprovalId: Schema.periodWorkBatchApprovals.ownerApprovalId,
      planDigest: Schema.periodWorkBatchApprovals.planDigest,
      approverId: Schema.periodWorkBatchApprovals.approverId,
    })
    .from(Schema.periodWorkBatchApprovals)
    .where(
      and(
        eq(Schema.periodWorkBatchApprovals.bookId, bookId),
        eq(Schema.periodWorkBatchApprovals.batchId, batchId),
      ),
    )
    .orderBy(asc(Schema.periodWorkBatchApprovals.memberOrdinal));
}

export type BatchMemberRow = {
  readonly bookId: string;
  readonly batchId: string;
  readonly ordinal: string;
  readonly owner: string;
  readonly planId: string;
  readonly planDigest: string;
  readonly inputIdentity: string;
  readonly workIdentity: string;
  readonly ownerReviewId: string;
  readonly ownerReviewDigest: string;
};

/**
 * The recognized obligations this book already holds, keyed by the economic
 * identity a child carries. A child whose economic identity is already
 * recognized is a settlement or a correction, never a second recognition. The
 * read is one bounded set across both recognition owners rather than a lookup
 * per child.
 */
export function readRecognizedObligations(
  transaction: Transaction,
  bookId: string,
  economicIdentities: ReadonlyArray<string>,
) {
  if (economicIdentities.length === 0)
    return Effect.succeed<ReadonlyArray<RecognizedObligation>>([]);

  return transaction.execute<RecognizedObligation>(
    sql`
      select economic_key as "economicIdentity", 'purchases.recognition'::text as owner,
        voucher_id as "voucherId", id as "recognitionId"
        from openerp.purchase_recognitions
        where book_id = ${bookId} and economic_key = any(${textArray(economicIdentities)})
      union all
      select economic_key as "economicIdentity", 'owner.operations'::text as owner,
        voucher_id as "voucherId", id as "recognitionId"
        from openerp.owner_purchase_recognitions
        where book_id = ${bookId} and economic_key = any(${textArray(economicIdentities)})
    `,
    "objects",
  );
}

// A recognized obligation this book already holds. The owner is the operation
// that wrote the recognition, so routing never re-derives it.
export type RecognizedObligation = {
  readonly economicIdentity: string;
  readonly owner: string;
  readonly voucherId: string | null;
  readonly recognitionId: string;
};

/** The exact plans a batch names, loaded in one bounded set rather than per member. */
export function readPlans(
  transaction: Transaction,
  bookId: string,
  planIds: ReadonlyArray<string>,
) {
  return transaction
    .select({
      bookId: Schema.changeSets.bookId,
      id: Schema.changeSets.id,
      plan: Schema.changeSets.plan,
      digest: Schema.changeSets.digest,
    })
    .from(Schema.changeSets)
    .where(
      planIds.length === 0
        ? sql`false`
        : and(eq(Schema.changeSets.bookId, bookId), inArray(Schema.changeSets.id, [...planIds])),
    )
    .orderBy(asc(Schema.changeSets.id));
}

export type PlanRow = {
  readonly bookId: string;
  readonly id: string;
  readonly plan: JsonObject;
  readonly digest: string;
};
