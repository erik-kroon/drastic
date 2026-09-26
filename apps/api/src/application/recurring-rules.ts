import { digest as digestNative } from "./json";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Automation from "@open-erp/contracts/automation";
import { sql } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { failure } from "./failures";
import { isoNow, newId, replay, saveCommand } from "./posting";
import { decode, exactKeys, toJsonObject, unsupported, withBook } from "./commerce/support";
import * as Db from "../db/recurring-rules";
import * as PostingDb from "../db/posting";
import type { Transaction } from "../db/transaction";

type Scope = typeof Accounting.Scope.Type;

type JsonObject = Schema.JsonObject;

const RuleSchema = Automation.RecurringRule;

const RuleViewSchema = Automation.RecurringRuleView;

const SelectionSchema = Automation.SimulationSelection;

const SimulationSchema = Automation.RuleSimulation;

const ruleKeys = [
  "kind",
  "name",
  "sourceBankAccountId",
  "accountId",
  "description",
  "sign",
  "counterpartAccountId",
  "series",
  "taxAssessment",
] as const;

const maximumSelectedObservations = 1000;

const descriptionLimit = 2000;

function requireRuleAccess(transaction: Transaction, write: boolean) {
  const tables = [...Db.recurringRuleTables];

  return Db.readRuleAccess(transaction).pipe(
    Effect.flatMap((rows) => {
      if (rows.length !== tables.length) return unsupported();

      if (rows.some((row) => !row.canSelect)) return unsupported();

      return write &&
        rows.some(
          (row) =>
            ["recurring_rules", "recurring_simulations", "command_receipts"].includes(
              row.tableName,
            ) && !row.canInsert,
        )
        ? unsupported()
        : Effect.void;
    }),
  );
}

export function calendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = Date.parse(`${value}T00:00:00.000Z`);

  if (!Number.isFinite(parsed)) return null;

  return new Date(parsed).toISOString().slice(0, 10) === value ? value : null;
}

function objectOrNull(value: Schema.Json | undefined) {
  const parsed = Schema.decodeUnknownOption(Schema.JsonObject)(value);

  return Option.isSome(parsed) ? parsed.value : null;
}

function text(value: JsonObject, key: string) {
  const found = value[key];

  return typeof found === "string" ? found : null;
}

function requireNativeProfile(transaction: Transaction, scope: Scope) {
  return PostingDb.readBook(transaction, scope).pipe(
    Effect.flatMap((rows) => {
      const book = rows[0];

      if (!book || book.profile !== "synthetic-core-v1" || book.authority !== "native") {
        return unsupported();
      }

      return Effect.succeed(book);
    }),
  );
}

export const proposeRule = Effect.fn("recurring.proposeRule")(function* (
  token: string,
  command: {
    scope: Scope;
    idempotencyKey: string;
    input: typeof Automation.ProposeRecurringRule.Type;
  },
) {
  return yield* withBook(
    token,
    command.scope,
    false,
    function* (transaction, principal) {
      const request = yield* replay(
        transaction,
        command.scope,
        command.idempotencyKey,
        "propose_recurring_rule",
        principal.actorId,
        yield* toJsonObject(command.input),
        RuleSchema,
      );

      if (request.previous) return request.previous;
      yield* requireRuleAccess(transaction, true);
      const book = yield* requireNativeProfile(transaction, command.scope);
      const input = yield* toJsonObject(command.input);
      yield* exactKeys(input, [...ruleKeys]);

      if (
        input.kind !== "synthetic_recurring_preparation_v1" ||
        input.taxAssessment !== "not_applicable" ||
        (input.sign !== "positive" && input.sign !== "negative")
      ) {
        return yield* failure("InvalidJournal");
      }

      const name = text(input, "name");
      const description = text(input, "description");
      const series = text(input, "series");
      const accountId = text(input, "accountId");
      const counterpartAccountId = text(input, "counterpartAccountId");
      const sourceBankAccountId = text(input, "sourceBankAccountId");

      if (
        name === null ||
        name.length < 1 ||
        name.length > descriptionLimit ||
        description === null ||
        description.length < 1 ||
        description.length > descriptionLimit ||
        series === null ||
        !/^[A-Z0-9]{1,16}$/.test(series) ||
        accountId === null ||
        counterpartAccountId === null ||
        sourceBankAccountId === null ||
        accountId === counterpartAccountId
      ) {
        return yield* failure("InvalidJournal");
      }

      const accounts = yield* Db.lockSelectionAccounts(transaction, command.scope.bookId, [
        accountId,
        counterpartAccountId,
      ]);

      if (accounts.length !== 2 || accounts.some((row) => !row.active)) {
        return yield* failure("InvalidJournal");
      }

      const source = yield* transaction.execute<{ readonly accountId: string }>(
        sql`
          select account_id as "accountId" from openerp.bank_sources
          where book_id = ${command.scope.bookId} and account_id = ${accountId}
            and source_bank_account_id = ${sourceBankAccountId}
          for share
        `,
        "objects",
      );

      if (source.length === 0) return yield* failure("InvalidJournal");
      const id = newId("rule");

      const dependencies: Array<JsonObject> = [
        {
          kind: "profile",
          resourceId: command.scope.bookId,
          version: book.profileVersion.toString(),
          reason: "Synthetic book currency and profile",
        },
        {
          kind: "writer_epoch",
          resourceId: command.scope.bookId,
          version: book.writerEpoch.toString(),
          reason: "Native writer authority",
        },
        ...[...accounts]
          .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
          .map((row) => ({
            kind: "account",
            resourceId: row.id,
            version: row.version,
            reason: "Exact recurring account configuration",
          })),
      ];

      const base = yield* toJsonObject({
        id,
        version: 1,
        scope: command.scope,
        input,
        dependencies,
        createdAt: yield* isoNow(transaction),
        proposedBy: principal.actorId,
        receipt: {
          key: command.idempotencyKey,
          operation: "propose_recurring_rule",
          actorId: principal.actorId,
        },
      });

      const digest = yield* digestNative(base);

      if (digest === undefined) return yield* failure("InternalError");
      const body = yield* toJsonObject({ ...base, digest });
      yield* Db.insertRule(transaction, { bookId: command.scope.bookId, id, body });
      const result = yield* decode(RuleSchema, body);
      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        request.expected,
        "propose_recurring_rule",
        principal.actorId,
        result,
      );

      return result;
    },
    "update",
  );
});

export const getRule = Effect.fn("recurring.getRule")(function* (
  token: string,
  command: { scope: Scope; ruleId: string },
) {
  return yield* withBook(token, command.scope, false, function* (transaction) {
    yield* requireRuleAccess(transaction, false);
    const rule = (yield* Db.readRule(transaction, command.scope.bookId, command.ruleId))[0];

    if (!rule) return yield* failure("NotFound");

    const activation = (yield* Db.readActiveActivation(
      transaction,
      command.scope.bookId,
      command.ruleId,
    ))[0];

    const current = (yield* Db.readDependenciesCurrent(
      transaction,
      command.scope.bookId,
      rule.body,
    ))[0]?.current;

    if (current === undefined) return yield* failure("InternalError");

    return yield* decode(RuleViewSchema, {
      rule,
      activeActivation: activation ?? null,
      dependenciesCurrent: current,
    });
  });
});

export const simulateRule = Effect.fn("recurring.simulateRule")(function* (
  token: string,
  command: {
    scope: Scope;
    idempotencyKey: string;
    input: typeof Automation.SimulateRecurringRule.Type;
  },
) {
  return yield* withBook(
    token,
    command.scope,
    false,
    function* (transaction, principal) {
      const request = yield* replay(
        transaction,
        command.scope,
        command.idempotencyKey,
        "simulate_recurring_rule",
        principal.actorId,
        yield* toJsonObject(command.input),
        SimulationSchema,
      );

      if (request.previous) return request.previous;
      yield* requireRuleAccess(transaction, true);
      const rule = (yield* Db.readRule(transaction, command.scope.bookId, command.input.ruleId))[0];

      if (!rule) return yield* failure("NotFound");
      const startsOn = calendarDate(command.input.startsOn);
      const endsOn = calendarDate(command.input.endsOn);

      if (startsOn === null || endsOn === null || startsOn > endsOn) {
        return yield* failure("InvalidJournal");
      }

      const configured = objectOrNull(rule.body.input);
      const accountId = configured === null ? null : text(configured, "accountId");

      const counterpartAccountId =
        configured === null ? null : text(configured, "counterpartAccountId");

      if (accountId === null || counterpartAccountId === null) {
        return yield* failure("InternalError");
      }

      yield* Db.lockSelectionAccounts(transaction, command.scope.bookId, [
        accountId,
        counterpartAccountId,
      ]);
      yield* Db.lockSelectionPeriods(transaction, command.scope.bookId, startsOn, endsOn);

      const selected = (yield* Db.readSelection(
        transaction,
        command.scope.bookId,
        rule.body,
        startsOn,
        endsOn,
      ))[0];

      if (!selected?.current || selected.selection === null) {
        return yield* failure("StaleDependency");
      }

      const selection = yield* decode(SelectionSchema, selected.selection);

      if (selection.matchingCount > maximumSelectedObservations) {
        return yield* failure("InvalidJournal");
      }

      const id = newId("simulation");

      const base = yield* toJsonObject({
        startsOn: selection.startsOn,
        endsOn: selection.endsOn,
        sourceRevision: selection.sourceRevision,
        sequence: selection.sequence,
        rows: selection.rows,
        matchingCount: selection.matchingCount,
        totalMinor: selection.totalMinor,
        unmatchedCount: selection.unmatchedCount,
        alreadyMatchedCount: selection.alreadyMatchedCount,
        overlappingRuleIds: selection.overlappingRuleIds,
        blockers: selection.blockers,
        id,
        ruleId: rule.body.id,
        ruleDigest: rule.body.digest,
        createdAt: yield* isoNow(transaction),
        receipt: {
          key: command.idempotencyKey,
          operation: "simulate_recurring_rule",
          actorId: principal.actorId,
        },
      });

      const digest = yield* digestNative(base);

      if (digest === undefined) return yield* failure("InternalError");
      const body = yield* toJsonObject({ ...base, digest });
      yield* Db.insertSimulation(transaction, {
        bookId: command.scope.bookId,
        id,
        ruleId: command.input.ruleId,
        body,
      });
      const result = yield* decode(SimulationSchema, body);
      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        request.expected,
        "simulate_recurring_rule",
        principal.actorId,
        result,
      );

      return result;
    },
    "update",
  );
});

export const getSimulation = Effect.fn("recurring.getSimulation")(function* (
  token: string,
  command: { scope: Scope; simulationId: string },
) {
  return yield* withBook(token, command.scope, false, function* (transaction) {
    yield* requireRuleAccess(transaction, false);

    const simulation = (yield* Db.readSimulation(
      transaction,
      command.scope.bookId,
      command.simulationId,
    ))[0];

    if (!simulation) return yield* failure("NotFound");

    return yield* decode(SimulationSchema, simulation.body);
  });
});
