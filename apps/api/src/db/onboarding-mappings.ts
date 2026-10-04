import { sql } from "drizzle-orm";
import type * as Schema from "effect/Schema";
import type { Transaction } from "./transaction";

export function readMappingHistory(
  tx: Transaction,
  bookId: string,
  sourceSystem: string,
  sourceAccountId: string,
) {
  return tx.execute<{ body: Schema.JsonObject }>(
    sql`
    select body from openerp.onboarding_account_mappings
    where book_id=${bookId} and source_system=${sourceSystem} and source_account_id=${sourceAccountId}
    order by source_account,revision desc limit 1001`,
    "objects",
  );
}

export function insertMapping(
  tx: Transaction,
  value: {
    bookId: string;
    id: string;
    sourceSystem: string;
    sourceAccountId: string;
    sourceAccount: string;
    accountId: string;
    revision: number;
    body: Schema.JsonObject;
  },
) {
  return tx.execute(sql`insert into openerp.onboarding_account_mappings
    (book_id,id,source_system,source_account_id,source_account,account_id,revision,body)
    values(${value.bookId},${value.id},${value.sourceSystem},${value.sourceAccountId},${value.sourceAccount},${value.accountId},${value.revision},${JSON.stringify(value.body)}::jsonb)`);
}

export function rememberedMappingDefaults(
  tx: Transaction,
  bookId: string,
  sourceSystem: string,
  sourceAccountId: string,
) {
  return tx.execute<{ sourceAccount: string; accountId: string }>(
    sql`
    select current.body->>'sourceAccount' as "sourceAccount",current.body->>'accountId' as "accountId"
    from (select distinct on(source_account) body from openerp.onboarding_account_mappings
      where book_id=${bookId} and source_system=${sourceSystem} and source_account_id=${sourceAccountId}
      order by source_account,revision desc) current
    join openerp.accounts a on a.book_id=${bookId} and a.id=current.body->>'accountId' and a.active
    where current.body->>'remember'='true' order by current.body->>'sourceAccount' limit 501`,
    "objects",
  );
}
