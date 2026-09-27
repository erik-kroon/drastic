import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type * as Schema from "effect/Schema";
import {
  corporateTaxBridgeInputs,
  corporateTaxBridges,
  corporateTaxDeclarations,
  corporateTaxEffects,
  periods,
} from "../schema";
import type { Transaction } from "../transaction";

// NEXT-22's typed persistence. Every function here is a bounded parameterized read
// or DML operation on the caller's transaction. Nothing in this module opens a
// connection, starts a runtime, decides policy, computes an amount, validates an
// approval, locks a business resource in a second order or commits anything.

export const corporateTaxTables = [
  "corporate_tax_bridges",
  "corporate_tax_bridge_inputs",
  "corporate_tax_effects",
  "corporate_tax_declarations",
] as const;

export type BridgeRow = {
  readonly id: string;
  readonly fiscalYearId: string;
  readonly accountingPeriodId: string;
  readonly statementSnapshotId: string;
  readonly statementDigest: string;
  readonly changeSetId: string;
  readonly planDigest: string;
  readonly ruleReleaseId: string;
  readonly ruleReleaseChecksum: string;
  readonly ruleReleaseVersion: number;
  readonly overlayDigest: string;
  readonly currentTaxTargetMinor: string;
  readonly recognizedMinor: string;
  readonly deltaMinor: string;
  readonly postsJournal: boolean;
  readonly status: string;
  readonly body: Schema.JsonObject;
  readonly digest: string;
  readonly createdBy: string;
  readonly createdAt: string;
};

export type EffectRow = {
  readonly id: string;
  readonly bridgeId: string;
  readonly changeSetId: string;
  readonly fiscalYearId: string;
  readonly voucherId: string | null;
  readonly approvalId: string;
  readonly yearTaxTargetMinor: string;
  readonly recognizedBeforeMinor: string;
  readonly deltaMinor: string;
  readonly recognizedAfterMinor: string;
  readonly noFinancialEffect: boolean;
  readonly body: Schema.JsonObject;
  readonly digest: string;
  readonly createdBy: string;
  readonly committedAt: string;
};

export type DeclarationRow = {
  readonly id: string;
  readonly ordinal: string;
  readonly bridgeId: string;
  readonly fiscalYearId: string;
  readonly statementSnapshotId: string;
  readonly fieldCount: number;
  readonly fileCount: number;
  readonly blocked: boolean;
  readonly body: Schema.JsonObject;
  readonly digest: string;
  readonly createdBy: string;
  readonly createdAt: string;
};

export type BridgeInputRow = {
  readonly bridgeId: string;
  readonly ordinal: number;
  readonly kind: string;
  readonly resourceId: string;
  readonly version: string;
  readonly reason: string;
};

export type IncomeTaxContributionRow = {
  readonly componentId: string;
  readonly voucherId: string;
  readonly lineId: string;
  readonly sequence: string;
  readonly accountId: string;
  readonly debitMinor: string;
  readonly creditMinor: string;
  readonly signedMinor: string;
  readonly description: string;
};

const bridgeColumns = {
  id: corporateTaxBridges.id,
  fiscalYearId: corporateTaxBridges.fiscalYearId,
  accountingPeriodId: corporateTaxBridges.accountingPeriodId,
  statementSnapshotId: corporateTaxBridges.statementSnapshotId,
  statementDigest: corporateTaxBridges.statementDigest,
  changeSetId: corporateTaxBridges.changeSetId,
  planDigest: corporateTaxBridges.planDigest,
  ruleReleaseId: corporateTaxBridges.ruleReleaseId,
  ruleReleaseChecksum: corporateTaxBridges.ruleReleaseChecksum,
  ruleReleaseVersion: corporateTaxBridges.ruleReleaseVersion,
  overlayDigest: corporateTaxBridges.overlayDigest,
  currentTaxTargetMinor: corporateTaxBridges.currentTaxTargetMinor,
  recognizedMinor: corporateTaxBridges.recognizedMinor,
  deltaMinor: corporateTaxBridges.deltaMinor,
  postsJournal: corporateTaxBridges.postsJournal,
  status: corporateTaxBridges.status,
  body: corporateTaxBridges.body,
  digest: corporateTaxBridges.digest,
  createdBy: corporateTaxBridges.createdBy,
  createdAt: corporateTaxBridges.createdAt,
} as const;

const effectColumns = {
  id: corporateTaxEffects.id,
  bridgeId: corporateTaxEffects.bridgeId,
  changeSetId: corporateTaxEffects.changeSetId,
  fiscalYearId: corporateTaxEffects.fiscalYearId,
  voucherId: corporateTaxEffects.voucherId,
  approvalId: corporateTaxEffects.approvalId,
  yearTaxTargetMinor: corporateTaxEffects.yearTaxTargetMinor,
  recognizedBeforeMinor: corporateTaxEffects.recognizedBeforeMinor,
  deltaMinor: corporateTaxEffects.deltaMinor,
  recognizedAfterMinor: corporateTaxEffects.recognizedAfterMinor,
  noFinancialEffect: corporateTaxEffects.noFinancialEffect,
  body: corporateTaxEffects.body,
  digest: corporateTaxEffects.digest,
  createdBy: corporateTaxEffects.createdBy,
  committedAt: corporateTaxEffects.committedAt,
} as const;

const declarationColumns = {
  id: corporateTaxDeclarations.id,
  ordinal: sql`${corporateTaxDeclarations.ordinal}::text`,
  bridgeId: corporateTaxDeclarations.bridgeId,
  fiscalYearId: corporateTaxDeclarations.fiscalYearId,
  statementSnapshotId: corporateTaxDeclarations.statementSnapshotId,
  fieldCount: corporateTaxDeclarations.fieldCount,
  fileCount: corporateTaxDeclarations.fileCount,
  blocked: corporateTaxDeclarations.blocked,
  body: corporateTaxDeclarations.body,
  digest: corporateTaxDeclarations.digest,
  createdBy: corporateTaxDeclarations.createdBy,
  createdAt: corporateTaxDeclarations.createdAt,
} as const;

export function readBridge(transaction: Transaction, bookId: string, bridgeId: string) {
  return transaction
    .select(bridgeColumns)
    .from(corporateTaxBridges)
    .where(and(eq(corporateTaxBridges.bookId, bookId), eq(corporateTaxBridges.id, bridgeId)));
}

// The bridge is the year-target authority for its own plan, so execution takes the
// row before anything derived from it is read.
export function lockBridge(transaction: Transaction, bookId: string, bridgeId: string) {
  return transaction
    .select(bridgeColumns)
    .from(corporateTaxBridges)
    .where(and(eq(corporateTaxBridges.bookId, bookId), eq(corporateTaxBridges.id, bridgeId)))
    .for("update");
}

export function readBridgesAfter(
  transaction: Transaction,
  bookId: string,
  fiscalYearId: string,
  after: string,
) {
  return transaction
    .select(bridgeColumns)
    .from(corporateTaxBridges)
    .where(
      and(
        eq(corporateTaxBridges.bookId, bookId),
        eq(corporateTaxBridges.fiscalYearId, fiscalYearId),
        sql`${corporateTaxBridges.id} collate "C" > ${after} collate "C"`,
      ),
    )
    .orderBy(sql`${corporateTaxBridges.id} collate "C"`)
    .limit(26);
}

export function readBridgeInputs(transaction: Transaction, bookId: string, bridgeIds: string[]) {
  return transaction
    .select({
      bridgeId: corporateTaxBridgeInputs.bridgeId,
      ordinal: corporateTaxBridgeInputs.ordinal,
      kind: corporateTaxBridgeInputs.kind,
      resourceId: corporateTaxBridgeInputs.resourceId,
      version: corporateTaxBridgeInputs.version,
      reason: corporateTaxBridgeInputs.reason,
    })
    .from(corporateTaxBridgeInputs)
    .where(
      and(
        eq(corporateTaxBridgeInputs.bookId, bookId),
        inArray(corporateTaxBridgeInputs.bridgeId, bridgeIds),
      ),
    )
    .orderBy(asc(corporateTaxBridgeInputs.bridgeId), asc(corporateTaxBridgeInputs.ordinal));
}

export function insertBridge(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly fiscalYearId: string;
    readonly accountingPeriodId: string;
    readonly statementSnapshotId: string;
    readonly statementDigest: string;
    readonly changeSetId: string;
    readonly planDigest: string;
    readonly ruleReleaseId: string;
    readonly ruleReleaseChecksum: string;
    readonly ruleReleaseVersion: number;
    readonly overlayDigest: string;
    readonly currentTaxTargetMinor: string;
    readonly recognizedMinor: string;
    readonly deltaMinor: string;
    readonly postsJournal: boolean;
    readonly status: string;
    readonly noFinancialEffect: boolean;
    readonly body: Schema.JsonObject;
    readonly digest: string;
    readonly createdBy: string;
  },
) {
  return transaction.insert(corporateTaxBridges).values(row);
}

export function insertBridgeInputs(
  transaction: Transaction,
  rows: ReadonlyArray<{
    readonly bookId: string;
    readonly bridgeId: string;
    readonly ordinal: number;
    readonly kind: string;
    readonly resourceId: string;
    readonly version: string;
    readonly reason: string;
  }>,
) {
  return transaction.insert(corporateTaxBridgeInputs).values([...rows]);
}

export function readEffectsForBridges(
  transaction: Transaction,
  bookId: string,
  bridgeIds: string[],
) {
  return transaction
    .select(effectColumns)
    .from(corporateTaxEffects)
    .where(
      and(eq(corporateTaxEffects.bookId, bookId), inArray(corporateTaxEffects.bridgeId, bridgeIds)),
    )
    .orderBy(asc(corporateTaxEffects.id));
}

// The exact effective current-tax effects this owner already recognised for one
// fiscal year. The signed deltas are summed, so a reversal is not a second
// recognition and a partially recognised target still reports what is outstanding.
export function readRecognizedForYear(
  transaction: Transaction,
  bookId: string,
  fiscalYearId: string,
) {
  return transaction.execute<{ readonly minor: string }>(
    sql`
      select coalesce(sum(delta_minor), 0)::text as minor
      from openerp.corporate_tax_effects
      where book_id = ${bookId} and fiscal_year_id = ${fiscalYearId}
    `,
    "objects",
  );
}

export function readEffectsAfter(
  transaction: Transaction,
  bookId: string,
  fiscalYearId: string,
  after: string,
) {
  return transaction
    .select(effectColumns)
    .from(corporateTaxEffects)
    .where(
      and(
        eq(corporateTaxEffects.bookId, bookId),
        eq(corporateTaxEffects.fiscalYearId, fiscalYearId),
        sql`${corporateTaxEffects.id} collate "C" > ${after} collate "C"`,
      ),
    )
    .orderBy(sql`${corporateTaxEffects.id} collate "C"`)
    .limit(201);
}

export function readEffectByBridge(transaction: Transaction, bookId: string, bridgeId: string) {
  return transaction
    .select(effectColumns)
    .from(corporateTaxEffects)
    .where(and(eq(corporateTaxEffects.bookId, bookId), eq(corporateTaxEffects.bridgeId, bridgeId)));
}

export function insertEffect(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly bridgeId: string;
    readonly changeSetId: string;
    readonly fiscalYearId: string;
    readonly voucherId: string | null;
    readonly approvalId: string;
    readonly yearTaxTargetMinor: string;
    readonly recognizedBeforeMinor: string;
    readonly deltaMinor: string;
    readonly recognizedAfterMinor: string;
    readonly noFinancialEffect: boolean;
    readonly body: Schema.JsonObject;
    readonly digest: string;
    readonly createdBy: string;
    readonly committedAt: string;
  },
) {
  return transaction.insert(corporateTaxEffects).values(row);
}

export function readDeclaration(transaction: Transaction, bookId: string, declarationId: string) {
  return transaction
    .select(declarationColumns)
    .from(corporateTaxDeclarations)
    .where(
      and(
        eq(corporateTaxDeclarations.bookId, bookId),
        eq(corporateTaxDeclarations.id, declarationId),
      ),
    );
}

export function readDeclarationsAfter(
  transaction: Transaction,
  bookId: string,
  fiscalYearId: string,
  after: string,
) {
  return transaction
    .select(declarationColumns)
    .from(corporateTaxDeclarations)
    .where(
      and(
        eq(corporateTaxDeclarations.bookId, bookId),
        eq(corporateTaxDeclarations.fiscalYearId, fiscalYearId),
        sql`${corporateTaxDeclarations.id} collate "C" > ${after} collate "C"`,
      ),
    )
    .orderBy(sql`${corporateTaxDeclarations.id} collate "C"`)
    .limit(26);
}

export function readHighestDeclarationOrdinal(transaction: Transaction, bookId: string) {
  return transaction.execute<{ readonly ordinal: string | null }>(
    sql`select max(ordinal)::text as ordinal from openerp.corporate_tax_declarations where book_id = ${bookId}`,
    "objects",
  );
}

export function insertDeclaration(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly ordinal: bigint;
    readonly bridgeId: string;
    readonly fiscalYearId: string;
    readonly statementSnapshotId: string;
    readonly fieldCount: number;
    readonly fileCount: number;
    readonly blocked: boolean;
    readonly noFinancialEffect: boolean;
    readonly body: Schema.JsonObject;
    readonly digest: string;
    readonly createdBy: string;
  },
) {
  return transaction.insert(corporateTaxDeclarations).values(row);
}

// The retained profit-and-loss contributions of one immutable statement snapshot
// that sit on the reviewed income-tax accounts. The statement snapshot already
// excludes owned mechanical result transfers from these contributions, so this set
// is exactly the income-tax population the pre-tax overlay is built from. The
// statement owner stores each contribution as one sealed body, so the exact figures
// are read out of that body rather than recomputed from the ledger.
export function readStatementIncomeTaxContributions(
  transaction: Transaction,
  bookId: string,
  snapshotId: string,
  accountIds: string[],
  limit: number,
) {
  return transaction.execute<IncomeTaxContributionRow>(
    sql`
      select c.component_id as "componentId",
        c.body ->> 'voucherId'::text as "voucherId",
        c.body ->> 'lineId'::text as "lineId",
        c.body ->> 'sequence'::text as sequence,
        c.body ->> 'accountId'::text as "accountId",
        c.body ->> 'debitMinor'::text as "debitMinor",
        c.body ->> 'creditMinor'::text as "creditMinor",
        c.body ->> 'signedMinor'::text as "signedMinor",
        c.body ->> 'description'::text as description
      from openerp.report_statement_contributions c
      where c.book_id = ${bookId} and c.snapshot_id = ${snapshotId}
        and (c.body ->> 'accountId'::text) = any(${accountIds})
      order by c.ordinal
      limit ${limit + 1}
    `,
    "objects",
  );
}

export type PeriodRow = {
  readonly id: string;
  readonly fiscalYearId: string;
  readonly startsOn: string;
  readonly endsOn: string;
  readonly locked: boolean;
  readonly version: string;
};

// The retained accounting periods of one fiscal year, oldest first. The pre-close
// accrual posts into the period that holds the retained statement's as-of date, and
// the selected period is then re-resolved under the book writer lock at execution
// rather than carried forward from the sealed proposal.
export function readPeriodsForYear(transaction: Transaction, bookId: string, fiscalYearId: string) {
  return transaction
    .select({
      id: periods.id,
      fiscalYearId: periods.fiscalYearId,
      startsOn: periods.startsOn,
      endsOn: periods.endsOn,
      locked: periods.locked,
      version: sql`${periods.version}::text`,
    })
    .from(periods)
    .where(and(eq(periods.bookId, bookId), eq(periods.fiscalYearId, fiscalYearId)))
    .orderBy(asc(periods.startsOn), asc(periods.id));
}
