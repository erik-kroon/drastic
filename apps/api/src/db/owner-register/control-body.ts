import { sql } from "drizzle-orm";
import * as Effect from "effect/Effect";
import type * as Schema from "effect/Schema";
import type { Transaction } from "../transaction";

type JsonObject = Schema.JsonObject;

export type ControlRecordsRow = {
  readonly recordCount: number;
  readonly records: ReadonlyArray<JsonObject>;
  readonly unlinkedCount: number;
};

export type RegisteredAccountRow = {
  readonly accountId: string;
  readonly amount: string;
  readonly digest: string;
};

export function readControlRecords(
  transaction: Transaction,
  bookId: string,
  ownerId: string,
  endsOn: string,
) {
  return transaction.execute<ControlRecordsRow>(
    sql`
      select
        (select count(*) from openerp.owner_records r
          where r.book_id = ${bookId} and r.owner_id = ${ownerId}
            and r.occurred_on <= ${endsOn}::date)::integer as "recordCount",
        coalesce(jsonb_agg(jsonb_build_object(
          'source', r.body, 'revision', v.body, 'review', w.body
        ) order by r.id collate "C"), '[]'::jsonb) as records,
        count(*) filter (where not exists (
          select 1 from openerp.owner_effects e
          where e.book_id = ${bookId} and e.record_id = r.id
            and e.posting_date <= ${endsOn}::date
        ))::integer as "unlinkedCount"
      from openerp.owner_records r
      join openerp.owner_revisions v
        on v.book_id = r.book_id and v.record_id = r.id and v.revision = r.current_revision
      left join openerp.owner_reviews w
        on w.book_id = r.book_id and w.record_id = r.id and w.revision = r.current_revision
      where r.book_id = ${bookId} and r.owner_id = ${ownerId}
        and r.occurred_on <= ${endsOn}::date
    `,
    "objects",
  );
}

export function readRegisteredAccounts(
  transaction: Transaction,
  bookId: string,
  accountIds: ReadonlyArray<string>,
  endsOn: string,
) {
  if (accountIds.length === 0) return Effect.succeed<ReadonlyArray<RegisteredAccountRow>>([]);
  return transaction.execute<RegisteredAccountRow>(
    sql`
      select e.account_id as "accountId",
        coalesce(sum(case when e.side = 'credit' then e.amount_minor else -e.amount_minor end), 0)::text
          as amount,
        openerp.digest(coalesce(jsonb_agg(e.body order by e.id collate "C"), '[]'::jsonb)) as digest
      from openerp.owner_effects e
      where e.book_id = ${bookId} and e.account_id in ${accountIds}
        and e.posting_date <= ${endsOn}::date
      group by e.account_id
    `,
    "objects",
  );
}
