import * as Accounting from "@open-erp/contracts/accounting";
import { canonicalizeOpenErpC14nV1 } from "@open-erp/domain/canonicalization";
import { ExecutionReceipt as DomainExecutionReceipt } from "@open-erp/domain/ledger";
import { orderPostingGroups, validatePostingLines } from "@open-erp/domain/posting";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { failure } from "./failures";
import { withAdmittedPrincipal, type VerifiedPrincipal } from "./identity";
import * as Db from "../db/posting";
import * as CorrectionDb from "../db/posting-corrections";
import { databaseFailure, type Transaction } from "../db/transaction";

type Scope = typeof Accounting.Scope.Type;
type Plan = typeof Accounting.ChangeSet.Type;
type Action = typeof Accounting.VoucherPostingAction.Type;
type ExecutionReceipt = typeof Accounting.ExecutionReceipt.Type;
type JsonObject = Schema.JsonObject;
type Principal = VerifiedPrincipal;

const PlanSchema = Accounting.ChangeSet;
const VoucherSchema = Accounting.Voucher;
const ActionSchema = Accounting.VoucherPostingAction;
const ApprovalSchema = Accounting.Approval;
const ValidationSchema = Accounting.ValidationReport;
const ReceiptSchema = Accounting.ExecutionReceipt;
const GroupReceiptSchema = Accounting.GroupReceipt;
const BookSetupSchema = Accounting.BookSetup;
const BookStatusSchema = Accounting.BookStatus;
const EvidenceSchema = Accounting.Evidence;
const EvidenceContentSchema = Accounting.EvidenceContent;

export function newId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
}

function decode<A>(schema: Schema.Decoder<A>, value: JsonObject) {
  return Schema.decodeEffect(schema)(value).pipe(Effect.mapError(() => failure("InternalError")));
}

export function digest(
  value: JsonObject,
  code: typeof Accounting.FailureCode.Type = "InternalError",
) {
  return Effect.gen(function* () {
    const canonical = yield* Effect.sync(() => canonicalizeOpenErpC14nV1(value));
    if (Result.isFailure(canonical)) return yield* failure(code);
    const canonicalBytes = new Uint8Array(canonical.success.bytes.byteLength);
    canonicalBytes.set(canonical.success.bytes);
    const bytes = yield* Effect.tryPromise({
      try: () => crypto.subtle.digest("SHA-256", canonicalBytes),
      catch: () => failure(code),
    });
    const hex = Array.from(new Uint8Array(bytes), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    return `sha256:${hex}`;
  });
}

function requestDigest(operation: string, actorId: string, input: JsonObject) {
  return digest({ operation, actor: actorId, input }, "InternalError");
}

export function sha256Hex(value: string) {
  return Effect.tryPromise({
    try: async () => {
      const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
      return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join(
        "",
      );
    },
    catch: () => failure("InternalError"),
  });
}

function withBook<A>(
  token: string,
  scope: Scope,
  operatorOnly: boolean,
  operation: (transaction: Transaction, principal: Principal) => Effect.Effect<A, unknown>,
) {
  return withAdmittedPrincipal({ token }, scope, { operatorOnly }, (transaction, principal) =>
    operation(transaction, principal).pipe(Effect.mapError(databaseFailure)),
  );
}

function readPlan(transaction: Transaction, scope: Scope, changeSetId: string) {
  return Db.readPlan(transaction, scope.bookId, changeSetId).pipe(
    Effect.flatMap((rows) => {
      const row = rows[0];
      if (!row) return failure("NotFound");
      return decode(PlanSchema, row.plan);
    }),
  );
}

function lockPlan(transaction: Transaction, scope: Scope, changeSetId: string) {
  return Db.lockPlan(transaction, scope.bookId, changeSetId).pipe(
    Effect.flatMap((rows) => {
      const row = rows[0];
      if (!row) return failure("NotFound");
      return decode(PlanSchema, row.plan);
    }),
  );
}

function voucherFromRow(row: Db.VoucherRow) {
  return {
    id: row.id,
    number: row.number.toString(),
    sequence: row.sequence.toString(),
    recordedAt: row.recordedAt,
    action: row.action,
  };
}

export function readVoucher(transaction: Transaction, scope: Scope, voucherId: string) {
  return Db.readVoucher(transaction, scope.bookId, voucherId).pipe(
    Effect.flatMap((rows) => {
      const row = rows[0];
      if (!row) return failure("NotFound");
      return decode(VoucherSchema, voucherFromRow(row));
    }),
  );
}

export function readBook(transaction: Transaction, scope: Scope) {
  return Db.readBook(transaction, scope).pipe(
    Effect.flatMap((rows) => {
      const row = rows[0];
      if (!row) return failure("Forbidden");
      return Effect.succeed(row);
    }),
  );
}

export function readPeriod(transaction: Transaction, scope: Scope, periodId: string) {
  return Db.readPeriod(transaction, scope.bookId, periodId).pipe(
    Effect.flatMap((rows) => {
      const row = rows[0];
      if (!row) return failure("InvalidJournal");
      return readFiscalYear(transaction, scope, row.fiscalYearId).pipe(
        Effect.flatMap((fiscalYearRows) => {
          const fiscalYear = fiscalYearRows[0];
          if (!fiscalYear) return failure("InvalidJournal");
          return Effect.succeed({ ...row, fiscalYear });
        }),
      );
    }),
  );
}

function readFiscalYear(transaction: Transaction, scope: Scope, fiscalYearId: string) {
  return Db.readFiscalYear(transaction, scope.bookId, fiscalYearId);
}

function validateReversalAction(transaction: Transaction, scope: Scope, action: Action) {
  return Effect.gen(function* () {
    if (!action.correctsVoucherId) return yield* failure("InvalidJournal");
    const original = yield* readVoucher(transaction, scope, action.correctsVoucherId);
    if (original.action.postingPurpose === "reversal") return yield* failure("InvalidJournal");
    if (original.action.kind !== "post_voucher") return yield* failure("InvalidJournal");
    if (original.action.lines.length !== action.lines.length)
      return yield* failure("InvalidJournal");
    if (original.action.eventId !== action.eventId) return yield* failure("InvalidJournal");
    if (JSON.stringify(original.action.evidenceRefs) !== JSON.stringify(action.evidenceRefs)) {
      return yield* failure("InvalidJournal");
    }
    if (action.occurrenceKey !== action.correctsVoucherId) return yield* failure("InvalidJournal");
    for (const [index, line] of action.lines.entries()) {
      const originalLine = original.action.lines[index];
      if (
        !originalLine ||
        line.accountId !== originalLine.accountId ||
        line.debitMinor !== originalLine.creditMinor ||
        line.creditMinor !== originalLine.debitMinor
      ) {
        return yield* failure("InvalidJournal");
      }
    }
  });
}

export function validateAction(
  transaction: Transaction,
  scope: Scope,
  book: { currency: string; profile: string; authority: string },
  action: Action,
) {
  return Effect.gen(function* () {
    const lines = validatePostingLines(action.lines);
    if (Result.isFailure(lines)) return yield* failure("InvalidJournal");
    if (action.currency !== book.currency || book.profile !== "synthetic-core-v1") {
      return yield* failure("UnsupportedProfile");
    }
    if (book.authority !== "native") return yield* failure("StaleDependency");

    const period = yield* readPeriod(transaction, scope, action.accountingPeriodId);
    if (period.locked) return yield* failure("PeriodLocked");
    if (
      period.fiscalYearId !== action.fiscalYearId ||
      action.postingDate < period.startsOn ||
      action.postingDate > period.endsOn ||
      action.postingDate < period.fiscalYear.startsOn ||
      action.postingDate > period.fiscalYear.endsOn
    ) {
      return yield* failure("InvalidJournal");
    }

    const accountRows = yield* Db.readAccounts(
      transaction,
      scope.bookId,
      action.lines.map((line) => line.accountId),
    );
    if (accountRows.length !== new Set(action.lines.map((line) => line.accountId)).size) {
      return yield* failure("InvalidJournal");
    }
    if (action.postingPurpose !== "reversal" && accountRows.some((account) => !account.active)) {
      return yield* failure("InvalidJournal");
    }

    const eventRows = yield* Db.readEventById(transaction, scope.bookId, action.eventId);
    if (eventRows.length !== 1) return yield* failure("InvalidJournal");
    for (const reference of action.evidenceRefs) {
      const evidenceRows = yield* Db.readEvidence(transaction, scope.bookId, reference.evidenceId);
      if (evidenceRows[0]?.sha256 !== reference.sha256) return yield* failure("MissingEvidence");
    }

    if (action.postingPurpose === "reversal") {
      yield* validateReversalAction(transaction, scope, action);
    } else if (action.postingPurpose !== "adjustment" || action.correctsVoucherId !== null) {
      return yield* failure("InvalidJournal");
    }
  });
}

export function validatePlan(transaction: Transaction, scope: Scope, plan: Plan) {
  return Effect.gen(function* () {
    const planWithoutDigest = Object.fromEntries(
      Object.entries(plan).filter(([key]) => key !== "planDigest"),
    );
    const sealedDigest = yield* digest(planWithoutDigest, "StaleDependency");
    if (sealedDigest !== plan.planDigest) return yield* failure("StaleDependency");
    const groups = orderPostingGroups(
      plan.groups.map((group) => ({ id: group.id, dependsOnGroupIds: group.dependsOnGroupIds })),
    );
    if (Result.isFailure(groups)) return yield* failure("InvalidJournal");
    const book = yield* readBook(transaction, scope);
    for (const dependency of plan.dependencies) {
      let currentVersion: string | undefined;
      if (dependency.kind === "profile") currentVersion = book.profileVersion.toString();
      if (dependency.kind === "writer_epoch") currentVersion = book.writerEpoch.toString();
      if (dependency.kind === "period") {
        const periodRows = yield* Db.readPeriod(transaction, scope.bookId, dependency.resourceId);
        currentVersion = periodRows[0]?.version.toString();
      }
      if (dependency.kind === "account") {
        const accountRows = yield* Db.readAccounts(transaction, scope.bookId, [
          dependency.resourceId,
        ]);
        currentVersion = accountRows[0]?.version.toString();
      }
      if (currentVersion !== dependency.version) return yield* failure("StaleDependency");
    }
    const groupsById = new Map(plan.groups.map((group) => [group.id, group]));
    for (const group of groups.success) {
      const storedGroup = groupsById.get(group.id);
      if (!storedGroup) return yield* failure("InvalidJournal");
      for (const action of storedGroup.actions) {
        const decodedAction = yield* decode(ActionSchema, action);
        yield* validateAction(transaction, scope, book, decodedAction);
      }
    }
  });
}

export function replay<A>(
  transaction: Transaction,
  scope: Scope,
  key: string,
  operation: string,
  actorId: string,
  input: JsonObject,
  schema: Schema.Decoder<A>,
) {
  return Effect.gen(function* () {
    const expected = yield* requestDigest(operation, actorId, input);
    const rows = yield* Db.readCommandReceipt(transaction, scope.bookId, key, "update");
    const row = rows[0];
    if (!row) return { expected, previous: undefined } as const;
    if (row.requestDigest !== expected || row.operation !== operation) {
      return yield* failure("IdempotencyConflict");
    }
    return { expected, previous: yield* decode(schema, row.result) } as const;
  });
}

export function saveCommand(
  transaction: Transaction,
  scope: Scope,
  key: string,
  request: string,
  operation: string,
  actorId: string,
  result: JsonObject,
) {
  return Db.insertCommandReceipt(transaction, {
    bookId: scope.bookId,
    key,
    requestDigest: request,
    operation,
    actorId,
    result,
  });
}

export function isoNow(transaction: Transaction) {
  return Db.readDatabaseTime(transaction).pipe(
    Effect.map((row) => new Date(row.now).toISOString()),
  );
}

export const createEvidenceInTransaction = Effect.fn("posting.createEvidenceInTransaction")(
  function* (
    transaction: Transaction,
    principal: Principal,
    command: {
      scope: Scope;
      idempotencyKey: string;
      input: typeof Accounting.CreateEvidence.Type;
    },
  ) {
    return yield* Effect.gen(function* () {
      const request = yield* replay(
        transaction,
        command.scope,
        command.idempotencyKey,
        "create_evidence",
        principal.actorId,
        command.input,
        EvidenceSchema,
      );
      if (request.previous) return request.previous;
      if (command.input.mediaType === "application/json") {
        yield* Effect.try({
          try: () => JSON.parse(command.input.content),
          catch: () => failure("MissingEvidence"),
        });
      }
      const sha256 = yield* sha256Hex(command.input.content);
      const createdAt = yield* isoNow(transaction);
      const existing = yield* Db.readEvidenceBySha(transaction, command.scope.bookId, sha256);
      const row =
        existing[0] ??
        (yield* Db.insertEvidence(transaction, {
          bookId: command.scope.bookId,
          id: newId("evidence"),
          title: command.input.title,
          content: command.input.content,
          mediaType: command.input.mediaType,
          origin: command.input.origin,
          sha256,
          createdBy: principal.actorId,
          createdAt,
        }))[0];
      if (!row) return yield* failure("InternalError");
      const result = yield* decode(EvidenceSchema, {
        id: row.id,
        title: row.title,
        sha256: row.sha256,
        mediaType: row.mediaType,
        origin: row.origin,
        createdAt: row.createdAt,
      });
      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        request.expected,
        "create_evidence",
        principal.actorId,
        result,
      );
      return result;
    });
  },
);

export const createEvidence = Effect.fn("posting.createEvidence")(function* (
  token: string,
  command: {
    scope: Scope;
    idempotencyKey: string;
    input: typeof Accounting.CreateEvidence.Type;
  },
) {
  return yield* withBook(token, command.scope, false, (transaction, principal) =>
    Effect.gen(function* () {
      yield* Db.lockBookForUpdate(transaction, command.scope);
      return yield* createEvidenceInTransaction(transaction, principal, command);
    }),
  );
});

export const getEvidence = Effect.fn("posting.getEvidence")(function* (
  token: string,
  command: { scope: Scope; evidenceId: string },
) {
  return yield* withBook(token, command.scope, false, (transaction) =>
    Effect.gen(function* () {
      yield* Db.lockBookForShare(transaction, command.scope);
      const row = (yield* Db.readEvidence(
        transaction,
        command.scope.bookId,
        command.evidenceId,
      ))[0];
      if (!row) return yield* failure("NotFound");
      return yield* decode(EvidenceContentSchema, row);
    }),
  );
});

export const bookSetup = Effect.fn("posting.bookSetup")(function* (
  token: string,
  command: { scope: Scope },
) {
  return yield* withBook(token, command.scope, false, (transaction) =>
    Effect.gen(function* () {
      yield* Db.lockBookForShare(transaction, command.scope);
      const book = yield* readBook(transaction, command.scope);
      const accountRows = yield* Db.readAllAccounts(transaction, command.scope.bookId);
      const periodRows = yield* Db.readAllPeriods(transaction, command.scope.bookId);
      return yield* decode(BookSetupSchema, {
        accounts: accountRows.map((row) => ({
          id: row.id,
          code: row.code,
          name: row.name,
          active: row.active,
        })),
        periods: periodRows.map((row) => ({
          id: row.id,
          startsOn: row.startsOn,
          endsOn: row.endsOn,
          locked: row.locked,
        })),
        blockers:
          book.profile === "synthetic-core-v1" && book.authority === "native"
            ? []
            : ["The book profile or writer authority is not supported."],
        warnings: [
          "Only the synthetic-core-v1 manual journal profile is implemented. This book is not verified for production accounting or Swedish compliance.",
          "Tax treatment, source completeness, external archive and statutory reporting are not implemented.",
        ],
      });
    }),
  );
});

export const bookStatus = Effect.fn("posting.bookStatus")(function* (
  token: string,
  command: { scope: Scope },
) {
  return yield* withBook(token, command.scope, false, (transaction) =>
    Effect.gen(function* () {
      yield* Db.lockBookForShare(transaction, command.scope);
      const book = yield* readBook(transaction, command.scope);
      return yield* decode(BookStatusSchema, {
        scope: command.scope,
        profile: book.profile,
        writerAuthority: book.authority,
        sequence: book.committedSequence.toString(),
        productionReady: false,
        verification: "not_verified",
        features: [
          {
            id: "journals",
            installed: true,
            available: book.profile === "synthetic-core-v1" && book.authority === "native",
            limitation:
              "Synthetic exact manual journals only; execution requires operator approval.",
          },
        ],
        blockers: [
          {
            code: "CompanyProfileRequired",
            message: "No real company compliance profile is supported by this release.",
            requiredInputs: [
              "Legal entity facts and accounting method",
              "VAT registration and filing periods",
              "Required payroll, assets, foreign currency and statutory obligations",
            ],
          },
        ],
      });
    }),
  );
});

export const prepareJournalInTransaction = Effect.fn("posting.prepareJournalInTransaction")(
  function* (
    transaction: Transaction,
    principal: Principal,
    command: typeof import("@open-erp/contracts/capabilities").Capabilities.ledger_prepare_journal.input.Type,
  ) {
    return yield* Effect.gen(function* () {
      const request = yield* replay(
        transaction,
        command.scope,
        command.idempotencyKey,
        "prepare_journal",
        principal.actorId,
        command.input,
        PlanSchema,
      );
      if (request.previous) return request.previous;
      const evidenceRows = yield* Db.readEvidence(
        transaction,
        command.scope.bookId,
        command.input.evidenceId,
      );
      const source = evidenceRows[0];
      if (!source) return yield* failure("MissingEvidence");
      const book = yield* readBook(transaction, command.scope);
      const period = yield* readPeriod(
        transaction,
        command.scope,
        command.input.accountingPeriodId,
      );
      const eventRows = yield* Db.readEvent(
        transaction,
        command.scope.bookId,
        source.id,
        command.input.eventKey,
      );
      const eventId = eventRows[0]?.id ?? newId("event");
      if (eventRows.length === 0) {
        yield* Db.insertEvent(
          transaction,
          command.scope.bookId,
          eventId,
          source.id,
          command.input.eventKey,
        );
      }
      const actionValue = {
        kind: "post_voucher" as const,
        correctsVoucherId: null,
        eventId,
        postingPurpose: "adjustment" as const,
        occurrenceKey: "manual_journal",
        fiscalYearId: period.fiscalYearId,
        accountingPeriodId: command.input.accountingPeriodId,
        postingDate: command.input.postingDate,
        series: command.input.series,
        currency: book.currency,
        description: command.input.description,
        rationale: command.input.rationale,
        taxAssessment: command.input.taxAssessment,
        lines: command.input.lines.map((line) => ({ ...line, lineId: newId("line") })),
        evidenceRefs: [
          {
            evidenceId: source.id,
            sha256: source.sha256,
            locator: command.input.eventKey,
          },
        ],
      };
      const action = yield* decode(ActionSchema, actionValue);
      yield* validateAction(transaction, command.scope, book, action);
      const createdAt = yield* isoNow(transaction);
      const changeSetId = newId("change");
      const groupId = newId("group");
      const planValue = {
        schemaVersion: "1" as const,
        canonicalization: "openerp-c14n-v1" as const,
        id: changeSetId,
        version: 1 as const,
        scope: command.scope,
        createdAt,
        dependencies: [
          {
            kind: "profile" as const,
            resourceId: book.id,
            version: book.profileVersion.toString(),
            reason: "Book currency and supported profile",
          },
          {
            kind: "writer_epoch" as const,
            resourceId: book.id,
            version: book.writerEpoch.toString(),
            reason: "Single authoritative writer",
          },
          {
            kind: "period" as const,
            resourceId: period.id,
            version: period.version.toString(),
            reason: "Posting dates and lock state",
          },
        ],
        groups: [
          {
            id: groupId,
            dependsOnGroupIds: [],
            actions: [action],
          },
        ],
      };
      const accountRows = yield* Db.readAccounts(
        transaction,
        command.scope.bookId,
        action.lines.map((line) => line.accountId),
      );
      const accountDependencies = accountRows.map((account) => ({
        kind: "account" as const,
        resourceId: account.id,
        version: account.version.toString(),
        reason: "Exact account configuration",
      }));
      const planWithoutDigest = {
        ...planValue,
        dependencies: [...planValue.dependencies, ...accountDependencies],
      };
      const planDigest = yield* digest(planWithoutDigest);
      const plan = yield* decode(PlanSchema, { ...planWithoutDigest, planDigest });
      yield* Db.insertPlan(transaction, {
        bookId: command.scope.bookId,
        id: changeSetId,
        plan,
        digest: planDigest,
        createdBy: principal.actorId,
      });
      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        request.expected,
        "prepare_journal",
        principal.actorId,
        plan,
      );
      return plan;
    });
  },
);

export const prepareJournal = Effect.fn("posting.prepareJournal")(function* (
  token: string,
  command: typeof import("@open-erp/contracts/capabilities").Capabilities.ledger_prepare_journal.input.Type,
) {
  return yield* withBook(token, command.scope, false, (transaction, principal) =>
    Effect.gen(function* () {
      yield* Db.lockBookForUpdate(transaction, command.scope);
      return yield* prepareJournalInTransaction(transaction, principal, command);
    }),
  );
});

export const getChange = Effect.fn("posting.getChange")(function* (
  token: string,
  command: { scope: Scope; changeSetId: string },
) {
  return yield* withBook(token, command.scope, false, (transaction) =>
    Effect.gen(function* () {
      yield* Db.lockBookForShare(transaction, command.scope);
      return yield* readPlan(transaction, command.scope, command.changeSetId);
    }),
  );
});

export const validateChange = Effect.fn("posting.validateChange")(function* (
  token: string,
  command: {
    scope: Scope;
    changeSetId: string;
    idempotencyKey: string;
  },
) {
  return yield* withBook(token, command.scope, false, (transaction, principal) =>
    Effect.gen(function* () {
      yield* Db.lockBookForUpdate(transaction, command.scope);
      const request = yield* replay(
        transaction,
        command.scope,
        command.idempotencyKey,
        "validate_change",
        principal.actorId,
        { id: command.changeSetId },
        ValidationSchema,
      );
      if (request.previous) return request.previous;
      const plan = yield* readPlan(transaction, command.scope, command.changeSetId);
      yield* validatePlan(transaction, command.scope, plan);
      const result = {
        changeSetId: plan.id,
        planDigest: plan.planDigest,
        status: "valid" as const,
        checkedAt: yield* isoNow(transaction),
      };
      const decoded = yield* decode(ValidationSchema, result);
      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        request.expected,
        "validate_change",
        principal.actorId,
        decoded,
      );
      return decoded;
    }),
  );
});

export const approveChangeInTransaction = Effect.fn("posting.approveChangeInTransaction")(
  function* (
    transaction: Transaction,
    principal: Principal,
    command: {
      scope: Scope;
      changeSetId: string;
      idempotencyKey: string;
      input: typeof Accounting.ApproveChange.Type;
    },
  ) {
    return yield* Effect.gen(function* () {
      const request = yield* replay(
        transaction,
        command.scope,
        command.idempotencyKey,
        "approve_change",
        principal.actorId,
        { id: command.changeSetId, input: command.input },
        ApprovalSchema,
      );
      if (request.previous) return request.previous;
      const plan = yield* readPlan(transaction, command.scope, command.changeSetId);
      if (command.input.planDigest !== plan.planDigest || command.input.version !== plan.version) {
        return yield* failure("StaleDependency");
      }
      yield* validatePlan(transaction, command.scope, plan);
      if (
        (yield* Db.readVoucherByChangeSet(transaction, command.scope.bookId, plan.id)).length > 0
      ) {
        return yield* failure("AlreadyPosted");
      }
      const now = yield* Db.readDatabaseTime(transaction);
      const expiresAt = new Date(Date.parse(now.now) + 60 * 60 * 1000).toISOString();
      const approval = yield* Db.insertApproval(transaction, {
        bookId: command.scope.bookId,
        id: newId("approval"),
        changeSetId: plan.id,
        digest: plan.planDigest,
        actorId: principal.actorId,
        expiresAt,
      }).pipe(
        Effect.flatMap((rows) => (rows[0] ? Effect.succeed(rows[0]) : failure("InternalError"))),
      );
      const result = yield* decode(ApprovalSchema, {
        id: approval.id,
        changeSetId: approval.changeSetId,
        planDigest: approval.digest,
        actorId: approval.actorId,
        expiresAt: approval.expiresAt,
      });
      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        request.expected,
        "approve_change",
        principal.actorId,
        result,
      );
      return result;
    });
  },
);

export const approveChange = Effect.fn("posting.approveChange")(function* (
  token: string,
  command: {
    scope: Scope;
    changeSetId: string;
    idempotencyKey: string;
    input: typeof Accounting.ApproveChange.Type;
  },
) {
  return yield* withBook(token, command.scope, true, (transaction, principal) =>
    Effect.gen(function* () {
      yield* Db.lockBookForUpdate(transaction, command.scope);
      return yield* approveChangeInTransaction(transaction, principal, command);
    }),
  );
});

function assertPlanUnposted(transaction: Transaction, scope: Scope, plan: Plan) {
  return Effect.gen(function* () {
    if ((yield* Db.readVoucherByChangeSet(transaction, scope.bookId, plan.id)).length > 0) {
      return yield* failure("AlreadyPosted");
    }
    for (const group of plan.groups) {
      for (const action of group.actions) {
        if (
          (yield* Db.readVoucherByEconomicIdentity(transaction, scope.bookId, action)).length > 0
        ) {
          return yield* failure("AlreadyPosted");
        }
        if (
          action.postingPurpose === "reversal" &&
          action.correctsVoucherId &&
          (yield* Db.readVoucherByReversal(transaction, scope.bookId, action.correctsVoucherId))
            .length > 0
        ) {
          return yield* failure("AlreadyPosted");
        }
      }
    }
  });
}

function executionApproval(transaction: Transaction, scope: Scope, plan: Plan, approvalId: string) {
  return Effect.gen(function* () {
    const approvalRows = yield* Db.readApproval(transaction, scope.bookId, approvalId, "update");
    const approval = approvalRows[0];
    if (
      !approval ||
      approval.changeSetId !== plan.id ||
      approval.digest !== plan.planDigest ||
      approval.consumedAt !== null
    ) {
      return yield* failure("ApprovalRequired");
    }
    if (
      (yield* Db.readOperatorMembership(transaction, scope.bookId, approval.actorId)).length === 0
    ) {
      return yield* failure("ApprovalRequired");
    }
    const admission = yield* Db.readActorAdmission(transaction, approval.actorId);
    if (admission[0]?.enabled === false) return yield* failure("ApprovalRequired");
    if ((yield* Db.readApprovalRevocation(transaction, scope.bookId, approval.id)).length > 0) {
      return yield* failure("ApprovalRequired");
    }
    const now = yield* Db.readDatabaseTime(transaction);
    if (Date.parse(approval.expiresAt) <= Date.parse(now.now)) {
      return yield* failure("ApprovalRequired");
    }
    return approval;
  });
}

export const executeChangeInTransaction = Effect.fn("posting.execute")(function* (
  transaction: Transaction,
  principal: Principal,
  command: {
    scope: Scope;
    changeSetId: string;
    idempotencyKey: string;
    input: typeof Accounting.ExecuteChange.Type;
    allowCorrectionChild?: boolean;
  },
) {
  return yield* Effect.gen(function* () {
    const request = yield* replay(
      transaction,
      command.scope,
      command.idempotencyKey,
      "execute_change",
      principal.actorId,
      { id: command.changeSetId, input: command.input },
      ReceiptSchema,
    );
    if (request.previous) return request.previous;

    const plan = yield* lockPlan(transaction, command.scope, command.changeSetId);
    if (command.input.planDigest !== plan.planDigest || command.input.version !== plan.version) {
      return yield* failure("StaleDependency");
    }
    if (
      command.allowCorrectionChild !== true &&
      (yield* CorrectionDb.readBundleByChangeSet(
        transaction,
        command.scope.bookId,
        command.changeSetId,
      )).length > 0
    ) {
      return yield* failure("UnsupportedProfile");
    }
    const groupOrder = orderPostingGroups(
      plan.groups.map((group) => ({ id: group.id, dependsOnGroupIds: group.dependsOnGroupIds })),
    );
    if (Result.isFailure(groupOrder)) return yield* failure("InvalidJournal");
    if (plan.groups.length !== 1 || plan.groups[0]?.actions.length !== 1) {
      return yield* failure("UnsupportedProfile");
    }
    const group = plan.groups[0];
    const actionValue = group?.actions[0];
    if (!group || !actionValue) return yield* failure("InvalidJournal");
    const action = yield* decode(ActionSchema, actionValue);
    yield* validatePlan(transaction, command.scope, plan);
    yield* assertPlanUnposted(transaction, command.scope, plan);
    const approval = yield* executionApproval(
      transaction,
      command.scope,
      plan,
      command.input.approvalId,
    );

    const counter = yield* Db.allocateSeriesCounter(
      transaction,
      command.scope.bookId,
      action.fiscalYearId,
      action.series,
    );
    const voucherNumber = counter[0]?.lastNumber;
    const sequence = yield* Db.allocateSequence(transaction, command.scope.bookId);
    const sequenceValue = sequence[0]?.sequence;
    if (voucherNumber === undefined || sequenceValue === undefined) {
      return yield* failure("InternalError");
    }
    const voucherId = newId("voucher");
    const voucher = yield* Db.insertVoucher(transaction, {
      bookId: command.scope.bookId,
      id: voucherId,
      fiscalYearId: action.fiscalYearId,
      periodId: action.accountingPeriodId,
      series: action.series,
      number: voucherNumber,
      sequence: sequenceValue,
      postingDate: action.postingDate,
      eventId: action.eventId,
      postingPurpose: action.postingPurpose,
      occurrenceKey: action.occurrenceKey,
      correctsVoucherId: action.correctsVoucherId,
      changeSetId: plan.id,
      action,
      expectedLineCount: action.lines.length,
    });
    const recordedAt = voucher[0]?.recordedAt;
    if (recordedAt === undefined) return yield* failure("InternalError");
    yield* Db.insertJournalLines(
      transaction,
      action.lines.map((line, index) => ({
        bookId: command.scope.bookId,
        voucherId,
        id: line.lineId,
        ordinal: index + 1,
        accountId: line.accountId,
        debitMinor: line.debitMinor,
        creditMinor: line.creditMinor,
        description: line.description,
      })),
    );

    const receipt = yield* decode(ReceiptSchema, {
      id: newId("receipt"),
      changeSetId: plan.id,
      voucherId,
      planDigest: plan.planDigest,
      sequence: sequenceValue.toString(),
      voucherNumber: voucherNumber.toString(),
      committedAt: recordedAt,
    } satisfies typeof DomainExecutionReceipt.Type);
    const groupReceipt = yield* decode(GroupReceiptSchema, {
      id: receipt.id,
      changeSetId: plan.id,
      groupId: group.id,
      planDigest: plan.planDigest,
      executionReceipts: [receipt],
      committedAt: recordedAt,
    });

    yield* Db.insertExecutionReceipt(transaction, {
      bookId: command.scope.bookId,
      id: receipt.id,
      changeSetId: plan.id,
      voucherId,
      approvalId: approval.id,
      body: receipt,
    });
    yield* Db.insertGroupReceipt(transaction, {
      bookId: command.scope.bookId,
      id: groupReceipt.id,
      changeSetId: plan.id,
      groupId: group.id,
      planDigest: plan.planDigest,
      body: groupReceipt,
      committedAt: recordedAt,
    });
    yield* Db.insertApprovalConsumption(transaction, {
      bookId: command.scope.bookId,
      approvalId: approval.id,
      changeSetId: plan.id,
      groupId: group.id,
      planDigest: plan.planDigest,
      receiptId: groupReceipt.id,
      approverId: approval.actorId,
      consumedById: principal.actorId,
      consumedAt: recordedAt,
    });
    const consumed = yield* Db.consumeApproval(
      transaction,
      command.scope.bookId,
      approval.id,
      recordedAt,
    );
    if (consumed.length !== 1) return yield* failure("InternalError");
    yield* Db.insertOutbox(transaction, {
      bookId: command.scope.bookId,
      id: newId("outbox"),
      receiptId: receipt.id,
      kind: "voucher.posted.v1",
      payload: receipt,
    });
    yield* saveCommand(
      transaction,
      command.scope,
      command.idempotencyKey,
      request.expected,
      "execute_change",
      principal.actorId,
      receipt,
    );
    return receipt;
  });
});

export const executeChange = Effect.fn("posting.executeWithAdmission")(function* (
  token: string,
  command: {
    scope: Scope;
    changeSetId: string;
    idempotencyKey: string;
    input: typeof Accounting.ExecuteChange.Type;
  },
) {
  return yield* withBook(token, command.scope, false, (transaction, principal) =>
    Effect.gen(function* () {
      yield* Db.lockBookForUpdate(transaction, command.scope);
      return yield* executeChangeInTransaction(transaction, principal, command);
    }),
  );
});

export const prepareCorrection = Effect.fn("posting.prepareCorrection")(function* (
  token: string,
  command: {
    scope: Scope;
    voucherId: string;
    idempotencyKey: string;
    input: typeof Accounting.PrepareCorrection.Type;
  },
) {
  return yield* withBook(token, command.scope, false, (transaction, principal) =>
    Effect.gen(function* () {
      yield* Db.lockBookForUpdate(transaction, command.scope);
      const request = yield* replay(
        transaction,
        command.scope,
        command.idempotencyKey,
        "prepare_correction",
        principal.actorId,
        { id: command.voucherId, input: command.input },
        PlanSchema,
      );
      if (request.previous) return request.previous;
      const original = yield* readVoucher(transaction, command.scope, command.voucherId);
      if (original.action.postingPurpose === "reversal") return yield* failure("InvalidJournal");
      if (original.action.postingPurpose !== "adjustment")
        return yield* failure("UnsupportedProfile");
      const period = yield* readPeriod(
        transaction,
        command.scope,
        command.input.accountingPeriodId,
      );
      if (period.locked) return yield* failure("PeriodLocked");
      if (command.input.postingDate < original.action.postingDate) {
        return yield* failure("InvalidJournal");
      }
      const book = yield* readBook(transaction, command.scope);
      const actionValue = {
        ...original.action,
        correctsVoucherId: command.voucherId,
        postingPurpose: "reversal" as const,
        occurrenceKey: command.voucherId,
        fiscalYearId: period.fiscalYearId,
        accountingPeriodId: command.input.accountingPeriodId,
        postingDate: command.input.postingDate,
        description: `Reversal: ${original.action.description.slice(0, 1990)}`,
        rationale: command.input.rationale,
        lines: original.action.lines.map((line) => ({
          ...line,
          lineId: newId("line"),
          debitMinor: line.creditMinor,
          creditMinor: line.debitMinor,
        })),
      };
      const action = yield* decode(ActionSchema, actionValue);
      yield* validateAction(transaction, command.scope, book, action);
      const createdAt = yield* isoNow(transaction);
      const planWithoutDigest = {
        schemaVersion: "1" as const,
        canonicalization: "openerp-c14n-v1" as const,
        id: newId("change"),
        version: 1 as const,
        scope: command.scope,
        createdAt,
        dependencies: [
          {
            kind: "profile" as const,
            resourceId: book.id,
            version: book.profileVersion.toString(),
            reason: "Book currency and supported profile",
          },
          {
            kind: "writer_epoch" as const,
            resourceId: book.id,
            version: book.writerEpoch.toString(),
            reason: "Single authoritative writer",
          },
          {
            kind: "period" as const,
            resourceId: period.id,
            version: period.version.toString(),
            reason: "Posting dates and lock state",
          },
          ...(yield* Db.readAccounts(
            transaction,
            command.scope.bookId,
            action.lines.map((line) => line.accountId),
          )).map((account) => ({
            kind: "account" as const,
            resourceId: account.id,
            version: account.version.toString(),
            reason: "Exact account configuration",
          })),
        ],
        groups: [
          {
            id: newId("group"),
            dependsOnGroupIds: [],
            actions: [action],
          },
        ],
      };
      const planDigest = yield* digest(planWithoutDigest);
      const plan = yield* decode(PlanSchema, { ...planWithoutDigest, planDigest });
      yield* Db.insertPlan(transaction, {
        bookId: command.scope.bookId,
        id: plan.id,
        plan,
        digest: planDigest,
        createdBy: principal.actorId,
      });
      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        request.expected,
        "prepare_correction",
        principal.actorId,
        plan,
      );
      return plan;
    }),
  );
});

export const getVoucher = Effect.fn("posting.getVoucher")(function* (
  token: string,
  command: { scope: Scope; voucherId: string },
) {
  return yield* withBook(token, command.scope, false, (transaction) =>
    Effect.gen(function* () {
      yield* Db.lockBookForShare(transaction, command.scope);
      return yield* readVoucher(transaction, command.scope, command.voucherId);
    }),
  );
});

export const listVouchers = Effect.fn("posting.listVouchers")(function* (
  token: string,
  command: { scope: Scope; after?: string },
) {
  return yield* withBook(token, command.scope, false, (transaction) =>
    Effect.gen(function* () {
      yield* Db.lockBookForShare(transaction, command.scope);
      const after = command.after ?? "0";
      if (!/^(0|[1-9][0-9]{0,37})$/.test(after)) return yield* failure("InvalidJournal");
      const rows = yield* Db.readVoucherPage(transaction, command.scope.bookId, BigInt(after), 101);
      const page = rows.slice(0, 100);
      const items = yield* Effect.forEach(page, (row) =>
        decode(VoucherSchema, voucherFromRow(row)),
      );
      return {
        items,
        next: rows.length > 100 ? (items[items.length - 1]?.sequence ?? null) : null,
      };
    }),
  );
});

export const ledgerSnapshot = Effect.fn("posting.ledgerSnapshot")(function* (
  token: string,
  command: { scope: Scope },
) {
  return yield* withBook(token, command.scope, false, (transaction) =>
    Effect.gen(function* () {
      yield* Db.lockBookForShare(transaction, command.scope);
      const book = yield* readBook(transaction, command.scope);
      const accountRows = yield* Db.readLedgerAccounts(transaction, command.scope.bookId);
      const lineRows = yield* Db.readLedgerLines(
        transaction,
        command.scope.bookId,
        book.committedSequence,
      );
      const totals = new Map<string, { debit: bigint; credit: bigint }>();
      for (const line of lineRows) {
        const current = totals.get(line.accountId) ?? { debit: 0n, credit: 0n };
        current.debit += BigInt(line.debitMinor);
        current.credit += BigInt(line.creditMinor);
        totals.set(line.accountId, current);
      }
      return {
        sequence: book.committedSequence.toString(),
        accounts: accountRows.map((account) => {
          const total = totals.get(account.id) ?? { debit: 0n, credit: 0n };
          const balance = total.debit - total.credit;
          return {
            accountId: account.id,
            code: account.code,
            name: account.name,
            debitMinor: total.debit.toString(),
            creditMinor: total.credit.toString(),
            balanceMinor: balance === 0n ? "0" : balance.toString(),
          };
        }),
      };
    }),
  );
});

export const getReceipt = Effect.fn("posting.getReceipt")(function* (
  token: string,
  command: { scope: Scope; key: string },
) {
  return yield* withBook(token, command.scope, false, (transaction) =>
    Effect.gen(function* () {
      yield* Db.lockBookForShare(transaction, command.scope);
      const rows = yield* Db.readCommandReceipt(
        transaction,
        command.scope.bookId,
        command.key,
        "share",
      );
      const row = rows[0];
      if (!row || row.operation !== "execute_change") return yield* failure("NotFound");
      return yield* decode(ReceiptSchema, row.result);
    }),
  );
});

export type { ExecutionReceipt };
