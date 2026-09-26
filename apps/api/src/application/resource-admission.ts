import * as Effect from "effect/Effect";
import * as Db from "../db/posting-admission";
import type { Transaction } from "../db/transaction";
import { failure } from "./failures";

type Family = "bank" | "commerce" | "owner" | "vat" | "tax" | "subledger";

export const admitAccountRole = Effect.fn("resources.admitAccountRole")(function* (
  tx: Transaction,
  book: string,
  account: string,
  family: Family,
) {
  const roles = yield* Db.readAccountRoles(tx, book, account);

  if (roles.some((r) => r.role !== family)) return yield* failure("InvalidJournal");
});

export const admitLineOwner = Effect.fn("resources.admitLineOwner")(function* (
  tx: Transaction,
  book: string,
  voucher: string,
  line: string,
  family: Family,
) {
  const owners = yield* Db.readLineOwners(tx, book, voucher, line);

  if (owners.some((r) => r.owner !== family)) return yield* failure("StaleDependency");
});

export const admitBankMatch = Effect.fn("resources.admitBankMatch")(function* (
  tx: Transaction,
  book: string,
  leg: {
    readonly statementId: string;
    readonly rowOrdinal: number;
    readonly voucherId: string;
    readonly lineId: string;
  },
) {
  const dates = (yield* Db.readBankPostingDates(
    tx,
    book,
    leg.statementId,
    leg.rowOrdinal,
    leg.voucherId,
  ))[0];

  if (!dates) return yield* failure("NotFound");

  if (dates.reversed || dates.purpose === "reversal") return yield* failure("StaleDependency");

  for (const date of [...new Set([dates.observedOn, dates.postedOn])].sort()) {
    const periods = yield* Db.readPeriodsOn(tx, book, date);

    if (periods.length !== 1) return yield* failure("UnsupportedProfile");

    if (periods[0]?.locked) return yield* failure("PeriodLocked");
  }

  yield* admitLineOwner(tx, book, leg.voucherId, leg.lineId, "bank");
});
