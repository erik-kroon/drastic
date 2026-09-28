import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import * as Schema from "effect/Schema";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Vat from "@open-erp/contracts/vat-returns";
import * as Assessment from "@open-erp/contracts/vat-assessment";
import * as TaxAccount from "@open-erp/contracts/tax-account";
import * as Close from "@open-erp/contracts/financial-close";
import {
  closeFixture,
  taxBridge,
  recognizeTax,
  controls,
  finalProposal,
  closeApproval,
  closePath,
} from "./support/financial-close";
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
  saveEvidence,
  environment,
  persisted,
} from "./support/fixtures";

// NEXT-37 focused journey: a sealed actual return with a rounding residual
// drives a precision bridge that posts its exact delta, and an authority
// assessment adopts an already-posted compatible effect or atomically posts a
// new movement through the tax-account match owner. Added with explicit
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

async function renewalReturn(book: BookFixture, evidenceId: string) {
  await vatConfiguration({ book }, evidenceId);

  const sale = await post(
    book,
    "/change-sets",
    {
      kind: "manual_journal",
      evidenceId,
      eventKey: "renewal_sale",
      accountingPeriodId: "period_2026",
      postingDate: "2026-09-28",
      series: "VAT",
      description: "Synthetic sale",
      rationale: "Exact reported 100 renewal vector",
      taxAssessment: "not_applicable",
      lines: [
        {
          accountId: "account_clearing",
          debitMinor: "500",
          creditMinor: "0",
          description: "Receivable",
        },
        {
          accountId: "account_expense",
          debitMinor: "0",
          creditMinor: "400",
          description: "Synthetic sale basis",
        },
        {
          accountId: "account_vat",
          debitMinor: "0",
          creditMinor: "100",
          description: "Output VAT",
        },
      ],
    },
    Accounting.ChangeSet,
  );

  const receipt = await execute(book, sale);

  const voucher = await decoded(
    await request(book, `/vouchers/${receipt.voucherId}`),
    Accounting.Voucher,
  );

  const line = voucher.action.lines.find((entry) => entry.accountId === "account_vat");

  if (!line) throw new Error("Missing sale tax line");

  await post(
    book,
    "/vat-returns/facts",
    {
      sourceKey: "renewal_sale",
      expectedDigest: null,
      recordClass: "actual_company",
      evidenceId,
      sourceLocator: "synthetic_renewal_sale",
      description: "Synthetic sale",
      reviewEvidenceId: evidenceId,
      reviewRationale: "Exact reported 100",
      treatment: "domestic_sale",
      netMinor: "400",
      vatMinor: "100",
      grossMinor: "500",
      currency: "SEK",
      issuedOn: "2026-09-28",
      receivedOn: null,
      suppliedOn: "2026-09-28",
      taxPointOn: "2026-09-28",
      dateBasis: "Synthetic same-day supply",
      periodEvidenceId: evidenceId,
      registration: "registered",
      registrationEvidenceId: evidenceId,
      method: "accrual",
      methodEvidenceId: evidenceId,
      domesticEligibility: "confirmed",
      treatmentEvidenceId: evidenceId,
      fullDeduction: "confirmed",
      deductionEvidenceId: evidenceId,
      voucherId: voucher.id,
      taxLineIds: [line.lineId],
      expenseLink: null,
    },
    Vat.VatFact,
  );

  return post(
    book,
    "/vat-returns/actuals",
    {
      startsOn: "2026-09-01",
      endsOn: "2026-09-30",
      periodEvidenceId: evidenceId,
      openingEvidenceId: evidenceId,
      controlOpenings: ["account_vat", "account_input_vat", "account_vat_settlement"].map(
        (accountId) => ({ accountId, signedMinor: "0" }),
      ),
      sourceCoverage: [
        { family: "purchase_ledger", state: "current", evidenceId },
        { family: "sales_ledger", state: "current", evidenceId },
      ],
      rationale: "Synthetic renewal calculation",
    },
    Vat.ActualVatReturn,
  );
}

test.each([
  { mode: "new", revisedReturn: false },
  { mode: "new", revisedReturn: true },
  { mode: "adopt", revisedReturn: false },
  { mode: "adopt", revisedReturn: true },
])(
  "assessment renewal preserves identity: $mode, return revision $revisedReturn",
  async ({ mode, revisedReturn }) => {
    const { book, reviewer } = await operators();
    const source = await evidence(book);
    const saved = await renewalReturn(book, source.id);

    expect(saved.calculation.boxes.find((box) => box.box === "49")?.reportedMinor).toBe("1");

    const statement = await post(
      book,
      "/tax-account/statements",
      {
        recordClass: "synthetic",
        balanceConvention: "debit_minus_credit",
        accountId: "account_tax",
        sourceAccountKey: "renewal_tax",
        statementKey: "renewal_movements",
        evidenceId: source.id,
        sourceLocator: "renewal_movements",
        reviewEvidenceId: source.id,
        rationale: "Independent A60 and B40 authority movements",
        currency: "SEK",
        currencyScale: 2,
        startsOn: "2026-09-28",
        endsOn: "2026-09-28",
        openingMinor: "0",
        closingMinor: "-140",
        rows: [
          {
            eventKey: "authority_a",
            occurredOn: "2026-09-28",
            amountMinor: "-60",
            classification: "tax_charge",
            description: "A60",
          },
          {
            eventKey: "authority_b",
            occurredOn: "2026-09-28",
            amountMinor: "-40",
            classification: "tax_charge",
            description: "B40",
          },
          {
            eventKey: "another_event",
            occurredOn: "2026-09-28",
            amountMinor: "-40",
            classification: "tax_charge",
            description: "Another source cannot reuse executed B identity",
          },
        ],
      },
      TaxAccount.TaxAccountStatement,
    );

    const [eventA, eventB, anotherEvent] = statement.events;

    if (!eventA || !eventB || !anotherEvent) throw new Error("Missing renewal source events");

    let adoptedVoucherId: string | null = null;
    let adoptedMatchId: string | null = null;

    if (mode === "adopt") {
      const manual = await post(
        book,
        "/change-sets",
        {
          kind: "manual_journal",
          evidenceId: source.id,
          eventKey: "existing_b",
          accountingPeriodId: "period_2026",
          postingDate: "2026-09-28",
          series: "VAT",
          description: "Existing B movement",
          rationale: "Reviewed exact B effect",
          taxAssessment: "not_applicable",
          lines: [
            {
              accountId: "account_vat_settlement",
              debitMinor: "40",
              creditMinor: "0",
              description: "Settlement",
            },
            {
              accountId: "account_tax",
              debitMinor: "0",
              creditMinor: "40",
              description: "Tax account",
            },
          ],
        },
        Accounting.ChangeSet,
      );

      const posted = await execute(book, manual);

      const voucher = await decoded(
        await request(book, `/vouchers/${posted.voucherId}`),
        Accounting.Voucher,
      );

      const taxLine = voucher.action.lines.find((line) => line.accountId === "account_tax");

      if (!taxLine) throw new Error("Missing owned tax-account line");

      const selection = {
        eventId: eventB.id,
        statementDigest: statement.digest,
        voucherId: voucher.id,
        lineId: taxLine.lineId,
      };

      const basis = await post(
        book,
        "/tax-account/matches/preview",
        selection,
        TaxAccount.TaxAccountMatchBasis,
      );

      const match = await post(
        book,
        "/tax-account/matches",
        {
          selection,
          expectedBasisDigest: basis.digest,
          evidenceId: source.id,
          rationale: "Owned exact B match",
        },
        TaxAccount.TaxAccountMatch,
      );

      adoptedVoucherId = voucher.id;
      adoptedMatchId = match.id;
    }

    const inputB = {
      assessmentIdentity: "authority_b",
      returnId: saved.id,
      authorityPeriod: "2026-09",
      assessedMinor: "40",
      taxAccountEventId: eventB.id,
      settlementAccountId: "account_vat_settlement",
      taxAccountControlId: "account_tax",
      adoptedVoucherId,
      adoptedMatchId,
      confirmations: {
        registeredPeriod: true,
        legalEntity: true,
        chargeRelationship: true,
        confirmationEvidenceId: source.id,
      },
      reason: "Renew the proposal, not the authority identity",
    };

    const a = await post(
      book,
      "/vat/assessments/records",
      {
        ...inputB,
        assessmentIdentity: "authority_a",
        assessedMinor: "60",
        taxAccountEventId: eventA.id,
        adoptedVoucherId: null,
        adoptedMatchId: null,
      },
      Assessment.VatAssessment,
    );

    const oldPrepare = {
      method: "POST",
      headers: { "idempotency-key": "original_b_preparation" },
      body: JSON.stringify(inputB),
    };

    const b = await decoded(
      await request(book, "/vat/assessments/records", oldPrepare),
      Assessment.VatAssessment,
    );

    const approvalA = await post(
      reviewer,
      `/vat/assessments/records/${a.id}/approvals`,
      { version: 1, digest: a.digest },
      Assessment.AssessmentApproval,
    );

    const oldApprove = {
      method: "POST",
      headers: { "idempotency-key": "original_b_approval" },
      body: JSON.stringify({ version: 1, digest: b.digest }),
    };

    const approvalB = await decoded(
      await request(reviewer, `/vat/assessments/records/${b.id}/approvals`, oldApprove),
      Assessment.AssessmentApproval,
    );

    expect(a.expectedRemainingMinor).toBe("100");
    expect(b.expectedRemainingMinor).toBe("100");
    await post(
      book,
      `/vat/assessments/records/${a.id}/execute`,
      { version: 1, digest: a.digest, approvalId: approvalA.id },
      Assessment.VatAssessment,
    );
    await failure(
      await request(book, `/vat/assessments/records/${b.id}/execute`, {
        method: "POST",
        body: JSON.stringify({ version: 1, digest: b.digest, approvalId: approvalB.id }),
      }),
      409,
      "StaleDependency",
    );
    await failure(
      await request(reviewer, `/vat/assessments/records/${b.id}/approvals`, {
        method: "POST",
        body: JSON.stringify({ version: 1, digest: b.digest }),
      }),
      409,
      "StaleDependency",
    );

    let renewed = await post(book, "/vat/assessments/records", inputB, Assessment.VatAssessment);

    expect(renewed.id).not.toBe(b.id);
    expect(renewed.assessmentIdentity).toBe(b.assessmentIdentity);
    expect(renewed.expectedRemainingMinor).toBe("40");
    await failure(
      await request(book, `/vat/assessments/records/${renewed.id}/execute`, {
        method: "POST",
        body: JSON.stringify({ version: 1, digest: renewed.digest, approvalId: approvalB.id }),
      }),
      403,
      "ApprovalRequired",
    );

    let renewedApproval = await post(
      reviewer,
      `/vat/assessments/records/${renewed.id}/approvals`,
      { version: 1, digest: renewed.digest },
      Assessment.AssessmentApproval,
    );

    let currentReturn = saved;
    const proposalIds = [b.id, renewed.id];

    if (revisedReturn) {
      currentReturn = await post(
        book,
        "/vat-returns/actuals",
        { ...saved.input, rationale: "Further snapshot before B execution" },
        Vat.ActualVatReturn,
      );
      await failure(
        await request(book, `/vat/assessments/records/${renewed.id}/execute`, {
          method: "POST",
          body: JSON.stringify({
            version: 1,
            digest: renewed.digest,
            approvalId: renewedApproval.id,
          }),
        }),
        409,
        "StaleDependency",
      );

      const oldRenewalApproval = renewedApproval;

      renewed = await post(
        book,
        "/vat/assessments/records",
        { ...inputB, returnId: currentReturn.id },
        Assessment.VatAssessment,
      );
      proposalIds.push(renewed.id);
      expect(renewed.expectedRemainingMinor).toBe("40");
      await failure(
        await request(book, `/vat/assessments/records/${renewed.id}/execute`, {
          method: "POST",
          body: JSON.stringify({
            version: 1,
            digest: renewed.digest,
            approvalId: oldRenewalApproval.id,
          }),
        }),
        403,
        "ApprovalRequired",
      );
      renewedApproval = await post(
        reviewer,
        `/vat/assessments/records/${renewed.id}/approvals`,
        { version: 1, digest: renewed.digest },
        Assessment.AssessmentApproval,
      );
    }

    // A second independently approved proposal cannot consume the same identity.
    const competing = await post(
      book,
      "/vat/assessments/records",
      { ...inputB, returnId: currentReturn.id },
      Assessment.VatAssessment,
    );

    const competingApproval = await post(
      reviewer,
      `/vat/assessments/records/${competing.id}/approvals`,
      { version: 1, digest: competing.digest },
      Assessment.AssessmentApproval,
    );

    const execution = {
      method: "POST",
      headers: { "idempotency-key": "renewed_b_execution" },
      body: JSON.stringify({ version: 1, digest: renewed.digest, approvalId: renewedApproval.id }),
    };

    const responses = await Promise.all([
      request(book, `/vat/assessments/records/${renewed.id}/execute`, execution),
      request(book, `/vat/assessments/records/${renewed.id}/execute`, execution),
    ]);

    const result = await decoded(responses[0]!, Assessment.VatAssessment);

    expect(await decoded(responses[1]!, Assessment.VatAssessment)).toEqual(result);
    await failure(
      await request(book, `/vat/assessments/records/${competing.id}/execute`, {
        method: "POST",
        body: JSON.stringify({
          version: 1,
          digest: competing.digest,
          approvalId: competingApproval.id,
        }),
      }),
      409,
      "AlreadyPosted",
    );
    expect(
      await decoded(
        await request(book, "/vat/assessments/records", oldPrepare),
        Assessment.VatAssessment,
      ),
    ).toEqual(b);
    expect(
      await decoded(
        await request(reviewer, `/vat/assessments/records/${b.id}/approvals`, oldApprove),
        Assessment.AssessmentApproval,
      ),
    ).toEqual(approvalB);

    for (const input of [
      { ...inputB, returnId: currentReturn.id },
      {
        ...inputB,
        returnId: currentReturn.id,
        taxAccountEventId: anotherEvent.id,
        adoptedVoucherId: null,
        adoptedMatchId: null,
      },
      { ...inputB, returnId: currentReturn.id, assessmentIdentity: "another_identity" },
    ]) {
      await failure(
        await request(book, "/vat/assessments/records", {
          method: "POST",
          body: JSON.stringify(input),
        }),
        409,
        "AlreadyPosted",
      );
    }

    const status = await decoded(
      await request(book, `/vat/assessments/returns/${currentReturn.id}/status`),
      Assessment.VatAssessmentStatus,
    );

    const history = await decoded(
      await request(book, `/vat/assessments/returns/${currentReturn.id}/history`),
      Assessment.VatAssessmentHistory,
    );

    expect(status.assessedTotalMinor).toBe("100");
    expect(status.pendingDifferenceTotalMinor).toBe("0");
    expect(status.blockers).toEqual([]);
    expect(history.items.map((item) => item.id)).toEqual(
      expect.arrayContaining([...proposalIds, competing.id]),
    );

    const admin = await database();

    try {
      const receipts = await admin.query(
        `SELECT a.assessment_identity, count(*)::int AS total FROM openerp.vat_assessment_receipts r JOIN openerp.vat_assessments a ON (a.book_id,a.id)=(r.book_id,r.assessment_id) WHERE r.book_id=$1 GROUP BY a.assessment_identity ORDER BY a.assessment_identity`,
        [book.bookId],
      );

      const matches = await admin.query(
        "SELECT count(*)::int AS total FROM openerp.tax_account_matches WHERE book_id=$1 AND event_id=$2",
        [book.bookId, eventB.id],
      );

      const old = await admin.query(
        "SELECT body FROM openerp.vat_assessments WHERE book_id=$1 AND id=$2",
        [book.bookId, b.id],
      );

      expect(receipts.rows).toEqual([
        { assessment_identity: "authority_a", total: 1 },
        { assessment_identity: "authority_b", total: 1 },
      ]);
      expect(matches.rows).toEqual([{ total: 1 }]);
      expect(old.rows[0]?.body).toEqual(b);
    } finally {
      await admin.end();
    }

    expect(await persisted(book)).toMatchObject({
      sequence: "3",
      vouchers: 3,
      lines: 7,
      receipts: 3,
      outbox: 3,
      counter: "3",
    });
    await saveEvidence(`next37-renewal-${mode}-${revisedReturn}`, book);
    await writeFile(
      join(environment().artifacts, `next37-renewal-${mode}-${revisedReturn}-outcomes.json`),
      JSON.stringify(
        { a, b, approvalB, renewed, renewedApproval, result, proposalIds, status, history },
        null,
        2,
      ),
    );
  },
);

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
      sourceCoverage: ["purchase_ledger", "sales_ledger"].map((family) => ({
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

  const pendingBridge = await post(
    book,
    "/vat/assessments/bridges",
    {
      returnId: saved.id,
      settlementAccountId: "account_vat_settlement",
      gainAccountId: "account_gain",
      lossAccountId: "account_loss",
      evidenceId: basisEvidence.id,
      reason: "An unexecuted plan is not a financial effect",
    },
    Assessment.VatRoundingBridge,
  );

  expect
    .soft(pendingBridge.plan.bridgeDeltaMinor, "pending plans must not reduce the bridge")
    .toBe("-25");

  const bridgeApproval = await post(
    reviewer,
    `/vat/assessments/bridges/${bridge.id}/approvals`,
    { version: 1, digest: bridge.digest },
    Assessment.RoundingBridgeApproval,
  );

  const bridgeExecution = {
    method: "POST",
    headers: { "idempotency-key": "next37-bridge-execute" },
    body: JSON.stringify({
      version: 1,
      digest: bridge.digest,
      approvalId: bridgeApproval.id,
    }),
  };

  const bridgeReceipt = await decoded(
    await request(book, `/vat/assessments/bridges/${bridge.id}/execute`, bridgeExecution),
    Assessment.VatRoundingBridge,
  );

  const replayedBridge = await request(
    book,
    `/vat/assessments/bridges/${bridge.id}/execute`,
    bridgeExecution,
  );

  expect.soft(replayedBridge.status, await replayedBridge.text()).toBe(200);

  expect(bridgeReceipt.plan.bridgeDeltaMinor).toBe("-25");

  const pendingBridgeApproval = await post(
    reviewer,
    `/vat/assessments/bridges/${pendingBridge.id}/approvals`,
    { version: 1, digest: pendingBridge.digest },
    Assessment.RoundingBridgeApproval,
  );

  await failure(
    await request(book, `/vat/assessments/bridges/${pendingBridge.id}/execute`, {
      method: "POST",
      body: JSON.stringify({
        version: 1,
        digest: pendingBridge.digest,
        approvalId: pendingBridgeApproval.id,
      }),
    }),
    409,
    "StaleDependency",
  );

  // Re-execution after the receipt is refused.
  await failure(
    await request(book, `/vat/assessments/bridges/${bridge.id}/execute`, {
      method: "POST",
      body: JSON.stringify({ version: 1, digest: bridge.digest, approvalId: bridgeApproval.id }),
    }),
    409,
    "StaleDependency",
  );

  const statementInput = {
    recordClass: "synthetic",
    balanceConvention: "debit_minus_credit",
    accountId: "account_tax",
    sourceAccountKey: "assessment_tax",
    statementKey: "assessment_adoption",
    evidenceId: basisEvidence.id,
    sourceLocator: "synthetic_authority_movement",
    reviewEvidenceId: basisEvidence.id,
    rationale: "Evidence-backed signed movement, not a replacement decision",
    currency: "SEK",
    currencyScale: 2,
    startsOn: today,
    endsOn: today,
    openingMinor: "0",
    closingMinor: "-5000",
    rows: [
      {
        eventKey: "adoption_charge",
        occurredOn: today,
        amountMinor: "-5000",
        classification: "tax_charge",
        description: "Authority charge",
      },
    ],
  };

  const adoptionStatement = await post(
    book,
    "/tax-account/statements",
    statementInput,
    TaxAccount.TaxAccountStatement,
  );

  const adoptionEvent = adoptionStatement.events[0]!;

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
    (line) => line.accountId === "account_tax",
  );

  if (!settlementLine) throw new Error("The effect must have its settlement line.");

  const selection = {
    eventId: adoptionEvent.id,
    statementDigest: adoptionStatement.digest,
    voucherId: assessmentVoucher.id,
    lineId: settlementLine.lineId,
  };

  const matchBasis = await post(
    book,
    "/tax-account/matches/preview",
    selection,
    TaxAccount.TaxAccountMatchBasis,
  );

  const matchInput = {
    selection,
    expectedBasisDigest: matchBasis.digest,
    evidenceId: basisEvidence.id,
    rationale: "Owned exact tax-account line",
  };

  const retiredMatch = await post(
    book,
    "/tax-account/matches",
    matchInput,
    TaxAccount.TaxAccountMatch,
  );

  const adoptionInput = {
    assessmentIdentity: "authority_2026_09",
    returnId: saved.id,
    authorityPeriod: "2026-09",
    assessedMinor: "5000",
    expectedRemainingMinor: "5000",
    taxAccountEventId: adoptionEvent.id,
    settlementAccountId: "account_vat_settlement",
    taxAccountControlId: "account_tax",
    adoptedVoucherId: assessmentVoucher.id,
    adoptedMatchId: retiredMatch.id,
    confirmations: {
      registeredPeriod: true,
      legalEntity: true,
      chargeRelationship: true,
      confirmationEvidenceId: basisEvidence.id,
    },
    reason: "NEXT-37 fixture adoption",
  };

  await post(
    book,
    `/tax-account/matches/${retiredMatch.id}/unmatch`,
    {
      expectedDigest: retiredMatch.digest,
      evidenceId: basisEvidence.id,
      rationale: "Retire before assessment adoption",
    },
    TaxAccount.TaxAccountUnmatch,
  );
  await failure(
    await request(book, "/vat/assessments/records", {
      method: "POST",
      body: JSON.stringify(adoptionInput),
    }),
    409,
    "StaleDependency",
  );

  const currentBasis = await post(
    book,
    "/tax-account/matches/preview",
    selection,
    TaxAccount.TaxAccountMatchBasis,
  );

  const ownedMatch = await post(
    book,
    "/tax-account/matches",
    { ...matchInput, expectedBasisDigest: currentBasis.digest },
    TaxAccount.TaxAccountMatch,
  );

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
      taxAccountEventId: adoptionEvent.id,
      settlementAccountId: "account_vat_settlement",
      taxAccountControlId: "account_tax",
      adoptedVoucherId: assessmentVoucher.id,
      adoptedMatchId: ownedMatch.id,
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
  expect(adopted.expectedRemainingMinor).toBe("-100");
  expect(adopted.plan.pendingDifferenceMinor).toBe("5100");

  const pendingStatus = await decoded(
    await request(book, `/vat/assessments/returns/${saved.id}/status`),
    Assessment.VatAssessmentStatus,
  );

  expect(pendingStatus.discrepancy).toBe(true);
  expect(pendingStatus.assessedTotalMinor).toBe("0");

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

  const correction = await decoded(
    await request(book, `/vouchers/${assessmentVoucher.id}/correction-proposals`, {
      method: "POST",
      body: JSON.stringify({
        accountingPeriodId: "period_2026",
        postingDate: today,
        rationale: "Consumed assessment must use its owner",
      }),
    }),
    Accounting.ChangeSet,
  );

  const correctionApproval = await decoded(
    await request(book, `/change-sets/${correction.id}/approvals`, {
      method: "POST",
      body: JSON.stringify({ version: 1, planDigest: correction.planDigest }),
    }),
    Accounting.Approval,
  );

  await failure(
    await request(book, `/change-sets/${correction.id}/execute`, {
      method: "POST",
      body: JSON.stringify({
        version: 1,
        planDigest: correction.planDigest,
        approvalId: correctionApproval.id,
      }),
    }),
    422,
    "UnsupportedProfile",
  );
  await failure(
    await request(book, `/tax-account/matches/${ownedMatch.id}/unmatch`, {
      method: "POST",
      body: JSON.stringify({
        expectedDigest: ownedMatch.digest,
        evidenceId: basisEvidence.id,
        rationale: "Consumed relationship cannot be released",
      }),
    }),
    409,
    "StaleDependency",
  );

  // Changing an identity cannot reuse an already-consumed source event.
  await failure(
    await request(book, "/vat/assessments/records", {
      method: "POST",
      body: JSON.stringify({
        assessmentIdentity: "authority_2026_09_new",
        returnId: saved.id,
        authorityPeriod: "2026-09",
        assessedMinor: "100",
        expectedRemainingMinor: "100",
        taxAccountEventId: adoptionEvent.id,
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
      }),
    }),
    409,
    "AlreadyPosted",
  );

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
          classification: "tax_charge",
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

  const execution = {
    method: "POST",
    headers: { "idempotency-key": "assessment-new-execute" },
    body: JSON.stringify({
      version: 1,
      digest: postingAssessment.digest,
      approvalId: postingApproval.id,
    }),
  };

  const authority = await database();

  try {
    await authority.query(
      "UPDATE openerp.identity_admissions SET enabled=false WHERE actor_id=$1",
      [reviewer.actorId],
    );
  } finally {
    await authority.end();
  }

  await failure(
    await request(book, `/vat/assessments/records/${postingAssessment.id}/execute`, execution),
    403,
    "ApprovalRequired",
  );
  await createSession(reviewer);

  const fault = await database();
  const beforeFinancial = await persisted(book);

  const before = await fault.query(
    "SELECT committed_sequence::text AS sequence FROM openerp.books WHERE id=$1",
    [book.bookId],
  );

  try {
    await fault.query(
      "ALTER TABLE openerp.vat_assessment_receipts ADD CONSTRAINT next37_late_fault CHECK (false) NOT VALID",
    );
    await failure(
      await request(book, `/vat/assessments/records/${postingAssessment.id}/execute`, execution),
      500,
      "InternalError",
    );
  } finally {
    await fault.query(
      "ALTER TABLE openerp.vat_assessment_receipts DROP CONSTRAINT next37_late_fault",
    );

    const after = await fault.query(
      "SELECT committed_sequence::text AS sequence FROM openerp.books WHERE id=$1",
      [book.bookId],
    );

    expect(after.rows).toEqual(before.rows);
    expect(await persisted(book)).toEqual(beforeFinancial);

    const leaked = await fault.query(
      "SELECT id FROM openerp.tax_account_matches WHERE book_id=$1 AND event_id=$2",
      [book.bookId, assessmentEvent.id],
    );

    expect(leaked.rows).toEqual([]);
    await fault.end();
  }

  const postedResults = await Promise.all([
    request(book, `/vat/assessments/records/${postingAssessment.id}/execute`, execution),
    request(book, `/vat/assessments/records/${postingAssessment.id}/execute`, execution),
  ]);

  const posted = await decoded(postedResults[0]!, Assessment.VatAssessment);

  expect(await decoded(postedResults[1]!, Assessment.VatAssessment)).toEqual(posted);

  const foreign = await fixture();

  await failure(
    await request(foreign, `/vat/assessments/records/${postingAssessment.id}/execute`, execution),
    404,
    "NotFound",
  );

  const conservation = await database();

  try {
    const effects = await conservation.query(
      `SELECT r.voucher_id, r.match_ref, m.line_id, l.account_id, l.debit_minor::text, l.credit_minor::text FROM openerp.vat_assessment_receipts r JOIN openerp.tax_account_matches m ON (m.book_id,m.id)=(r.book_id,r.match_ref) JOIN openerp.journal_lines l ON (l.book_id,l.voucher_id,l.id)=(m.book_id,m.voucher_id,m.line_id) WHERE r.book_id=$1 AND r.assessment_id=$2`,
      [book.bookId, postingAssessment.id],
    );

    expect(effects.rows).toHaveLength(1);
    expect(effects.rows[0]).toMatchObject({
      account_id: "account_tax",
      debit_minor: "0",
      credit_minor: "100",
    });
  } finally {
    await conservation.end();
  }

  // Both the journal and the match came through the public owners.
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
        taxAccountEventId: adoptionEvent.id,
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
  expect(status.assessedTotalMinor).toBe("5100");
  expect(status.expectedSettlementMinor).toBe("5075");
  expect(status.discrepancy).toBe(true);
  expect(status.pendingDifferenceTotalMinor).toBe("5200");

  const nextReturn = await post(
    book,
    "/vat-returns/actuals",
    { ...saved.input, rationale: "Another snapshot of the same obligation" },
    Vat.ActualVatReturn,
  );

  const nextBridgeCommand = {
    method: "POST",
    headers: { "idempotency-key": "next37-concurrent-prepare" },
    body: JSON.stringify({
      returnId: nextReturn.id,
      settlementAccountId: "account_vat_settlement",
      gainAccountId: "account_gain",
      lossAccountId: "account_loss",
      evidenceId: basisEvidence.id,
      reason: "A second snapshot is not a second obligation",
    }),
  };

  const nextBridges = await Promise.all([
    request(book, "/vat/assessments/bridges", nextBridgeCommand),
    request(book, "/vat/assessments/bridges", nextBridgeCommand),
  ]);

  const nextBridge = await decoded(nextBridges[0]!, Assessment.VatRoundingBridge);

  expect(await decoded(nextBridges[1]!, Assessment.VatRoundingBridge)).toEqual(nextBridge);
  expect(nextBridge.obligationId).toBe(bridge.obligationId);
  expect(nextBridge.obligationId).not.toBe(saved.id);
  expect(nextBridge.plan.bridgeDeltaMinor).toBe("0");

  const zeroStatement = await post(
    book,
    "/tax-account/statements",
    {
      ...statementInput,
      statementKey: "zero_assessment_statement",
      sourceLocator: "zero_assessment_statement",
      closingMinor: "0",
      rows: [
        {
          eventKey: "zero_assessment",
          occurredOn: today,
          amountMinor: "0",
          classification: "tax_credit",
          description: "Evidenced no movement",
        },
      ],
    },
    TaxAccount.TaxAccountStatement,
  );

  const zero = await post(
    book,
    "/vat/assessments/records",
    {
      ...adoptionInput,
      returnId: nextReturn.id,
      assessmentIdentity: "authority_zero",
      assessedMinor: "0",
      taxAccountEventId: zeroStatement.events[0]!.id,
      adoptedVoucherId: null,
      adoptedMatchId: null,
    },
    Assessment.VatAssessment,
  );

  const zeroApproval = await post(
    reviewer,
    `/vat/assessments/records/${zero.id}/approvals`,
    { version: 1, digest: zero.digest },
    Assessment.AssessmentApproval,
  );

  expect(zero.plan.journal).toEqual([]);
  await post(
    book,
    `/vat/assessments/records/${zero.id}/execute`,
    { version: 1, digest: zero.digest, approvalId: zeroApproval.id },
    Assessment.VatAssessment,
  );

  const zeroDb = await database();

  try {
    const zeroReceipts = await zeroDb.query(
      "SELECT voucher_id, match_ref FROM openerp.vat_assessment_receipts WHERE book_id=$1 AND assessment_id=$2",
      [book.bookId, zero.id],
    );

    expect(zeroReceipts.rows).toEqual([{ voucher_id: null, match_ref: null }]);
  } finally {
    await zeroDb.end();
  }

  const creditStatement = await post(
    book,
    "/tax-account/statements",
    {
      ...statementInput,
      statementKey: "credit_assessment_statement",
      sourceLocator: "credit_assessment_statement",
      closingMinor: "5200",
      rows: [
        {
          eventKey: "credit_assessment",
          occurredOn: today,
          amountMinor: "5200",
          classification: "tax_credit",
          description: "Separate evidenced credit movement",
        },
      ],
    },
    TaxAccount.TaxAccountStatement,
  );

  const credit = await post(
    book,
    "/vat/assessments/records",
    {
      ...adoptionInput,
      returnId: nextReturn.id,
      assessmentIdentity: "authority_credit",
      assessedMinor: "-5200",
      taxAccountEventId: creditStatement.events[0]!.id,
      adoptedVoucherId: null,
      adoptedMatchId: null,
    },
    Assessment.VatAssessment,
  );

  expect(credit.expectedRemainingMinor).toBe("-5200");
  expect(credit.plan.pendingDifferenceMinor).toBe("0");

  const creditApproval = await post(
    reviewer,
    `/vat/assessments/records/${credit.id}/approvals`,
    { version: 1, digest: credit.digest },
    Assessment.AssessmentApproval,
  );

  await post(
    book,
    `/vat/assessments/records/${credit.id}/execute`,
    { version: 1, digest: credit.digest, approvalId: creditApproval.id },
    Assessment.VatAssessment,
  );

  const creditedStatus = await decoded(
    await request(book, `/vat/assessments/returns/${nextReturn.id}/status`),
    Assessment.VatAssessmentStatus,
  );

  expect(creditedStatus.assessedTotalMinor).toBe("-100");
  expect(creditedStatus.pendingDifferenceTotalMinor).toBe("0");
  expect(creditedStatus.discrepancy).toBe(false);

  const mcp = await fetch(`${environment().baseUrl}/api/mcp`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${book.agentToken}`,
      "content-type": "application/json",
      accept: "application/json",
      "MCP-Protocol-Version": "2025-11-25",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 37,
      method: "tools/call",
      params: {
        name: "vat_get_assessment_status",
        arguments: { scope: { entityId: book.entityId, bookId: book.bookId }, id: nextReturn.id },
      },
    }),
  });

  expect(mcp.status).toBe(200);

  const mcpResult = Schema.decodeUnknownSync(
    Schema.Struct({
      result: Schema.Struct({
        structuredContent: Schema.Struct({ result: Assessment.VatAssessmentStatus }),
      }),
    }),
  )(await mcp.json());

  expect(mcpResult.result.structuredContent.result).toEqual(creditedStatus);

  const history = await decoded(
    await request(book, `/vat/assessments/returns/${saved.id}/history`),
    Assessment.VatAssessmentHistory,
  );

  expect(history.count).toBe(7);
  await saveEvidence("next37-assessment-completion", book);
  await writeFile(
    join(environment().artifacts, "next37-assessment-outcomes.json"),
    JSON.stringify(
      {
        bridge,
        nextBridge,
        adopted,
        posted,
        zero,
        credit,
        beforeFinancial,
        status,
        creditedStatus,
        history,
      },
      null,
      2,
    ),
  );
}, 120000);

test("NEXT-23 close fences a new NEXT-37 assessment posting", async () => {
  const context = await closeFixture();
  const { book, reviewer, source } = context;
  const tax = await taxBridge(context);

  await recognizeTax(context, tax.bridge);
  await controls(context);

  const proposal = await finalProposal(context, tax);
  const approval = await closeApproval(context, proposal);

  await post(
    book,
    `${closePath}/proposals/${proposal.id}/execute`,
    { version: 1, digest: proposal.digest, approvalId: approval.id },
    Close.FinancialCloseCertificate,
  );

  const admin = await database();

  try {
    for (const [id, code] of [
      ["account_input_vat", "2641"],
      ["account_vat", "2611"],
      ["account_vat_settlement", "2650"],
      ["account_gain", "7960"],
      ["account_loss", "7961"],
    ]) {
      await admin.query("INSERT INTO openerp.accounts(book_id,id,code,name) VALUES($1,$2,$3,$2)", [
        book.bookId,
        id,
        code,
      ]);
    }
  } finally {
    await admin.end();
  }

  await vatConfiguration({ book, existingJurisdiction: "ZZ" }, source.id);

  const saved = await post(
    book,
    "/vat-returns/actuals",
    {
      startsOn: "2026-09-01",
      endsOn: "2026-09-30",
      periodEvidenceId: source.id,
      openingEvidenceId: source.id,
      controlOpenings: ["account_vat", "account_input_vat", "account_vat_settlement"].map(
        (accountId) => ({ accountId, signedMinor: "0" }),
      ),
      sourceCoverage: ["purchase_ledger", "sales_ledger"].map((family) => ({
        family,
        state: "current",
        evidenceId: source.id,
      })),
      rationale: "Synthetic return capture after close; no posting permission",
    },
    Vat.ActualVatReturn,
  );

  const statement = await post(
    book,
    "/tax-account/statements",
    {
      recordClass: "synthetic",
      balanceConvention: "debit_minus_credit",
      accountId: "account_tax",
      sourceAccountKey: "assessment_tax",
      statementKey: "closed_assessment",
      evidenceId: source.id,
      sourceLocator: "synthetic_authority",
      reviewEvidenceId: source.id,
      rationale: "Closed period assessment",
      currency: "SEK",
      currencyScale: 2,
      startsOn: "2026-09-28",
      endsOn: "2026-09-28",
      openingMinor: "0",
      closingMinor: "-100",
      rows: [
        {
          eventKey: "closed_assessment",
          occurredOn: "2026-09-28",
          amountMinor: "-100",
          classification: "tax_charge",
          description: "Authority charge",
        },
      ],
    },
    TaxAccount.TaxAccountStatement,
  );

  const assessment = await post(
    book,
    "/vat/assessments/records",
    {
      assessmentIdentity: "closed_assessment",
      returnId: saved.id,
      authorityPeriod: "2026-09",
      assessedMinor: "100",
      expectedRemainingMinor: "0",
      taxAccountEventId: statement.events[0]!.id,
      settlementAccountId: "account_vat_settlement",
      taxAccountControlId: "account_tax",
      adoptedVoucherId: null,
      adoptedMatchId: null,
      confirmations: {
        registeredPeriod: true,
        legalEntity: true,
        chargeRelationship: true,
        confirmationEvidenceId: source.id,
      },
      reason: "Exercise financial close fence",
    },
    Assessment.VatAssessment,
  );

  const assessedApproval = await post(
    reviewer,
    `/vat/assessments/records/${assessment.id}/approvals`,
    { version: 1, digest: assessment.digest },
    Assessment.AssessmentApproval,
  );

  await failure(
    await request(book, `/vat/assessments/records/${assessment.id}/execute`, {
      method: "POST",
      body: JSON.stringify({
        version: 1,
        digest: assessment.digest,
        approvalId: assessedApproval.id,
      }),
    }),
    409,
    "PeriodLocked",
  );
  await saveEvidence("next37-close-fence", book);
});
