import { sql } from "drizzle-orm";
import type * as Schema from "effect/Schema";
import type { Transaction } from "../transaction";

type StoredForecast = {
  readonly body: Schema.JsonObject;
  readonly content: string;
  readonly sha256: string;
  readonly byteLength: number;
};

export function insertForecast(
  transaction: Transaction,
  bookId: string,
  id: string,
  basisId: string,
  saved: StoredForecast,
) {
  return transaction.execute(sql`
    insert into openerp.cash_forecasts(book_id,id,basis_id,body,content,sha256,byte_length)
    values (${bookId},${id},${basisId},${JSON.stringify(saved.body)}::jsonb,${saved.content},${saved.sha256},${saved.byteLength})
  `);
}

export function readForecast(transaction: Transaction, bookId: string, id: string) {
  return transaction.execute<StoredForecast>(
    sql`
    select body,content,sha256,byte_length as "byteLength"
    from openerp.cash_forecasts where book_id=${bookId} and id=${id}
  `,
    "objects",
  );
}

export function listForecasts(transaction: Transaction, bookId: string, after: string) {
  return transaction.execute<{ readonly body: Schema.JsonObject }>(
    sql`
      select jsonb_build_object(
        'id', id, 'basisId', basis_id, 'asOf', body->>'asOf', 'createdAt', body->>'createdAt',
        'horizonDays', body->'horizonDays', 'endsOn', body->>'endsOn',
        'resultStatus', body->'result'->>'status', 'closingMinor', body->'result'->'closingMinor',
        'digest', body->>'digest', 'label', body->>'label', 'companyCoverage', body->>'companyCoverage'
      ) as body
      from openerp.cash_forecasts
      where book_id = ${bookId} and id collate "C" > ${after} collate "C"
      order by id collate "C" limit 51
    `,
    "objects",
  );
}

export function countForecasts(transaction: Transaction, bookId: string) {
  return transaction.execute<{ readonly total: number }>(
    sql`select count(*)::integer as total from openerp.cash_forecasts where book_id = ${bookId}`,
    "objects",
  );
}
