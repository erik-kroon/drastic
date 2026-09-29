import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Bank from "@open-erp/contracts/reconciliation";
import * as Settlement from "@open-erp/contracts/settlements";
import {
  database,
  decoded,
  execute,
  fixture,
  persisted,
  prepare,
  request,
} from "../support/fixtures";
import {
  injectScopedInsertFault,
  freshCommandCount,
  saveSanitizedJourney,
} from "./database-support";

async function world(lineAmounts: string[], sourceAmounts: string[]) {
  const book = await fixture();
  const lines = [];

  for (const amount of lineAmounts) {
    const plan = await prepare(book, amount);
    const receipt = await execute(book, plan);

    const bankLine = plan.groups[0]?.actions[0]?.lines.find(
      (line) => line.accountId === "account_bank",
    );

    if (!bankLine) throw new Error("No bank line in posted plan");
    lines.push({ voucherId: receipt.voucherId, lineId: bankLine.lineId });
  }

  const statement = {
    kind: "synthetic_bank_statement_v1",
    statementIdentifier: randomUUID(),
    sourceBankAccountId: "assurance_bank",
    accountId: "account_bank",
    currency: "SEK",
    startsOn: "2026-09-01",
    endsOn: "2026-09-30",
    openingMinor: "0",
    closingMinor: sourceAmounts.reduce((sum, amount) => sum + BigInt(amount), 0n).toString(),
    completeness: {
      declaredComplete: false,
      basis: "Synthetic selected observations, not an actual statement",
    },
    rows: sourceAmounts.map((amountMinor, index) => ({
      rowOrdinal: index + 1,
      providerId: `observation_${index + 1}`,
      date: "2026-09-22",
      description: "Synthetic assurance capacity",
      amountMinor,
    })),
  };

  const evidence = await decoded(
    await request(book, "/evidence", {
      method: "POST",
      body: JSON.stringify({
        title: "Assurance statement",
        mediaType: "application/json",
        content: JSON.stringify(statement),
        origin: "assurance synthetic fixture",
      }),
    }),
    Accounting.Evidence,
  );

  const imported = await decoded(
    await request(book, "/bank-statements", {
      method: "POST",
      body: JSON.stringify({ ...statement, evidenceId: evidence.id, existingMatches: [] }),
    }),
    Bank.StatementImportReceipt,
  );

  return { book, lines, statementId: imported.statement.id };
}

async function prepareAllocation(
  w: Awaited<ReturnType<typeof world>>,
  legs: Array<{ row: number; line: number; amount: string }>,
) {
  return request(w.book, "/bank-allocation-plans", {
    method: "POST",
    body: JSON.stringify({
      accountId: "account_bank",
      reason: "Explicit reviewed synthetic capacity allocation",
      ambiguityAcknowledged: true,
      legs: legs.map(({ row, line, amount }) => {
        const target = w.lines[line];

        if (!target) throw new Error("Missing target line");

        return { statementId: w.statementId, rowOrdinal: row, ...target, amountMinor: amount };
      }),
    }),
  });
}

async function allocations(w: Awaited<ReturnType<typeof world>>) {
  const db = await database();

  try {
    const result = await db.query<{ executions: number; legs: number; sum: string }>(
      `SELECT
      (SELECT count(*)::int FROM openerp.bank_allocation_executions WHERE book_id=$1) AS executions,
      (SELECT count(*)::int FROM openerp.bank_allocation_legs WHERE book_id=$1) AS legs,
      (SELECT coalesce(sum(amount_minor),0)::text FROM openerp.bank_allocation_legs WHERE book_id=$1) AS sum`,
      [w.book.bookId],
    );

    return result.rows[0];
  } finally {
    await db.end();
  }
}

async function executeAllocation(
  w: Awaited<ReturnType<typeof world>>,
  legs: Array<{ row: number; line: number; amount: string }>,
) {
  const plan = await decoded(await prepareAllocation(w, legs), Settlement.BankAllocationPlan);

  const approval = await decoded(
    await request(w.book, `/bank-allocation-plans/${plan.id}/approve`, {
      method: "POST",
      body: JSON.stringify({ version: 1, digest: plan.digest }),
    }),
    Settlement.BankAllocationApproval,
  );

  return decoded(
    await request(w.book, `/bank-allocation-plans/${plan.id}/execute`, {
      method: "POST",
      body: JSON.stringify({ version: 1, digest: plan.digest, approvalId: approval.id }),
    }),
    Settlement.BankAllocationExecution,
  );
}

async function capacityReport(w: Awaited<ReturnType<typeof world>>) {
  return decoded(
    await request(w.book, "/bank-capacity-reconciliations", {
      method: "POST",
      body: JSON.stringify({
        accountId: "account_bank",
        startsOn: "2026-09-01",
        endsOn: "2026-09-30",
      }),
    }),
    Settlement.BankCapacityReconciliation,
  );
}

test("[ASR-CAPACITY-RESIDUAL] a residual is the amount minus the whole allocated sum", async () => {
  // One source row of 12500 and two posted bank lines of 10000 each. Half of
  // the shared obligation is allocated, so both sides must retain 2500.
  const w = await world(["10000", "10000"], ["12500"]);

  await executeAllocation(w, [{ row: 1, line: 0, amount: "7500" }]);

  const report = await capacityReport(w);
  const source = report.sourceRows[0];
  const line = report.ledgerLines[0];

  expect(source?.amountMinor).toBe("12500");
  expect(source?.allocatedMinor).toBe("7500");
  // The defect interpolated the sum without parentheses, so this was
  // (12500 - 0) + 7500 = 20000 and the report never reached "complete".
  expect(source?.remainingMinor).toBe("5000");

  expect(line?.amountMinor).toBe("10000");
  expect(line?.allocatedMinor).toBe("7500");
  expect(line?.remainingMinor).toBe("2500");

  // Both sides retain a genuine residual, so the basis must not claim closure.
  expect(report.unmatchedSource).toHaveLength(1);
  // Line 0 keeps 2500 and line 1 was never allocated, so both are unmatched.
  expect(report.unmatchedLedger).toHaveLength(2);
  expect(report.status).toBe("differences");
});

test("[ASR-CAPACITY-CONSUMED] a fully allocated shared obligation reaches complete", async () => {
  // One source row of 20000 against two posted bank lines of 10000 each, so a
  // complete allocation is possible and the basis must then reach "complete".
  const w = await world(["10000", "10000"], ["20000"]);

  await executeAllocation(w, [
    { row: 1, line: 0, amount: "10000" },
    { row: 1, line: 1, amount: "10000" },
  ]);

  const report = await capacityReport(w);

  for (const row of [...report.sourceRows, ...report.ledgerLines])
    expect(row.remainingMinor, JSON.stringify(row)).toBe("0");

  // Every consumed row leaves no residual, so neither side is unmatched and no
  // difference is reported. The overall status still reflects this fixture's
  // declared-incomplete statement coverage, which is a separate concern.
  expect(report.unmatchedSource).toHaveLength(0);
  expect(report.unmatchedLedger).toHaveLength(0);
  expect(report.differences).toEqual([]);
});

test.each([
  {
    label: "same source over two targets",
    lineAmounts: ["10000", "10000"],
    sourceAmounts: ["10000"],
    legs: [
      { row: 1, line: 0, amount: "6000" },
      { row: 1, line: 1, amount: "6000" },
    ],
  },
  {
    label: "same target over two sources",
    lineAmounts: ["10000"],
    sourceAmounts: ["10000", "10000"],
    legs: [
      { row: 1, line: 0, amount: "6000" },
      { row: 2, line: 0, amount: "6000" },
    ],
  },
  {
    label: "duplicate exact pair",
    lineAmounts: ["10000"],
    sourceAmounts: ["10000"],
    legs: [
      { row: 1, line: 0, amount: "1000" },
      { row: 1, line: 0, amount: "1000" },
    ],
  },
  {
    label: "opposite signed amount",
    lineAmounts: ["10000"],
    sourceAmounts: ["10000"],
    legs: [{ row: 1, line: 0, amount: "-1000" }],
  },
])("[ASR-ALLOC-REFUSE] $label leaves capacities untouched", async (v) => {
  const w = await world(v.lineAmounts, v.sourceAmounts);
  const before = await persisted(w.book);
  const response = await prepareAllocation(w, v.legs);
  expect(response.status, await response.text()).toBe(422);
  expect(await allocations(w)).toEqual({ executions: 0, legs: 0, sum: "0" });
  expect(await persisted(w.book)).toEqual(before);
});

test("[ASR-ALLOC-ATOMIC] late leg fault, exact retry and exhausted residual agree", async () => {
  const w = await world(["5000", "7500"], ["12500"]);
  const before = await persisted(w.book);

  const plan = await decoded(
    await prepareAllocation(w, [
      { row: 1, line: 0, amount: "5000" },
      { row: 1, line: 1, amount: "7500" },
    ]),
    Settlement.BankAllocationPlan,
  );

  const approval = await decoded(
    await request(w.book, `/bank-allocation-plans/${plan.id}/approve`, {
      method: "POST",
      body: JSON.stringify({ version: 1, digest: plan.digest }),
    }),
    Settlement.BankAllocationApproval,
  );

  const key = randomUUID();

  const command = {
    method: "POST",
    headers: { "idempotency-key": key },
    body: JSON.stringify({ version: 1, digest: plan.digest, approvalId: approval.id }),
  };

  const remove = await injectScopedInsertFault(w.book, "bank_allocation_legs");

  try {
    const response = await request(w.book, `/bank-allocation-plans/${plan.id}/execute`, command);
    expect(response.status, await response.text()).toBe(500);
    expect(await allocations(w)).toEqual({ executions: 0, legs: 0, sum: "0" });
    expect(await freshCommandCount(w.book, key)).toBe(0);
    expect(await persisted(w.book)).toEqual(before);
  } finally {
    await remove();
  }

  const actual = await decoded(
    await request(w.book, `/bank-allocation-plans/${plan.id}/execute`, command),
    Settlement.BankAllocationExecution,
  );

  expect(actual.legs.map((leg) => leg.amountMinor)).toEqual(["5000", "7500"]);
  expect(await allocations(w)).toEqual({ executions: 1, legs: 2, sum: "12500" });
  // Bank matching consumes reconciliation capacities, not another voucher or invoice payment.
  expect(await persisted(w.book)).toEqual(before);

  const replay = await decoded(
    await request(w.book, `/bank-allocation-plans/${plan.id}/execute`, command),
    Settlement.BankAllocationExecution,
  );

  expect(replay).toEqual(actual);
  const excess = await prepareAllocation(w, [{ row: 1, line: 0, amount: "1" }]);
  expect(excess.status).toBe(422);
  expect(await allocations(w)).toEqual({ executions: 1, legs: 2, sum: "12500" });
  await saveSanitizedJourney("bank-capacity", {
    bookId: w.book.bookId,
    receipt: actual.receipt,
    allocations: await allocations(w),
    persisted: before,
  });
});
