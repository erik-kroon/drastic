import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type * as Schema from "effect/Schema";
import { ruleReleases } from "../schema";
import {
  payrollCalculations,
  payrollCalculationInputs,
  payrollCurrentRevisions,
  payrollRevisions,
} from "../schema";
import type { Transaction } from "../transaction";

export const payrollCalculationTables = [
  "payroll_calculations",
  "payroll_calculation_inputs",
] as const;

export type RuleReleaseRow = {
  readonly id: string;
  readonly jurisdiction: string;
  readonly family: string;
  readonly version: number;
  readonly checksum: string;
  readonly body: Schema.JsonObject;
};

export type HeadCandidateRow = {
  readonly id: string;
  readonly employeeId: string;
  readonly kind: string;
  readonly effectiveOn: string;
  readonly evidenceId: string;
};

export type OpeningRow = {
  readonly id: string;
  readonly effectiveOn: string;
  readonly evidenceId: string;
  readonly body: Schema.JsonObject;
};

export type SameMonthRow = {
  readonly id: string;
  readonly contributionBaseMinor: string;
};

export type CalculationRow = {
  readonly id: string;
  readonly employeeId: string;
  readonly changeSetId: string;
  readonly planDigest: string;
  readonly ruleReleaseId: string;
  readonly earningsPeriodStart: string;
  readonly earningsPeriodEnd: string;
  readonly expectedPaymentOn: string;
  readonly body: Schema.JsonObject;
  readonly createdBy: string;
  readonly createdAt: string;
};

export type InputRefRow = {
  readonly calculationId: string;
  readonly ordinal: number;
  readonly kind: string;
  readonly resourceId: string;
  readonly version: string;
  readonly reason: string;
};

export type CalculationWrite = {
  readonly bookId: string;
  readonly id: string;
  readonly employeeId: string;
  readonly changeSetId: string;
  readonly planDigest: string;
  readonly ruleReleaseId: string;
  readonly earningsPeriodStart: string;
  readonly earningsPeriodEnd: string;
  readonly expectedPaymentOn: string;
  readonly grossMinor: string;
  readonly withholdingMinor: string;
  readonly netDeductionMinor: string;
  readonly contributionBaseMinor: string;
  readonly employerContributionMinor: string;
  readonly payableMinor: string;
  readonly noFinancialEffect: boolean;
  readonly body: Schema.JsonObject;
  readonly createdBy: string;
  readonly createdAt: string;
};

export type InputWrite = {
  readonly bookId: string;
  readonly calculationId: string;
  readonly ordinal: number;
  readonly kind: string;
  readonly resourceId: string;
  readonly version: string;
  readonly reason: string;
};

const revisionColumns = {
  id: payrollRevisions.id,
  employeeId: payrollRevisions.employeeId,
  kind: payrollRevisions.kind,
  effectiveOn: payrollRevisions.effectiveOn,
  evidenceId: payrollRevisions.evidenceId,
  body: payrollRevisions.body,
} as const;

// The latest 9050/9107 revision of one kind on or before the requested date. A
// newer revision is a new row, so a changed fact shows up as a changed head
// rather than a lost one.
function headQuery(
  transaction: Transaction,
  bookId: string,
  employeeId: string,
  kind: string,
  latestEffectiveOn: string,
  lock: "share" | "update",
) {
  const rows = transaction
    .select(revisionColumns)
    .from(payrollRevisions)
    .where(
      and(
        eq(payrollRevisions.bookId, bookId),
        eq(payrollRevisions.employeeId, employeeId),
        eq(payrollRevisions.kind, kind),
        sql`${payrollRevisions.effectiveOn} <= ${latestEffectiveOn}::date`,
      ),
    )
    .orderBy(sql`${payrollRevisions.effectiveOn} desc`)
    .limit(1);

  return lock === "update" ? rows.for("update") : rows;
}

export function lockRevisionHead(
  transaction: Transaction,
  bookId: string,
  employeeId: string,
  kind: string,
  latestEffectiveOn: string,
) {
  return headQuery(transaction, bookId, employeeId, kind, latestEffectiveOn, "update");
}

export function readRevisionHead(
  transaction: Transaction,
  bookId: string,
  employeeId: string,
  kind: string,
  latestEffectiveOn: string,
) {
  return headQuery(transaction, bookId, employeeId, kind, latestEffectiveOn, "share");
}

// A revision is the head for a date only while the current pointer still names
// it. A superseded revision at the same effective date is history, not a fact.
export function readCurrentRevisionAt(
  transaction: Transaction,
  bookId: string,
  employeeId: string,
  kind: string,
  effectiveOn: string,
  lock: "share" | "update" = "share",
) {
  const rows = transaction
    .select({ revisionId: payrollCurrentRevisions.revisionId })
    .from(payrollCurrentRevisions)
    .where(
      and(
        eq(payrollCurrentRevisions.bookId, bookId),
        eq(payrollCurrentRevisions.employeeId, employeeId),
        eq(payrollCurrentRevisions.kind, kind),
        eq(payrollCurrentRevisions.effectiveOn, effectiveOn),
      ),
    );

  return lock === "update" ? rows.for("update") : rows;
}

// Every opening balance retained for this employee on or before the requested
// date, oldest first. The latest one supplies the prior compatible monthly
// contribution base; earlier ones are history and are not summed again.
export function readOpeningRevisions(
  transaction: Transaction,
  bookId: string,
  employeeId: string,
  latestEffectiveOn: string,
) {
  return transaction
    .select({
      id: payrollRevisions.id,
      effectiveOn: payrollRevisions.effectiveOn,
      evidenceId: payrollRevisions.evidenceId,
      body: payrollRevisions.body,
    })
    .from(payrollRevisions)
    .where(
      and(
        eq(payrollRevisions.bookId, bookId),
        eq(payrollRevisions.employeeId, employeeId),
        eq(payrollRevisions.kind, "opening"),
        sql`${payrollRevisions.effectiveOn} <= ${latestEffectiveOn}::date`,
      ),
    )
    .orderBy(asc(payrollRevisions.effectiveOn), asc(payrollRevisions.createdAt));
}

// The one original regular earning event per employee and calendar month. A
// second frozen calculation in the same month would be granted the same reduced
// contribution band twice, so the reserved portion of the prior base is exactly
// the contribution base this owner has already frozen. A committed reservation
// from an executed run belongs to the execution owner and is not observable here.
export function readSameMonthContributions(
  transaction: Transaction,
  bookId: string,
  employeeId: string,
  monthPrefix: string,
) {
  return transaction
    .select({
      id: payrollCalculations.id,
      contributionBaseMinor: payrollCalculations.contributionBaseMinor,
    })
    .from(payrollCalculations)
    .where(
      and(
        eq(payrollCalculations.bookId, bookId),
        eq(payrollCalculations.employeeId, employeeId),
        sql`left(${payrollCalculations.earningsPeriodStart}::text, 7) = ${monthPrefix}`,
      ),
    )
    .orderBy(asc(payrollCalculations.earningsPeriodStart), asc(payrollCalculations.id));
}

const calculationColumns = {
  id: payrollCalculations.id,
  employeeId: payrollCalculations.employeeId,
  changeSetId: payrollCalculations.changeSetId,
  planDigest: payrollCalculations.planDigest,
  ruleReleaseId: payrollCalculations.ruleReleaseId,
  earningsPeriodStart: payrollCalculations.earningsPeriodStart,
  earningsPeriodEnd: payrollCalculations.earningsPeriodEnd,
  expectedPaymentOn: payrollCalculations.expectedPaymentOn,
  body: payrollCalculations.body,
  createdBy: payrollCalculations.createdBy,
  createdAt: payrollCalculations.createdAt,
} as const;

export function readCalculation(transaction: Transaction, bookId: string, calculationId: string) {
  return transaction
    .select(calculationColumns)
    .from(payrollCalculations)
    .where(and(eq(payrollCalculations.bookId, bookId), eq(payrollCalculations.id, calculationId)));
}

export function readEarningEvent(
  transaction: Transaction,
  bookId: string,
  employeeId: string,
  periodStart: string,
  periodEnd: string,
) {
  return transaction
    .select({ id: payrollCalculations.id })
    .from(payrollCalculations)
    .where(
      and(
        eq(payrollCalculations.bookId, bookId),
        eq(payrollCalculations.employeeId, employeeId),
        eq(payrollCalculations.earningsPeriodStart, periodStart),
        eq(payrollCalculations.earningsPeriodEnd, periodEnd),
      ),
    );
}

export function readCalculationsAfter(
  transaction: Transaction,
  bookId: string,
  employeeId: string,
  after: string,
) {
  return transaction
    .select(calculationColumns)
    .from(payrollCalculations)
    .where(
      and(
        eq(payrollCalculations.bookId, bookId),
        eq(payrollCalculations.employeeId, employeeId),
        sql`${payrollCalculations.id} collate "C" > ${after} collate "C"`,
      ),
    )
    .orderBy(sql`${payrollCalculations.id} collate "C"`)
    .limit(21);
}

export function readInputRefs(transaction: Transaction, bookId: string, calculationIds: string[]) {
  return transaction
    .select({
      calculationId: payrollCalculationInputs.calculationId,
      ordinal: payrollCalculationInputs.ordinal,
      kind: payrollCalculationInputs.kind,
      resourceId: payrollCalculationInputs.resourceId,
      version: payrollCalculationInputs.version,
      reason: payrollCalculationInputs.reason,
    })
    .from(payrollCalculationInputs)
    .where(
      and(
        eq(payrollCalculationInputs.bookId, bookId),
        inArray(payrollCalculationInputs.calculationId, calculationIds),
      ),
    )
    .orderBy(asc(payrollCalculationInputs.calculationId), asc(payrollCalculationInputs.ordinal));
}

export function insertCalculation(transaction: Transaction, row: CalculationWrite) {
  return transaction.insert(payrollCalculations).values(row);
}

export function insertInputRefs(transaction: Transaction, rows: ReadonlyArray<InputWrite>) {
  return transaction.insert(payrollCalculationInputs).values([...rows]);
}

// The one reviewed rule-release record the payroll family already selected. This
// reads that owner's record; it does not introduce a second release authority.
export function readRuleRelease(transaction: Transaction, releaseId: string) {
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
    .where(eq(ruleReleases.id, releaseId));
}
