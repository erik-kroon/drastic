import { expect, test } from "vitest";
import * as Cash from "@open-erp/domain/cash-method";
import { failedWith, independentJournalTotals, succeeded } from "./pure-support";

function line(direction: Cash.CashDirection): Cash.CashMethodLine {
  return {
    sourceLineId: "source_invoice_line",
    netMinor: "100000",
    taxMinor: "25000",
    creditedGrossMinor: "0",
    paidGrossMinor: "0",
    recognizedGrossMinor: "0",
    recognizedVersion: "fixture-1",
    componentPolicy: "tax_first_cumulative_v1",
    rounding: "half_up",
    originalDeductibleMinor: direction === "purchase" ? "25000" : "0",
    releasedDeductibleMinor: "0",
  };
}

function payment(
  direction: Cash.CashDirection,
  basis: Cash.CashMethodLine,
  amount: string,
  id: string,
): Cash.CashPaymentInput {
  return {
    direction,
    lines: [basis],
    allocations: [{ sourceLineId: basis.sourceLineId, paidGrossMinor: amount }],
    settlementControlAccountId: "account_control",
    expenseOrRevenueAccountId: "account_result",
    taxAccountId: "account_tax",
    bankAccountId: "account_bank",
    cashEvidenceId: id,
    knownCashEvidenceIds: [],
  };
}

function yearEnd(direction: Cash.CashDirection, basis: Cash.CashMethodLine): Cash.YearEndInput {
  return {
    direction,
    fiscalYearId: "fy_2026",
    accountingCutoff: "2026-12-31",
    complete: true,
    expectedInvoiceCount: 1,
    invoiceCount: 1,
    lines: [basis],
    settlementControlAccountId: "account_control",
    expenseOrRevenueAccountId: "account_result",
    taxAccountId: "account_tax",
  };
}

test.each(["purchase", "sale"] as const)(
  "[ASR-CASH-METHOD] %s payment, unpaid year-end and later settlement recognize once",
  (direction) => {
    const first = succeeded(
      Cash.applyCashPayment(payment(direction, line(direction), "50000", "cash_first")),
    );

    const firstLine = first.slices[0]?.lineAfter;

    if (!firstLine) throw new Error("First recognized slice missing");
    expect(first.slices[0]).toMatchObject({
      settledRecognizedMinor: "0",
      newNetMinor: "40000",
      newTaxMinor: "10000",
      recognizedGrossAfterMinor: "50000",
    });
    independentJournalTotals(first.journal);
    const year = succeeded(Cash.prepareYearEnd(yearEnd(direction, firstLine)));
    const afterYear = year.slices[0]?.lineAfter;

    if (!afterYear) throw new Error("Year-end recognized slice missing");
    expect(year.slices[0]).toMatchObject({
      unpaidMinor: "75000",
      newNetMinor: "60000",
      newTaxMinor: "15000",
    });
    independentJournalTotals(year.journal);

    const final = succeeded(
      Cash.applyCashPayment(payment(direction, afterYear, "75000", "cash_second")),
    );

    expect(final.slices[0]).toMatchObject({
      settledRecognizedMinor: "75000",
      newNetMinor: "0",
      newTaxMinor: "0",
      newDeductibleMinor: "0",
    });
    expect(independentJournalTotals(final.journal)).toEqual(
      direction === "purchase"
        ? { account_bank: "-75000", account_control: "75000" }
        : { account_bank: "75000", account_control: "-75000" },
    );
    const finalLine = final.slices[0]?.lineAfter;

    if (!finalLine) throw new Error("Final slice missing");
    const repeatedYear = succeeded(Cash.prepareYearEnd(yearEnd(direction, finalLine)));
    expect(repeatedYear).toMatchObject({
      recognizedMinor: "0",
      journal: [],
      consumesVoucher: false,
    });
  },
);

test("[ASR-CASH-COVERAGE] incomplete scope, duplicate source and inconsistent state refuse", () => {
  const original = line("purchase");
  failedWith(
    Cash.prepareYearEnd({ ...yearEnd("purchase", original), complete: false }),
    "IncompletePopulation",
  );
  failedWith(
    Cash.prepareYearEnd({ ...yearEnd("purchase", original), expectedInvoiceCount: 2 }),
    "IncompletePopulation",
  );
  const paid = payment("purchase", original, "50000", "cash_used");
  failedWith(
    Cash.applyCashPayment({ ...paid, knownCashEvidenceIds: ["cash_used"] }),
    "DuplicateSourceUse",
  );
  failedWith(
    Cash.applyCashPayment(
      payment("purchase", { ...original, paidGrossMinor: "1" }, "1", "cash_new"),
    ),
    "StaleCoverage",
  );
  failedWith(
    Cash.applyCashPayment(payment("purchase", original, "125001", "cash_excess")),
    "UnrecognizedCoverageExceeded",
  );
});

test("[ASR-CASH-EMPTY] a declared complete empty population differs from unavailable coverage", () => {
  const base = {
    ...yearEnd("purchase", line("purchase")),
    lines: [],
    invoiceCount: 0,
    expectedInvoiceCount: 0,
  };

  expect(succeeded(Cash.prepareYearEnd(base))).toMatchObject({
    recognizedMinor: "0",
    journal: [],
    consumesVoucher: false,
  });
  failedWith(Cash.prepareYearEnd({ ...base, complete: false }), "IncompletePopulation");
  // This only tests the pure profile. Application completeness still needs independent evidence.
});
