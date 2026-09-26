import * as Accounting from "@open-erp/contracts/accounting";
import { and, desc, eq, inArray, lt, or, sql } from "drizzle-orm";
import * as Recovery from "@open-erp/contracts/posting-recovery";
import * as Schema from "effect/Schema";
import {
  approvals,
  changeSets,
  commandReceipts,
  postingApprovalRevocations,
  postingRequestOutcomes,
  postingSavedRequests,
} from "./schema";
import type { Transaction } from "./transaction";

type JsonObject = Schema.JsonObject;
type SavedCommand = typeof Recovery.SavedPostingCommand.Type;

export type SavedRequestRow = {
  readonly bookId: string;
  readonly key: string;
  readonly actorId: string;
  readonly command: SavedCommand;
  readonly digest: string;
  readonly commandKey: string;
  readonly savedAt: string;
};

export type SavedOutcomeRow = {
  readonly bookId: string;
  readonly key: string;
  readonly state: "committed" | "refused";
  readonly result: JsonObject | null;
  readonly refusal: { readonly code: string; readonly message: string } | null;
  readonly recordedAt: string;
};

export function readSavedRequest(
  transaction: Transaction,
  scope: typeof Accounting.Scope.Type,
  key: string,
  _lock: "share" | "update" = "share",
) {
  return transaction
    .select({
      bookId: postingSavedRequests.bookId,
      key: postingSavedRequests.key,
      actorId: postingSavedRequests.actorId,
      command: postingSavedRequests.command,
      digest: postingSavedRequests.digest,
      commandKey: postingSavedRequests.commandKey,
      savedAt: postingSavedRequests.savedAt,
    })
    .from(postingSavedRequests)
    .where(and(eq(postingSavedRequests.bookId, scope.bookId), eq(postingSavedRequests.key, key)));
}

export function insertSavedRequest(transaction: Transaction, row: SavedRequestRow) {
  return transaction.insert(postingSavedRequests).values([row]);
}

export function readSavedOutcome(
  transaction: Transaction,
  scope: typeof Accounting.Scope.Type,
  key: string,
) {
  return transaction
    .select({
      bookId: postingRequestOutcomes.bookId,
      key: postingRequestOutcomes.key,
      state: postingRequestOutcomes.state,
      result: postingRequestOutcomes.result,
      refusal: postingRequestOutcomes.refusal,
      recordedAt: postingRequestOutcomes.recordedAt,
    })
    .from(postingRequestOutcomes)
    .where(
      and(eq(postingRequestOutcomes.bookId, scope.bookId), eq(postingRequestOutcomes.key, key)),
    );
}

export function insertSavedOutcome(
  transaction: Transaction,
  row: {
    bookId: string;
    key: string;
    state: "committed" | "refused";
    result: JsonObject | null;
    refusal: { readonly code: string; readonly message: string } | null;
    recordedAt: string;
  },
) {
  return transaction.insert(postingRequestOutcomes).values([row]);
}

export function listSavedRequests(
  transaction: Transaction,
  scope: typeof Accounting.Scope.Type,
  after: { readonly savedAt: string; readonly key: string } | undefined,
) {
  const cursor =
    after === undefined
      ? undefined
      : or(
          lt(postingSavedRequests.savedAt, after.savedAt),
          and(
            eq(postingSavedRequests.savedAt, after.savedAt),
            lt(postingSavedRequests.key, after.key),
          ),
        );
  const query = transaction
    .select({
      bookId: postingSavedRequests.bookId,
      key: postingSavedRequests.key,
      actorId: postingSavedRequests.actorId,
      command: postingSavedRequests.command,
      digest: postingSavedRequests.digest,
      commandKey: postingSavedRequests.commandKey,
      savedAt: postingSavedRequests.savedAt,
    })
    .from(postingSavedRequests)
    .where(
      and(eq(postingSavedRequests.bookId, scope.bookId), cursor === undefined ? undefined : cursor),
    )
    .orderBy(desc(postingSavedRequests.savedAt), desc(postingSavedRequests.key))
    .limit(21);
  return query;
}

export function insertApprovalRevocation(
  transaction: Transaction,
  row: { bookId: string; approvalId: string; actorId: string; reason: string; revokedAt: string },
) {
  return transaction.insert(postingApprovalRevocations).values([row]);
}

export function readRecoveryAnchor(
  transaction: Transaction,
  scope: typeof Accounting.Scope.Type,
  changeSetId: string,
) {
  return transaction
    .select({ id: changeSets.id, createdAt: changeSets.createdAt })
    .from(changeSets)
    .where(and(eq(changeSets.bookId, scope.bookId), eq(changeSets.id, changeSetId)));
}

export function listRecoveryPlans(
  transaction: Transaction,
  scope: typeof Accounting.Scope.Type,
  after: { readonly createdAt: string; readonly id: string } | undefined,
) {
  const cursor =
    after === undefined
      ? undefined
      : or(
          lt(changeSets.createdAt, after.createdAt),
          and(eq(changeSets.createdAt, after.createdAt), lt(changeSets.id, after.id)),
        );
  const query = transaction
    .select({
      bookId: changeSets.bookId,
      id: changeSets.id,
      plan: changeSets.plan,
      digest: changeSets.digest,
      createdBy: changeSets.createdBy,
      createdAt: changeSets.createdAt,
    })
    .from(changeSets)
    .where(
      and(
        eq(changeSets.bookId, scope.bookId),
        cursor === undefined ? undefined : cursor,
        sql`not exists (
          select 1 from openerp.correction_bundles bundle
          where bundle.book_id = ${changeSets.bookId}
            and ${changeSets.id} in (bundle.reversal_change_set_id, bundle.replacement_change_set_id)
        )`,
      ),
    )
    .orderBy(desc(changeSets.createdAt), desc(changeSets.id))
    .limit(21);
  return query;
}

export function listRecoveryRequests(
  transaction: Transaction,
  scope: typeof Accounting.Scope.Type,
  changeSetId: string,
  after: { readonly recordedAt: string; readonly key: string } | undefined,
) {
  const operations = [
    "prepare_journal",
    "prepare_correction",
    "validate_change",
    "approve_change",
    "execute_change",
  ];
  const cursor =
    after === undefined
      ? undefined
      : or(
          lt(commandReceipts.recordedAt, after.recordedAt),
          and(eq(commandReceipts.recordedAt, after.recordedAt), lt(commandReceipts.key, after.key)),
        );
  const query = transaction
    .select({
      key: commandReceipts.key,
      operation: commandReceipts.operation,
      actorId: commandReceipts.actorId,
      requestDigest: commandReceipts.requestDigest,
      recordedAt: commandReceipts.recordedAt,
      result: commandReceipts.result,
      approvalConsumedAt: approvals.consumedAt,
      approvalExpiresAt: approvals.expiresAt,
      approvalActorId: approvals.actorId,
      approvalRevoked: sql<boolean>`exists (
        select 1 from openerp.posting_approval_revocations revocation
        where revocation.book_id = ${commandReceipts.bookId}
          and revocation.approval_id = ${approvals.id}
      )`,
    })
    .from(commandReceipts)
    .leftJoin(
      approvals,
      and(
        eq(approvals.bookId, commandReceipts.bookId),
        eq(commandReceipts.operation, "approve_change"),
        eq(approvals.id, sql`${commandReceipts.result}->>'id'`),
      ),
    )
    .where(
      and(
        eq(commandReceipts.bookId, scope.bookId),
        inArray(commandReceipts.operation, operations),
        sql`coalesce(${commandReceipts.result}->>'changeSetId', ${commandReceipts.result}->>'id') = ${changeSetId}`,
        cursor === undefined ? undefined : cursor,
      ),
    )
    .orderBy(desc(commandReceipts.recordedAt), desc(commandReceipts.key))
    .limit(21);
  return query;
}

export function readRecoveryRequestAnchor(
  transaction: Transaction,
  scope: typeof Accounting.Scope.Type,
  changeSetId: string,
  key: string,
) {
  const operations = [
    "prepare_journal",
    "prepare_correction",
    "validate_change",
    "approve_change",
    "execute_change",
  ];
  return transaction
    .select({ key: commandReceipts.key, recordedAt: commandReceipts.recordedAt })
    .from(commandReceipts)
    .where(
      and(
        eq(commandReceipts.bookId, scope.bookId),
        eq(commandReceipts.key, key),
        inArray(commandReceipts.operation, operations),
        sql`coalesce(${commandReceipts.result}->>'changeSetId', ${commandReceipts.result}->>'id') = ${changeSetId}`,
      ),
    );
}
