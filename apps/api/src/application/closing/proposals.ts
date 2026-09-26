import * as Accounting from "@open-erp/contracts/accounting";
import * as Closing from "@open-erp/contracts/closing";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { failure } from "../failures";
import { digest, isoNow, newId, replay, saveCommand } from "../posting";
import { decode, exactKeys, toJsonObject, unsupported, withBook } from "../commerce/support";
import * as Db from "../../db/closing/proposals";
import * as ClosingDb from "../../db/closing/inventories";
import * as PostingDb from "../../db/posting";
import type { Transaction } from "../../db/transaction";
import { closingBasisDependencies } from "./inventories";

type Scope = typeof Accounting.Scope.Type;
type JsonObject = Schema.JsonObject;

const ProposalSchema = Closing.ClosingProposal;
const ProposalViewSchema = Closing.ClosingProposalView;
const ReadinessSchema = Closing.ClosingReadiness;
const ReceiptSchema = Closing.ClosingReceipt;
const CertificateViewSchema = Closing.ClosingCertificateView;
const HistorySchema = Closing.ClosingHistory;
const ProposalListSchema = Closing.ClosingProposalList;
const proposalKeys = ["action", "reason"] as const;
const executeKeys = ["digest", "approvalId"] as const;
const proposalPageSize = 50;
const historyPageSize = 50;
const maximumReason = 2000;

function requireClosingAccess(transaction: Transaction, inserts: ReadonlyArray<string>) {
  return ClosingDb.readClosingAccess(transaction, [...ClosingDb.closingTables]).pipe(
    Effect.flatMap((rows) => {
      const denied = ClosingDb.closingTables.some((name) => {
        const access = rows.find((row) => row.tableName === name);
        return (
          access === undefined || !access.canSelect || (inserts.includes(name) && !access.canInsert)
        );
      });
      return denied ? unsupported() : Effect.void;
    }),
  );
}

function objectOrNull(value: Schema.Json | undefined) {
  const parsed = Schema.decodeUnknownOption(Schema.JsonObject)(value);
  return Option.isSome(parsed) ? parsed.value : null;
}

function text(value: JsonObject, key: string) {
  const found = value[key];
  return typeof found === "string" ? found : null;
}

function requireNativeProfile(transaction: Transaction, bookId: string) {
  return Effect.gen(function* () {
    const book = (yield* ClosingDb.readSyntheticProfile(transaction, bookId))[0];
    if (book === undefined || book.profile !== "synthetic-core-v1" || book.authority !== "native") {
      return yield* unsupported();
    }
  });
}

function readBasis(transaction: Transaction, bookId: string, periodId: string) {
  return Effect.gen(function* () {
    const period = (yield* ClosingDb.readPeriod(transaction, bookId, periodId, "share"))[0];
    if (period === undefined) return yield* failure("NotFound");
    const row = (
      yield* ClosingDb.readClosingBasis(
        transaction,
        bookId,
        periodId,
        yield* closingBasisDependencies(transaction, bookId, period),
      )
    )[0];
    if (!row) return yield* failure("NotFound");
    return row.basis;
  });
}

function isCurrentBasis(
  transaction: Transaction,
  left: Schema.Json | undefined,
  right: JsonObject,
) {
  const parsed = objectOrNull(left);
  if (parsed === null) return Effect.succeed(false);
  return ClosingDb.sameJson(transaction, parsed, right).pipe(
    Effect.map((rows) => rows[0]?.same === true),
  );
}

export const closingReadiness = Effect.fn("closing.readiness")(function* (
  token: string,
  command: { scope: Scope; periodId: string },
) {
  return yield* withBook(token, command.scope, false, function* (transaction) {
    yield* requireClosingAccess(transaction, []);
    if (
      (yield* ClosingDb.readPeriod(transaction, command.scope.bookId, command.periodId, "share"))
        .length === 0
    ) {
      return yield* failure("NotFound");
    }
    return yield* decode(
      ReadinessSchema,
      yield* readBasis(transaction, command.scope.bookId, command.periodId),
    );
  });
});

export const prepareClosing = Effect.fn("closing.prepare")(function* (
  token: string,
  command: {
    scope: Scope;
    periodId: string;
    idempotencyKey: string;
    input: typeof Closing.PrepareClosing.Type;
  },
) {
  return yield* withBook(
    token,
    command.scope,
    false,
    function* (transaction, principal) {
      const payload = yield* toJsonObject({
        periodId: command.periodId,
        input: command.input,
      });
      const request = yield* replay(
        transaction,
        command.scope,
        command.idempotencyKey,
        "prepare_closing",
        principal.actorId,
        payload,
        ProposalSchema,
      );
      if (request.previous) return request.previous;
      yield* requireClosingAccess(transaction, ["closing_proposals"]);
      const input = yield* toJsonObject(command.input);
      yield* exactKeys(input, [...proposalKeys]);
      const reason = text(input, "reason");
      if (
        (input.action !== "close" && input.action !== "reopen") ||
        reason === null ||
        reason.trim().length < 1 ||
        reason.length > maximumReason
      ) {
        return yield* failure("InvalidJournal");
      }
      if (
        (yield* ClosingDb.readPeriod(transaction, command.scope.bookId, command.periodId, "update"))
          .length === 0
      ) {
        return yield* failure("NotFound");
      }
      const basis = yield* readBasis(transaction, command.scope.bookId, command.periodId);
      yield* requireNativeProfile(transaction, command.scope.bookId);
      if (
        (input.action === "close" && basis.technicalCloseAllowed !== true) ||
        (input.action === "reopen" && basis.locked !== true)
      ) {
        return yield* failure("StaleDependency");
      }
      const captured = yield* decode(ReadinessSchema, basis);
      const id = newId("closing_proposal");
      const body = yield* toJsonObject({
        id,
        scope: captured.scope,
        periodId: command.periodId,
        action: input.action,
        reason,
        basis,
        proposedBy: principal.actorId,
        createdAt: yield* isoNow(transaction),
      });
      const sealed = { ...body, digest: yield* digest(body) };
      yield* Db.insertProposal(transaction, {
        bookId: command.scope.bookId,
        id,
        periodId: command.periodId,
        body: sealed,
      });
      const result = yield* decode(ProposalSchema, sealed);
      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        request.expected,
        "prepare_closing",
        principal.actorId,
        result,
      );
      return result;
    },
    "update",
  );
});

export const getClosingProposal = Effect.fn("closing.getProposal")(function* (
  token: string,
  command: { scope: Scope; proposalId: string },
) {
  return yield* withBook(token, command.scope, false, function* (transaction) {
    yield* requireClosingAccess(transaction, []);
    const proposal = (yield* Db.lockProposal(
      transaction,
      command.scope.bookId,
      command.proposalId,
    ))[0];
    if (!proposal) return yield* failure("NotFound");
    const basis = yield* readBasis(transaction, command.scope.bookId, proposal.periodId);
    const receipt = (yield* Db.readTransition(
      transaction,
      command.scope.bookId,
      command.proposalId,
    ))[0];
    return yield* decode(ProposalViewSchema, {
      proposal: proposal.body,
      dependenciesCurrent: yield* isCurrentBasis(transaction, proposal.body.basis, basis),
      receipt: receipt?.body ?? null,
    });
  });
});

export const listClosingProposals = Effect.fn("closing.listProposals")(function* (
  token: string,
  command: { scope: Scope; periodId: string; after?: string },
) {
  return yield* withBook(token, command.scope, false, function* (transaction) {
    yield* requireClosingAccess(transaction, []);
    if (
      (yield* Db.periodExists(transaction, command.scope.bookId, command.periodId))[0]?.present !==
      true
    ) {
      return yield* failure("NotFound");
    }
    let anchor = "";
    if (command.after !== undefined) {
      if (
        !/^[a-z][a-z0-9_-]{2,127}:[a-z][a-z0-9_-]{2,127}$/.test(command.after) ||
        command.after.split(":")[0] !== command.periodId
      ) {
        return yield* failure("InvalidJournal");
      }
      anchor = command.after.split(":")[1]!;
      if (
        (yield* Db.proposalExists(transaction, command.scope.bookId, command.periodId, anchor))[0]
          ?.present !== true
      ) {
        return yield* failure("InvalidJournal");
      }
    }
    const rows = yield* Db.listProposals(
      transaction,
      command.scope.bookId,
      command.periodId,
      anchor,
      proposalPageSize + 1,
    );
    const page = rows.slice(0, proposalPageSize);
    const last = page[page.length - 1];
    return yield* decode(ProposalListSchema, {
      scope: command.scope,
      periodId: command.periodId,
      items: page.map((row) => ({
        id: row.id,
        periodId: command.periodId,
        digest: row.digest,
        action: row.action,
        reason: row.reason,
        proposedBy: row.proposedBy,
        createdAt: row.createdAt,
        capturedStartsOn: row.capturedStartsOn,
        capturedEndsOn: row.capturedEndsOn,
        capturedLedgerSequence: row.capturedLedgerSequence,
        execution:
          row.transitionId === null
            ? null
            : { transitionId: row.transitionId, certificateId: row.certificateId },
      })),
      next:
        rows.length > proposalPageSize && last !== undefined
          ? `${command.periodId}:${last.id}`
          : null,
      discovery: "live_saved_proposal_history",
      liveReadinessChecked: false,
      approvalAuthority: false,
    });
  });
});

export const closingHistory = Effect.fn("closing.history")(function* (
  token: string,
  command: { scope: Scope; periodId: string; after?: string },
) {
  return yield* withBook(token, command.scope, false, function* (transaction) {
    yield* requireClosingAccess(transaction, []);
    const after = command.after ?? "0";
    if (!/^(0|[1-9][0-9]{0,37})$/.test(after)) return yield* failure("InvalidJournal");
    if (
      (yield* Db.periodExists(transaction, command.scope.bookId, command.periodId))[0]?.present !==
      true
    ) {
      return yield* failure("NotFound");
    }
    const rows = yield* Db.readHistory(
      transaction,
      command.scope.bookId,
      command.periodId,
      after,
      historyPageSize,
    );
    const total = (yield* Db.countHistory(
      transaction,
      command.scope.bookId,
      command.periodId,
      after,
    ))[0]?.total;
    if (total === undefined) return yield* failure("InternalError");
    const items = yield* Effect.forEach(rows, (row) => decode(ReceiptSchema, row.body));
    const last = rows[rows.length - 1];
    return yield* decode(HistorySchema, {
      items,
      next: total === String(rows.length) ? null : (last?.periodVersion ?? null),
    });
  });
});

export const getClosingCertificate = Effect.fn("closing.getCertificate")(function* (
  token: string,
  command: { scope: Scope; certificateId: string },
) {
  return yield* withBook(token, command.scope, false, function* (transaction) {
    yield* requireClosingAccess(transaction, []);
    const certificate = (yield* Db.readCertificate(
      transaction,
      command.scope.bookId,
      command.certificateId,
    ))[0];
    if (!certificate) return yield* failure("NotFound");
    const basis = yield* readBasis(transaction, command.scope.bookId, certificate.periodId);
    const invalidated = (yield* Db.readInvalidation(
      transaction,
      command.scope.bookId,
      "certificate",
      command.certificateId,
    ))[0]?.transitionId;
    const decoded = yield* decode(ReadinessSchema, basis);
    const dependencies = objectOrNull(certificate.body.effectiveDependencies);
    const current =
      invalidated === null &&
      decoded.locked === true &&
      dependencies !== null &&
      (yield* isCurrentBasis(transaction, dependencies, decoded.dependencies)) &&
      decoded.checks.every((check) => check.passed);
    return yield* decode(CertificateViewSchema, {
      certificate: certificate.body,
      invalidatedBy: invalidated ?? null,
      current,
    });
  });
});

export const executeClosing = Effect.fn("closing.execute")(function* (
  token: string,
  command: {
    scope: Scope;
    proposalId: string;
    idempotencyKey: string;
    input: typeof Closing.ExecuteClosing.Type;
  },
) {
  return yield* withBook(
    token,
    command.scope,
    false,
    function* (transaction, principal) {
      const payload = yield* toJsonObject({
        proposalId: command.proposalId,
        input: command.input,
      });
      const request = yield* replay(
        transaction,
        command.scope,
        command.idempotencyKey,
        "execute_closing",
        principal.actorId,
        payload,
        ReceiptSchema,
      );
      if (request.previous) return request.previous;
      yield* requireClosingAccess(transaction, [
        "closing_transitions",
        "closing_certificates",
        "closing_invalidations",
      ]);
      const input = yield* toJsonObject(command.input);
      yield* exactKeys(input, [...executeKeys]);
      const proposal = (yield* Db.lockProposal(
        transaction,
        command.scope.bookId,
        command.proposalId,
      ))[0];
      if (!proposal) return yield* failure("NotFound");
      const existing = (yield* Db.readTransition(
        transaction,
        command.scope.bookId,
        command.proposalId,
      ))[0];
      if (existing) {
        if (
          text(input, "digest") !== text(proposal.body, "digest") ||
          text(input, "approvalId") !== text(existing.body, "approvalId")
        ) {
          return yield* failure("IdempotencyConflict");
        }
        const committed = yield* decode(ReceiptSchema, existing.body);
        yield* saveCommand(
          transaction,
          command.scope,
          command.idempotencyKey,
          request.expected,
          "execute_closing",
          principal.actorId,
          committed,
        );
        return committed;
      }
      const period = (yield* Db.lockPeriodForUpdate(
        transaction,
        command.scope.bookId,
        proposal.periodId,
      ))[0];
      if (!period) return yield* failure("NotFound");
      const basis = yield* readBasis(transaction, command.scope.bookId, proposal.periodId);
      if (
        text(input, "digest") !== text(proposal.body, "digest") ||
        !(yield* isCurrentBasis(transaction, proposal.body.basis, basis))
      ) {
        return yield* failure("StaleDependency");
      }
      const approvalId = text(input, "approvalId");
      if (approvalId === null) return yield* failure("ApprovalRequired");
      const approval = (yield* Db.lockApproval(
        transaction,
        command.scope.bookId,
        command.proposalId,
        approvalId,
      ))[0];
      if (!approval) return yield* failure("ApprovalRequired");
      const now = yield* isoNow(transaction);
      if (
        Date.parse(approval.expiresAt) <= Date.parse(now) ||
        text(approval.body, "digest") !== text(input, "digest")
      ) {
        return yield* failure("ApprovalRequired");
      }
      if (
        (yield* PostingDb.readOperatorMembership(
          transaction,
          command.scope.bookId,
          approval.actorId,
        )).length === 0
      ) {
        return yield* failure("ApprovalRequired");
      }
      const action = text(proposal.body, "action");
      const transitionId = newId("closing_receipt");
      const certificateId = action === "close" ? newId("technical_certificate") : null;
      let invalidatedCertificates = 0;
      let invalidatedReports = 0;
      if (action === "reopen") {
        invalidatedCertificates = Number(
          (yield* Db.countInvalidationCandidates(
            transaction,
            command.scope.bookId,
            "certificate",
            period.startsOn,
          ))[0]?.total ?? "0",
        );
        invalidatedReports = Number(
          (yield* Db.countInvalidationCandidates(
            transaction,
            command.scope.bookId,
            "report",
            period.startsOn,
          ))[0]?.total ?? "0",
        );
      }
      const locked = (yield* Db.setPeriodLock(
        transaction,
        command.scope.bookId,
        period.id,
        action === "close",
      ))[0];
      if (!locked) return yield* failure("NotFound");
      const receipt = yield* toJsonObject({
        id: transitionId,
        scope: proposal.body.scope,
        periodId: period.id,
        proposalId: proposal.id,
        approvalId: approval.id,
        action,
        locked: locked.locked,
        periodVersion: locked.version,
        certificateId,
        invalidatedCertificates,
        invalidatedReports,
        approvedBy: approval.actorId,
        executedBy: principal.actorId,
        committedAt: now,
        statutoryReady: false,
      });
      yield* Db.insertTransition(transaction, {
        bookId: command.scope.bookId,
        id: transitionId,
        periodId: period.id,
        proposalId: proposal.id,
        approvalId: approval.id,
        periodVersion: locked.version,
        body: receipt,
      });
      if (certificateId !== null) {
        const effective = yield* readBasis(transaction, command.scope.bookId, period.id);
        const certificate = yield* toJsonObject({
          id: certificateId,
          kind: "synthetic_technical_period_lock_v1",
          proposal: proposal.body,
          receipt,
          effectiveDependencies: effective.dependencies,
        });
        yield* Db.insertCertificate(transaction, {
          bookId: command.scope.bookId,
          id: certificateId,
          periodId: period.id,
          transitionId,
          body: { ...certificate, digest: yield* digest(certificate) },
        });
      } else {
        for (const kind of ["certificate", "report", "bank_reconciliation"]) {
          yield* Db.insertInvalidations(transaction, {
            bookId: command.scope.bookId,
            kind,
            transitionId,
            from: period.startsOn,
          });
        }
      }
      const result = yield* decode(ReceiptSchema, receipt);
      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        request.expected,
        "execute_closing",
        principal.actorId,
        result,
      );
      return result;
    },
    "update",
  );
});
