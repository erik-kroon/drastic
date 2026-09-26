import * as Accounting from "@open-erp/contracts/accounting";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { canonicalizeJson, equalJson } from "@open-erp/domain/canonicalization";
import { failure } from "../failures";
import { withAdmittedPrincipal, type AuthorityLockMode, type VerifiedPrincipal } from "../identity";
import { databaseFailure, type Transaction } from "../../db/transaction";
import * as PurchaseDb from "../../db/purchases/shared";

export { PurchaseDb };

export type Scope = typeof Accounting.Scope.Type;
export type Principal = VerifiedPrincipal;
export type Json = Schema.Json;
export type JsonObject = Schema.JsonObject;

export const commerceProfile = "synthetic-core-v1";
export const commerceAuthority = "native";
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
] as const;

const mutableColumns = new Map([
  ["supplier_invoice_drafts", ["current_revision"]],
  ["supplier_inbox", ["draft_id", "review_reason", "review_attempt_id"]],
]);

export const draftKeyPattern = /^[a-z][a-z0-9_-]{2,127}$/;
export const lineIdPattern = /^[a-z][a-z0-9_-]{2,127}$/;
export const quantityPattern = /^([1-9][0-9]{0,11}|(0|[1-9][0-9]{0,11})\.[0-9]{0,5}[1-9])$/;
export const minorPattern = /^(0|[1-9][0-9]{0,37})$/;
export const digestPattern = /^sha256:[a-f0-9]{64}$/;
export const seriesPattern = /^[A-Z0-9]{1,16}$/;
export const datePattern = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
export const identifierPattern = /^[a-z][a-z0-9_-]{2,127}$/;

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
  return PurchaseDb.readColumnUpdateAccess(transaction, names).pipe(
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
    const rows = yield* PurchaseDb.readTableAccess(transaction);
    const find = (name: string) => rows.find((row) => row.tableName === name);
    const denied =
      selects.some((name) => find(name)?.canSelect !== true) ||
      inserts.some((name) => find(name)?.canInsert !== true);
    if (denied) return yield* unsupported();
    yield* requireMutableColumns(transaction, updates);
  });
}

export function requireColumns(transaction: Transaction, names: ReadonlyArray<string>) {
  return PurchaseDb.readColumnAccess(transaction, names).pipe(
    Effect.flatMap((rows) => {
      const denied = names.some((name) => {
        const access = rows.find((row) => row.columnName === name);
        return access === undefined || !access.canSelect;
      });
      return denied ? unsupported() : Effect.void;
    }),
  );
}

export function readBook(transaction: Transaction, bookId: string) {
  return PurchaseDb.lockBook(transaction, bookId, "update").pipe(
    Effect.flatMap((rows) => {
      const book = rows[0];
      return book ? Effect.succeed(book) : failure("Forbidden");
    }),
  );
}

export function requireNativeCommerceProfile(profile: string, authority: string) {
  return profile === commerceProfile && authority === commerceAuthority
    ? Effect.void
    : unsupported();
}

export function isJsonObject(value: unknown): value is JsonObject {
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

export function evidenceReference(id: string, sha256: string) {
  return { evidenceId: id, sha256 } satisfies JsonObject;
}

export function readEvidenceReference(
  transaction: Transaction,
  bookId: string,
  evidenceId: string,
) {
  return PurchaseDb.readEvidence(transaction, bookId, evidenceId).pipe(
    Effect.flatMap((rows) => {
      const row = rows[0];
      return row
        ? Effect.succeed(evidenceReference(row.id, row.sha256))
        : failure("MissingEvidence");
    }),
  );
}

export function evidenceHasPostedHistory(
  transaction: Transaction,
  bookId: string,
  evidenceId: string,
) {
  return PurchaseDb.readPostedEvidencePresence(transaction, bookId, evidenceId).pipe(
    Effect.map((rows) => rows[0]?.present === true),
  );
}
