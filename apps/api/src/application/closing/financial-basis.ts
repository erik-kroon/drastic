import * as Closing from "@open-erp/contracts/closing";
import * as Statements from "@open-erp/contracts/report-statements";
import * as Effect from "effect/Effect";
import * as Db from "../../db/closing/financial-close";
import * as Ledger from "../../db/posting";
import type { Transaction } from "../../db/transaction";
import { decode, type Scope } from "../commerce/support";
import { failure } from "../failures";
import { digest, readBook } from "../posting";
import { readBasis } from "./proposals";

function fullYear(
  snapshot: typeof Statements.StatementSnapshot.Type,
  year: { startsOn: string; endsOn: string },
) {
  return (
    snapshot.asOf === year.endsOn &&
    snapshot.plInterval.startsOn === year.startsOn &&
    snapshot.plInterval.endsOn === year.endsOn &&
    snapshot.fiscalYear.startsOn === year.startsOn &&
    snapshot.fiscalYear.endsOn === year.endsOn
  );
}

function completePeriods(
  periods: ReadonlyArray<Db.PeriodRow>,
  year: { startsOn: string; endsOn: string },
) {
  const nextDay = (date: string) =>
    new Date(Date.parse(`${date}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);

  let next = year.startsOn;

  for (const period of periods) {
    if (period.startsOn !== next) return false;

    next = nextDay(period.endsOn);
  }

  return next === nextDay(year.endsOn);
}

// The statement mapping classifies accounts; its presentation rows never supply
// opening balances. Read actual raw balances and owned controls in the caller's tx.
export const captureFinancialBasis = Effect.fn("closing.captureFinancialBasis")(function* (
  tx: Transaction,
  scope: Scope,
  snapshot: typeof Statements.StatementSnapshot.Type,
  nominalAccountId: string,
  equityAccountId: string,
) {
  const year = (yield* Ledger.readFiscalYear(tx, scope.bookId, snapshot.fiscalYear.id))[0];

  if (!year || !fullYear(snapshot, year)) return yield* failure("StaleDependency");

  const periods = yield* Db.lockYearPeriods(tx, scope.bookId, year.id);
  const accounts = yield* Ledger.readAllAccounts(tx, scope.bookId);

  const roles = new Map(
    snapshot.mappingRelease.accountRoleRules.map((entry) => [entry.accountId, entry.role]),
  );

  if (
    roles.get(nominalAccountId) !== "expense" ||
    roles.get(equityAccountId) !== "equity" ||
    !snapshot.mappingRelease.mechanicalTransferRoles.includes("expense")
  )
    return yield* failure("InvalidJournal");

  if (
    !accounts.some((account) => account.id === nominalAccountId && account.active) ||
    !accounts.some((account) => account.id === equityAccountId && account.active)
  )
    return yield* failure("InvalidJournal");

  const controls = [];

  if (
    (yield* Db.readUncoveredCloseFamilies(tx, scope.bookId)).some(
      (family) => BigInt(family.total) > 0n,
    )
  )
    return yield* failure("UnsupportedProfile");

  for (const period of periods) {
    const readiness = yield* decode(
      Closing.ClosingReadiness,
      yield* readBasis(tx, scope.bookId, period.id),
    );

    if (!readiness.technicalCloseAllowed || readiness.families?.length !== 10)
      return yield* failure("StaleDependency");

    controls.push(readiness);
  }

  if (!completePeriods(periods, year)) return yield* failure("StaleDependency");

  const balances = yield* Db.readRawYearBalances(tx, scope.bookId, year.startsOn, year.endsOn);
  const opening: Array<{ accountId: string; balanceMinor: string; nominal: boolean }> = [];
  let profit = 0n;
  let nominal = 0n;

  for (const balance of balances) {
    const role = roles.get(balance.accountId);

    if (role === "income" || role === "expense") {
      profit -= BigInt(balance.ordinaryMinor);
      nominal += BigInt(balance.yearMinor);
    } else if (role === "asset" || role === "liability" || role === "equity") {
      opening.push({
        accountId: balance.accountId,
        balanceMinor: balance.balanceMinor,
        nominal: false,
      });
    } else if (BigInt(balance.balanceMinor) !== 0n || BigInt(balance.yearMinor) !== 0n) {
      return yield* failure("StaleDependency");
    }
  }

  if (!opening.some((row) => row.accountId === equityAccountId))
    opening.push({ accountId: equityAccountId, balanceMinor: "0", nominal: false });

  opening.sort((left, right) =>
    left.accountId < right.accountId ? -1 : left.accountId === right.accountId ? 0 : 1,
  );

  const book = yield* readBook(tx, scope);
  const epochs = yield* Db.readCloseEpochs(tx, scope.bookId);

  return {
    profitMinor: profit.toString(),
    nominalMinor: nominal.toString(),
    opening,
    digest: yield* digest({
      year,
      periods,
      accounts: accounts.map((account) => ({ ...account, version: account.version.toString() })),
      balances,
      controls,
      epochs,
      profile: book.profileVersion.toString(),
      writer: book.writerEpoch.toString(),
    }),
    controls: controls.flatMap((control) =>
      (control.families ?? []).map((family) => ({
        familyId: family.family,
        status:
          family.declaration?.status === "not_applicable"
            ? ("not_applicable" as const)
            : ("required_met" as const),
        evidenceId: control.inventory?.id ?? null,
      })),
    ),
  };
});
