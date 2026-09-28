import { expect, test } from "vitest";
import * as Result from "effect/Result";
import {
  derivePaidPosition,
  refuseConsumedHistoryReversal,
} from "@open-erp/domain/supplier-refunds";
import { assertBalancedJournal } from "@open-erp/domain/purchasing";

// Focused defect tests for the NEXT-07 independent review P1s.
// Failure modes first: each case names the exact orphan/malformed shape it
// guards, using the packet's own vectors (G125000 P100000 K50000 Q0).
// Pure domain only: no database, no HTTP, no FX, no advances, no netting.

function codeOf(result: Result.Result<unknown, { readonly code: string }>) {
  expect(Result.isFailure(result)).toBe(true);

  if (Result.isFailure(result)) return result.failure.code;

  return "unexpected-success";
}

test("standalone payment reversal after a posted refund principal is rejected", () => {
  // Prior: G125000 K50000 P100000 Q0 carries refund principal 25000.
  const prior = {
    originalGrossMinor: "125000",
    creditedMinor: "50000",
    paidMinor: "100000",
    refundedMinor: "0",
  };

  const before = derivePaidPosition(prior);

  expect(Result.isSuccess(before)).toBe(true);

  if (Result.isSuccess(before)) {
    expect(before.success.refundPrincipalMinor).toBe("25000");
  }

  // Posterior: the same history with the payment reversed to P0 derives
  // cleanly on its own (principal 0, unpaid 75000) while the posted 25000
  // receivable would remain orphaned.
  const posterior = { ...prior, paidMinor: "0" };
  const alone = derivePaidPosition(posterior);

  expect(Result.isSuccess(alone)).toBe(true);

  const guarded = refuseConsumedHistoryReversal(prior, posterior);

  expect(codeOf(guarded)).toBe("UnsupportedConsumedHistory");
});

test("standalone payment reversal after an allocated cash refund is rejected", () => {
  const prior = {
    originalGrossMinor: "125000",
    creditedMinor: "50000",
    paidMinor: "100000",
    refundedMinor: "10000",
  };

  const posterior = { ...prior, paidMinor: "0" };
  const guarded = refuseConsumedHistoryReversal(prior, posterior);

  expect(codeOf(guarded)).toBe("UnsupportedConsumedHistory");
});

test("payment reversal with no refund exposure still succeeds", () => {
  // G125000 K0 P100000 Q0: principal 0, unpaid 25000. Reversing part of the
  // payment (P80000) keeps principal 0, so nothing is orphaned.
  const prior = {
    originalGrossMinor: "125000",
    creditedMinor: "0",
    paidMinor: "100000",
    refundedMinor: "0",
  };

  const posterior = { ...prior, paidMinor: "80000" };
  const guarded = refuseConsumedHistoryReversal(prior, posterior);

  expect(Result.isSuccess(guarded)).toBe(true);

  if (Result.isSuccess(guarded)) {
    expect(guarded.success.unpaidMinor).toBe("45000");
    expect(guarded.success.refundPrincipalMinor).toBe("0");
  }
});

test("corrupted posterior history maps to consumed-history, not a leaked code", () => {
  const prior = {
    originalGrossMinor: "125000",
    creditedMinor: "0",
    paidMinor: "100000",
    refundedMinor: "0",
  };

  // Posterior claims refunds above any possible principal.
  const posterior = { ...prior, refundedMinor: "999999" };
  const guarded = refuseConsumedHistoryReversal(prior, posterior);

  expect(codeOf(guarded)).toBe("UnsupportedConsumedHistory");
});

test("journal lines with both sides positive are malformed even when balanced", () => {
  // 100/50 pairs with 0/50 elsewhere: the group balances at 0 but the first
  // line carries two positive sides.
  const lines = [
    {
      sourceLineId: null,
      accountId: "payable",
      debitMinor: "100",
      creditMinor: "50",
      description: "Both sides positive",
    },
    {
      sourceLineId: null,
      accountId: "expense",
      debitMinor: "0",
      creditMinor: "50",
      description: "Counterweight",
    },
  ];

  const result = assertBalancedJournal(lines, 2);

  expect(codeOf(result)).toBe("UnbalancedJournal");
});

test("journal lines with exactly one positive side still pass", () => {
  const lines = [
    {
      sourceLineId: null,
      accountId: "payable",
      debitMinor: "25000",
      creditMinor: "0",
      description: "Reduce supplier payable",
    },
    {
      sourceLineId: "line-1",
      accountId: "expense",
      debitMinor: "0",
      creditMinor: "20000",
      description: "Supplier credit line-1",
    },
    {
      sourceLineId: "line-1",
      accountId: "input-vat",
      debitMinor: "0",
      creditMinor: "5000",
      description: "Input VAT credit line-1",
    },
  ];

  const result = assertBalancedJournal(lines, 2);

  expect(Result.isSuccess(result)).toBe(true);
});

test("journal lines with both sides zero or any negative side are malformed", () => {
  const bothZero = assertBalancedJournal(
    [
      {
        sourceLineId: null,
        accountId: "payable",
        debitMinor: "0",
        creditMinor: "0",
        description: "Zero line",
      },
      {
        sourceLineId: null,
        accountId: "expense",
        debitMinor: "100",
        creditMinor: "0",
        description: "Real line",
      },
      {
        sourceLineId: null,
        accountId: "expense",
        debitMinor: "0",
        creditMinor: "100",
        description: "Counterweight",
      },
    ],
    2,
  );

  expect(codeOf(bothZero)).toBe("UnbalancedJournal");

  const negative = assertBalancedJournal(
    [
      {
        sourceLineId: null,
        accountId: "payable",
        debitMinor: "-100",
        creditMinor: "0",
        description: "Negative line",
      },
      {
        sourceLineId: null,
        accountId: "expense",
        debitMinor: "0",
        creditMinor: "100",
        description: "Counterweight",
      },
    ],
    2,
  );

  expect(codeOf(negative)).toBe("UnbalancedJournal");
});
