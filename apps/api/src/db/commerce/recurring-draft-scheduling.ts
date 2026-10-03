import { sql } from "drizzle-orm";
import type * as Schema from "effect/Schema";
import type * as Recurring from "@open-erp/contracts/recurring-invoices";
import type { Transaction } from "../transaction";

type JsonObject = Schema.JsonObject;

export type SchedulingRow = {
  readonly bookId: string;
  readonly agreementId: string;
  readonly enabled: boolean;
  readonly generation: string;
  readonly firstAutomaticCycle: string;
  readonly nextCycleOrdinal: string;
  readonly requestedBy: string;
  readonly timeZone: string;
  readonly duePolicy: "local_calendar_date_v1";
};

export type DraftJobRow = {
  readonly id: string;
  readonly bookId: string;
  readonly agreementId: string;
  readonly cycleOrdinal: string;
  readonly generation: string;
  readonly scheduleGeneration: string;
  readonly requestedBy: string;
  readonly executorId: string;
  readonly admitted: JsonObject;
  readonly state: typeof Recurring.RecurringDraftJobState.Type;
  readonly reason: string | null;
  readonly draftId: string | null;
};

export type ScanCursor = {
  readonly bookId: string;
  readonly agreementId: string;
  readonly capturedAt: string;
};

export function readScheduling(transaction: Transaction, bookId: string, agreementId: string) {
  return transaction.execute<SchedulingRow>(
    sql`
    select book_id as "bookId", agreement_id as "agreementId", enabled,
      generation::text, first_automatic_cycle::text as "firstAutomaticCycle",
      next_cycle_ordinal::text as "nextCycleOrdinal", requested_by as "requestedBy",
      time_zone as "timeZone", due_policy as "duePolicy"
    from openerp.recurring_invoice_draft_schedules
    where book_id=${bookId} and agreement_id=${agreementId} for update
  `,
    "objects",
  );
}

export function insertScheduling(transaction: Transaction, row: SchedulingRow, changedAt: string) {
  return transaction.execute(sql`
    insert into openerp.recurring_invoice_draft_schedules
      (book_id,agreement_id,enabled,generation,first_automatic_cycle,next_cycle_ordinal,requested_by,time_zone,due_policy,changed_at)
    values (${row.bookId},${row.agreementId},${row.enabled},${row.generation}::bigint,
      ${row.firstAutomaticCycle}::bigint,${row.nextCycleOrdinal}::bigint,${row.requestedBy},${row.timeZone},${row.duePolicy},${changedAt}::timestamptz)
  `);
}

export function changeScheduling(transaction: Transaction, row: SchedulingRow, changedAt: string) {
  return transaction.execute(sql`
    update openerp.recurring_invoice_draft_schedules set enabled=${row.enabled},generation=${row.generation}::bigint,
      requested_by=${row.requestedBy},changed_at=${changedAt}::timestamptz
    where book_id=${row.bookId} and agreement_id=${row.agreementId}
  `);
}

export function appendSchedulingEvent(
  transaction: Transaction,
  row: SchedulingRow,
  body: JsonObject,
) {
  return transaction.execute(sql`
    insert into openerp.recurring_invoice_draft_schedule_events (book_id,agreement_id,generation,body)
    values (${row.bookId},${row.agreementId},${row.generation}::bigint,${JSON.stringify(body)}::jsonb)
  `);
}

export function advanceCursor(
  transaction: Transaction,
  bookId: string,
  agreementId: string,
  next: string,
) {
  return transaction.execute(sql`
    update openerp.recurring_invoice_draft_schedules set next_cycle_ordinal=${next}::bigint
    where book_id=${bookId} and agreement_id=${agreementId}
  `);
}

export function readJobs(
  transaction: Transaction,
  bookId: string,
  agreementId: string,
  after: string | undefined,
) {
  return transaction.execute<DraftJobRow>(
    sql`
    select id,book_id as "bookId",agreement_id as "agreementId",cycle_ordinal::text as "cycleOrdinal",
      generation::text,schedule_generation::text as "scheduleGeneration",requested_by as "requestedBy",
      executor_id as "executorId",admitted,state,reason,draft_id as "draftId"
    from openerp.recurring_invoice_draft_jobs where book_id=${bookId} and agreement_id=${agreementId}
      and (${after ?? null}::text is null or (cycle_ordinal, generation) >
        (select cycle_ordinal, generation from openerp.recurring_invoice_draft_jobs
         where book_id=${bookId} and agreement_id=${agreementId} and id=${after ?? null}))
    order by cycle_ordinal,generation limit 201
  `,
    "objects",
  );
}

export function readJob(transaction: Transaction, bookId: string, id: string, lock = true) {
  return transaction.execute<DraftJobRow>(
    sql`
    select id,book_id as "bookId",agreement_id as "agreementId",cycle_ordinal::text as "cycleOrdinal",
      generation::text,schedule_generation::text as "scheduleGeneration",requested_by as "requestedBy",
      executor_id as "executorId",admitted,state,reason,draft_id as "draftId"
    from openerp.recurring_invoice_draft_jobs where book_id=${bookId} and id=${id} ${lock ? sql`for update` : sql``}
  `,
    "objects",
  );
}

export function readCycleJobs(
  transaction: Transaction,
  bookId: string,
  agreementId: string,
  cycle: string,
) {
  return transaction.execute<DraftJobRow>(
    sql`
    select id,book_id as "bookId",agreement_id as "agreementId",cycle_ordinal::text as "cycleOrdinal",
      generation::text,schedule_generation::text as "scheduleGeneration",requested_by as "requestedBy",
      executor_id as "executorId",admitted,state,reason,draft_id as "draftId"
    from openerp.recurring_invoice_draft_jobs where book_id=${bookId} and agreement_id=${agreementId}
      and cycle_ordinal=${cycle}::bigint order by generation desc for update
  `,
    "objects",
  );
}

export function insertJob(transaction: Transaction, row: DraftJobRow) {
  return transaction.execute(sql`
    insert into openerp.recurring_invoice_draft_jobs
      (book_id,id,agreement_id,cycle_ordinal,generation,schedule_generation,requested_by,executor_id,admitted,state,reason,draft_id,created_at,settled_at)
    values (${row.bookId},${row.id},${row.agreementId},${row.cycleOrdinal}::bigint,${row.generation}::bigint,
      ${row.scheduleGeneration}::bigint,${row.requestedBy},${row.executorId},${JSON.stringify(row.admitted)}::jsonb,${row.state},${row.reason},${row.draftId},clock_timestamp(),
      case when ${row.state}='ready' then null else clock_timestamp() end)
  `);
}

export function settleJob(
  transaction: Transaction,
  bookId: string,
  id: string,
  state: typeof Recurring.RecurringDraftJobState.Type,
  reason: string | null,
  draftId: string | null,
) {
  return transaction.execute(sql`
    update openerp.recurring_invoice_draft_jobs set state=${state},reason=${reason},draft_id=${draftId},settled_at=clock_timestamp()
    where book_id=${bookId} and id=${id} and state='ready'
  `);
}

export function acknowledgeDispatch(transaction: Transaction, bookId: string, id: string) {
  return transaction.execute(sql`
    update openerp.recurring_invoice_draft_jobs set dispatched_at=clock_timestamp()
    where book_id=${bookId} and id=${id} and state='ready'
  `);
}

export function readScanPage(transaction: Transaction, actorId: string, after: ScanCursor | null) {
  return transaction.execute<{
    readonly bookId: string;
    readonly entityId: string;
    readonly agreementId: string;
    readonly requestedBy: string;
  }>(
    sql`
    select s.book_id as "bookId",b.entity_id as "entityId",s.agreement_id as "agreementId",s.requested_by as "requestedBy"
    from openerp.recurring_invoice_draft_schedules s join openerp.books b on b.id=s.book_id
    join openerp.memberships m on m.book_id=s.book_id and m.actor_id=${actorId}
    where (${after === null} or (s.book_id collate "C",s.agreement_id collate "C") > (${after?.bookId ?? ""},${after?.agreementId ?? ""}))
    order by s.book_id collate "C",s.agreement_id collate "C" limit 101
  `,
    "objects",
  );
}

export function readReadyPage(transaction: Transaction, actorId: string) {
  return transaction.execute<{
    readonly bookId: string;
    readonly entityId: string;
    readonly id: string;
    readonly generation: string;
  }>(
    sql`
    select j.book_id as "bookId",b.entity_id as "entityId",j.id,j.generation::text
    from openerp.recurring_invoice_draft_jobs j join openerp.books b on b.id=j.book_id
    where j.executor_id=${actorId} and j.state='ready'
    order by j.book_id collate "C",j.id collate "C" limit 100
  `,
    "objects",
  );
}

export function readCapturedInstant(transaction: Transaction) {
  return transaction.execute<{ readonly capturedAt: string }>(
    sql`select clock_timestamp()::text as "capturedAt"`,
    "objects",
  );
}

export function readLocalDate(transaction: Transaction, timeZone: string, capturedAt: string) {
  return transaction.execute<{ readonly localDate: string | null }>(
    sql`
    select (captured.instant at time zone zone.name)::date::text as "localDate"
    from (select ${capturedAt}::timestamptz as instant) captured
    left join pg_catalog.pg_timezone_names zone on zone.name=${timeZone}
  `,
    "objects",
  );
}

export function lockDelegationAdmission(transaction: Transaction, actorId: string) {
  return transaction.execute<{ readonly enabled: boolean }>(
    sql`
    select enabled from openerp.identity_admissions where actor_id=${actorId} for share
  `,
    "objects",
  );
}

export function lockDelegationMembership(
  transaction: Transaction,
  bookId: string,
  actorId: string,
) {
  return transaction.execute<{ readonly role: string }>(
    sql`
    select role from openerp.memberships where book_id=${bookId} and actor_id=${actorId} for share
  `,
    "objects",
  );
}

export function readAgreementPage(
  transaction: Transaction,
  bookId: string,
  after: string | undefined,
) {
  return transaction.execute<{ readonly id: string; readonly body: JsonObject }>(
    sql`
    select id,body from openerp.recurring_invoice_agreements where book_id=${bookId}
      and (${after === undefined} or id collate "C" > ${after ?? ""}) order by id collate "C" limit 101
  `,
    "objects",
  );
}

export function readAssignedExecutor(
  transaction: Transaction,
  bookId: string,
  agreementId: string,
) {
  return transaction.execute<{ readonly executorId: string }>(
    sql`
    select executor_id as "executorId" from openerp.recurring_invoice_draft_jobs
    where book_id=${bookId} and agreement_id=${agreementId} order by created_at,id limit 1
  `,
    "objects",
  );
}

export function readSchedulingEvents(
  transaction: Transaction,
  bookId: string,
  agreementId: string,
) {
  return transaction.execute<{ readonly body: JsonObject }>(
    sql`
    select body from openerp.recurring_invoice_draft_schedule_events
    where book_id=${bookId} and agreement_id=${agreementId} order by generation
  `,
    "objects",
  );
}
