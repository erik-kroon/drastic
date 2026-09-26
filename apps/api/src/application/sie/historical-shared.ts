import * as Historical from "@open-erp/contracts/historical-migration";
import * as Sie from "@open-erp/contracts/sie-import";
import * as Effect from "effect/Effect";
import * as Db from "../../db/historical";
import * as SourceDb from "../../db/sie-import";
import type { Transaction } from "../../db/transaction";
import { decode, type Scope } from "../commerce/support";
import { failure } from "../failures";

export type Identified = { readonly scope: Scope; readonly id: string };
export type Command = Identified & { readonly idempotencyKey: string };
export const readPlan = Effect.fn("historical.readSourcePlan")(function* (tx: Transaction, scope: Scope, id: string) {
  const row = (yield* SourceDb.readPlan(tx, scope.bookId, id))[0];
  if (!row) return yield* failure("NotFound");
  return yield* decode(Sie.SiePlan, row.body);
});
export const readBasis = Effect.fn("historical.readBasis")(function* (tx: Transaction, scope: Scope, id: string) {
  const row = (yield* Db.readBasis(tx, scope.bookId, id))[0];
  if (!row) return yield* failure("NotFound");
  return yield* decode(Historical.Basis, { ...row.body, voucherId: row.voucherId });
});
export const requireStaged = Effect.fn("historical.requireStaged")(function* (tx: Transaction, scope: Scope, plan: string) {
  if (!(yield* Db.readStagedSource(tx, scope.bookId, plan)).length) return yield* failure("StaleDependency");
});
export function mappedControls(plan: typeof Sie.SiePlan.Type, kind: "opening" | "closing") {
  const balances = new Map<string, bigint>();
  for (const control of plan.input.openingControls) {
    const account = plan.input.mappings.find((m) => m.sourceAccount === control.sourceAccount)?.accountId;
    if (account === undefined) continue;
    const amount = kind === "opening" ? control.independentOpeningMinor : control.independentClosingMinor;
    balances.set(account, (balances.get(account) ?? 0n) + BigInt(amount));
  }
  return balances;
}
export function sameBalances(left: ReadonlyMap<string, bigint>, right: ReadonlyMap<string, bigint>) {
  return [...new Set([...left.keys(), ...right.keys()])].every((key) => (left.get(key) ?? 0n) === (right.get(key) ?? 0n));
}
