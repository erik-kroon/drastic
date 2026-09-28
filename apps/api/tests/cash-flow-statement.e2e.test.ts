import { expect, test } from "vitest";
import * as Accounting from "@open-erp/contracts/accounting";
import * as CashFlow from "@open-erp/contracts/cash-flow";
import {
  approve,
  decoded,
  execute,
  evidence,
  failure,
  fixture,
  key,
  request,
} from "./support/fixtures";
import type { BookFixture } from "./support/fixtures";

// NEXT-45 direct cash-flow statement, proven over real HTTP against the
// restricted runtime role and a real PostgreSQL.
//
// The expected figures below are derived by hand from the amounts this test
// posts, and deliberately match the packet's own exact vector. Nothing in the
// expectation calls calculateCashFlow, and the owner is never asked to be its
// own oracle: the bridge must reconcile because the posted cash movements
// reconcile, not because both sides ran the same code.

const periodId = "period_2026";

const accounts = [
  { id: "account_revenue", code: "3010", name: "Sales revenue" },
  { id: "account_payable", code: "2440", name: "Accounts payable" },
  { id: "account_equipment", code: "1220", name: "Equipment" },
  { id: "account_loan", code: "2890", name: "Long-term debt" },
  { id: "account_fx", code: "3960", name: "Exchange result" },
  { id: "account_bank_two", code: "1931", name: "Bank secondary" },
  { id: "account_ambiguous", code: "3961", name: "Other result" },
];

const perimeter = ["account_bank", "account_bank_two"];

const mapping: CashFlow.CashFlowMapping = {
  version: "cash_flow_mapping_v1",
  reviewed: true,
  perimeterAccountIds: perimeter,
  accountRoleRules: [
    { accountId: "account_bank", role: "cash_and_cash_equivalents" },
    { accountId: "account_bank_two", role: "cash_and_cash_equivalents" },
    { accountId: "account_revenue", role: "revenue" },
    { accountId: "account_payable", role: "accounts_payable" },
    { accountId: "account_equipment", role: "property_plant_and_equipment" },
    { accountId: "account_loan", role: "long_term_debt" },
    { accountId: "account_fx", role: "other_income" },
    { accountId: "account_ambiguous", role: "other_income" },
  ],
  // account_fx is declared as a valuation carrier, so its cash leg becomes an
  // exchange-bridge item with an exact witness. account_ambiguous deliberately
  // is not, which is how the unresolved case is produced.
  exchangeEffectAccountIds: ["account_fx"],
};

function entry(
  date: string,
  description: string,
  lines: ReadonlyArray<{ accountId: string; debit: string; credit: string }>,
): typeof Accounting.PrepareJournal.Type {
  return {
    kind: "manual_journal",
    evidenceId: "",
    eventKey: key(),
    accountingPeriodId: periodId,
    postingDate: date,
    series: "A",
    description,
    rationale: "Exercise the NEXT-45 cash-flow classification boundary",
    taxAssessment: "not_applicable",
    lines: lines.map((line) => ({
      accountId: line.accountId,
      debitMinor: line.debit,
      creditMinor: line.credit,
      description: `${description} ${line.accountId}`,
    })),
  };
}

async function post(
  book: BookFixture,
  draft: typeof Accounting.PrepareJournal.Type,
): Promise<void> {
  const source = await evidence(book);

  const plan = await decoded(
    await request(book, "/change-sets", {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": key() },
      body: JSON.stringify({ ...draft, evidenceId: source.id }),
    }),
    Accounting.ChangeSet,
  );

  await approve(book, plan);
  await execute(book, plan);
}

async function statement(
  book: BookFixture,
  startsOn: string,
  endsOn: string,
  basis: CashFlow.CashFlowMapping,
): Promise<CashFlow.CashFlowStatementReport> {
  return decoded(
    await request(book, "/cash-flow", {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": key() },
      body: JSON.stringify({ startsOn, endsOn, mapping: basis }),
    }),
    CashFlow.CashFlowStatementReport,
  );
}

test("a direct cash-flow statement classifies retained cash and reconciles to actual closing cash", async () => {
  const book = await fixture(accounts);

  // A pre-period posting, so opening cash must be derived from retained history
  // rather than accepted from the request.
  await post(
    book,
    entry("2026-01-15", "Opening funding", [
      { accountId: "account_bank", debit: "100000", credit: "0" },
      { accountId: "account_loan", debit: "0", credit: "100000" },
    ]),
  );

  await post(
    book,
    entry("2026-03-01", "Customer receipt", [
      { accountId: "account_bank", debit: "200000", credit: "0" },
      { accountId: "account_revenue", debit: "0", credit: "200000" },
    ]),
  );

  await post(
    book,
    entry("2026-04-01", "Supplier payment", [
      { accountId: "account_payable", debit: "80000", credit: "0" },
      { accountId: "account_bank", debit: "0", credit: "80000" },
    ]),
  );

  await post(
    book,
    entry("2026-05-01", "Asset purchase", [
      { accountId: "account_equipment", debit: "50000", credit: "0" },
      { accountId: "account_bank", debit: "0", credit: "50000" },
    ]),
  );

  await post(
    book,
    entry("2026-06-01", "Loan drawdown", [
      { accountId: "account_bank", debit: "40000", credit: "0" },
      { accountId: "account_loan", debit: "0", credit: "40000" },
    ]),
  );

  await post(
    book,
    entry("2026-07-01", "FX remeasurement", [
      { accountId: "account_bank", debit: "2000", credit: "0" },
      { accountId: "account_fx", debit: "0", credit: "2000" },
    ]),
  );

  // 2026-02-01 to 2026-09-30 excludes the opening funding, which is what makes
  // the derived opening cash 100000 and exercises the perimeter balances.
  const report = await statement(book, "2026-02-01", "2026-09-30", mapping);

  expect(report.openingCashMinor).toBe("100000");

  expect(report.totals).toEqual({
    operatingNetMinor: "120000",
    investingNetMinor: "-50000",
    financingNetMinor: "40000",
    exchangeEffectsMinor: "2000",
    perimeterChangesMinor: "0",
    expectedClosingMinor: "212000",
    actualClosingMinor: "212000",
    reconciliationDifferenceMinor: "0",
  });

  expect(report.unclassifiedRowIds).toEqual([]);
  expect(report.sourceControlsComplete).toBe(true);
  expect(report.complete).toBe(true);
  expect(report.basisDigest).toMatch(/^sha256:/);

  // Every retained line is reachable, and the loan drawdown is the only
  // financing flow while the equipment purchase is the only investing one.
  const financing = report.lines.filter((line) => line.activity === "financing");
  const investing = report.lines.filter((line) => line.activity === "investing");
  const exchange = report.lines.filter((line) => line.kind === "valuation_effect");

  expect(financing).toHaveLength(1);
  expect(financing[0]?.signedCashMinor).toBe("40000");
  expect(investing).toHaveLength(1);
  expect(investing[0]?.signedCashMinor).toBe("-50000");
  expect(exchange).toHaveLength(1);
  expect(exchange[0]?.witnessRef).not.toBeNull();
  expect(exchange[0]?.reason).toBeNull();
});

test("an unclassifiable counterpart keeps its row, states the reason and refuses completeness", async () => {
  const book = await fixture(accounts);

  await post(
    book,
    entry("2026-03-01", "Ambiguous receipt", [
      { accountId: "account_bank", debit: "500", credit: "0" },
      { accountId: "account_ambiguous", debit: "0", credit: "500" },
    ]),
  );

  const report = await statement(book, "2026-02-01", "2026-09-30", mapping);

  expect(report.lines).toHaveLength(1);
  expect(report.lines[0]?.signedCashMinor).toBe("500");
  expect(report.lines[0]?.activity).toBeNull();
  expect(report.lines[0]?.reason).toContain("no reviewed activity role");
  expect(report.unclassifiedRowIds).toHaveLength(1);
  expect(report.totals.operatingNetMinor).toBe("0");
  expect(report.totals.expectedClosingMinor).toBe("0");
  expect(report.totals.actualClosingMinor).toBe("500");
  expect(report.totals.reconciliationDifferenceMinor).toBe("500");

  // The bridge is honestly incomplete: the arithmetic is shown, the claim is not.
  expect(report.complete).toBe(false);
});

test("a cash-to-cash movement is not a transfer without the owned transfer identity", async () => {
  const book = await fixture(accounts);

  await post(
    book,
    entry("2026-03-01", "Equal and opposite cash movement", [
      { accountId: "account_bank_two", debit: "30000", credit: "0" },
      { accountId: "account_bank", debit: "0", credit: "30000" },
    ]),
  );

  const report = await statement(book, "2026-02-01", "2026-09-30", mapping);

  const leg = report.lines.find((line) => line.kind === "internal_transfer");

  expect(leg).toBeDefined();
  expect(leg?.transferId).toBeNull();
  expect(leg?.reason).toContain("without an owned transfer identity");
  expect(report.unclassifiedRowIds).not.toEqual([]);
  expect(report.complete).toBe(false);
});

test("a mapping that names no retained account is refused rather than reported around", async () => {
  const book = await fixture(accounts);

  const response = await request(book, "/cash-flow", {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": key() },
    body: JSON.stringify({
      startsOn: "2026-02-01",
      endsOn: "2026-09-30",
      mapping: { ...mapping, perimeterAccountIds: ["account_does_not_exist"] },
    }),
  });

  await failure(response, 422, "UnsupportedProfile");
});
