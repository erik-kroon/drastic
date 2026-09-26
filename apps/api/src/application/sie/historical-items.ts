import * as Historical from "@open-erp/contracts/historical-migration";
import * as Sie from "@open-erp/contracts/sie-import";
import * as Effect from "effect/Effect";
import * as Db from "../../db/historical";
import { decode, withBook } from "../commerce/support";
import { failure } from "../failures";
import { digest, isoNow, newId, replay, saveCommand } from "../posting";
import { readPlan, requireStaged, type Command, type Identified } from "./historical-shared";

type Input = typeof Historical.AdmitItems.Type;

type OpenItem = (typeof Sie.SiePlan.Type.input.openItems)[number];

type Payment = Input["payments"][number];

type Match = Input["matches"][number];

type MatchRow = {
  readonly sourceAccount: string;
  readonly currency: string;
  readonly amountMinor: string;
};

const absolute = (value: bigint) => (value < 0n ? -value : value);

function validDate(date: string | null, required: boolean) {
  if (date === null) return !required;
  const instant = Date.parse(`${date}T00:00:00Z`);

  return Number.isFinite(instant) && new Date(instant).toISOString().slice(0, 10) === date;
}

const compareControls = Effect.fn("historical.compareItemControls")(function* (
  rows: ReadonlyArray<MatchRow>,
  controls: Input["paymentControls"],
) {
  const totals = new Map<string, bigint>();

  for (const row of rows) {
    const key = `${row.sourceAccount}:${row.currency}`;
    totals.set(key, (totals.get(key) ?? 0n) + BigInt(row.amountMinor));
  }

  const keys = controls.map((c) => `${c.sourceAccount}:${c.currency}`);

  if (
    new Set(keys).size !== keys.length ||
    keys.length !== totals.size ||
    controls.some((c, index) => totals.get(keys[index]!) !== BigInt(c.independentTotalMinor))
  )
    return yield* failure("InvalidJournal");
});

const requireConsistentItems = Effect.fn("historical.requireItemStates")(function* (
  items: ReadonlyMap<string, OpenItem>,
) {
  for (const item of items.values()) {
    const original = BigInt(item.originalMinor),
      outstanding = BigInt(item.outstandingMinor);

    if (
      (item.assertedState === "unpaid" && original !== outstanding) ||
      (item.assertedState === "partly_paid" &&
        (original === 0n || outstanding === 0n || absolute(outstanding) >= absolute(original))) ||
      (item.assertedState !== "unknown" && original * outstanding < 0n) ||
      absolute(outstanding) > absolute(original)
    )
      return yield* failure("InvalidJournal");
  }
});

const requireConsistentPayments = Effect.fn("historical.requirePaymentStates")(function* (
  payments: ReadonlyMap<string, Payment>,
  openItems: ReadonlyArray<OpenItem>,
  dated: boolean,
) {
  for (const payment of payments.values()) {
    if (
      BigInt(payment.amountMinor) <= 0n ||
      !validDate(payment.sourceDate, dated) ||
      !openItems.some(
        (item) =>
          item.sourceAccount === payment.sourceAccount && item.currency === payment.currency,
      )
    )
      return yield* failure("InvalidJournal");
  }
});

const matchPayments = Effect.fn("historical.matchItemPayments")(function* (
  matches: ReadonlyArray<Match>,
  items: ReadonlyMap<string, OpenItem>,
  payments: ReadonlyMap<string, Payment>,
  dated: boolean,
) {
  const matchedPayments = new Map<string, bigint>();
  const matchedItems = new Map<string, bigint>();
  const matchRows: Array<MatchRow> = [];

  for (const match of matches) {
    const item = items.get(match.itemIdentity),
      payment = payments.get(match.paymentIdentity);

    if (
      !item ||
      !payment ||
      BigInt(match.amountMinor) <= 0n ||
      !validDate(match.sourceDate, dated) ||
      item.sourceAccount !== payment.sourceAccount ||
      item.currency !== payment.currency ||
      (dated &&
        match.sourceDate !== null &&
        payment.sourceDate !== null &&
        match.sourceDate < payment.sourceDate)
    )
      return yield* failure("InvalidJournal");
    matchedPayments.set(
      payment.sourceIdentity,
      (matchedPayments.get(payment.sourceIdentity) ?? 0n) + BigInt(match.amountMinor),
    );
    matchedItems.set(
      item.sourceIdentity,
      (matchedItems.get(item.sourceIdentity) ?? 0n) + BigInt(match.amountMinor),
    );
    matchRows.push({
      sourceAccount: payment.sourceAccount,
      currency: payment.currency,
      amountMinor: match.amountMinor,
    });
  }

  return { matchedPayments, matchedItems, matchRows };
});

export const admitItems = Effect.fn("historical.admitItems")(function* (
  token: string,
  command: Command & { input: Input },
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (tx, principal) {
      const { scope, id, idempotencyKey, input } = command;
      const operation = "admit_historical_items";

      const request = yield* replay(
        tx,
        scope,
        idempotencyKey,
        operation,
        principal.actorId,
        { planId: id, input },
        Historical.ItemAdmission,
      );

      if (request.previous) return request.previous;
      const plan = yield* readPlan(tx, scope, id);

      if (plan.digest !== input.planDigest) return yield* failure("StaleDependency");
      yield* requireStaged(tx, scope, id);

      if ((yield* Db.readPlanItems(tx, scope.bookId, id)).length)
        return yield* failure("IdempotencyConflict");
      const items = new Map(plan.input.openItems.map((row) => [row.sourceIdentity, row]));
      const payments = new Map(input.payments.map((row) => [row.sourceIdentity, row]));

      if (
        items.size !== plan.input.openItems.length ||
        payments.size !== input.payments.length ||
        new Set(input.matches.map((row) => row.sourceIdentity)).size !== input.matches.length
      )
        return yield* failure("InvalidJournal");

      yield* requireConsistentItems(items);

      const dated = input.chronology === "dated_source";

      yield* requireConsistentPayments(payments, plan.input.openItems, dated);

      const matched = yield* matchPayments(input.matches, items, payments, dated);

      if (
        [...payments.values()].some(
          (p) => (matched.matchedPayments.get(p.sourceIdentity) ?? 0n) > BigInt(p.amountMinor),
        ) ||
        [...items.values()].some(
          (i) =>
            (matched.matchedItems.get(i.sourceIdentity) ?? 0n) > absolute(BigInt(i.originalMinor)),
        )
      )
        return yield* failure("InvalidJournal");
      yield* compareControls(input.payments, input.paymentControls);
      yield* compareControls(matched.matchRows, input.matchControls);

      const body = {
        id: newId("historical"),
        sourcePlanId: id,
        openItems: plan.input.openItems,
        openItemControls: plan.input.openItemControls,
        ...input,
        financialEffect: "none",
        admittedBy: principal.actorId,
        admittedAt: yield* isoNow(tx),
      };

      const result = yield* decode(Historical.ItemAdmission, {
        ...body,
        digest: yield* digest(body),
      });

      yield* Db.insertItems(tx, scope.bookId, result);
      yield* saveCommand(
        tx,
        scope,
        idempotencyKey,
        request.expected,
        operation,
        principal.actorId,
        result,
      );

      return result;
    },
    "update",
  );
});

export const getItems = Effect.fn("historical.getItems")(function* (
  token: string,
  command: Identified,
) {
  return yield* withBook(token, command.scope, false, function* (tx) {
    const row = (yield* Db.readItems(tx, command.scope.bookId, command.id))[0];

    if (!row) return yield* failure("NotFound");

    return yield* decode(Historical.ItemAdmission, row.body);
  });
});

export const getPlanItems = Effect.fn("historical.getPlanItems")(function* (
  token: string,
  command: Identified,
) {
  return yield* withBook(token, command.scope, false, function* (tx) {
    yield* readPlan(tx, command.scope, command.id);
    const row = (yield* Db.readPlanItems(tx, command.scope.bookId, command.id))[0];

    return row ? yield* decode(Historical.ItemAdmission, row.body) : null;
  });
});
