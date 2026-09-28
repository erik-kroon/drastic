import { createHash } from "node:crypto";
import { expect, test } from "vitest";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Vat from "@open-erp/contracts/vat-returns";
import * as Assessment from "@open-erp/contracts/vat-assessment";
import * as TaxAccount from "@open-erp/contracts/tax-account";
import {
  createSession,
  database,
  decoded,
  evidence,
  execute,
  failure,
  fixture,
  post,
  request,
  type BookFixture,
} from "./support/fixtures";

// NEXT-37 focused journey: a sealed actual return with a rounding residual
// drives a precision bridge that posts its exact delta, and an authority
// assessment adopts an already-posted compatible effect while a new posting
// without the released tax-account match port is refused. Added with explicit
// user approval for reviewed packet failure cases; the vectors live in the
// dossier and this file retains the repeatable runtime proof.

export async function operators() {
  const book = await fixture([
    { id: "account_input_vat", code: "2641", name: "Synthetic input VAT" },
    { id: "account_vat_settlement", code: "2650", name: "Synthetic VAT settlement" },
    { id: "account_vat", code: "2611", name: "Synthetic output VAT" },
    { id: "account_gain", code: "7960", name: "Synthetic rounding gain" },
    { id: "account_loss", code: "7961", name: "Synthetic rounding loss" },
    { id: "account_tax", code: "2850", name: "Synthetic tax account" },
    { id: "account_expense", code: "6500", name: "Synthetic expense" },
  ]);

  const second = await fixture();
  const admin = await database();

  try {
    await admin.query(
      "INSERT INTO openerp.memberships(book_id, actor_id, role) VALUES ($1,$2,'operator')",
      [book.bookId, second.actorId],
    );
  } finally {
    await admin.end();
  }

  const reviewer = {
    ...book,
    actorId: second.actorId,
    token: (await createSession(second)).token,
  };

  return { book, reviewer };
}

export async function vatConfiguration(context: { book: BookFixture }, evidenceId: string) {
  const { book } = context;
  const admin = await database();
  const releaseId = `vat_assessment_${book.bookId}`;

  const filing = {
    currency: "SEK",
    calculatorVersion: "vat-filing-actual-v1",
    filingUnitScale: 0,
    rounding: "toward_zero",
    rates: [{ rateId: "fixture_rate", numerator: "1", denominator: "4", salesBox: "10" }],
    mappingRules: [
      {
        mappingRuleId: "fixture_purchase",
        treatment: "domestic_purchase",
        rateId: "fixture_rate",
        basisBox: null,
        inputBox: "48",
      },
    ],
    supportedTreatments: ["domestic_purchase"],
    requiredSourceFamilies: ["purchase_ledger"],
    sourceManifest: "NEXT-37 synthetic vectors; not a legal rule release",
  };

  const checksum = `sha256:${createHash("sha256").update(JSON.stringify(filing)).digest("hex")}`;

  try {
    await admin.query(
      "INSERT INTO openerp.rule_releases(id,jurisdiction,family,version,checksum,body) VALUES($1,'SE','vat',1,$2,$3)",
      [
        releaseId,
        checksum,
        {
          id: releaseId,
          jurisdiction: "SE",
          family: "vat",
          version: 1,
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
          vat: filing,
        },
      ],
    );

    for (const [kind, value] of [
      ["jurisdiction", "SE"],
      ["vat_period", "monthly"],
    ]) {
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

test("VAT assessment bridge posts the residual delta and adoption references posted effects", async () => {
  const { book, reviewer } = await operators();
  const source = await evidence(book);
  const basisEvidence = await evidence(book);

  await vatConfiguration({ book }, basisEvidence.id);

  const admin = await database();

  const time = await admin.query<{ today: string }>(
    "SELECT (clock_timestamp() at time zone 'UTC')::date::text AS today",
  );

  const today = time.rows[0]?.today ?? "2026-09-28";

  await admin.end();

  // A manual purchase journal with an exact 125 minor input tax line.
  const journal = await decoded(
    await request(book, "/change-sets", {
      method: "POST",
      body: JSON.stringify({
        kind: "manual_journal",
        evidenceId: source.id,
        eventKey: "vat_assessment_purchase",
        accountingPeriodId: "period_2026",
        postingDate: today,
        series: "VAT",
        description: "Synthetic purchase for assessment",
        rationale: "NEXT-37 fixture purchase",
        taxAssessment: "not_applicable",
        lines: [
          {
            accountId: "account_expense",
            debitMinor: "500",
            creditMinor: "0",
            description: "Expense",
          },
          {
            accountId: "account_input_vat",
            debitMinor: "125",
            creditMinor: "0",
            description: "Input VAT",
          },
          {
            accountId: "account_clearing",
            debitMinor: "0",
            creditMinor: "625",
            description: "Payable",
          },
        ],
      }),
    }),
    Accounting.ChangeSet,
  );

  const receipt = await execute(book, journal);

  const voucher = await decoded(
    await request(book, `/vouchers/${receipt.voucherId}`),
    Accounting.Voucher,
  );

  const taxLine = voucher.action.lines.find((line) => line.accountId === "account_input_vat");

  if (!taxLine) throw new Error("The purchase must have its owned input VAT line.");

  // Manual admission of the domestic purchase component.
  await post(
    book,
    "/vat-returns/facts",
    {
      sourceKey: "assessment_purchase",
      expectedDigest: null,
      recordClass: "actual_company",
      evidenceId: source.id,
      sourceLocator: "synthetic_supplier_invoice",
      description: "Synthetic purchase",
      reviewEvidenceId: basisEvidence.id,
      reviewRationale: "NEXT-37 fixture admission",
      treatment: "domestic_purchase",
      netMinor: "500",
      vatMinor: "125",
      grossMinor: "625",
      currency: "SEK",
      issuedOn: today,
      receivedOn: null,
      suppliedOn: today,
      taxPointOn: today,
      dateBasis: "Reviewed same-day synthetic supply and issue",
      periodEvidenceId: basisEvidence.id,
      registration: "registered",
      registrationEvidenceId: basisEvidence.id,
      method: "accrual",
      methodEvidenceId: basisEvidence.id,
      domesticEligibility: "confirmed",
      treatmentEvidenceId: basisEvidence.id,
      fullDeduction: "confirmed",
      deductionEvidenceId: basisEvidence.id,
      voucherId: voucher.id,
      taxLineIds: [taxLine.lineId],
      expenseLink: null,
    },
    Vat.VatFact,
  );

  const startsOn = `${today.slice(0, 7)}-01`;
  const end = new Date(`${startsOn}T00:00:00Z`);

  end.setUTCMonth(end.getUTCMonth() + 1);
  end.setUTCDate(0);

  const saved = await post(
    book,
    "/vat-returns/actuals",
    {
      startsOn,
      endsOn: end.toISOString().slice(0, 10),
      periodEvidenceId: basisEvidence.id,
      openingEvidenceId: basisEvidence.id,
      controlOpenings: ["account_vat", "account_input_vat", "account_vat_settlement"].map(
        (accountId) => ({ accountId, signedMinor: "0" }),
      ),
      sourceCoverage: ["purchase_ledger"].map((family) => ({
        family,
        state: "current",
        evidenceId: basisEvidence.id,
      })),
      rationale: "NEXT-37 fixture return",
    },
    Vat.ActualVatReturn,
  );

  expect(saved.calculation.filingReady).toBe(true);

  const net = saved.calculation.boxes.find((box) => box.box === "49");

  expect(net?.exactMinor).toBe("-125");
  expect(net?.reportedMinor).toBe("-1");
  expect(net?.residualMinor).toBe("-25");

  // The precision bridge posts exactly the residual delta.
  const bridge = await post(
    book,
    "/vat/assessments/bridges",
    {
      returnId: saved.id,
      settlementAccountId: "account_vat_settlement",
      gainAccountId: "account_gain",
      lossAccountId: "account_loss",
      evidenceId: basisEvidence.id,
      reason: "NEXT-37 fixture bridge",
    },
    Assessment.VatRoundingBridge,
  );

  expect(bridge.plan.bridgeDeltaMinor).toBe("-25");

  const bridgeApproval = await post(
    reviewer,
    `/vat/assessments/bridges/${bridge.id}/approvals`,
    { version: 1, digest: bridge.digest },
    Assessment.RoundingBridgeApproval,
  );

  const bridgeReceipt = await post(
    book,
    `/vat/assessments/bridges/${bridge.id}/execute`,
    {
      version: 1,
      digest: bridge.digest,
      approvalId: bridgeApproval.id,
    },
    Assessment.VatRoundingBridge,
  );

  expect(bridgeReceipt.plan.bridgeDeltaMinor).toBe("-25");

  // Re-execution after the receipt is refused.
  await failure(
    await request(book, `/vat/assessments/bridges/${bridge.id}/execute`, {
      method: "POST",
      body: JSON.stringify({ version: 1, digest: bridge.digest, approvalId: bridgeApproval.id }),
    }),
    409,
    "StaleDependency",
  );

  // Seed the authority event, an exact posted effect and its match.
  const seed = await database();

  try {
    await seed.query(
      "INSERT INTO openerp.tax_account_sources(book_id,account_id,source_key) VALUES($1,'account_tax','assessment_tax')",
      [book.bookId],
    );
    await seed.query(
      `INSERT INTO openerp.tax_account_statements
      (book_id,id,account_id,statement_key,evidence_id,review_evidence_id,evidence_sha256,source_locator,starts_on,ends_on,body)
      VALUES($1,'assessment_statement','account_tax','assessment_statement',$2,$2,$3,'assessment',$4,$4,'{}')`,
      [book.bookId, basisEvidence.id, basisEvidence.sha256, today],
    );
    await seed.query(
      "INSERT INTO openerp.tax_account_events(book_id,id,account_id,event_key,statement_id,ordinal) VALUES($1,'assessment_event','account_tax','assessment_event','assessment_statement',1)",
      [book.bookId],
    );
  } finally {
    await seed.end();
  }

  const assessmentJournal = await decoded(
    await request(book, "/change-sets", {
      method: "POST",
      body: JSON.stringify({
        kind: "manual_journal",
        evidenceId: source.id,
        eventKey: "vat_assessment_effect",
        accountingPeriodId: "period_2026",
        postingDate: today,
        series: "VAT",
        description: "Authority assessment effect",
        rationale: "NEXT-37 fixture effect",
        taxAssessment: "not_applicable",
        lines: [
          {
            accountId: "account_vat_settlement",
            debitMinor: "5000",
            creditMinor: "0",
            description: "Settlement",
          },
          {
            accountId: "account_tax",
            debitMinor: "0",
            creditMinor: "5000",
            description: "Tax account",
          },
        ],
      }),
    }),
    Accounting.ChangeSet,
  );

  const assessmentReceipt = await execute(book, assessmentJournal);

  const assessmentVoucher = await decoded(
    await request(book, `/vouchers/${assessmentReceipt.voucherId}`),
    Accounting.Voucher,
  );

  const settlementLine = assessmentVoucher.action.lines.find(
    (line) => line.accountId === "account_vat_settlement",
  );

  if (!settlementLine) throw new Error("The effect must have its settlement line.");

  const matchSeed = await database();

  try {
    await matchSeed.query(
      "INSERT INTO openerp.tax_account_matches(book_id,id,event_id,voucher_id,line_id,evidence_id,body) VALUES($1,'assessment_match','assessment_event',$2,$3,$4,'{}')",
      [book.bookId, assessmentVoucher.id, settlementLine.lineId, basisEvidence.id],
    );
  } finally {
    await matchSeed.end();
  }

  // Adoption references the posted effect with an empty journal.
  const adopted = await post(
    book,
    "/vat/assessments/records",
    {
      assessmentIdentity: "authority_2026_09",
      returnId: saved.id,
      authorityPeriod: "2026-09",
      assessedMinor: "5000",
      expectedRemainingMinor: "5000",
      taxAccountEventId: "assessment_event",
      settlementAccountId: "account_vat_settlement",
      taxAccountControlId: "account_tax",
      adoptedVoucherId: assessmentVoucher.id,
      adoptedMatchId: "assessment_match",
      confirmations: {
        registeredPeriod: true,
        legalEntity: true,
        chargeRelationship: true,
        confirmationEvidenceId: basisEvidence.id,
      },
      reason: "NEXT-37 fixture adoption",
    },
    Assessment.VatAssessment,
  );

  expect(adopted.plan.mode).toBe("adopt_existing_effect");
  expect(adopted.plan.journal).toEqual([]);

  const adoptedApproval = await post(
    reviewer,
    `/vat/assessments/records/${adopted.id}/approvals`,
    { version: 1, digest: adopted.digest },
    Assessment.AssessmentApproval,
  );

  const adoptedRecord = await post(
    book,
    `/vat/assessments/records/${adopted.id}/execute`,
    {
      version: 1,
      digest: adopted.digest,
      approvalId: adoptedApproval.id,
    },
    Assessment.VatAssessment,
  );

  expect(adoptedRecord.plan.mode).toBe("adopt_existing_effect");

  // A new posting without the released match port is refused, never approximated.
  const pending = await post(
    book,
    "/vat/assessments/records",
    {
      assessmentIdentity: "authority_2026_09_new",
      returnId: saved.id,
      authorityPeriod: "2026-09",
      assessedMinor: "100",
      expectedRemainingMinor: "100",
      taxAccountEventId: "assessment_event",
      settlementAccountId: "account_vat_settlement",
      taxAccountControlId: "account_tax",
      adoptedVoucherId: null,
      adoptedMatchId: null,
      confirmations: {
        registeredPeriod: true,
        legalEntity: true,
        chargeRelationship: true,
        confirmationEvidenceId: basisEvidence.id,
      },
      reason: "NEXT-37 fixture pending posting",
    },
    Assessment.VatAssessment,
  );

  expect(pending.plan.mode).toBe("new_assessment_posting");

  const pendingApproval = await post(
    reviewer,
    `/vat/assessments/records/${pending.id}/approvals`,
    { version: 1, digest: pending.digest },
    Assessment.AssessmentApproval,
  );

  // This one stays sealed and approved but unexecuted, so the status reports it
  // as awaiting execution rather than as blocked by a missing port.
  expect(pendingApproval.ordinal).toBe(1);

  // A new assessment posting is one financial group: the settlement/tax-account
  // journal and the tax-account match that describes it commit together. The
  // statement event is recorded first, because the match binds the event to the
  // assessment's own tax-account journal line.
  const admin0 = await database();
  const postingDate = (await admin0.query("select current_date::text as d")).rows[0]?.d as string;

  await admin0.end();

  const statement = await post(
    book,
    "/tax-account/statements",
    {
      recordClass: "synthetic",
      balanceConvention: "debit_minus_credit",
      accountId: "account_tax",
      sourceAccountKey: "assessment_tax",
      statementKey: "assessment_2026_09",
      evidenceId: basisEvidence.id,
      sourceLocator: "synthetic_authority_assessment",
      reviewEvidenceId: basisEvidence.id,
      rationale: "NEXT-37 fixture authority assessment statement",
      currency: "SEK",
      currencyScale: 2,
      startsOn: postingDate,
      endsOn: postingDate,
      openingMinor: "0",
      closingMinor: "-100",
      rows: [
        {
          eventKey: "assessment_charge",
          occurredOn: postingDate,
          amountMinor: "-100",
          classification: "tax_credit",
          description: "NEXT-37 fixture assessment event",
        },
      ],
    },
    TaxAccount.TaxAccountStatement,
  );

  const assessmentEvent = statement.events.find(
    (row) => row.input.eventKey === "assessment_charge",
  );

  if (assessmentEvent === undefined) throw new Error("statement event missing");

  const postingAssessment = await post(
    book,
    "/vat/assessments/records",
    {
      assessmentIdentity: "authority_2026_09_posted",
      returnId: saved.id,
      authorityPeriod: "2026-09",
      assessedMinor: "100",
      expectedRemainingMinor: "100",
      taxAccountEventId: assessmentEvent.id,
      settlementAccountId: "account_vat_settlement",
      taxAccountControlId: "account_tax",
      adoptedVoucherId: null,
      adoptedMatchId: null,
      confirmations: {
        registeredPeriod: true,
        legalEntity: true,
        chargeRelationship: true,
        confirmationEvidenceId: basisEvidence.id,
      },
      reason: "NEXT-37 fixture new posting",
    },
    Assessment.VatAssessment,
  );

  expect(postingAssessment.plan.mode).toBe("new_assessment_posting");

  const postingApproval = await post(
    reviewer,
    `/vat/assessments/records/${postingAssessment.id}/approvals`,
    { version: 1, digest: postingAssessment.digest },
    Assessment.AssessmentApproval,
  );

  // The match owner now exposes its internal transaction-passing entrypoint, so
  // the remaining refusal is no longer a missing port. It is the ordering
  // conflict between control-account admission and the match itself.
  await failure(
    await request(book, `/vat/assessments/records/${postingAssessment.id}/execute`, {
      method: "POST",
      body: JSON.stringify({
        version: 1,
        digest: postingAssessment.digest,
        approvalId: postingApproval.id,
      }),
    }),
    422,
    "UnsupportedProfile",
  );

  // The statement event the assessment names is real, so the refusal is about
  // the settlement ordering rather than a missing event or a missing match.
  expect(assessmentEvent.id).toMatch(/^tax/);

  // The same assessment identity cannot be recognized twice.
  await failure(
    await request(book, "/vat/assessments/records", {
      method: "POST",
      body: JSON.stringify({
        assessmentIdentity: "authority_2026_09",
        returnId: saved.id,
        authorityPeriod: "2026-09",
        assessedMinor: "5000",
        expectedRemainingMinor: "5000",
        taxAccountEventId: "assessment_event",
        settlementAccountId: "account_vat_settlement",
        taxAccountControlId: "account_tax",
        adoptedVoucherId: null,
        adoptedMatchId: null,
        confirmations: {
          registeredPeriod: true,
          legalEntity: true,
          chargeRelationship: true,
          confirmationEvidenceId: basisEvidence.id,
        },
        reason: "duplicate",
      }),
    }),
    409,
    "AlreadyPosted",
  );

  // The status assembles the exact equation from committed records.
  const status = await decoded(
    await request(book, `/vat/assessments/returns/${saved.id}/status`),
    Assessment.VatAssessmentStatus,
  );

  expect(status.exactNetMinor).toBe("-125");
  expect(status.reportedNetMinor).toBe("-1");
  expect(status.bridgeDeltaTotalMinor).toBe("-25");
  expect(status.assessedTotalMinor).toBe("5000");
  expect(status.expectedSettlementMinor).toBe("4975");
  expect(status.discrepancy).toBe(false);
  expect(status.blockers).toEqual([
    "assessment authority_2026_09_new awaits execution",
    "assessment authority_2026_09_posted awaits execution",
  ]);

  const history = await decoded(
    await request(book, `/vat/assessments/returns/${saved.id}/history`),
    Assessment.VatAssessmentHistory,
  );

  expect(history.count).toBe(4);
}, 120000);
