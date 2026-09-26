import { textArray } from "./sql-values";
import { sql } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type { Transaction } from "./transaction";

type JsonObject = Schema.JsonObject;

export const recurringRuleTables = [
  "recurring_rules",
  "recurring_simulations",
  "recurring_activations",
  "recurring_deactivations",
  "bank_observations",
  "bank_statements",
  "bank_matches",
  "bank_sources",
  "periods",
  "accounts",
  "books",
  "command_receipts",
] as const;

export type TableAccess = {
  readonly tableName: string;
  readonly canSelect: boolean;
  readonly canInsert: boolean;
};

export type BodyRow = { readonly body: JsonObject };

export type AccountRow = {
  readonly id: string;
  readonly version: string;
  readonly active: boolean;
};

export type SelectionRow = {
  readonly selection: JsonObject | null;
  readonly current: boolean;
};

export function readRuleAccess(transaction: Transaction) {
  return transaction.execute<TableAccess>(
    sql`
      select
        requested.table_name as "tableName",
        case when to_regclass('openerp.' || requested.table_name) is null then false
          else has_table_privilege(current_user, 'openerp.' || requested.table_name, 'select') end as "canSelect",
        case when to_regclass('openerp.' || requested.table_name) is null then false
          else has_table_privilege(current_user, 'openerp.' || requested.table_name, 'insert') end as "canInsert"
      from unnest(${textArray(recurringRuleTables)}) as requested(table_name)
    `,
    "objects",
  );
}

export function readRule(transaction: Transaction, bookId: string, ruleId: string) {
  return transaction.execute<BodyRow>(
    sql`
      select body from openerp.recurring_rules
      where book_id = ${bookId} and id = ${ruleId}
      for share
    `,
    "objects",
  );
}

export function readSimulation(transaction: Transaction, bookId: string, simulationId: string) {
  return transaction.execute<BodyRow>(
    sql`
      select body from openerp.recurring_simulations
      where book_id = ${bookId} and id = ${simulationId}
    `,
    "objects",
  );
}

export function readActiveActivation(transaction: Transaction, bookId: string, ruleId: string) {
  return transaction.execute<BodyRow>(
    sql`
      select a.body from openerp.recurring_activations a
      where a.book_id = ${bookId} and a.rule_id = ${ruleId}
        and not exists (
          select 1 from openerp.recurring_deactivations d
          where d.book_id = a.book_id and d.activation_id = a.id)
      for share of a
    `,
    "objects",
  );
}

export function lockSelectionAccounts(
  transaction: Transaction,
  bookId: string,
  accountIds: string[],
) {
  return transaction.execute<AccountRow>(
    sql`
      select id, version::text as version, active
      from openerp.accounts
      where book_id = ${bookId} and id = any(${textArray(accountIds)})
      order by id
      for share
    `,
    "objects",
  );
}

export function lockSelectionPeriods(
  transaction: Transaction,
  bookId: string,
  startsOn: string,
  endsOn: string,
) {
  return transaction.execute<{ readonly id: string }>(
    sql`
      select id from openerp.periods
      where book_id = ${bookId} and starts_on <= ${endsOn} and ends_on >= ${startsOn}
      order by id
      for share
    `,
    "objects",
  );
}

export function insertRule(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly body: JsonObject;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.recurring_rules (book_id, id, body)
      values (${row.bookId}, ${row.id}, ${JSON.stringify(row.body)}::jsonb)
    `,
    "objects",
  );
}

export function insertSimulation(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly ruleId: string;
    readonly body: JsonObject;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.recurring_simulations (book_id, id, rule_id, body)
      values (${row.bookId}, ${row.id}, ${row.ruleId}, ${JSON.stringify(row.body)}::jsonb)
    `,
    "objects",
  );
}

// The frozen observation selection is recomputed from the granted bank
// projections instead of trusting a stored observation list, so a proposal or a
// simulation can never assert a selection the current sources do not support.
export function readSelection(
  transaction: Transaction,
  bookId: string,
  rule: JsonObject,
  startsOn: string,
  endsOn: string,
) {
  return transaction.execute<SelectionRow>(
    sql`
      with bound as (
        select ${JSON.stringify(rule)}::jsonb as rule
      ), configuration as (
        select
          (rule->>'id')::text as rule_id,
          (rule->>'digest')::text as rule_digest,
          (rule->'input'->>'accountId')::text as account_id,
          (rule->'input'->>'description')::text as description,
          (rule->'input'->>'sign')::text as sign,
          ${startsOn}::date as starts_on,
          ${endsOn}::date as ends_on
        from bound
      ), dependencies as (
        select (
          rule_digest is distinct from openerp.digest(rule - 'digest')
          or not exists (
            select 1 from openerp.books b
            where b.id = ${bookId} and b.profile = 'synthetic-core-v1' and b.authority = 'native')
          or exists (
            select 1 from jsonb_array_elements(coalesce(rule->'dependencies', '[]'::jsonb)) dependency
            where case dependency->>'kind'
              when 'profile' then (
                select b.profile_version::text from openerp.books b where b.id = ${bookId})
              when 'writer_epoch' then (
                select b.writer_epoch::text from openerp.books b where b.id = ${bookId})
              when 'account' then (
                select a.version::text from openerp.accounts a
                where a.book_id = ${bookId} and a.id = dependency->>'resourceId' and a.active)
              else null end
              is distinct from dependency->>'version')
          or not exists (
            select 1 from openerp.bank_sources s
            where s.book_id = ${bookId} and s.account_id = account_id
              and s.source_bank_account_id = rule->'input'->>'sourceBankAccountId')
        ) is not true as current
        from configuration
      ), eligible as (
        select o.statement_id, o.row_ordinal, o.observed_on, o.description, o.amount_minor,
          s.evidence_id, p.id as period_id, p.version as period_version, p.locked as period_locked
        from configuration c
        join openerp.bank_observations o on o.book_id = ${bookId}
        join openerp.bank_statements s on s.book_id = o.book_id and s.id = o.statement_id
          and s.account_id = c.account_id
        left join openerp.periods p on p.book_id = o.book_id
          and o.observed_on between p.starts_on and p.ends_on
        where o.observed_on between c.starts_on and c.ends_on
          and o.description collate "C" = c.description collate "C"
          and ((c.sign = 'positive' and o.amount_minor > 0)
            or (c.sign = 'negative' and o.amount_minor < 0))
          and not exists (
            select 1 from openerp.bank_matches m
            where m.book_id = o.book_id and m.statement_id = o.statement_id
              and m.row_ordinal = o.row_ordinal)
      ), rule_overlaps as (
        select coalesce(jsonb_agg(distinct other.id order by other.id), '[]'::jsonb) as ids
        from configuration c
        join openerp.recurring_activations a on a.book_id = ${bookId}
        join openerp.recurring_rules other on other.book_id = a.book_id and other.id = a.rule_id
        where other.id <> c.rule_id
          and not exists (
            select 1 from openerp.recurring_deactivations d
            where d.book_id = a.book_id and d.activation_id = a.id)
          and other.body->'input'->>'accountId' = c.account_id
          and (other.body->'input'->>'description') collate "C" = c.description collate "C"
          and other.body->'input'->>'sign' = c.sign
      ), selection as (
        select jsonb_build_object(
          'startsOn', c.starts_on::text, 'endsOn', c.ends_on::text,
          'sourceRevision', (select s.revision::text from openerp.bank_sources s
            where s.book_id = ${bookId} and s.account_id = c.account_id),
          'sequence', (select b.committed_sequence::text from openerp.books b where b.id = ${bookId}),
          'rows', coalesce((
            select jsonb_agg(jsonb_build_object(
              'statementId', e.statement_id, 'rowOrdinal', e.row_ordinal,
              'evidenceId', e.evidence_id, 'date', e.observed_on::text,
              'description', e.description, 'amountMinor', e.amount_minor::text,
              'accountingPeriodId', e.period_id,
              'periodVersion', case when e.period_id is null then null else e.period_version::text end)
              order by e.observed_on, e.statement_id, e.row_ordinal)
            from eligible e), '[]'::jsonb),
          'matchingCount', (select count(*)::bigint from eligible),
          'totalMinor', (select coalesce(sum(e.amount_minor), 0)::text from eligible e),
          'unmatchedCount', (
            select count(*) FILTER (where not exists (
              select 1 from openerp.bank_matches m
              where m.book_id = ${bookId} and m.statement_id = o.statement_id
                and m.row_ordinal = o.row_ordinal))::bigint
              - (select count(*)::bigint from eligible)
            from openerp.bank_observations o
            join openerp.bank_statements s
              on s.book_id = o.book_id and s.id = o.statement_id and s.account_id = c.account_id
            where o.observed_on between c.starts_on and c.ends_on),
          'alreadyMatchedCount', (
            select count(*) FILTER (where exists (
              select 1 from openerp.bank_matches m
              where m.book_id = ${bookId} and m.statement_id = o.statement_id
                and m.row_ordinal = o.row_ordinal))::bigint
            from openerp.bank_observations o
            join openerp.bank_statements s
              on s.book_id = o.book_id and s.id = o.statement_id and s.account_id = c.account_id
            where o.observed_on between c.starts_on and c.ends_on),
          'overlappingRuleIds', o.ids,
          'blockers', (
            select coalesce(jsonb_agg(item.message order by item.ordinal), '[]'::jsonb)
            from (
              select 1 as ordinal,
                'Some eligible observations have no accounting period.' as message
              where exists (select 1 from eligible e where e.period_id is null)
              union all
              select 2,
                'Some eligible observations belong to a locked accounting period.'
              where exists (select 1 from eligible e where e.period_locked)
              union all
              select 3,
                'An active recurring rule has the same bank account, exact description and sign.'
              where jsonb_array_length(o.ids) > 0
            ) item)
        ) as value
        from configuration c, rule_overlaps o, dependencies d
        where d.current
      )
      select
        coalesce((select value from selection), 'null'::jsonb) as selection,
        coalesce((select current from dependencies), false) as current
    `,
    "objects",
  );
}

export function readDependenciesCurrent(
  transaction: Transaction,
  bookId: string,
  rule: JsonObject,
) {
  return transaction.execute<{ readonly current: boolean }>(
    sql`
      select (
        ${JSON.stringify(rule)}::jsonb->>'digest' is distinct from
            openerp.digest(${JSON.stringify(rule)}::jsonb - 'digest')
        or not exists (
          select 1 from openerp.books b
          where b.id = ${bookId} and b.profile = 'synthetic-core-v1' and b.authority = 'native')
        or exists (
          select 1 from jsonb_array_elements(
            coalesce(${JSON.stringify(rule)}::jsonb->'dependencies', '[]'::jsonb)) dependency
          where case dependency->>'kind'
            when 'profile' then (
              select b.profile_version::text from openerp.books b where b.id = ${bookId})
            when 'writer_epoch' then (
              select b.writer_epoch::text from openerp.books b where b.id = ${bookId})
            when 'account' then (
              select a.version::text from openerp.accounts a
              where a.book_id = ${bookId} and a.id = dependency->>'resourceId' and a.active)
            else null end
            is distinct from dependency->>'version')
        or not exists (
          select 1 from openerp.bank_sources s
          where s.book_id = ${bookId}
            and s.account_id = ${JSON.stringify(rule)}::jsonb->'input'->>'accountId'
            and s.source_bank_account_id = ${JSON.stringify(rule)}::jsonb->'input'->>'sourceBankAccountId')
      ) is not true as current
    `,
    "objects",
  );
}

export function digestJson(transaction: Transaction, value: JsonObject) {
  return Effect.map(
    transaction.execute<{ readonly digest: string }>(
      sql`select openerp.digest(${JSON.stringify(value)}::jsonb) as digest`,
      "objects",
    ),
    (rows) => rows[0]?.digest,
  );
}
