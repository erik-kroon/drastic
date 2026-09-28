import { sql } from "drizzle-orm";
import type * as Schema from "effect/Schema";
import { textArray } from "../sql-values";
import type { Transaction } from "../transaction";

type JsonObject = Schema.JsonObject;

// The VAT assessment owner's own tables plus every retained record it reads:
// the sealed NEXT-04 actual return, the tax-account events and matches, and
// the posting kernel's vouchers and journal lines for adoption verification.
// This module selects and persists; it never chooses a treatment, derives a
// fact or calls a match operation.
export const assessmentTables = [
  "books",
  "accounts",
  "periods",
  "fiscal_years",
  "evidence",
  "events",
  "change_sets",
  "execution_receipts",
  "command_receipts",
  "vouchers",
  "journal_lines",
  "vat_actual_returns",
  "vat_actual_return_boxes",
  "tax_account_events",
  "tax_account_matches",
  "bank_sources",
  "vat_rounding_bridges",
  "vat_bridge_approvals",
  "vat_bridge_receipts",
  "vat_assessments",
  "vat_assessment_approvals",
  "vat_assessment_receipts",
] as const;

export const assessmentInserts = [
  "vat_rounding_bridges",
  "vat_bridge_approvals",
  "vat_bridge_receipts",
  "vat_assessments",
  "vat_assessment_approvals",
  "vat_assessment_receipts",
  "change_sets",
  "events",
  "command_receipts",
] as const;

export type BodyRow = {
  readonly id: string;
  readonly body: JsonObject;
};

export type ReturnBasisRow = {
  readonly id: string;
  readonly startsOn: string;
  readonly endsOn: string;
  readonly ruleReleaseId: string;
  readonly exactNetMinor: string;
  readonly reportedNetMinor: string;
  readonly residualNetMinor: string;
  readonly digest: string;
  readonly body: JsonObject;
};

export type BridgeRow = BodyRow & {
  readonly returnId: string;
  readonly deltaMinor: string;
};

export type ApprovalRow = {
  readonly id: string;
  readonly targetId: string;
  readonly actorId: string;
  readonly digest: string;
  readonly expiresAt: string;
  readonly ordinal: number;
  readonly body: JsonObject;
};

export type AssessmentRow = BodyRow & {
  readonly assessmentIdentity: string;
  readonly returnId: string;
  readonly eventId: string;
};

export type CountRow = { readonly total: number };

export type VoucherLineRow = {
  readonly lineId: string;
  readonly accountId: string;
  readonly debitMinor: string;
  readonly creditMinor: string;
};

export function readReturnBasis(transaction: Transaction, bookId: string, returnId: string) {
  return transaction.execute<ReturnBasisRow>(
    sql`
      select id, starts_on::text as "startsOn", ends_on::text as "endsOn",
        rule_release_id as "ruleReleaseId",
        exact_net_minor::text as "exactNetMinor",
        reported_net_minor::text as "reportedNetMinor",
        residual_net_minor::text as "residualNetMinor",
        digest, body
      from openerp.vat_actual_returns
      where book_id = ${bookId} and id = ${returnId}
    `,
    "objects",
  );
}

export function readBridgesForReturn(transaction: Transaction, bookId: string, returnId: string) {
  return transaction.execute<BridgeRow>(
    sql`
      select id, return_id as "returnId", delta_minor::text as "deltaMinor", body
      from openerp.vat_rounding_bridges
      where book_id = ${bookId} and return_id = ${returnId}
      order by recorded_at, id collate "C"
    `,
    "objects",
  );
}

export function readBridge(transaction: Transaction, bookId: string, bridgeId: string) {
  return transaction.execute<BridgeRow>(
    sql`
      select id, return_id as "returnId", delta_minor::text as "deltaMinor", body
      from openerp.vat_rounding_bridges
      where book_id = ${bookId} and id = ${bridgeId}
    `,
    "objects",
  );
}

export function insertBridge(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly returnId: string;
    readonly deltaMinor: string;
    readonly body: JsonObject;
    readonly digest: string;
    readonly recordedAt: string;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.vat_rounding_bridges
        (book_id, id, return_id, delta_minor, body, digest, recorded_at)
      values (${row.bookId}, ${row.id}, ${row.returnId}, ${row.deltaMinor}::numeric,
        ${JSON.stringify(row.body)}::jsonb, ${row.digest},
        ${row.recordedAt}::timestamptz)
    `,
    "objects",
  );
}

export function readBridgeReceiptByBridge(
  transaction: Transaction,
  bookId: string,
  bridgeId: string,
) {
  return transaction.execute<BodyRow>(
    sql`
      select id, body
      from openerp.vat_bridge_receipts
      where book_id = ${bookId} and bridge_id = ${bridgeId}
    `,
    "objects",
  );
}

export function insertBridgeReceipt(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly bridgeId: string;
    readonly approvalId: string;
    readonly voucherId: string | null;
    readonly changeSetId: string | null;
    readonly body: JsonObject;
    readonly digest: string;
    readonly recordedAt: string;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.vat_bridge_receipts
        (book_id, id, bridge_id, approval_id, voucher_id, change_set_id, body, digest, recorded_at)
      values (${row.bookId}, ${row.id}, ${row.bridgeId}, ${row.approvalId}, ${row.voucherId},
        ${row.changeSetId}, ${JSON.stringify(row.body)}::jsonb, ${row.digest},
        ${row.recordedAt}::timestamptz)
    `,
    "objects",
  );
}

export function readBridgeApprovalCount(
  transaction: Transaction,
  bookId: string,
  bridgeId: string,
) {
  return transaction.execute<CountRow>(
    sql`
      select count(*)::integer as total
      from openerp.vat_bridge_approvals
      where book_id = ${bookId} and bridge_id = ${bridgeId}
    `,
    "objects",
  );
}

export function readBridgeApproval(transaction: Transaction, bookId: string, bridgeId: string) {
  return transaction.execute<ApprovalRow>(
    sql`
      select id, bridge_id as "targetId", actor_id as "actorId", digest,
        expires_at::text as "expiresAt", ordinal, body
      from openerp.vat_bridge_approvals
      where book_id = ${bookId} and bridge_id = ${bridgeId}
      order by ordinal desc
      limit 1
    `,
    "objects",
  );
}

export function readBridgeApprovalById(
  transaction: Transaction,
  bookId: string,
  approvalId: string,
  bridgeId: string,
) {
  return transaction.execute<ApprovalRow>(
    sql`
      select id, bridge_id as "targetId", actor_id as "actorId", digest,
        expires_at::text as "expiresAt", ordinal, body
      from openerp.vat_bridge_approvals
      where book_id = ${bookId} and id = ${approvalId} and bridge_id = ${bridgeId}
    `,
    "objects",
  );
}

export function insertBridgeApproval(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly bridgeId: string;
    readonly ordinal: number;
    readonly actorId: string;
    readonly digest: string;
    readonly expiresAt: string;
    readonly body: JsonObject;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.vat_bridge_approvals
        (book_id, id, bridge_id, ordinal, actor_id, digest, expires_at, body)
      values (${row.bookId}, ${row.id}, ${row.bridgeId}, ${row.ordinal}, ${row.actorId},
        ${row.digest}, ${row.expiresAt}::timestamptz, ${JSON.stringify(row.body)}::jsonb)
    `,
    "objects",
  );
}

export function readAssessmentsForReturn(
  transaction: Transaction,
  bookId: string,
  returnId: string,
) {
  return transaction.execute<AssessmentRow>(
    sql`
      select id, assessment_identity as "assessmentIdentity", return_id as "returnId",
        event_id as "eventId", body
      from openerp.vat_assessments
      where book_id = ${bookId} and return_id = ${returnId}
      order by recorded_at, id collate "C"
    `,
    "objects",
  );
}

export function readAssessmentByIdentity(
  transaction: Transaction,
  bookId: string,
  assessmentIdentity: string,
) {
  return transaction.execute<AssessmentRow>(
    sql`
      select id, assessment_identity as "assessmentIdentity", return_id as "returnId",
        event_id as "eventId", body
      from openerp.vat_assessments
      where book_id = ${bookId} and assessment_identity = ${assessmentIdentity}
    `,
    "objects",
  );
}

export function readAssessment(transaction: Transaction, bookId: string, assessmentId: string) {
  return transaction.execute<AssessmentRow>(
    sql`
      select id, assessment_identity as "assessmentIdentity", return_id as "returnId",
        event_id as "eventId", body
      from openerp.vat_assessments
      where book_id = ${bookId} and id = ${assessmentId}
    `,
    "objects",
  );
}

export function readAssessmentByMatch(
  transaction: Transaction,
  bookId: string,
  matchRef: string,
  excludingAssessmentId?: string,
) {
  return transaction.execute<{ readonly present: boolean }>(
    sql`
      select exists (
        select 1 from openerp.vat_assessments
        where book_id = ${bookId} and match_ref = ${matchRef}
          and (id is distinct from ${excludingAssessmentId ?? null}::text)
      ) as present
    `,
    "objects",
  );
}

export function insertAssessment(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly assessmentIdentity: string;
    readonly returnId: string;
    readonly eventId: string;
    readonly matchRef: string | null;
    readonly body: JsonObject;
    readonly digest: string;
    readonly recordedAt: string;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.vat_assessments
        (book_id, id, assessment_identity, return_id, event_id, match_ref, body, digest, recorded_at)
      values (${row.bookId}, ${row.id}, ${row.assessmentIdentity}, ${row.returnId}, ${row.eventId},
        ${row.matchRef}, ${JSON.stringify(row.body)}::jsonb,
        ${row.digest}, ${row.recordedAt}::timestamptz)
    `,
    "objects",
  );
}

export function readAssessmentReceiptByAssessment(
  transaction: Transaction,
  bookId: string,
  assessmentId: string,
) {
  return transaction.execute<BodyRow>(
    sql`
      select id, body
      from openerp.vat_assessment_receipts
      where book_id = ${bookId} and assessment_id = ${assessmentId}
    `,
    "objects",
  );
}

export function insertAssessmentReceipt(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly assessmentId: string;
    readonly approvalId: string;
    readonly voucherId: string | null;
    readonly matchRef: string | null;
    readonly body: JsonObject;
    readonly digest: string;
    readonly recordedAt: string;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.vat_assessment_receipts
        (book_id, id, assessment_id, approval_id, voucher_id, match_ref, body, digest, recorded_at)
      values (${row.bookId}, ${row.id}, ${row.assessmentId}, ${row.approvalId}, ${row.voucherId},
        ${row.matchRef}, ${JSON.stringify(row.body)}::jsonb, ${row.digest},
        ${row.recordedAt}::timestamptz)
    `,
    "objects",
  );
}

export function readAssessmentApprovalCount(
  transaction: Transaction,
  bookId: string,
  assessmentId: string,
) {
  return transaction.execute<CountRow>(
    sql`
      select count(*)::integer as total
      from openerp.vat_assessment_approvals
      where book_id = ${bookId} and assessment_id = ${assessmentId}
    `,
    "objects",
  );
}

export function readAssessmentApproval(
  transaction: Transaction,
  bookId: string,
  assessmentId: string,
) {
  return transaction.execute<ApprovalRow>(
    sql`
      select id, assessment_id as "targetId", actor_id as "actorId", digest,
        expires_at::text as "expiresAt", ordinal, body
      from openerp.vat_assessment_approvals
      where book_id = ${bookId} and assessment_id = ${assessmentId}
      order by ordinal desc
      limit 1
    `,
    "objects",
  );
}

export function readAssessmentApprovalById(
  transaction: Transaction,
  bookId: string,
  approvalId: string,
  assessmentId: string,
) {
  return transaction.execute<ApprovalRow>(
    sql`
      select id, assessment_id as "targetId", actor_id as "actorId", digest,
        expires_at::text as "expiresAt", ordinal, body
      from openerp.vat_assessment_approvals
      where book_id = ${bookId} and id = ${approvalId} and assessment_id = ${assessmentId}
    `,
    "objects",
  );
}

export function insertAssessmentApproval(
  transaction: Transaction,
  row: {
    readonly bookId: string;
    readonly id: string;
    readonly assessmentId: string;
    readonly ordinal: number;
    readonly actorId: string;
    readonly digest: string;
    readonly expiresAt: string;
    readonly body: JsonObject;
  },
) {
  return transaction.execute(
    sql`
      insert into openerp.vat_assessment_approvals
        (book_id, id, assessment_id, ordinal, actor_id, digest, expires_at, body)
      values (${row.bookId}, ${row.id}, ${row.assessmentId}, ${row.ordinal}, ${row.actorId},
        ${row.digest}, ${row.expiresAt}::timestamptz, ${JSON.stringify(row.body)}::jsonb)
    `,
    "objects",
  );
}

export function readVoucherLines(transaction: Transaction, bookId: string, voucherId: string) {
  return transaction.execute<VoucherLineRow>(
    sql`
      select id as "lineId", account_id as "accountId",
        debit_minor::text as "debitMinor", credit_minor::text as "creditMinor"
      from openerp.journal_lines
      where book_id = ${bookId} and voucher_id = ${voucherId}
      order by ordinal
    `,
    "objects",
  );
}

export function readActiveAccount(transaction: Transaction, bookId: string, accountId: string) {
  return transaction.execute<{ readonly id: string }>(
    sql`
      select id
      from openerp.accounts
      where book_id = ${bookId} and id = ${accountId} and active
      for share
    `,
    "objects",
  );
}

export function readBankSourceConflict(
  transaction: Transaction,
  bookId: string,
  accountIds: ReadonlyArray<string>,
) {
  return transaction.execute<{ readonly present: boolean }>(
    sql`
      select exists (
        select 1 from openerp.bank_sources
        where book_id = ${bookId} and account_id = any(${textArray(accountIds)})
      ) as present
    `,
    "objects",
  );
}
