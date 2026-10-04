import * as O from "@open-erp/contracts/onboarding";
import * as Sie from "@open-erp/contracts/sie-import";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Db from "../db/onboarding-lifecycle";
import * as ImportDb from "../db/onboarding-imports";
import type { Transaction } from "../db/transaction";
import { type Scope } from "./commerce/support";
import { failure } from "./failures";
import { readPlan } from "./sie/historical-shared";
import { linesFor } from "./sie/source-lines";

export const openingPosition = Effect.fn("onboarding.openingPosition")(function* (
  tx: Transaction,
  scope: Scope,
  current: typeof O.OnboardingCase.Type,
  asOf: string,
  runIds: readonly string[],
) {
  const runs = yield* Db.readHistoricalRuns(tx, scope.bookId, runIds);

  if (runs.length !== runIds.length) return yield* failure("NotFound");

  const qualified = yield* Effect.filter(runs, (run) =>
    ImportDb.readQualifiedPlan(tx, scope.bookId, run.planId, run.planDigest).pipe(
      Effect.map((rows) => rows.length > 0),
    ),
  );

  if (qualified.length === 0)
    return { balances: yield* Db.readBalances(tx, scope.bookId, asOf), sourceImportPlanIds: [] };
  const run = qualified[0];

  if (!run || qualified.length !== 1 || runs.length !== 1)
    return yield* failure("UnsupportedProfile");
  const plan = yield* readPlan(tx, scope, run.planId);
  const dates = current.configuration.dates;

  const vouchers = yield* Schema.decodeUnknownEffect(Sie.SiePreview.fields.vouchers)(
    run.vouchers,
  ).pipe(Effect.mapError((cause) => failure("InternalError", cause)));

  if (
    plan.digest !== run.planDigest ||
    plan.sourceSha256 !== run.sourceSha256 ||
    vouchers.length !== plan.voucherCount ||
    !dates.historyStartsOn ||
    !dates.historyEndsOn ||
    !dates.candidateLiveOn ||
    asOf < dates.historyStartsOn ||
    asOf > dates.historyEndsOn ||
    dates.historyEndsOn >= dates.candidateLiveOn
  )
    return yield* failure("StaleDependency");
  const balances = yield* Db.readBalances(tx, scope.bookId, asOf, [run.id]);
  const movements = new Map<string, bigint>();

  for (const voucher of vouchers) {
    const date = `${voucher.date.slice(0, 4)}-${voucher.date.slice(4, 6)}-${voucher.date.slice(6, 8)}`;

    if (date < dates.historyStartsOn || date > dates.historyEndsOn)
      return yield* failure("StaleDependency");

    if (date > asOf) continue;

    for (const line of yield* linesFor(plan, voucher))
      movements.set(
        line.accountId,
        (movements.get(line.accountId) ?? 0n) + BigInt(line.debitMinor) - BigInt(line.creditMinor),
      );
  }

  if ([...movements.keys()].some((id) => !balances.some((balance) => balance.accountId === id)))
    return yield* failure("AccountInactive");

  return {
    balances: balances.map((balance) => ({
      ...balance,
      amount: (BigInt(balance.amount) + (movements.get(balance.accountId) ?? 0n)).toString(),
    })),
    sourceImportPlanIds: [plan.id],
  };
});
