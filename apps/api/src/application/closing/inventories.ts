import * as Accounting from "@open-erp/contracts/accounting";
import * as Closing from "@open-erp/contracts/closing";
import * as Effect from "effect/Effect";
import { failure } from "../failures";
import { isoNow, newId, replay, saveCommand } from "../posting";
import * as Db from "../../db/posting";
import * as ClosingDb from "../../db/closing/inventories";
import type { Transaction } from "../../db/transaction";
import * as Dependencies from "./dependencies";
import {
  decode,
  exactKeys,
  toJsonObject,
  unsupported,
  withBook,
  type JsonObject,
} from "../commerce/support";

type Scope = typeof Accounting.Scope.Type;

type Declaration = typeof Closing.DeclareClosingInventory.Type;

type FamilyDeclaration = NonNullable<Declaration["families"]>[number];

type RetainedFamily = NonNullable<(typeof Closing.ClosingInventory.Type)["families"]>[number];

const InventorySchema = Closing.ClosingInventory;

const ApprovalSchema = Closing.ClosingApproval;

const inventoryInputKeys = ["evidenceId", "bankAccountIds", "families"] as const;

const bankInventoryInputKeys = ["evidenceId", "bankAccountIds"] as const;

const familyInputKeys = ["family", "status", "reviewedOn", "evidenceId", "rationale"] as const;

const families = [
  "bank_sources",
  "invoices",
  "tax",
  "payroll",
  "assets_deferrals",
  "foreign_currency",
  "owner_balances",
  "other_balances",
  "external_schedules",
  "disclosures",
] as const;

const familyStatuses = ["required", "not_applicable", "unsupported", "unknown"] as const;

const maximumBankAccounts = 100;

const maximumInventoryOrdinal = 9223372036854775807n;

const approvalWindowMs = 15 * 60 * 1000;

const ownerRecordBound = 1000;

const ownerEffectBound = 1000;

const ownerAllocationLegBound = 5000;

const expenseTaxSourceBound = 200;

function requireAccess(transaction: Transaction, inserts: ReadonlyArray<string>) {
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

function requireSyntheticProfile(transaction: Transaction, bookId: string) {
  return Effect.gen(function* () {
    const book = (yield* ClosingDb.readSyntheticProfile(transaction, bookId))[0];

    if (book === undefined || book.profile !== "synthetic-core-v1" || book.authority !== "native") {
      return yield* unsupported();
    }
  });
}

function calendarDate(value: string) {
  const parsed = Date.parse(`${value}T00:00:00.000Z`);

  if (!Number.isFinite(parsed)) return null;

  return new Date(parsed).toISOString().slice(0, 10) === value ? new Date(parsed) : null;
}

function requireDeclaredAccounts(
  transaction: Transaction,
  bookId: string,
  accounts: ReadonlyArray<string>,
) {
  return Effect.gen(function* () {
    if (accounts.length > maximumBankAccounts || new Set(accounts).size !== accounts.length) {
      return yield* failure("InvalidJournal");
    }

    const known = yield* ClosingDb.readExistingAccountIds(transaction, bookId, [...accounts]);

    if (known.length !== accounts.length) return yield* failure("InvalidJournal");
  });
}

function retainFamilies(
  transaction: Transaction,
  bookId: string,
  declared: ReadonlyArray<FamilyDeclaration>,
  today: Date,
) {
  return Effect.gen(function* () {
    if (declared.length !== families.length) return yield* failure("InvalidJournal");

    for (const declaration of declared) {
      yield* exactKeys(yield* toJsonObject(declaration), familyInputKeys);

      if (!families.includes(declaration.family) || !familyStatuses.includes(declaration.status)) {
        return yield* failure("InvalidJournal");
      }

      if (declaration.rationale.trim().length < 1) return yield* failure("InvalidJournal");
      const reviewed = calendarDate(declaration.reviewedOn);

      if (reviewed === null || reviewed > today) return yield* failure("InvalidJournal");
    }

    const digests = new Map(
      (yield* ClosingDb.readFamilyEvidence(
        transaction,
        bookId,
        declared.map((declaration) => declaration.evidenceId),
      )).map((row) => [row.id, row.sha256]),
    );

    const retained = declared.map((declaration) => {
      const evidenceSha256 = digests.get(declaration.evidenceId);

      return evidenceSha256 === undefined
        ? null
        : ({ ...declaration, evidenceSha256 } satisfies RetainedFamily);
    });

    if (retained.some((declaration) => declaration === null)) {
      return yield* failure("MissingEvidence");
    }

    return retained
      .filter((declaration) => declaration !== null)
      .sort((left, right) => {
        const leftFamily = left!.family;
        const rightFamily = right!.family;

        return leftFamily < rightFamily ? -1 : leftFamily > rightFamily ? 1 : 0;
      });
  });
}

function requireProviderBounds(transaction: Transaction, bookId: string) {
  return Effect.gen(function* () {
    const bounds = yield* Effect.all([
      ClosingDb.countOwnerRecords(transaction, bookId),
      ClosingDb.countOwnerEffects(transaction, bookId),
      ClosingDb.countOwnerAllocationLegs(transaction, bookId),
      ClosingDb.countExpenseTaxSources(transaction, bookId),
    ]);

    const totals = bounds.map((rows) => rows[0]?.total ?? 0);

    if (
      totals[0]! > ownerRecordBound ||
      totals[1]! > ownerEffectBound ||
      totals[2]! > ownerAllocationLegBound ||
      totals[3]! > expenseTaxSourceBound
    ) {
      return yield* failure("InvalidJournal");
    }
  });
}

function textField(value: JsonObject, key: string) {
  const found = value[key];

  return typeof found === "string" ? found : null;
}

function withoutFields(value: JsonObject, keys: ReadonlyArray<string>) {
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => !keys.includes(key)),
  ) satisfies JsonObject;
}

export function closingBasisDependencies(
  transaction: Transaction,
  bookId: string,
  period: ClosingDb.PeriodRow,
) {
  return Effect.gen(function* () {
    return {
      subledgerControls: yield* Dependencies.subledgerControlDependencies(transaction, bookId),
      bank: yield* Dependencies.bankCloseDependencies(
        transaction,
        bookId,
        period.startsOn,
        period.endsOn,
      ),
      schedules: yield* Dependencies.subledgerCloseDependencies(transaction, bookId, period.endsOn),
      commerce: yield* Dependencies.commercePeriodStatus(
        transaction,
        bookId,
        period.startsOn,
        period.endsOn,
      ),
      owners: yield* Dependencies.ownerPeriodStatus(
        transaction,
        bookId,
        period.startsOn,
        period.endsOn,
      ),
      expenseTax: yield* Dependencies.expenseTaxDependencies(transaction, bookId),
      vatReturns: yield* Dependencies.vatReturnDependencies(transaction, bookId),
    } satisfies ClosingDb.ClosingBasisDependencies;
  });
}

function readCurrentBasis(transaction: Transaction, bookId: string, periodId: string) {
  return Effect.gen(function* () {
    yield* requireProviderBounds(transaction, bookId);
    const period = (yield* ClosingDb.readPeriod(transaction, bookId, periodId, "share"))[0];

    if (period === undefined) return yield* failure("NotFound");

    const row = (yield* ClosingDb.readClosingBasis(
      transaction,
      bookId,
      periodId,
      yield* closingBasisDependencies(transaction, bookId, period),
    ))[0];

    if (!row) return yield* failure("NotFound");

    return row.basis;
  });
}

export const declareInventory = Effect.fn("closing.declareInventory")(function* (
  token: string,
  command: { scope: Scope; periodId: string; idempotencyKey: string; input: Declaration },
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (transaction, principal) {
      yield* requireAccess(transaction, ["closing_inventories"]);

      const request = yield* replay(
        transaction,
        command.scope,
        command.idempotencyKey,
        "declare_closing_inventory",
        principal.actorId,
        yield* toJsonObject({ periodId: command.periodId, input: command.input }),
        InventorySchema,
      );

      if (request.previous) return request.previous;
      yield* requireSyntheticProfile(transaction, command.scope.bookId);

      if (
        (yield* ClosingDb.readPeriod(transaction, command.scope.bookId, command.periodId, "update"))
          .length === 0
      ) {
        return yield* failure("NotFound");
      }

      const declared = command.input.families;
      const input = yield* toJsonObject(command.input);
      yield* exactKeys(
        input,
        declared === undefined ? [...bankInventoryInputKeys] : [...inventoryInputKeys],
      );
      yield* requireDeclaredAccounts(
        transaction,
        command.scope.bookId,
        command.input.bankAccountIds,
      );

      const evidence = (yield* ClosingDb.readEvidence(
        transaction,
        command.scope.bookId,
        command.input.evidenceId,
      ))[0];

      if (!evidence) return yield* failure("MissingEvidence");
      const today = calendarDate((yield* isoNow(transaction)).slice(0, 10));

      const retained =
        declared === undefined
          ? null
          : yield* retainFamilies(
              transaction,
              command.scope.bookId,
              declared,
              today ?? new Date(0),
            );

      const revision = (yield* ClosingDb.readNextInventoryOrdinal(
        transaction,
        command.scope.bookId,
        command.periodId,
      ))[0]?.ordinal;

      if (revision === undefined) return yield* failure("InternalError");

      if (BigInt(revision) > maximumInventoryOrdinal) return yield* unsupported();
      const id = newId("closing_inventory");

      const base: JsonObject = {
        ...withoutFields(input, ["families"]),
        id,
        evidenceSha256: evidence.sha256,
        actorId: principal.actorId,
        declaredAt: yield* isoNow(transaction),
        revision,
        coverage:
          retained === null ? "synthetic_bank_sources_only" : "synthetic_family_inventory_v1",
      };

      const body = yield* toJsonObject(
        retained === null ? base : Object.assign({}, base, { families: retained }),
      );

      yield* ClosingDb.insertInventory(transaction, {
        bookId: command.scope.bookId,
        id,
        periodId: command.periodId,
        ordinal: revision,
        body,
      });
      const result = yield* decode(InventorySchema, body);
      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        request.expected,
        "declare_closing_inventory",
        principal.actorId,
        result,
      );

      return result;
    },
    "update",
  );
});

export const approveProposal = Effect.fn("closing.approveProposal")(function* (
  token: string,
  command: {
    scope: Scope;
    id: string;
    idempotencyKey: string;
    input: typeof Closing.ApproveClosing.Type;
  },
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (transaction, principal) {
      yield* requireAccess(transaction, ["closing_approvals"]);

      const request = yield* replay(
        transaction,
        command.scope,
        command.idempotencyKey,
        "approve_closing",
        principal.actorId,
        yield* toJsonObject({ proposalId: command.id, input: command.input }),
        ApprovalSchema,
      );

      if (request.previous) return request.previous;
      yield* exactKeys(yield* toJsonObject(command.input), ["digest"]);

      const proposal = (yield* ClosingDb.readProposal(
        transaction,
        command.scope.bookId,
        command.id,
        "update",
      ))[0];

      if (!proposal) return yield* failure("NotFound");

      if (
        (yield* ClosingDb.readPeriod(
          transaction,
          command.scope.bookId,
          proposal.periodId,
          "update",
        )).length === 0
      ) {
        return yield* failure("NotFound");
      }

      const basis = yield* readCurrentBasis(transaction, command.scope.bookId, proposal.periodId);
      const captured = proposal.body.basis;

      const current =
        captured !== undefined &&
        captured !== null &&
        (yield* ClosingDb.sameJson(transaction, yield* toJsonObject(captured), basis));

      if (current === false || command.input.digest !== textField(proposal.body, "digest")) {
        return yield* failure("StaleDependency");
      }

      const now = yield* Db.readDatabaseTime(transaction);
      const id = newId("closing_approval");
      const expiresAt = new Date(Date.parse(now.now) + approvalWindowMs).toISOString();

      const body = yield* toJsonObject({
        id,
        proposalId: command.id,
        digest: command.input.digest,
        actorId: principal.actorId,
        expiresAt,
      } satisfies JsonObject);

      yield* ClosingDb.insertApproval(transaction, {
        bookId: command.scope.bookId,
        id,
        proposalId: command.id,
        actorId: principal.actorId,
        expiresAt,
        body,
      });
      const result = yield* decode(ApprovalSchema, body);
      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        request.expected,
        "approve_closing",
        principal.actorId,
        result,
      );

      return result;
    },
    "update",
  );
});
