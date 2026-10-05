import { sql } from "drizzle-orm";
import type * as Schema from "effect/Schema";
import type { Transaction } from "../transaction";

type SavedBasis = {
  readonly body: Schema.JsonObject;
  readonly content: string;
  readonly sha256: string;
  readonly byteLength: number;
};

export function insertBasis(
  transaction: Transaction,
  bookId: string,
  id: string,
  saved: SavedBasis,
) {
  return transaction.execute(sql`
    insert into openerp.cash_bases (book_id, id, body, content, sha256, byte_length)
    values (${bookId}, ${id}, ${JSON.stringify(saved.body)}::jsonb,
      ${saved.content}, ${saved.sha256}, ${saved.byteLength})
  `);
}

export function readBasis(transaction: Transaction, bookId: string, id: string) {
  return transaction.execute<SavedBasis>(
    sql`
    select body, content, sha256, byte_length as "byteLength"
    from openerp.cash_bases where book_id = ${bookId} and id = ${id}
  `,
    "objects",
  );
}

export function listBases(transaction: Transaction, bookId: string, after: string) {
  return transaction.execute<{ readonly body: Schema.JsonObject }>(
    sql`
      select jsonb_build_object(
        'id', id, 'asOf', body->>'asOf', 'recordedCutoff', body->>'recordedCutoff',
        'openingStatus', body->'opening'->>'status', 'openingMinor', body->'opening'->'totalMinor',
        'digest', body->>'digest', 'label', body->>'label', 'companyCoverage', body->>'companyCoverage'
      ) as body
      from openerp.cash_bases
      where book_id = ${bookId} and id collate "C" > ${after} collate "C"
      order by id collate "C" limit 51
    `,
    "objects",
  );
}

export function countBases(transaction: Transaction, bookId: string) {
  return transaction.execute<{ readonly total: number }>(
    sql`select count(*)::integer as total from openerp.cash_bases where book_id = ${bookId}`,
    "objects",
  );
}
