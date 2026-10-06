import * as Effect from "effect/Effect";
import type * as Schema from "effect/Schema";
import { equalJson } from "@open-erp/domain/canonicalization";
import * as Db from "../../db/payroll/mileage-corrections";
import type { Transaction } from "../../db/transaction";
import { decode, requireTableAccess, toJsonObject, type Scope } from "../commerce/support";
import { digest } from "../posting";
import { failure } from "../failures";
import { requireSettlementAccess } from "./settlement-support";

export const requireMileageAccess = Effect.fn("mileage.access")(function* (
  tx: Transaction,
  scope: Scope,
  actorId: string,
  write: boolean,
) {
  yield* requireSettlementAccess(tx, scope, actorId, write);
  yield* requireTableAccess(tx, Db.mileageTables, write);
});

export const readMileageRecord = Effect.fn("mileage.readRecord")(function* <A>(
  tx: Transaction,
  scope: Scope,
  table: (typeof Db.mileageRecordTables)[number],
  id: string,
  schema: Schema.Decoder<A>,
) {
  const row = (yield* Db.record(tx, scope.bookId, table, id))[0];

  if (!row) return yield* failure("NotFound");

  const body = Object.fromEntries(Object.entries(row.body).filter(([name]) => name !== "digest"));

  if (
    row.body.id !== id ||
    !equalJson(row.body.scope, scope) ||
    (yield* digest(body)) !== row.body.digest
  )
    return yield* failure("StaleDependency");

  return yield* decode(schema, row.body);
});

export const persistMileageRecord = Effect.fn("mileage.persist")(function* (
  tx: Transaction,
  table: (typeof Db.mileageRecordTables)[number],
  record: { readonly id: string; readonly scope: Scope; readonly digest: string },
) {
  yield* Db.insert(tx, table, record, yield* toJsonObject(record));
});
