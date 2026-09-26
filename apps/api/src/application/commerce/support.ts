import * as Accounting from "@open-erp/contracts/accounting";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { readEvidence, readTableAccess, type JsonObject } from "../../db/commerce/access";
import { databaseFailure, type Transaction } from "../../db/transaction";
import { failure } from "../failures";
import { withAdmittedPrincipal, type AuthorityLockMode, type VerifiedPrincipal } from "../identity";

export type Scope = typeof Accounting.Scope.Type;

export type Principal = VerifiedPrincipal;

export type { JsonObject };

export function unsupported() {
  return failure("UnsupportedProfile");
}

export function decode<A>(schema: Schema.Decoder<A>, value: JsonObject) {
  return Schema.decodeEffect(schema)(value).pipe(Effect.mapError(() => failure("InternalError")));
}

export function toJsonObject(value: unknown) {
  return Schema.decodeUnknownEffect(Schema.JsonObject)(value).pipe(
    Effect.mapError(() => failure("InternalError")),
  );
}

export function withBook<Eff extends Effect.Effect<unknown, unknown, unknown>, A>(
  token: string,
  scope: Scope,
  operatorOnly: boolean,
  operation: (transaction: Transaction, principal: Principal) => Generator<Eff, A, never>,
  lockMode: AuthorityLockMode = "share",
) {
  return withAdmittedPrincipal(
    { token },
    scope,
    { operatorOnly },
    (transaction, principal) =>
      Effect.gen(() => operation(transaction, principal)).pipe(Effect.mapError(databaseFailure)),
    lockMode,
  );
}

const readOnlyLookups = new Set([
  "ar_legal_issues",
  "ar_legal_policies",
  "collection_statements",
  "commerce_counterparties",
  "commerce_counterparty_revisions",
  "commerce_invoices",
  "evidence",
  "execution_receipts",
  "invoice_issue_reviews",
  "invoice_issues",
  "memberships",
]);

export function requireTableAccess(
  transaction: Transaction,
  tableNames: ReadonlyArray<string>,
  write: boolean,
) {
  const inserts = write ? tableNames.filter((name) => !readOnlyLookups.has(name)) : [];

  return readTableAccess(transaction, tableNames).pipe(
    Effect.flatMap((rows) => {
      if (rows.length !== tableNames.length) return unsupported();

      const denied =
        rows.some((row) => !row.canSelect) ||
        inserts.some((name) => rows.find((row) => row.tableName === name)?.canInsert !== true);

      return denied ? unsupported() : Effect.void;
    }),
  );
}

export function requireInsertAccess(transaction: Transaction, tableNames: ReadonlyArray<string>) {
  if (tableNames.length === 0) return Effect.void;

  return readTableAccess(transaction, tableNames).pipe(
    Effect.flatMap((rows) => {
      const denied = rows.length !== tableNames.length || rows.some((row) => !row.canInsert);

      return denied ? unsupported() : Effect.void;
    }),
  );
}

export function exactKeys(value: JsonObject, keys: ReadonlyArray<string>) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();

  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    return failure("InvalidJournal");
  }

  return Effect.void;
}

export function requireText(value: string, maximum: number) {
  const trimmed = value.trim();

  if (trimmed.length === 0 || trimmed !== value || value.length > maximum) {
    return failure("InvalidJournal");
  }

  return Effect.void;
}

export function acknowledged(value: Schema.Json | undefined) {
  return value === true ? Effect.void : failure("StaleDependency");
}

export function isJsonObject(value: Schema.Json | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isJsonArray(value: Schema.Json | undefined): value is ReadonlyArray<Schema.Json> {
  return Array.isArray(value);
}

export function objectField(value: Schema.Json | undefined, key: string): JsonObject {
  const candidate = isJsonObject(value) ? value[key] : undefined;

  return isJsonObject(candidate) ? candidate : {};
}

export function textField(value: Schema.Json | undefined, key: string) {
  const candidate = isJsonObject(value) ? value[key] : undefined;

  return typeof candidate === "string" ? candidate : undefined;
}

export function commandReceipt(key: string, operation: string, actorId: string) {
  return { key, operation, actorId } satisfies JsonObject;
}

export function readEvidenceReference(
  transaction: Transaction,
  bookId: string,
  evidenceId: string,
) {
  return readEvidence(transaction, bookId, evidenceId).pipe(
    Effect.flatMap((rows) => {
      const row = rows[0];

      return row
        ? Effect.succeed({ evidenceId: row.id, sha256: row.sha256 })
        : failure("MissingEvidence");
    }),
  );
}

export function requireRetainedEvidence(
  transaction: Transaction,
  bookId: string,
  reference: JsonObject,
) {
  const evidenceId = textField(reference, "evidenceId");
  const sha256 = textField(reference, "sha256");

  if (evidenceId === undefined || sha256 === undefined) return failure("MissingEvidence");

  return readEvidence(transaction, bookId, evidenceId).pipe(
    Effect.flatMap((rows) =>
      rows[0]?.sha256 === sha256 ? Effect.void : failure("MissingEvidence"),
    ),
  );
}
