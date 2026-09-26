import { and, eq, sql } from "drizzle-orm";
import * as Schema from "effect/Schema";
import {
  ruleChangeNotices,
  ruleImpactDecisions,
  ruleImpactSnapshots,
  ruleImpactTargets,
  ruleReleases,
} from "./schema";
import type { Transaction } from "./transaction";

type JsonObject = Schema.JsonObject;

export const ruleImpactReadTables = [
  "rule_change_notices",
  "rule_impact_snapshots",
  "rule_impact_targets",
  "rule_impact_decisions",
  "rule_releases",
  "company_activations",
  "deadline_obligations",
  "deadline_fulfillments",
  "books",
  "command_receipts",
] as const;

export const ruleImpactInsertTables = [
  "rule_change_notices",
  "rule_impact_snapshots",
  "rule_impact_targets",
  "rule_impact_decisions",
  "command_receipts",
] as const;

export type TableAccess = {
  readonly tableName: string;
  readonly canSelect: boolean;
  readonly canInsert: boolean;
};

export type BodyRow = { readonly body: JsonObject };

export type ReleaseRow = {
  readonly id: string;
  readonly jurisdiction: string;
  readonly family: string;
  readonly version: number;
  readonly checksum: string;
  readonly body: JsonObject;
};

// The two real retained references to a superseded rule release in this tree.
// A free-text document mention is not a dependency and is never selected.
export type DeadlineTargetRow = {
  readonly targetId: string;
  readonly targetRevision: string;
  readonly family: string;
  readonly periodId: string;
  readonly periodStartsOn: string;
  readonly periodEndsOn: string;
  readonly usedRule: string;
  readonly statutoryBasis: JsonObject;
  readonly outcomeRecorded: boolean;
  readonly outcomeKind: string | null;
};

export type ActivationTargetRow = {
  readonly targetId: string;
  readonly targetRevision: string;
  readonly family: string;
  readonly periodStartsOn: string;
  readonly periodEndsOn: string | null;
  readonly usedRule: string;
  readonly effectiveFrom: string;
  readonly digest: string;
};

export function readRuleImpactAccess(transaction: Transaction) {
  return transaction.execute<TableAccess>(
    sql`
      select
        requested.table_name as "tableName",
        case when to_regclass('openerp.' || requested.table_name) is null then false
          else has_table_privilege(current_user, 'openerp.' || requested.table_name, 'select') end as "canSelect",
        case when requested.table_name = any(array[${sql.join(
          ruleImpactInsertTables.map((name) => sql`${name}`),
          sql`, `,
        )}]::text[]) then false
          when to_regclass('openerp.' || requested.table_name) is null then false
          else has_table_privilege(current_user, 'openerp.' || requested.table_name, 'insert') end as "canInsert"
      from unnest(array[${sql.join(
        ruleImpactReadTables.map((name) => sql`${name}`),
        sql`, `,
      )}]::text[]) as requested(table_name)
    `,
    "objects",
  );
}

export function readRelease(transaction: Transaction, id: string) {
  return transaction
    .select({
      id: ruleReleases.id,
      jurisdiction: ruleReleases.jurisdiction,
      family: ruleReleases.family,
      version: ruleReleases.version,
      checksum: ruleReleases.checksum,
      body: ruleReleases.body,
    })
    .from(ruleReleases)
    .where(eq(ruleReleases.id, id));
}

export function lockNotice(transaction: Transaction, bookId: string, id: string) {
  return transaction
    .select({ id: ruleChangeNotices.id, body: ruleChangeNotices.body })
    .from(ruleChangeNotices)
    .where(and(eq(ruleChangeNotices.bookId, bookId), eq(ruleChangeNotices.id, id)))
    .for("update");
}

export function readNotice(transaction: Transaction, bookId: string, id: string) {
  return transaction
    .select({ id: ruleChangeNotices.id, body: ruleChangeNotices.body })
    .from(ruleChangeNotices)
    .where(and(eq(ruleChangeNotices.bookId, bookId), eq(ruleChangeNotices.id, id)));
}

export function listNotices(transaction: Transaction, bookId: string) {
  return transaction
    .select({ body: ruleChangeNotices.body })
    .from(ruleChangeNotices)
    .where(eq(ruleChangeNotices.bookId, bookId))
    .orderBy(ruleChangeNotices.capturedAt, ruleChangeNotices.id);
}

export function listSnapshots(transaction: Transaction, bookId: string) {
  return transaction
    .select({
      id: ruleImpactSnapshots.id,
      noticeId: ruleImpactSnapshots.noticeId,
      recordedCutoff: ruleImpactSnapshots.recordedCutoff,
      completeTargetMembership: ruleImpactSnapshots.completeTargetMembership,
      totalTargets: ruleImpactSnapshots.totalTargets,
      decidedTargets: sql<number>`(
        select count(*)::integer from ${ruleImpactDecisions}
        where ${ruleImpactDecisions.bookId} = ${ruleImpactSnapshots.bookId}
          and ${ruleImpactDecisions.snapshotId} = ${ruleImpactSnapshots.id}
      )`,
    })
    .from(ruleImpactSnapshots)
    .where(eq(ruleImpactSnapshots.bookId, bookId))
    .orderBy(ruleImpactSnapshots.recordedCutoff, ruleImpactSnapshots.id);
}

const snapshotSelection = {
  id: ruleImpactSnapshots.id,
  noticeId: ruleImpactSnapshots.noticeId,
  recordedCutoff: ruleImpactSnapshots.recordedCutoff,
  completeTargetMembership: ruleImpactSnapshots.completeTargetMembership,
  totalTargets: ruleImpactSnapshots.totalTargets,
};

export function lockSnapshot(transaction: Transaction, bookId: string, id: string) {
  return transaction
    .select(snapshotSelection)
    .from(ruleImpactSnapshots)
    .where(and(eq(ruleImpactSnapshots.bookId, bookId), eq(ruleImpactSnapshots.id, id)))
    .for("update");
}

export function readSnapshot(transaction: Transaction, bookId: string, id: string) {
  return transaction
    .select(snapshotSelection)
    .from(ruleImpactSnapshots)
    .where(and(eq(ruleImpactSnapshots.bookId, bookId), eq(ruleImpactSnapshots.id, id)));
}

export function countSnapshotDecisions(
  transaction: Transaction,
  bookId: string,
  snapshotId: string,
) {
  return transaction.execute<{ readonly decided: number }>(
    sql`
      select count(*)::integer as decided from openerp.rule_impact_decisions
      where book_id = ${bookId} and snapshot_id = ${snapshotId}
    `,
    "objects",
  );
}

export function readDecision(transaction: Transaction, bookId: string, id: string) {
  return transaction
    .select({ body: ruleImpactDecisions.body })
    .from(ruleImpactDecisions)
    .where(and(eq(ruleImpactDecisions.bookId, bookId), eq(ruleImpactDecisions.id, id)));
}

export function readTarget(
  transaction: Transaction,
  bookId: string,
  snapshotId: string,
  targetKind: string,
  targetId: string,
) {
  return transaction
    .select({
      targetKind: ruleImpactTargets.targetKind,
      targetId: ruleImpactTargets.targetId,
      targetRevision: ruleImpactTargets.targetRevision,
      periodId: ruleImpactTargets.periodId,
      periodStartsOn: ruleImpactTargets.periodStartsOn,
      periodEndsOn: ruleImpactTargets.periodEndsOn,
      family: ruleImpactTargets.family,
      usedRule: ruleImpactTargets.usedRule,
      impactKind: ruleImpactTargets.impactKind,
      body: ruleImpactTargets.body,
    })
    .from(ruleImpactTargets)
    .where(
      and(
        eq(ruleImpactTargets.bookId, bookId),
        eq(ruleImpactTargets.snapshotId, snapshotId),
        eq(ruleImpactTargets.targetKind, targetKind),
        eq(ruleImpactTargets.targetId, targetId),
      ),
    )
    .for("share");
}

export function listTargets(
  transaction: Transaction,
  bookId: string,
  snapshotId: string,
  after: number,
  limit: number,
) {
  return transaction
    .select({
      ordinal: ruleImpactTargets.ordinal,
      body: ruleImpactTargets.body,
      decisionKind: ruleImpactDecisions.decisionKind,
      decisionReason: ruleImpactDecisions.reason,
    })
    .from(ruleImpactTargets)
    .leftJoin(
      ruleImpactDecisions,
      and(
        eq(ruleImpactDecisions.bookId, ruleImpactTargets.bookId),
        eq(ruleImpactDecisions.snapshotId, ruleImpactTargets.snapshotId),
        eq(ruleImpactDecisions.targetKind, ruleImpactTargets.targetKind),
        eq(ruleImpactDecisions.targetId, ruleImpactTargets.targetId),
        eq(ruleImpactDecisions.targetRevision, ruleImpactTargets.targetRevision),
      ),
    )
    .where(
      and(
        eq(ruleImpactTargets.bookId, bookId),
        eq(ruleImpactTargets.snapshotId, snapshotId),
        sql`${ruleImpactTargets.ordinal} > ${after}`,
      ),
    )
    .orderBy(ruleImpactTargets.ordinal)
    .limit(limit);
}

export function listDecisions(transaction: Transaction, bookId: string, noticeId: string) {
  return transaction
    .select({ body: ruleImpactDecisions.body })
    .from(ruleImpactDecisions)
    .where(and(eq(ruleImpactDecisions.bookId, bookId), eq(ruleImpactDecisions.noticeId, noticeId)))
    .orderBy(ruleImpactDecisions.recordedAt, ruleImpactDecisions.id);
}

export function readDecisionCase(
  transaction: Transaction,
  bookId: string,
  noticeId: string,
  targetKind: string,
  targetId: string,
  targetRevision: string,
) {
  return transaction
    .select({ id: ruleImpactDecisions.id })
    .from(ruleImpactDecisions)
    .where(
      and(
        eq(ruleImpactDecisions.bookId, bookId),
        eq(ruleImpactDecisions.noticeId, noticeId),
        eq(ruleImpactDecisions.targetKind, targetKind),
        eq(ruleImpactDecisions.targetId, targetId),
        eq(ruleImpactDecisions.targetRevision, targetRevision),
      ),
    )
    .for("share");
}

// A deadline is a target when its retained qualified basis names the superseded
// rule. Free text and document bodies are never scanned for a mention.
export function selectDeadlineTargets(
  transaction: Transaction,
  bookId: string,
  releaseId: string,
  from: string,
  to: string,
) {
  return transaction.execute<DeadlineTargetRow>(
    sql`
      select o.id as "targetId", o.revision::text as "targetRevision",
        o.statutory_basis ->> 'family'::text as family,
        o.period_id as "periodId", p.starts_on::text as "periodStartsOn",
        p.ends_on::text as "periodEndsOn",
        o.statutory_basis ->> 'ruleReference'::text as "usedRule",
        o.statutory_basis as "statutoryBasis",
        (o.outcome_reference is not null) as "outcomeRecorded",
        case when o.outcome_reference is null then null else o.outcome_kind end as "outcomeKind"
      from openerp.deadline_obligations o
      join openerp.periods p on p.book_id = o.book_id and p.id = o.period_id
      where o.book_id = ${bookId}
        and o.statutory_basis ->> 'ruleReference'::text = ${releaseId}
        and p.ends_on >= ${from}::date and p.starts_on <= ${to}::date
      order by o.period_id, o.id
      limit 501
    `,
    "objects",
  );
}

export function selectActivationTargets(
  transaction: Transaction,
  bookId: string,
  releaseId: string,
  from: string,
  to: string,
) {
  return transaction.execute<ActivationTargetRow>(
    sql`
      select a.id as "targetId", a.effective_from::text as "effectiveFrom",
        a.family as family, a.effective_from::text as "periodStartsOn",
        a.effective_to::text as "periodEndsOn", a.rule_release_id as "usedRule",
        a.digest as digest, a.digest as "targetRevision"
      from openerp.company_activations a
      where a.book_id = ${bookId} and a.rule_release_id = ${releaseId}
        and a.effective_from <= ${to}::date
        and coalesce(a.effective_to, ${to}::date) >= ${from}::date
      order by a.family, a.id
      limit 501
    `,
    "objects",
  );
}

export function insertNotice(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly oldReleaseId: string;
    readonly newReleaseId: string;
    readonly changeKind: string;
    readonly effectiveFrom: string;
    readonly effectiveTo: string | null;
    readonly reason: string;
    readonly qualificationEvidence: JsonObject;
    readonly changedSelectors: ReadonlyArray<string>;
    readonly capturedBy: string;
    readonly capturedAt: string;
    readonly digest: string;
    readonly body: JsonObject;
  },
) {
  return transaction
    .insert(ruleChangeNotices)
    .values([{ ...row, changedSelectors: [...row.changedSelectors] }]);
}

export function insertSnapshot(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly noticeId: string;
    readonly recordedCutoff: string;
    readonly completeTargetMembership: boolean;
    readonly totalTargets: number;
    readonly body: JsonObject;
  },
) {
  return transaction.insert(ruleImpactSnapshots).values([row]);
}

export function insertTarget(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly snapshotId: string;
    readonly ordinal: number;
    readonly targetKind: string;
    readonly targetId: string;
    readonly targetRevision: string;
    readonly family: string;
    readonly periodId: string | null;
    readonly periodStartsOn: string | null;
    readonly periodEndsOn: string | null;
    readonly usedRule: string;
    readonly basisDigest: string;
    readonly impactKind: string;
    readonly body: JsonObject;
  },
) {
  return transaction.insert(ruleImpactTargets).values([row]);
}

export function insertDecision(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly snapshotId: string;
    readonly noticeId: string;
    readonly targetKind: string;
    readonly targetId: string;
    readonly targetRevision: string;
    readonly decisionKind: string;
    readonly reason: string;
    readonly evidence: JsonObject;
    readonly proposedSuccessor: JsonObject | null;
    readonly reviewer: string;
    readonly recordedAt: string;
    readonly digest: string;
    readonly body: JsonObject;
  },
) {
  return transaction.insert(ruleImpactDecisions).values([row]);
}
