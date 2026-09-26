import * as Accounting from "@open-erp/contracts/accounting";
import * as Owners from "@open-erp/contracts/owner-register";
import { canonicalizeJson } from "@open-erp/domain/canonicalization";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { digestJson, readEvidence } from "../../db/commerce/access";
import * as ControlDb from "../../db/owner-register/control-body";
import * as OwnerDb from "../../db/owner-register/register";
import * as Db from "../../db/posting";
import { databaseFailure, type Transaction } from "../../db/transaction";
import { failure } from "../failures";
import { withAdmittedPrincipal, type AuthorityLockMode, type VerifiedPrincipal } from "../identity";
import { isoNow, newId, replay, saveCommand, validatePlan } from "../posting";

type Scope = typeof Accounting.Scope.Type;
type Principal = VerifiedPrincipal;
type JsonObject = Schema.JsonObject;
type RecordReviewInput = typeof Owners.ReviewRecord.Type;
type AllocationApprovalInput = typeof Owners.ApproveAllocation.Type;
type CreateOwnerInput = typeof Owners.CreateOwner.Type;
type CreateRecordInput = typeof Owners.CreateRecord.Type;
type ReviseRecordInput = typeof Owners.ReviseRecord.Type;
type PrepareAllocationInput = typeof Owners.PrepareAllocation.Type;
type Capacity = typeof Owners.Capacity.Type;

const OwnerSchema = Owners.Owner;
const OwnerPageSchema = Owners.OwnerPage;
const RecordViewSchema = Owners.RecordView;
const RecordPageSchema = Owners.RecordPage;
const RecordHistorySchema = Owners.RecordHistory;
const ProposalLinkSchema = Owners.ProposalLink;
const PostedEffectSchema = Owners.PostedEffect;
const AllocationPlanSchema = Owners.AllocationPlan;
const AllocationReceiptSchema = Owners.AllocationReceipt;
const AllocationViewSchema = Owners.AllocationView;
const ControlSchema = Owners.Control;
const ControlViewSchema = Owners.ControlView;
const CommandRecoverySchema = Owners.CommandRecovery;

const ownerPageBound = 50;
const historyPageBound = 50;
const controlRecordBound = 1000;
const recoveryOperations: ReadonlyArray<string> = [
  "owners_create_owner",
  "owners_create_record",
  "owners_revise_record",
  "owners_review_record",
  "owners_attach_proposal",
  "owners_attach_posted_line",
  "owners_prepare_allocation",
  "owners_approve_allocation",
  "owners_apply_allocation",
  "owners_prepare_control",
];
const controlBlockers = [
  "Source coverage and complete opening balances are not established.",
  "Company accounting, statutory treatment and contribution repayment rights are not activated.",
];

function unsupported() {
  return failure("UnsupportedProfile");
}

function decode<A>(schema: Schema.Decoder<A>, value: JsonObject) {
  return Schema.decodeEffect(schema)(value).pipe(Effect.mapError(() => failure("InternalError")));
}

function toJsonObject(value: unknown) {
  return Schema.decodeUnknownEffect(Schema.JsonObject)(value).pipe(
    Effect.mapError(() => failure("InternalError")),
  );
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function textField(value: JsonObject | undefined, key: string) {
  const candidate = value?.[key];
  return typeof candidate === "string" ? candidate : undefined;
}

function scalarField(value: JsonObject | undefined, key: string) {
  const candidate = value?.[key];
  if (typeof candidate === "string") return candidate;
  return typeof candidate === "number" ? String(candidate) : undefined;
}

function objectField(value: JsonObject | undefined, key: string): JsonObject {
  const candidate = value?.[key];
  return isJsonObject(candidate) ? candidate : {};
}

function withoutKeys(value: JsonObject, keys: ReadonlyArray<string>): JsonObject {
  return Object.fromEntries(Object.entries(value).filter(([name]) => !keys.includes(name)));
}

function compareText(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function minor(value: string) {
  return BigInt(value);
}

function isCalendarDate(value: string) {
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
}

function requireTrimmed(value: string, max: number) {
  return value.length >= 1 && value.length <= max && value === value.trim()
    ? Effect.void
    : failure("InvalidJournal");
}

function sameJson(left: Schema.Json, right: Schema.Json) {
  const first = canonicalizeJson(left);
  const second = canonicalizeJson(right);
  if (Result.isFailure(first) || Result.isFailure(second)) return false;
  return first.success.json === second.success.json;
}

function digestValue(transaction: Transaction, value: Schema.Json) {
  return toJsonObject(value).pipe(
    Effect.flatMap((object) => digestJson(transaction, object)),
    Effect.flatMap((rows) => {
      const digest = rows[0]?.digest;
      return digest === undefined ? failure("InternalError") : Effect.succeed(digest);
    }),
  );
}

function merge(...sources: ReadonlyArray<JsonObject>): JsonObject {
  return Object.assign({}, ...sources);
}

function digestBody(transaction: Transaction, body: JsonObject) {
  return digestValue(transaction, body).pipe(Effect.map((digest) => merge(body, { digest })));
}

function recordMetadata(transaction: Transaction, key: string, operation: string, actorId: string) {
  return isoNow(transaction).pipe(
    Effect.map((createdAt): JsonObject => ({ createdAt, receipt: { key, operation, actorId } })),
  );
}

function withOwnerBook<A>(
  token: string,
  scope: Scope,
  operatorOnly: boolean,
  operation: (transaction: Transaction, principal: Principal) => Effect.Effect<A, unknown, never>,
  lockMode: AuthorityLockMode = "share",
) {
  return withAdmittedPrincipal(
    { token },
    scope,
    { operatorOnly },
    (transaction, principal) =>
      operation(transaction, principal).pipe(Effect.mapError(databaseFailure)),
    lockMode,
  );
}

function readBook(transaction: Transaction, scope: Scope) {
  return Effect.gen(function* () {
    const book = (yield* Db.readBook(transaction, scope))[0];
    if (book === undefined) return yield* failure("Forbidden");
    return book;
  });
}

function requireNativeProfile(book: { readonly profile: string; readonly authority: string }) {
  return book.profile === "synthetic-core-v1" && book.authority === "native"
    ? Effect.void
    : unsupported();
}

function requireOwnerAccess(transaction: Transaction, write: boolean) {
  return OwnerDb.readOwnerAccess(transaction).pipe(
    Effect.flatMap((rows) => {
      if (rows.length !== OwnerDb.ownerTables.length) return unsupported();
      const denied = rows.some((row) => {
        if (!row.canSelect) return true;
        if (!write) return false;
        return !row.canInsert && row.tableName !== "owner_records";
      });
      return denied ? unsupported() : Effect.void;
    }),
  );
}

function readEvidenceReference(transaction: Transaction, scope: Scope, evidenceId: string) {
  return readEvidence(transaction, scope.bookId, evidenceId).pipe(
    Effect.flatMap((rows) => {
      const row = rows[0];
      return row === undefined
        ? failure("MissingEvidence")
        : Effect.succeed({ evidenceId: row.id, sha256: row.sha256 });
    }),
  );
}

function readRecord(transaction: Transaction, scope: Scope, recordId: string) {
  return Effect.gen(function* () {
    const row = (yield* OwnerDb.readRecord(transaction, scope.bookId, recordId))[0];
    if (row === undefined) return yield* failure("NotFound");
    return row;
  });
}

function readRecordView(transaction: Transaction, scope: Scope, record: OwnerDb.RecordRow) {
  return Effect.gen(function* () {
    const revision = (yield* OwnerDb.readRevision(
      transaction,
      scope.bookId,
      record.id,
      record.currentRevision,
    ))[0];
    if (revision === undefined) return yield* failure("InternalError");
    const review = (yield* OwnerDb.readReviewByRevision(
      transaction,
      scope.bookId,
      record.id,
      record.currentRevision,
    ))[0];
    const effect = (yield* OwnerDb.readEffectByRecord(transaction, scope.bookId, record.id))[0];
    const links = yield* OwnerDb.listProposalLinks(transaction, scope.bookId, record.id);
    const usage =
      effect === undefined
        ? undefined
        : (yield* OwnerDb.readAllocationUsage(transaction, scope.bookId, effect.id))[0];
    const allocated = minor(usage?.total ?? "0");
    const blockers: Array<string> = [];
    if (textField(record.body, "dataNature") !== "synthetic_example") {
      blockers.push("Company accounting activation is not implemented; retained review only.");
    }
    if (review === undefined) {
      blockers.push("An exact operator classification review is required.");
    }
    if (
      textField(revision.body, "classification") === "unknown" ||
      textField(revision.body, "origin") === "unknown"
    ) {
      blockers.push("Classification or opening/current origin is unresolved.");
    }
    if (
      review !== undefined &&
      (textField(review.body, "controlAccountId") === undefined ||
        review.body.syntheticNoTaxConfirmed !== true)
    ) {
      blockers.push("Explicit synthetic treatment and control account are not confirmed.");
    }
    if (effect === undefined && blockers.length === 0 && review !== undefined) {
      blockers.push(
        ...(yield* ownerRequireReady(transaction, scope, record.id, review.id, true).pipe(
          Effect.match({ onFailure: (error) => [error.message], onSuccess: () => [] }),
        )),
      );
    }
    return yield* decode(RecordViewSchema, {
      source: record.body,
      currentRevision: revision.body,
      review: review === undefined ? null : review.body,
      effect: effect === undefined ? null : effect.body,
      proposals: links.map((link) => link.body),
      allocatedMinor: allocated.toString(),
      remainingMinor:
        effect === undefined ? null : (minor(record.amountMinor) - allocated).toString(),
      sourceCoverage: "unknown",
      blockers,
    });
  });
}

function readRecordViewById(transaction: Transaction, scope: Scope, recordId: string) {
  return readRecord(transaction, scope, recordId).pipe(
    Effect.flatMap((record) => readRecordView(transaction, scope, record)),
  );
}

function ownerRequireReady(
  transaction: Transaction,
  scope: Scope,
  recordId: string,
  reviewId: string,
  historical: boolean,
) {
  return Effect.gen(function* () {
    const record = yield* readRecord(transaction, scope, recordId);
    const revisionRow = (yield* OwnerDb.readRevision(
      transaction,
      scope.bookId,
      recordId,
      record.currentRevision,
    ))[0];
    if (revisionRow === undefined) return yield* failure("InternalError");
    const revisionDigest = textField(revisionRow.body, "digest");
    const book = yield* readBook(transaction, scope);
    const retained = yield* digestValue(transaction, {
      source: record.body,
      revision: withoutKeys(revisionRow.body, ["digest"]),
    });
    if (revisionDigest === undefined || retained !== revisionDigest) {
      return yield* failure("StaleDependency");
    }
    yield* requireNativeProfile(book);
    if (
      scalarField(record.body, "dataNature") !== "synthetic_example" ||
      scalarField(record.body, "currency") !== book.currency ||
      scalarField(record.body, "currencyScale") !== String(book.currencyScale)
    ) {
      return yield* unsupported();
    }
    const review = (yield* OwnerDb.readReviewById(transaction, scope.bookId, reviewId))[0];
    if (
      review === undefined ||
      review.recordId !== recordId ||
      review.revision !== record.currentRevision ||
      textField(review.body, "revisionDigest") !== revisionDigest ||
      textField(revisionRow.body, "classification") === "unknown" ||
      textField(revisionRow.body, "origin") === "unknown" ||
      review.body.syntheticNoTaxConfirmed !== true
    ) {
      return yield* failure("ApprovalRequired");
    }
    const postedReview =
      historical &&
      (yield* OwnerDb.readPostedReviewLink(transaction, scope.bookId, recordId, reviewId)).length >
        0;
    if (!postedReview) {
      if (
        (yield* Db.readOperatorMembership(transaction, scope.bookId, review.actorId)).length === 0
      ) {
        return yield* failure("ApprovalRequired");
      }
    }
    const controlAccountId = textField(review.body, "controlAccountId") ?? "";
    const account = (yield* Db.readAccounts(transaction, scope.bookId, [controlAccountId])).find(
      (row) => row.id === controlAccountId,
    );
    if (
      account === undefined ||
      (!postedReview &&
        (!account.active ||
          account.version.toString() !== textField(review.body, "accountVersion") ||
          book.profileVersion.toString() !== textField(review.body, "profileVersion") ||
          book.writerEpoch.toString() !== textField(review.body, "writerEpoch")))
    ) {
      return yield* failure("StaleDependency");
    }
    if (
      textField(revisionRow.body, "origin") === "opening" &&
      textField(record.body, "sourceKind") === "settlement"
    ) {
      return yield* unsupported();
    }
    return {
      digest: revisionDigest,
      revisionNumber: record.currentRevision,
      source: record.body,
      review: review.body,
    };
  });
}

function readCapacity(transaction: Transaction, scope: Scope, effectId: string) {
  return Effect.gen(function* () {
    const effect = (yield* OwnerDb.readEffectById(transaction, scope.bookId, effectId))[0];
    if (effect === undefined) return yield* failure("NotFound");
    const voucher = (yield* Db.readVoucher(transaction, scope.bookId, effect.voucherId))[0];
    const current =
      voucher !== undefined &&
      voucher.correctsVoucherId === null &&
      voucher.postingPurpose !== "reversal" &&
      (yield* Db.readVoucherByReversal(transaction, scope.bookId, voucher.id)).length === 0;
    if (!current) return yield* failure("StaleDependency");
    const usage = (yield* OwnerDb.readAllocationUsage(transaction, scope.bookId, effectId))[0];
    const allocated = minor(usage?.total ?? "0");
    if (allocated > minor(effect.amountMinor)) return yield* failure("StaleDependency");
    const capacity = yield* decode(Owners.Capacity, {
      effect: effect.body,
      allocatedMinor: allocated.toString(),
      remainingMinor: (minor(effect.amountMinor) - allocated).toString(),
      capacityVersion: usage?.legs ?? "0",
    });
    return capacity;
  });
}

function readVoucherCurrent(transaction: Transaction, scope: Scope, voucherId: string) {
  return Db.readVoucherByReversal(transaction, scope.bookId, voucherId).pipe(
    Effect.map((rows) => rows.length === 0),
  );
}

function readAllocationSelection(
  transaction: Transaction,
  scope: Scope,
  input: PrepareAllocationInput,
) {
  return Effect.gen(function* () {
    const book = yield* readBook(transaction, scope);
    yield* requireNativeProfile(book);
    yield* requireTrimmed(input.rationale, 2000);
    const settlement = yield* readCapacity(transaction, scope, input.settlementId);
    const settlementEffect = settlement.effect;
    if (
      (settlementEffect.classification !== "owner_reimbursement" &&
        settlementEffect.classification !== "loan_repayment") ||
      settlementEffect.side !== "debit"
    ) {
      return yield* failure("InvalidJournal");
    }
    const account = (yield* Db.readAccounts(transaction, scope.bookId, [
      settlementEffect.accountId,
    ])).find((row) => row.id === settlementEffect.accountId);
    if (account === undefined) return yield* failure("InternalError");
    if (!account.active) return yield* failure("StaleDependency");
    const voucher = (yield* Db.readVoucher(
      transaction,
      scope.bookId,
      settlementEffect.voucherId,
    ))[0];
    if (voucher === undefined) return yield* failure("InternalError");
    const period = (yield* Db.readPeriod(
      transaction,
      scope.bookId,
      textField(voucher.action, "accountingPeriodId") ?? "",
    ))[0];
    if (period === undefined) return yield* failure("InternalError");
    if (period.locked) return yield* failure("PeriodLocked");
    const expected =
      settlementEffect.classification === "owner_reimbursement"
        ? "owner_expense"
        : "shareholder_loan";
    const seen = new Set<string>();
    const legs: Array<JsonObject> = [];
    let total = 0n;
    for (const leg of input.allocations) {
      if (seen.has(leg.claimId)) return yield* failure("InvalidJournal");
      seen.add(leg.claimId);
      const amount = minor(leg.amountMinor);
      const claim: Capacity = yield* readCapacity(transaction, scope, leg.claimId);
      const claimEffect = claim.effect;
      if (
        claimEffect.classification !== expected ||
        claimEffect.side !== "credit" ||
        claimEffect.ownerId !== settlementEffect.ownerId ||
        claimEffect.accountId !== settlementEffect.accountId ||
        claimEffect.currency !== settlementEffect.currency ||
        claimEffect.currencyScale !== settlementEffect.currencyScale ||
        claimEffect.postingDate > settlementEffect.postingDate ||
        claimEffect.occurredOn > settlementEffect.occurredOn
      ) {
        return yield* failure("InvalidJournal");
      }
      if (amount > minor(claim.remainingMinor)) return yield* failure("StaleDependency");
      total += amount;
      legs.push(
        yield* toJsonObject({
          claim: yield* toJsonObject(claim),
          amountMinor: amount.toString(),
          remainingAfterMinor: (minor(claim.remainingMinor) - amount).toString(),
        }),
      );
    }
    if (total > minor(settlement.remainingMinor)) return yield* failure("StaleDependency");
    return {
      input,
      settlement,
      legs,
      totalMinor: total.toString(),
      settlementRemainingAfterMinor: (minor(settlement.remainingMinor) - total).toString(),
      evidence: yield* readEvidenceReference(transaction, scope, input.evidenceId),
      profileVersion: book.profileVersion.toString(),
      writerEpoch: book.writerEpoch.toString(),
      accountVersion: account.version.toString(),
      settlementPeriodVersion: period.version.toString(),
    };
  });
}

function readAllocationCurrent(transaction: Transaction, scope: Scope, plan: JsonObject) {
  return Effect.gen(function* () {
    if (
      (yield* digestValue(transaction, withoutKeys(plan, ["digest"]))) !== textField(plan, "digest")
    ) {
      return false;
    }
    const input = yield* decode(Owners.PrepareAllocation, objectField(plan, "input")).pipe(
      Effect.match({ onFailure: () => undefined, onSuccess: (value) => value }),
    );
    if (input === undefined) return false;
    const selected = yield* readAllocationSelection(transaction, scope, input).pipe(
      Effect.match({ onFailure: () => undefined, onSuccess: (value) => value }),
    );
    if (selected === undefined) return false;
    return sameJson(
      yield* toJsonObject(selected),
      withoutKeys(plan, ["id", "scope", "version", "digest", "createdAt", "receipt"]),
    );
  });
}

function validateOwnerLine(
  transaction: Transaction,
  scope: Scope,
  ready: { readonly source: JsonObject; readonly review: JsonObject },
  action: JsonObject,
  lineId: string,
) {
  return Effect.gen(function* () {
    const source = ready.source;
    const debit = textField(source, "sourceKind") === "settlement";
    if (
      textField(action, "postingPurpose") !== "adjustment" ||
      textField(action, "occurrenceKey") !== "manual_journal" ||
      action.correctsVoucherId !== null ||
      textField(action, "currency") !== textField(source, "currency") ||
      textField(action, "taxAssessment") !== "not_applicable" ||
      (textField(action, "postingDate") ?? "") < (textField(source, "occurredOn") ?? "")
    ) {
      return yield* failure("InvalidJournal");
    }
    const references = Array.isArray(action.evidenceRefs) ? action.evidenceRefs : [];
    const matched = references.some((reference) => {
      if (!isJsonObject(reference)) return false;
      return (
        textField(reference, "evidenceId") === textField(source, "evidenceId") &&
        textField(reference, "sha256") === textField(objectField(source, "evidence"), "sha256") &&
        textField(reference, "locator") === textField(source, "locator")
      );
    });
    if (!matched) return yield* failure("InvalidJournal");
    const eventId = textField(action, "eventId");
    const events = yield* Db.readEvent(
      transaction,
      scope.bookId,
      textField(source, "evidenceId") ?? "",
      textField(source, "locator") ?? "",
    );
    if (eventId === undefined || !events.some((event) => event.id === eventId)) {
      return yield* failure("InvalidJournal");
    }
    const lines = Array.isArray(action.lines) ? action.lines : [];
    const line = lines.find(
      (candidate) => isJsonObject(candidate) && textField(candidate, "lineId") === lineId,
    );
    if (
      line === undefined ||
      !isJsonObject(line) ||
      textField(line, "accountId") !== textField(ready.review, "controlAccountId") ||
      textField(line, debit ? "debitMinor" : "creditMinor") !== textField(source, "amountMinor") ||
      textField(line, debit ? "creditMinor" : "debitMinor") !== "0"
    ) {
      return yield* failure("InvalidJournal");
    }
    return line;
  });
}

export const createOwner = Effect.fn("owner.createOwner")(function* (
  token: string,
  command: { scope: Scope; idempotencyKey: string; input: CreateOwnerInput },
) {
  return yield* withOwnerBook(
    token,
    command.scope,
    false,
    (transaction, principal) =>
      Effect.gen(function* () {
        const payload = yield* toJsonObject(command.input);
        const request = yield* replay(
          transaction,
          command.scope,
          command.idempotencyKey,
          "owners_create_owner",
          principal.actorId,
          payload,
          OwnerSchema,
        );
        if (request.previous) return request.previous;
        yield* requireOwnerAccess(transaction, true);
        yield* Db.lockBookForUpdate(transaction, command.scope);
        yield* requireTrimmed(command.input.sourceKey, 200);
        yield* requireTrimmed(command.input.displayName, 200);
        yield* requireTrimmed(command.input.reason, 2000);
        const evidence = yield* readEvidenceReference(
          transaction,
          command.scope,
          command.input.evidenceId,
        );
        if (
          (yield* OwnerDb.readOwnerBySourceKey(
            transaction,
            command.scope.bookId,
            command.input.sourceKey,
          )).length > 0
        ) {
          return yield* failure("IdempotencyConflict");
        }
        const body = yield* digestBody(
          transaction,
          merge(
            yield* toJsonObject(command.input),
            { id: newId("owner"), scope: command.scope, evidence, legalIdentityVerified: false },
            yield* recordMetadata(
              transaction,
              command.idempotencyKey,
              "owners_create_owner",
              principal.actorId,
            ),
          ),
        );
        const owner = yield* decode(OwnerSchema, body);
        yield* OwnerDb.insertOwner(transaction, {
          bookId: command.scope.bookId,
          id: owner.id,
          sourceKey: command.input.sourceKey,
          evidenceId: command.input.evidenceId,
          body,
        });
        yield* saveCommand(
          transaction,
          command.scope,
          command.idempotencyKey,
          request.expected,
          "owners_create_owner",
          principal.actorId,
          owner,
        );
        return owner;
      }),
    "update",
  );
});

export const getOwner = Effect.fn("owner.getOwner")(function* (
  token: string,
  command: { scope: Scope; id: string },
) {
  return yield* withOwnerBook(token, command.scope, false, (transaction) =>
    Effect.gen(function* () {
      yield* requireOwnerAccess(transaction, false);
      yield* Db.lockBookForShare(transaction, command.scope);
      const row = (yield* OwnerDb.readOwner(transaction, command.scope.bookId, command.id))[0];
      if (row === undefined) return yield* failure("NotFound");
      return yield* decode(OwnerSchema, row.body);
    }),
  );
});

export const listOwners = Effect.fn("owner.listOwners")(function* (
  token: string,
  command: { scope: Scope; after?: string },
) {
  return yield* withOwnerBook(token, command.scope, false, (transaction) =>
    Effect.gen(function* () {
      yield* requireOwnerAccess(transaction, false);
      yield* Db.lockBookForShare(transaction, command.scope);
      const rows = yield* OwnerDb.listOwners(
        transaction,
        command.scope.bookId,
        command.after ?? "",
        ownerPageBound,
      );
      const items = yield* Effect.forEach(rows, (row) => decode(OwnerSchema, row.body));
      return yield* decode(OwnerPageSchema, {
        items,
        next: rows.length === ownerPageBound ? (rows.at(-1)?.id ?? null) : null,
      });
    }),
  );
});

function compatibleClassification(sourceKind: string, classification: string) {
  if (classification === "unknown") return true;
  if (sourceKind === "expense") return classification === "owner_expense";
  if (sourceKind === "funding") {
    return (
      classification === "shareholder_loan" ||
      classification === "conditional_contribution" ||
      classification === "unconditional_contribution"
    );
  }
  return classification === "owner_reimbursement" || classification === "loan_repayment";
}

function requireRevisionAssertion(assertion: {
  readonly sourceKind: string;
  readonly classification: string;
  readonly origin: string;
}) {
  return compatibleClassification(assertion.sourceKind, assertion.classification) &&
    ["unknown", "opening", "current"].includes(assertion.origin)
    ? Effect.void
    : failure("InvalidJournal");
}

export const createRecord = Effect.fn("owner.createRecord")(function* (
  token: string,
  command: { scope: Scope; idempotencyKey: string; input: CreateRecordInput },
) {
  return yield* withOwnerBook(
    token,
    command.scope,
    false,
    (transaction, principal) =>
      Effect.gen(function* () {
        const payload = yield* toJsonObject(command.input);
        const request = yield* replay(
          transaction,
          command.scope,
          command.idempotencyKey,
          "owners_create_record",
          principal.actorId,
          payload,
          RecordViewSchema,
        );
        if (request.previous) return request.previous;
        yield* requireOwnerAccess(transaction, true);
        yield* Db.lockBookForUpdate(transaction, command.scope);
        yield* requireTrimmed(command.input.sourceKey, 200);
        yield* requireTrimmed(command.input.description, 2000);
        yield* requireTrimmed(command.input.reason, 2000);
        if (
          !isCalendarDate(command.input.occurredOn) ||
          !/^[a-zA-Z0-9_-]{1,128}$/.test(command.input.locator)
        ) {
          return yield* failure("InvalidJournal");
        }
        const owner = (yield* OwnerDb.readOwner(
          transaction,
          command.scope.bookId,
          command.input.ownerId,
        ))[0];
        if (owner === undefined) return yield* failure("NotFound");
        if (textField(owner.body, "dataNature") !== command.input.dataNature) {
          return yield* failure("InvalidJournal");
        }
        yield* requireRevisionAssertion({
          sourceKind: command.input.sourceKind,
          classification: command.input.classification,
          origin: command.input.origin,
        });
        if (
          (yield* OwnerDb.readRecordIdsByOccurrence(
            transaction,
            command.scope.bookId,
            command.input.sourceKey,
            command.input.evidenceId,
            command.input.locator,
          )).length > 0
        ) {
          return yield* failure("IdempotencyConflict");
        }
        const evidence = yield* readEvidenceReference(
          transaction,
          command.scope,
          command.input.evidenceId,
        );
        const recordId = newId("owner_record");
        const metadata = yield* recordMetadata(
          transaction,
          command.idempotencyKey,
          "owners_create_record",
          principal.actorId,
        );
        const input = yield* toJsonObject(command.input);
        const source = merge(
          withoutKeys(input, ["description", "classification", "origin", "reason"]),
          {
            id: recordId,
            scope: command.scope,
            ownerName: textField(owner.body, "displayName") ?? "",
            evidence,
          },
          metadata,
        );
        const base = merge(
          {
            id: recordId,
            scope: command.scope,
            revision: "1",
            description: command.input.description,
            classification: command.input.classification,
            origin: command.input.origin,
            reason: command.input.reason,
            evidence,
          },
          metadata,
        );
        const revision = merge(base, {
          digest: yield* digestValue(transaction, { source, revision: base }),
        });
        yield* OwnerDb.insertRecord(transaction, {
          bookId: command.scope.bookId,
          id: recordId,
          ownerId: command.input.ownerId,
          sourceKey: command.input.sourceKey,
          evidenceId: command.input.evidenceId,
          locator: command.input.locator,
          occurredOn: command.input.occurredOn,
          amountMinor: command.input.amountMinor,
          body: source,
        });
        yield* OwnerDb.insertRevision(transaction, {
          bookId: command.scope.bookId,
          recordId,
          revision: "1",
          body: revision,
        });
        const result = yield* readRecordViewById(transaction, command.scope, recordId);
        yield* saveCommand(
          transaction,
          command.scope,
          command.idempotencyKey,
          request.expected,
          "owners_create_record",
          principal.actorId,
          result,
        );
        return result;
      }),
    "update",
  );
});

export const reviseRecord = Effect.fn("owner.reviseRecord")(function* (
  token: string,
  command: { scope: Scope; id: string; idempotencyKey: string; input: ReviseRecordInput },
) {
  return yield* withOwnerBook(
    token,
    command.scope,
    false,
    (transaction, principal) =>
      Effect.gen(function* () {
        const payload = yield* toJsonObject({ id: command.id, input: command.input });
        const request = yield* replay(
          transaction,
          command.scope,
          command.idempotencyKey,
          "owners_revise_record",
          principal.actorId,
          payload,
          RecordViewSchema,
        );
        if (request.previous) return request.previous;
        yield* requireOwnerAccess(transaction, true);
        yield* Db.lockBookForUpdate(transaction, command.scope);
        const record = yield* readRecord(transaction, command.scope, command.id);
        if (command.input.expectedRevision !== record.currentRevision) {
          return yield* failure("StaleDependency");
        }
        const effects = yield* OwnerDb.readEffectByRecord(
          transaction,
          command.scope.bookId,
          command.id,
        );
        const links = yield* OwnerDb.readProposalLinksByRecord(
          transaction,
          command.scope.bookId,
          command.id,
        );
        const posted = yield* Effect.forEach(links, (link) =>
          Db.readVoucherByChangeSet(transaction, command.scope.bookId, link.changeSetId),
        );
        if (effects.length > 0 || posted.some((rows) => rows.length > 0)) {
          return yield* failure("StaleDependency");
        }
        yield* requireTrimmed(command.input.description, 2000);
        yield* requireTrimmed(command.input.reason, 2000);
        yield* requireRevisionAssertion({
          sourceKind: textField(record.body, "sourceKind") ?? "",
          classification: command.input.classification,
          origin: command.input.origin,
        });
        const evidence = yield* readEvidenceReference(
          transaction,
          command.scope,
          command.input.evidenceId,
        );
        const next = (minor(record.currentRevision) + 1n).toString();
        const input = yield* toJsonObject(command.input);
        const base = merge(
          withoutKeys(input, ["expectedRevision", "evidenceId"]),
          { id: command.id, scope: command.scope, revision: next, evidence },
          yield* recordMetadata(
            transaction,
            command.idempotencyKey,
            "owners_revise_record",
            principal.actorId,
          ),
        );
        const revision = merge(base, {
          digest: yield* digestValue(transaction, { source: record.body, revision: base }),
        });
        yield* OwnerDb.insertRevision(transaction, {
          bookId: command.scope.bookId,
          recordId: command.id,
          revision: next,
          body: revision,
        });
        yield* OwnerDb.advanceRecordRevision(transaction, {
          bookId: command.scope.bookId,
          id: command.id,
          expectedRevision: record.currentRevision,
          nextRevision: next,
        });
        const result = yield* readRecordViewById(transaction, command.scope, command.id);
        yield* saveCommand(
          transaction,
          command.scope,
          command.idempotencyKey,
          request.expected,
          "owners_revise_record",
          principal.actorId,
          result,
        );
        return result;
      }),
    "update",
  );
});

export const getRecord = Effect.fn("owner.getRecord")(function* (
  token: string,
  command: { scope: Scope; id: string },
) {
  return yield* withOwnerBook(token, command.scope, false, (transaction) =>
    Effect.gen(function* () {
      yield* requireOwnerAccess(transaction, false);
      yield* Db.lockBookForShare(transaction, command.scope);
      return yield* readRecordViewById(transaction, command.scope, command.id);
    }),
  );
});

export const listRecords = Effect.fn("owner.listRecords")(function* (
  token: string,
  command: { scope: Scope; after?: string },
) {
  return yield* withOwnerBook(token, command.scope, false, (transaction) =>
    Effect.gen(function* () {
      yield* requireOwnerAccess(transaction, false);
      yield* Db.lockBookForShare(transaction, command.scope);
      const rows = yield* OwnerDb.listRecordIds(
        transaction,
        command.scope.bookId,
        command.after ?? "",
        ownerPageBound,
      );
      const items = yield* Effect.forEach(rows, (row) =>
        readRecordViewById(transaction, command.scope, row.id),
      );
      return yield* decode(RecordPageSchema, {
        items,
        next: rows.length === ownerPageBound ? (rows.at(-1)?.id ?? null) : null,
      });
    }),
  );
});

export const recordHistory = Effect.fn("owner.recordHistory")(function* (
  token: string,
  command: { scope: Scope; id: string; after?: string },
) {
  return yield* withOwnerBook(token, command.scope, false, (transaction) =>
    Effect.gen(function* () {
      yield* requireOwnerAccess(transaction, false);
      yield* Db.lockBookForShare(transaction, command.scope);
      void (yield* readRecordViewById(transaction, command.scope, command.id));
      const after = command.after ?? "";
      if (after !== "" && !/^[1-9][0-9]{0,17}$/.test(after)) {
        return yield* failure("InvalidJournal");
      }
      const retained = yield* OwnerDb.listRevisions(transaction, command.scope.bookId, command.id);
      const rows = retained.filter((row) => after === "" || minor(row.revision) > minor(after));
      const page = rows.slice(0, historyPageBound);
      const items = yield* Effect.forEach(page, (row) =>
        Effect.gen(function* () {
          const review = (yield* OwnerDb.readReviewByRevision(
            transaction,
            command.scope.bookId,
            command.id,
            row.revision,
          ))[0];
          return { revision: row.body, review: review === undefined ? null : review.body };
        }),
      );
      return yield* decode(RecordHistorySchema, {
        items,
        next: page.length === historyPageBound ? (page.at(-1)?.revision ?? null) : null,
      });
    }),
  );
});

export const attachProposal = Effect.fn("owner.attachProposal")(function* (
  token: string,
  command: {
    scope: Scope;
    id: string;
    idempotencyKey: string;
    input: typeof Owners.AttachProposal.Type;
  },
) {
  return yield* withOwnerBook(
    token,
    command.scope,
    false,
    (transaction, principal) =>
      Effect.gen(function* () {
        const payload = yield* toJsonObject({ id: command.id, input: command.input });
        const request = yield* replay(
          transaction,
          command.scope,
          command.idempotencyKey,
          "owners_attach_proposal",
          principal.actorId,
          payload,
          ProposalLinkSchema,
        );
        if (request.previous) return request.previous;
        yield* requireOwnerAccess(transaction, true);
        yield* Db.lockBookForUpdate(transaction, command.scope);
        const ready = yield* ownerRequireReady(
          transaction,
          command.scope,
          command.id,
          command.input.reviewId,
          false,
        );
        if (
          (yield* OwnerDb.readEffectByRecord(transaction, command.scope.bookId, command.id))
            .length > 0
        ) {
          return yield* failure("AlreadyPosted");
        }
        const planRow = (yield* Db.readPlan(
          transaction,
          command.scope.bookId,
          command.input.changeSetId,
        ))[0];
        if (planRow === undefined) return yield* failure("NotFound");
        const plan = yield* decode(Accounting.ChangeSet, planRow.plan);
        if (plan.groups.length !== 1 || plan.groups[0]?.actions.length !== 1) {
          return yield* unsupported();
        }
        yield* validatePlan(transaction, command.scope, plan);
        yield* validateOwnerLine(
          transaction,
          command.scope,
          ready,
          yield* toJsonObject(plan.groups[0]?.actions[0]),
          command.input.lineId,
        );
        const existing = yield* OwnerDb.readProposalLinksByRecord(
          transaction,
          command.scope.bookId,
          command.id,
        );
        const byChangeSet = yield* OwnerDb.readProposalLinksByChangeSet(
          transaction,
          command.scope.bookId,
          command.input.changeSetId,
        );
        if (
          existing.some((link) => link.changeSetId === command.input.changeSetId) ||
          byChangeSet.some((link) => link.lineId === command.input.lineId)
        ) {
          return yield* failure("IdempotencyConflict");
        }
        const body = yield* digestBody(
          transaction,
          merge(
            yield* toJsonObject(command.input),
            {
              id: newId("owner_proposal"),
              scope: command.scope,
              recordId: command.id,
              revision: ready.revisionNumber,
              revisionDigest: ready.digest,
              planDigest: plan.planDigest,
            },
            yield* recordMetadata(
              transaction,
              command.idempotencyKey,
              "owners_attach_proposal",
              principal.actorId,
            ),
          ),
        );
        const link = yield* decode(ProposalLinkSchema, body);
        yield* OwnerDb.insertProposalLink(transaction, {
          bookId: command.scope.bookId,
          id: link.id,
          recordId: command.id,
          reviewId: command.input.reviewId,
          changeSetId: command.input.changeSetId,
          lineId: command.input.lineId,
          body,
        });
        yield* saveCommand(
          transaction,
          command.scope,
          command.idempotencyKey,
          request.expected,
          "owners_attach_proposal",
          principal.actorId,
          link,
        );
        return link;
      }),
    "update",
  );
});

export const attachPostedLine = Effect.fn("owner.attachPostedLine")(function* (
  token: string,
  command: {
    scope: Scope;
    id: string;
    idempotencyKey: string;
    input: typeof Owners.AttachPostedLine.Type;
  },
) {
  return yield* withOwnerBook(
    token,
    command.scope,
    false,
    (transaction, principal) =>
      Effect.gen(function* () {
        const payload = yield* toJsonObject({ id: command.id, input: command.input });
        const request = yield* replay(
          transaction,
          command.scope,
          command.idempotencyKey,
          "owners_attach_posted_line",
          principal.actorId,
          payload,
          PostedEffectSchema,
        );
        if (request.previous) return request.previous;
        yield* requireOwnerAccess(transaction, true);
        yield* Db.lockBookForUpdate(transaction, command.scope);
        const ready = yield* ownerRequireReady(
          transaction,
          command.scope,
          command.id,
          command.input.reviewId,
          true,
        );
        const voucher = (yield* Db.readVoucher(
          transaction,
          command.scope.bookId,
          command.input.voucherId,
        ))[0];
        if (voucher === undefined) return yield* failure("NotFound");
        if (
          voucher.correctsVoucherId !== null ||
          voucher.postingPurpose === "reversal" ||
          !(yield* readVoucherCurrent(transaction, command.scope, voucher.id))
        ) {
          return yield* failure("StaleDependency");
        }
        const period = (yield* Db.readPeriod(
          transaction,
          command.scope.bookId,
          textField(voucher.action, "accountingPeriodId") ?? "",
        ))[0];
        if (period === undefined || period.locked) return yield* failure("PeriodLocked");
        const links = yield* OwnerDb.readPostedProposalLink(
          transaction,
          command.scope.bookId,
          command.id,
          voucher.changeSetId,
        );
        if (
          links.some(
            (link) =>
              link.reviewId !== command.input.reviewId ||
              link.lineId !== command.input.lineId ||
              textField(link.body, "revisionDigest") !== ready.digest,
          )
        ) {
          return yield* failure("StaleDependency");
        }
        yield* validateOwnerLine(
          transaction,
          command.scope,
          ready,
          voucher.action,
          command.input.lineId,
        );
        const amountMinor = textField(ready.source, "amountMinor") ?? "0";
        const line = (yield* OwnerDb.readJournalLine(
          transaction,
          command.scope.bookId,
          voucher.id,
          command.input.lineId,
        ))[0];
        if (
          line === undefined ||
          line.accountId !== textField(ready.review, "controlAccountId") ||
          minor(line.debitMinor) + minor(line.creditMinor) !== minor(amountMinor)
        ) {
          return yield* failure("InvalidJournal");
        }
        const effects = yield* OwnerDb.readEffectByRecord(
          transaction,
          command.scope.bookId,
          command.id,
        );
        const sameLine = yield* OwnerDb.readEffectByLine(
          transaction,
          command.scope.bookId,
          voucher.id,
          line.id,
        );
        if (effects.length > 0 || sameLine.length > 0) return yield* failure("AlreadyPosted");
        const body = yield* digestBody(
          transaction,
          merge(
            yield* toJsonObject(command.input),
            {
              id: newId("owner_effect"),
              scope: command.scope,
              recordId: command.id,
              ownerId: textField(ready.source, "ownerId") ?? "",
              revisionDigest: ready.digest,
              accountId: line.accountId,
              postingDate: voucher.postingDate,
              occurredOn: textField(ready.source, "occurredOn") ?? "",
              locator: textField(ready.source, "locator") ?? "",
              eventId: voucher.eventId,
              changeSetId: voucher.changeSetId,
              classification: textField(ready.review, "classification") ?? "",
              origin: textField(ready.review, "origin") ?? "",
              side: minor(line.debitMinor) > 0n ? "debit" : "credit",
              amountMinor,
              currency: textField(ready.source, "currency") ?? "",
              currencyScale: ready.source["currencyScale"] ?? null,
              evidence: objectField(ready.source, "evidence"),
            },
            yield* recordMetadata(
              transaction,
              command.idempotencyKey,
              "owners_attach_posted_line",
              principal.actorId,
            ),
          ),
        );
        const effect = yield* decode(PostedEffectSchema, body);
        yield* OwnerDb.insertEffect(transaction, {
          bookId: command.scope.bookId,
          id: effect.id,
          recordId: command.id,
          ownerId: effect.ownerId,
          reviewId: command.input.reviewId,
          voucherId: voucher.id,
          lineId: line.id,
          accountId: line.accountId,
          postingDate: voucher.postingDate,
          side: effect.side,
          classification: effect.classification,
          origin: effect.origin,
          amountMinor: effect.amountMinor,
          body,
        });
        yield* saveCommand(
          transaction,
          command.scope,
          command.idempotencyKey,
          request.expected,
          "owners_attach_posted_line",
          principal.actorId,
          effect,
        );
        return effect;
      }),
    "update",
  );
});

export const prepareAllocation = Effect.fn("owner.prepareAllocation")(function* (
  token: string,
  command: { scope: Scope; idempotencyKey: string; input: PrepareAllocationInput },
) {
  return yield* withOwnerBook(
    token,
    command.scope,
    false,
    (transaction, principal) =>
      Effect.gen(function* () {
        const payload = yield* toJsonObject(command.input);
        const request = yield* replay(
          transaction,
          command.scope,
          command.idempotencyKey,
          "owners_prepare_allocation",
          principal.actorId,
          payload,
          AllocationPlanSchema,
        );
        if (request.previous) return request.previous;
        yield* requireOwnerAccess(transaction, true);
        yield* Db.lockBookForUpdate(transaction, command.scope);
        const selection = yield* readAllocationSelection(transaction, command.scope, command.input);
        const body = yield* digestBody(
          transaction,
          merge(
            yield* toJsonObject(selection),
            { id: newId("allocation"), scope: command.scope, version: 1 },
            yield* recordMetadata(
              transaction,
              command.idempotencyKey,
              "owners_prepare_allocation",
              principal.actorId,
            ),
          ),
        );
        const plan = yield* decode(AllocationPlanSchema, body);
        yield* OwnerDb.insertAllocationPlan(transaction, {
          bookId: command.scope.bookId,
          id: plan.id,
          body,
        });
        yield* saveCommand(
          transaction,
          command.scope,
          command.idempotencyKey,
          request.expected,
          "owners_prepare_allocation",
          principal.actorId,
          plan,
        );
        return plan;
      }),
    "update",
  );
});

export const getAllocation = Effect.fn("owner.getAllocation")(function* (
  token: string,
  command: { scope: Scope; id: string },
) {
  return yield* withOwnerBook(token, command.scope, false, (transaction) =>
    Effect.gen(function* () {
      yield* requireOwnerAccess(transaction, false);
      yield* Db.lockBookForShare(transaction, command.scope);
      const retained = (yield* OwnerDb.readAllocationPlan(
        transaction,
        command.scope.bookId,
        command.id,
      ))[0];
      if (retained === undefined) return yield* failure("NotFound");
      const approval = (yield* OwnerDb.readLatestApprovalForPlan(
        transaction,
        command.scope.bookId,
        command.id,
      ))[0];
      const receipt = (yield* OwnerDb.readReceiptForPlan(
        transaction,
        command.scope.bookId,
        command.id,
      ))[0];
      return yield* decode(AllocationViewSchema, {
        plan: yield* decode(AllocationPlanSchema, retained.body),
        dependenciesCurrent: yield* readAllocationCurrent(
          transaction,
          command.scope,
          retained.body,
        ),
        approval: approval === undefined ? null : approval.body,
        application: receipt === undefined ? null : receipt.body,
      });
    }),
  );
});

export const applyAllocation = Effect.fn("owner.applyAllocation")(function* (
  token: string,
  command: {
    scope: Scope;
    id: string;
    idempotencyKey: string;
    input: typeof Owners.ApplyAllocation.Type;
  },
) {
  return yield* withOwnerBook(
    token,
    command.scope,
    false,
    (transaction, principal) =>
      Effect.gen(function* () {
        const payload = yield* toJsonObject({ id: command.id, input: command.input });
        const request = yield* replay(
          transaction,
          command.scope,
          command.idempotencyKey,
          "owners_apply_allocation",
          principal.actorId,
          payload,
          AllocationReceiptSchema,
        );
        if (request.previous) return request.previous;
        yield* requireOwnerAccess(transaction, true);
        yield* Db.lockBookForUpdate(transaction, command.scope);
        const retained = (yield* OwnerDb.readAllocationPlan(
          transaction,
          command.scope.bookId,
          command.id,
        ))[0];
        if (retained === undefined) return yield* failure("NotFound");
        if (
          (yield* OwnerDb.readReceiptForPlan(transaction, command.scope.bookId, command.id))
            .length > 0
        ) {
          return yield* failure("IdempotencyConflict");
        }
        const plan = yield* decode(AllocationPlanSchema, retained.body);
        if (
          command.input.planDigest !== plan.digest ||
          !(yield* readAllocationCurrent(transaction, command.scope, retained.body))
        ) {
          return yield* failure("StaleDependency");
        }
        const approval = (yield* OwnerDb.readApproval(
          transaction,
          command.scope.bookId,
          command.input.approvalId,
        ))[0];
        const now = yield* isoNow(transaction);
        if (
          approval === undefined ||
          approval.planId !== command.id ||
          approval.digest !== plan.digest ||
          approval.consumed === true ||
          approval.expiresAt <= now
        ) {
          return yield* failure("ApprovalRequired");
        }
        if (
          (yield* Db.readOperatorMembership(transaction, command.scope.bookId, approval.actorId))
            .length === 0
        ) {
          return yield* failure("ApprovalRequired");
        }
        const body = yield* toJsonObject({
          id: newId("allocation_receipt"),
          scope: command.scope,
          planId: command.id,
          planDigest: plan.digest,
          approvalId: approval.id,
          totalMinor: plan.totalMinor,
          settlementRemainingMinor: plan.settlementRemainingAfterMinor,
          committedAt: now,
          receipt: {
            key: command.idempotencyKey,
            operation: "owners_apply_allocation",
            actorId: principal.actorId,
          },
        });
        const receipt = yield* decode(AllocationReceiptSchema, body);
        yield* OwnerDb.insertReceipt(transaction, {
          bookId: command.scope.bookId,
          id: receipt.id,
          planId: command.id,
          approvalId: approval.id,
          body,
        });
        yield* OwnerDb.insertAllocationLegs(
          transaction,
          plan.legs.map((leg, index) => ({
            bookId: command.scope.bookId,
            receiptId: receipt.id,
            ordinal: index + 1,
            claimId: leg.claim.effect.id,
            settlementId: plan.settlement.effect.id,
            amountMinor: leg.amountMinor,
          })),
        );
        yield* saveCommand(
          transaction,
          command.scope,
          command.idempotencyKey,
          request.expected,
          "owners_apply_allocation",
          principal.actorId,
          receipt,
        );
        return receipt;
      }),
    "update",
  );
});

function ownerMovements(effects: ReadonlyArray<OwnerDb.EffectRow>, startsOn: string) {
  const groups = new Map<
    string,
    {
      accountId: string;
      classification: string;
      opening: bigint;
      prior: bigint;
      movement: bigint;
      closing: bigint;
    }
  >();
  for (const effect of effects) {
    const key = `${effect.accountId} ${effect.classification}`;
    const signed =
      effect.side === "credit" ? minor(effect.amountMinor) : -minor(effect.amountMinor);
    const group = groups.get(key) ?? {
      accountId: effect.accountId,
      classification: effect.classification,
      opening: 0n,
      prior: 0n,
      movement: 0n,
      closing: 0n,
    };
    if (effect.origin === "opening") group.opening += signed;
    if (effect.origin === "current" && effect.postingDate < startsOn) group.prior += signed;
    if (effect.origin === "current" && effect.postingDate >= startsOn) group.movement += signed;
    group.closing += signed;
    groups.set(key, group);
  }
  return Effect.forEach(
    [...groups.values()].sort(
      (left, right) =>
        compareText(left.accountId, right.accountId) ||
        compareText(left.classification, right.classification),
    ),
    (group) =>
      toJsonObject({
        accountId: group.accountId,
        classification: group.classification,
        registeredOpeningMinor: group.opening.toString(),
        priorCurrentMinor: group.prior.toString(),
        currentMovementMinor: group.movement.toString(),
        recordedClosingMinor: group.closing.toString(),
      }),
  );
}

function accountControls(
  transaction: Transaction,
  scope: Scope,
  accountIds: ReadonlyArray<string>,
  endsOn: string,
  ledger: ReadonlyArray<OwnerDb.LedgerBalanceRow>,
) {
  return Effect.gen(function* () {
    const ledgerById = new Map(ledger.map((row) => [row.accountId, row]));
    const registered = new Map(
      (yield* ControlDb.readRegisteredAccounts(transaction, scope.bookId, accountIds, endsOn)).map(
        (row) => [row.accountId, row],
      ),
    );
    const controls: Array<JsonObject> = [];
    for (const accountId of accountIds) {
      const retained = registered.get(accountId);
      if (retained === undefined) return yield* failure("InternalError");
      const ledgerAmount = minor(ledgerById.get(accountId)?.amount ?? "0");
      const registeredAmount = minor(retained.amount);
      controls.push(
        yield* toJsonObject({
          accountId,
          allOwnersRegisteredMinor: registeredAmount.toString(),
          allOwnersEffectsDigest: retained.digest,
          ledgerCreditBalanceMinor: ledgerAmount.toString(),
          unexplainedMinor: (ledgerAmount - registeredAmount).toString(),
          ledgerSequence: ledgerById.get(accountId)?.sequence ?? "0",
        }),
      );
    }
    return controls;
  });
}

function ownerBalances(
  effects: ReadonlyArray<OwnerDb.EffectRow>,
  legs: ReadonlyArray<OwnerDb.AllocationLegRow>,
) {
  const allocatedByEffect = new Map<string, bigint>();
  for (const leg of legs) {
    for (const effectId of [leg.claimId, leg.settlementId]) {
      allocatedByEffect.set(
        effectId,
        (allocatedByEffect.get(effectId) ?? 0n) + minor(leg.amountMinor),
      );
    }
  }
  const groups = new Map<
    string,
    {
      accountId: string;
      net: bigint;
      expense: bigint;
      loan: bigint;
      reimbursement: bigint;
      repayment: bigint;
      conditional: bigint;
      unconditional: bigint;
    }
  >();
  for (const effect of effects) {
    const amount = minor(effect.amountMinor);
    const open = amount - (allocatedByEffect.get(effect.id) ?? 0n);
    const group = groups.get(effect.accountId) ?? {
      accountId: effect.accountId,
      net: 0n,
      expense: 0n,
      loan: 0n,
      reimbursement: 0n,
      repayment: 0n,
      conditional: 0n,
      unconditional: 0n,
    };
    group.net += effect.side === "credit" ? amount : -amount;
    if (effect.classification === "owner_expense") group.expense += open;
    if (effect.classification === "shareholder_loan") group.loan += open;
    if (effect.classification === "owner_reimbursement") group.reimbursement += open;
    if (effect.classification === "loan_repayment") group.repayment += open;
    if (effect.classification === "conditional_contribution") group.conditional += amount;
    if (effect.classification === "unconditional_contribution") group.unconditional += amount;
    groups.set(effect.accountId, group);
  }
  return Effect.forEach(
    [...groups.values()].sort((left, right) => compareText(left.accountId, right.accountId)),
    (group) =>
      toJsonObject({
        accountId: group.accountId,
        recordedNetCreditMinor: group.net.toString(),
        openExpenseMinor: group.expense.toString(),
        openLoanMinor: group.loan.toString(),
        unappliedReimbursementMinor: group.reimbursement.toString(),
        unappliedLoanRepaymentMinor: group.repayment.toString(),
        conditionalContributionMinor: group.conditional.toString(),
        unconditionalContributionMinor: group.unconditional.toString(),
      }),
  );
}

function readRetainedRecords(
  transaction: Transaction,
  scope: Scope,
  ownerId: string,
  endsOn: string,
) {
  return Effect.gen(function* () {
    const retained = (yield* ControlDb.readControlRecords(
      transaction,
      scope.bookId,
      ownerId,
      endsOn,
    ))[0];
    if (retained === undefined) return yield* failure("InternalError");
    return {
      recordCount: retained.recordCount,
      views: yield* Effect.forEach(retained.records, (record) => toJsonObject(record)),
      unlinked: retained.unlinkedCount,
    };
  });
}

function requireOwnerCurrency(
  effects: ReadonlyArray<OwnerDb.EffectRow>,
  book: { readonly currency: string; readonly currencyScale: number },
) {
  const mixed = effects.some(
    (effect) =>
      scalarField(effect.body, "currency") !== book.currency ||
      scalarField(effect.body, "currencyScale") !== String(book.currencyScale),
  );
  return mixed ? unsupported() : Effect.void;
}

export const controlBody = Effect.fn("owner.controlBody")(function* (
  transaction: Transaction,
  scope: Scope,
  ownerId: string,
  startsOn: string,
  endsOn: string,
) {
  yield* requireOwnerAccess(transaction, false);
  const book = yield* readBook(transaction, scope);
  const bookEffects = yield* OwnerDb.listEffects(transaction, scope.bookId, null, endsOn);
  yield* requireOwnerCurrency(bookEffects, book);
  if (!isCalendarDate(startsOn) || !isCalendarDate(endsOn) || startsOn > endsOn) {
    return yield* failure("InvalidJournal");
  }
  const owner = (yield* OwnerDb.readOwner(transaction, scope.bookId, ownerId))[0];
  if (owner === undefined) return yield* failure("NotFound");
  const retained = yield* readRetainedRecords(transaction, scope, ownerId, endsOn);
  if (retained.recordCount > controlRecordBound) return yield* failure("InvalidJournal");
  const effects = yield* OwnerDb.listEffects(transaction, scope.bookId, ownerId, endsOn);
  const legs = yield* OwnerDb.listAllocationLegs(transaction, scope.bookId, ownerId, endsOn);
  const allocations = yield* Effect.forEach(legs, (leg) =>
    toJsonObject({
      receiptId: leg.receiptId,
      ordinal: leg.ordinal,
      claimId: leg.claimId,
      settlementId: leg.settlementId,
      amountMinor: leg.amountMinor,
    }),
  );
  const accountIds = [...new Set(effects.map((effect) => effect.accountId))].sort(compareText);
  const controls = yield* accountControls(
    transaction,
    scope,
    accountIds,
    endsOn,
    yield* OwnerDb.readLedgerBalances(transaction, scope.bookId, accountIds, endsOn),
  );
  return {
    owner: owner.body,
    currency: book.currency,
    currencyScale: book.currencyScale,
    startsOn,
    endsOn,
    sourceCoverage: "unknown",
    openingBalanceMinor: null,
    unlinkedRecordCount: retained.unlinked,
    records: retained.views,
    effects: effects.map((effect) => effect.body),
    allocations,
    ownerBalances: yield* ownerBalances(effects, legs),
    movements: yield* ownerMovements(effects, startsOn),
    accountControls: controls,
    blockers: controlBlockers,
  };
});

export const prepareControl = Effect.fn("owner.prepareControl")(function* (
  token: string,
  command: { scope: Scope; idempotencyKey: string; input: typeof Owners.PrepareControl.Type },
) {
  return yield* withOwnerBook(
    token,
    command.scope,
    false,
    (transaction, principal) =>
      Effect.gen(function* () {
        const payload = yield* toJsonObject(command.input);
        const request = yield* replay(
          transaction,
          command.scope,
          command.idempotencyKey,
          "owners_prepare_control",
          principal.actorId,
          payload,
          ControlSchema,
        );
        if (request.previous) return request.previous;
        yield* requireOwnerAccess(transaction, true);
        yield* Db.lockBookForUpdate(transaction, command.scope);
        const body = yield* controlBody(
          transaction,
          command.scope,
          command.input.ownerId,
          command.input.startsOn,
          command.input.endsOn,
        );
        const snapshot = yield* digestBody(
          transaction,
          merge(
            yield* toJsonObject(body),
            { id: newId("owner_control"), scope: command.scope, version: 1 },
            yield* recordMetadata(
              transaction,
              command.idempotencyKey,
              "owners_prepare_control",
              principal.actorId,
            ),
          ),
        );
        const control = yield* decode(ControlSchema, snapshot);
        yield* OwnerDb.insertControl(transaction, {
          bookId: command.scope.bookId,
          id: control.id,
          body: snapshot,
        });
        yield* saveCommand(
          transaction,
          command.scope,
          command.idempotencyKey,
          request.expected,
          "owners_prepare_control",
          principal.actorId,
          control,
        );
        return control;
      }),
    "update",
  );
});

export const getControl = Effect.fn("owner.getControl")(function* (
  token: string,
  command: { scope: Scope; id: string },
) {
  return yield* withOwnerBook(token, command.scope, false, (transaction) =>
    Effect.gen(function* () {
      yield* requireOwnerAccess(transaction, false);
      yield* Db.lockBookForShare(transaction, command.scope);
      const retained = (yield* OwnerDb.readControl(
        transaction,
        command.scope.bookId,
        command.id,
      ))[0];
      if (retained === undefined) return yield* failure("NotFound");
      const current_ = controlBody(
        transaction,
        command.scope,
        textField(objectField(retained.body, "owner"), "id") ?? "",
        textField(retained.body, "startsOn") ?? "",
        textField(retained.body, "endsOn") ?? "",
      );
      const body = yield* Effect.match(current_, {
        onFailure: () => undefined,
        onSuccess: (value) => value,
      });
      const current = body === undefined ? null : yield* toJsonObject(body);
      const intact =
        (yield* digestValue(transaction, withoutKeys(retained.body, ["digest"]))) ===
        textField(retained.body, "digest");
      const matches =
        current !== null &&
        sameJson(
          current,
          withoutKeys(retained.body, ["id", "scope", "version", "createdAt", "receipt", "digest"]),
        );
      return yield* decode(ControlViewSchema, {
        snapshot: yield* decode(ControlSchema, retained.body),
        current: intact && matches,
      });
    }),
  );
});

export const recoverCommand = Effect.fn("owner.recoverCommand")(function* (
  token: string,
  command: { scope: Scope; key: string },
) {
  return yield* withOwnerBook(token, command.scope, false, (transaction, principal) =>
    Effect.gen(function* () {
      yield* requireOwnerAccess(transaction, false);
      yield* Db.lockBookForShare(transaction, command.scope);
      const receipt = (yield* Db.readCommandReceipt(
        transaction,
        command.scope.bookId,
        command.key,
        "update",
      )).find(
        (row) => row.actorId === principal.actorId && recoveryOperations.includes(row.operation),
      );
      if (receipt === undefined) return yield* failure("NotFound");
      return yield* decode(CommandRecoverySchema, {
        operation: receipt.operation,
        result: receipt.result,
      });
    }),
  );
});

export const reviewRecord = Effect.fn("owner.reviewRecord")(function* (
  token: string,
  command: { scope: Scope; id: string; idempotencyKey: string; input: RecordReviewInput },
) {
  return yield* withOwnerBook(
    token,
    command.scope,
    true,
    (transaction, principal) =>
      Effect.gen(function* () {
        const operation = "owners_review_record";
        const request = yield* replay(
          transaction,
          command.scope,
          command.idempotencyKey,
          operation,
          principal.actorId,
          yield* toJsonObject({ id: command.id, input: command.input }),
          Owners.Review,
        );
        if (request.previous) return request.previous;
        yield* requireOwnerAccess(transaction, true);
        const record = yield* readRecord(transaction, command.scope, command.id);
        const stored = (yield* OwnerDb.readRevision(
          transaction,
          command.scope.bookId,
          record.id,
          record.currentRevision,
        ))[0];
        if (!stored) return yield* failure("InternalError");
        const revision = yield* decode(Owners.Revision, stored.body);
        if (
          command.input.expectedRevision !== record.currentRevision ||
          command.input.revisionDigest !== revision.digest
        )
          return yield* failure("StaleDependency");
        if (
          (yield* OwnerDb.readReviewByRevision(
            transaction,
            command.scope.bookId,
            record.id,
            record.currentRevision,
          )).length > 0
        )
          return yield* failure("IdempotencyConflict");
        yield* requireTrimmed(command.input.reason, 2000);
        if (
          command.input.syntheticNoTaxConfirmed &&
          record.body.dataNature !== "synthetic_example"
        ) {
          return yield* unsupported();
        }
        const book = yield* readBook(transaction, command.scope);
        const accountId = command.input.controlAccountId;
        const account =
          accountId === null
            ? undefined
            : (yield* Db.readAccounts(transaction, command.scope.bookId, [accountId]))[0];
        if (accountId !== null && !account?.active) return yield* failure("InvalidJournal");
        if (account)
          yield* OwnerDb.insertControlAccount(transaction, command.scope.bookId, account.id);
        const body = merge(
          withoutKeys(yield* toJsonObject(command.input), ["expectedRevision", "evidenceId"]),
          {
            id: newId("owner_review"),
            scope: command.scope,
            recordId: record.id,
            revision: record.currentRevision,
            classification: revision.classification,
            origin: revision.origin,
            accountVersion: account?.version.toString() ?? null,
            profileVersion: book.profileVersion.toString(),
            writerEpoch: book.writerEpoch.toString(),
            evidence: yield* readEvidenceReference(
              transaction,
              command.scope,
              command.input.evidenceId,
            ),
          },
          yield* recordMetadata(transaction, command.idempotencyKey, operation, principal.actorId),
        );
        const result = yield* decode(Owners.Review, body);
        yield* OwnerDb.insertReview(transaction, {
          bookId: command.scope.bookId,
          id: result.id,
          recordId: record.id,
          revision: record.currentRevision,
          actorId: principal.actorId,
          body,
        });
        yield* saveCommand(
          transaction,
          command.scope,
          command.idempotencyKey,
          request.expected,
          operation,
          principal.actorId,
          result,
        );
        return result;
      }),
    "update",
  );
});

export const approveAllocation = Effect.fn("owner.approveAllocation")(function* (
  token: string,
  command: { scope: Scope; id: string; idempotencyKey: string; input: AllocationApprovalInput },
) {
  return yield* withOwnerBook(
    token,
    command.scope,
    true,
    (transaction, principal) =>
      Effect.gen(function* () {
        const operation = "owners_approve_allocation";
        const request = yield* replay(
          transaction,
          command.scope,
          command.idempotencyKey,
          operation,
          principal.actorId,
          yield* toJsonObject({ id: command.id, input: command.input }),
          Owners.AllocationApproval,
        );
        if (request.previous) return request.previous;
        yield* requireOwnerAccess(transaction, true);
        const row = (yield* OwnerDb.readAllocationPlan(
          transaction,
          command.scope.bookId,
          command.id,
        ))[0];
        if (!row) return yield* failure("NotFound");
        const plan = yield* decode(AllocationPlanSchema, row.body);
        if (
          command.input.version !== 1 ||
          command.input.planDigest !== plan.digest ||
          !(yield* readAllocationCurrent(transaction, command.scope, row.body))
        ) {
          return yield* failure("StaleDependency");
        }
        if (
          (yield* OwnerDb.readReceiptForPlan(transaction, command.scope.bookId, command.id))
            .length > 0
        ) {
          return yield* failure("IdempotencyConflict");
        }
        const result = yield* decode(Owners.AllocationApproval, {
          id: newId("allocation_approval"),
          planId: command.id,
          planDigest: plan.digest,
          actorId: principal.actorId,
          expiresAt: new Date(Date.parse(yield* isoNow(transaction)) + 3_600_000).toISOString(),
          receipt: { key: command.idempotencyKey, operation, actorId: principal.actorId },
        });
        yield* OwnerDb.insertApproval(transaction, {
          bookId: command.scope.bookId,
          id: result.id,
          planId: result.planId,
          actorId: principal.actorId,
          digest: result.planDigest,
          expiresAt: result.expiresAt,
          body: result,
        });
        yield* saveCommand(
          transaction,
          command.scope,
          command.idempotencyKey,
          request.expected,
          operation,
          principal.actorId,
          result,
        );
        return result;
      }),
    "update",
  );
});
