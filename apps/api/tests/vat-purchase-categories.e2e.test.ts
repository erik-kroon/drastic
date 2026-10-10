import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import * as Acceptance from "@open-erp/contracts/supplier-acceptance";
import * as Vat from "@open-erp/contracts/vat-returns";
import * as Examples from "@open-erp/contracts/decision-examples";
import * as Drafts from "@open-erp/contracts/supplier-invoice-drafts";
import * as OwnerOperations from "@open-erp/contracts/owner-operations";
import * as Owners from "@open-erp/contracts/owner-register";
import * as A from "@open-erp/contracts/accounting";
import * as Dimensions from "@open-erp/contracts/dimensions";
import { createDraft, supplierFixture } from "./support/supplier-review";
import { syntheticQualification } from "./support/rule-qualification";
import {
  createSession,
  database,
  decoded,
  environment,
  evidence,
  failure,
  key,
  post,
  request,
  type BookFixture,
} from "./support/fixtures";

async function context(section = true, admitted = true, activateFuture = true) {
  const f = await supplierFixture([
    { id: "account_payable", code: "2440", name: "Supplier payable" },
    { id: "account_input_vat", code: "2641", name: "Input VAT" },
    { id: "account_expense", code: "6000", name: "Synthetic expense" },
    { id: "account_owner", code: "2893", name: "Synthetic owner liability" },
  ]);

  f.book.token = (await createSession(f.book)).token;
  const releases: { id: string; checksum: string }[] = [];

  if (!admitted) return { ...f, releases };
  const admin = await database();

  try {
    for (const [kind, value] of [
      ["jurisdiction", "SE"],
      ["vat_period", "monthly"],
    ]) {
      const id = `${kind}_${f.book.bookId}`;

      const body = {
        id,
        entityId: f.book.entityId,
        factKind: kind,
        effectiveFrom: "2026-01-01",
        effectiveTo: "2026-12-31",
        recordedBy: f.book.actorId,
        value: { state: "known", value },
      };

      await admin.query(
        "INSERT INTO openerp.company_fact_revisions(entity_id,id,fact_kind,effective_from,effective_to,recorded_by,recorded_at,digest,body) VALUES($1,$2,$3,'2026-01-01','2026-12-31',$4,now(),openerp.digest($5::jsonb),$5::jsonb || jsonb_build_object('digest',openerp.digest($5::jsonb)))",
        [f.book.entityId, id, kind, f.book.actorId, JSON.stringify(body)],
      );
      const review = { factRevisionId: id, reviewer: f.book.actorId, result: "confirmed" };
      await admin.query(
        "INSERT INTO openerp.company_fact_reviews(entity_id,fact_revision_id,reviewer,result,reviewed_at,digest,body) VALUES($1,$2,$3,'confirmed',now(),openerp.digest($4::jsonb),$4::jsonb || jsonb_build_object('digest',openerp.digest($4::jsonb)))",
        [f.book.entityId, id, f.book.actorId, JSON.stringify(review)],
      );
    }

    for (const [edition, startsOn, endsOn, denominator] of [
      [1, "2026-01-01", "2026-09-30", "4"],
      [2, "2026-10-01", "2026-12-31", "5"],
    ] as const) {
      const id = `vat_categories_${edition}_${f.book.bookId}`;

      const vat = {
        currency: "SEK",
        calculatorVersion: "vat-filing-actual-v1",
        filingUnitScale: 0,
        rounding: "toward_zero",
        rates: [{ rateId: "synthetic_rate", numerator: "1", denominator, salesBox: "10" }],
        mappingRules: [
          {
            mappingRuleId: "synthetic_purchase",
            treatment: "domestic_purchase",
            rateId: "synthetic_rate",
            basisBox: null,
            inputBox: "48",
          },
        ],
        supportedTreatments: ["domestic_purchase"],
        requiredSourceFamilies: ["purchase_ledger"],
        sourceManifest: "AUT04 synthetic mechanics only; no legal release",
        ...(section
          ? {
              purchaseCategories: {
                schema: "swedish_purchase_categories_v1",
                categories: [
                  {
                    categoryId: "synthetic_ordinary_full",
                    rateId: "synthetic_rate",
                    entitlement: "ordinary_domestic_full",
                    requiredSupport: ["domestic_eligibility", "full_deduction"],
                  },
                ],
              },
            }
          : {}),
      };

      const checksum = `sha256:${createHash("sha256").update(JSON.stringify(vat)).digest("hex")}`;

      const version = (
        await admin.query(
          "SELECT coalesce(max(version),410)+1 AS version FROM openerp.rule_releases WHERE jurisdiction='SE' AND family='vat'",
        )
      ).rows[0]!.version;

      const body = {
        id,
        jurisdiction: "SE",
        family: "vat",
        version,
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
        validFrom: startsOn,
        validTo: endsOn,
        sourceManifest: "Synthetic category boundary; not tax-law adoption",
        qualificationStatus: "reviewed",
        recordClasses: ["actual_company"],
        qualification: syntheticQualification(checksum, startsOn, endsOn),
        vat,
      };

      await admin.query(
        "INSERT INTO openerp.rule_releases(id,jurisdiction,family,version,checksum,body) VALUES($1,'SE','vat',$2,$3,$4)",
        [id, version, checksum, JSON.stringify(body)],
      );
      const activationId = `category_activation_${edition}`;

      const activation = {
        id: activationId,
        scope: { entityId: f.book.entityId, bookId: f.book.bookId },
        family: "vat",
        ruleReleaseId: id,
      };

      if (edition === 1 || activateFuture)
        await admin.query(
          "INSERT INTO openerp.company_activations(book_id,id,family,rule_release_id,effective_from,effective_to,activated_by,activated_at,digest,body) VALUES($1,$2,'vat',$3,$4,$7,$5,now(),openerp.digest($6::jsonb),$6::jsonb || jsonb_build_object('digest',openerp.digest($6::jsonb)))",
          [
            f.book.bookId,
            activationId,
            id,
            startsOn,
            f.book.actorId,
            JSON.stringify(activation),
            endsOn,
          ],
        );
      releases.push({ id, checksum });
    }
  } finally {
    await admin.end();
  }

  return { ...f, releases };
}

async function support(
  book: BookFixture,
  sourceId: string,
  on: string,
  taxMinor: string,
  fullDeduction = "confirmed",
) {
  return post(
    book,
    "/vat-returns/facts",
    {
      sourceKey: key(),
      expectedDigest: null,
      recordClass: "actual_company",
      evidenceId: sourceId,
      sourceLocator: "single_line_source_whole",
      description: "Synthetic independently reviewed entitlement",
      reviewEvidenceId: sourceId,
      reviewRationale:
        "Synthetic domestic/full entitlement confirmed independently before preparation",
      treatment: "domestic_purchase",
      netMinor: "10000",
      vatMinor: taxMinor,
      grossMinor: (10000n + BigInt(taxMinor)).toString(),
      currency: "SEK",
      issuedOn: on,
      receivedOn: on,
      suppliedOn: on,
      taxPointOn: on,
      dateBasis: "Synthetic same-day acquisition",
      periodEvidenceId: sourceId,
      registration: "registered",
      registrationEvidenceId: sourceId,
      method: "accrual",
      methodEvidenceId: sourceId,
      domesticEligibility: "confirmed",
      treatmentEvidenceId: sourceId,
      fullDeduction,
      deductionEvidenceId: sourceId,
      voucherId: null,
      taxLineIds: [],
      expenseLink: null,
    },
    Vat.VatFact,
  );
}

async function draftFor(f: Awaited<ReturnType<typeof context>>, on: string, taxMinor: string) {
  const source = await post(
    f.book,
    "/evidence",
    {
      title: "Synthetic source invoice",
      content: `Synthetic invoice ${key()} on ${on}: net 10000, tax ${taxMinor}.`,
      mediaType: "text/plain",
      origin: "AUT04 synthetic source",
    },
    A.Evidence,
  );

  const draft = await createDraft(f.book, {
    ...f.content,
    sourceEvidenceId: source.id,
    supplierDocumentNumber: key(),
    documentDate: on,
    supplyDate: on,
    dueDate: on,
    sourceTotalMinor: (10000n + BigInt(taxMinor)).toString(),
    lines: f.content.lines.map((line) => ({
      ...line,
      taxMinor,
      sourceGrossMinor: (10000n + BigInt(taxMinor)).toString(),
    })),
  });

  return { source, draft };
}

function preparation(
  draft: Awaited<ReturnType<typeof createDraft>>,
  rate: string,
  revisionId?: string,
) {
  return {
    profile: "swedish-purchase-v1",
    draftId: draft.id,
    expectedRevision: draft.revision,
    expectedDigest: draft.digest,
    controlAccountId: "account_payable",
    accountingPeriodId: "period_2026",
    series: "A",
    reason: "Synthetic category resolution",
    acknowledgeSyntheticOnly: true,
    taxPoint: { taxPointOn: draft.content.documentDate, basis: "document_date" },
    lineAssignments: draft.content.lines.map((line) => ({
      lineId: line.id,
      expenseAccountId: "account_expense",
      treatment: {
        basis: "full_deduction",
        rate: { numerator: rate, denominator: "100" },
        deduction: { numerator: "1", denominator: "1" },
        invoiceTaxRounding: "half_up",
        deductionRounding: "half_up",
        acceptancePolicy: "exact_match",
        toleranceMinor: "0",
        ...(revisionId
          ? {
              category: {
                categoryId: "synthetic_ordinary_full",
                supportFactRevisionIds: [revisionId],
              },
            }
          : {}),
      },
    })),
  };
}

test("purchase category release boundary preserves exact treatment and stored witness through approval execution and export", async () => {
  const f = await context(true, true, false);
  const observed = [];

  for (const [on, rate, taxMinor, edition] of [
    ["2026-09-30", "25", "2500", 0],
    ["2026-10-01", "20", "2000", 1],
  ] as const) {
    const { source, draft } = await draftFor(f, on, taxMinor);
    const fact = await support(f.book, source.id, on, taxMinor);
    const input = preparation(draft, rate, fact.id);

    const review = await post(
      f.book,
      "/commerce/supplier-acceptance-reviews",
      input,
      Acceptance.SupplierAcceptanceReview,
    );

    const treatment = review.originalLines![0]!.treatment;
    expect(treatment.rate).toEqual({ numerator: rate, denominator: "100" });
    expect(treatment.categoryResolution).toMatchObject({
      categoryId: "synthetic_ordinary_full",
      schema: "swedish_purchase_categories_v1",
      resolverVersion: "swedish_purchase_category_resolver_v1",
      taxPointOn: on,
      ruleReleaseId: f.releases[edition]!.id,
      ruleReleaseChecksum: f.releases[edition]!.checksum,
      supportFacts: [{ revisionId: fact.id, digest: fact.digest }],
    });

    const wrong = {
      ...input,
      lineAssignments: input.lineAssignments.map((line) => ({
        ...line,
        treatment: { ...line.treatment, categoryResolution: treatment.categoryResolution },
      })),
    };

    await failure(
      await request(f.book, "/commerce/supplier-acceptance-reviews", {
        method: "POST",
        headers: { "idempotency-key": key() },
        body: JSON.stringify(wrong),
      }),
      400,
      "InvalidRequest",
    );

    const approved = await post(
      f.book,
      `/commerce/supplier-acceptance-reviews/${review.id}/approvals`,
      { version: 1, digest: review.digest, acknowledgeSyntheticOnly: true },
      Acceptance.SupplierAcceptanceApproval,
    );

    if (edition === 0) {
      const admin = await database();

      try {
        const activation = {
          id: "category_activation_2",
          scope: { entityId: f.book.entityId, bookId: f.book.bookId },
          family: "vat",
          ruleReleaseId: f.releases[1]!.id,
        };

        await admin.query(
          "INSERT INTO openerp.company_activations(book_id,id,family,rule_release_id,effective_from,activated_by,activated_at,digest,body) VALUES($1,'category_activation_2','vat',$2,'2026-10-01',$3,now(),openerp.digest($4::jsonb),$4::jsonb || jsonb_build_object('digest',openerp.digest($4::jsonb)))",
          [f.book.bookId, f.releases[1]!.id, f.book.actorId, JSON.stringify(activation)],
        );
      } finally {
        await admin.end();
      }
    }

    const execution = {
      version: 1,
      digest: review.digest,
      acknowledgeSyntheticOnly: true,
      approvalId: approved.id,
    };

    const executionKey = key();

    const execute = () =>
      request(f.book, `/commerce/supplier-acceptance-reviews/${review.id}/execute`, {
        method: "POST",
        headers: { "idempotency-key": executionKey },
        body: JSON.stringify(execution),
      });

    const posted = await decoded(await execute(), Acceptance.SupplierAcceptanceReceipt);
    const replay = await decoded(await execute(), Acceptance.SupplierAcceptanceReceipt);
    expect(replay).toEqual(posted);

    const reclassifiedSupport = await post(
      f.book,
      "/vat-returns/facts",
      { ...fact.input, expectedDigest: fact.digest, fullDeduction: "unknown" },
      Vat.VatFact,
    );

    expect(reclassifiedSupport.id).not.toBe(fact.id);
    expect(await decoded(await execute(), Acceptance.SupplierAcceptanceReceipt)).toEqual(posted);

    const exported = await post(
      f.book,
      "/automation/decision-examples",
      { purpose: "training", selectedDecisionIds: [approved.id] },
      Examples.DecisionExampleExport,
    );

    expect(exported.examples[0]!.consequence!.treatments[0]!.capture.vat).toMatchObject({
      category: "synthetic_ordinary_full",
      profileIdentity: f.releases[edition]!.checksum,
      resolvedRate: { numerator: rate, denominator: "100" },
    });
    expect(exported.examples[0]!.missingFacts).not.toContain("vat_category_not_captured");
    expect(exported.examples[0]!.chosenTreatment.vatCategory).toBe("synthetic_ordinary_full");

    if (edition === 0) {
      const next = await draftFor(f, on, taxMinor);

      const hints = await decoded(
        await request(
          f.book,
          `/commerce/supplier-account-suggestions/${f.supplier.id}?draftId=${next.draft.id}&draftRevision=${next.draft.revision}`,
        ),
        Drafts.SupplierAccountSuggestions,
      );

      expect(hints.items[0]!.categoryResolution).toEqual(treatment.categoryResolution);
    }

    observed.push({ on, expectedRate: rate, fact, reclassifiedSupport, review, posted, exported });
  }

  const legacy = await draftFor(f, "2026-09-30", "2500");

  const legacyReview = await post(
    f.book,
    "/commerce/supplier-acceptance-reviews",
    preparation(legacy.draft, "25"),
    Acceptance.SupplierAcceptanceReview,
  );

  expect(legacyReview.originalLines![0]!.treatment).not.toHaveProperty("categoryResolution");
  await writeFile(
    join(environment().artifacts, "vat-purchase-category-boundaries.json"),
    JSON.stringify({ syntheticOnly: true, observed, legacyReview }, null, 2),
  );
});

test("purchase category opt-in refuses absent profiles categories entitlement foreign withdrawal and ambiguous multi-line sources", async () => {
  const f = await context();
  const noSection = await context(false);
  const noProfile = await context(true, false);
  const cases = [];

  for (const mode of [
    "no_profile",
    "no_section",
    "unknown_category",
    "missing_support",
    "foreign_support",
    "withdrawn_support",
    "unknown_entitlement",
    "wrong_source",
    "wrong_taxpoint",
    "rate_mismatch",
    "partial_deduction",
    "multi_line",
    "withdraw_after_review",
    "withdraw_after_approval",
    "superseded_support",
    "supersede_after_approval",
  ] as const) {
    let owner = f;

    if (mode === "no_section") owner = noSection;

    if (mode === "no_profile") owner = noProfile;
    const taxMinor = mode === "rate_mismatch" ? "2500" : "2000";
    const rate = mode === "rate_mismatch" ? "25" : "20";
    const { source, draft } = await draftFor(owner, "2026-10-01", taxMinor);
    const supportOwner = mode === "foreign_support" ? noSection : owner;

    const supportSource =
      mode === "foreign_support" || mode === "wrong_source"
        ? await evidence(supportOwner.book)
        : source;

    const fact = await support(
      supportOwner.book,
      supportSource.id,
      mode === "wrong_taxpoint" ? "2026-09-30" : "2026-10-01",
      taxMinor,
      mode === "unknown_entitlement" ? "unknown" : "confirmed",
    );

    if (mode === "superseded_support")
      await post(
        owner.book,
        "/vat-returns/facts",
        { ...fact.input, expectedDigest: fact.digest, fullDeduction: "unknown" },
        Vat.VatFact,
      );

    if (mode === "withdrawn_support")
      await post(
        owner.book,
        `/vat-returns/facts/${fact.factId}/withdrawal`,
        {
          expectedDigest: fact.digest,
          evidenceId: source.id,
          rationale: "Synthetic entitlement withdrawn",
        },
        Vat.VatFactWithdrawal,
      );
    let input = preparation(draft, rate, mode === "missing_support" ? "revision_missing" : fact.id);

    if (mode === "unknown_category")
      input.lineAssignments[0]!.treatment.category!.categoryId = "category_unknown";

    if (mode === "partial_deduction") {
      input.lineAssignments[0]!.treatment.basis = "half_deduction";
      input.lineAssignments[0]!.treatment.deduction = { numerator: "1", denominator: "2" };
    }

    if (mode === "multi_line") {
      const doubled = await createDraft(owner.book, {
        ...draft.content,
        supplierDocumentNumber: key(),
        sourceTotalMinor: ((10000n + BigInt(taxMinor)) * 2n).toString(),
        lines: [...draft.content.lines, { ...draft.content.lines[0]!, id: "second_equal_line" }],
      });

      input = preparation(doubled, rate, fact.id);
    }

    if (
      ["withdraw_after_review", "withdraw_after_approval", "supersede_after_approval"].includes(
        mode,
      )
    ) {
      const review = await post(
        owner.book,
        "/commerce/supplier-acceptance-reviews",
        input,
        Acceptance.SupplierAcceptanceReview,
      );

      const approvalInput = { version: 1, digest: review.digest, acknowledgeSyntheticOnly: true };

      const approval =
        mode !== "withdraw_after_review"
          ? await post(
              owner.book,
              `/commerce/supplier-acceptance-reviews/${review.id}/approvals`,
              approvalInput,
              Acceptance.SupplierAcceptanceApproval,
            )
          : null;

      if (mode === "supersede_after_approval") {
        await post(
          owner.book,
          "/vat-returns/facts",
          { ...fact.input, expectedDigest: fact.digest, fullDeduction: "unknown" },
          Vat.VatFact,
        );
      } else {
        await post(
          owner.book,
          `/vat-returns/facts/${fact.factId}/withdrawal`,
          {
            expectedDigest: fact.digest,
            evidenceId: source.id,
            rationale: "Synthetic support revoked after sealing",
          },
          Vat.VatFactWithdrawal,
        );
      }

      const endpoint = approval ? "execute" : "approvals";
      await failure(
        await request(
          owner.book,
          `/commerce/supplier-acceptance-reviews/${review.id}/${endpoint}`,
          {
            method: "POST",
            headers: { "idempotency-key": key() },
            body: JSON.stringify({
              ...approvalInput,
              ...(approval ? { approvalId: approval.id } : {}),
            }),
          },
        ),
        409,
        "StaleDependency",
      );
      cases.push({ mode, refused: true, reviewId: review.id, supportRevisionId: fact.id });
      continue;
    }

    const response = await request(owner.book, "/commerce/supplier-acceptance-reviews", {
      method: "POST",
      headers: { "idempotency-key": key() },
      body: JSON.stringify(input),
    });

    await failure(response, 422, "UnsupportedProfile");
    cases.push({ mode, refused: true, draftId: input.draftId, supportRevisionId: fact.id });
  }

  const owned = await draftFor(f, "2026-10-01", "2000");

  const owner = await post(
    f.book,
    "/owner-register/owners",
    {
      sourceKey: key(),
      displayName: "Synthetic purchase owner",
      dataNature: "synthetic_example",
      evidenceId: owned.source.id,
      reason: "Synthetic registered owner",
    },
    Owners.Owner,
  );

  const ownerInput = {
    mode: "owner_paid_purchase",
    ownerId: owner.id,
    controlAccountId: "account_owner",
    accountingPeriodId: "period_2026",
    postingDate: "2026-10-01",
    series: "A",
    reason: "Synthetic exact owner purchase",
    evidence: { paidEvidenceId: owned.source.id, reason: "Synthetic owner payment evidence" },
    purchase: {
      sourceEvidenceId: owned.source.id,
      counterpartyId: f.supplier.id,
      supplierDocumentNumber: key(),
      documentDate: "2026-10-01",
      taxPoint: { taxPointOn: "2026-10-01", basis: "document_date" },
      lines: [
        {
          lineId: "line_purchase",
          expenseAccountId: "account_expense",
          netMinor: "10000",
          sourceTaxMinor: "2000",
          treatment: preparation(owned.draft, "20").lineAssignments[0]!.treatment,
        },
      ],
    },
  };

  const ownerReview = await post(
    f.book,
    "/owner-operations/reviews",
    ownerInput,
    OwnerOperations.OwnerOperationReview,
  );

  const forbiddenOwner = {
    ...ownerInput,
    purchase: {
      ...ownerInput.purchase,
      lines: ownerInput.purchase.lines.map((line) => ({
        ...line,
        treatment: {
          ...line.treatment,
          category: {
            categoryId: "synthetic_ordinary_full",
            supportFactRevisionIds: ["revision_unneeded"],
          },
        },
      })),
    },
  };

  await failure(
    await request(f.book, "/owner-operations/reviews", {
      method: "POST",
      headers: { "idempotency-key": key() },
      body: JSON.stringify(forbiddenOwner),
    }),
    400,
    "InvalidRequest",
  );
  cases.push({
    mode: "owner_paid_category",
    refused: true,
    reviewId: ownerReview.id,
    supportRevisionId: "not_applicable",
  });

  let retainedReviews = 0;
  const admin = await database();

  try {
    const count = await admin.query(
      "SELECT count(*)::integer as count FROM openerp.supplier_acceptance_reviews WHERE book_id = ANY($1::text[])",
      [[f.book.bookId, noSection.book.bookId, noProfile.book.bookId]],
    );

    retainedReviews = count.rows[0]!.count;

    expect(retainedReviews).toBe(3);
  } finally {
    await admin.end();
  }

  await writeFile(
    join(environment().artifacts, "vat-purchase-category-refusals.json"),
    JSON.stringify(
      {
        syntheticOnly: true,
        cases,
        retainedReviews,
        preparationRefusals: cases.filter((item) => "draftId" in item).length,
        failedPreparationRetainedReviews:
          retainedReviews -
          cases.filter((item) => "reviewId" in item && item.mode !== "owner_paid_category").length,
      },
      null,
      2,
    ),
  );
});

test("approval consequences retain exact empty-dimensional facts and survive later heads", async () => {
  const f = await context(true, true, false);
  const { source, draft } = await draftFor(f, "2026-09-30", "2500");
  const fact = await support(f.book, source.id, "2026-09-30", "2500");

  const review = await post(
    f.book,
    "/commerce/supplier-acceptance-reviews",
    preparation(draft, "25", fact.id),
    Acceptance.SupplierAcceptanceReview,
  );

  const approved = await post(
    f.book,
    `/commerce/supplier-acceptance-reviews/${review.id}/approvals`,
    { version: 1, digest: review.digest, acknowledgeSyntheticOnly: true },
    Acceptance.SupplierAcceptanceApproval,
  );

  await post(
    f.book,
    `/commerce/supplier-acceptance-reviews/${review.id}/execute`,
    { version: 1, digest: review.digest, acknowledgeSyntheticOnly: true, approvalId: approved.id },
    Acceptance.SupplierAcceptanceReceipt,
  );

  const exportExamples = () =>
    post(
      f.book,
      "/automation/decision-examples",
      { purpose: "training" as const, selectedDecisionIds: [approved.id] },
      Examples.DecisionExampleExport,
    );

  const before = await exportExamples();
  const admin = await database();

  try {
    const provenance = (
      await admin.query(
        "SELECT body FROM openerp.decision_provenance WHERE book_id=$1 AND decision_id=$2",
        [f.book.bookId, approved.id],
      )
    ).rows[0].body;

    await writeFile(
      join(environment().artifacts, "approval-consequences-before.json"),
      JSON.stringify({ approved, provenance, exported: before }),
    );
    const consequence = before.examples[0]!.consequence!.treatments[0]!;

    expect(provenance.selected.consequenceCapture).toMatchObject({
      version: "approval_consequence_capture_v1",
    });
    expect(consequence.capture.period).toEqual({
      id: "period_2026",
      startsOn: "2026-01-01",
      endsOn: "2026-12-31",
    });
    expect(consequence.capture.dimensions).toEqual({ requirements: [], assignments: [] });
    expect(consequence.capture.mapping).toMatchObject({
      accounts: [
        {
          accountId: "account_expense",
          classification: "expense",
          placement: "income_statement",
          statementLeaf: "synthetic_k2_external_cost",
        },
      ],
    });
    expect(consequence.capture.mapping!.checksum).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(provenance.selected.consequenceCapture.mappingRelease.checksum).toBe(
      consequence.capture.mapping!.checksum,
    );
    expect(provenance.selected.consequenceCapture.mappingRelease.qualification).toBe(
      "synthetic_only",
    );
    expect(before.examples[0]!.missingFacts).not.toContain("statement_mapping_not_captured");
    expect(consequence.capture.vat).toMatchObject({
      category: "synthetic_ordinary_full",
      profileIdentity: f.releases[0]!.checksum,
      resolvedRate: { numerator: "25", denominator: "100" },
      deduction: { numerator: "1", denominator: "1" },
    });
    expect(consequence.result.status).toBe("known");

    await admin.query(
      "UPDATE openerp.accounts SET code='4000' WHERE book_id=$1 AND id='account_expense'",
      [f.book.bookId],
    );
    await admin.query(
      "UPDATE openerp.periods SET ends_on='2026-12-30',version=version+1 WHERE book_id=$1 AND id='period_2026'",
      [f.book.bookId],
    );
    await post(
      f.book,
      "/dimensions",
      {
        code: "LaterDepartment",
        name: "Later department",
        expectedRevision: 0,
        effectiveFrom: "2026-01-01",
        effectiveTo: null,
        archived: false,
      },
      Dimensions.DimensionSaved,
    );
    await post(
      f.book,
      "/vat-returns/facts",
      { ...fact.input, expectedDigest: fact.digest, fullDeduction: "unknown" },
      Vat.VatFact,
    );

    const after = await exportExamples();

    expect(after.examples[0]!.consequence).toEqual(before.examples[0]!.consequence);
    await writeFile(
      join(environment().artifacts, "approval-consequences-frozen.json"),
      JSON.stringify({
        before,
        after,
        headChanges: {
          accountAndPeriod: "controlled_admin_mutations",
          dimensionAndVatFact: "public_commands",
        },
      }),
    );
  } finally {
    await admin.end();
  }
});

test("approval consequences preserve repeated-account source correspondence without inferred categories", async () => {
  const f = await context();
  const source = await evidence(f.book);

  const draft = await createDraft(f.book, {
    ...f.content,
    sourceEvidenceId: source.id,
    supplierDocumentNumber: key(),
    sourceTotalMinor: "25000",
    lines: [
      { ...f.content.lines[0]!, id: "source_a", taxMinor: "2500", sourceGrossMinor: "12500" },
      { ...f.content.lines[0]!, id: "source_b", taxMinor: "2500", sourceGrossMinor: "12500" },
    ],
  });

  const input = preparation(draft, "25");

  input.lineAssignments[1]!.treatment.deduction = { numerator: "1", denominator: "2" };
  input.lineAssignments[1]!.treatment.basis = "half_deduction";

  const review = await post(
    f.book,
    "/commerce/supplier-acceptance-reviews",
    input,
    Acceptance.SupplierAcceptanceReview,
  );

  const approved = await post(
    f.book,
    `/commerce/supplier-acceptance-reviews/${review.id}/approvals`,
    { version: 1, digest: review.digest, acknowledgeSyntheticOnly: true },
    Acceptance.SupplierAcceptanceApproval,
  );

  await post(
    f.book,
    `/commerce/supplier-acceptance-reviews/${review.id}/execute`,
    { version: 1, digest: review.digest, acknowledgeSyntheticOnly: true, approvalId: approved.id },
    Acceptance.SupplierAcceptanceReceipt,
  );

  const exported = await post(
    f.book,
    "/automation/decision-examples",
    { purpose: "training", selectedDecisionIds: [approved.id] },
    Examples.DecisionExampleExport,
  );

  const admin = await database();

  try {
    const provenance = (
      await admin.query(
        "SELECT body FROM openerp.decision_provenance WHERE book_id=$1 AND decision_id=$2",
        [f.book.bookId, approved.id],
      )
    ).rows[0].body;

    await writeFile(
      join(environment().artifacts, "approval-consequences-correspondence.json"),
      JSON.stringify({ review, provenance, exported }),
    );
    const captured = provenance.selected.consequenceCapture.sourceLines;

    expect(captured.map((line: { sourceLineId: string }) => line.sourceLineId)).toEqual([
      "source_a",
      "source_b",
    ]);
    expect(
      new Set(captured.map((line: { postingLineId: string }) => line.postingLineId)).size,
    ).toBe(2);
    expect(
      exported.examples[0]!.consequence!.treatments.map((item) => item.capture.vat.deduction),
    ).toEqual([
      { numerator: "1", denominator: "1" },
      { numerator: "1", denominator: "2" },
    ]);
    expect(
      exported.examples[0]!.consequence!.treatments.every(
        (item) => item.result.status === "unknown" && item.capture.vat.category === null,
      ),
    ).toBe(true);
  } finally {
    await admin.end();
  }
});
