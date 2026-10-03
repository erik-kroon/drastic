import { expect } from "vitest";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Bank from "@open-erp/contracts/reconciliation";
import * as Closing from "@open-erp/contracts/closing";
import * as Coverage from "@open-erp/contracts/bank-source-coverage";
import * as Settlement from "@open-erp/contracts/settlements";
import {
  database,
  evidence,
  execute,
  fixture,
  journal,
  key,
  post,
  type BookFixture,
} from "./fixtures";

export async function cashBasisWorld(options: { incomplete?: boolean; old?: boolean } = {}) {
  const book = await fixture([
    { id: "account_bank_two", code: "1931", name: "Synthetic second bank" },
    { id: "account_ar", code: "1510", name: "Synthetic receivables" },
    { id: "account_revenue", code: "3010", name: "Synthetic revenue" },
    { id: "account_gain", code: "3960", name: "Synthetic FX gain" },
    { id: "account_loss", code: "3961", name: "Synthetic FX loss" },
  ]);

  const admin = await database();
  let today: string;
  let yesterday: string;

  try {
    const clock = await admin.query<{ today: string; yesterday: string }>(
      "select (clock_timestamp() at time zone 'Europe/Stockholm')::date::text as today, ((clock_timestamp() at time zone 'Europe/Stockholm')::date-1)::text as yesterday",
    );

    const value = clock.rows[0];

    if (!value) throw new Error("Fixture needs database civil date");
    today = value.today;
    yesterday = value.yesterday;
  } finally {
    await admin.end();
  }

  const endsOn = options.old ? yesterday : today;
  const startsOn = `${today.slice(0, 4)}-01-01`;
  const sources: Array<{ accountId: string; reconciliationId: string }> = [];

  for (const [accountId, amount] of [
    ["account_bank", "100000"],
    ["account_bank_two", "50000"],
  ]) {
    if (!accountId || !amount) throw new Error("Missing literal source fixture");
    const source = await evidence(book);
    const draft = journal(source.id, amount);

    const plan = await post(
      book,
      "/change-sets",
      {
        ...draft,
        postingDate: endsOn,
        lines: draft.lines.map((line) => ({
          ...line,
          accountId: line.accountId === "account_bank" ? accountId : line.accountId,
        })),
      },
      Accounting.ChangeSet,
    );

    const posted = await execute(book, plan);
    const line = plan.groups[0]?.actions[0]?.lines.find((entry) => entry.accountId === accountId);

    if (!line) throw new Error("Funding source needs its posted bank line");

    const statement = {
      kind: "synthetic_bank_statement_v1",
      statementIdentifier: key(),
      sourceBankAccountId: `cash_${accountId}`,
      accountId,
      currency: "SEK",
      startsOn,
      endsOn,
      openingMinor: "0",
      closingMinor: amount,
      completeness: {
        declaredComplete: !options.incomplete,
        basis: "Independently specified synthetic current closing, not real provider attestation",
      },
      rows: [
        {
          rowOrdinal: 1,
          providerId: null,
          date: endsOn,
          description: "Synthetic funding included in closing",
          amountMinor: amount,
        },
      ],
    };

    const original = await post(
      book,
      "/evidence",
      {
        title: "Cash basis synthetic original",
        content: JSON.stringify(statement),
        mediaType: "application/json",
        origin: "P10 independent synthetic source",
      },
      Accounting.Evidence,
    );

    await post(
      book,
      "/bank-statements",
      {
        ...statement,
        evidenceId: original.id,
        existingMatches: [{ rowOrdinal: 1, voucherId: posted.voucherId, lineId: line.lineId }],
      },
      Bank.StatementImportReceipt,
    );

    const reconciliation = await post(
      book,
      "/bank-capacity-reconciliations",
      {
        accountId,
        startsOn,
        endsOn,
      },
      Settlement.BankCapacityReconciliation,
    );

    expect(reconciliation.bankClosingMinor).toBe(amount);
    expect(reconciliation.status).toBe(options.incomplete ? "balanced_but_incomplete" : "complete");
    sources.push({ accountId, reconciliationId: reconciliation.id });
  }

  const { input, coverage } = await qualifiedCashBasisInput(book, today, sources);

  return { book, today, yesterday, input, coverage };
}

export async function qualifiedCashBasisInput(
  book: BookFixture,
  today: string,
  sources: Array<{ accountId: string; reconciliationId: string }>,
) {
  const startsOn = `${today.slice(0, 4)}-01-01`;

  const qualification = await post(
    book,
    "/evidence",
    {
      title: "Synthetic selected account eligibility review",
      content:
        "Both selected accounts are synthetic unrestricted entity-bank statement balances; no private, restricted, tax-account or credit funds. No real-company attestation.",
      mediaType: "text/plain",
      origin: "P10 synthetic reviewed assumption",
    },
    Accounting.Evidence,
  );

  const inventory = await post(
    book,
    "/periods/period_2026/closing-source-inventories",
    {
      evidenceId: qualification.id,
      bankAccountIds: sources.map((entry) => entry.accountId),
      families: [
        "bank_sources",
        "invoices",
        "tax",
        "payroll",
        "assets_deferrals",
        "foreign_currency",
        "owner_balances",
        "other_balances",
        "external_schedules",
        "disclosures",
      ].map((family) => ({
        family,
        status: "required",
        reviewedOn: today,
        evidenceId: qualification.id,
        rationale: "Known family coverage remains to be established",
      })),
    },
    Closing.ClosingInventory,
  );

  const coverage = await post(
    book,
    "/bank-source-coverage",
    {
      inventoryId: inventory.id,
      startsOn,
      endsOn: `${today.slice(0, 4)}-12-31`,
    },
    Coverage.BankSourceCoverageReport,
  );

  expect(coverage.coverage).toBe("not_established");
  expect(coverage.hasReviewGaps).toBe(true);

  const input = {
    asOf: today,
    accounts: sources.map((entry) => ({
      ...entry,
      coverageReportId: coverage.id,
      review: {
        evidenceId: qualification.id,
        sha256: qualification.sha256,
        eligibility: "unrestricted_entity_bank",
        balanceType: "statement_closing",
        reason: "Explicit synthetic selected-scope assumption",
      },
    })),
    expectedDates: [],
  };

  return { input, coverage };
}
