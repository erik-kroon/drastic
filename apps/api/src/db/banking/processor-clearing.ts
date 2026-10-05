import { sql } from "drizzle-orm";
import type * as Schema from "effect/Schema";
import type { Transaction } from "../transaction";

type Body = { readonly body: Schema.JsonObject };

export const tables = [
  "processor_accounts",
  "processor_fetch_requests",
  "processor_fetch_pages",
  "processor_fetches",
  "processor_observations",
  "processor_source_occurrences",
  "processor_reviews",
  "processor_approvals",
  "processor_executions",
  "processor_cash_effects",
  "processor_obligation_effects",
  "processor_payout_effects",
  "processor_dispute_effects",
  "processor_bank_claims",
  "processor_native_credit_origins",
  "processor_review_returns",
] as const;

export function readAccount(tx: Transaction, bookId: string, id: string) {
  return tx.execute<Body>(
    sql`select body from openerp.processor_accounts where book_id=${bookId} and id=${id}`,
    "objects",
  );
}

export function readAccountForControl(tx: Transaction, bookId: string, accountId: string) {
  return tx.execute<Body & { readonly id: string }>(
    sql`select id,body from openerp.processor_accounts where book_id=${bookId} and (processor_control_account_id=${accountId} or payout_transit_account_id=${accountId} or body->>'disputeReceivableAccountId'=${accountId})`,
    "objects",
  );
}

export function insertAccount(
  tx: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly providerAccountId: string;
    readonly liveMode: boolean;
    readonly currency: string;
    readonly processorControlAccountId: string;
    readonly payoutTransitAccountId: string;
    readonly body: Schema.JsonObject;
  },
) {
  return tx.execute(
    sql`insert into openerp.processor_accounts(book_id,id,provider_account_id,live_mode,currency,processor_control_account_id,payout_transit_account_id,body) values (${row.bookId},${row.id},${row.providerAccountId},${row.liveMode},${row.currency},${row.processorControlAccountId},${row.payoutTransitAccountId},${JSON.stringify(row.body)}::jsonb)`,
    "objects",
  );
}

export function readFetch(tx: Transaction, bookId: string, id: string) {
  return tx.execute<Body>(
    sql`select body from openerp.processor_fetches where book_id=${bookId} and id=${id}`,
    "objects",
  );
}

export function readFetchRequest(tx: Transaction, bookId: string, key: string) {
  return tx.execute<Body & { readonly id: string; readonly requestDigest: string }>(
    sql`select id,request_digest as "requestDigest",body from openerp.processor_fetch_requests where book_id=${bookId} and command_key=${key}`,
    "objects",
  );
}

export function insertFetchRequest(
  tx: Transaction,
  row: {
    readonly bookId: string;
    readonly key: string;
    readonly id: string;
    readonly accountId: string;
    readonly requestDigest: string;
    readonly body: Schema.JsonObject;
  },
) {
  return tx.execute(
    sql`insert into openerp.processor_fetch_requests(book_id,command_key,id,account_id,request_digest,body) values (${row.bookId},${row.key},${row.id},${row.accountId},${row.requestDigest},${JSON.stringify(row.body)}::jsonb)`,
    "objects",
  );
}

export function readFetchPage(tx: Transaction, bookId: string, fetchId: string, cursorKey: string) {
  return tx.execute<Body & { readonly rawSourceRef: string }>(
    sql`select body,raw_source_ref as "rawSourceRef" from openerp.processor_fetch_pages where book_id=${bookId} and fetch_id=${fetchId} and cursor_key=${cursorKey}`,
    "objects",
  );
}

export function insertFetchPage(
  tx: Transaction,
  row: {
    readonly bookId: string;
    readonly fetchId: string;
    readonly cursorKey: string;
    readonly rawSourceRef: string;
    readonly body: Schema.JsonObject;
  },
) {
  return tx.execute(
    sql`insert into openerp.processor_fetch_pages(book_id,fetch_id,cursor_key,raw_source_ref,body) values (${row.bookId},${row.fetchId},${row.cursorKey},${row.rawSourceRef},${JSON.stringify(row.body)}::jsonb)`,
    "objects",
  );
}

export function insertFetch(
  tx: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly accountId: string;
    readonly body: Schema.JsonObject;
  },
) {
  return tx.execute(
    sql`insert into openerp.processor_fetches(book_id,id,account_id,body) values (${row.bookId},${row.id},${row.accountId},${JSON.stringify(row.body)}::jsonb)`,
    "objects",
  );
}

export function readObservation(tx: Transaction, bookId: string, id: string) {
  return tx.execute<Body>(
    sql`select body from openerp.processor_observations where book_id=${bookId} and id=${id}`,
    "objects",
  );
}

export function readOccurrence(
  tx: Transaction,
  bookId: string,
  accountId: string,
  transactionId: string,
) {
  return tx.execute<Body & { readonly semanticDigest: string }>(
    sql`select body,semantic_digest as "semanticDigest" from openerp.processor_observations where book_id=${bookId} and account_id=${accountId} and balance_transaction_id=${transactionId}`,
    "objects",
  );
}

export function readObservations(tx: Transaction, bookId: string, accountId: string) {
  return tx.execute<Body>(
    sql`select body from openerp.processor_observations where book_id=${bookId} and account_id=${accountId} order by id collate "C"`,
    "objects",
  );
}

export function insertObservation(
  tx: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly accountId: string;
    readonly balanceTransactionId: string;
    readonly semanticDigest: string;
    readonly body: Schema.JsonObject;
  },
) {
  return tx.execute(
    sql`insert into openerp.processor_observations(book_id,id,account_id,balance_transaction_id,semantic_digest,body) values (${row.bookId},${row.id},${row.accountId},${row.balanceTransactionId},${row.semanticDigest},${JSON.stringify(row.body)}::jsonb)`,
    "objects",
  );
}

export function insertSourceOccurrence(
  tx: Transaction,
  row: {
    readonly bookId: string;
    readonly fetchId: string;
    readonly observationId: string;
    readonly rawSourceRef: string;
    readonly payoutMembershipId: string | null;
    readonly body: Schema.JsonObject;
  },
) {
  return tx.execute(
    sql`insert into openerp.processor_source_occurrences(book_id,fetch_id,observation_id,raw_source_ref,payout_membership_id,body) values (${row.bookId},${row.fetchId},${row.observationId},${row.rawSourceRef},${row.payoutMembershipId},${JSON.stringify(row.body)}::jsonb)`,
    "objects",
  );
}

export function readReview(tx: Transaction, bookId: string, id: string) {
  return tx.execute<Body & { readonly id: string; readonly actorId: string }>(
    sql`select id,actor_id as "actorId",body from openerp.processor_reviews where book_id=${bookId} and id=${id}`,
    "objects",
  );
}

export function readReturn(tx: Transaction, bookId: string, reviewId: string) {
  return tx.execute<Body>(
    sql`select body from openerp.processor_review_returns where book_id=${bookId} and review_id=${reviewId}`,
    "objects",
  );
}

export function insertReturn(
  tx: Transaction,
  bookId: string,
  row: {
    readonly id: string;
    readonly reviewId: string;
    readonly actorId: string;
    readonly digest: string;
    readonly body: Schema.JsonObject;
  },
) {
  return tx.execute(
    sql`insert into openerp.processor_review_returns(book_id,id,review_id,actor_id,digest,body) values (${bookId},${row.id},${row.reviewId},${row.actorId},${row.digest},${JSON.stringify(row.body)}::jsonb)`,
    "objects",
  );
}

export function accountPage(tx: Transaction, bookId: string, after: string | null) {
  return tx.execute<Body>(
    sql`select body from openerp.processor_accounts where book_id=${bookId} and (${after}::text is null or id collate "C">${after}::text collate "C") order by id collate "C" limit 21`,
    "objects",
  );
}

export function reviewPage(
  tx: Transaction,
  bookId: string,
  accountId: string,
  after: string | null,
) {
  return tx.execute<Body>(
    sql`select body from openerp.processor_reviews where book_id=${bookId} and body->'input'->>'accountId'=${accountId} and (${after}::text is null or id collate "C">${after}::text collate "C") order by id collate "C" limit 21`,
    "objects",
  );
}

export function readApprovals(tx: Transaction, bookId: string, reviewId: string) {
  return tx.execute<Body>(
    sql`select body from openerp.processor_approvals where book_id=${bookId} and review_id=${reviewId} order by id collate "C" limit 21`,
    "objects",
  );
}

export function readPayoutMembershipFetches(
  tx: Transaction,
  bookId: string,
  accountId: string,
  providerPayoutId: string,
) {
  return tx.execute<Body>(
    sql`select f.body from openerp.processor_fetches f where f.book_id=${bookId} and f.account_id=${accountId} and f.body->'selection'->>'view'='automatic_payout' and f.body->'selection'->>'providerPayoutId'=${providerPayoutId} order by f.id collate "C" limit 21`,
    "objects",
  );
}

export function readPreparerName(tx: Transaction, bookId: string, actorId: string) {
  return tx.execute<{ readonly name: string }>(
    sql`select a.name from openerp.actors a join openerp.memberships m on m.actor_id=a.id where m.book_id=${bookId} and a.id=${actorId}`,
    "objects",
  );
}

export function readInvoiceLabel(tx: Transaction, bookId: string, invoiceId: string) {
  return tx.execute<{ readonly documentNumber: string }>(
    sql`select body->>'documentNumber' as "documentNumber" from openerp.commerce_invoices where book_id=${bookId} and id=${invoiceId} and direction='customer'`,
    "objects",
  );
}

export function readReviewByPlan(
  tx: Transaction,
  bookId: string,
  planId: string,
  eventId?: string,
) {
  return tx.execute<Body & { readonly id: string; readonly actorId: string }>(
    sql`select r.id,r.actor_id as "actorId",r.body from openerp.processor_reviews r where r.book_id=${bookId} and (r.body->'postingAction'->>'eventId'=${eventId ?? null} or exists(select 1 from openerp.change_sets p where p.book_id=r.book_id and p.id=${planId} and p.plan->'groups'->0->'actions'->0=r.body->'postingAction')) order by r.id collate "C"`,
    "objects",
  );
}

export function insertReview(
  tx: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly actorId: string;
    readonly sourceIdentity: string;
    readonly body: Schema.JsonObject;
  },
) {
  return tx.execute(
    sql`insert into openerp.processor_reviews(book_id,id,actor_id,source_identity,body) values (${row.bookId},${row.id},${row.actorId},${row.sourceIdentity},${JSON.stringify(row.body)}::jsonb)`,
    "objects",
  );
}

export function readApproval(tx: Transaction, bookId: string, reviewId: string, id: string) {
  return tx.execute<Body>(
    sql`select body from openerp.processor_approvals where book_id=${bookId} and review_id=${reviewId} and id=${id}`,
    "objects",
  );
}

export function insertApproval(
  tx: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly reviewId: string;
    readonly actorId: string;
    readonly digest: string;
    readonly expiresAt: string;
    readonly body: Schema.JsonObject;
  },
) {
  return tx.execute(
    sql`insert into openerp.processor_approvals(book_id,id,review_id,actor_id,digest,expires_at,body) values (${row.bookId},${row.id},${row.reviewId},${row.actorId},${row.digest},${row.expiresAt}::timestamptz,${JSON.stringify(row.body)}::jsonb)`,
    "objects",
  );
}

export function readExecution(tx: Transaction, bookId: string, reviewId: string) {
  return tx.execute<Body>(
    sql`select body from openerp.processor_executions where book_id=${bookId} and review_id=${reviewId}`,
    "objects",
  );
}

export function readSourceEffect(tx: Transaction, bookId: string, identity: string) {
  return tx.execute<Body & { readonly reviewId: string }>(
    sql`select review_id as "reviewId",body from openerp.processor_executions where book_id=${bookId} and source_identity=${identity}`,
    "objects",
  );
}

export function readObservationEffect(tx: Transaction, bookId: string, observationId: string) {
  return tx.execute<Body & { readonly reviewId: string }>(
    sql`select review_id as "reviewId",body from openerp.processor_executions where book_id=${bookId} and observation_id=${observationId}`,
    "objects",
  );
}

export function readOwnedVoucher(tx: Transaction, bookId: string, voucherId: string) {
  return tx.execute<{
    readonly id: string;
    readonly reviewId: string;
    readonly sourceIdentity: string;
  }>(
    sql`select review_id as id,review_id as "reviewId",source_identity as "sourceIdentity" from openerp.processor_executions where book_id=${bookId} and voucher_id=${voucherId} union all select origin_id as id,origin_id as "reviewId",'native_credit_origin' as "sourceIdentity" from openerp.processor_native_credit_origins where book_id=${bookId} and source_voucher_id=${voucherId}`,
    "objects",
  );
}

export function readNativeCreditBasis(tx: Transaction, bookId: string, originId: string) {
  return tx.execute<
    Body & {
      readonly originalNativeMinor: string;
      readonly originalCarryingMinor: string;
      readonly sourceVoucherId: string;
      readonly sourceLineId: string;
    }
  >(
    sql`select body,original_native_minor::text as "originalNativeMinor",original_carrying_minor::text as "originalCarryingMinor",source_voucher_id as "sourceVoucherId",source_line_id as "sourceLineId" from openerp.processor_native_credit_origins where book_id=${bookId} and origin_id=${originId}`,
    "objects",
  );
}

export function readNativeCreditLine(
  tx: Transaction,
  bookId: string,
  voucherId: string,
  lineId: string,
) {
  return tx.execute<Body>(
    sql`select body from openerp.processor_native_credit_origins where book_id=${bookId} and source_voucher_id=${voucherId} and source_line_id=${lineId}`,
    "objects",
  );
}

export function readCustomer(tx: Transaction, bookId: string, id: string) {
  return tx.execute<{ readonly id: string }>(
    sql`select id from openerp.commerce_counterparties where book_id=${bookId} and id=${id} and role in ('customer','both')`,
    "objects",
  );
}

export function insertNativeCreditBasis(
  tx: Transaction,
  row: {
    readonly bookId: string;
    readonly originId: string;
    readonly accountId: string;
    readonly sourceVoucherId: string;
    readonly sourceLineId: string;
    readonly originalNativeMinor: string;
    readonly originalCarryingMinor: string;
    readonly body: Schema.JsonObject;
  },
) {
  return tx.execute(
    sql`insert into openerp.processor_native_credit_origins(book_id,origin_id,account_id,source_voucher_id,source_line_id,original_native_minor,original_carrying_minor,body) values (${row.bookId},${row.originId},${row.accountId},${row.sourceVoucherId},${row.sourceLineId},${row.originalNativeMinor}::numeric,${row.originalCarryingMinor}::numeric,${JSON.stringify(row.body)}::jsonb)`,
    "objects",
  );
}

export function insertExecution(
  tx: Transaction,
  row: {
    readonly bookId: string;
    readonly reviewId: string;
    readonly sourceIdentity: string;
    readonly voucherId: string | null;
    readonly observationId: string | null;
    readonly body: Schema.JsonObject;
  },
) {
  return tx.execute(
    sql`insert into openerp.processor_executions(book_id,review_id,source_identity,voucher_id,observation_id,body) values (${row.bookId},${row.reviewId},${row.sourceIdentity},${row.voucherId},${row.observationId},${JSON.stringify(row.body)}::jsonb)`,
    "objects",
  );
}

export function readCashEffects(tx: Transaction, bookId: string, accountId: string) {
  return tx.execute<{
    readonly id: string;
    readonly nativeDeltaMinor: string;
    readonly carryingDeltaMinor: string;
    readonly actualOn: string;
  }>(
    sql`select id,native_delta_minor::text as "nativeDeltaMinor",carrying_delta_minor::text as "carryingDeltaMinor",actual_on::text as "actualOn" from openerp.processor_cash_effects where book_id=${bookId} and account_id=${accountId} order by id collate "C"`,
    "objects",
  );
}

export function insertCashEffect(
  tx: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly reviewId: string;
    readonly accountId: string;
    readonly sourceIdentity: string;
    readonly nativeDeltaMinor: string;
    readonly carryingDeltaMinor: string;
    readonly actualOn: string;
    readonly voucherId: string;
    readonly body: Schema.JsonObject;
  },
) {
  return tx.execute(
    sql`insert into openerp.processor_cash_effects(book_id,id,review_id,account_id,source_identity,native_delta_minor,carrying_delta_minor,actual_on,voucher_id,body) values (${row.bookId},${row.id},${row.reviewId},${row.accountId},${row.sourceIdentity},${row.nativeDeltaMinor}::numeric,${row.carryingDeltaMinor}::numeric,${row.actualOn}::date,${row.voucherId},${JSON.stringify(row.body)}::jsonb)`,
    "objects",
  );
}

export function readObligationConsumptions(tx: Transaction, bookId: string, itemId: string) {
  return tx.execute<{
    readonly id: string;
    readonly originalReleasedMinor: string;
    readonly carryingReleasedMinor: string;
    readonly body: Schema.JsonObject;
  }>(
    sql`select review_id as id,native_minor::text as "originalReleasedMinor",carrying_minor::text as "carryingReleasedMinor",body from openerp.processor_obligation_effects where book_id=${bookId} and item_id=${itemId} order by review_id collate "C"`,
    "objects",
  );
}

export function insertObligationEffect(
  tx: Transaction,
  row: {
    readonly bookId: string;
    readonly reviewId: string;
    readonly itemId: string;
    readonly nativeMinor: string;
    readonly carryingMinor: string;
    readonly body: Schema.JsonObject;
  },
) {
  return tx.execute(
    sql`insert into openerp.processor_obligation_effects(book_id,review_id,item_id,native_minor,carrying_minor,body) values (${row.bookId},${row.reviewId},${row.itemId},${row.nativeMinor}::numeric,${row.carryingMinor}::numeric,${JSON.stringify(row.body)}::jsonb)`,
    "objects",
  );
}

export type PositionRow = {
  readonly reviewId: string;
  readonly nativeDeltaMinor: string;
  readonly carryingDeltaMinor: string;
  readonly body: Schema.JsonObject;
};

export function readPayoutEffects(tx: Transaction, bookId: string, payoutId: string) {
  return tx.execute<PositionRow>(
    sql`select review_id as "reviewId",native_delta_minor::text as "nativeDeltaMinor",carrying_delta_minor::text as "carryingDeltaMinor",body from openerp.processor_payout_effects where book_id=${bookId} and payout_observation_id=${payoutId} order by review_id collate "C"`,
    "objects",
  );
}

export function insertPayoutEffect(
  tx: Transaction,
  row: {
    readonly bookId: string;
    readonly reviewId: string;
    readonly payoutObservationId: string;
    readonly kind: string;
    readonly nativeDeltaMinor: string;
    readonly carryingDeltaMinor: string;
    readonly body: Schema.JsonObject;
  },
) {
  return tx.execute(
    sql`insert into openerp.processor_payout_effects(book_id,review_id,payout_observation_id,kind,native_delta_minor,carrying_delta_minor,body) values (${row.bookId},${row.reviewId},${row.payoutObservationId},${row.kind},${row.nativeDeltaMinor}::numeric,${row.carryingDeltaMinor}::numeric,${JSON.stringify(row.body)}::jsonb)`,
    "objects",
  );
}

export function readDisputeEffects(
  tx: Transaction,
  bookId: string,
  accountId: string,
  disputeId: string,
) {
  return tx.execute<PositionRow>(
    sql`select review_id as "reviewId",native_delta_minor::text as "nativeDeltaMinor",carrying_delta_minor::text as "carryingDeltaMinor",body from openerp.processor_dispute_effects where book_id=${bookId} and account_id=${accountId} and provider_dispute_id=${disputeId} order by review_id collate "C"`,
    "objects",
  );
}

export function insertDisputeEffect(
  tx: Transaction,
  row: {
    readonly bookId: string;
    readonly reviewId: string;
    readonly accountId: string;
    readonly disputeId: string;
    readonly nativeDeltaMinor: string;
    readonly carryingDeltaMinor: string;
    readonly body: Schema.JsonObject;
  },
) {
  return tx.execute(
    sql`insert into openerp.processor_dispute_effects(book_id,review_id,account_id,provider_dispute_id,native_delta_minor,carrying_delta_minor,body) values (${row.bookId},${row.reviewId},${row.accountId},${row.disputeId},${row.nativeDeltaMinor}::numeric,${row.carryingDeltaMinor}::numeric,${JSON.stringify(row.body)}::jsonb)`,
    "objects",
  );
}

export function readBankClaim(
  tx: Transaction,
  bookId: string,
  statementId: string,
  ordinal: number,
) {
  return tx.execute<{
    readonly reviewId: string;
    readonly voucherId: string;
    readonly lineId: string;
    readonly amountMinor: string;
    readonly nativeMinor: string;
    readonly accountId: string;
  }>(
    sql`select review_id as "reviewId",voucher_id as "voucherId",line_id as "lineId",amount_minor::text as "amountMinor",native_minor::text as "nativeMinor",account_id as "accountId" from openerp.processor_bank_claims where book_id=${bookId} and statement_id=${statementId} and row_ordinal=${ordinal}`,
    "objects",
  );
}

export function insertBankClaim(
  tx: Transaction,
  row: {
    readonly bookId: string;
    readonly statementId: string;
    readonly rowOrdinal: number;
    readonly reviewId: string;
    readonly accountId: string;
    readonly nativeMinor: string;
    readonly amountMinor: string;
    readonly voucherId: string;
    readonly lineId: string;
    readonly body: Schema.JsonObject;
  },
) {
  return tx.execute(
    sql`insert into openerp.processor_bank_claims(book_id,statement_id,row_ordinal,review_id,account_id,native_minor,amount_minor,voucher_id,line_id,body) values (${row.bookId},${row.statementId},${row.rowOrdinal},${row.reviewId},${row.accountId},${row.nativeMinor}::numeric,${row.amountMinor}::numeric,${row.voucherId},${row.lineId},${JSON.stringify(row.body)}::jsonb)`,
    "objects",
  );
}

export function readPayoutBankReceipts(
  tx: Transaction,
  bookId: string,
  accountId: string,
  providerPayoutId: string,
) {
  return tx.execute<{
    readonly statementId: string;
    readonly rowOrdinal: number;
    readonly amountMinor: string;
  }>(
    sql`select o.statement_id as "statementId",o.row_ordinal as "rowOrdinal",o.amount_minor::text as "amountMinor" from openerp.bank_observations o join openerp.bank_statements s on (s.book_id,s.id)=(o.book_id,o.statement_id) where o.book_id=${bookId} and s.account_id=${accountId} and o.provider_id=${providerPayoutId} and o.amount_minor>0 order by o.statement_id,o.row_ordinal`,
    "objects",
  );
}

export function bankCandidatePage(
  tx: Transaction,
  input: {
    readonly bookId: string;
    readonly accountId: string;
    readonly providerId: string;
    readonly sourceBankAccountId: string;
    readonly amountMinor: string;
    readonly currency: string;
    readonly afterStatementId: string | null;
    readonly afterRowOrdinal: number;
  },
) {
  return tx.execute<{ readonly statementId: string; readonly rowOrdinal: number }>(
    sql`select o.statement_id as "statementId",o.row_ordinal as "rowOrdinal"
      from openerp.bank_observations o join openerp.bank_statements s
      on (s.book_id,s.id)=(o.book_id,o.statement_id)
      where o.book_id=${input.bookId} and s.account_id=${input.accountId}
      and o.provider_id=${input.providerId} and o.source_bank_account_id=${input.sourceBankAccountId}
      and o.amount_minor=${input.amountMinor}::numeric and s.import_input->>'currency'=${input.currency}
      and (${input.afterStatementId}::text is null or (o.statement_id collate "C",o.row_ordinal)>(${input.afterStatementId}::text collate "C",${input.afterRowOrdinal}))
      order by o.statement_id collate "C",o.row_ordinal limit 21`,
    "objects",
  );
}
