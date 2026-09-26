// NEXT-16: tx-passing persistence for period work.
//
// Every function here takes the caller's transaction. None of them opens one,
// starts a runtime, calls HTTP or commits. The application owner decides
// admission, routing and progression; this module only reads and writes the
// frozen manifest, the child checkpoint and the sealed batch.

import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type * as EffectSchema from "effect/Schema";

import type { Transaction } from "../connection";
import * as Schema from "../schema";
import { readTableAccess } from "../commerce/access";

type JsonObject = EffectSchema.JsonObject;

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
] as const;

const writable = new Set<string>([
  "period_work_manifests",
  "period_work_children",
  "period_work_batches",
  "period_work_batch_members",
  "period_work_batch_approvals",
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

export type ChildRow = {
  readonly bookId: string;
  readonly workIdentity: string;
  readonly manifestId: string;
  readonly economicIdentity: string;
  readonly sourceRevision: string;
  readonly state: string;
  readonly revision: string;
  readonly cancelVersion: string;
  readonly planId: string | null;
  readonly planDigest: string | null;
  readonly receiptId: string | null;
  readonly missingFacts: JsonObject | null;
  readonly refusalReason: string | null;
  readonly batchId: string | null;
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
    .select()
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
    .select()
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
  readonly state: string;
  readonly revision: string;
  readonly cancelVersion: string;
  readonly planId: string | null;
  readonly planDigest: string | null;
  readonly receiptId: string | null;
  readonly missingFacts: JsonObject | null;
  readonly refusalReason: string | null;
  readonly batchId: string | null;
};

/**
 * Advance one child, fenced on the revision the caller observed.
 *
 * The WHERE clause names the observed revision and cancellation version, so a
 * handler that captured stale progress updates zero rows rather than
 * overwriting a newer state. The caller must treat a zero-row result as stale
 * and must not publish a result it computed from the older state.
 */
export function advanceChild(transaction: Transaction, advance: ChildAdvance) {
  return transaction
    .update(Schema.periodWorkChildren)
    .set({
      state: advance.state,
      revision: advance.revision,
      cancelVersion: advance.cancelVersion,
      planId: advance.planId,
      planDigest: advance.planDigest,
      receiptId: advance.receiptId,
      missingFacts: advance.missingFacts,
      refusalReason: advance.refusalReason,
      batchId: advance.batchId,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(Schema.periodWorkChildren.bookId, advance.bookId),
        eq(Schema.periodWorkChildren.workIdentity, advance.workIdentity),
        eq(Schema.periodWorkChildren.revision, advance.revision),
        eq(Schema.periodWorkChildren.cancelVersion, advance.cancelVersion),
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
    .select()
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
    readonly approvalId: string;
    readonly approverId: string;
  },
) {
  return transaction.insert(Schema.periodWorkBatchApprovals).values([row]);
}

export function readBatchApproval(transaction: Transaction, bookId: string, batchId: string) {
  return transaction
    .select()
    .from(Schema.periodWorkBatchApprovals)
    .where(
      and(
        eq(Schema.periodWorkBatchApprovals.bookId, bookId),
        eq(Schema.periodWorkBatchApprovals.batchId, batchId),
      ),
    );
}

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

export type { TableAccess };
