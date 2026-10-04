import type * as Schema from "effect/Schema";
import { sql } from "drizzle-orm";
import type { Transaction } from "./transaction";

export function readQualifiedPlan(tx: Transaction, bookId: string, planId: string, digest: string) {
  return tx.execute<{ id: string }>(
    sql`
    select result->>'id' as id from openerp.command_receipts
    where book_id=${bookId} and operation='prepare_onboarding_import_plan'
      and result->>'id'=${planId} and result->>'digest'=${digest}
    limit 1`,
    "objects",
  );
}

export function readProposalPreparers(tx: Transaction, bookId: string, changeSetId: string) {
  return tx.execute<{ actorId: string }>(
    sql`
    select distinct actor_id as "actorId" from openerp.command_receipts
    where book_id=${bookId} and operation='prepare_sie_financial_voucher' and result->>'id'=${changeSetId}`,
    "objects",
  );
}

export function readImportBatchRecord(
  tx: Transaction,
  bookId: string,
  operation: string,
  id: string,
) {
  return tx.execute<{ body: Schema.JsonObject }>(
    sql`
    select result as body from openerp.command_receipts
    where book_id=${bookId} and operation=${operation} and result->>'id'=${id} limit 1`,
    "objects",
  );
}

export function readCurrentBatch(
  tx: Transaction,
  bookId: string,
  runId: string,
  fence: string,
  ordinal: number,
) {
  return tx.execute<{ body: Schema.JsonObject }>(
    sql`
    select result as body from openerp.command_receipts
    where book_id=${bookId} and operation='prepare_onboarding_import_batch'
      and result->>'financialRunId'=${runId} and result->>'fence'=${fence}
      and (result->>'firstOrdinal')::int=${ordinal}
    order by recorded_at desc,key desc limit 1`,
    "objects",
  );
}

export function readBatchApproval(tx: Transaction, bookId: string, batchId: string) {
  return tx.execute<{ body: Schema.JsonObject }>(
    sql`
    select result as body from openerp.command_receipts
    where book_id=${bookId} and operation='approve_onboarding_import_batch' and result->>'batchId'=${batchId}
    order by recorded_at desc,key desc limit 1`,
    "objects",
  );
}
