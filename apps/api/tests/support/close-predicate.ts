import { randomUUID, createHash } from "node:crypto";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Bank from "@open-erp/contracts/reconciliation";
import * as Closing from "@open-erp/contracts/closing";
import * as Coverage from "@open-erp/contracts/bank-source-coverage";
import * as AccountSignoffs from "@open-erp/contracts/bank-signoffs";
import * as Signoffs from "@open-erp/contracts/bank-inventory-signoffs";
import * as Settlement from "@open-erp/contracts/settlements";
import {
  decoded,
  evidence,
  execute,
  journal,
  post,
  request,
  database,
  type BookFixture,
} from "./fixtures";
import { syntheticQualification } from "./rule-qualification";
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
export async function signedSeptemberBank(book: BookFixture) {
  const planInput = journal((await evidence(book)).id, "12500");
  const journalPlan = await post(
    book,
    "/change-sets",
    { ...planInput, accountingPeriodId: "period_september" },
    Accounting.ChangeSet,
  );
  const receipt = await execute(book, journalPlan);
  const line = journalPlan.groups[0]?.actions[0]?.lines.find(
    (line) => line.accountId === "account_bank",
  );
  if (!line) throw new Error("Missing synthetic bank line");
  const bankLine = { voucherId: receipt.voucherId, lineId: line.lineId };

  const statement = {
    kind: "synthetic_bank_statement_v1",
    statementIdentifier: randomUUID(),
    sourceBankAccountId: "exc_bank_source",
    accountId: "account_bank",
    currency: "SEK",
    startsOn: "2026-09-01",
    endsOn: "2026-09-30",
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
        startsOn: "2026-09-01",
        endsOn: "2026-09-30",
      }),
    }),
    Settlement.BankCapacityReconciliation,
  );

  expect(capacity.status).toBe("complete");
  expect(capacity.unmatchedSource).toHaveLength(0);
  expect(capacity.unmatchedLedger).toHaveLength(0);

  const inventoryEvidence = (await evidence(book)).id;

  const inventory = await decoded(
    await request(book, "/periods/period_september/closing-source-inventories", {
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
    { inventoryId: inventory.id, startsOn: "2026-09-01", endsOn: "2026-09-30" },
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

  const plan = await post(
    book,
    "/bank-inventory-signoff-plans",
    {
      inventoryId: inventory.id,
      startsOn: "2026-09-01",
      endsOn: "2026-09-30",
      signoffPlanIds: [signoffPlan.id],
    },
    Signoffs.BankInventorySignoffPlan,
  );

  const signed = await post(
    book,
    `/bank-inventory-signoff-plans/${plan.id}/sign`,
    {
      digest: plan.digest,
      version: 1,
      evidenceId: (await evidence(book)).id,
      rationale: "Synthetic September inventory review",
    },
    Signoffs.BankInventorySignoff,
  );
  return { plan, signed, statement, imported, capacity, coverage };
}
export async function vatConfiguration(
  context: { book: BookFixture; existingJurisdiction?: string },
  evidenceId: string,
) {
  const { book } = context;
  const admin = await database();
  const jurisdiction = context.existingJurisdiction ?? "SE";
  const releaseId = `vat_assessment_review_synthetic_${jurisdiction.toLowerCase()}`;

  const filing = {
    currency: "SEK",
    calculatorVersion: "vat-filing-actual-v1",
    filingUnitScale: 0,
    rounding: "toward_zero",
    rates: [{ rateId: "fixture_rate", numerator: "1", denominator: "4", salesBox: "10" }],
    mappingRules: [
      {
        mappingRuleId: "fixture_sale",
        treatment: "domestic_sale",
        rateId: "fixture_rate",
        basisBox: "05",
        inputBox: null,
      },
      {
        mappingRuleId: "fixture_purchase",
        treatment: "domestic_purchase",
        rateId: "fixture_rate",
        basisBox: null,
        inputBox: "48",
      },
    ],
    supportedTreatments: ["domestic_sale", "domestic_purchase"],
    requiredSourceFamilies: ["purchase_ledger", "sales_ledger"],
    sourceManifest: "NEXT-37 synthetic vectors; not a legal rule release",
  };

  const checksum = `sha256:${createHash("sha256").update(JSON.stringify(filing)).digest("hex")}`;

  try {
    await admin.query(
      "INSERT INTO openerp.rule_releases(id,jurisdiction,family,version,checksum,body) VALUES($1,$4,'vat',37,$2,$3) ON CONFLICT (id) DO NOTHING",
      [
        releaseId,
        checksum,
        {
          id: releaseId,
          jurisdiction,
          family: "vat",
          version: 37,
          checksum,
          applicability: {
            legalForms: [],
            accountingMethods: [],
            vatRegistrations: [],
            payrollRegistrations: [],
          },
          requiredFactKinds: ["vat_period"],
          requiredRoleKinds: [],
          calculatorVersion: "vat-filing-actual-v1",
          rounding: { mode: "toward_zero", scale: 0 },
          validFrom: "2026-01-01",
          validTo: "2026-12-31",
          sourceManifest: "Synthetic fixture configuration only",
          qualificationStatus: "reviewed",
          recordClasses: ["actual_company"],
          qualification: syntheticQualification(checksum, "2026-01-01", "2026-12-31"),
          vat: filing,
        },
        jurisdiction,
      ],
    );

    for (const [kind, value] of [
      ["jurisdiction", "SE"],
      ["vat_period", "monthly"],
    ]) {
      if (kind === "jurisdiction" && context.existingJurisdiction !== undefined) continue;

      const id = `${kind}_${book.bookId}`;

      const body = {
        id,
        entityId: book.entityId,
        factKind: kind,
        effectiveFrom: "2026-01-01",
        effectiveTo: "2026-12-31",
        recordedBy: book.actorId,
        value: { state: "known", value },
      };

      await admin.query(
        `INSERT INTO openerp.company_fact_revisions
        (entity_id,id,fact_kind,effective_from,effective_to,recorded_by,recorded_at,digest,body)
        VALUES($1,$2,$3,'2026-01-01','2026-12-31',$4,now(),openerp.digest($5::jsonb),
          $5::jsonb || jsonb_build_object('digest',openerp.digest($5::jsonb)))`,
        [book.entityId, id, kind, book.actorId, JSON.stringify(body)],
      );

      const reviewed = { factRevisionId: id, reviewer: book.actorId, result: "confirmed" };

      await admin.query(
        `INSERT INTO openerp.company_fact_reviews
        (entity_id,fact_revision_id,reviewer,result,reviewed_at,digest,body)
        VALUES($1,$2,$3,'confirmed',now(),openerp.digest($4::jsonb),$4::jsonb || jsonb_build_object('digest',openerp.digest($4::jsonb)))`,
        [book.entityId, id, book.actorId, JSON.stringify(reviewed)],
      );
    }

    const activation = {
      id: "vat_assessment_activation",
      scope: { entityId: book.entityId, bookId: book.bookId },
      family: "vat",
      ruleReleaseId: releaseId,
    };

    await admin.query(
      `INSERT INTO openerp.company_activations
      (book_id,id,family,rule_release_id,effective_from,activated_by,activated_at,digest,body)
      VALUES($1,'vat_assessment_activation','vat',$2,'2026-01-01',$3,now(),openerp.digest($4::jsonb),$4::jsonb || jsonb_build_object('digest',openerp.digest($4::jsonb)))`,
      [book.bookId, releaseId, book.actorId, JSON.stringify(activation)],
    );
    await admin.query(
      `INSERT INTO openerp.vat_control_profiles(book_id,id,identity_key,role_evidence_id,body)
      VALUES($1,'vat_assessment_controls','vat_assessment_controls',$2,jsonb_build_object('id','vat_assessment_controls','digest',openerp.digest('{"id":"vat_assessment_controls"}'::jsonb)))`,
      [book.bookId, evidenceId],
    );

    for (const [role, accountId, code] of [
      ["output_vat_control", "account_vat", "2611"],
      ["input_vat_control", "account_input_vat", "2641"],
      ["vat_settlement_control", "account_vat_settlement", "2650"],
    ]) {
      await admin.query(
        `INSERT INTO openerp.vat_control_account_roles
        (book_id,profile_id,role,account_id,account_version,code,name,active)
        VALUES($1,'vat_assessment_controls',$2,$3,1,$4,$3,true)`,
        [book.bookId, role, accountId, code],
      );
    }
  } finally {
    await admin.end();
  }
}

export async function incompleteSeptemberCoverage(
  book: BookFixture,
  mode: "missing" | "continuity" | "incomplete",
) {
  if (mode !== "missing") {
    const statement = {
      kind: "synthetic_bank_statement_v1",
      statementIdentifier: randomUUID(),
      sourceBankAccountId: "synthetic_gap_source",
      accountId: "account_bank",
      currency: "SEK",
      startsOn: "2026-09-01",
      endsOn: mode === "continuity" ? "2026-09-15" : "2026-09-30",
      openingMinor: "0",
      closingMinor: "0",
      completeness: {
        declaredComplete: mode !== "incomplete",
        basis: "Synthetic zero source with deliberately missing coverage",
      },
      rows: [],
    };
    const source = await post(
      book,
      "/evidence",
      {
        title: "Incomplete synthetic bank source",
        mediaType: "application/json",
        content: JSON.stringify(statement),
        origin: "Synthetic coverage fixture",
      },
      Accounting.Evidence,
    );
    await post(
      book,
      "/bank-statements",
      { ...statement, evidenceId: source.id, existingMatches: [] },
      Bank.StatementImportReceipt,
    );
  }
  const source = await evidence(book);
  const inventory = await post(
    book,
    "/periods/period_september/closing-source-inventories",
    {
      evidenceId: source.id,
      bankAccountIds: ["account_bank"],
      families: families.map((family) => ({
        family,
        status: family === "bank_sources" ? "required" : "not_applicable",
        reviewedOn: "2026-09-28",
        evidenceId: source.id,
        rationale: "Explicit synthetic inventory with missing coverage",
      })),
    },
    Closing.ClosingInventory,
  );
  const report = await post(
    book,
    "/bank-source-coverage",
    { inventoryId: inventory.id, startsOn: "2026-09-01", endsOn: "2026-09-30" },
    Coverage.BankSourceCoverageReport,
  );
  return report;
}
