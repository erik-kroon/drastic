import { runBookCommandWithReceipt } from "../book-commands";
import { runBookCommand } from "../book-commands";
import { bankRowSubjects } from "./subjects";
import {
  citedSuggestions,
  inheritedSuggestionIds,
  recordDecision,
  type Comparison,
} from "../decision-provenance";
import * as AssetDisposals from "@open-erp/contracts/asset-disposals";
import * as LedgerDb from "../../db/posting";
import * as ForeignCashDb from "../../db/banking/foreign-cash";
import { admitBankMatch } from "../resource-admission";
import { readClaim } from "../../db/purchases/supplier-settlements";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Settlement from "@open-erp/contracts/settlements";
import * as Effect from "effect/Effect";
import type * as Schema from "effect/Schema";
import { failure } from "../failures";
import { digest } from "../json";
import { isoNow } from "../command-receipts";
import { newId } from "../identifiers";
import * as AllocationDb from "../../db/banking/allocations";
import * as BankDb from "../../db/banking/shared";
import * as StatementDb from "../../db/banking/statements";
import type { Transaction } from "../../db/transaction";
import * as Shared from "./shared";

type Scope = typeof Accounting.Scope.Type;

type JsonObject = Schema.JsonObject;

const PlanSchema = Settlement.BankAllocationPlan;

const ApprovalSchema = Settlement.BankAllocationApproval;

const ExecutionSchema = Settlement.BankAllocationExecution;

const ViewSchema = Settlement.BankAllocationView;

const allocationTables = [
  "books",
  "accounts",
  "bank_sources",
  "bank_statements",
  "bank_observations",
  "bank_matches",
  "bank_active_matches",
  "bank_active_allocation_legs",
  "bank_allocation_plans",
  "bank_allocation_approvals",
  "bank_allocation_executions",
  "bank_match_reversals",
  "memberships",
  "journal_lines",
  "vouchers",
  "command_receipts",
];

const approvalWindowMs = 60 * 60 * 1000;

const maximumLegs = 100;

const maximumCandidateLines = 1000;

function lockBook(transaction: Transaction, bookId: string) {
  return BankDb.lockBook(transaction, bookId, "update").pipe(
    Effect.flatMap((rows) => {
      const book = rows[0];

      return book ? Effect.succeed(book) : failure("Forbidden");
    }),
  );
}

type CapacityGroup = { requested: bigint; capacity: bigint; used: bigint };

function groupCapacity(
  groups: Map<string, CapacityGroup>,
  key: string,
  amount: bigint,
  total: bigint,
  allocated: bigint,
) {
  const existing = groups.get(key);

  const capacity = Shared.absolute(total);

  const used = Shared.absolute(allocated);

  if (existing === undefined) {
    groups.set(key, { requested: amount, capacity, used });

    return;
  }

  existing.requested += amount;

  if (capacity > existing.capacity) existing.capacity = capacity;

  if (used > existing.used) existing.used = used;
}

function withinCapacity(groups: ReadonlyMap<string, CapacityGroup>) {
  return [...groups.values()].every(
    (group) => Shared.absolute(group.requested) + group.used <= group.capacity,
  );
}

// Frozen exact capacity for each explicit leg. Amounts stay in minor units and
// are never rounded, so a leg can never consume more source or line capacity
// than the retained statement and posted ledger actually carry.
function allocationSnapshot(
  transaction: Transaction,
  bookId: string,
  input: typeof Settlement.PrepareBankAllocation.Type,
) {
  return Effect.gen(function* () {
    const account = (yield* BankDb.readAccount(transaction, bookId, input.accountId))[0];

    if (!account?.active) return yield* failure("StaleDependency");

    const versions = (yield* BankDb.readVersions(transaction, bookId, input.accountId))[0]
      ?.versions;

    if (versions === undefined) return yield* failure("StaleDependency");

    const capacities: JsonObject[] = [];

    const sourceGroups = new Map<string, CapacityGroup>();

    const lineGroups = new Map<string, CapacityGroup>();

    const pairs = new Set<string>();

    for (const leg of input.legs) {
      const pair = `${leg.statementId}:${leg.rowOrdinal}:${leg.voucherId}:${leg.lineId}`;

      if (pairs.has(pair)) return yield* failure("InvalidJournal");
      pairs.add(pair);

      const observation = (yield* StatementDb.readObservation(
        transaction,
        bookId,
        leg.statementId,
        leg.rowOrdinal,
      ))[0];

      if (!observation) return yield* failure("NotFound");

      const line = (yield* StatementDb.readLine(transaction, bookId, leg.voucherId, leg.lineId))[0];

      if (!line) return yield* failure("NotFound");

      const amount = Shared.minor(leg.amountMinor);

      const sourceAmount = Shared.minor(observation.amountMinor);

      const lineAmount = Shared.minor(line.amountMinor);

      if (
        amount === undefined ||
        amount === 0n ||
        sourceAmount === undefined ||
        lineAmount === undefined
      ) {
        return yield* failure("InvalidJournal");
      }

      if (
        observation.accountId !== input.accountId ||
        line.accountId !== observation.accountId ||
        line.postedOn < observation.startsOn ||
        line.postedOn > observation.endsOn ||
        Shared.signOf(amount) !== Shared.signOf(sourceAmount) ||
        Shared.signOf(amount) !== Shared.signOf(lineAmount)
      ) {
        return yield* failure("InvalidJournal");
      }

      const sourceAllocated = Shared.minor(
        (yield* AllocationDb.readAllocatedSource(
          transaction,
          bookId,
          leg.statementId,
          leg.rowOrdinal,
        ))[0]?.allocated,
      );

      const lineAllocated = Shared.minor(
        (yield* AllocationDb.readAllocatedLine(transaction, bookId, leg.voucherId, leg.lineId))[0]
          ?.allocated,
      );

      if (sourceAllocated === undefined || lineAllocated === undefined) {
        return yield* failure("InternalError");
      }

      const candidates = (yield* AllocationDb.readCandidateCount(
        transaction,
        bookId,
        observation.accountId,
        observation.startsOn,
        observation.endsOn,
        Shared.signOf(sourceAmount),
      ))[0]?.total;

      if (candidates === undefined) return yield* failure("InternalError");

      if (candidates > maximumCandidateLines) return yield* failure("InvalidJournal");

      groupCapacity(
        sourceGroups,
        `${leg.statementId}:${leg.rowOrdinal}`,
        amount,
        sourceAmount,
        sourceAllocated,
      );
      groupCapacity(
        lineGroups,
        `${leg.voucherId}:${leg.lineId}`,
        amount,
        lineAmount,
        lineAllocated,
      );
      capacities.push(
        Object.assign(
          {},
          {
            leg: yield* Shared.toJsonObject(leg),
            sourceAmountMinor: Shared.signedText(sourceAmount),
            sourceAllocatedMinor: Shared.signedText(sourceAllocated),
            lineAmountMinor: Shared.signedText(lineAmount),
            lineAllocatedMinor: Shared.signedText(lineAllocated),
            evidenceId: observation.evidenceId,
            evidenceSha256: observation.evidenceSha256,
            providerId: observation.providerId,
            sourceBankAccountId: observation.sourceBankAccountId,
            observedOn: observation.observedOn,
            postedOn: line.postedOn,
            candidateCount: candidates,
          },
        ) satisfies JsonObject,
      );
    }

    if (!withinCapacity(sourceGroups) || !withinCapacity(lineGroups)) {
      return yield* failure("InvalidJournal");
    }

    return { versions, capacities };
  });
}

export const prepareBankAllocation = Effect.fn("banking.allocation.prepare")(function* (
  token: string,
  command: {
    readonly scope: Scope;
    readonly idempotencyKey: string;
    readonly input: typeof Settlement.PrepareBankAllocation.Type;
  },
) {
  return yield* Shared.withBook(token, command.scope, false, "update", (transaction, principal) =>
    Effect.gen(function* () {
      yield* Shared.requireTables(transaction, allocationTables, [
        "bank_allocation_plans",
        "command_receipts",
      ]);
      yield* Shared.requireColumns(transaction, Shared.accountColumns);

      const book = yield* lockBook(transaction, command.scope.bookId);

      for (const leg of command.input.legs) {
        if (
          (yield* readClaim(transaction, command.scope.bookId, leg.statementId, leg.rowOrdinal))
            .length > 0
        )
          return yield* failure("ApprovalRequired");
      }

      for (const leg of command.input.legs)
        yield* admitBankMatch(transaction, command.scope.bookId, leg);

      return yield* runBookCommandWithReceipt(
        transaction,
        {
          scope: command.scope,
          idempotencyKey: command.idempotencyKey,
          operation: "prepare_bank_allocation",
          actorId: principal.actorId,
          input: yield* Shared.toJsonObject(command.input),
        },
        PlanSchema,
        Effect.gen(function* () {
          yield* Shared.requireNativeBankProfile(book.profile, book.authority);

          if (command.input.legs.length < 1 || command.input.legs.length > maximumLegs) {
            return yield* failure("InvalidJournal");
          }

          const snapshot = yield* allocationSnapshot(
            transaction,
            command.scope.bookId,
            command.input,
          );

          const sourceRevision = Shared.textField(snapshot.versions, "sourceRevision");

          if (sourceRevision === undefined) return yield* failure("InternalError");

          const subjects = bankRowSubjects(command.input.legs, sourceRevision);

          yield* citedSuggestions(
            transaction,
            command.scope.bookId,
            principal,
            subjects,
            command.input.presentedSuggestionIds ?? [],
          );

          const body = Object.assign({}, {
            id: newId("bankplan"),
            version: 1,
            scope: command.scope,
            currency: book.currency,
            currencyScale: book.currencyScale,
            input: yield* Shared.toJsonObject(command.input),
            snapshot: yield* Shared.toJsonObject(snapshot),
            createdBy: principal.actorId,
            createdAt: yield* isoNow(transaction),
            receipt: Shared.receipt(
              command.idempotencyKey,
              "prepare_bank_allocation",
              principal.actorId,
            ),
          } satisfies JsonObject);

          const sealed = Object.assign({}, body, { digest: yield* digest(body) });

          const plan = yield* Shared.decode(PlanSchema, sealed);
          yield* AllocationDb.insertAllocationPlan(transaction, {
            bookId: command.scope.bookId,
            id: plan.id,
            accountId: command.input.accountId,
            input: Shared.objectField(sealed, "input"),
            body: sealed,
          });

          return { receipt: yield* Shared.toJsonObject(plan), result: plan };
        }),
      );
    }),
  );
});

export const approveBankAllocation = Effect.fn("banking.allocation.approve")(function* (
  token: string,
  command: {
    readonly scope: Scope;
    readonly planId: string;
    readonly idempotencyKey: string;
    readonly input: typeof Settlement.ApproveBankAllocation.Type;
  },
) {
  return yield* Shared.withBook(token, command.scope, true, "update", (transaction, principal) =>
    Effect.gen(function* () {
      yield* Shared.requireTables(transaction, allocationTables, [
        "bank_allocation_approvals",
        "command_receipts",
      ]);
      yield* Shared.requireColumns(transaction, Shared.accountColumns);

      const book = yield* lockBook(transaction, command.scope.bookId);

      const payload = {
        planId: command.planId,
        input: yield* Shared.toJsonObject(command.input),
      } satisfies JsonObject;

      if (
        (yield* AllocationDb.readOwnedAllocationPlan(
          transaction,
          command.scope.bookId,
          command.planId,
        ))[0]?.present
      )
        return yield* failure("ApprovalRequired");

      return yield* runBookCommandWithReceipt(
        transaction,
        {
          scope: command.scope,
          idempotencyKey: command.idempotencyKey,
          operation: "approve_bank_allocation",
          actorId: principal.actorId,
          input: payload,
        },
        ApprovalSchema,
        Effect.gen(function* () {
          const plan = (yield* AllocationDb.readAllocationPlan(
            transaction,
            command.scope.bookId,
            command.planId,
          ))[0];

          if (!plan) return yield* failure("NotFound");

          if (command.input.digest !== Shared.textField(plan.body, "digest")) {
            return yield* failure("StaleDependency");
          }

          yield* Shared.requireNativeBankProfile(book.profile, book.authority);

          const versions = (yield* BankDb.readVersions(
            transaction,
            command.scope.bookId,
            plan.accountId,
          ))[0];

          if (!versions) return yield* failure("StaleDependency");

          if (
            !(yield* Shared.sameCanonical(
              versions.versions,
              Shared.objectField(Shared.objectField(plan.body, "snapshot"), "versions"),
            ))
          ) {
            return yield* failure("StaleDependency");
          }

          const now = (yield* AllocationDb.readDatabaseTime(transaction))[0]?.now;

          if (now === undefined) return yield* failure("InternalError");

          const body = yield* Shared.toJsonObject(
            Object.assign({}, command.input, {
              id: newId("bankapproval"),
              planId: command.planId,
              actorId: principal.actorId,
              expiresAt: new Date(Date.parse(now) + approvalWindowMs).toISOString(),
              receipt: Shared.receipt(
                command.idempotencyKey,
                "approve_bank_allocation",
                principal.actorId,
              ),
            }),
          );

          const expiresAt = Shared.textField(body, "expiresAt");

          const approvalId = Shared.textField(body, "id");

          if (expiresAt === undefined || approvalId === undefined) {
            return yield* failure("InternalError");
          }

          yield* AllocationDb.insertAllocationApproval(transaction, {
            bookId: command.scope.bookId,
            id: approvalId,
            planId: command.planId,
            actorId: principal.actorId,
            expiresAt,
            body,
          });

          const retained = yield* Shared.decode(PlanSchema, plan.body);

          const subjects = bankRowSubjects(
            retained.input.legs,
            retained.snapshot.versions.sourceRevision,
          );

          const inheritedIds = yield* inheritedSuggestionIds(
            transaction,
            command.scope.bookId,
            principal,
            retained.input.presentedSuggestionIds ?? [],
          );

          const exposure = yield* citedSuggestions(
            transaction,
            command.scope.bookId,
            principal,
            subjects,
            command.input.presentedSuggestionIds ?? inheritedIds,
          );

          const comparisons: Comparison[] = exposure.records.map((record) => {
            const first =
              record.ranked.source === "bank_ranking_v2" ? record.ranked.options[0] : undefined;

            const leg = retained.input.legs[0];

            const complete = retained.input.legs.length === 1;

            return {
              coverage: complete ? "complete" : "partial",
              comparison:
                first === undefined || leg === undefined
                  ? "not_comparable"
                  : first.voucherId === leg.voucherId &&
                      first.lineId === leg.lineId &&
                      first.amountMinor === leg.amountMinor
                    ? "unchanged"
                    : "changed",
              dimensions: { legs: retained.input.legs.length },
            };
          });

          yield* recordDecision(transaction, {
            bookId: command.scope.bookId,
            actorId: principal.actorId,
            kind: "bank_allocation",
            id: approvalId,
            subject: yield* Shared.toJsonObject({
              kind: "bank_allocation",
              planId: retained.id,
              digest: retained.digest,
              rows: subjects,
            }),
            selected: yield* Shared.toJsonObject({
              plan: retained,
              approvalId,
              bookCommitSequence: book.committedSequence,
            }),
            exposure,
            comparisons,
          });

          const approval = yield* Shared.decode(ApprovalSchema, body);

          return { receipt: yield* Shared.toJsonObject(approval), result: approval };
        }),
      );
    }),
  );
});

export const executeBankAllocation = Effect.fn("banking.allocation.execute")(function* (
  token: string,
  command: {
    readonly scope: Scope;
    readonly planId: string;
    readonly idempotencyKey: string;
    readonly input: typeof Settlement.ExecuteBankAllocation.Type;
  },
) {
  return yield* Shared.withBook(token, command.scope, false, "update", (transaction, principal) =>
    Effect.gen(function* () {
      yield* Shared.requireTables(
        transaction,
        allocationTables,
        ["bank_allocation_executions", "bank_allocation_legs", "command_receipts"],
        ["bank_sources"],
      );
      yield* Shared.requireColumns(transaction, Shared.accountColumns);

      const book = yield* lockBook(transaction, command.scope.bookId);

      if (
        (yield* AllocationDb.readOwnedAllocationPlan(
          transaction,
          command.scope.bookId,
          command.planId,
        ))[0]?.present
      )
        return yield* failure("ApprovalRequired");

      return yield* runBookCommandWithReceipt(
        transaction,
        {
          scope: command.scope,
          idempotencyKey: command.idempotencyKey,
          operation: "execute_bank_allocation",
          actorId: principal.actorId,
          input: {
            planId: command.planId,
            input: yield* Shared.toJsonObject(command.input),
          } satisfies JsonObject,
        },
        ExecutionSchema,
        Effect.gen(function* () {
          if (
            (yield* AllocationDb.readAllocationExecution(
              transaction,
              command.scope.bookId,
              command.planId,
            )).length > 0
          ) {
            return yield* failure("IdempotencyConflict");
          }

          const plan = (yield* AllocationDb.readAllocationPlan(
            transaction,
            command.scope.bookId,
            command.planId,
          ))[0];

          if (!plan) return yield* failure("NotFound");

          if (command.input.digest !== Shared.textField(plan.body, "digest")) {
            return yield* failure("StaleDependency");
          }

          yield* Shared.requireNativeBankProfile(book.profile, book.authority);

          const versions = (yield* BankDb.readVersions(
            transaction,
            command.scope.bookId,
            plan.accountId,
          ))[0];

          if (
            !versions ||
            !(yield* Shared.sameCanonical(
              versions.versions,
              Shared.objectField(Shared.objectField(plan.body, "snapshot"), "versions"),
            ))
          ) {
            return yield* failure("StaleDependency");
          }

          const now = (yield* AllocationDb.readDatabaseTime(transaction))[0]?.now;

          if (now === undefined) return yield* failure("InternalError");

          const approval = (yield* AllocationDb.readApprovalForExecution(
            transaction,
            command.scope.bookId,
            command.planId,
            command.input.approvalId,
          ))[0];

          if (
            !approval ||
            Date.parse(approval.expiresAt) <= Date.parse(now) ||
            (yield* AllocationDb.readOperatorMembership(
              transaction,
              command.scope.bookId,
              approval.actorId,
            ))[0]?.present !== true
          ) {
            return yield* failure("ApprovalRequired");
          }

          const stored = yield* Shared.decode(PlanSchema, plan.body);

          const snapshot = yield* allocationSnapshot(
            transaction,
            command.scope.bookId,
            stored.input,
          );

          if (
            !(yield* Shared.sameCanonical(
              yield* Shared.toJsonObject(snapshot),
              Shared.objectField(plan.body, "snapshot"),
            ))
          ) {
            return yield* failure("StaleDependency");
          }

          for (const leg of stored.input.legs)
            yield* admitBankMatch(transaction, command.scope.bookId, leg);

          const legs = yield* Effect.forEach(stored.input.legs, (leg, index) =>
            Shared.toJsonObject(
              Object.assign({}, leg, { planId: command.planId, ordinal: index + 1 }),
            ),
          );

          const body = yield* Shared.toJsonObject({
            planId: command.planId,
            digest: command.input.digest,
            version: 1,
            approvalId: approval.id,
            scope: command.scope,
            accountId: plan.accountId,
            currency: Shared.textField(plan.body, "currency") ?? book.currency,
            currencyScale: book.currencyScale,
            legs,
            executedAt: new Date(Date.parse(now)).toISOString(),
            receipt: Shared.receipt(
              command.idempotencyKey,
              "execute_bank_allocation",
              principal.actorId,
            ),
          } satisfies JsonObject);

          yield* AllocationDb.insertAllocationExecution(transaction, {
            bookId: command.scope.bookId,
            planId: command.planId,
            approvalId: approval.id,
            body,
          });
          yield* AllocationDb.insertAllocationLegs(
            transaction,
            command.scope.bookId,
            command.planId,
            legs,
          );
          yield* BankDb.bumpSourceRevision(transaction, command.scope.bookId, plan.accountId);

          const execution = yield* Shared.decode(ExecutionSchema, body);

          return { receipt: body, result: execution };
        }),
      );
    }),
  );
});

export const getBankAllocation = Effect.fn("banking.allocation.get")(function* (
  token: string,
  command: { readonly scope: Scope; readonly planId: string },
) {
  return yield* Shared.withBook(token, command.scope, false, "share", (transaction) =>
    Effect.gen(function* () {
      yield* Shared.requireTables(transaction, allocationTables);
      yield* Shared.requireColumns(transaction, Shared.accountColumns);

      const book = (yield* BankDb.lockBook(transaction, command.scope.bookId, "share"))[0];

      if (!book) return yield* failure("Forbidden");

      const plan = (yield* AllocationDb.readAllocationPlan(
        transaction,
        command.scope.bookId,
        command.planId,
      ))[0];

      if (!plan) return yield* failure("NotFound");

      const approval = (yield* AllocationDb.readCurrentApproval(
        transaction,
        command.scope.bookId,
        command.planId,
      ))[0];

      const execution = (yield* AllocationDb.readAllocationExecution(
        transaction,
        command.scope.bookId,
        command.planId,
      ))[0];

      const versions = (yield* BankDb.readVersions(
        transaction,
        command.scope.bookId,
        plan.accountId,
      ))[0]?.versions;

      const unmatch = (yield* AllocationDb.readReversedAllocation(
        transaction,
        command.scope.bookId,
        command.planId,
      ))[0];

      return yield* Shared.decode(ViewSchema, {
        plan: yield* Shared.decode(PlanSchema, plan.body),
        approval: approval ? yield* Shared.decode(ApprovalSchema, approval.body) : null,
        execution: execution ? yield* Shared.decode(ExecutionSchema, execution.body) : null,
        dependenciesCurrent:
          versions !== undefined &&
          (yield* Shared.sameCanonical(
            versions,
            Shared.objectField(Shared.objectField(plan.body, "snapshot"), "versions"),
          )),
        unmatch: unmatch ?? null,
      });
    }),
  );
});

export const applyOwnedBankAllocationInTransaction = Effect.fn(
  "banking.allocation.applyOwnedAsset",
)(function* (
  transaction: Transaction,
  principal: Shared.Principal,
  command: {
    readonly scope: Scope;
    readonly ownerReviewId: string;
    readonly ownerApprovalId: string;
    readonly sourceWitness: typeof AssetDisposals.CashWitness.Type;
    readonly leg: typeof Settlement.AllocationLeg.Type;
  },
) {
  const { scope, ownerReviewId, ownerApprovalId, sourceWitness } = command;

  const leg = command.leg;

  const book = yield* lockBook(transaction, scope.bookId);
  yield* Shared.requireNativeBankProfile(book.profile, book.authority);

  const outer = (yield* AllocationDb.readAssetApprovalAuthority(
    transaction,
    scope.bookId,
    ownerReviewId,
    ownerApprovalId,
  ))[0];

  if (!outer?.authorized) return yield* failure("ApprovalRequired");

  const review = yield* Shared.decode(AssetDisposals.Review, outer.review);

  const approval = yield* Shared.decode(AssetDisposals.Approval, outer.approval);

  const action = review.postingPlan.groups[0]?.actions[0];

  const line = action?.lines.find((line) => line.lineId === leg.lineId);

  const voucher = (yield* LedgerDb.readVoucher(transaction, scope.bookId, leg.voucherId))[0];

  if (
    review.input.kind !== "disposal" ||
    review.proceeds.kind !== "unposted_cash_sale" ||
    review.digest !== approval.reviewDigest ||
    !action ||
    !line ||
    !voucher ||
    voucher.changeSetId !== review.postingPlan.id ||
    (yield* digest(voucher.action)) !== (yield* digest(action)) ||
    line.accountId !== sourceWitness.accountId ||
    line.debitMinor !== sourceWitness.grossMinor ||
    line.creditMinor !== "0" ||
    leg.amountMinor !== sourceWitness.grossMinor ||
    leg.statementId !== sourceWitness.statementId ||
    leg.rowOrdinal !== sourceWitness.rowOrdinal ||
    (yield* digest(review.proceeds)) !== (yield* digest(sourceWitness))
  )
    return yield* failure("StaleDependency");

  yield* admitBankMatch(transaction, scope.bookId, leg, ownerReviewId);

  return yield* runBookCommand(
    transaction,
    {
      scope: scope,
      idempotencyKey: `${ownerApprovalId}_bank`,
      operation: "apply_owned_asset_bank_allocation",
      actorId: principal.actorId,
      input: { ownerReviewId, ownerApprovalId, sourceWitness, leg },
    },
    ExecutionSchema,
    Effect.gen(function* () {
      const source = (yield* StatementDb.readObservation(
        transaction,
        scope.bookId,
        leg.statementId,
        leg.rowOrdinal,
      ))[0];

      const heads = yield* ForeignCashDb.readNativeSourceRevisions(
        transaction,
        scope.bookId,
        leg.statementId,
        leg.rowOrdinal,
      );

      const versions = (yield* BankDb.readVersions(
        transaction,
        scope.bookId,
        sourceWitness.accountId,
      ))[0]?.versions;

      if (
        !source ||
        source.amountMinor !== sourceWitness.grossMinor ||
        source.accountId !== sourceWitness.accountId ||
        source.observedOn !== sourceWitness.observedOn ||
        source.evidenceSha256 !== sourceWitness.evidence.sha256 ||
        Shared.textField(versions, "sourceRevision") !== sourceWitness.sourceRevision ||
        (yield* digest(heads)) !== sourceWitness.sourceHeadsDigest
      )
        return yield* failure("StaleDependency");

      const input = {
        accountId: sourceWitness.accountId,
        reason: review.input.rationale,
        ambiguityAcknowledged: true as const,
        legs: [leg],
      };

      const snapshot = yield* allocationSnapshot(transaction, scope.bookId, input);

      if (
        snapshot.capacities.some(
          (capacity) =>
            capacity.sourceAllocatedMinor !== "0" || capacity.lineAllocatedMinor !== "0",
        )
      )
        return yield* failure("AlreadyPosted");

      const now = yield* isoNow(transaction);

      const planBody = {
        id: newId("bankplan"),
        version: 1,
        scope,
        currency: book.currency,
        currencyScale: book.currencyScale,
        input,
        snapshot,
        createdBy: approval.actorId,
        createdAt: now,
        receipt: Shared.receipt(
          `${ownerReviewId}_allocation`,
          "owned_asset_bank_allocation",
          principal.actorId,
        ),
      };

      const plan = yield* Shared.decode(PlanSchema, {
        ...planBody,
        digest: yield* digest(planBody),
      });

      yield* AllocationDb.insertAllocationPlan(transaction, {
        bookId: scope.bookId,
        id: plan.id,
        accountId: input.accountId,
        input,
        body: plan,
      });

      const innerApproval = yield* Shared.decode(ApprovalSchema, {
        id: newId("bankapproval"),
        planId: plan.id,
        digest: plan.digest,
        version: 1,
        actorId: approval.actorId,
        expiresAt: approval.expiresAt,
        receipt: Shared.receipt(
          `${ownerApprovalId}_allocation`,
          "delegated_asset_bank_allocation",
          approval.actorId,
        ),
      });

      yield* AllocationDb.insertOwnedAllocationApproval(transaction, {
        bookId: scope.bookId,
        ownerReviewId,
        ownerApprovalId,
        approval: innerApproval,
      });

      const legs = [{ ...leg, planId: plan.id, ordinal: 1 }];

      const result = yield* Shared.decode(ExecutionSchema, {
        planId: plan.id,
        digest: plan.digest,
        version: 1,
        approvalId: innerApproval.id,
        scope,
        accountId: input.accountId,
        currency: book.currency,
        currencyScale: book.currencyScale,
        legs,
        executedAt: now,
        receipt: Shared.receipt(
          `${ownerApprovalId}_bank`,
          "apply_owned_asset_bank_allocation",
          principal.actorId,
        ),
      });

      yield* AllocationDb.insertAllocationExecution(transaction, {
        bookId: scope.bookId,
        planId: plan.id,
        approvalId: innerApproval.id,
        body: result,
      });
      yield* AllocationDb.insertAllocationLegs(transaction, scope.bookId, plan.id, legs);
      yield* BankDb.bumpSourceRevision(transaction, scope.bookId, input.accountId);

      return result;
    }),
  );
});
