import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as Schema from "effect/Schema";
import { expect, test } from "vitest";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Commerce from "@open-erp/contracts/commerce";
import * as Credits from "@open-erp/contracts/customer-credit-notes";
import * as Vat from "@open-erp/contracts/vat-returns";
import * as Owners from "@open-erp/contracts/owner-register";
import * as OwnerOperations from "@open-erp/contracts/owner-operations";
import { legalFixture } from "./support/legal-commerce";
import { readPdf } from "./support/pdf";
import {
  apiDirectory,
  database,
  decoded,
  environment,
  evidence,
  fixture,
  key,
  ledger,
  persisted,
  post,
  request,
  failure,
  type BookFixture,
} from "./support/fixtures";

async function credit(
  context: Awaited<ReturnType<typeof legalFixture>>,
  reason: string,
  net: string,
  tax: string,
) {
  const { author, reviewer, original, profile, today } = context;

  const decision = await post(
    author,
    "/evidence",
    {
      title: "Synthetic credit decision",
      content: `${key()}: ${reason}`,
      mediaType: "text/plain",
      origin: "FWD-05 synthetic E2E",
    },
    Accounting.Evidence,
  );

  const review = await post(
    author,
    "/commerce/customer-credit-reviews",
    {
      profile: "se-domestic-b2b-sek-25-accrual-credit-v1",
      originalLegalIssueId: original.id,
      originalIssueDigest: original.digest,
      accountingProfileId: profile.id,
      accountingProfileDigest: profile.digest,
      accountingPeriodId: "period_2026",
      voucherSeries: "A",
      creditEvidenceId: decision.id,
      creditDate: today,
      reason,
      selectedLines: [{ originalLineId: "line_1", creditedNetMinor: net, creditedTaxMinor: tax }],
      acknowledgeNoRefundOrCreditBalance: true,
      acknowledgeVatReturnConsequenceUnobserved: true,
    },
    Credits.CustomerCreditReview,
  );

  const input = { version: 1, digest: review.digest, acknowledgeLimitedProfile: true };

  const approved = await post(
    reviewer,
    `/commerce/customer-credit-reviews/${review.id}/approvals`,
    input,
    Credits.CustomerCreditApproval,
  );

  await failure(
    await request(reviewer, `/change-sets/${review.postingPlan.id}/approvals`, {
      method: "POST",
      body: JSON.stringify({ version: 1, planDigest: review.postingPlan.planDigest }),
    }),
    422,
    "InvalidJournal",
  );

  return post(
    reviewer,
    `/commerce/customer-credit-reviews/${review.id}/execute`,
    { ...input, approvalId: approved.id },
    Credits.CustomerCreditReceipt,
  );
}

// These wire expectations describe the new public artifact boundary before its implementation.
const Descriptor = Schema.Struct({
  id: Accounting.Identifier,
  creditId: Accounting.Identifier,
  documentId: Accounting.Identifier,
  documentRevision: Schema.String,
  documentDigest: Accounting.Digest,
  rendererVersion: Schema.Literal("openerp-se-credit-note-pdfcn-v1"),
  mediaType: Schema.Literal("application/pdf"),
  sha256: Schema.String,
  byteLength: Schema.Int,
  delivered: Schema.Literal(false),
});

const ArtifactView = Schema.Struct({
  state: Schema.Literals(["pending", "rendering_failed", "available"]),
  document: Credits.CustomerCreditSemanticDocument,
  artifact: Schema.NullOr(Descriptor),
  lastFailure: Schema.NullOr(Schema.Struct({ code: Accounting.FailureCode })),
});

async function artifactState(book: BookFixture, creditId: string) {
  return decoded(
    await request(book, `/commerce/customer-credit-notes/${creditId}/artifact`),
    ArtifactView,
  );
}

test("credit PDF recovery consumes the retained document intent without issuing or posting again", async () => {
  const context = await legalFixture();
  const { book, author, original, customer } = context;
  const issued = await credit(context, "Agreed partial credit", "2000", "500");
  const unrenderable = await credit(context, "Unsupported glyph fixture 🧾", "1000", "250");
  const queued = await credit(context, "Credit rendered after listener restart", "1000", "250");
  const before = await persisted(book);
  const balances = await ledger(book);
  expect(
    balances.accounts.find((account) => account.accountId === "account_ar")?.balanceMinor,
  ).toBe("7500");
  expect((await artifactState(book, issued.id)).state).toBe("pending");

  await failure(
    await request(book, `/commerce/customer-credit-notes/${issued.id}/artifact`, {
      method: "POST",
      body: JSON.stringify({
        expectedDocumentDigest: original.digest,
        rendererVersion: "openerp-se-credit-note-pdfcn-v1",
      }),
    }),
    409,
    "StaleDependency",
  );

  await post(
    author,
    `/commerce/counterparties/${customer.id}/revisions`,
    {
      expectedRevision: customer.revision,
      displayName: "Changed after credit issue",
      evidenceId: customer.evidence.evidenceId,
      reason: "The frozen document must retain the earlier name",
    },
    Commerce.CounterpartyRevision,
  );

  const renderInput = {
    expectedDocumentDigest: issued.semanticDocument.digest,
    rendererVersion: "openerp-se-credit-note-pdfcn-v1",
  };

  const renderKey = key();
  const admin = await database();

  try {
    await admin.query(`CREATE FUNCTION openerp.e2e_credit_ack_fault() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION USING ERRCODE = 'P0001', DETAIL = 'Unavailable', MESSAGE = 'Synthetic credit checkpoint fault'; END $$;
      CREATE TRIGGER e2e_credit_ack_fault BEFORE UPDATE OF delivered_at ON openerp.outbox
      FOR EACH ROW EXECUTE FUNCTION openerp.e2e_credit_ack_fault()`);

    await failure(
      await request(book, `/commerce/customer-credit-notes/${issued.id}/artifact`, {
        method: "POST",
        headers: { "idempotency-key": renderKey },
        body: JSON.stringify(renderInput),
      }),
      503,
      "Unavailable",
    );

    const checkpointFailure = await artifactState(book, issued.id);
    expect(checkpointFailure.state).toBe("rendering_failed");
    expect(checkpointFailure.artifact).toBeNull();
    expect(checkpointFailure.lastFailure?.code).toBe("Unavailable");
    expect(await persisted(book)).toEqual(before);
  } finally {
    await admin.query(
      "DROP TRIGGER IF EXISTS e2e_credit_ack_fault ON openerp.outbox; DROP FUNCTION IF EXISTS openerp.e2e_credit_ack_fault()",
    );
    await admin.end();
  }

  const direct = await decoded(
    await request(book, `/commerce/customer-credit-notes/${issued.id}/artifact`, {
      method: "POST",
      headers: { "idempotency-key": renderKey },
      body: JSON.stringify(renderInput),
    }),
    Descriptor,
  );

  expect(direct.documentDigest).toBe(issued.semanticDocument.digest);
  expect((await artifactState(book, queued.id)).state).toBe("pending");

  // The remaining intents were committed while the Bun listener was offline.
  const child = spawn("bun", ["scripts/preparation-runner.ts"], {
    cwd: apiDirectory,
    env: {
      ...process.env,
      DATABASE_URL: environment().runtimeUrl,
      OPENERP_PREPARATION_TOKEN: book.token,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let log = "";
  let startupError: Error | undefined;
  child.once("error", (error) => {
    startupError = error;
  });
  child.stdout.on("data", (chunk: Buffer) => {
    log += chunk.toString();
  });
  child.stderr.on("data", (chunk: Buffer) => {
    log += chunk.toString();
  });

  try {
    const deadline = Date.now() + 30000;
    let ready = false;

    while (Date.now() < deadline) {
      const good = await artifactState(book, queued.id);
      const bad = await artifactState(book, unrenderable.id);

      if (good.state === "available" && bad.state === "rendering_failed") {
        ready = true;
        break;
      }

      if (startupError) throw startupError;

      if (child.exitCode !== null || child.signalCode !== null)
        throw new Error(`Credit runner stopped: ${log}`);

      await new Promise((resolveWait) => setTimeout(resolveWait, 200));
    }

    expect(ready, log).toBe(true);
  } finally {
    if (child.pid !== undefined && child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit");

      const killDeadline = setTimeout(() => {
        child.kill("SIGKILL");
      }, 5000);

      child.kill("SIGTERM");

      try {
        await exited;
      } finally {
        clearTimeout(killDeadline);
      }
    }

    await writeFile(join(environment().artifacts, "credit-render-runner.log"), log);
  }

  const available = await artifactState(book, issued.id);
  const failed = await artifactState(book, unrenderable.id);
  expect(available.document.customer.legalName).toBe("FWD-05 Synthetic Customer");
  expect(available.document.totals).toEqual({
    netMinor: "2000",
    taxMinor: "500",
    grossMinor: "2500",
  });
  expect(failed.lastFailure?.code).toBe("UnsupportedProfile");
  expect(failed.artifact).toBeNull();
  expect(await persisted(book)).toEqual(before);

  const input = {
    expectedDocumentDigest: issued.semanticDocument.digest,
    rendererVersion: "openerp-se-credit-note-pdfcn-v1",
  };

  const commandKey = key();

  const replay = await decoded(
    await request(book, `/commerce/customer-credit-notes/${issued.id}/artifact`, {
      method: "POST",
      headers: { "idempotency-key": commandKey },
      body: JSON.stringify(input),
    }),
    Descriptor,
  );

  const again = await decoded(
    await request(book, `/commerce/customer-credit-notes/${issued.id}/artifact`, {
      method: "POST",
      headers: { "idempotency-key": commandKey },
      body: JSON.stringify(input),
    }),
    Descriptor,
  );

  expect(again).toEqual(replay);
  expect(replay).toEqual(available.artifact);

  await failure(
    await request(book, `/commerce/customer-credit-notes/${issued.id}/artifact`, {
      method: "POST",
      headers: { "idempotency-key": commandKey },
      body: JSON.stringify({ ...input, expectedDocumentDigest: original.digest }),
    }),
    409,
    "IdempotencyConflict",
  );

  const bytes = await decoded(
    await request(book, `/commerce/customer-credit-artifacts/${replay.id}`),
    Schema.Struct({ ...Descriptor.fields, contentBase64: Schema.String }),
  );

  const pdf = Buffer.from(bytes.contentBase64, "base64");
  expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  expect(pdf.length).toBe(bytes.byteLength);
  expect(createHash("sha256").update(pdf).digest("hex")).toBe(bytes.sha256);
  expect(bytes.documentDigest).toBe(issued.semanticDocument.digest);
  expect(bytes.documentRevision).toBe(issued.semanticDocument.revision);
  expect(
    await decoded(
      await request(book, `/commerce/customer-credit-notes/${issued.id}`),
      Credits.CustomerCreditReceipt,
    ),
  ).toEqual(issued);

  const outsider = await fixture();
  await failure(
    await request(outsider, `/commerce/customer-credit-artifacts/${replay.id}`),
    404,
    "NotFound",
  );
  expect(await persisted(book)).toEqual(before);
  expect(await ledger(book)).toEqual(balances);

  const pages = await readPdf(pdf, "customer-credit");
  const text = pages.map((page) => page.text).join(" ");
  expect(text).toContain("FWD-05 Synthetic Customer");
  expect(text).not.toContain("Changed after credit issue");
  expect(text).toContain("20,00 kr");
  expect(text).toContain("5,00 kr");
  expect(text).toContain("25,00 kr");
  expect(text).toContain(original.legalDocumentNumber);
  expect(text).toContain("Sida 1 av 1");
  const creditPage = pages[0];

  if (!creditPage) throw new Error("The credit PDF has no page.");

  const summaryLabel = creditPage.items.find((item) => item.text === "Krediterat belopp");
  const note = creditPage.items.find((item) => item.text.startsWith("Krediten minskar"));
  expect(summaryLabel).toBeDefined();
  expect(note).toBeDefined();
  expect(note?.y).toBeGreaterThan(summaryLabel?.y ?? Infinity);
  expect(creditPage.text).toContain("Om krediten");
  await writeFile(
    join(environment().artifacts, "credit-document-journey.json"),
    JSON.stringify(
      {
        dataClass: "synthetic_e2e",
        original,
        issued,
        unrenderable,
        queued,
        direct,
        available,
        failed,
        replay,
        before,
        balances,
        limits:
          "PDF creation only; no delivery, refund, VAT-return consequence or actual-company qualification.",
      },
      null,
      2,
    ),
  );
}, 120000);

async function vatConfiguration(
  context: Awaited<ReturnType<typeof legalFixture>>,
  evidenceId: string,
) {
  const { book, reviewer } = context;
  const admin = await database();
  const releaseId = `vat_fixture_${book.bookId}`;

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
    requiredSourceFamilies: ["sales_ledger", "purchase_ledger"],
    sourceManifest: "FWD-04 synthetic vectors; not a legal rule release",
  };

  const checksum = `sha256:${createHash("sha256").update(JSON.stringify(filing)).digest("hex")}`;

  try {
    // Test-only qualification metadata. Financial records below use their public owners.
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
      const reviewed = { factRevisionId: id, reviewer: reviewer.actorId, result: "confirmed" };
      await admin.query(
        `INSERT INTO openerp.company_fact_reviews
        (entity_id,fact_revision_id,reviewer,result,reviewed_at,digest,body)
        VALUES($1,$2,$3,'confirmed',now(),openerp.digest($4::jsonb),$4::jsonb || jsonb_build_object('digest',openerp.digest($4::jsonb)))`,
        [book.entityId, id, reviewer.actorId, JSON.stringify(reviewed)],
      );
    }

    const activation = {
      id: "vat_fixture_activation",
      scope: { entityId: book.entityId, bookId: book.bookId },
      family: "vat",
      ruleReleaseId: releaseId,
    };

    await admin.query(
      `INSERT INTO openerp.company_activations
      (book_id,id,family,rule_release_id,effective_from,activated_by,activated_at,digest,body)
      VALUES($1,'vat_fixture_activation','vat',$2,'2026-01-01',$3,now(),openerp.digest($4::jsonb),$4::jsonb || jsonb_build_object('digest',openerp.digest($4::jsonb)))`,
      [book.bookId, releaseId, reviewer.actorId, JSON.stringify(activation)],
    );
    await admin.query(
      `INSERT INTO openerp.vat_control_profiles(book_id,id,identity_key,role_evidence_id,body)
      VALUES($1,'vat_fixture_controls','vat_fixture_controls',$2,jsonb_build_object('id','vat_fixture_controls','digest',openerp.digest('{"id":"vat_fixture_controls"}'::jsonb)))`,
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
        VALUES($1,'vat_fixture_controls',$2,$3,1,$4,$3,true)`,
        [book.bookId, role, accountId, code],
      );
    }
  } finally {
    await admin.end();
  }
}

test("VAT capture includes owned credits and owner deductions once and retains earlier returns", async () => {
  const context = await legalFixture([
    { id: "account_input_vat", code: "2641", name: "Synthetic input VAT" },
    { id: "account_vat_settlement", code: "2650", name: "Synthetic VAT settlement" },
    { id: "account_owner", code: "2893", name: "Synthetic owner liability" },
    { id: "account_expense", code: "6500", name: "Synthetic expense" },
  ]);

  const { book, author, reviewer, original, today } = context;
  const basisEvidence = await evidence(book);
  await vatConfiguration(context, basisEvidence.id);
  const credited = await credit(context, "Synthetic same-period VAT credit", "2000", "500");
  const startsOn = `${today.slice(0, 7)}-01`;
  const end = new Date(`${startsOn}T00:00:00Z`);
  end.setUTCMonth(end.getUTCMonth() + 1);
  end.setUTCDate(0);

  const input = {
    startsOn,
    endsOn: end.toISOString().slice(0, 10),
    periodEvidenceId: basisEvidence.id,
    openingEvidenceId: basisEvidence.id,
    controlOpenings: ["account_vat", "account_input_vat", "account_vat_settlement"].map(
      (accountId) => ({ accountId, signedMinor: "0" }),
    ),
    sourceCoverage: ["sales_ledger", "purchase_ledger"].map((family) => ({
      family,
      state: "current",
      evidenceId: basisEvidence.id,
    })),
    rationale: "Synthetic FWD-04 scope only; no real-company qualification or submission",
  };

  await failure(
    await request(book, "/vat-returns/actuals", { method: "POST", body: JSON.stringify(input) }),
    422,
    "UnsupportedProfile",
  );

  const voucher = await decoded(
    await request(book, `/vouchers/${original.postingReceipt.voucherId}`),
    Accounting.Voucher,
  );

  const taxLine = voucher.action.lines.find((line) => line.accountId === "account_vat");

  if (!taxLine) throw new Error("The original must have its owned output VAT line.");

  const originalFact = await post(
    author,
    "/vat-returns/facts",
    {
      sourceKey: "fwd04_original_sale",
      expectedDigest: null,
      recordClass: "actual_company",
      evidenceId: original.sourceEvidence.evidenceId,
      sourceLocator: "original_native_invoice",
      description: "Synthetic original sale",
      reviewEvidenceId: basisEvidence.id,
      reviewRationale: "Synthetic fixture: whole original voucher, same registered period",
      treatment: "domestic_sale",
      netMinor: "10000",
      vatMinor: "2500",
      grossMinor: "12500",
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

  const owner = await post(
    author,
    "/owner-register/owners",
    {
      sourceKey: key(),
      displayName: "Synthetic owner",
      dataNature: "synthetic_example",
      evidenceId: basisEvidence.id,
      reason: "Synthetic owner expense",
    },
    Owners.Owner,
  );

  const supplier = await post(
    author,
    "/commerce/counterparties",
    {
      kind: "synthetic_counterparty_v1",
      externalKey: key(),
      role: "supplier",
      displayName: "Synthetic supplier",
      evidenceId: basisEvidence.id,
      reason: "Synthetic purchase",
    },
    Commerce.CounterpartyRevision,
  );

  const treatment = {
    rate: { numerator: "1", denominator: "4" },
    invoiceTaxRounding: "half_up",
    deductionRounding: "half_up",
    acceptancePolicy: "exact_match",
    toleranceMinor: "0",
  };

  const review = await post(
    author,
    "/owner-operations/reviews",
    {
      mode: "owner_paid_purchase",
      ownerId: owner.id,
      controlAccountId: "account_owner",
      accountingPeriodId: "period_2026",
      postingDate: today,
      series: "A",
      reason: "Synthetic partial and zero deduction",
      evidence: { paidEvidenceId: basisEvidence.id, reason: "Owner paid the synthetic expense" },
      purchase: {
        sourceEvidenceId: basisEvidence.id,
        counterpartyId: supplier.id,
        supplierDocumentNumber: "FWD04-1",
        documentDate: today,
        taxPoint: { taxPointOn: today, basis: "document_date" },
        lines: [
          {
            lineId: "partial",
            expenseAccountId: "account_expense",
            netMinor: "1000",
            sourceTaxMinor: "250",
            treatment: {
              ...treatment,
              basis: "half_deduction",
              deduction: { numerator: "1", denominator: "2" },
            },
          },
          {
            lineId: "zero",
            expenseAccountId: "account_expense",
            netMinor: "400",
            sourceTaxMinor: "100",
            treatment: {
              ...treatment,
              basis: "no_deduction_exclusion",
              deduction: { numerator: "0", denominator: "1" },
            },
          },
        ],
      },
    },
    OwnerOperations.OwnerOperationReview,
  );

  const approved = await post(
    reviewer,
    `/owner-operations/reviews/${review.id}/approvals`,
    { version: 1, digest: review.digest },
    OwnerOperations.OwnerOperationApproval,
  );

  const paid = await post(
    reviewer,
    `/owner-operations/reviews/${review.id}/execute`,
    { version: 1, digest: review.digest, approvalId: approved.id },
    OwnerOperations.OwnerOperationReceipt,
  );

  const beforeCapture = await persisted(book);

  await failure(
    await request(book, "/vat-returns/actuals", {
      method: "POST",
      body: JSON.stringify({ ...input, startsOn: `${today.slice(0, 7)}-02` }),
    }),
    422,
    "UnsupportedProfile",
  );

  const saved = await post(book, "/vat-returns/actuals", input, Vat.ActualVatReturn);
  expect(saved.calculation.filingReady).toBe(true);
  expect(
    saved.calculation.boxes.map((box) => ({
      box: box.box,
      exact: box.exactMinor,
      reported: box.reportedMinor,
      residual: box.residualMinor,
    })),
  ).toEqual([
    { box: "05", exact: "8000", reported: "80", residual: "0" },
    { box: "10", exact: "2000", reported: "20", residual: "0" },
    { box: "48", exact: "125", reported: "1", residual: "25" },
    { box: "49", exact: "1875", reported: "19", residual: "-25" },
  ]);
  const ownerFacts = saved.basis.facts.filter((fact) => fact.origin === "owned_owner_purchase");
  expect(ownerFacts).toHaveLength(2);
  expect(ownerFacts.map((fact) => [fact.sourceTaxMinor, fact.taxMinor])).toEqual(
    expect.arrayContaining([
      ["100", "0"],
      ["250", "125"],
    ]),
  );
  expect(ownerFacts.find((fact) => fact.taxMinor === "0")?.controlComponents).toEqual([]);
  const creditFact = saved.basis.facts.find((fact) => fact.origin === "owned_customer_credit");
  expect(creditFact?.adjustsFactId).toBe(originalFact.factId);
  expect(creditFact?.basisMinor).toBe("-2000");
  expect(creditFact?.taxMinor).toBe("-500");
  expect(await persisted(book)).toEqual(beforeCapture);

  const tiny = await credit(context, "Synthetic zero-tax credit", "1", "0");

  const old = await decoded(
    await request(book, `/vat-returns/actuals/${saved.id}`),
    Vat.ActualVatReturnView,
  );

  expect(old.saved).toEqual(saved);
  expect(old.currentness.basisCurrent).toBe(false);
  const refreshed = await post(book, "/vat-returns/actuals", input, Vat.ActualVatReturn);

  const zeroCredit = refreshed.basis.facts.find(
    (fact) => fact.voucherId === tiny.postingReceipt.voucherId,
  );

  expect(zeroCredit?.taxMinor).toBe("0");
  expect(zeroCredit?.controlComponents).toEqual([]);
  expect(refreshed.calculation.filingReady).toBe(true);

  const nextMonth = new Date(`${startsOn}T00:00:00Z`);
  nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);

  const movedOriginal = await post(
    author,
    "/vat-returns/facts",
    {
      ...originalFact.input,
      expectedDigest: originalFact.digest,
      taxPointOn: nextMonth.toISOString().slice(0, 10),
      dateBasis: "Synthetic cross-period refusal case",
    },
    Vat.VatFact,
  );

  await failure(
    await request(book, "/vat-returns/actuals", { method: "POST", body: JSON.stringify(input) }),
    422,
    "UnsupportedProfile",
  );

  const restoredOriginal = await post(
    author,
    "/vat-returns/facts",
    {
      ...originalFact.input,
      expectedDigest: movedOriginal.digest,
    },
    Vat.VatFact,
  );

  const ownerVoucher = await decoded(
    await request(book, `/vouchers/${paid.postingReceipt.voucherId}`),
    Accounting.Voucher,
  );

  const inputLine = ownerVoucher.action.lines.find(
    (line) => line.accountId === "account_input_vat",
  );

  if (!inputLine) throw new Error("The owner purchase must retain its deductible VAT line.");

  const duplicateOwner = await post(
    author,
    "/vat-returns/facts",
    {
      ...originalFact.input,
      sourceKey: "fwd04_duplicate_owner",
      expectedDigest: null,
      evidenceId: basisEvidence.id,
      description: "Deliberate duplicate representation",
      treatment: "domestic_purchase",
      netMinor: "500",
      vatMinor: "125",
      grossMinor: "625",
      voucherId: ownerVoucher.id,
      taxLineIds: [inputLine.lineId],
    },
    Vat.VatFact,
  );

  const duplicateCapture = await post(book, "/vat-returns/actuals", input, Vat.ActualVatReturn);
  expect(duplicateCapture.calculation.filingReady).toBe(false);
  expect(
    duplicateCapture.calculation.exclusions.some(
      (entry) => entry.reason === "duplicate_source_component",
    ),
  ).toBe(true);
  expect(duplicateCapture.calculation.boxes.find((box) => box.box === "48")?.exactMinor).toBe(
    "125",
  );

  const ambiguousOriginal = await post(
    author,
    "/vat-returns/facts",
    {
      ...originalFact.input,
      sourceKey: "fwd04_ambiguous_original",
      expectedDigest: null,
    },
    Vat.VatFact,
  );

  await failure(
    await request(book, "/vat-returns/actuals", { method: "POST", body: JSON.stringify(input) }),
    422,
    "UnsupportedProfile",
  );

  const beforeWithdrawal = await decoded(
    await request(book, `/vat-returns/actuals/${saved.id}`),
    Vat.ActualVatReturnView,
  );

  expect(beforeWithdrawal.currentness.staleReasons).not.toContain(
    "admitted_fact_withdrawal_changed",
  );

  for (const fact of [restoredOriginal, ambiguousOriginal]) {
    await post(
      author,
      `/vat-returns/facts/${fact.factId}/withdrawal`,
      {
        expectedDigest: fact.digest,
        evidenceId: basisEvidence.id,
        rationale: "Synthetic withdrawal case",
      },
      Vat.VatFactWithdrawal,
    );
  }

  const withdrawn = await decoded(
    await request(book, `/vat-returns/actuals/${saved.id}`),
    Vat.ActualVatReturnView,
  );

  expect(withdrawn.saved).toEqual(saved);
  expect(withdrawn.currentness.staleReasons).toContain("admitted_fact_withdrawal_changed");
  await failure(
    await request(book, "/vat-returns/actuals", { method: "POST", body: JSON.stringify(input) }),
    422,
    "UnsupportedProfile",
  );

  await writeFile(
    join(environment().artifacts, "owned-vat-journey.json"),
    JSON.stringify(
      {
        dataClass: "synthetic_e2e",
        original,
        credited,
        originalFact,
        paid,
        saved,
        tiny,
        old,
        refreshed,
        movedOriginal,
        restoredOriginal,
        duplicateOwner,
        duplicateCapture,
        ambiguousOriginal,
        withdrawn,
        limits: "Reviewed test configuration only; no actual-company qualification or filing.",
      },
      null,
      2,
    ),
  );
}, 60000);
