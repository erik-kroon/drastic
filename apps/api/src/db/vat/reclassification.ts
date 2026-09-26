import { sql } from "drizzle-orm";
import type * as Schema from "effect/Schema";
import type { JsonObject } from "../commerce/access";
import type { Transaction } from "../transaction";

type Json = Schema.Json;

export type SourceVoucherRow = {
  readonly id: string;
  readonly sequence: string;
  readonly postingDate: string;
  readonly eventId: string;
  readonly postingPurpose: string;
  readonly correctsVoucherId: string | null;
  readonly changeSetId: string;
  readonly action: JsonObject;
};

export function readSourceVoucher(transaction: Transaction, bookId: string, voucherId: string) {
  return transaction.execute<SourceVoucherRow>(
    sql`
      select id, sequence::text as sequence, posting_date::text as "postingDate",
        event_id as "eventId", posting_purpose as "postingPurpose",
        corrects_voucher_id as "correctsVoucherId", change_set_id as "changeSetId", action
      from openerp.vouchers
      where book_id = ${bookId} and id = ${voucherId}
    `,
    "objects",
  );
}

export type CorrectionIdRow = { readonly id: string };

export function readCorrectionVoucherIds(
  transaction: Transaction,
  bookId: string,
  voucherId: string,
) {
  return transaction.execute<CorrectionIdRow>(
    sql`
      select id from openerp.vouchers
      where book_id = ${bookId} and corrects_voucher_id = ${voucherId}
      order by id collate "C"
    `,
    "objects",
  );
}

export type SourceLineRow = {
  readonly id: string;
  readonly ordinal: number;
  readonly accountId: string;
  readonly debitMinor: string;
  readonly creditMinor: string;
  readonly description: string;
};

export function readSourceLine(
  transaction: Transaction,
  bookId: string,
  voucherId: string,
  lineId: string,
) {
  return transaction.execute<SourceLineRow>(
    sql`
      select id, ordinal, account_id as "accountId", debit_minor::text as "debitMinor",
        credit_minor::text as "creditMinor", description
      from openerp.journal_lines
      where book_id = ${bookId} and voucher_id = ${voucherId} and id = ${lineId}
    `,
    "objects",
  );
}

export type AccountStateRow = {
  readonly id: string;
  readonly version: string;
  readonly code: string;
  readonly name: string;
  readonly active: boolean;
};

export function readAccountStates(bookId: string, accountIds: ReadonlyArray<string>) {
  if (accountIds.length === 0) {
    return sql`select ''::text as id, ''::text as version, ''::text as code, ''::text as name, false as active where false`;
  }

  return sql`
    select id, version::text as version, code, name, active from openerp.accounts
    where book_id = ${bookId} and id = any(array[${sql.join(
      accountIds.map((id) => sql`${id}`),
      sql`, `,
    )}]::text[])
    order by id collate "C"
    for share
  `;
}

export function readAccountStateRows(
  transaction: Transaction,
  bookId: string,
  accountIds: ReadonlyArray<string>,
) {
  return transaction.execute<AccountStateRow>(readAccountStates(bookId, accountIds), "objects");
}

export type ConflictRow = { readonly conflict: boolean };

// A single bounded lookup answers whether the three selected VAT control accounts
// already carry an incompatible bank, commerce, owner, tax-account or subledger role.
export function readAccountRoleConflicts(
  transaction: Transaction,
  bookId: string,
  accountIds: ReadonlyArray<string>,
) {
  return transaction.execute<ConflictRow>(
    sql`
      with selected as (
        select unnest(array[${sql.join(
          accountIds.map((id) => sql`${id}`),
          sql`, `,
        )}]::text[]) as account_id
      )
      select
        exists(select from openerp.bank_sources s where s.book_id = ${bookId} and s.account_id = any(selected.account_id))
        or exists(select from openerp.commerce_control_accounts c where c.book_id = ${bookId} and c.account_id = any(selected.account_id))
        or exists(select from openerp.owner_control_accounts c where c.book_id = ${bookId} and c.account_id = any(selected.account_id))
        or exists(select from openerp.tax_account_sources s where s.book_id = ${bookId} and s.account_id = any(selected.account_id))
        or exists(
          select from openerp.subledger_schedules s
          cross join lateral (
            select r.body from openerp.subledger_schedule_revisions r
            where r.book_id = s.book_id and r.schedule_id = s.id
            order by r.revision desc limit 1
          ) r
          where s.book_id = ${bookId} and (
            r.body->'terms'->>'debitAccountId' = any(selected.account_id)
            or r.body->'terms'->>'creditAccountId' = any(selected.account_id)
          )
        ) as conflict
    `,
    "objects",
  );
}

export type RetainedOwnerRow = { readonly conflict: boolean };

// Foreign-currency items and retained impairments own VAT control accounts exclusively.
export function readRetainedAccountOwners(
  transaction: Transaction,
  bookId: string,
  accountIds: ReadonlyArray<string>,
) {
  return transaction.execute<RetainedOwnerRow>(
    sql`
      with selected as (
        select unnest(array[${sql.join(
          accountIds.map((id) => sql`${id}`),
          sql`, `,
        )}]::text[]) as account_id
      ), fx as (
        select case when to_regclass('openerp.commerce_fx_items') is null then false else exists(
          select from openerp.commerce_fx_items i where i.book_id = ${bookId}
            and exists(
              select from jsonb_array_elements(i.body->'accountBindings') role
              where role->>'accountId' = any(selected.account_id)
            )
        ) end as conflict
      ), impairment as (
        select case when to_regclass('openerp.subledger_impairments') is null then false else exists(
          select from openerp.subledger_impairments i where i.book_id = ${bookId}
            and (i.loss_account_id = any(selected.account_id)
              or i.accumulated_impairment_account_id = any(selected.account_id))
        ) end as conflict
      )
      select fx.conflict or impairment.conflict as conflict from fx, impairment
    `,
    "objects",
  );
}

export type ClaimedRow = { readonly claimed: boolean };

// Capacity shared with bank, commerce, owner and subledger registers. Released
// allocations do not reserve a line; a current owner does.
export function readClaimedLines(
  bookId: string,
  pairs: ReadonlyArray<{ readonly voucherId: string; readonly lineId: string }>,
) {
  if (pairs.length === 0) {
    return sql`select ''::text as "voucherId", ''::text as "lineId", false as claimed where false`;
  }

  return sql`
    select pair."voucherId", pair."lineId",
      exists(select from openerp.tax_account_match_capacity c
        where c.book_id = ${bookId} and c.voucher_id = pair."voucherId" and c.line_id = pair."lineId")
      or exists(select from openerp.subledger_basis_lines s
        where s.book_id = ${bookId} and s.voucher_id = pair."voucherId" and s.line_id = pair."lineId")
      or exists(select from openerp.bank_active_matches m
        where m.book_id = ${bookId} and m.voucher_id = pair."voucherId" and m.line_id = pair."lineId")
      or exists(select from openerp.bank_active_allocation_legs l
        where l.book_id = ${bookId} and l.voucher_id = pair."voucherId" and l.line_id = pair."lineId")
      or exists(select from openerp.owner_effects e
        where e.book_id = ${bookId} and e.voucher_id = pair."voucherId" and e.line_id = pair."lineId")
      or exists(select from openerp.commerce_invoices i
        where i.book_id = ${bookId} and i.recognition_voucher_id = pair."voucherId"
          and i.recognition_line_id = pair."lineId")
      or exists(select from openerp.commerce_active_allocation_legs l
        where l.book_id = ${bookId} and l.payment_voucher_id = pair."voucherId"
          and l.payment_line_id = pair."lineId") as claimed
    from unnest(array[
      ${sql.join(
        pairs.map((pair) => sql`array[${pair.voucherId}, ${pair.lineId}]::text[]`),
        sql`, `,
      )}
    ]::text[][]) as pair("voucherId", "lineId")
  `;
}

export type ClaimedPairRow = {
  readonly voucherId: string;
  readonly lineId: string;
  readonly claimed: boolean;
};

export function readClaimedLineRows(
  transaction: Transaction,
  bookId: string,
  pairs: ReadonlyArray<{ readonly voucherId: string; readonly lineId: string }>,
) {
  return transaction.execute<ClaimedPairRow>(readClaimedLines(bookId, pairs), "objects");
}

export type RoleLedgerRow = { readonly item: JsonObject };

export function readRoleLedger(
  transaction: Transaction,
  bookId: string,
  accountIds: ReadonlyArray<string>,
  startsOn: string,
  endsOn: string,
  committedSequence: string,
) {
  return transaction.execute<RoleLedgerRow>(
    sql`
      select jsonb_build_object(
        'voucherId', v.id,
        'lineId', l.id,
        'ordinal', l.ordinal,
        'sequence', v.sequence::text,
        'postingDate', v.posting_date::text,
        'eventId', v.event_id,
        'postingPurpose', v.posting_purpose,
        'correctsVoucherId', v.corrects_voucher_id,
        'changeSetId', v.change_set_id,
        'accountId', l.account_id,
        'debitMinor', l.debit_minor::text,
        'creditMinor', l.credit_minor::text,
        'description', l.description
      ) as item
      from openerp.journal_lines l
      join openerp.vouchers v on v.book_id = l.book_id and v.id = l.voucher_id
      where l.book_id = ${bookId}
        and l.account_id = any(array[${sql.join(
          accountIds.map((id) => sql`${id}`),
          sql`, `,
        )}]::text[])
        and v.posting_purpose <> 'vat_control_reclassification_v1'
        and v.posting_date between ${startsOn} and ${endsOn}
        and v.sequence <= ${committedSequence}
      order by v.sequence, l.ordinal, l.id collate "C"
    `,
    "objects",
  );
}

export type EqualityRow = { readonly equal: boolean };

// jsonb equality is the exact comparison the retained basis was sealed with.
export function equalJson(transaction: Transaction, left: Json, right: Json) {
  return transaction.execute<EqualityRow>(
    sql`select (${JSON.stringify(left)}::jsonb is not distinct from ${JSON.stringify(right)}::jsonb) as equal`,
    "objects",
  );
}
