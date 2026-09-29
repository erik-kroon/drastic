import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Bank from "@open-erp/contracts/reconciliation";
import * as Closing from "@open-erp/contracts/closing";
import * as Coverage from "@open-erp/contracts/bank-source-coverage";
import * as AccountSignoffs from "@open-erp/contracts/bank-signoffs";
import * as Signoffs from "@open-erp/contracts/bank-inventory-signoffs";
import * as Settlement from "@open-erp/contracts/settlements";
import {
  database,
  decoded,
  evidence,
  execute,
  fixture,
  post,
  prepare,
  request,
  type BookFixture,
} from "../support/fixtures";

const families = [
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
];

// The retained member list is a Schema.Array by contract and reaches the owner's
// encoder directly. An object-only encoder rejects the list, so this workflow
// previously answered InternalError for every request. This drives the whole
// public chain and then reads the stored document back independently.
async function postedBankLine(book: BookFixture, evidenceId: string) {
  const plan = await prepare(book, "12500");
  const receipt = await execute(book, plan);

  const bankLine = plan.groups[0]?.actions[0]?.lines.find(
    (line) => line.accountId === "account_bank",
  );

  if (!bankLine) throw new Error("No bank line in the posted synthetic group");

  return { evidenceId, voucherId: receipt.voucherId, lineId: bankLine.lineId };
}

test("[EXC-BANK-SIGNOFF-MEMBERS] a signed bank inventory plan retains its member list as a JSON array", async () => {
  const book = await fixture();
  // Posting consumes the evidence it cites, so each owner gets its own.
  const bankLine = await postedBankLine(book, (await evidence(book)).id);

  // One statement covering the whole period, declared complete, carrying the
  // single source row that the posted bank line must be allocated against. The
  // capacity basis reports "complete" only when every source row and every
  // ledger line has no remaining amount, so the allocation below is required.
  const statement = {
    kind: "synthetic_bank_statement_v1",
    statementIdentifier: randomUUID(),
    sourceBankAccountId: "exc_bank_source",
    accountId: "account_bank",
    currency: "SEK",
    startsOn: "2026-01-01",
    endsOn: "2026-12-31",
    openingMinor: "0",
    closingMinor: "12500",
    completeness: {
      declaredComplete: true,
      basis: "Synthetic declared-complete statement for the sign-off workflow",
    },
    rows: [
      {
        rowOrdinal: 1,
        providerId: "exc_observation_1",
        date: "2026-09-22",
        description: "Synthetic receipt matching the posted bank line",
        amountMinor: "12500",
      },
    ],
  };

  // The statement owner compares the retained evidence digest with the
  // submitted source, so the evidence content must be the statement itself.
  const statementEvidence = await decoded(
    await request(book, "/evidence", {
      method: "POST",
      body: JSON.stringify({
        title: "Synthetic bank inventory sign-off statement",
        mediaType: "application/json",
        content: JSON.stringify(statement),
        origin: "excellence synthetic fixture",
      }),
    }),
    Accounting.Evidence,
  );

  const imported = await decoded(
    await request(book, "/bank-statements", {
      method: "POST",
      body: JSON.stringify({
        ...statement,
        evidenceId: statementEvidence.id,
        existingMatches: [],
      }),
    }),
    Bank.StatementImportReceipt,
  );

  // Allocate the single source row to the single posted bank line. The
  // capacity basis requires a fully consumed shared obligation, not a private
  // shadow total, so this is the real allocation owner.
  const allocationPlan = await decoded(
    await request(book, "/bank-allocation-plans", {
      method: "POST",
      body: JSON.stringify({
        accountId: "account_bank",
        reason: "Synthetic reviewed allocation for the sign-off workflow",
        ambiguityAcknowledged: true,
        legs: [
          {
            statementId: imported.statement.id,
            rowOrdinal: 1,
            voucherId: bankLine.voucherId,
            lineId: bankLine.lineId,
            amountMinor: "12500",
          },
        ],
      }),
    }),
    Settlement.BankAllocationPlan,
  );

  const allocationApproval = await decoded(
    await request(book, `/bank-allocation-plans/${allocationPlan.id}/approve`, {
      method: "POST",
      body: JSON.stringify({ version: 1, digest: allocationPlan.digest }),
    }),
    Settlement.BankAllocationApproval,
  );

  await decoded(
    await request(book, `/bank-allocation-plans/${allocationPlan.id}/execute`, {
      method: "POST",
      body: JSON.stringify({
        version: 1,
        digest: allocationPlan.digest,
        approvalId: allocationApproval.id,
      }),
    }),
    Settlement.BankAllocationExecution,
  );

  const capacity = await decoded(
    await request(book, "/bank-capacity-reconciliations", {
      method: "POST",
      body: JSON.stringify({
        accountId: "account_bank",
        startsOn: "2026-01-01",
        endsOn: "2026-12-31",
      }),
    }),
    Settlement.BankCapacityReconciliation,
  );

  expect(capacity.status).toBe("complete");
  expect(capacity.unmatchedSource).toHaveLength(0);
  expect(capacity.unmatchedLedger).toHaveLength(0);

  const inventoryEvidence = (await evidence(book)).id;

  const inventory = await decoded(
    await request(book, "/periods/period_2026/closing-source-inventories", {
      method: "POST",
      body: JSON.stringify({
        evidenceId: inventoryEvidence,
        bankAccountIds: ["account_bank"],
        families: families.map((family) => ({
          family,
          status: family === "bank_sources" ? "required" : "not_applicable",
          reviewedOn: "2026-09-28",
          evidenceId: inventoryEvidence,
          rationale: "Explicit synthetic inventory for the bank sign-off workflow",
        })),
      }),
    }),
    Closing.ClosingInventory,
  );

  expect(inventory.coverage).toBe("synthetic_family_inventory_v1");

  const coverage = await post(
    book,
    "/bank-source-coverage",
    { inventoryId: inventory.id, startsOn: "2026-01-01", endsOn: "2026-12-31" },
    Coverage.BankSourceCoverageReport,
  );

  const signoffEvidence = (await evidence(book)).id;

  const signoffPlan = await post(
    book,
    "/bank-signoff-plans",
    { coverageReportId: coverage.id, reconciliationId: capacity.id },
    AccountSignoffs.BankSignoffPlan,
  );

  const signoff = await decoded(
    await request(book, `/bank-signoff-plans/${signoffPlan.id}/sign`, {
      method: "POST",
      body: JSON.stringify({
        digest: signoffPlan.digest,
        version: 1,
        evidenceId: signoffEvidence,
        rationale: "Synthetic declared review of the retained bank source",
      }),
    }),
    AccountSignoffs.BankReconciliationSignoff,
  );

  expect(signoff.planId).toBe(signoffPlan.id);

  // The defect site: this request encodes the member list.
  const plan = await post(
    book,
    "/bank-inventory-signoff-plans",
    {
      inventoryId: inventory.id,
      startsOn: "2026-01-01",
      endsOn: "2026-12-31",
      signoffPlanIds: [signoffPlan.id],
    },
    Signoffs.BankInventorySignoffPlan,
  );

  expect(plan.members).toHaveLength(1);
  expect(plan.members[0]?.accountId).toBe("account_bank");
  expect(plan.members[0]?.plan.id).toBe(signoffPlan.id);
  expect(plan.members[0]?.signoff.planId).toBe(signoffPlan.id);
  expect(plan.basis.memberDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
  expect(plan.companyCompleteness).toBe("not_established");
  expect(plan.financialCloseReady).toBe(false);

  // Independent read of the stored document: members must be a JSON array in
  // PostgreSQL, not a stringified or object-wrapped list.
  const admin = await database();

  try {
    const stored = await admin.query<{ members: unknown; typeOf: string }>(
      `SELECT body->'members' AS members,
              jsonb_typeof(body->'members') AS "typeOf"
       FROM openerp.bank_inventory_signoff_plans WHERE book_id = $1 AND id = $2`,
      [book.bookId, plan.id],
    );

    expect(stored.rows).toHaveLength(1);
    expect(stored.rows[0]?.typeOf).toBe("array");
    expect(Array.isArray(stored.rows[0]?.members)).toBe(true);
    expect(stored.rows[0]?.members).toHaveLength(1);
  } finally {
    await admin.end();
  }
}, 180000);
