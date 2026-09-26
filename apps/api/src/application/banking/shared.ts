import * as Accounting from "@open-erp/contracts/accounting";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { canonicalizeJson, equalJson } from "@open-erp/domain/canonicalization";
import { failure } from "../failures";
import { withAdmittedPrincipal, type AuthorityLockMode, type VerifiedPrincipal } from "../identity";
import { databaseFailure, type Transaction } from "../../db/transaction";
import * as BankDb from "../../db/banking/shared";
import type { StatementRow } from "../../db/banking/statements";

export type Scope = typeof Accounting.Scope.Type;
export type Principal = VerifiedPrincipal;
export type JsonObject = Schema.JsonObject;
export type Json = Schema.Json;

export const bankProfile = "synthetic-core-v1";
export const identifierPattern = /^[a-z][a-z0-9_-]{2,127}$/;
export const accountColumns = [
  "books.profile",
  "books.authority",
  "books.profile_version",
  "books.writer_epoch",
  "books.currency",
  "books.currency_scale",
  "books.committed_sequence",
  "accounts.version",
  "periods.version",
  "periods.locked",
  "closing_inventories.ordinal",
] as const;

const mutableColumns = new Map([
  ["bank_connector_consents", ["revoked_at", "cursor"]],
  ["bank_sources", ["revision"]],
]);

export function unsupported() {
  return failure("UnsupportedProfile");
}

export function decode<A>(schema: Schema.Decoder<A>, value: JsonObject) {
  return Schema.decodeEffect(schema)(value).pipe(Effect.mapError(() => failure("InternalError")));
}

export function toJsonObject<A>(value: A) {
  return Schema.encodeUnknownEffect(Schema.JsonObject)(value).pipe(
    Effect.mapError(() => failure("InternalError")),
  );
}

export function withBook<A>(
  token: string,
  scope: Scope,
  operatorOnly: boolean,
  lockMode: AuthorityLockMode,
  operation: (transaction: Transaction, principal: Principal) => Effect.Effect<A, unknown, never>,
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

function mutableColumnNames(table: string) {
  return mutableColumns.get(table) ?? [];
}

function requireMutableColumns(transaction: Transaction, tables: ReadonlyArray<string>) {
  if (tables.length === 0) return Effect.void;
  if (tables.some((table) => mutableColumnNames(table).length === 0)) return unsupported();
  const names = tables.flatMap((table) =>
    mutableColumnNames(table).map((column) => `${table}.${column}`),
  );
  return BankDb.readColumnUpdateAccess(transaction, names).pipe(
    Effect.flatMap((rows) =>
      rows.length === names.length && rows.every((row) => row.canUpdate)
        ? Effect.void
        : unsupported(),
    ),
  );
}

export function requireTables(
  transaction: Transaction,
  selects: ReadonlyArray<string>,
  inserts: ReadonlyArray<string> = [],
  updates: ReadonlyArray<string> = [],
) {
  return Effect.gen(function* () {
    const rows = yield* BankDb.readTableAccess(transaction);
    const find = (name: string) => rows.find((row) => row.tableName === name);
    const missingSelect = selects.some((name) => find(name)?.canSelect !== true);
    const missingInsert = inserts.some((name) => find(name)?.canInsert !== true);
    if (missingSelect || missingInsert) return yield* unsupported();
    yield* requireMutableColumns(transaction, updates);
  });
}

export function requireColumns(transaction: Transaction, names: ReadonlyArray<string>) {
  return BankDb.readColumnAccess(transaction, names).pipe(
    Effect.flatMap((rows) => {
      const denied = names.some((name) => {
        const access = rows.find((row) => row.columnName === name);
        return access === undefined || !access.canSelect;
      });
      return denied ? unsupported() : Effect.void;
    }),
  );
}

export function isJsonObject(value: Json | undefined | null): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function objectField(value: Json | undefined | null, key: string): JsonObject {
  const candidate = isJsonObject(value) ? value[key] : undefined;
  return isJsonObject(candidate) ? candidate : {};
}

export function arrayField(value: Json | undefined | null, key: string): ReadonlyArray<Json> {
  const candidate = isJsonObject(value) ? value[key] : undefined;
  return Array.isArray(candidate) ? candidate : [];
}

export function textField(value: Json | undefined | null, key: string) {
  const candidate = isJsonObject(value) ? value[key] : undefined;
  return typeof candidate === "string" ? candidate : undefined;
}

export function booleanField(value: Json | undefined | null, key: string) {
  const candidate = isJsonObject(value) ? value[key] : undefined;
  return typeof candidate === "boolean" ? candidate : undefined;
}

export function numberField(value: Json | undefined | null, key: string) {
  const candidate = isJsonObject(value) ? value[key] : undefined;
  return typeof candidate === "number" ? candidate : undefined;
}

export function isEmptyJsonArray(value: Json | undefined | null) {
  return Array.isArray(value) && value.length === 0;
}

export function sameJson(left: Json | undefined | null, right: Json | undefined | null) {
  return equalJson(left ?? null, right ?? null);
}

// PostgreSQL jsonb does not preserve key order, so stored bodies are compared
// against freshly built values through their canonical form.
export function sameCanonical(left: JsonObject, right: JsonObject) {
  return Effect.gen(function* () {
    const first = canonicalizeJson(left);
    const second = canonicalizeJson(right);
    if (first._tag === "Failure" || second._tag === "Failure") {
      return yield* failure("InternalError");
    }
    return first.success.json === second.success.json;
  });
}

export function canonicalText(value: JsonObject) {
  return Effect.gen(function* () {
    const canonical = yield* Effect.sync(() => canonicalizeJson(value));
    if (canonical._tag === "Failure") return yield* failure("InternalError");
    return canonical.success.json;
  });
}

export function byteLength(value: string) {
  return new TextEncoder().encode(value).byteLength;
}

export function receipt(key: string, operation: string, actorId: string) {
  return { key, operation, actorId } satisfies JsonObject;
}

export function requireNativeBankProfile(profile: string, authority: string) {
  return profile === bankProfile && authority === "native" ? Effect.void : unsupported();
}

export function readCheckpoint(transaction: Transaction, bookId: string, accountId: string) {
  return BankDb.readCheckpoint(transaction, bookId, accountId).pipe(
    Effect.flatMap((rows) => {
      const row = rows[0];
      return row
        ? Effect.succeed({ sequence: row.sequence, sourceRevision: row.sourceRevision })
        : failure("Forbidden");
    }),
  );
}

export function statementBody(row: StatementRow) {
  return Object.assign({}, row.source, {
    id: row.id,
    evidenceId: row.evidenceId,
    evidenceSha256: row.evidenceSha256,
  }) satisfies JsonObject;
}

export function isCalendarDate(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function nextDay(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!isCalendarDate(value)) return undefined;
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

export function dayDistance(left: string, right: string) {
  const first = Date.parse(`${left}T00:00:00.000Z`);
  const second = Date.parse(`${right}T00:00:00.000Z`);
  if (!Number.isFinite(first) || !Number.isFinite(second)) return undefined;
  return Math.abs(Math.round((first - second) / 86400000));
}

export function minor(value: string | null | undefined) {
  if (value === null || value === undefined) return undefined;
  if (!/^(0|-?[1-9][0-9]*)$/.test(value)) return undefined;
  return BigInt(value);
}

export function signedText(value: bigint) {
  return value.toString();
}

export function absolute(value: bigint) {
  return value < 0n ? -value : value;
}

export function signOf(value: bigint) {
  if (value > 0n) return 1;
  if (value < 0n) return -1;
  return 0;
}
