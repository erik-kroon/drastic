import { sql } from "drizzle-orm";
import * as Schema from "effect/Schema";
import type { Transaction } from "./transaction";

type JsonObject = Schema.JsonObject;
type Lock = "share" | "update";

export type DirectTableAccess = {
  readonly tableName: string;
  readonly canSelect: boolean;
  readonly canInsert: boolean;
};

export type FxReviewRow = {
  readonly bookId: string;
  readonly id: string;
  readonly itemId: string;
  readonly settlementId: string | null;
  readonly actorId: string;
  readonly body: JsonObject;
};

export type FxApprovalRow = {
  readonly bookId: string;
  readonly id: string;
  readonly reviewId: string;
  readonly actorId: string;
  readonly digest: string;
  readonly expiresAt: string;
  readonly body: JsonObject;
};

export type FxItemRow = {
  readonly bookId: string;
  readonly id: string;
  readonly reviewId: string;
  readonly approvalId: string;
  readonly postingReceiptId: string;
  readonly body: JsonObject;
};

export type FxSettlementRow = {
  readonly bookId: string;
  readonly id: string;
  readonly itemId: string;
  readonly reviewId: string;
  readonly approvalId: string;
  readonly postingReceiptId: string;
  readonly eventId: string;
  readonly voucherId: string;
  readonly cashLineId: string;
  readonly controlLineId: string | null;
  readonly realizedLineId: string | null;
  readonly profile: string;
  readonly legOrdinal: number;
  readonly finalLeg: boolean | null;
  readonly originalReleasedMinor: string;
  readonly carryingReleasedMinor: string;
  readonly considerationMinor: string;
  readonly realizedGainMinor: string;
  readonly originalRemainingBeforeMinor: string | null;
  readonly originalRemainingAfterMinor: string | null;
  readonly carryingRemainingBeforeMinor: string | null;
  readonly carryingRemainingAfterMinor: string | null;
  readonly body: JsonObject;
};

export type FxCorrectionRow = {
  readonly bookId: string;
  readonly id: string;
  readonly itemId: string;
  readonly settlementId: string;
  readonly reviewId: string;
  readonly approvalId: string;
  readonly postingReceiptId: string;
  readonly originalVoucherId: string;
  readonly body: JsonObject;
};

export type RateRow = { readonly body: JsonObject };
export type CounterpartyRow = {
  readonly id: string;
  readonly role: string;
  readonly currentRevision: string;
  readonly body: JsonObject;
};
export type BankAccountRow = { readonly accountId: string };

export function readDirectTableAccess(transaction: Transaction) {
  return transaction.execute<DirectTableAccess>(
    sql`
      select
        table_name as "tableName",
        case when to_regclass('openerp.' || table_name) is null then false
          else has_table_privilege(current_user, 'openerp.' || table_name, 'select') end as "canSelect",
        case when to_regclass('openerp.' || table_name) is null then false
          else has_table_privilege(current_user, 'openerp.' || table_name, 'insert') end as "canInsert"
      from unnest(ARRAY[
        'commerce_fx_recognition_reviews',
        'commerce_fx_recognition_approvals',
        'commerce_fx_items',
        'commerce_fx_settlement_reviews',
        'commerce_fx_settlement_approvals',
        'commerce_fx_settlements',
        'commerce_fx_settlement_correction_reviews',
        'commerce_fx_settlement_correction_approvals',
        'commerce_fx_settlement_corrections',
        'commerce_counterparties',
        'commerce_counterparty_revisions',
        'commerce_control_accounts',
        'owner_control_accounts',
        'vat_control_account_roles',
        'bank_sources',
        'exchange_rate_revisions',
        'exchange_rate_withdrawals'
      ]::text[]) as table_name
    `,
    "objects",
  );
}

function lockSql(lock: Lock) {
  return lock === "update" ? sql`for update` : sql`for share`;
}

export function readRecognitionReview(
  transaction: Transaction,
  bookId: string,
  id: string,
  lock: Lock = "share",
) {
  return transaction.execute<FxReviewRow>(
    sql`
      select book_id as "bookId", id, item_id as "itemId", null::text as "settlementId",
        actor_id as "actorId", body
      from openerp.commerce_fx_recognition_reviews
      where book_id = ${bookId} and id = ${id}
      ${lockSql(lock)}
    `,
    "objects",
  );
}

export function readSettlementReview(
  transaction: Transaction,
  bookId: string,
  id: string,
  lock: Lock = "share",
) {
  return transaction.execute<FxReviewRow>(
    sql`
      select book_id as "bookId", id, item_id as "itemId", null::text as "settlementId",
        actor_id as "actorId", body
      from openerp.commerce_fx_settlement_reviews
      where book_id = ${bookId} and id = ${id}
      ${lockSql(lock)}
    `,
    "objects",
  );
}

export function readCorrectionReview(
  transaction: Transaction,
  bookId: string,
  id: string,
  lock: Lock = "share",
) {
  return transaction.execute<FxReviewRow>(
    sql`
      select book_id as "bookId", id, null::text as "itemId", settlement_id as "settlementId",
        actor_id as "actorId", body
      from openerp.commerce_fx_settlement_correction_reviews
      where book_id = ${bookId} and id = ${id}
      ${lockSql(lock)}
    `,
    "objects",
  );
}

export function insertRecognitionReview(
  transaction: Transaction,
  row: { bookId: string; id: string; itemId: string; actorId: string; body: JsonObject },
) {
  return transaction.execute(
    sql`
      insert into openerp.commerce_fx_recognition_reviews (book_id, id, item_id, actor_id, body)
      values (${row.bookId}, ${row.id}, ${row.itemId}, ${row.actorId}, ${JSON.stringify(row.body)}::jsonb)
    `,
    "objects",
  );
}

export function insertSettlementReview(
  transaction: Transaction,
  row: { bookId: string; id: string; itemId: string; actorId: string; body: JsonObject },
) {
  return transaction.execute(
    sql`
      insert into openerp.commerce_fx_settlement_reviews (book_id, id, item_id, actor_id, body)
      values (${row.bookId}, ${row.id}, ${row.itemId}, ${row.actorId}, ${JSON.stringify(row.body)}::jsonb)
    `,
    "objects",
  );
}

export function insertCorrectionReview(
  transaction: Transaction,
  row: { bookId: string; id: string; settlementId: string; actorId: string; body: JsonObject },
) {
  return transaction.execute(
    sql`
      insert into openerp.commerce_fx_settlement_correction_reviews
        (book_id, id, settlement_id, actor_id, body)
      values (${row.bookId}, ${row.id}, ${row.settlementId}, ${row.actorId}, ${JSON.stringify(row.body)}::jsonb)
    `,
    "objects",
  );
}

export function readRecognitionApproval(
  transaction: Transaction,
  bookId: string,
  reviewId: string,
  id: string,
  lock: Lock = "share",
) {
  return transaction.execute<FxApprovalRow>(
    sql`
      select book_id as "bookId", id, review_id as "reviewId", actor_id as "actorId",
        digest, expires_at as "expiresAt", body
      from openerp.commerce_fx_recognition_approvals
      where book_id = ${bookId} and review_id = ${reviewId} and id = ${id}
      ${lockSql(lock)}
    `,
    "objects",
  );
}

export function readSettlementApproval(
  transaction: Transaction,
  bookId: string,
  reviewId: string,
  id: string,
  lock: Lock = "share",
) {
  return transaction.execute<FxApprovalRow>(
    sql`
      select book_id as "bookId", id, review_id as "reviewId", actor_id as "actorId",
        digest, expires_at as "expiresAt", body
      from openerp.commerce_fx_settlement_approvals
      where book_id = ${bookId} and review_id = ${reviewId} and id = ${id}
      ${lockSql(lock)}
    `,
    "objects",
  );
}

export function readCorrectionApproval(
  transaction: Transaction,
  bookId: string,
  reviewId: string,
  id: string,
  lock: Lock = "share",
) {
  return transaction.execute<FxApprovalRow>(
    sql`
      select book_id as "bookId", id, review_id as "reviewId", actor_id as "actorId",
        digest, expires_at as "expiresAt", body
      from openerp.commerce_fx_settlement_correction_approvals
      where book_id = ${bookId} and review_id = ${reviewId} and id = ${id}
      ${lockSql(lock)}
    `,
    "objects",
  );
}

export function insertRecognitionApproval(
  transaction: Transaction,
  row: { bookId: string; id: string; reviewId: string; actorId: string; digest: string; expiresAt: string; body: JsonObject },
) {
  return transaction.execute(
    sql`
      insert into openerp.commerce_fx_recognition_approvals
        (book_id, id, review_id, actor_id, digest, expires_at, body)
      values (${row.bookId}, ${row.id}, ${row.reviewId}, ${row.actorId}, ${row.digest},
        ${row.expiresAt}, ${JSON.stringify(row.body)}::jsonb)
    `,
    "objects",
  );
}

export function insertSettlementApproval(
  transaction: Transaction,
  row: { bookId: string; id: string; reviewId: string; actorId: string; digest: string; expiresAt: string; body: JsonObject },
) {
  return transaction.execute(
    sql`
      insert into openerp.commerce_fx_settlement_approvals
        (book_id, id, review_id, actor_id, digest, expires_at, body)
      values (${row.bookId}, ${row.id}, ${row.reviewId}, ${row.actorId}, ${row.digest},
        ${row.expiresAt}, ${JSON.stringify(row.body)}::jsonb)
    `,
    "objects",
  );
}

export function insertCorrectionApproval(
  transaction: Transaction,
  row: { bookId: string; id: string; reviewId: string; actorId: string; digest: string; expiresAt: string; body: JsonObject },
) {
  return transaction.execute(
    sql`
      insert into openerp.commerce_fx_settlement_correction_approvals
        (book_id, id, review_id, actor_id, digest, expires_at, body)
      values (${row.bookId}, ${row.id}, ${row.reviewId}, ${row.actorId}, ${row.digest},
        ${row.expiresAt}, ${JSON.stringify(row.body)}::jsonb)
    `,
    "objects",
  );
}

export function readItem(
  transaction: Transaction,
  bookId: string,
  id: string,
  lock: Lock = "share",
) {
  return transaction.execute<FxItemRow>(
    sql`
      select book_id as "bookId", id, review_id as "reviewId", approval_id as "approvalId",
        posting_receipt_id as "postingReceiptId", body
      from openerp.commerce_fx_items
      where book_id = ${bookId} and id = ${id}
      ${lockSql(lock)}
    `,
    "objects",
  );
}

export function readItemBySourceKey(transaction: Transaction, bookId: string, sourceKey: string) {
  return transaction.execute<{ readonly id: string }>(
    sql`
      select id from openerp.commerce_fx_items
      where book_id = ${bookId} and source_key = ${sourceKey}
      for share
    `,
    "objects",
  );
}

export function readItemByReview(transaction: Transaction, bookId: string, reviewId: string) {
  return transaction.execute<{ readonly id: string }>(
    sql`
      select id from openerp.commerce_fx_items
      where book_id = ${bookId} and review_id = ${reviewId}
      for share
    `,
    "objects",
  );
}

export function readSettlementByReview(transaction: Transaction, bookId: string, reviewId: string) {
  return transaction.execute<{ readonly id: string }>(
    sql`
      select id from openerp.commerce_fx_settlements
      where book_id = ${bookId} and review_id = ${reviewId}
      for share
    `,
    "objects",
  );
}

export function readUnconsumedSettlementsAfter(
  transaction: Transaction,
  bookId: string,
  itemId: string,
  legOrdinal: number,
) {
  return transaction.execute<{ readonly id: string }>(
    sql`
      select s.id
      from openerp.commerce_fx_settlements s
      where s.book_id = ${bookId}
        and s.item_id = ${itemId}
        and s.leg_ordinal > ${legOrdinal}
        and not exists (
          select 1 from openerp.commerce_fx_settlement_corrections c
          where c.book_id = s.book_id and c.settlement_id = s.id
        )
      for share
    `,
    "objects",
  );
}

export function insertItem(
  transaction: Transaction,
  row: {
    bookId: string;
    id: string;
    reviewId: string;
    approvalId: string;
    postingReceiptId: string;
    counterpartyId: string;
    counterpartyRevision: string;
    sourceKey: string;
    sourceRevision: string;
    evidenceId: string;
    rateObservationId: string;
    rateRevision: number;
    rateDigest: string;
    eventId: string;
    voucherId: string;
    lineId: string;
    originalCurrency: string;
    originalScale: number;
    originalMinor: string;
    bookCurrency: string;
    bookScale: number;
    carryingMinor: string;
    body: JsonObject;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.commerce_fx_items
        (book_id, id, review_id, approval_id, posting_receipt_id, counterparty_id,
         counterparty_revision, source_key, source_revision, evidence_id, rate_observation_id,
         rate_revision, rate_digest, event_id, voucher_id, line_id, original_currency,
         original_scale, original_minor, book_currency, book_scale, carrying_minor, body)
      values (${row.bookId}, ${row.id}, ${row.reviewId}, ${row.approvalId}, ${row.postingReceiptId},
        ${row.counterpartyId}, ${row.counterpartyRevision}, ${row.sourceKey}, ${row.sourceRevision},
        ${row.evidenceId}, ${row.rateObservationId}, ${row.rateRevision}, ${row.rateDigest}, ${row.eventId},
        ${row.voucherId}, ${row.lineId}, ${row.originalCurrency}, ${row.originalScale}, ${row.originalMinor},
        ${row.bookCurrency}, ${row.bookScale}, ${row.carryingMinor}, ${JSON.stringify(row.body)}::jsonb)
    `,
    "objects",
  );
}

export function readSettlements(transaction: Transaction, bookId: string, itemId: string) {
  return transaction.execute<FxSettlementRow>(
    sql`
      select book_id as "bookId", id, item_id as "itemId", review_id as "reviewId",
        approval_id as "approvalId", posting_receipt_id as "postingReceiptId", event_id as "eventId",
        voucher_id as "voucherId", cash_line_id as "cashLineId", control_line_id as "controlLineId",
        realized_line_id as "realizedLineId", profile, leg_ordinal as "legOrdinal",
        final_leg as "finalLeg", original_released_minor as "originalReleasedMinor",
        carrying_released_minor as "carryingReleasedMinor", consideration_minor as "considerationMinor",
        realized_gain_minor as "realizedGainMinor", original_remaining_before_minor as "originalRemainingBeforeMinor",
        original_remaining_after_minor as "originalRemainingAfterMinor",
        carrying_remaining_before_minor as "carryingRemainingBeforeMinor",
        carrying_remaining_after_minor as "carryingRemainingAfterMinor", body
      from openerp.commerce_fx_settlements
      where book_id = ${bookId} and item_id = ${itemId}
      order by leg_ordinal
      for share
    `,
    "objects",
  );
}

export function readSettlement(
  transaction: Transaction,
  bookId: string,
  id: string,
  lock: Lock = "share",
) {
  return transaction.execute<FxSettlementRow>(
    sql`
      select book_id as "bookId", id, item_id as "itemId", review_id as "reviewId",
        approval_id as "approvalId", posting_receipt_id as "postingReceiptId", event_id as "eventId",
        voucher_id as "voucherId", cash_line_id as "cashLineId", control_line_id as "controlLineId",
        realized_line_id as "realizedLineId", profile, leg_ordinal as "legOrdinal",
        final_leg as "finalLeg", original_released_minor as "originalReleasedMinor",
        carrying_released_minor as "carryingReleasedMinor", consideration_minor as "considerationMinor",
        realized_gain_minor as "realizedGainMinor", original_remaining_before_minor as "originalRemainingBeforeMinor",
        original_remaining_after_minor as "originalRemainingAfterMinor",
        carrying_remaining_before_minor as "carryingRemainingBeforeMinor",
        carrying_remaining_after_minor as "carryingRemainingAfterMinor", body
      from openerp.commerce_fx_settlements
      where book_id = ${bookId} and id = ${id}
      ${lockSql(lock)}
    `,
    "objects",
  );
}

export function insertSettlement(
  transaction: Transaction,
  row: {
    bookId: string;
    id: string;
    itemId: string;
    reviewId: string;
    approvalId: string;
    postingReceiptId: string;
    eventId: string;
    voucherId: string;
    cashLineId: string;
    controlLineId: string | null;
    realizedLineId: string | null;
    originalReleasedMinor: string;
    carryingReleasedMinor: string;
    considerationMinor: string;
    realizedGainMinor: string;
    body: JsonObject;
    profile: string;
    legOrdinal: number;
    finalLeg: boolean | null;
    originalRemainingBeforeMinor: string | null;
    originalRemainingAfterMinor: string | null;
    carryingRemainingBeforeMinor: string | null;
    carryingRemainingAfterMinor: string | null;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.commerce_fx_settlements
        (book_id, id, item_id, review_id, approval_id, posting_receipt_id, event_id, voucher_id,
         cash_line_id, control_line_id, realized_line_id, original_released_minor, carrying_released_minor,
         consideration_minor, realized_gain_minor, body, profile, leg_ordinal, final_leg,
         original_remaining_before_minor, original_remaining_after_minor, carrying_remaining_before_minor,
         carrying_remaining_after_minor)
      values (${row.bookId}, ${row.id}, ${row.itemId}, ${row.reviewId}, ${row.approvalId},
        ${row.postingReceiptId}, ${row.eventId}, ${row.voucherId}, ${row.cashLineId}, ${row.controlLineId},
        ${row.realizedLineId}, ${row.originalReleasedMinor}, ${row.carryingReleasedMinor}, ${row.considerationMinor},
        ${row.realizedGainMinor}, ${JSON.stringify(row.body)}::jsonb, ${row.profile}, ${row.legOrdinal},
        ${row.finalLeg}, ${row.originalRemainingBeforeMinor}, ${row.originalRemainingAfterMinor},
        ${row.carryingRemainingBeforeMinor}, ${row.carryingRemainingAfterMinor})
    `,
    "objects",
  );
}

export function readCorrections(transaction: Transaction, bookId: string, itemId: string) {
  return transaction.execute<FxCorrectionRow>(
    sql`
      select c.book_id as "bookId", c.id, c.item_id as "itemId", c.settlement_id as "settlementId",
        c.review_id as "reviewId", c.approval_id as "approvalId", c.posting_receipt_id as "postingReceiptId",
        c.original_voucher_id as "originalVoucherId", c.body
      from openerp.commerce_fx_settlement_corrections c
      where c.book_id = ${bookId} and c.item_id = ${itemId}
      for share
    `,
    "objects",
  );
}

export function readCorrectionBySettlement(
  transaction: Transaction,
  bookId: string,
  settlementId: string,
  lock: Lock = "share",
) {
  return transaction.execute<FxCorrectionRow>(
    sql`
      select book_id as "bookId", id, item_id as "itemId", settlement_id as "settlementId",
        review_id as "reviewId", approval_id as "approvalId", posting_receipt_id as "postingReceiptId",
        original_voucher_id as "originalVoucherId", body
      from openerp.commerce_fx_settlement_corrections
      where book_id = ${bookId} and settlement_id = ${settlementId}
      ${lockSql(lock)}
    `,
    "objects",
  );
}

export function insertCorrection(
  transaction: Transaction,
  row: {
    bookId: string;
    id: string;
    itemId: string;
    settlementId: string;
    reviewId: string;
    approvalId: string;
    postingReceiptId: string;
    originalVoucherId: string;
    body: JsonObject;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.commerce_fx_settlement_corrections
        (book_id, id, item_id, settlement_id, review_id, approval_id, posting_receipt_id, original_voucher_id, body)
      values (${row.bookId}, ${row.id}, ${row.itemId}, ${row.settlementId}, ${row.reviewId},
        ${row.approvalId}, ${row.postingReceiptId}, ${row.originalVoucherId}, ${JSON.stringify(row.body)}::jsonb)
    `,
    "objects",
  );
}

export function readCurrentRate(transaction: Transaction, bookId: string, observationId: string) {
  return transaction.execute<RateRow>(
    sql`
      select body
      from openerp.exchange_rate_revisions
      where book_id = ${bookId} and observation_id = ${observationId}
      order by revision desc
      limit 1
      for share
    `,
    "objects",
  );
}

export function readRateWithdrawal(transaction: Transaction, bookId: string, observationId: string) {
  return transaction.execute<{ readonly observationId: string }>(
    sql`
      select observation_id as "observationId"
      from openerp.exchange_rate_withdrawals
      where book_id = ${bookId} and observation_id = ${observationId}
      for share
    `,
    "objects",
  );
}

export function readCounterparty(
  transaction: Transaction,
  bookId: string,
  counterpartyId: string,
) {
  return transaction.execute<CounterpartyRow>(
    sql`
      select c.id, c.role, c.current_revision as "currentRevision", r.body
      from openerp.commerce_counterparties c
      join openerp.commerce_counterparty_revisions r
        on r.book_id = c.book_id and r.counterparty_id = c.id and r.revision = c.current_revision
      where c.book_id = ${bookId} and c.id = ${counterpartyId}
      for share
    `,
    "objects",
  );
}

export function readBankAccount(transaction: Transaction, bookId: string, accountId: string) {
  return transaction.execute<BankAccountRow>(
    sql`
      select account_id as "accountId"
      from openerp.bank_sources
      where book_id = ${bookId} and account_id = ${accountId}
      for share
    `,
    "objects",
  );
}

export function readControlAccount(
  transaction: Transaction,
  bookId: string,
  table: "commerce_control_accounts" | "owner_control_accounts" | "vat_control_account_roles",
  accountId: string,
) {
  if (table === "commerce_control_accounts") {
    return transaction.execute<BankAccountRow>(
      sql`
        select account_id as "accountId" from openerp.commerce_control_accounts
        where book_id = ${bookId} and account_id = ${accountId} for share
      `,
      "objects",
    );
  }
  if (table === "owner_control_accounts") {
    return transaction.execute<BankAccountRow>(
      sql`
        select account_id as "accountId" from openerp.owner_control_accounts
        where book_id = ${bookId} and account_id = ${accountId} for share
      `,
      "objects",
    );
  }
  return transaction.execute<BankAccountRow>(
    sql`
      select account_id as "accountId" from openerp.vat_control_account_roles
      where book_id = ${bookId} and account_id = ${accountId} for share
    `,
    "objects",
  );
}
