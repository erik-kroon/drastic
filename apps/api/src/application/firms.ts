import * as Accounting from "@open-erp/contracts/accounting";
import * as FirmContract from "@open-erp/contracts/firms";
import { sql } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { failure } from "./failures";
import { newId } from "./posting";
import { decode, exactKeys, toJsonObject, unsupported, withBook } from "./commerce/support";
import * as Db from "../db/firms";
import { admitHumanActor, lockActor, readAdmission, requireHumanSession } from "../db/human-actor";
import { withTransaction, databaseFailure, type Transaction } from "../db/transaction";
import { readTableAccess } from "../db/commerce/access";

type Scope = typeof Accounting.Scope.Type;

type JsonObject = Schema.JsonObject;

const CommandSchema = FirmContract.CommandResult;

const WorkspaceSchema = FirmContract.Workspace;

const FirmListSchema = FirmContract.FirmList;

const clientKeys = ["scope", "leadId", "nextReviewOn", "note", "expectedRevision"] as const;

const memberKeys = ["email", "role", "active", "expectedRevision"] as const;

const roles = ["admin", "accountant"] as const;

const maximumCreatedFirms = 100;

const maximumFirmClients = 200;

const maximumFirmMembers = 100;

const maximumFirmName = 100;

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

function decodeFirmList(value: typeof FirmListSchema.Type) {
  return Schema.decodeEffect(FirmListSchema)(value).pipe(
    Effect.mapError(() => failure("InternalError")),
  );
}

function requireAccess(transaction: Transaction) {
  const tables = [...Db.firmTables];

  return readTableAccess(transaction, tables).pipe(
    Effect.flatMap((rows) => {
      if (rows.length !== tables.length) return unsupported();

      return rows.some((row) => !row.canSelect) ? unsupported() : Effect.void;
    }),
  );
}

function text(value: JsonObject, key: string) {
  const found = value[key];

  return typeof found === "string" ? found : null;
}

function calendarDate(value: string | null) {
  if (value === null) return null;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const parsed = Date.parse(`${value}T00:00:00.000Z`);

  if (!Number.isFinite(parsed)) return undefined;

  return new Date(parsed).toISOString().slice(0, 10) === value ? value : undefined;
}

function oneOf<C extends string>(value: string, choices: ReadonlyArray<C>) {
  return choices.find((choice) => choice === value) ?? null;
}

function revisionOf(value: JsonObject) {
  const found = value.expectedRevision;

  if (typeof found !== "number" || !Number.isInteger(found)) return null;

  if (found < 0 || found > 2147483646) return null;

  return found;
}

function scopeOf(value: JsonObject, key: string) {
  const parsed = Schema.decodeUnknownOption(Schema.JsonObject)(value[key]);

  if (!Option.isSome(parsed)) return null;
  const entityId = text(parsed.value, "entityId");
  const bookId = text(parsed.value, "bookId");

  if (entityId === null || bookId === null) return null;

  return { entityId, bookId } satisfies Scope;
}

function replayFirm(
  transaction: Transaction,
  actorId: string,
  key: string,
  firmId: string,
  operation: string,
  payload: JsonObject,
) {
  return Effect.gen(function* () {
    if (!/^[a-zA-Z0-9_-]{8,128}$/.test(key)) return yield* failure("InvalidJournal");
    const row = (yield* Db.readCommand(transaction, actorId, key))[0];

    if (!row) return undefined;

    const digest = (yield* transaction.execute<{ readonly digest: string }>(
      sql`select openerp.digest(${JSON.stringify(payload)}::jsonb) as digest`,
      "objects",
    ))[0]?.digest;

    if (
      row.operation !== operation ||
      (operation !== "create" && row.firmId !== firmId) ||
      row.payloadDigest !== digest
    ) {
      return yield* failure("IdempotencyConflict");
    }

    return row.result;
  });
}

function recordFirm(
  transaction: Transaction,
  actorId: string,
  key: string,
  firmId: string,
  operation: string,
  payload: JsonObject,
  revision: number,
) {
  return Effect.gen(function* () {
    const result = yield* decode(CommandSchema, { firmId, revision });
    yield* Db.insertCommand(transaction, { actorId, key, firmId, operation, payload, result });

    return result;
  });
}

function readFirmRole(
  transaction: Transaction,
  firmId: string,
  actorId: string,
  access: { readonly lock: "share" | "update"; readonly adminOnly: boolean },
) {
  return Effect.gen(function* () {
    const firm = (yield* Db.lockFirm(transaction, firmId, access.lock))[0];

    if (!firm) return yield* failure("Forbidden");
    const membership = (yield* Db.readFirmMembership(transaction, firmId, actorId, "share"))[0];

    if (!membership?.active) return yield* failure("Forbidden");

    if (access.adminOnly && membership.role !== "admin") return yield* failure("Forbidden");

    return { name: firm.name, role: membership.role };
  });
}

export const listFirms = Effect.fn("firms.list")(function* (token: string) {
  return yield* withHuman(token, function* (transaction, actorId) {
    yield* requireAccess(transaction);

    if (
      (yield* Db.countOwnedFirmMemberships(transaction, actorId))[0]!.total > maximumFirmMembers
    ) {
      return yield* failure("Unavailable");
    }

    const rows = yield* Db.readOwnedFirmRoles(transaction, actorId);

    const listed = rows.map((row) => ({
      id: row.id,
      name: row.name,
      role: oneOf(row.role, roles),
    }));

    if (listed.some((row) => row.role === null)) return yield* failure("InternalError");

    return yield* decodeFirmList(
      listed.map((row) => ({ id: row.id, name: row.name, role: row.role ?? roles[0] })),
    );
  });
});

export const getFirm = Effect.fn("firms.get")(function* (
  token: string,
  command: { firmId: string },
) {
  return yield* withHuman(token, function* (transaction, actorId) {
    yield* requireAccess(transaction);

    const firm = yield* readFirmRole(transaction, command.firmId, actorId, {
      lock: "share",
      adminOnly: false,
    });

    yield* Db.lockClientBookMemberships(transaction, command.firmId);
    const team = yield* Db.readTeam(transaction, command.firmId);

    if (team.length > maximumFirmMembers) return yield* unsupported();
    const clients = yield* Db.readClientBooks(transaction, command.firmId, actorId);

    if (clients.length > maximumFirmClients) return yield* unsupported();

    return yield* decode(WorkspaceSchema, {
      firm: { id: command.firmId, name: firm.name, role: firm.role },
      actorId,
      members: team.map((row) => ({
        actorId: row.actorId,
        name: row.name,
        email: row.email,
        role: row.role,
        active: row.active,
        signInEnabled: row.signInEnabled,
        revision: row.revision,
      })),
      clients: clients.map((row) => ({
        book: {
          entityId: row.entityId,
          id: row.bookId,
          name: row.name,
          currency: row.currency,
          profile: row.profile,
          role: row.role,
          sequence: row.sequence,
        },
        leadId: row.leadId,
        leadAvailable: row.leadAvailable,
        eligibleLeadIds: row.eligibleLeadIds,
        nextReviewOn: row.nextReviewOn,
        note: row.note,
        revision: row.revision,
      })),
    });
  });
});

export const createFirm = Effect.fn("firms.create")(function* (
  token: string,
  command: { idempotencyKey: string; input: typeof FirmContract.CreateFirm.Type },
) {
  return yield* withHuman(token, function* (transaction, actorId) {
    yield* requireAccess(transaction);
    const payload = yield* toJsonObject(command.input);
    yield* exactKeys(payload, ["name"]);
    const name = text(payload, "name")?.trim() ?? "";

    if (name.length < 1 || name.length > maximumFirmName) return yield* failure("InvalidJournal");
    yield* lockActor(transaction, actorId);

    const previous = yield* replayFirm(
      transaction,
      actorId,
      command.idempotencyKey,
      "",
      "create",
      payload,
    );

    if (previous) return yield* decode(CommandSchema, previous);

    if ((yield* Db.countCreatedFirms(transaction, actorId))[0]!.total >= maximumCreatedFirms) {
      return yield* failure("InvalidJournal");
    }

    const firmId = newId("firm");
    yield* Db.insertFirm(transaction, { firmId, name, actorId });
    yield* Db.insertFirmAdmin(transaction, { firmId, actorId });

    return yield* recordFirm(
      transaction,
      actorId,
      command.idempotencyKey,
      firmId,
      "create",
      payload,
      1,
    );
  });
});

export const saveFirmClient = Effect.fn("firms.saveClient")(function* (
  token: string,
  command: {
    firmId: string;
    idempotencyKey: string;
    input: typeof FirmContract.SaveClient.Type;
  },
) {
  const payload = yield* toJsonObject(command.input);
  const bookScope = scopeOf(payload, "scope");

  if (!bookScope) return yield* failure("InvalidJournal");

  return yield* withBook(
    token,
    bookScope,
    true,
    function* (transaction, principal) {
      yield* requireHumanSession(principal);
      yield* requireAccess(transaction);

      const firm = yield* readFirmRole(transaction, command.firmId, principal.actorId, {
        lock: "update",
        adminOnly: false,
      });

      const previous = yield* replayFirm(
        transaction,
        principal.actorId,
        command.idempotencyKey,
        command.firmId,
        "save_client",
        payload,
      );

      if (previous) return yield* decode(CommandSchema, previous);
      yield* exactKeys(payload, [...clientKeys]);
      const note = text(payload, "note");

      if (note === null || note.length > 2000) return yield* failure("InvalidJournal");

      if (payload.leadId !== null && text(payload, "leadId") === null) {
        return yield* failure("InvalidJournal");
      }

      const leadId = text(payload, "leadId");
      const nextReviewOn = calendarDate(text(payload, "nextReviewOn"));

      if (nextReviewOn === undefined) return yield* failure("InvalidJournal");
      const expectedRevision = revisionOf(payload);

      if (expectedRevision === null) return yield* failure("InvalidJournal");

      if (leadId !== null) {
        const lead = yield* Db.lockLeadMembership(
          transaction,
          command.firmId,
          bookScope.bookId,
          leadId,
        );

        if (lead.length === 0) return yield* failure("InvalidJournal");
      }

      const current = (yield* Db.readClient(transaction, command.firmId, bookScope.bookId))[0];

      if ((current?.revision ?? 0) !== expectedRevision) return yield* failure("StaleDependency");

      if (current === undefined) {
        if (firm.role !== "admin") return yield* failure("Forbidden");

        if ((yield* Db.countClients(transaction, command.firmId))[0]!.total >= maximumFirmClients) {
          return yield* failure("InvalidJournal");
        }
      }

      const revision = (yield* Db.nextFirmRevision(transaction, command.firmId))[0]?.revision;

      if (revision === undefined) return yield* failure("NotFound");
      yield* Db.upsertClient(transaction, {
        firmId: command.firmId,
        bookId: bookScope.bookId,
        leadId,
        nextReviewOn,
        note,
        revision,
      });

      return yield* recordFirm(
        transaction,
        principal.actorId,
        command.idempotencyKey,
        command.firmId,
        "save_client",
        payload,
        revision,
      );
    },
    "update",
  );
});

export const removeFirmClient = Effect.fn("firms.removeClient")(function* (
  token: string,
  command: {
    firmId: string;
    idempotencyKey: string;
    input: typeof FirmContract.RemoveClient.Type;
  },
) {
  const payload = yield* toJsonObject(command.input);
  const bookScope = scopeOf(payload, "scope");

  if (!bookScope) return yield* failure("InvalidJournal");

  return yield* withBook(
    token,
    bookScope,
    true,
    function* (transaction, principal) {
      yield* requireHumanSession(principal);
      yield* requireAccess(transaction);
      yield* readFirmRole(transaction, command.firmId, principal.actorId, {
        lock: "update",
        adminOnly: true,
      });

      const previous = yield* replayFirm(
        transaction,
        principal.actorId,
        command.idempotencyKey,
        command.firmId,
        "remove_client",
        payload,
      );

      if (previous) return yield* decode(CommandSchema, previous);
      yield* exactKeys(payload, ["scope", "expectedRevision"]);
      const expectedRevision = revisionOf(payload);

      if (expectedRevision === null) return yield* failure("InvalidJournal");
      const current = (yield* Db.readClient(transaction, command.firmId, bookScope.bookId))[0];

      if (current === undefined || current.revision !== expectedRevision) {
        return yield* failure("StaleDependency");
      }

      yield* Db.deleteClient(transaction, command.firmId, bookScope.bookId);
      const revision = (yield* Db.nextFirmRevision(transaction, command.firmId))[0]?.revision;

      if (revision === undefined) return yield* failure("NotFound");

      return yield* recordFirm(
        transaction,
        principal.actorId,
        command.idempotencyKey,
        command.firmId,
        "remove_client",
        payload,
        revision,
      );
    },
    "update",
  );
});

export const saveFirmMember = Effect.fn("firms.saveMember")(function* (
  token: string,
  command: {
    firmId: string;
    idempotencyKey: string;
    input: typeof FirmContract.SaveMember.Type;
  },
) {
  return yield* withHuman(token, function* (transaction, actorId) {
    yield* requireAccess(transaction);
    yield* readFirmRole(transaction, command.firmId, actorId, { lock: "update", adminOnly: true });
    const payload = yield* toJsonObject(command.input);

    const previous = yield* replayFirm(
      transaction,
      actorId,
      command.idempotencyKey,
      command.firmId,
      "save_member",
      payload,
    );

    if (previous) return yield* decode(CommandSchema, previous);
    yield* exactKeys(payload, [...memberKeys]);
    const email = text(payload, "email");

    if (email === null || email.trim().length < 3 || email.trim().length > 254) {
      return yield* failure("InvalidJournal");
    }

    const role = text(payload, "role");

    if (role === null || !roles.some((choice) => choice === role)) {
      return yield* failure("InvalidJournal");
    }

    const active = payload.active;

    if (typeof active !== "boolean") return yield* failure("InvalidJournal");
    const expectedRevision = revisionOf(payload);

    if (expectedRevision === null) return yield* failure("InvalidJournal");
    const target = (yield* Db.lookupUserByEmail(transaction, email.trim()))[0];

    if (!target) return yield* failure("InvalidJournal");

    if (active && (yield* readAdmission(transaction, target.id))[0]?.enabled === false) {
      return yield* failure("InvalidJournal");
    }

    const current = (yield* Db.readMemberMembership(transaction, command.firmId, target.id))[0];

    if ((current?.revision ?? 0) !== expectedRevision) return yield* failure("StaleDependency");

    if (
      current?.active === true &&
      current.role === "admin" &&
      (role !== "admin" || !active) &&
      (yield* Db.countSignableAdmins(transaction, command.firmId))[0]!.total <= 1
    ) {
      return yield* failure("InvalidJournal");
    }

    if (
      current === undefined &&
      (yield* Db.countMembers(transaction, command.firmId))[0]!.total >= maximumFirmMembers
    ) {
      return yield* failure("InvalidJournal");
    }

    const revision = (yield* Db.nextFirmRevision(transaction, command.firmId))[0]?.revision;

    if (revision === undefined) return yield* failure("NotFound");
    yield* Db.upsertMember(transaction, {
      firmId: command.firmId,
      actorId: target.id,
      role,
      active,
      revision,
    });

    return yield* recordFirm(
      transaction,
      actorId,
      command.idempotencyKey,
      command.firmId,
      "save_member",
      payload,
      revision,
    );
  });
});
