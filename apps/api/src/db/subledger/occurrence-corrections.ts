import { sql } from "drizzle-orm";
import type { Transaction } from "../transaction";
import type { JsonObject } from "../commerce/access";

export function readOccurrenceForVoucher(tx: Transaction, bookId: string, voucherId: string) {
  return tx.execute<{
    readonly scheduleId: string;
    readonly ordinal: number;
    readonly originalVoucherId: string;
    readonly originalChangeSetId: string;
  }>(
    sql`
    select distinct p.schedule_id as "scheduleId",p.ordinal,v.id as "originalVoucherId",
      p.change_set_id as "originalChangeSetId"
    from openerp.subledger_preparations p
    join openerp.vouchers v on(v.book_id,v.change_set_id)=(p.book_id,p.change_set_id)
    where p.book_id=${bookId} and (v.id=${voucherId}
      or exists(select from openerp.schedule_occurrence_corrections t
        where t.book_id=p.book_id and t.schedule_id=p.schedule_id and t.ordinal=p.ordinal
          and t.replacement_voucher_id=${voucherId}))
    order by p.schedule_id,p.ordinal limit 2`,
    "objects",
  );
}

export function readOwner(tx: Transaction, bookId: string, bundleId: string) {
  return tx.execute<{
    readonly body: JsonObject;
    readonly reversalPlan: JsonObject;
    readonly replacementPlan: JsonObject;
  }>(
    sql`
    select o.body,c.body->'reversal' as "reversalPlan",c.body->'replacement' as "replacementPlan"
    from openerp.schedule_occurrence_correction_owners o
    join openerp.correction_bundles c on(c.book_id,c.id)=(o.book_id,o.bundle_id)
    where o.book_id=${bookId} and o.bundle_id=${bundleId}`,
    "objects",
  );
}

export function insertOwner(
  tx: Transaction,
  row: {
    readonly bookId: string;
    readonly bundleId: string;
    readonly scheduleId: string;
    readonly ordinal: number;
    readonly predecessor: string;
    readonly body: JsonObject;
  },
) {
  return tx.execute(
    sql`insert into openerp.schedule_occurrence_correction_owners
    (book_id,bundle_id,schedule_id,ordinal,predecessor_voucher_id,body)
    values(${row.bookId},${row.bundleId},${row.scheduleId},${row.ordinal},${row.predecessor},${JSON.stringify(row.body)}::jsonb)`,
    "objects",
  );
}

export function insertTransition(
  tx: Transaction,
  row: {
    readonly bookId: string;
    readonly bundleId: string;
    readonly scheduleId: string;
    readonly ordinal: number;
    readonly predecessor: string;
    readonly reversal: string;
    readonly replacement: string;
  },
) {
  return tx.execute(
    sql`insert into openerp.schedule_occurrence_corrections
    (book_id,bundle_id,schedule_id,ordinal,predecessor_voucher_id,reversal_voucher_id,replacement_voucher_id)
    values(${row.bookId},${row.bundleId},${row.scheduleId},${row.ordinal},${row.predecessor},${row.reversal},${row.replacement})`,
    "objects",
  );
}

export function readHistory(
  tx: Transaction,
  bookId: string,
  scheduleId: string,
  ordinal: number,
  through: string,
) {
  return tx.execute<{
    readonly body: JsonObject;
    readonly current: boolean;
  }>(
    sql`
    select jsonb_build_object('bundleId',t.bundle_id,'predecessorVoucherId',t.predecessor_voucher_id,
      'reversalVoucherId',t.reversal_voucher_id,'replacementVoucherId',t.replacement_voucher_id,
      'postingDate',v.posting_date::text,'remainingPlanDecision',o.body->'remainingPlanDecision') as body,
      not exists(select from openerp.vouchers r where r.book_id=v.book_id and r.corrects_voucher_id=v.id
        and r.posting_date<=${through}::date) as current
    from openerp.schedule_occurrence_corrections t
    join openerp.schedule_occurrence_correction_owners o on(o.book_id,o.bundle_id)=(t.book_id,t.bundle_id)
    join openerp.vouchers v on(v.book_id,v.id)=(t.book_id,t.replacement_voucher_id)
    where t.book_id=${bookId} and t.schedule_id=${scheduleId} and t.ordinal=${ordinal}
      and v.posting_date<=${through}::date
    order by v.sequence limit 201`,
    "objects",
  );
}
