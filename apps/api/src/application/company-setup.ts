import { digest as digestNative } from "./json";
import * as Accounting from "@open-erp/contracts/accounting";
import * as CompanySetupContract from "@open-erp/contracts/company-setup";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { failure } from "./failures";
import { newId } from "./identifiers";
import { decode, exactKeys, toJsonObject, unsupported, withBook } from "./commerce/support";
import * as Db from "../db/company-setup";
import * as LedgerSetupDb from "../db/company-ledger-setup";
import { admitHumanActor, lockActor } from "../db/human-actor";
import { withTransaction, databaseFailure, type Transaction } from "../db/transaction";
import { readTableAccess } from "../db/commerce/access";
import { authorize } from "./authority";

type Scope = typeof Accounting.Scope.Type;

type JsonObject = Schema.JsonObject;

const SetupSchema = CompanySetupContract.CompanySetup;

const detailKeys = [
  "name",
  "legalForm",
  "organizationNumber",
  "accountingMethod",
  "vatRegistered",
  "vatPeriod",
  "fiscalYearStartsOn",
  "fiscalYearEndsOn",
  "historyChoice",
  "bankChoice",
] as const;

const requiredFields = [
  "legalForm",
  "organizationNumber",
  "accountingMethod",
  "vatRegistered",
  "fiscalYearStartsOn",
  "fiscalYearEndsOn",
] as const;

const legalForms = ["aktiebolag", "enskild_firma"] as const;

const accountingMethods = ["accrual", "cash"] as const;

const vatPeriods = ["monthly", "quarterly", "yearly"] as const;

const historyChoices = ["new_business", "sie", "opening_balances"] as const;

const bankChoices = ["connect", "file", "later"] as const;

const maximumCreatedCompanies = 2000;

const maximumCompanyName = 200;

function withHuman<Eff extends Effect.Effect<unknown, unknown, unknown>, A>(
  token: string,
  operation: (transaction: Transaction, actor: string) => Generator<Eff, A, never>,
) {
  return withTransaction((transaction) =>
    Effect.gen(function* () {
      const actor = yield* admitHumanActor(transaction, token);

      return yield* Effect.gen(() => operation(transaction, actor.actorId));
    }).pipe(Effect.mapError(databaseFailure)),
  );
}

function text(value: JsonObject, key: string) {
  const found = value[key];

  return typeof found === "string" ? found : null;
}

function calendarDate(value: string | null) {
  if (value === null) return null;

  return Accounting.isCalendarDate(value) ? Date.parse(`${value}T00:00:00.000Z`) : undefined;
}

function requireAccess(transaction: Transaction) {
  const tables = [...Db.companySetupTables];

  return readTableAccess(transaction, tables).pipe(
    Effect.flatMap((rows) => {
      if (rows.length !== tables.length) return unsupported();

      return rows.some((row) => !row.canSelect) ? unsupported() : Effect.void;
    }),
  );
}

function validateDetails(value: JsonObject) {
  return Effect.gen(function* () {
    yield* exactKeys(value, [...detailKeys]);
    const name = text(value, "name");

    if (name === null || name.trim().length < 1 || name.trim().length > maximumCompanyName) {
      return yield* failure("InvalidJournal");
    }

    const choices: ReadonlyArray<[string, ReadonlyArray<string>]> = [
      ["legalForm", legalForms],
      ["accountingMethod", accountingMethods],
      ["vatPeriod", vatPeriods],
      ["historyChoice", historyChoices],
      ["bankChoice", bankChoices],
    ];

    for (const [field, allowed] of choices) {
      if (value[field] !== null && !allowed.some((choice) => choice === text(value, field))) {
        return yield* failure("InvalidJournal");
      }
    }

    const organizationNumber = text(value, "organizationNumber");

    if (organizationNumber !== null && !/^\d{10}$/.test(organizationNumber)) {
      return yield* failure("InvalidJournal");
    }

    const vatRegistered = value.vatRegistered;

    if (vatRegistered !== null && typeof vatRegistered !== "boolean") {
      return yield* failure("InvalidJournal");
    }

    if (text(value, "vatPeriod") !== null && vatRegistered !== true) {
      return yield* failure("InvalidJournal");
    }

    const starts = calendarDate(text(value, "fiscalYearStartsOn"));
    const ends = calendarDate(text(value, "fiscalYearEndsOn"));

    if (starts === undefined || ends === undefined) return yield* failure("InvalidJournal");

    if (starts !== null && ends !== null && starts > ends) return yield* failure("InvalidJournal");
  });
}

function defaultDetails(name: string): JsonObject {
  return {
    name,
    legalForm: null,
    organizationNumber: null,
    accountingMethod: null,
    vatRegistered: null,
    vatPeriod: null,
    fiscalYearStartsOn: null,
    fiscalYearEndsOn: null,
    historyChoice: null,
    bankChoice: null,
  };
}

function setupSnapshot(bookId: string, book: Db.BookSetupRow, setup: Db.SetupRow | undefined) {
  const details = setup === undefined ? defaultDetails(book.name) : setup.details;
  const missing: Array<string> = requiredFields.filter((field) => details[field] === null);

  if (details.vatRegistered === true && details.vatPeriod === null) missing.push("vatPeriod");

  return {
    scope: { entityId: book.entityId, bookId },
    revision: setup?.revision ?? 0,
    details,
    missing,
    state: missing.length === 0 ? "details_recorded" : "incomplete",
    accountingProfile: book.profile,
  } satisfies JsonObject;
}

function readSnapshot(transaction: Transaction, bookId: string, lock: boolean) {
  return Effect.gen(function* () {
    const book = (yield* Db.readSetupBook(transaction, bookId))[0];

    if (!book) return yield* failure("NotFound");
    const setup = (yield* Db.readSetup(transaction, bookId, lock))[0];

    return setupSnapshot(bookId, book, setup);
  });
}

function replaySetup(
  transaction: Transaction,
  actorId: string,
  key: string,
  operation: string,
  bookId: string,
  payload: JsonObject,
) {
  return Effect.gen(function* () {
    if (!/^[a-zA-Z0-9_-]{8,128}$/.test(key)) return yield* failure("InvalidJournal");
    const row = (yield* Db.readCommand(transaction, actorId, key))[0];

    if (!row) return undefined;
    const expected = yield* digestNative(payload);

    if (!expected) return yield* failure("InternalError");

    if (row.operation !== operation || row.payloadDigest !== expected) {
      return yield* failure("IdempotencyConflict");
    }

    if (operation !== "create" && row.bookId !== bookId)
      return yield* failure("IdempotencyConflict");

    return row.result;
  });
}

function nativeMonthlyCalendar(input: typeof CompanySetupContract.InitializeNativeLedger.Type) {
  return Effect.gen(function* () {
    const start = new Date(`${input.startsOn}T00:00:00.000Z`);
    const end = new Date(`${input.endsOn}T00:00:00.000Z`);
    const afterEnd = new Date(end);
    afterEnd.setUTCDate(afterEnd.getUTCDate() + 1);

    if (start > end || afterEnd.getUTCDate() !== 1) return yield* failure("InvalidJournal");

    const anniversary = new Date(start);
    anniversary.setUTCDate(1);
    anniversary.setUTCMonth(anniversary.getUTCMonth() + 18);

    const lastAnniversaryDay = new Date(anniversary);
    lastAnniversaryDay.setUTCMonth(lastAnniversaryDay.getUTCMonth() + 1, 0);
    anniversary.setUTCDate(Math.min(start.getUTCDate(), lastAnniversaryDay.getUTCDate()));

    if (end >= anniversary) return yield* failure("InvalidJournal");

    const calendar: Array<{ id: string; startsOn: string; endsOn: string }> = [];
    const cursor = new Date(start);

    while (cursor <= end) {
      const monthEnd = new Date(cursor);
      monthEnd.setUTCMonth(monthEnd.getUTCMonth() + 1, 0);
      const periodEnd = monthEnd > end ? end : monthEnd;
      calendar.push({
        id: newId("period"),
        startsOn: cursor.toISOString().slice(0, 10),
        endsOn: periodEnd.toISOString().slice(0, 10),
      });
      cursor.setTime(periodEnd.getTime());
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    return calendar;
  });
}

export const initializeNativeLedger = Effect.fn("companySetup.initializeNativeLedger")(function* (
  token: string,
  command: {
    scope: Scope;
    idempotencyKey: string;
    input: typeof CompanySetupContract.InitializeNativeLedger.Type;
  },
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (transaction, principal) {
      yield* authorize(principal, "initialize_native_ledger");
      yield* requireAccess(transaction);
      const actorId = principal.actorId;
      yield* lockActor(transaction, actorId);

      const payload = yield* toJsonObject(command.input);

      const input = yield* Schema.decodeUnknownEffect(CompanySetupContract.InitializeNativeLedger)(
        payload,
        { onExcessProperty: "error" },
      ).pipe(Effect.mapError((cause) => failure("InvalidRequest", cause)));

      const previous = yield* replaySetup(
        transaction,
        actorId,
        command.idempotencyKey,
        "native_ledger",
        command.scope.bookId,
        payload,
      );

      if (previous) return yield* decode(CompanySetupContract.NativeLedgerSetup, previous);

      const book = (yield* Db.readSetupBook(transaction, command.scope.bookId))[0];
      const setup = (yield* Db.readSetup(transaction, command.scope.bookId, true))[0];

      if (!book || !setup) return yield* failure("UnsupportedProfile");

      if (setup.revision !== input.expectedRevision) return yield* failure("StaleDependency");

      const ledger = (yield* LedgerSetupDb.readInitialLedgerState(
        transaction,
        command.scope.bookId,
      ))[0];

      if (book.profile !== "company-setup-v1" || ledger?.authority !== "native" || !ledger.empty)
        return yield* failure("UnsupportedProfile");

      if (new Set(input.accounts.map((account) => account.code)).size !== input.accounts.length)
        return yield* failure("InvalidJournal");

      const result = yield* Schema.decodeEffect(CompanySetupContract.NativeLedgerSetup)({
        scope: command.scope,
        fiscalYear: { id: newId("year"), startsOn: input.startsOn, endsOn: input.endsOn },
        periods: yield* nativeMonthlyCalendar(input),
        accounts: input.accounts.map((account) => ({
          id: newId("account"),
          code: account.code,
          name: account.name.trim(),
        })),
        setupRevision: setup.revision,
      }).pipe(Effect.mapError((cause) => failure("InternalError", cause)));

      yield* LedgerSetupDb.insertFiscalYear(transaction, result);
      yield* LedgerSetupDb.insertMonthlyPeriods(transaction, result);
      yield* LedgerSetupDb.insertNativeAccounts(transaction, result);
      yield* Db.insertCommand(transaction, {
        actorId,
        key: command.idempotencyKey,
        bookId: command.scope.bookId,
        operation: "native_ledger",
        payload,
        result: yield* toJsonObject(result),
      });

      return result;
    },
    "update",
  );
});

export const createCompany = Effect.fn("companySetup.create")(function* (
  token: string,
  command: { idempotencyKey: string; input: typeof CompanySetupContract.CreateCompany.Type },
) {
  return yield* withHuman(token, function* (transaction, actorId) {
    yield* requireAccess(transaction);
    const input = yield* toJsonObject(command.input);
    yield* exactKeys(input, ["name"]);
    const name = text(input, "name")?.trim() ?? "";

    if (name.length < 1 || name.length > maximumCompanyName) {
      return yield* failure("InvalidJournal");
    }

    yield* lockActor(transaction, actorId);

    const previous = yield* replaySetup(
      transaction,
      actorId,
      command.idempotencyKey,
      "create",
      "",
      input,
    );

    if (previous) return yield* decode(SetupSchema, previous);

    if (
      (yield* Db.countCreatedCompanies(transaction, actorId))[0]!.total >= maximumCreatedCompanies
    ) {
      return yield* failure("InvalidJournal");
    }

    const entityId = newId("entity");
    const bookId = newId("book");
    yield* Db.insertEntity(transaction, { entityId, name });
    yield* Db.insertBook(transaction, { bookId, entityId, name });
    yield* Db.insertOperatorMembership(transaction, { bookId, actorId });
    yield* Db.upsertSetup(transaction, {
      bookId,
      details: defaultDetails(name),
      revision: 1,
      actorId,
    });
    const result = yield* decode(SetupSchema, yield* readSnapshot(transaction, bookId, false));
    yield* Db.insertCommand(transaction, {
      actorId,
      key: command.idempotencyKey,
      bookId,
      operation: "create",
      payload: input,
      result,
    });

    return result;
  });
});

export const getCompanySetup = Effect.fn("companySetup.get")(function* (
  token: string,
  command: { scope: Scope },
) {
  return yield* withBook(token, command.scope, false, function* (transaction) {
    yield* requireAccess(transaction);

    return yield* decode(
      SetupSchema,
      yield* readSnapshot(transaction, command.scope.bookId, false),
    );
  });
});

export const saveCompanySetup = Effect.fn("companySetup.save")(function* (
  token: string,
  command: {
    scope: Scope;
    idempotencyKey: string;
    input: typeof CompanySetupContract.SaveCompanySetup.Type;
  },
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (transaction, principal) {
      yield* requireAccess(transaction);
      yield* lockActor(transaction, principal.actorId);
      const payload = yield* toJsonObject(command.input);

      const previous = yield* replaySetup(
        transaction,
        principal.actorId,
        command.idempotencyKey,
        "save",
        command.scope.bookId,
        payload,
      );

      if (previous) return yield* decode(SetupSchema, previous);
      yield* exactKeys(payload, ["expectedRevision", "details"]);
      const expectedRevision = payload.expectedRevision;

      if (
        typeof expectedRevision !== "number" ||
        !Number.isInteger(expectedRevision) ||
        expectedRevision < 0 ||
        expectedRevision > 2147483646
      ) {
        return yield* failure("InvalidJournal");
      }

      const validated = yield* toJsonObject(payload.details);
      yield* validateDetails(validated);
      yield* Db.lockSetupBook(transaction, command.scope.bookId);
      const book = (yield* Db.readSetupBook(transaction, command.scope.bookId))[0];

      if (!book) return yield* failure("NotFound");
      const current = (yield* Db.readSetup(transaction, command.scope.bookId, true))[0];

      if ((current?.revision ?? 0) !== expectedRevision) return yield* failure("StaleDependency");
      const name = (text(validated, "name") ?? "").trim();
      yield* Db.upsertSetup(transaction, {
        bookId: command.scope.bookId,
        details: { ...command.input.details, name },
        revision: expectedRevision + 1,
        actorId: principal.actorId,
      });
      yield* Db.renameBook(transaction, command.scope.bookId, name);

      const result = yield* decode(
        SetupSchema,
        yield* readSnapshot(transaction, command.scope.bookId, true),
      );

      yield* Db.insertCommand(transaction, {
        actorId: principal.actorId,
        key: command.idempotencyKey,
        bookId: command.scope.bookId,
        operation: "save",
        payload,
        result,
      });

      return result;
    },
    "update",
  );
});
