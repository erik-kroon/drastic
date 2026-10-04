import { and, asc, desc, eq, gt, lt, sql } from "drizzle-orm";
import type * as Schema from "effect/Schema";
import type * as Onboarding from "@open-erp/contracts/onboarding";
import { onboardingCases, onboardingRevisions, onboardingSources } from "./schema";
import type { Transaction } from "./transaction";

export const onboardingTables = [
  "onboarding_cases",
  "onboarding_revisions",
  "onboarding_sources",
] as const;

export function readCurrent(transaction: Transaction, bookId: string) {
  return transaction
    .select({ body: onboardingRevisions.body })
    .from(onboardingRevisions)
    .where(eq(onboardingRevisions.bookId, bookId))
    .orderBy(desc(onboardingRevisions.revision))
    .limit(1);
}

export function readHistory(transaction: Transaction, bookId: string, before: number) {
  return transaction
    .select({ body: onboardingRevisions.body })
    .from(onboardingRevisions)
    .where(and(eq(onboardingRevisions.bookId, bookId), lt(onboardingRevisions.revision, before)))
    .orderBy(desc(onboardingRevisions.revision))
    .limit(51);
}

export function insertCase(transaction: Transaction, row: typeof onboardingCases.$inferInsert) {
  return transaction.insert(onboardingCases).values(row);
}

export function insertRevision(
  transaction: Transaction,
  row: typeof onboardingRevisions.$inferInsert,
) {
  return transaction.insert(onboardingRevisions).values(row);
}

export function readLinkedSource(
  transaction: Transaction,
  bookId: string,
  input: typeof Onboarding.AttachOnboardingSource.Type,
) {
  return transaction
    .select({ body: onboardingSources.body })
    .from(onboardingSources)
    .where(
      and(
        eq(onboardingSources.bookId, bookId),
        eq(onboardingSources.occurrenceId, input.occurrenceId),
        eq(onboardingSources.category, input.category),
      ),
    );
}

export function insertSource(transaction: Transaction, row: typeof onboardingSources.$inferInsert) {
  return transaction.insert(onboardingSources).values(row);
}

export function readSources(transaction: Transaction, bookId: string, after: string) {
  return transaction
    .select({ body: onboardingSources.body })
    .from(onboardingSources)
    .where(and(eq(onboardingSources.bookId, bookId), gt(onboardingSources.id, after)))
    .orderBy(asc(onboardingSources.id))
    .limit(51);
}

export function sourceCount(transaction: Transaction, bookId: string) {
  return transaction
    .select({ count: sql<string>`count(distinct occurrence_id)::text` })
    .from(onboardingSources)
    .where(eq(onboardingSources.bookId, bookId));
}

export function readOccurrence(transaction: Transaction, bookId: string, occurrenceId: string) {
  return transaction.execute<{ readonly body: Schema.JsonObject }>(
    sql`
    select body from openerp.intake_occurrences where book_id = ${bookId} and id = ${occurrenceId}
  `,
    "objects",
  );
}

export function readImports(transaction: Transaction, bookId: string, after: string) {
  return transaction.execute<typeof Onboarding.ImportProgress.Type>(
    sql`
    select r.id as "sourceRunId", r.plan_id as "sourcePlanId", p.body->'input'->>'sourceKind' as "sourceKind", r.status as "sourceState",
      r.next_ordinal as "nextSourceOrdinal", f.id as "financialRunId",
      f.status as "financialState", f.next_ordinal as "nextFinancialOrdinal"
    from openerp.sie_source_runs r
    join openerp.sie_source_plans p on p.book_id = r.book_id and p.id = r.plan_id
    join openerp.sie_source_previews v on v.book_id = p.book_id and v.id = p.preview_id
    left join openerp.sie_financial_runs f on f.book_id = r.book_id and f.source_run_id = r.id
    where r.book_id = ${bookId} and r.id > ${after}
      and exists (select 1 from openerp.onboarding_sources s
        where s.book_id = r.book_id and s.occurrence_id = v.occurrence_id)
    order by r.id limit 51
  `,
    "objects",
  );
}

export function readOperatorCount(transaction: Transaction, bookId: string) {
  return transaction.execute<{ readonly count: string }>(
    sql`
    select count(*)::text as count from openerp.memberships m
    where m.book_id = ${bookId} and m.role = 'operator'
      and not exists (select 1 from openerp.identity_admissions a
        where a.actor_id = m.actor_id and a.enabled = false)
  `,
    "objects",
  );
}
