import { sql } from "drizzle-orm";
import * as Schema from "effect/Schema";
import { readTableAccess } from "./commerce/access";
import type { Transaction } from "./transaction";

type JsonObject = Schema.JsonObject;

export type TableAccess = {
  readonly tableName: string;
  readonly canSelect: boolean;
  readonly canInsert: boolean;
  readonly canUpdate: boolean;
};

export type RunRow = {
  readonly id: string;
  readonly state: string;
};

export type RunProgressRow = {
  readonly id: string;
  readonly ruleId: string;
  readonly activationId: string;
  readonly rows: readonly JsonObject[];
  readonly state: string;
  readonly cursor: number;
  readonly results: readonly JsonObject[];
  readonly blocker: JsonObject | null;
};

// The durable run projection an operator recovers: the frozen selection, its
// counters, the committed cursor and the terminal or blocked state.
export type RunStateRow = {
  readonly bookId: string;
  readonly id: string;
  readonly ruleId: string;
  readonly activationId: string;
  readonly selection: JsonObject;
  readonly state: string;
  readonly cursor: number;
  readonly results: readonly JsonObject[];
  readonly blocker: JsonObject | null;
  readonly total: number;
};

export type RunWrite = {
  readonly bookId: string;
  readonly id: string;
  readonly ruleId: string;
  readonly activationId: string;
  readonly selection: JsonObject;
  readonly state: string;
  readonly blocker: JsonObject | null;
};

export type BodyRow = { readonly body: JsonObject };

export type PlanDigestRow = { readonly planDigest: string | null };

export type PolicyRow = {
  readonly profile: string;
  readonly authority: string;
  readonly profileVersion: string;
  readonly writerEpoch: string;
};

export type AccountVersionRow = {
  readonly id: string;
  readonly version: string;
};

export type BankSourceRow = {
  readonly accountId: string;
  readonly sourceBankAccountId: string;
};

export type IdRow = { readonly id: string };

export type AllocatedRow = { readonly total: string };

export type PreparationRow = {
  readonly ruleId: string;
  readonly changeSetId: string;
};

export type VoucherRow = {
  readonly id: string;
  readonly changeSetId: string;
};

export type PeriodRow = {
  readonly id: string;
  readonly version: string;
  readonly locked: boolean;
};

export type PreparationWrite = {
  readonly bookId: string;
  readonly statementId: string;
  readonly rowOrdinal: number;
  readonly ruleId: string;
  readonly changeSetId: string;
};

export type RunProgressWrite = {
  readonly bookId: string;
  readonly runId: string;
  readonly state: string;
  readonly cursor: number;
  readonly results: readonly JsonObject[];
  readonly blocker: JsonObject | null;
};

export type JobRow = {
  readonly id: string;
  readonly bookId: string;
  readonly entityId: string;
  readonly runId: string;
  readonly requestedBy: string;
  readonly executorId: string;
  readonly checkpoint: number;
  readonly state: string;
  readonly reason: string | null;
  readonly credentialHash: string | null;
  readonly sessionId: string | null;
  readonly expectedAudit: number;
  readonly createdAt: string;
  readonly checkedAt: string;
};

export type AuditRow = { readonly total: number };

export type AgentRow = { readonly actorId: string };

export type EnabledRow = { readonly enabled: boolean | null };

export type JobWrite = {
  readonly bookId: string;
  readonly id: string;
  readonly runId: string;
  readonly requestedBy: string;
  readonly executorId: string;
  readonly credentialHash: string | null;
  readonly sessionId: string | null;
  readonly expectedAudit: number;
};

export const jobTables = [
  "preparation_jobs",
  "preparation_runs",
  "preparation_run_audit",
  "recurring_preparations",
  "memberships",
  "identity_admissions",
  "books",
  "command_receipts",
] as const;

// The bounded advance step only reads the recurring policy and bank observation
// surface. It is granted SELECT alone, so it is probed separately from the
// write-required job tables above.
export const advanceTables = [
  "recurring_rules",
  "recurring_activations",
  "recurring_deactivations",
  "recurring_preparations",
  "bank_observations",
  "bank_active_matches",
  "bank_active_allocation_legs",
  "change_sets",
  "vouchers",
  "events",
] as const;

// A preparation run is created and advanced from granted projections only, so
// it reads the recurring policy and frozen bank observation surface in addition
// to the job tables.
export const runReadTables = [
  "recurring_rules",
  "recurring_activations",
  "recurring_deactivations",
  "bank_observations",
  "bank_statements",
  "bank_matches",
  "bank_sources",
  "periods",
  "accounts",
  "change_sets",
  "vouchers",
  "events",
] as const;

export const jobInsertTables = [
  "preparation_jobs",
  "preparation_run_audit",
  "command_receipts",
  "recurring_preparations",
] as const;

// A created run is durable before it can be advanced, so its own table is part
// of the write grant a preparation run needs.
export const runInsertTables = [
  "preparation_runs",
  "preparation_run_audit",
  "command_receipts",
  "recurring_preparations",
] as const;

export const jobUpdateColumns = [
  { tableName: "preparation_jobs", column: "checkpoint" },
  { tableName: "preparation_jobs", column: "expected_audit" },
  { tableName: "preparation_jobs", column: "state" },
  { tableName: "preparation_jobs", column: "reason" },
  { tableName: "preparation_jobs", column: "checked_at" },
  { tableName: "preparation_runs", column: "state" },
  { tableName: "preparation_runs", column: "cursor" },
  { tableName: "preparation_runs", column: "results" },
  { tableName: "preparation_runs", column: "blocker" },
] as const;

export type ColumnAccessRow = {
  readonly tableName: string;
  readonly columnName: string;
  readonly canUpdate: boolean;
};

export function readJobAccess(transaction: Transaction) {
  return readTableAccess(transaction, jobTables);
}

export function readRunTableAccess(transaction: Transaction) {
  return readTableAccess(transaction, runReadTables);
}

export function readRunInsertAccess(transaction: Transaction) {
  return readTableAccess(transaction, runInsertTables);
}

export function readAdvanceAccess(transaction: Transaction) {
  return readTableAccess(transaction, advanceTables);
}

// The runtime role is granted UPDATE per column and never at table level, and
// has_table_privilege reports false for a column grant. Probing the declared
// write columns directly is the only check that matches the grant baseline.
export function readJobColumnAccess(transaction: Transaction) {
  return transaction.execute<ColumnAccessRow>(
    sql`
      select requested.table_name as "tableName", requested.column_name as "columnName",
        has_column_privilege(current_user, 'openerp.' || requested.table_name,
          requested.column_name, 'update') as "canUpdate"
      from unnest(
        array[${sql.join(
          jobUpdateColumns.map((entry) => sql`${entry.tableName}`),
          sql`, `,
        )}],
        array[${sql.join(
          jobUpdateColumns.map((entry) => sql`${entry.column}`),
          sql`, `,
        )}]
      ) as requested(table_name, column_name)
    `,
    "objects",
  );
}

export function readRun(transaction: Transaction, bookId: string, runId: string) {
  return transaction.execute<RunRow>(
    sql`
      select id, state from openerp.preparation_runs
      where book_id = ${bookId} and id = ${runId}
      for share
    `,
    "objects",
  );
}

export function readRunState(transaction: Transaction, bookId: string, runId: string) {
  return transaction.execute<RunStateRow>(
    sql`
      select r.book_id as "bookId", r.id, r.rule_id as "ruleId", r.activation_id as "activationId",
        r.selection, r.state, r.cursor, r.results, r.blocker,
        jsonb_array_length(r.selection->'rows') as total
      from openerp.preparation_runs r
      where r.book_id = ${bookId} and r.id = ${runId}
      for share
    `,
    "objects",
  );
}

export function readRunAudit(transaction: Transaction, bookId: string, runId: string) {
  return transaction.execute<BodyRow>(
    sql`
      select body from openerp.preparation_run_audit
      where book_id = ${bookId} and run_id = ${runId}
      order by ordinal
    `,
    "objects",
  );
}

export function insertRun(transaction: Transaction, row: RunWrite) {
  return transaction.execute(
    sql`
      insert into openerp.preparation_runs
        (book_id, id, rule_id, activation_id, selection, state, blocker)
      values (${row.bookId}, ${row.id}, ${row.ruleId}, ${row.activationId},
        ${JSON.stringify(row.selection)}::jsonb, ${row.state},
        ${row.blocker === null ? null : JSON.stringify(row.blocker)}::jsonb)
    `,
    "objects",
  );
}

export function lockRun(transaction: Transaction, bookId: string, runId: string) {
  return transaction.execute<RunProgressRow>(
    sql`
      select r.id, r.rule_id as "ruleId", r.activation_id as "activationId",
        r.selection->'rows' as rows, r.state, r.cursor, r.results, r.blocker
      from openerp.preparation_runs r
      where r.book_id = ${bookId} and r.id = ${runId}
      for update
    `,
    "objects",
  );
}

export function readRule(transaction: Transaction, bookId: string, ruleId: string) {
  return transaction.execute<BodyRow>(
    sql`
      select body from openerp.recurring_rules
      where book_id = ${bookId} and id = ${ruleId}
    `,
    "objects",
  );
}

export function readActiveOperatorActivation(
  transaction: Transaction,
  bookId: string,
  activationId: string,
  ruleId: string,
) {
  return transaction.execute<IdRow>(
    sql`
      select a.id from openerp.recurring_activations a
      join openerp.memberships m
        on m.book_id = a.book_id and m.actor_id = a.body->>'actorId' and m.role = 'operator'
      where a.book_id = ${bookId} and a.id = ${activationId} and a.rule_id = ${ruleId}
        and not exists (
          select from openerp.recurring_deactivations d
          where d.book_id = a.book_id and d.activation_id = a.id
        )
      for share of m
    `,
    "objects",
  );
}

export function readPolicy(transaction: Transaction, bookId: string) {
  return transaction.execute<PolicyRow>(
    sql`
      select profile, authority, profile_version::text as "profileVersion",
        writer_epoch::text as "writerEpoch"
      from openerp.books where id = ${bookId}
    `,
    "objects",
  );
}

export function readActiveAccountVersions(transaction: Transaction, bookId: string, ids: string[]) {
  return transaction.execute<AccountVersionRow>(
    sql`
      select id, version::text as version from openerp.accounts
      where book_id = ${bookId} and active
        and id in (${sql.join(
          ids.map((id) => sql`${id}`),
          sql`, `,
        )})
    `,
    "objects",
  );
}

export function readBankSource(transaction: Transaction, bookId: string, accountId: string) {
  return transaction.execute<BankSourceRow>(
    sql`
      select account_id as "accountId", source_bank_account_id as "sourceBankAccountId"
      from openerp.bank_sources
      where book_id = ${bookId} and account_id = ${accountId}
    `,
    "objects",
  );
}

export function readOverlappingRuleIds(
  transaction: Transaction,
  bookId: string,
  ruleId: string,
  accountId: string,
  description: string,
  sign: string,
) {
  return transaction.execute<IdRow>(
    sql`
      select distinct r.id from openerp.recurring_activations a
      join openerp.recurring_rules r on r.book_id = a.book_id and r.id = a.rule_id
      where a.book_id = ${bookId} and r.id <> ${ruleId}
        and not exists (
          select from openerp.recurring_deactivations d
          where d.book_id = a.book_id and d.activation_id = a.id
        )
        and r.body->'input'->>'accountId' = ${accountId}
        and (r.body->'input'->>'description') collate "C" = (${description}) collate "C"
        and r.body->'input'->>'sign' = ${sign}
    `,
    "objects",
  );
}

export function lockSelectionPeriods(
  transaction: Transaction,
  bookId: string,
  rows: readonly JsonObject[],
) {
  return transaction.execute<IdRow>(
    sql`
      select p.id from openerp.periods p
      where p.book_id = ${bookId}
        and p.id in (
          select item->>'accountingPeriodId'
          from jsonb_array_elements(${JSON.stringify(rows)}::jsonb) item
        )
      order by p.id
      for share
    `,
    "objects",
  );
}

export function lockRuleAccounts(transaction: Transaction, bookId: string, ids: string[]) {
  return transaction.execute<IdRow>(
    sql`
      select id from openerp.accounts
      where book_id = ${bookId}
        and id in (${sql.join(
          ids.map((id) => sql`${id}`),
          sql`, `,
        )})
      order by id
      for share
    `,
    "objects",
  );
}

export function readAllocatedSource(
  transaction: Transaction,
  bookId: string,
  statementId: string,
  rowOrdinal: number,
) {
  return transaction.execute<AllocatedRow>(
    sql`
      select coalesce((
          select o.amount_minor from openerp.bank_active_matches m
          join openerp.bank_observations o
            on (o.book_id, o.statement_id, o.row_ordinal) = (m.book_id, m.statement_id, m.row_ordinal)
          where m.book_id = ${bookId} and m.statement_id = ${statementId}
            and m.row_ordinal = ${rowOrdinal}
        ), 0) + coalesce((
          select sum(a.amount_minor) from openerp.bank_active_allocation_legs a
          where a.book_id = ${bookId} and a.statement_id = ${statementId}
            and a.row_ordinal = ${rowOrdinal}
        ), 0) as total
    `,
    "objects",
  );
}

export function readEventByKey(
  transaction: Transaction,
  bookId: string,
  evidenceId: string,
  eventKey: string,
) {
  return transaction.execute<IdRow>(
    sql`
      select id from openerp.events
      where book_id = ${bookId} and evidence_id = ${evidenceId} and event_key = ${eventKey}
    `,
    "objects",
  );
}

export function readPostedAdjustmentVoucher(
  transaction: Transaction,
  bookId: string,
  eventId: string,
) {
  return transaction.execute<VoucherRow>(
    sql`
      select id, change_set_id as "changeSetId" from openerp.vouchers
      where book_id = ${bookId} and event_id = ${eventId}
        and posting_purpose = 'adjustment' and occurrence_key = 'manual_journal'
    `,
    "objects",
  );
}

export function readPreparation(
  transaction: Transaction,
  bookId: string,
  statementId: string,
  rowOrdinal: number,
) {
  return transaction.execute<PreparationRow>(
    sql`
      select rule_id as "ruleId", change_set_id as "changeSetId"
      from openerp.recurring_preparations
      where book_id = ${bookId} and statement_id = ${statementId}
        and row_ordinal = ${rowOrdinal}
    `,
    "objects",
  );
}

export function readPlanBody(transaction: Transaction, bookId: string, changeSetId: string) {
  return transaction.execute<BodyRow>(
    sql`
      select plan as body from openerp.change_sets
      where book_id = ${bookId} and id = ${changeSetId}
    `,
    "objects",
  );
}

export function readPlanDigest(transaction: Transaction, bookId: string, changeSetId: string) {
  return transaction.execute<PlanDigestRow>(
    sql`
      select plan->>'planDigest' as "planDigest" from openerp.change_sets
      where book_id = ${bookId} and id = ${changeSetId}
    `,
    "objects",
  );
}

export function readProposalForEvent(transaction: Transaction, bookId: string, eventId: string) {
  return transaction.execute<IdRow>(
    sql`
      select id from openerp.change_sets
      where book_id = ${bookId} and plan->'groups'->0->'actions'->0->>'eventId' = ${eventId}
    `,
    "objects",
  );
}

export function lockPeriod(transaction: Transaction, bookId: string, periodId: string) {
  return transaction.execute<PeriodRow>(
    sql`
      select id, version::text as version, locked from openerp.periods
      where book_id = ${bookId} and id = ${periodId}
      for share
    `,
    "objects",
  );
}

export function readJob(transaction: Transaction, bookId: string, jobId: string) {
  return transaction.execute<JobRow>(
    sql`
      select j.id, j.book_id as "bookId", b.entity_id as "entityId", j.run_id as "runId",
        j.requested_by as "requestedBy", j.executor_id as "executorId",
        j.checkpoint, j.state, j.reason, j.credential_hash as "credentialHash",
        j.session_id as "sessionId", j.expected_audit as "expectedAudit",
        to_char(j.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "createdAt",
        to_char(j.checked_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "checkedAt"
      from openerp.preparation_jobs j
      join openerp.books b on b.id = j.book_id
      where j.book_id = ${bookId} and j.id = ${jobId}
    `,
    "objects",
  );
}

export function readLatestJob(transaction: Transaction, bookId: string, runId: string) {
  return transaction.execute<JobRow>(
    sql`
      select j.id, j.book_id as "bookId", b.entity_id as "entityId", j.run_id as "runId",
        j.requested_by as "requestedBy", j.executor_id as "executorId",
        j.checkpoint, j.state, j.reason, j.credential_hash as "credentialHash",
        j.session_id as "sessionId", j.expected_audit as "expectedAudit",
        to_char(j.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "createdAt",
        to_char(j.checked_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "checkedAt"
      from openerp.preparation_jobs j
      join openerp.books b on b.id = j.book_id
      where j.book_id = ${bookId} and j.run_id = ${runId}
      order by j.created_at desc, j.id desc
      limit 1
    `,
    "objects",
  );
}

export function lockJob(transaction: Transaction, bookId: string, jobId: string) {
  return transaction.execute<JobRow>(
    sql`
      select j.id, j.book_id as "bookId", b.entity_id as "entityId", j.run_id as "runId",
        j.requested_by as "requestedBy", j.executor_id as "executorId",
        j.checkpoint, j.state, j.reason, j.credential_hash as "credentialHash",
        j.session_id as "sessionId", j.expected_audit as "expectedAudit",
        to_char(j.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "createdAt",
        to_char(j.checked_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "checkedAt"
      from openerp.preparation_jobs j
      join openerp.books b on b.id = j.book_id
      where j.book_id = ${bookId} and j.id = ${jobId}
      for update of j
    `,
    "objects",
  );
}

export function lockReadyJob(transaction: Transaction, bookId: string, runId: string) {
  return transaction.execute<JobRow>(
    sql`
      select j.id, j.book_id as "bookId", b.entity_id as "entityId", j.run_id as "runId",
        j.requested_by as "requestedBy", j.executor_id as "executorId",
        j.checkpoint, j.state, j.reason, j.credential_hash as "credentialHash",
        j.session_id as "sessionId", j.expected_audit as "expectedAudit",
        to_char(j.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "createdAt",
        to_char(j.checked_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "checkedAt"
      from openerp.preparation_jobs j
      join openerp.books b on b.id = j.book_id
      where j.book_id = ${bookId} and j.run_id = ${runId} and j.state = 'ready'
      for update
    `,
    "objects",
  );
}

export function claimReadyJobs(transaction: Transaction, actorId: string) {
  return transaction.execute<JobRow>(
    sql`
      with selected as (
        select j.book_id, j.id from openerp.preparation_jobs j
        join openerp.memberships m
          on m.book_id = j.book_id and m.actor_id = ${actorId} and m.role = 'agent'
        where j.executor_id = ${actorId} and j.state = 'ready'
        order by j.checked_at, j.id
        limit 100
        for update of j skip locked
      ), claimed as (
        update openerp.preparation_jobs j set checked_at = clock_timestamp()
        from selected s where j.book_id = s.book_id and j.id = s.id
        returning j.*
      )
      select c.id, c.book_id as "bookId", b.entity_id as "entityId", c.run_id as "runId",
        c.requested_by as "requestedBy", c.executor_id as "executorId",
        c.checkpoint, c.state, c.reason, c.credential_hash as "credentialHash",
        c.session_id as "sessionId", c.expected_audit as "expectedAudit",
        to_char(c.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "createdAt",
        to_char(c.checked_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "checkedAt"
      from claimed c join openerp.books b on b.id = c.book_id
      order by c.checked_at, c.id
    `,
    "objects",
  );
}

export function countAudit(transaction: Transaction, bookId: string, runId: string) {
  return transaction.execute<AuditRow>(
    sql`
      select coalesce(max(ordinal), 0)::integer as total
      from openerp.preparation_run_audit
      where book_id = ${bookId} and run_id = ${runId}
    `,
    "objects",
  );
}

export function readAgentMembership(transaction: Transaction, bookId: string, actorId: string) {
  return transaction.execute<AgentRow>(
    sql`
      select actor_id as "actorId" from openerp.memberships
      where book_id = ${bookId} and actor_id = ${actorId} and role = 'agent'
      for share
    `,
    "objects",
  );
}

export function readSubmitterMembership(transaction: Transaction, bookId: string, actorId: string) {
  return transaction.execute<AgentRow>(
    sql`
      select actor_id as "actorId" from openerp.memberships
      where book_id = ${bookId} and actor_id = ${actorId}
      for share
    `,
    "objects",
  );
}

export function readSubmitterAdmission(transaction: Transaction, actorId: string) {
  return transaction.execute<EnabledRow>(
    sql`
      select enabled from openerp.identity_admissions
      where actor_id = ${actorId}
      for share
    `,
    "objects",
  );
}

export function readLiveCredential(transaction: Transaction, credentialHash: string) {
  return transaction.execute<AgentRow>(
    sql`
      select actor_id as "actorId" from openerp.credentials
      where token_hash = ${credentialHash} and revoked_at is null
        and expires_at > clock_timestamp()
      for share
    `,
    "objects",
  );
}

export function readLiveSession(transaction: Transaction, sessionId: string) {
  return transaction.execute<AgentRow>(
    sql`
      select user_id as "actorId" from openerp_auth.session
      where id = ${sessionId} and expires_at > clock_timestamp()
      for share
    `,
    "objects",
  );
}

export function insertJob(transaction: Transaction, row: JobWrite) {
  return transaction.execute(
    sql`
      insert into openerp.preparation_jobs
        (book_id, id, run_id, requested_by, executor_id, credential_hash, session_id, expected_audit)
      values (${row.bookId}, ${row.id}, ${row.runId}, ${row.requestedBy}, ${row.executorId},
        ${row.credentialHash}, ${row.sessionId}, ${row.expectedAudit})
    `,
    "objects",
  );
}

export function stopJob(transaction: Transaction, bookId: string, jobId: string, reason: string) {
  return transaction.execute(
    sql`
      update openerp.preparation_jobs
      set state = 'stopped', reason = ${reason}, checked_at = clock_timestamp()
      where book_id = ${bookId} and id = ${jobId}
    `,
    "objects",
  );
}

export function advanceJob(
  transaction: Transaction,
  bookId: string,
  jobId: string,
  checkpoint: number,
  expectedAudit: number,
  state: string,
  reason: string | null,
) {
  return transaction.execute(
    sql`
      update openerp.preparation_jobs
      set checkpoint = ${checkpoint}, expected_audit = ${expectedAudit}, state = ${state},
        reason = ${reason}, checked_at = clock_timestamp()
      where book_id = ${bookId} and id = ${jobId}
    `,
    "objects",
  );
}

export function writeRunProgress(transaction: Transaction, row: RunProgressWrite) {
  return transaction.execute(
    sql`
      update openerp.preparation_runs
      set state = ${row.state}, cursor = ${row.cursor}, results = ${JSON.stringify(row.results)}::jsonb,
        blocker = ${row.blocker === null ? null : JSON.stringify(row.blocker)}::jsonb
      where book_id = ${row.bookId} and id = ${row.runId}
    `,
    "objects",
  );
}

export function insertRunAudit(
  transaction: Transaction,
  bookId: string,
  runId: string,
  ordinal: number,
  body: JsonObject,
) {
  return transaction.execute(
    sql`
      insert into openerp.preparation_run_audit (book_id, run_id, ordinal, body)
      values (${bookId}, ${runId}, ${ordinal}, ${JSON.stringify(body)}::jsonb)
    `,
    "objects",
  );
}

export function insertPreparation(transaction: Transaction, row: PreparationWrite) {
  return transaction.execute(
    sql`
      insert into openerp.recurring_preparations
        (book_id, statement_id, row_ordinal, rule_id, change_set_id)
      values (${row.bookId}, ${row.statementId}, ${row.rowOrdinal}, ${row.ruleId}, ${row.changeSetId})
    `,
    "objects",
  );
}
