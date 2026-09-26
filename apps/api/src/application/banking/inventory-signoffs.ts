import * as Accounting from "@open-erp/contracts/accounting";
import * as AccountSignoffs from "@open-erp/contracts/bank-signoffs";
import * as Signoffs from "@open-erp/contracts/bank-inventory-signoffs";
import * as Effect from "effect/Effect";
import type * as Schema from "effect/Schema";
import { failure } from "../failures";
import { digest, isoNow, newId, replay, saveCommand, sha256Hex } from "../posting";
import * as SignoffDb from "../../db/banking/signoffs";
import * as BankDb from "../../db/banking/shared";
import * as Shared from "./shared";

type Scope = typeof Accounting.Scope.Type;
type JsonObject = Schema.JsonObject;

const PlanSchema = Signoffs.BankInventorySignoffPlan;
const SignoffSchema = Signoffs.BankInventorySignoff;
const ViewSchema = Signoffs.BankInventorySignoffView;
const ListSchema = Signoffs.BankInventorySignoffList;

const inventoryTables = [
  "books",
  "accounts",
  "periods",
  "closing_inventories",
  "bank_sources",
  "bank_signoff_plans",
  "bank_reconciliation_signoffs",
  "bank_source_coverage_reports",
  "evidence",
  "command_receipts",
];
const inventoryInserts = ["bank_inventory_signoff_plans", "evidence", "command_receipts"];
const maximumCaptureBytes = 8388608;

function readBook(transaction: import("../../db/transaction").Transaction, bookId: string) {
  return BankDb.lockBook(transaction, bookId, "update").pipe(
    Effect.flatMap((rows) => {
      const book = rows[0];
      return book ? Effect.succeed(book) : failure("Forbidden");
    }),
  );
}

function inventoryIsCurrent(
  transaction: import("../../db/transaction").Transaction,
  bookId: string,
  plan: typeof Signoffs.BankInventorySignoffPlan.Type,
) {
  return Effect.gen(function* () {
    const digestRows = yield* BankDb.readCoverageDependencyDigest(
      transaction,
      bookId,
      plan.basis.inventoryId,
    );
    if (digestRows[0]?.digest !== plan.basis.dependencyDigest) return false;
    const accounts = yield* BankDb.readAccounts(
      transaction,
      bookId,
      plan.members.map((member) => member.accountId),
    );
    return accounts.length === plan.members.length && accounts.every((row) => row.active);
  });
}

function accountIdsFromJsonArray(value: ReadonlyArray<Schema.Json>) {
  return value.flatMap((entry) => (typeof entry === "string" ? [entry] : []));
}

function requiredBankFamilyCount(inventory: JsonObject) {
  return Shared.arrayField(inventory, "families").filter(
    (family) =>
      Shared.textField(family, "family") === "bank_sources" &&
      Shared.textField(family, "status") === "required",
  ).length;
}

export const prepareBankInventorySignoff = Effect.fn("banking.inventorySignoff.prepare")(function* (
  token: string,
  command: {
    readonly scope: Scope;
    readonly idempotencyKey: string;
    readonly input: typeof Signoffs.PrepareBankInventorySignoff.Type;
  },
) {
  return yield* Shared.withBook(token, command.scope, false, "update", (transaction, principal) =>
    Effect.gen(function* () {
      yield* Shared.requireTables(transaction, inventoryTables, inventoryInserts);
      yield* Shared.requireColumns(transaction, Shared.accountColumns);
      const book = yield* readBook(transaction, command.scope.bookId);
      const request = yield* replay(
        transaction,
        command.scope,
        command.idempotencyKey,
        "prepare_bank_inventory_signoff",
        principal.actorId,
        yield* Shared.toJsonObject(command.input),
        PlanSchema,
      );
      if (request.previous) return request.previous;
      yield* Shared.requireNativeBankProfile(book.profile, book.authority);

      const planIds = [...command.input.signoffPlanIds].sort();
      if (new Set(planIds).size !== planIds.length) return yield* failure("InvalidJournal");

      const inventory = (yield* SignoffDb.readInventory(
        transaction,
        command.scope.bookId,
        command.input.inventoryId,
      ))[0];
      if (!inventory) return yield* failure("NotFound");
      const period = (yield* SignoffDb.readPeriod(
        transaction,
        command.scope.bookId,
        inventory.periodId,
      ))[0];
      if (!period) return yield* failure("NotFound");
      if (command.input.startsOn !== period.startsOn || command.input.endsOn !== period.endsOn) {
        return yield* failure("InvalidJournal");
      }
      if (
        (yield* SignoffDb.readInventorySuperseded(
          transaction,
          command.scope.bookId,
          inventory.periodId,
          inventory.ordinal,
        ))[0]?.present === true
      ) {
        return yield* failure("StaleDependency");
      }

      const declaredIds = accountIdsFromJsonArray(
        Shared.arrayField(inventory.body, "bankAccountIds"),
      );
      if (
        Shared.textField(inventory.body, "coverage") !== "synthetic_family_inventory_v1" ||
        declaredIds.length < 1 ||
        declaredIds.length > 100 ||
        new Set(declaredIds).size !== declaredIds.length ||
        requiredBankFamilyCount(inventory.body) !== 1
      ) {
        return yield* failure("InvalidJournal");
      }
      if (
        declaredIds.length !== planIds.length ||
        (yield* SignoffDb.readUndeclaredBankSources(
          transaction,
          command.scope.bookId,
          declaredIds,
        ))[0]?.present === true
      ) {
        return yield* failure("InvalidJournal");
      }
      if (
        (yield* SignoffDb.readInventorySignoffPlanCount(transaction, command.scope.bookId))[0]!
          .total >= 200
      ) {
        return yield* Shared.unsupported();
      }

      const dependencyDigest = (yield* BankDb.readCoverageDependencyDigest(
        transaction,
        command.scope.bookId,
        inventory.id,
      ))[0]?.digest;
      if (dependencyDigest === undefined || dependencyDigest === null) {
        return yield* Shared.unsupported();
      }

      const signedAccountIds = (yield* SignoffDb.readSignedAccountIds(
        transaction,
        command.scope.bookId,
        planIds,
      )).flatMap((row) => (row.accountId === null ? [] : [row.accountId]));
      const expectedIds = [...declaredIds].sort();
      if (JSON.stringify(signedAccountIds) !== JSON.stringify(expectedIds)) {
        return yield* failure("InvalidJournal");
      }

      const inventoryDigest = yield* digest(inventory.body);
      const members = yield* Effect.forEach(
        yield* SignoffDb.readSignedAccountMembers(transaction, command.scope.bookId, planIds),
        (member) =>
          Effect.gen(function* () {
            const plan = yield* Shared.decode(AccountSignoffs.BankSignoffPlan, member.plan);
            const signoff = yield* Shared.decode(
              AccountSignoffs.BankReconciliationSignoff,
              member.signoff,
            );
            if (
              !Shared.sameJson(Shared.objectField(member.plan, "scope"), command.scope) ||
              plan.startsOn !== command.input.startsOn ||
              plan.endsOn !== command.input.endsOn ||
              plan.currency !== book.currency ||
              plan.currencyScale !== book.currencyScale ||
              plan.basis.inventoryId !== inventory.id ||
              plan.basis.inventoryDigest !== inventoryDigest ||
              plan.basis.ledgerSequence !== book.committedSequence ||
              plan.basis.dependencyDigest !== dependencyDigest ||
              !Shared.isEmptyJsonArray(member.coverage.diagnostics) ||
              member.coverage.hasReviewGaps !== false
            ) {
              return yield* failure("StaleDependency");
            }
            const account = (yield* BankDb.readAccount(
              transaction,
              command.scope.bookId,
              Shared.textField(member.plan, "accountId") ?? "",
            ))[0];
            if (!account?.active) return yield* failure("StaleDependency");
            if (plan.digest !== (yield* digest(stripDigest(member.plan)))) {
              return yield* failure("StaleDependency");
            }
            if (signoff.digest !== plan.digest || signoff.planId !== plan.id) {
              return yield* failure("StaleDependency");
            }
            const content = yield* Shared.canonicalText({
              plan: member.plan,
              signoff: member.signoff,
            });
            if (
              content !== member.content ||
              member.byteLength !== Shared.byteLength(content) ||
              member.sha256 !== (yield* sha256Hex(content))
            ) {
              return yield* failure("StaleDependency");
            }
            return {
              accountId: plan.accountId,
              plan,
              signoff,
              artifact: {
                sha256: member.sha256,
                byteLength: member.byteLength,
                mediaType: "application/json" as const,
              },
            };
          }),
      );

      const membersBody = yield* Shared.toJsonObject(members);
      const body = Object.assign(
        {},
        {
          id: newId("bank_inventory_signoff"),
          version: 1,
          scope: command.scope,
          input: command.input,
          periodId: period.id,
          startsOn: period.startsOn,
          endsOn: period.endsOn,
          currency: book.currency,
          currencyScale: book.currencyScale,
          inventory: inventory.body,
          members: membersBody,
          basis: {
            inventoryId: inventory.id,
            inventoryDigest,
            dependencyDigest,
            memberDigest: yield* digest(membersBody),
            ledgerSequence: book.committedSequence,
            checkVersion: "declared_bank_inventory_signoff_v1",
          } satisfies JsonObject,
          reviewScope: "whole_declared_bank_inventory",
          coverage: "declared_inventory_only",
          companyCompleteness: "not_established",
          financialCloseReady: false,
          createdAt: yield* isoNow(transaction),
          receipt: Shared.receipt(
            command.idempotencyKey,
            "prepare_bank_inventory_signoff",
            principal.actorId,
          ),
        },
      ) satisfies JsonObject;
      const sealed = Object.assign({}, body, { digest: yield* digest(body) });
      const content = yield* Shared.canonicalText(sealed);
      const byteLength = Shared.byteLength(content);
      if (byteLength > maximumCaptureBytes) return yield* Shared.unsupported();
      const plan = yield* Shared.decode(PlanSchema, sealed);
      yield* SignoffDb.insertInventorySignoffPlan(transaction, {
        bookId: command.scope.bookId,
        id: plan.id,
        inventoryId: inventory.id,
        body: sealed,
        content,
        sha256: yield* sha256Hex(content),
        byteLength,
      });
      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        request.expected,
        "prepare_bank_inventory_signoff",
        principal.actorId,
        yield* Shared.toJsonObject(plan),
      );
      return plan;
    }),
  );
});

function stripDigest(plan: JsonObject) {
  return Object.fromEntries(Object.entries(plan).filter(([key]) => key !== "digest"));
}

export const signBankInventory = Effect.fn("banking.inventorySignoff.sign")(function* (
  token: string,
  command: {
    readonly scope: Scope;
    readonly planId: string;
    readonly idempotencyKey: string;
    readonly input: typeof Signoffs.SignBankInventory.Type;
  },
) {
  return yield* Shared.withBook(token, command.scope, true, "update", (transaction, principal) =>
    Effect.gen(function* () {
      yield* Shared.requireTables(transaction, inventoryTables, [
        ...inventoryInserts,
        "bank_inventory_signoffs",
      ]);
      const book = yield* readBook(transaction, command.scope.bookId);
      const request = yield* replay(
        transaction,
        command.scope,
        command.idempotencyKey,
        "sign_bank_inventory",
        principal.actorId,
        {
          planId: command.planId,
          input: yield* Shared.toJsonObject(command.input),
        } satisfies JsonObject,
        SignoffSchema,
      );
      if (request.previous) return request.previous;

      const stored = (yield* SignoffDb.readInventorySignoffPlan(
        transaction,
        command.scope.bookId,
        command.planId,
      ))[0];
      if (!stored) return yield* failure("NotFound");
      if (command.input.digest !== stored.body.digest) return yield* failure("StaleDependency");

      const existing = (yield* SignoffDb.readInventorySignoff(
        transaction,
        command.scope.bookId,
        command.planId,
      ))[0];
      if (existing) {
        const retained = yield* Shared.toJsonObject(
          Object.fromEntries(
            Object.entries(existing.body).filter(
              ([key]) =>
                !["planId", "evidenceSha256", "actorId", "signedAt", "receipt"].includes(key),
            ),
          ),
        );
        if (
          Shared.textField(existing.body, "actorId") !== principal.actorId ||
          !Shared.sameJson(retained, yield* Shared.toJsonObject(command.input))
        ) {
          return yield* failure("IdempotencyConflict");
        }
        const recovered = yield* Shared.decode(SignoffSchema, existing.body);
        yield* saveCommand(
          transaction,
          command.scope,
          command.idempotencyKey,
          request.expected,
          "sign_bank_inventory",
          principal.actorId,
          yield* Shared.toJsonObject(recovered),
        );
        return recovered;
      }

      yield* Shared.requireNativeBankProfile(book.profile, book.authority);
      const plan = yield* Shared.decode(PlanSchema, stored.body);
      if (!(yield* inventoryIsCurrent(transaction, command.scope.bookId, plan))) {
        return yield* failure("StaleDependency");
      }
      const source = (yield* BankDb.readEvidence(
        transaction,
        command.scope.bookId,
        command.input.evidenceId,
      ))[0];
      if (!source) return yield* failure("MissingEvidence");

      const body = Object.assign({}, command.input, {
        planId: command.planId,
        evidenceSha256: source.sha256,
        actorId: principal.actorId,
        signedAt: yield* isoNow(transaction),
        receipt: Shared.receipt(command.idempotencyKey, "sign_bank_inventory", principal.actorId),
      }) satisfies JsonObject;
      const content = yield* Shared.canonicalText({ plan: stored.body, signoff: body });
      const byteLength = Shared.byteLength(content);
      if (byteLength > maximumCaptureBytes) return yield* Shared.unsupported();
      yield* SignoffDb.insertInventorySignoff(transaction, {
        bookId: command.scope.bookId,
        planId: command.planId,
        evidenceId: source.id,
        body,
        content,
        sha256: yield* sha256Hex(content),
        byteLength,
      });
      const signoff = yield* Shared.decode(SignoffSchema, body);
      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        request.expected,
        "sign_bank_inventory",
        principal.actorId,
        yield* Shared.toJsonObject(signoff),
      );
      return signoff;
    }),
  );
});

export const getBankInventorySignoff = Effect.fn("banking.inventorySignoff.get")(function* (
  token: string,
  command: { readonly scope: Scope; readonly planId: string },
) {
  return yield* Shared.withBook(token, command.scope, false, "share", (transaction) =>
    Effect.gen(function* () {
      yield* Shared.requireTables(transaction, inventoryTables);
      yield* Shared.requireColumns(transaction, Shared.accountColumns);
      const book = (yield* BankDb.lockBook(transaction, command.scope.bookId, "share"))[0];
      if (!book) return yield* failure("Forbidden");
      const stored = (yield* SignoffDb.readInventorySignoffPlan(
        transaction,
        command.scope.bookId,
        command.planId,
      ))[0];
      if (!stored) return yield* failure("NotFound");
      const plan = yield* Shared.decode(PlanSchema, stored.body);
      const signed = (yield* SignoffDb.readInventorySignoff(
        transaction,
        command.scope.bookId,
        command.planId,
      ))[0];
      return yield* Shared.decode(ViewSchema, {
        plan,
        signoff: signed ? yield* Shared.decode(SignoffSchema, signed.body) : null,
        preparedArtifact: {
          content: stored.content,
          sha256: stored.sha256,
          byteLength: stored.byteLength,
          mediaType: "application/json",
        },
        signedArtifact: signed
          ? {
              content: signed.content,
              sha256: signed.sha256,
              byteLength: signed.byteLength,
              mediaType: "application/json",
            }
          : null,
        dependenciesCurrent: yield* inventoryIsCurrent(transaction, command.scope.bookId, plan),
      });
    }),
  );
});

export const listBankInventorySignoffs = Effect.fn("banking.inventorySignoff.list")(function* (
  token: string,
  command: { readonly scope: Scope },
) {
  return yield* Shared.withBook(token, command.scope, false, "share", (transaction) =>
    Effect.gen(function* () {
      yield* Shared.requireTables(transaction, inventoryTables);
      const book = (yield* BankDb.lockBook(transaction, command.scope.bookId, "share"))[0];
      if (!book) return yield* failure("Forbidden");
      const rows = yield* SignoffDb.listInventorySignoffPlans(transaction, command.scope.bookId);
      return yield* Shared.decode(ListSchema, {
        scope: command.scope,
        items: rows.map((row) => {
          const members = Shared.arrayField(row.body, "members");
          return {
            id: row.body.id ?? "",
            inventoryId: row.inventoryId,
            periodId: row.body.periodId ?? "",
            startsOn: row.body.startsOn ?? "",
            endsOn: row.body.endsOn ?? "",
            accountCount: members.length,
            createdAt: row.body.createdAt ?? "",
            digest: row.body.digest ?? "",
            signedAt: row.signedAt,
          };
        }),
      });
    }),
  );
});
