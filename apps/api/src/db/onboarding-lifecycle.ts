import { and, eq, sql } from "drizzle-orm";
import type * as Schema from "effect/Schema";
import * as Effect from "effect/Effect";
import type { Transaction } from "./transaction";
import {
  onboardingControls,
  onboardingResponsibilities,
  onboardingSnapshots,
  onboardingDecisions,
  onboardingActivationIntents,
  onboardingOperationalProofs,
  onboardingActivationReceipts,
  onboardingFirstPeriodCompletions,
} from "./schema";

export const lifecycleRecords = {
  controls: onboardingControls,
  responsibilities: onboardingResponsibilities,
  snapshots: onboardingSnapshots,
  decisions: onboardingDecisions,
  intents: onboardingActivationIntents,
  proofs: onboardingOperationalProofs,
  activations: onboardingActivationReceipts,
  completions: onboardingFirstPeriodCompletions,
};

type RecordKind = keyof typeof lifecycleRecords;

export function readRecords(tx: Transaction, kind: RecordKind, bookId: string, id?: string) {
  const table = lifecycleRecords[kind];

  return tx
    .select({ body: table.body })
    .from(table)
    .where(
      id === undefined ? eq(table.bookId, bookId) : and(eq(table.bookId, bookId), eq(table.id, id)),
    )
    .orderBy(table.id)
    .limit(1001);
}

export function insertRecord(
  tx: Transaction,
  kind: RecordKind,
  row: { bookId: string; id: string; snapshotId?: string; body: Schema.JsonObject },
) {
  return tx.insert(lifecycleRecords[kind]).values(row);
}

export function readPeople(tx: Transaction, bookId: string) {
  return tx.execute<{ id: string; name: string; enabled: boolean; role: string }>(
    sql`
    select m.actor_id as id,a.name,coalesce(i.enabled,true) as enabled,m.role
    from openerp.memberships m join openerp.actors a on a.id=m.actor_id
    left join openerp.identity_admissions i on i.actor_id=m.actor_id
    where m.book_id=${bookId} order by m.actor_id`,
    "objects",
  );
}

export function lockParticipants(tx: Transaction, bookId: string) {
  return Effect.gen(function* () {
    yield* tx.execute(
      sql`select i.actor_id from openerp.identity_admissions i
      where exists(select 1 from openerp.memberships m where m.book_id=${bookId} and m.actor_id=i.actor_id)
      order by i.actor_id for share`,
      "objects",
    );
    yield* tx.execute(
      sql`select m.actor_id from openerp.memberships m
      where m.book_id=${bookId} order by m.actor_id for share`,
      "objects",
    );
    yield* tx.execute(
      sql`select c.token_hash from openerp.credentials c
      where exists(select 1 from openerp.memberships m where m.book_id=${bookId} and m.actor_id=c.actor_id)
      order by c.token_hash for share`,
      "objects",
    );
    yield* tx.execute(
      sql`select s.id from openerp_auth.session s
      where exists(select 1 from openerp.memberships m where m.book_id=${bookId} and m.actor_id=s.user_id)
      order by s.id for share`,
      "objects",
    );
  });
}

export function readReviewedFacts(tx: Transaction, entityId: string, asOf: string) {
  return tx.execute<{ body: Schema.JsonObject }>(
    sql`
    select f.body from openerp.company_fact_revisions f
    where f.entity_id=${entityId} and f.effective_from<=${asOf}::date
      and (f.effective_to is null or f.effective_to>=${asOf}::date)
      and not exists(select 1 from openerp.company_fact_revisions n where n.entity_id=f.entity_id and n.supersedes_id=f.id and n.effective_from<=${asOf}::date)
      and (select r.result from openerp.company_fact_reviews r where r.entity_id=f.entity_id and r.fact_revision_id=f.id order by r.reviewed_at desc limit 1)='confirmed'
    order by f.fact_kind,f.id`,
    "objects",
  );
}

export function readBalances(tx: Transaction, bookId: string, asOf: string) {
  return tx.execute<{ accountId: string; code: string; name: string; amount: string }>(
    sql`
    select a.id as "accountId",a.code,a.name,coalesce(sum(l.debit_minor-l.credit_minor),0)::text as amount
    from openerp.accounts a left join openerp.journal_lines l on l.book_id=a.book_id and l.account_id=a.id
      and exists(select 1 from openerp.vouchers v where v.book_id=l.book_id and v.id=l.voucher_id and v.posting_date<=${asOf}::date)
    where a.book_id=${bookId} group by a.id,a.code,a.name order by a.code`,
    "objects",
  );
}

export function readDependencies(
  tx: Transaction,
  scope: { bookId: string; entityId: string },
  asOf: string,
  controlIds: readonly string[],
) {
  return tx.execute<{ digest: string }>(
    sql`
    select openerp.digest(jsonb_build_object(
      'book',(select to_jsonb(b)-'committed_sequence'-'authority'-'writer_epoch' from openerp.books b where b.id=${scope.bookId}),
      'configuration',(select body from openerp.onboarding_revisions where book_id=${scope.bookId} order by revision desc limit 1),
      'policy',(select body from openerp.onboarding_responsibilities where book_id=${scope.bookId} order by (body->>'revision')::int desc limit 1),
      'people',(select coalesce(jsonb_agg(jsonb_build_object('member',to_jsonb(m),'admission',to_jsonb(i)) order by m.actor_id),'[]')
        from openerp.memberships m left join openerp.identity_admissions i on i.actor_id=m.actor_id where m.book_id=${scope.bookId}),
      'facts',(select coalesce(jsonb_agg(to_jsonb(f) order by f.id),'[]') from openerp.company_fact_revisions f where f.entity_id=${scope.entityId}),
      'reviews',(select coalesce(jsonb_agg(to_jsonb(r) order by r.fact_revision_id,r.reviewed_at),'[]') from openerp.company_fact_reviews r where r.entity_id=${scope.entityId}),
      'profile',(select coalesce(jsonb_agg(to_jsonb(a) order by a.id),'[]') from openerp.company_activations a where a.book_id=${scope.bookId}),
      'periods',(select coalesce(jsonb_agg(to_jsonb(p) order by p.id),'[]') from openerp.periods p where p.book_id=${scope.bookId} and p.starts_on<=${asOf}::date),
      'accounts',(select coalesce(jsonb_agg(to_jsonb(a) order by a.id),'[]') from openerp.accounts a where a.book_id=${scope.bookId}),
      'sources',(select coalesce(jsonb_agg(body order by id),'[]') from openerp.onboarding_sources where book_id=${scope.bookId}),
      'controls',(select coalesce(jsonb_agg(body order by id),'[]') from openerp.onboarding_controls where book_id=${scope.bookId} and id=any(${[...controlIds]}::text[])),
      'ledger',(select coalesce(jsonb_agg(to_jsonb(v) order by v.id),'[]') from openerp.vouchers v where v.book_id=${scope.bookId} and v.posting_date<=${asOf}::date),
      'lines',(select coalesce(jsonb_agg(to_jsonb(l) order by l.voucher_id,l.id),'[]') from openerp.journal_lines l where l.book_id=${scope.bookId}
        and exists(select 1 from openerp.vouchers v where v.book_id=l.book_id and v.id=l.voucher_id and v.posting_date<=${asOf}::date)),
      'imports',(select coalesce(jsonb_agg(to_jsonb(p) order by p.id),'[]') from openerp.sie_source_plans p where p.book_id=${scope.bookId}),
      'runs',(select coalesce(jsonb_agg(to_jsonb(r) order by r.id),'[]') from openerp.sie_financial_runs r where r.book_id=${scope.bookId}),
      'bank_active_matches',(select coalesce(jsonb_agg(to_jsonb(s) order by to_jsonb(s)::text),'[]') from openerp.bank_active_matches s where s.book_id=${scope.bookId}),
      'bank_active_allocations',(select coalesce(jsonb_agg(to_jsonb(s) order by to_jsonb(s)::text),'[]') from openerp.bank_active_allocation_legs s where s.book_id=${scope.bookId}),
      'bank_observations',(select coalesce(jsonb_agg(to_jsonb(s) order by to_jsonb(s)::text),'[]') from openerp.bank_observations s where s.book_id=${scope.bookId}),
      'bank_sources',(select coalesce(jsonb_agg(to_jsonb(s) order by to_jsonb(s)::text),'[]') from openerp.bank_sources s where s.book_id=${scope.bookId}),
      'bank_matches',(select coalesce(jsonb_agg(to_jsonb(s) order by to_jsonb(s)::text),'[]') from openerp.bank_matches s where s.book_id=${scope.bookId}),
      'bank',(select coalesce(jsonb_agg(to_jsonb(s) order by s.id),'[]') from openerp.bank_statements s where s.book_id=${scope.bookId} and s.starts_on<=${asOf}::date),
      'invalidations',(select coalesce(jsonb_agg(to_jsonb(i) order by i.artifact_id),'[]') from openerp.closing_invalidations i where i.book_id=${scope.bookId})
    )) as digest`,
    "objects",
  );
}

export function readCertificate(tx: Transaction, bookId: string, id: string) {
  return tx.execute<{
    body: Schema.JsonObject;
    current: boolean;
    startsOn: string;
    endsOn: string;
  }>(
    sql`
    select c.body,p.starts_on::text as "startsOn",p.ends_on::text as "endsOn",
      (p.locked and not exists(select 1 from openerp.closing_invalidations i where i.book_id=c.book_id and i.kind='certificate' and i.artifact_id=c.id)) as current
    from openerp.closing_certificates c join openerp.periods p on p.book_id=c.book_id and p.id=c.period_id
    where c.book_id=${bookId} and c.id=${id}`,
    "objects",
  );
}

export function readHistoricalRuns(tx: Transaction, bookId: string, ids: readonly string[]) {
  return tx.execute<{
    id: string;
    status: string;
    sourceRunId: string;
    sourceSha256: string;
    vouchers: Schema.Json[];
    mappings: Schema.Json[];
  }>(
    sql`
    select r.id,r.status,r.source_run_id as "sourceRunId",p.body->>'sourceSha256' as "sourceSha256",
      coalesce((select jsonb_agg(v.body order by v.ordinal) from openerp.sie_source_vouchers v where v.book_id=r.book_id and v.run_id=r.source_run_id),'[]') as vouchers,
      p.body->'input'->'mappings' as mappings
    from openerp.sie_financial_runs r join openerp.sie_source_runs s on s.book_id=r.book_id and s.id=r.source_run_id
    join openerp.sie_source_plans p on p.book_id=s.book_id and p.id=s.plan_id
    where r.book_id=${bookId} and r.id=any(${[...ids]}::text[]) order by r.id`,
    "objects",
  );
}

export function allHistoricalRunIds(tx: Transaction, bookId: string) {
  return tx.execute<{ id: string }>(
    sql`select id from openerp.sie_financial_runs where book_id=${bookId} order by id`,
    "objects",
  );
}

export function pendingAccountingWork(
  tx: Transaction,
  bookId: string,
  startsOn: string,
  endsOn: string,
) {
  return tx.execute<{ count: string }>(
    sql`select count(*)::text as count from openerp.change_sets c
    where c.book_id=${bookId} and not exists(select 1 from openerp.vouchers v where v.book_id=c.book_id and v.change_set_id=c.id)
    and exists(select 1 from jsonb_array_elements(c.plan->'groups') g cross join lateral jsonb_array_elements(g->'actions') a
      where a->>'postingDate'>=${startsOn} and a->>'postingDate'<=${endsOn})`,
    "objects",
  );
}

export function maintenancePrivilege(tx: Transaction) {
  return tx.execute<{ allowed: boolean }>(
    sql`select has_column_privilege(current_user,'openerp.books','authority','UPDATE')
    and has_table_privilege(current_user,'openerp.onboarding_activation_receipts','INSERT') as allowed`,
    "objects",
  );
}

export function promote(tx: Transaction, bookId: string) {
  return tx.execute<{ epoch: string }>(
    sql`update openerp.books set authority='native'
    where id=${bookId} and authority='onboarding_fenced' returning writer_epoch::text as epoch`,
    "objects",
  );
}
