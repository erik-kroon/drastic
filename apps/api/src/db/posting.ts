import * as Accounting from "@open-erp/contracts/accounting";
import { and, asc, eq, gt, inArray, lte, sql } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import {
  accounts,
  approvalConsumptions,
  approvals,
  books,
  changeSets,
  commandReceipts,
  evidence,
  events,
  executionReceipts,
  fiscalYears,
  identityAdmissions,
  journalLines,
  memberships,
  outbox,
  periods,
  postingApprovalRevocations,
  postingGroupReceipts,
  seriesCounters,
  vouchers,
} from "./schema";
import { failure } from "../application/failures";
import type { Transaction } from "./transaction";

const DatabaseTime = Schema.Struct({ now: Schema.String });
type JsonObject = Schema.JsonObject;

export type PlanRow = {
  readonly bookId: string;
  readonly id: string;
  readonly plan: JsonObject;
  readonly digest: string;
  readonly createdBy: string;
  readonly createdAt: string;
};

export type VoucherRow = {
  readonly bookId: string;
  readonly id: string;
  readonly number: bigint;
  readonly sequence: bigint;
  readonly postingDate: string;
  readonly eventId: string;
  readonly postingPurpose: string;
  readonly occurrenceKey: string;
  readonly correctsVoucherId: string | null;
  readonly changeSetId: string;
  readonly action: JsonObject;
  readonly expectedLineCount: number;
  readonly recordedAt: string;
};

export type ApprovalRow = {
  readonly bookId: string;
  readonly id: string;
  readonly changeSetId: string;
  readonly digest: string;
  readonly actorId: string;
  readonly expiresAt: string;
  readonly consumedAt: string | null;
};

export type CommandReceiptRow = {
  readonly bookId: string;
  readonly key: string;
  readonly requestDigest: string;
  readonly operation: string;
  readonly actorId: string;
  readonly result: JsonObject;
  readonly recordedAt: string;
};

export function readBook(transaction: Transaction, scope: typeof Accounting.Scope.Type) {
  return transaction
    .select({
      id: books.id,
      entityId: books.entityId,
      name: books.name,
      currency: books.currency,
      currencyScale: books.currencyScale,
      profile: books.profile,
      profileVersion: books.profileVersion,
      writerEpoch: books.writerEpoch,
      authority: books.authority,
      committedSequence: books.committedSequence,
    })
    .from(books)
    .where(and(eq(books.id, scope.bookId), eq(books.entityId, scope.entityId)))
    .for("share");
}

export function readBooksForActor(transaction: Transaction, actorId: string) {
  return transaction
    .select({
      entityId: books.entityId,
      id: books.id,
      name: books.name,
      currency: books.currency,
      profile: books.profile,
      role: memberships.role,
      sequence: books.committedSequence,
    })
    .from(books)
    .innerJoin(memberships, and(eq(memberships.bookId, books.id), eq(memberships.actorId, actorId)))
    .orderBy(asc(books.id));
}

export function lockBookForShare(transaction: Transaction, scope: typeof Accounting.Scope.Type) {
  return transaction
    .select({ id: books.id, entityId: books.entityId })
    .from(books)
    .where(and(eq(books.id, scope.bookId), eq(books.entityId, scope.entityId)))
    .for("share");
}

export function lockBookForUpdate(transaction: Transaction, scope: typeof Accounting.Scope.Type) {
  return transaction
    .select({ id: books.id, entityId: books.entityId })
    .from(books)
    .where(and(eq(books.id, scope.bookId), eq(books.entityId, scope.entityId)))
    .for("update");
}

export function readDatabaseTime(transaction: Transaction) {
  return transaction
    .execute(sql`select clock_timestamp() as now`, "objects")
    .pipe(
      Effect.flatMap((rows) =>
        Schema.decodeUnknownEffect(DatabaseTime)(rows[0]).pipe(
          Effect.mapError(() => failure("InternalError")),
        ),
      ),
    );
}

export function readEvidence(transaction: Transaction, bookId: string, evidenceId: string) {
  return transaction
    .select({
      id: evidence.id,
      title: evidence.title,
      content: evidence.content,
      mediaType: evidence.mediaType,
      origin: evidence.origin,
      sha256: evidence.sha256,
      createdAt: evidence.createdAt,
    })
    .from(evidence)
    .where(and(eq(evidence.bookId, bookId), eq(evidence.id, evidenceId)));
}

export function readEvidenceBySha(transaction: Transaction, bookId: string, sha256: string) {
  return transaction
    .select({
      id: evidence.id,
      title: evidence.title,
      content: evidence.content,
      mediaType: evidence.mediaType,
      origin: evidence.origin,
      sha256: evidence.sha256,
      createdAt: evidence.createdAt,
    })
    .from(evidence)
    .where(and(eq(evidence.bookId, bookId), eq(evidence.sha256, sha256)));
}

export function insertEvidence(
  transaction: Transaction,
  row: {
    bookId: string;
    id: string;
    title: string;
    content: string;
    mediaType: string;
    origin: string;
    sha256: string;
    createdBy: string;
    createdAt: string;
  },
) {
  return transaction.insert(evidence).values([row]).returning({
    id: evidence.id,
    title: evidence.title,
    content: evidence.content,
    mediaType: evidence.mediaType,
    origin: evidence.origin,
    sha256: evidence.sha256,
    createdAt: evidence.createdAt,
  });
}

export function readEvent(
  transaction: Transaction,
  bookId: string,
  evidenceId: string,
  eventKey: string,
) {
  return transaction
    .select({ id: events.id })
    .from(events)
    .where(
      and(
        eq(events.bookId, bookId),
        eq(events.evidenceId, evidenceId),
        eq(events.eventKey, eventKey),
      ),
    );
}

export function readEventById(transaction: Transaction, bookId: string, eventId: string) {
  return transaction
    .select({ id: events.id, evidenceId: events.evidenceId })
    .from(events)
    .where(and(eq(events.bookId, bookId), eq(events.id, eventId)));
}

export function insertEvent(
  transaction: Transaction,
  bookId: string,
  id: string,
  evidenceId: string,
  eventKey: string,
) {
  return transaction
    .insert(events)
    .values({ bookId, id, evidenceId, eventKey })
    .returning({ id: events.id });
}

export function readPeriod(transaction: Transaction, bookId: string, periodId: string) {
  return transaction
    .select({
      bookId: periods.bookId,
      id: periods.id,
      fiscalYearId: periods.fiscalYearId,
      startsOn: periods.startsOn,
      endsOn: periods.endsOn,
      locked: periods.locked,
      version: periods.version,
    })
    .from(periods)
    .where(and(eq(periods.bookId, bookId), eq(periods.id, periodId)))
    .for("share");
}

export function readFiscalYear(transaction: Transaction, bookId: string, fiscalYearId: string) {
  return transaction
    .select({
      bookId: fiscalYears.bookId,
      id: fiscalYears.id,
      startsOn: fiscalYears.startsOn,
      endsOn: fiscalYears.endsOn,
    })
    .from(fiscalYears)
    .where(and(eq(fiscalYears.bookId, bookId), eq(fiscalYears.id, fiscalYearId)));
}

export function readAccounts(transaction: Transaction, bookId: string, accountIds: string[]) {
  if (accountIds.length === 0) return Effect.succeed([]);
  return transaction
    .select({
      bookId: accounts.bookId,
      id: accounts.id,
      code: accounts.code,
      name: accounts.name,
      active: accounts.active,
      version: accounts.version,
    })
    .from(accounts)
    .where(and(eq(accounts.bookId, bookId), inArray(accounts.id, accountIds)))
    .orderBy(asc(accounts.id))
    .for("share");
}

export function readAllAccounts(transaction: Transaction, bookId: string) {
  return transaction
    .select({
      id: accounts.id,
      code: accounts.code,
      name: accounts.name,
      active: accounts.active,
      version: accounts.version,
    })
    .from(accounts)
    .where(eq(accounts.bookId, bookId))
    .orderBy(asc(accounts.id))
    .for("share");
}

export function readAllPeriods(transaction: Transaction, bookId: string) {
  return transaction
    .select({
      id: periods.id,
      fiscalYearId: periods.fiscalYearId,
      startsOn: periods.startsOn,
      endsOn: periods.endsOn,
      locked: periods.locked,
      version: periods.version,
    })
    .from(periods)
    .where(eq(periods.bookId, bookId))
    .orderBy(asc(periods.id))
    .for("share");
}

export function readAllFiscalYears(transaction: Transaction, bookId: string) {
  return transaction
    .select({ id: fiscalYears.id, startsOn: fiscalYears.startsOn, endsOn: fiscalYears.endsOn })
    .from(fiscalYears)
    .where(eq(fiscalYears.bookId, bookId))
    .orderBy(asc(fiscalYears.id));
}

export function readPlan(transaction: Transaction, bookId: string, changeSetId: string) {
  return transaction
    .select({
      bookId: changeSets.bookId,
      id: changeSets.id,
      plan: changeSets.plan,
      digest: changeSets.digest,
      createdBy: changeSets.createdBy,
      createdAt: changeSets.createdAt,
    })
    .from(changeSets)
    .where(and(eq(changeSets.bookId, bookId), eq(changeSets.id, changeSetId)));
}

export function lockPlan(transaction: Transaction, bookId: string, changeSetId: string) {
  return readPlan(transaction, bookId, changeSetId);
}

export function insertPlan(
  transaction: Transaction,
  row: { bookId: string; id: string; plan: JsonObject; digest: string; createdBy: string },
) {
  return transaction
    .insert(changeSets)
    .values([row])
    .returning({ id: changeSets.id, createdAt: changeSets.createdAt });
}

export function readVoucher(transaction: Transaction, bookId: string, voucherId: string) {
  return transaction
    .select({
      bookId: vouchers.bookId,
      id: vouchers.id,
      number: vouchers.number,
      sequence: vouchers.sequence,
      postingDate: vouchers.postingDate,
      eventId: vouchers.eventId,
      postingPurpose: vouchers.postingPurpose,
      occurrenceKey: vouchers.occurrenceKey,
      correctsVoucherId: vouchers.correctsVoucherId,
      changeSetId: vouchers.changeSetId,
      action: vouchers.action,
      expectedLineCount: vouchers.expectedLineCount,
      recordedAt: vouchers.recordedAt,
    })
    .from(vouchers)
    .where(and(eq(vouchers.bookId, bookId), eq(vouchers.id, voucherId)));
}

export function readVoucherByEconomicIdentity(
  transaction: Transaction,
  bookId: string,
  action: {
    eventId: string;
    postingPurpose: string;
    occurrenceKey: string;
  },
) {
  return transaction
    .select({ id: vouchers.id })
    .from(vouchers)
    .where(
      and(
        eq(vouchers.bookId, bookId),
        eq(vouchers.eventId, action.eventId),
        eq(vouchers.postingPurpose, action.postingPurpose),
        eq(vouchers.occurrenceKey, action.occurrenceKey),
      ),
    );
}

export function readVoucherByChangeSet(
  transaction: Transaction,
  bookId: string,
  changeSetId: string,
) {
  return transaction
    .select({ id: vouchers.id })
    .from(vouchers)
    .where(and(eq(vouchers.bookId, bookId), eq(vouchers.changeSetId, changeSetId)));
}

export function readVoucherByReversal(
  transaction: Transaction,
  bookId: string,
  correctsVoucherId: string,
) {
  return transaction
    .select({ id: vouchers.id })
    .from(vouchers)
    .where(
      and(
        eq(vouchers.bookId, bookId),
        eq(vouchers.correctsVoucherId, correctsVoucherId),
        eq(vouchers.postingPurpose, "reversal"),
      ),
    );
}

export function readVoucherPage(
  transaction: Transaction,
  bookId: string,
  after: bigint,
  limit: number,
) {
  return transaction
    .select({
      bookId: vouchers.bookId,
      id: vouchers.id,
      number: vouchers.number,
      sequence: vouchers.sequence,
      postingDate: vouchers.postingDate,
      eventId: vouchers.eventId,
      postingPurpose: vouchers.postingPurpose,
      occurrenceKey: vouchers.occurrenceKey,
      correctsVoucherId: vouchers.correctsVoucherId,
      changeSetId: vouchers.changeSetId,
      action: vouchers.action,
      expectedLineCount: vouchers.expectedLineCount,
      recordedAt: vouchers.recordedAt,
    })
    .from(vouchers)
    .where(and(eq(vouchers.bookId, bookId), gt(vouchers.sequence, after)))
    .orderBy(asc(vouchers.sequence))
    .limit(limit);
}

export function readApproval(
  transaction: Transaction,
  bookId: string,
  approvalId: string,
  lock: "share" | "update" = "share",
) {
  const query = transaction
    .select({
      bookId: approvals.bookId,
      id: approvals.id,
      changeSetId: approvals.changeSetId,
      digest: approvals.digest,
      actorId: approvals.actorId,
      expiresAt: approvals.expiresAt,
      consumedAt: approvals.consumedAt,
    })
    .from(approvals)
    .where(and(eq(approvals.bookId, bookId), eq(approvals.id, approvalId)));
  return lock === "update" ? query.for("update") : query.for("share");
}

export function readApprovals(transaction: Transaction, bookId: string, changeSetId: string) {
  return transaction
    .select({
      id: approvals.id,
      changeSetId: approvals.changeSetId,
      digest: approvals.digest,
      actorId: approvals.actorId,
      expiresAt: approvals.expiresAt,
      consumedAt: approvals.consumedAt,
    })
    .from(approvals)
    .where(and(eq(approvals.bookId, bookId), eq(approvals.changeSetId, changeSetId)))
    .orderBy(sql`${approvals.expiresAt} desc, ${approvals.id} desc`)
    .for("share");
}

export function insertApproval(
  transaction: Transaction,
  row: {
    bookId: string;
    id: string;
    changeSetId: string;
    digest: string;
    actorId: string;
    expiresAt: string;
  },
) {
  return transaction.insert(approvals).values([row]).returning({
    id: approvals.id,
    changeSetId: approvals.changeSetId,
    digest: approvals.digest,
    actorId: approvals.actorId,
    expiresAt: approvals.expiresAt,
  });
}

export function readOperatorMembership(transaction: Transaction, bookId: string, actorId: string) {
  return transaction
    .select({ role: memberships.role })
    .from(memberships)
    .where(
      and(
        eq(memberships.bookId, bookId),
        eq(memberships.actorId, actorId),
        eq(memberships.role, "operator"),
      ),
    )
    .for("share");
}

export function readActorAdmission(transaction: Transaction, actorId: string) {
  return transaction
    .select({ enabled: identityAdmissions.enabled })
    .from(identityAdmissions)
    .where(eq(identityAdmissions.actorId, actorId))
    .for("share");
}

export function readApprovalRevocation(
  transaction: Transaction,
  bookId: string,
  approvalId: string,
) {
  return transaction
    .select({ approvalId: postingApprovalRevocations.approvalId })
    .from(postingApprovalRevocations)
    .where(
      and(
        eq(postingApprovalRevocations.bookId, bookId),
        eq(postingApprovalRevocations.approvalId, approvalId),
      ),
    );
}

export function readCommandReceipt(
  transaction: Transaction,
  bookId: string,
  key: string,
  _lock: "share" | "update" = "share",
) {
  return transaction
    .select({
      bookId: commandReceipts.bookId,
      key: commandReceipts.key,
      requestDigest: commandReceipts.requestDigest,
      operation: commandReceipts.operation,
      actorId: commandReceipts.actorId,
      result: commandReceipts.result,
      recordedAt: commandReceipts.recordedAt,
    })
    .from(commandReceipts)
    .where(and(eq(commandReceipts.bookId, bookId), eq(commandReceipts.key, key)));
}

export function insertCommandReceipt(
  transaction: Transaction,
  row: {
    bookId: string;
    key: string;
    requestDigest: string;
    operation: string;
    actorId: string;
    result: JsonObject;
  },
) {
  return transaction.insert(commandReceipts).values([row]);
}

export function allocateSeriesCounter(
  transaction: Transaction,
  bookId: string,
  fiscalYearId: string,
  series: string,
) {
  return transaction
    .insert(seriesCounters)
    .values({ bookId, fiscalYearId, series, lastNumber: 1n })
    .onConflictDoUpdate({
      target: [seriesCounters.bookId, seriesCounters.fiscalYearId, seriesCounters.series],
      set: { lastNumber: sql`${seriesCounters.lastNumber} + 1` },
    })
    .returning({ lastNumber: seriesCounters.lastNumber });
}

export function allocateSequence(transaction: Transaction, bookId: string) {
  return transaction
    .update(books)
    .set({ committedSequence: sql`${books.committedSequence} + 1` })
    .where(eq(books.id, bookId))
    .returning({ sequence: books.committedSequence });
}

export function insertVoucher(
  transaction: Transaction,
  row: {
    bookId: string;
    id: string;
    fiscalYearId: string;
    periodId: string;
    series: string;
    number: bigint;
    sequence: bigint;
    postingDate: string;
    eventId: string;
    postingPurpose: string;
    occurrenceKey: string;
    correctsVoucherId: string | null;
    changeSetId: string;
    action: JsonObject;
    expectedLineCount: number;
  },
) {
  return transaction
    .insert(vouchers)
    .values([row])
    .returning({ id: vouchers.id, recordedAt: vouchers.recordedAt });
}

export function insertJournalLines(
  transaction: Transaction,
  rows: Array<{
    bookId: string;
    voucherId: string;
    id: string;
    ordinal: number;
    accountId: string;
    debitMinor: string;
    creditMinor: string;
    description: string;
  }>,
) {
  return transaction.insert(journalLines).values(rows);
}

export function insertExecutionReceipt(
  transaction: Transaction,
  row: {
    bookId: string;
    id: string;
    changeSetId: string;
    voucherId: string;
    approvalId: string;
    body: JsonObject;
  },
) {
  return transaction.insert(executionReceipts).values([row]);
}

export function readExecutionReceiptById(transaction: Transaction, bookId: string, id: string) {
  return transaction
    .select({ id: executionReceipts.id, body: executionReceipts.body })
    .from(executionReceipts)
    .where(and(eq(executionReceipts.bookId, bookId), eq(executionReceipts.id, id)));
}

export function readExecutionReceiptByVoucher(
  transaction: Transaction,
  bookId: string,
  voucherId: string,
) {
  return transaction
    .select({
      id: executionReceipts.id,
      changeSetId: executionReceipts.changeSetId,
      body: executionReceipts.body,
    })
    .from(executionReceipts)
    .where(and(eq(executionReceipts.bookId, bookId), eq(executionReceipts.voucherId, voucherId)));
}

export function insertGroupReceipt(
  transaction: Transaction,
  row: {
    bookId: string;
    id: string;
    changeSetId: string;
    groupId: string;
    planDigest: string;
    body: JsonObject;
    committedAt: string;
  },
) {
  return transaction.insert(postingGroupReceipts).values([row]);
}

export function insertApprovalConsumption(
  transaction: Transaction,
  row: {
    bookId: string;
    approvalId: string;
    changeSetId: string;
    groupId: string;
    planDigest: string;
    receiptId: string;
    approverId: string;
    consumedById: string;
    consumedAt: string;
  },
) {
  return transaction.insert(approvalConsumptions).values([row]);
}

export function consumeApproval(
  transaction: Transaction,
  bookId: string,
  approvalId: string,
  consumedAt: string,
) {
  return transaction
    .update(approvals)
    .set({ consumedAt })
    .where(and(eq(approvals.bookId, bookId), eq(approvals.id, approvalId)))
    .returning({ id: approvals.id });
}

export function insertOutbox(
  transaction: Transaction,
  row: { bookId: string; id: string; receiptId: string; kind: string; payload: JsonObject },
) {
  return transaction.insert(outbox).values([row]);
}

export function readLedgerAccounts(transaction: Transaction, bookId: string) {
  return transaction
    .select({ id: accounts.id, code: accounts.code, name: accounts.name })
    .from(accounts)
    .where(eq(accounts.bookId, bookId))
    .orderBy(asc(accounts.code));
}

export function readLedgerLines(transaction: Transaction, bookId: string, sequence: bigint) {
  return transaction
    .select({
      accountId: journalLines.accountId,
      debitMinor: journalLines.debitMinor,
      creditMinor: journalLines.creditMinor,
    })
    .from(journalLines)
    .innerJoin(
      vouchers,
      and(eq(journalLines.voucherId, vouchers.id), eq(journalLines.bookId, vouchers.bookId)),
    )
    .where(and(eq(journalLines.bookId, bookId), lte(vouchers.sequence, sequence)));
}
