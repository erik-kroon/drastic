import { expect, test } from "vitest";
import * as Refunds from "@open-erp/contracts/supplier-refunds";
import {
  generateHistory,
  createModel,
  advance,
} from "../../../../../verification/assurance/excellence/models/supplier.mjs";
import {
  applyEvent,
  assertState,
  createPurchase,
  prepareRefund,
  refuseExcessRefund,
  replay,
  saveTrace,
} from "./supplier-driver";
import { database, decoded, failure, key, request } from "../../support/fixtures";

const scenarios = [
  { seed: 1715004, denominator: "1" },
  { seed: 12648430, denominator: "2" },
  { seed: 305419896, denominator: "2" },
] as const;

for (const scenario of scenarios) {
  test(`[EXC-SUPPLIER-${scenario.seed}] generated paid-credit-refund history matches independent state after every event`, async () => {
    const trace = generateHistory(scenario.seed, {
      netMinor: "100000",
      deductionDenominator: scenario.denominator,
      maxEvents: 12,
    });

    const w = await createPurchase(trace.specification);
    let state = advance(createModel(trace.specification), trace.events[0]!);
    let at = 0;

    try {
      await assertState(w, state);

      for (let i = 1; i < trace.events.length; i++) {
        at = i;
        const e = trace.events[i];

        if (!e || e.kind === "recognize") throw Error("Invalid generated event");
        const expected = advance(state, e);
        await applyEvent(w, e, state);
        state = expected;
        await assertState(w, state);

        // Revisit an OLD committed command after multiple new financial mutations.
        // Recovery must precede new-work currentness checks.
        if (i % 2 === 0) {
          await replay(w, 0);
          await replay(w, w.replays.length - 1);
          await assertState(w, state);
        }
      }

      await refuseExcessRefund(w, state);
      await assertState(w, state);
      const last = w.replays.at(-1);

      if (!last) throw Error("Missing execution identity");
      // Current checkedRefund refuses a second execution of this retained review as StaleDependency.
      await failure(
        await request(w.book, last.path, {
          method: "POST",
          headers: { "idempotency-key": key() },
          body: last.body,
        }),
        409,
        "StaleDependency",
      );
      await assertState(w, state);
      await saveTrace(`supplier-${scenario.seed}`, {
        schema: "excellence-evidence/v1",
        caseId: `EXC-SUPPLIER-${scenario.seed}`,
        outcome: "passed",
        trace,
        observations: w.observations,
        scope: "Synthetic retained payment evidence and real HTTP allocation, not a bank provider",
      });
    } catch (error) {
      await saveTrace(`supplier-${scenario.seed}-failure`, {
        schema: "excellence-failure-trace/v1",
        trace,
        failingStep: at,
        observations: w.observations,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }, 180000);
}

test("[EXC-SUPPLIER-ROLLBACK] late refund failure leaves no financial or capacity footprint and same-key retry succeeds", async () => {
  const specification = { netMinor: "100000", deductionDenominator: "2" };
  const w = await createPurchase(specification);
  let s = advance(createModel(specification), { kind: "recognize", id: "original" });

  for (const e of [
    { kind: "pay", id: "payment", amountMinor: "100000" },
    { kind: "credit", id: "credit", netMinor: "40000" },
  ] as const) {
    await applyEvent(w, e, s);
    s = advance(s, e);
  }

  await assertState(w, s);

  const action = await prepareRefund(w, "10000", "late-refund", s),
    requestKey = key();

  const tx = await database(),
    name = `exc_refund_fault_${key().replaceAll("-", "")}`;

  if (!/^[a-z0-9_]+$/.test(name) || !/^book_[a-f0-9]+$/.test(w.book.bookId))
    throw Error("Unsafe fixture identifiers");

  try {
    await tx.query(
      `CREATE FUNCTION openerp.${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.book_id='${w.book.bookId}' THEN RAISE EXCEPTION 'EXC intentional late refund fault' USING ERRCODE='P0001'; END IF; RETURN NEW; END $$`,
    );
    await tx.query(
      `CREATE TRIGGER ${name} BEFORE INSERT ON openerp.supplier_refund_source_usages FOR EACH ROW EXECUTE FUNCTION openerp.${name}()`,
    );

    const res = await request(w.book, action.path, {
      method: "POST",
      headers: { "idempotency-key": requestKey },
      body: JSON.stringify(action.input),
    });

    expect(res.status, await res.text()).toBe(500);
    await assertState(w, s);

    const counts = await tx.query<{
      receipts: number;
      refunds: number;
    }>(
      `SELECT (SELECT count(*)::int FROM openerp.command_receipts WHERE book_id=$1 AND key=$2) AS receipts,(SELECT count(*)::int FROM openerp.supplier_refunds WHERE book_id=$1) AS refunds`,
      [w.book.bookId, requestKey],
    );

    expect(counts.rows).toEqual([{ receipts: 0, refunds: 0 }]);
  } finally {
    try {
      await tx.query(`DROP TRIGGER IF EXISTS ${name} ON openerp.supplier_refund_source_usages`);
    } finally {
      try {
        await tx.query(`DROP FUNCTION IF EXISTS openerp.${name}()`);
      } finally {
        await tx.end();
      }
    }
  }

  const receipt = await decoded(
    await request(w.book, action.path, {
      method: "POST",
      headers: { "idempotency-key": requestKey },
      body: JSON.stringify(action.input),
    }),
    Refunds.SupplierRefundReceipt,
  );

  if (!receipt.voucherId) throw Error("Refund lacks actual voucher");
  w.voucherIds.push(receipt.voucherId);
  w.replays.push({
    eventId: "late-refund",
    path: action.path,
    key: requestKey,
    body: JSON.stringify(action.input),
    response: receipt,
  });
  s = advance(s, { kind: "refund", id: "late-refund", amountMinor: "10000" });
  await assertState(w, s);
  await replay(w, w.replays.length - 1);
  await assertState(w, s);
  await saveTrace("supplier-late-rollback", {
    schema: "excellence-evidence/v1",
    caseId: "EXC-SUPPLIER-ROLLBACK",
    outcome: "passed",
    observations: w.observations,
  });
}, 180000);
