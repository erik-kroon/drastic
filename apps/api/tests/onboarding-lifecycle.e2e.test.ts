import * as Delta from "@open-erp/contracts/onboarding-deltas";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Profiles from "@open-erp/contracts/company-profiles";
import * as Sie from "@open-erp/contracts/sie-import";
import * as Historical from "@open-erp/contracts/historical-migration";
import { expect, test } from "vitest";
import * as Onboarding from "@open-erp/contracts/onboarding";
import * as Intake from "@open-erp/contracts/source-intake";
import {
  approve,
  createSession,
  database,
  evidence,
  decoded,
  failure,
  fixture,
  key,
  post,
  persisted,
  request,
} from "./support/fixtures";
import { saveSanitizedJourney } from "./assurance/database-support";

test("retained onboarding controls derive exact money and refuse unqualified or stale acceptance", async () => {
  const book = await fixture();
  const other = await fixture();
  await post(book, "/onboarding", { path: "demo" }, Onboarding.OnboardingCase);
  await post(other, "/onboarding", { path: "demo" }, Onboarding.OnboardingCase);

  const original = await post(
    book,
    "/source-occurrences",
    {
      sourceSystem: "independent_trial_balance",
      sourceAccountId: "control_book",
      occurrenceKey: key(),
      sourceRevision: "1",
      filename: "opening.csv",
      mediaType: "text/csv",
      contentBase64: Buffer.from(
        "kind,as_of,currency,source_identity,account_code,amount_minor\ntrial_balance,2026-08-31,SEK,bank,1930,12500\ntrial_balance,2026-08-31,SEK,clearing,2999,-12500\n",
      ).toString("base64"),
    },
    Intake.SourceOccurrence,
  );

  const control = await post(
    book,
    "/onboarding/controls",
    {
      occurrenceId: original.id,
      kind: "trial_balance",
      provenance: "Independent synthetic control export",
    },
    Onboarding.OnboardingControl,
  );

  expect(control.facts.map((fact) => fact.amountMinor)).toEqual(["12500", "-12500"]);
  expect(control.sourceSha256).toBe(original.sha256);
  await failure(
    await request(other, "/onboarding/controls", {
      method: "POST",
      body: JSON.stringify({
        occurrenceId: original.id,
        kind: "trial_balance",
        provenance: "Wrong book",
      }),
    }),
    404,
    "NotFound",
  );

  const rejected = await request(book, "/onboarding/controls", {
    method: "POST",
    body: JSON.stringify({
      occurrenceId: original.id,
      kind: "trial_balance",
      provenance: "Attempted amount override",
      amountMinor: "0",
    }),
  });

  expect(rejected.ok).toBe(false);
  await failure(
    await request(book, "/onboarding/snapshots", {
      method: "POST",
      body: JSON.stringify({
        purpose: "opening",
        controlIds: [control.id],
        historicalRunIds: [],
        closingCertificateId: null,
      }),
    }),
    409,
    "StaleDependency",
  );

  const lifecycle = await decoded(
    await request(book, "/onboarding/lifecycle"),
    Onboarding.OnboardingLifecycle,
  );

  expect(lifecycle.controls).toHaveLength(1);
  expect(lifecycle.activation).toBeNull();
  expect(lifecycle.completion).toBeNull();
  await failure(await request(book, "/onboarding/activation-artifact"), 404, "NotFound");
  await saveSanitizedJourney("onboarding-lifecycle-controls", { control, lifecycle });
});

test("current retained controls and named responsibility policy authorize exact lifecycle snapshots", async () => {
  const book = await fixture();
  const independent = await fixture();
  const reviewer = { ...book, actorId: independent.actorId, token: independent.token };
  const source = await evidence(book);
  const admin = await database();

  const release = {
    id: "onboarding_synthetic_posting_v1",
    jurisdiction: "QZ",
    family: "posting_eligibility",
    version: 1,
    checksum: `sha256:${"b".repeat(64)}`,
    applicability: {
      legalForms: [],
      accountingMethods: ["accrual"],
      vatRegistrations: [],
      payrollRegistrations: [],
    },
    requiredFactKinds: ["accounting_method"],
    requiredRoleKinds: ["commerce"],
    calculatorVersion: "synthetic-onboarding-v1",
    rounding: { mode: "half_up", scale: 2 },
    validFrom: "2026-01-01",
    validTo: "2026-12-31",
    sourceManifest: "Independent synthetic lifecycle fixture",
    qualificationStatus: "reviewed",
    recordClasses: ["synthetic"],
  };

  try {
    await admin.query(
      "insert into openerp.memberships(book_id,actor_id,role) values($1,$2,'operator')",
      [book.bookId, reviewer.actorId],
    );
    await admin.query(
      "insert into openerp.rule_releases(id,jurisdiction,family,version,checksum,body) values($1,'QZ','posting_eligibility',1,$2,$3) on conflict(id) do nothing",
      [release.id, release.checksum, release],
    );
  } finally {
    await admin.end();
  }

  for (const declaration of [
    { factKind: "account_chart", value: { state: "known", value: "Synthetic reviewed chart" } },
    { factKind: "jurisdiction", value: { state: "known", value: "QZ" } },
    { factKind: "accounting_method", value: { state: "known", value: "accrual" } },
    { factKind: "vat_registration", value: { state: "known", value: "not_registered" } },
    { factKind: "asset_applicability", value: { state: "known", value: false } },
    { factKind: "payroll_applicability", value: { state: "known", value: true } },
    { factKind: "foreign_currency_applicability", value: { state: "known", value: false } },
  ]) {
    const fact = await post(
      book,
      "/company-facts",
      {
        ...declaration,
        effectiveFrom: "2026-01-01",
        effectiveTo: null,
        supersedesId: null,
        evidence: [{ evidenceId: source.id, sha256: source.sha256 }],
        note: "Synthetic independently reviewed applicability",
      },
      Profiles.FactRevision,
    );

    await post(
      reviewer,
      `/company-facts/${fact.id}/reviews`,
      {
        factRevisionId: fact.id,
        expectedDigest: fact.digest,
        result: "confirmed",
        rationale: "Independent synthetic review",
      },
      Profiles.FactReview,
    );
  }

  await post(
    book,
    "/company-role-bindings",
    {
      roleKind: "commerce",
      accountId: "account_clearing",
      effectiveFrom: "2026-01-01",
      effectiveTo: null,
      supersedesId: null,
      reviewer: reviewer.actorId,
      evidence: [{ evidenceId: source.id, sha256: source.sha256 }],
      note: "Synthetic retained binding",
    },
    Profiles.RoleBinding,
  );

  const profilePlan = await post(
    book,
    "/company-activation-plans",
    {
      family: "posting_eligibility",
      recordClass: "synthetic",
      dates: {
        postingOn: "2026-09-30",
        taxPointOn: null,
        paymentOn: null,
        reportOn: null,
        taxPeriodOn: null,
      },
      effectiveFrom: "2026-01-01",
      effectiveTo: "2026-12-31",
      reason: "Synthetic onboarding profile",
    },
    Profiles.CompanyActivationPlan,
  );

  const profileApproval = await post(
    reviewer,
    `/company-activation-plans/${profilePlan.id}/approvals`,
    { planDigest: profilePlan.digest },
    Profiles.CompanyActivationApproval,
  );

  await post(
    book,
    `/company-activation-plans/${profilePlan.id}/executions`,
    { planDigest: profilePlan.digest, approvalId: profileApproval.id },
    Profiles.CompanyActivationReceipt,
  );
  await post(book, "/onboarding", { path: "demo" }, Onboarding.OnboardingCase);
  await post(
    book,
    "/onboarding/revisions",
    {
      expectedRevision: 1,
      configuration: {
        migrationDepth: "current_fiscal_year",
        incumbentSystem: "Independent synthetic predecessor",
        dates: {
          historyStartsOn: "2026-01-01",
          historyEndsOn: "2026-09-30",
          detailStartsOn: "2026-01-01",
          openingOn: "2026-08-31",
          acceptanceStartsOn: "2026-09-01",
          acceptanceEndsOn: "2026-09-30",
          candidateLiveOn: "2026-10-01",
          provingPeriodEndsOn: "2026-10-31",
        },
      },
    },
    Onboarding.OnboardingCase,
  );

  const original = await post(
    book,
    "/source-occurrences",
    {
      sourceSystem: "synthetic_incumbent",
      sourceAccountId: "incumbent_book",
      occurrenceKey: key(),
      sourceRevision: "1",
      filename: "unchanged.sie",
      mediaType: "application/octet-stream",
      contentBase64: Buffer.from(
        '#FLAGGA 0\n#FORMAT UTF8\n#SIETYP 4\n#RAR 0 20260101 20261231\n#KONTO 1930 "Bank"\n#KONTO 2999 "Clearing"\n#IB 0 1930 0.00\n#UB 0 1930 0.00\n#IB 0 2999 0.00\n#UB 0 2999 0.00\n#VER A 1 20260831 "Synthetic bank movement"\n{\n#TRANS 1930 {} 8750.00\n#TRANS 2999 {} -8750.00\n}\n#VER A 2 20260929 "Synthetic opposite movement"\n{\n#TRANS 1930 {} -8750.00\n#TRANS 2999 {} 8750.00\n}\n',
      ).toString("base64"),
    },
    Intake.SourceOccurrence,
  );

  await post(
    book,
    "/onboarding/sources",
    { occurrenceId: original.id, category: "previous_books" },
    Onboarding.OnboardingSource,
  );

  const preview = await post(
    book,
    `/source-occurrences/${original.id}/sie-previews`,
    { encoding: "utf-8" },
    Sie.SiePreview,
  );

  const initialOpeningControl = await control("trial_balance", "2025-12-31");
  const initialClosingControl = await control("trial_balance", "2026-09-30");

  const planInput = {
    expectedRevision: 2,
    previewId: preview.id,
    expectedPreviewDigest: preview.digest,
    openingControlId: initialOpeningControl.id,
    closingControlId: initialClosingControl.id,
    mappings: [
      { sourceAccount: "1930", accountId: "account_bank" },
      { sourceAccount: "2999", accountId: "account_clearing" },
    ],
    rationale: "Retained independent zero controls establish the initial history",
  };

  await failure(
    await request(book, "/onboarding/import-plans", {
      method: "POST",
      body: JSON.stringify({ ...planInput, openingControlId: "unknown_control" }),
    }),
    404,
    "NotFound",
  );
  expect(
    (
      await request(book, "/onboarding/import-plans", {
        method: "POST",
        body: JSON.stringify({ ...planInput, independentOpeningMinor: "0" }),
      })
    ).ok,
  ).toBe(false);

  const unsupportedCurrencyOriginal = await post(
    book,
    "/source-occurrences",
    {
      sourceSystem: "synthetic_incumbent",
      sourceAccountId: "incumbent_book",
      occurrenceKey: key(),
      sourceRevision: "foreign-currency",
      filename: "unsupported-currency.sie",
      mediaType: "application/octet-stream",
      contentBase64: Buffer.from(
        '#FLAGGA 0\n#FORMAT UTF8\n#SIETYP 4\n#VALUTA XBT\n#RAR 0 20260101 20261231\n#KONTO 1930 "Bank"\n#KONTO 2999 "Clearing"\n#IB 0 1930 0.00\n#UB 0 1930 0.00\n#IB 0 2999 0.00\n#UB 0 2999 0.00\n#VER A 1 20260831 "Unsupported currency"\n{\n#TRANS 1930 {} 1.00\n#TRANS 2999 {} -1.00\n}\n',
      ).toString("base64"),
    },
    Intake.SourceOccurrence,
  );

  await post(
    book,
    "/onboarding/sources",
    { occurrenceId: unsupportedCurrencyOriginal.id, category: "previous_books" },
    Onboarding.OnboardingSource,
  );

  const foreignPreview = await post(
    book,
    `/source-occurrences/${unsupportedCurrencyOriginal.id}/sie-previews`,
    { encoding: "utf-8" },
    Sie.SiePreview,
  );

  await failure(
    await request(book, "/onboarding/import-plans", {
      method: "POST",
      body: JSON.stringify({
        ...planInput,
        previewId: foreignPreview.id,
        expectedPreviewDigest: foreignPreview.digest,
      }),
    }),
    422,
    "UnsupportedProfile",
  );

  const plan = await post(book, "/onboarding/import-plans", planInput, Sie.SiePlan);
  expect(plan.input.openingControls.map((row) => row.independentOpeningMinor)).toEqual(["0", "0"]);
  expect(
    plan.input.openingControls.every(
      (row) =>
        row.basis.includes(initialOpeningControl.id) &&
        row.basis.includes(initialClosingControl.id),
    ),
  ).toBe(true);

  const startedKey = key();

  const startedRequest = {
    method: "POST",
    headers: { "idempotency-key": startedKey },
    body: JSON.stringify({
      expectedRevision: 2,
      sourcePlanId: plan.id,
      expectedSourcePlanDigest: plan.digest,
    }),
  };

  const started = await decoded(
    await request(book, "/onboarding/imports", startedRequest),
    Onboarding.OnboardingImportStart,
  );

  expect(
    await decoded(
      await request(book, "/onboarding/imports", startedRequest),
      Onboarding.OnboardingImportStart,
    ),
  ).toEqual(started);
  expect(started.sourceRun.status).toBe("staged");
  expect(started.sourceRun.nextOrdinal).toBe(3);
  const run = started.financialRun;

  expect(run.status).toBe("running");

  const policy = await post(
    book,
    "/onboarding/responsibilities",
    {
      expectedRevision: 0,
      assignments: {
        preparerId: book.actorId,
        bookkeepingApproverId: reviewer.actorId,
        paymentApproverId: book.actorId,
        vatResponsibleId: reviewer.actorId,
        activationConfirmerIds: [book.actorId, reviewer.actorId],
      },
    },
    Onboarding.OnboardingResponsibilities,
  );

  async function control(kind: typeof Onboarding.OnboardingControlKind.Type, asOf: string) {
    const rows =
      kind === "trial_balance"
        ? `trial_balance,${asOf},SEK,bank_zero,1930,${asOf === "2026-08-31" ? "875000" : "0"}\ntrial_balance,${asOf},SEK,clearing_zero,2999,${asOf === "2026-08-31" ? "-875000" : "0"}\n`
        : `${kind},${asOf},SEK,zero_control,1930,0\n`;

    const occurrence = await post(
      book,
      "/source-occurrences",
      {
        sourceSystem: `independent_${kind}`,
        sourceAccountId: "independent_book",
        occurrenceKey: key(),
        sourceRevision: "1",
        filename: `${kind}.csv`,
        mediaType: "text/csv",
        contentBase64: Buffer.from(
          "kind,as_of,currency,source_identity,account_code,amount_minor\n" + rows,
        ).toString("base64"),
      },
      Intake.SourceOccurrence,
    );

    return post(
      reviewer,
      "/onboarding/controls",
      { occurrenceId: occurrence.id, kind, provenance: "Independent original synthetic control" },
      Onboarding.OnboardingControl,
    );
  }

  const openingControl = await control("trial_balance", "2026-08-31");
  const endingControls = [];

  for (const kind of [
    "trial_balance",
    "bank",
    "sales_open_items",
    "purchase_open_items",
    "tax",
  ] as const)
    endingControls.push(await control(kind, "2026-09-30"));

  async function capture(purpose: typeof Onboarding.OnboardingPurpose.Type, controlIds: string[]) {
    return post(
      book,
      "/onboarding/snapshots",
      { purpose, controlIds, historicalRunIds: [run.id], closingCertificateId: null },
      Onboarding.OnboardingSnapshot,
    );
  }

  const browserSession = await createSession(reviewer);
  const browserSessionId = `BaSession-${key()}`;
  const sessionDatabase = await database();

  try {
    await sessionDatabase.query("update openerp_auth.session set id=$1 where id=$2", [
      browserSessionId,
      browserSession.id,
    ]);
  } finally {
    await sessionDatabase.end();
  }

  const opening = await capture("opening", [openingControl.id]);
  expect(opening.blockers).toEqual([]);
  expect(opening.comparisons.map((item) => item.actualMinor)).toEqual(["875000", "-875000"]);
  expect(opening.sourceImportPlanIds).toEqual([plan.id]);
  const beforePosting = await persisted(book);
  expect(beforePosting?.vouchers).toBe(0);
  await failure(
    await request(book, "/onboarding/decisions", {
      method: "POST",
      body: JSON.stringify({
        snapshotId: opening.id,
        expectedDigest: opening.digest,
        decision: { kind: "accept_opening", reason: "Wrong named human" },
      }),
    }),
    403,
    "Forbidden",
  );

  const unapprovedOpeningProposal = await post(
    book,
    `/sie-financial-runs/${run.id}/proposals`,
    {
      fence: run.fence,
      planDigest: plan.digest,
      ordinal: 1,
      accountingPeriodId: "period_2026",
      series: "A",
      rationale: "No approved opening yet",
    },
    Accounting.ChangeSet,
  );

  const unapprovedOpeningApproval = await approve(reviewer, unapprovedOpeningProposal);
  await failure(
    await request(book, `/sie-financial-runs/${run.id}/chunks`, {
      method: "POST",
      body: JSON.stringify({
        fence: run.fence,
        planDigest: plan.digest,
        firstOrdinal: 1,
        items: [
          {
            changeSetId: unapprovedOpeningProposal.id,
            planDigest: unapprovedOpeningProposal.planDigest,
            approvalId: unapprovedOpeningApproval.id,
          },
        ],
      }),
    }),
    403,
    "ApprovalRequired",
  );
  expect(await persisted(book)).toEqual(beforePosting);

  const openingDecision = await post(
    { ...reviewer, token: browserSession.token },
    "/onboarding/decisions",
    {
      snapshotId: opening.id,
      expectedDigest: opening.digest,
      decision: { kind: "accept_opening", reason: "Independent opening accepted" },
    },
    Onboarding.OnboardingDecision,
  );

  expect(openingDecision.authority).toEqual({
    kind: "betterAuthSession",
    actorId: reviewer.actorId,
    sessionId: browserSessionId,
  });
  await failure(
    await request(reviewer, "/onboarding/decisions", {
      method: "POST",
      body: JSON.stringify({
        snapshotId: opening.id,
        expectedDigest: opening.digest,
        decision: {
          kind: "accept_limitation",
          limitation: "unreconciled_bank_difference",
          reason: "A reconciled balance cannot be waived",
        },
      }),
    }),
    422,
    "UnsupportedProfile",
  );

  await failure(
    await request(reviewer, "/onboarding/import-batches", {
      method: "POST",
      body: JSON.stringify({
        financialRunId: run.id,
        expectedFence: run.fence,
        expectedNextOrdinal: 1,
        expectedSourcePlanDigest: plan.digest,
        rationale: "Wrong named preparer",
      }),
    }),
    403,
    "Forbidden",
  );

  let batch = await post(
    book,
    "/onboarding/import-batches",
    {
      financialRunId: run.id,
      expectedFence: run.fence,
      expectedNextOrdinal: 1,
      expectedSourcePlanDigest: plan.digest,
      rationale: "Review the retained initial history together",
    },
    Onboarding.OnboardingImportBatch,
  );

  expect(batch.proposals.map((item) => item.ordinal)).toEqual([1, 2]);
  expect((await persisted(book))?.vouchers).toBe(0);
  await failure(
    await request(book, "/onboarding/import-batch-approvals", {
      method: "POST",
      body: JSON.stringify({ batchId: batch.id, expectedDigest: batch.digest }),
    }),
    403,
    "Forbidden",
  );
  await failure(
    await request(independent, "/onboarding/import-batch-approvals", {
      method: "POST",
      body: JSON.stringify({ batchId: batch.id, expectedDigest: batch.digest }),
    }),
    404,
    "NotFound",
  );

  await post(book, `/sie-financial-runs/${run.id}/lease`, { action: "pause" }, Historical.Fence);

  const resumed = await post(
    book,
    `/sie-financial-runs/${run.id}/lease`,
    { action: "resume" },
    Historical.Fence,
  );

  await failure(
    await request(reviewer, "/onboarding/import-batch-approvals", {
      method: "POST",
      body: JSON.stringify({ batchId: batch.id, expectedDigest: batch.digest }),
    }),
    409,
    "StaleDependency",
  );
  batch = await post(
    book,
    "/onboarding/import-batches",
    {
      financialRunId: run.id,
      expectedFence: resumed.fence,
      expectedNextOrdinal: 1,
      expectedSourcePlanDigest: plan.digest,
      rationale: "Review after explicit pause and resume",
    },
    Onboarding.OnboardingImportBatch,
  );

  const batchApproval = await post(
    reviewer,
    "/onboarding/import-batch-approvals",
    {
      batchId: batch.id,
      expectedDigest: batch.digest,
    },
    Onboarding.OnboardingImportBatchApproval,
  );

  const faultDb = await database();

  try {
    await faultDb.query(
      "insert into openerp.posting_approval_revocations(book_id,approval_id,actor_id,reason) values($1,$2,$3,'Synthetic later-item refusal')",
      [book.bookId, batchApproval.approvals[1]?.id, reviewer.actorId],
    );
  } finally {
    await faultDb.end();
  }

  const revokedBatchView = await decoded(
    await request(book, `/onboarding/import-batches?financialRunId=${run.id}`),
    Onboarding.OnboardingImportBatchWorkspace,
  );

  expect(revokedBatchView.approvalCurrent).toBe(false);
  const beforeChunk = await persisted(book);
  await failure(
    await request(book, "/onboarding/import-batch-executions", {
      method: "POST",
      body: JSON.stringify({
        batchId: batch.id,
        expectedDigest: batch.digest,
        approvalId: batchApproval.id,
      }),
    }),
    403,
    "ApprovalRequired",
  );
  expect(await persisted(book)).toEqual(beforeChunk);

  const replacementApproval = await post(
    reviewer,
    "/onboarding/import-batch-approvals",
    {
      batchId: batch.id,
      expectedDigest: batch.digest,
    },
    Onboarding.OnboardingImportBatchApproval,
  );

  const executeBatchRequest = {
    method: "POST",
    headers: { "idempotency-key": key() },
    body: JSON.stringify({
      batchId: batch.id,
      expectedDigest: batch.digest,
      approvalId: replacementApproval.id,
    }),
  };

  const cursor = await decoded(
    await request(book, "/onboarding/import-batch-executions", executeBatchRequest),
    Historical.Chunk,
  );

  expect(
    await decoded(
      await request(book, "/onboarding/import-batch-executions", executeBatchRequest),
      Historical.Chunk,
    ),
  ).toEqual(cursor);
  expect(cursor.status).toBe("posted");
  expect((await persisted(book))?.vouchers).toBe(2);

  const retainedBatch = await decoded(
    await request(book, `/onboarding/import-batches?financialRunId=${run.id}`),
    Onboarding.OnboardingImportBatchWorkspace,
  );

  expect(retainedBatch.run.status).toBe("posted");
  expect(retainedBatch.batch).toBeNull();

  const afterPostingLifecycle = await decoded(
    await request(book, "/onboarding/lifecycle"),
    Onboarding.OnboardingLifecycle,
  );

  expect(
    afterPostingLifecycle.snapshots.find((item) => item.snapshot.id === opening.id)?.current,
  ).toBe(true);

  const unknownCoverage = await capture(
    "book_zero",
    endingControls.map((item) => item.id),
  );

  expect(unknownCoverage.blockers).toContain("original_coverage_unqualified");

  async function originalSource(
    owner: typeof book,
    filename: string,
    mediaType: string,
    content: string,
  ) {
    return post(
      owner,
      "/source-occurrences",
      {
        sourceSystem: "independent_original_index",
        sourceAccountId: "independent_book",
        occurrenceKey: key(),
        sourceRevision: "1",
        filename,
        mediaType,
        contentBase64: Buffer.from(content).toString("base64"),
      },
      Intake.SourceOccurrence,
    );
  }

  const retainedOriginal = await originalSource(
    book,
    "original.pdf",
    "application/pdf",
    "%PDF-1.4\nSynthetic retained original\n%%EOF",
  );

  const foreignOriginal = await originalSource(
    independent,
    "foreign.pdf",
    "application/pdf",
    "%PDF-1.4\nForeign retained original\n%%EOF",
  );

  const indexHeader = "as_of,currency,source_identity,original_occurrence_id\n";

  const wrongIndex = await originalSource(
    book,
    "wrong-index.csv",
    "text/csv",
    `${indexHeader}2026-09-30,SEK,A1,${foreignOriginal.id}\n`,
  );

  await failure(
    await request(reviewer, "/onboarding/controls", {
      method: "POST",
      body: JSON.stringify({
        occurrenceId: wrongIndex.id,
        kind: "historical_originals",
        provenance: "Wrong-book index",
      }),
    }),
    404,
    "NotFound",
  );

  const duplicateIndex = await originalSource(
    book,
    "duplicate-index.csv",
    "text/csv",
    `${indexHeader}2026-09-30,SEK,A1,${retainedOriginal.id}\n2026-09-30,SEK,A1,\n`,
  );

  await failure(
    await request(reviewer, "/onboarding/controls", {
      method: "POST",
      body: JSON.stringify({
        occurrenceId: duplicateIndex.id,
        kind: "historical_originals",
        provenance: "Duplicate identity index",
      }),
    }),
    422,
    "InvalidJournal",
  );

  const originalIndex = await originalSource(
    book,
    "original-index.csv",
    "text/csv",
    `${indexHeader}2026-09-30,SEK,A1,${retainedOriginal.id}\n2026-09-30,SEK,A2,\n`,
  );

  await post(
    book,
    "/onboarding/sources",
    {
      occurrenceId: originalIndex.id,
      category: "other",
    },
    Onboarding.OnboardingSource,
  );

  const indexedLifecycle = await decoded(
    await request(book, "/onboarding/lifecycle"),
    Onboarding.OnboardingLifecycle,
  );

  const originalControl = indexedLifecycle.controls.find(
    (control) => control.occurrenceId === originalIndex.id,
  );

  if (!originalControl) throw new Error("Attached original index did not reach the control owner");

  endingControls.push(originalControl);
  expect(originalControl.originalCoverage?.rows).toHaveLength(2);
  expect(originalControl.originalCoverage?.rows[0]?.sourceSha256).toBe(retainedOriginal.sha256);

  const handoffHeader = "source_system,history_starts_on,retained_through,currency\n";

  const outsideHandoff = await originalSource(
    book,
    "outside-payroll.csv",
    "text/csv",
    `${handoffHeader}Independent synthetic predecessor,2026-01-01,2026-10-01,SEK\n`,
  );

  await failure(
    await request(reviewer, "/onboarding/controls", {
      method: "POST",
      body: JSON.stringify({
        occurrenceId: outsideHandoff.id,
        kind: "historical_payroll_handoff",
        provenance: "Crosses the authority boundary",
      }),
    }),
    409,
    "StaleDependency",
  );

  const payrollSource = await originalSource(
    book,
    "payroll-handoff.csv",
    "text/csv",
    `${handoffHeader}Independent synthetic predecessor,2026-01-01,2026-09-30,SEK\n`,
  );

  await post(
    book,
    "/onboarding/sources",
    { occurrenceId: payrollSource.id, category: "payroll" },
    Onboarding.OnboardingSource,
  );

  const handoffLifecycle = await decoded(
    await request(book, "/onboarding/lifecycle"),
    Onboarding.OnboardingLifecycle,
  );

  const handoffControl = handoffLifecycle.controls.find(
    (control) => control.occurrenceId === payrollSource.id,
  );

  if (!handoffControl) throw new Error("Attached payroll handoff did not reach its owner");
  endingControls.push(handoffControl);

  const qualifiedWorkspace = await decoded(
    await request(book, "/onboarding"),
    Onboarding.OnboardingWorkspace,
  );

  expect(qualifiedWorkspace.qualification.find((item) => item.family === "payroll")?.state).toBe(
    "supported_with_handoff",
  );

  const refreshedOpening = await capture("opening", [openingControl.id]);
  expect(refreshedOpening.blockers).toEqual([]);
  await post(
    reviewer,
    "/onboarding/decisions",
    {
      snapshotId: refreshedOpening.id,
      expectedDigest: refreshedOpening.digest,
      decision: {
        kind: "accept_opening",
        reason: "Rechecked after the new retained source inventory",
      },
    },
    Onboarding.OnboardingDecision,
  );

  const zero = await capture(
    "book_zero",
    endingControls.map((item) => item.id),
  );

  expect(zero.blockers).toEqual([]);
  expect(zero.permittedLimitations).toContain("missing_historical_originals");
  await failure(
    await request(reviewer, "/onboarding/decisions", {
      method: "POST",
      body: JSON.stringify({
        snapshotId: zero.id,
        expectedDigest: zero.digest,
        decision: { kind: "accept_book_zero", reason: "Original shortage still needs acceptance" },
      }),
    }),
    409,
    "StaleDependency",
  );

  expect(zero.permittedLimitations).toContain("historical_payroll_retained");

  const payrollLimitation = await post(
    reviewer,
    "/onboarding/decisions",
    {
      snapshotId: zero.id,
      expectedDigest: zero.digest,
      decision: {
        kind: "accept_limitation",
        limitation: "historical_payroll_retained",
        reason: "Historical payroll remains in the qualified predecessor through September",
      },
    },
    Onboarding.OnboardingDecision,
  );

  const originalLimitation = await post(
    reviewer,
    "/onboarding/decisions",
    {
      snapshotId: zero.id,
      expectedDigest: zero.digest,
      decision: {
        kind: "accept_limitation",
        limitation: "missing_historical_originals",
        reason: "One identified historical original remains missing",
      },
    },
    Onboarding.OnboardingDecision,
  );

  const coveredLifecycle = await decoded(
    await request(book, "/onboarding/lifecycle"),
    Onboarding.OnboardingLifecycle,
  );

  expect(coveredLifecycle.projection.counts.retainedOriginals).toBe(1);

  await post(
    reviewer,
    "/onboarding/decisions",
    {
      snapshotId: zero.id,
      expectedDigest: zero.digest,
      decision: { kind: "accept_book_zero", reason: "Independent zero period accepted" },
    },
    Onboarding.OnboardingDecision,
  );

  const connection = await database();
  let timingIdentity: string;

  try {
    const timing = await connection.query<{ identity: string }>(
      "select v.id||':'||l.id as identity from openerp.vouchers v join openerp.journal_lines l on (l.book_id,l.voucher_id)=(v.book_id,v.id) where v.book_id=$1 and l.account_id='account_bank' and l.credit_minor=875000",
      [book.bookId],
    );

    expect(timing.rows).toHaveLength(1);
    const identity = timing.rows[0]?.identity;

    if (!identity) throw new Error("Missing independent bank timing fixture");
    timingIdentity = identity;
  } finally {
    await connection.end();
  }

  async function bankControl(
    kind: "bank" | "bank_reconciling_items",
    identity: string,
    amount: string,
  ) {
    const occurrence = await post(
      book,
      "/source-occurrences",
      {
        sourceSystem: "independent_bank",
        sourceAccountId: "statement_account",
        occurrenceKey: key(),
        sourceRevision: "1",
        filename: `${kind}.csv`,
        mediaType: "text/csv",
        contentBase64: Buffer.from(
          `kind,as_of,currency,source_identity,account_code,amount_minor\n${kind},2026-09-30,SEK,${identity},1930,${amount}\n`,
        ).toString("base64"),
      },
      Intake.SourceOccurrence,
    );

    return post(
      reviewer,
      "/onboarding/controls",
      {
        occurrenceId: occurrence.id,
        kind,
        provenance: "Retained independent synthetic bank statement",
      },
      Onboarding.OnboardingControl,
    );
  }

  const bankDifference = await bankControl("bank", "statement", "875000");
  const timing = await bankControl("bank_reconciling_items", timingIdentity, "-875000");
  const bankIds = endingControls.filter((item) => item.kind !== "bank").map((item) => item.id);
  const unexplained = await capture("book_zero", [...bankIds, bankDifference.id]);
  expect(unexplained.blockers).toContain("independent_controls_differ");
  expect(unexplained.permittedLimitations).not.toContain("unreconciled_bank_difference");
  const explained = await capture("book_zero", [...bankIds, bankDifference.id, timing.id]);
  expect(explained.blockers).toEqual([]);
  expect(explained.comparisons.find((item) => item.kind === "bank")).toMatchObject({
    differenceMinor: "-875000",
    explainedMinor: "-875000",
    unexplainedDifferenceMinor: "0",
  });
  expect(explained.permittedLimitations).toContain("unreconciled_bank_difference");
  await failure(
    await request(reviewer, "/onboarding/decisions", {
      method: "POST",
      body: JSON.stringify({
        snapshotId: explained.id,
        expectedDigest: explained.digest,
        decision: { kind: "accept_book_zero", reason: "Explanation alone is not reconciliation" },
      }),
    }),
    409,
    "StaleDependency",
  );

  const bankLimitation = await post(
    reviewer,
    "/onboarding/decisions",
    {
      snapshotId: explained.id,
      expectedDigest: explained.digest,
      decision: {
        kind: "accept_limitation",
        limitation: "unreconciled_bank_difference",
        reason: "Explained synthetic difference remains unreconciled",
      },
    },
    Onboarding.OnboardingDecision,
  );

  expect(bankLimitation.actorId).toBe(reviewer.actorId);
  expect(Date.parse(bankLimitation.recordedAt)).toBeGreaterThan(0);
  await post(
    reviewer,
    "/onboarding/decisions",
    {
      snapshotId: explained.id,
      expectedDigest: explained.digest,
      decision: {
        kind: "accept_book_zero",
        reason: "Verified with explicitly accepted bank limitation",
      },
    },
    Onboarding.OnboardingDecision,
  );

  const comparedDelta = await post(
    book,
    "/onboarding/source-deltas",
    { candidatePreviewId: preview.id, expectedPreviewDigest: preview.digest },
    Delta.OnboardingDelta,
  );

  expect(comparedDelta.rows.map((entry) => entry.kind)).toEqual(["unchanged", "unchanged"]);

  const carried = await post(
    book,
    "/onboarding/snapshots",
    {
      purpose: "final_delta",
      controlIds: explained.controlIds,
      historicalRunIds: [run.id],
      closingCertificateId: null,
      deltaId: comparedDelta.id,
    },
    Onboarding.OnboardingSnapshot,
  );

  expect(carried.blockers).toEqual([]);
  expect(carried.carriedLimitationDecisionIds).toEqual(
    expect.arrayContaining([bankLimitation.id, originalLimitation.id, payrollLimitation.id]),
  );
  await post(
    reviewer,
    "/onboarding/decisions",
    {
      snapshotId: carried.id,
      expectedDigest: carried.digest,
      decision: {
        kind: "accept_final_delta",
        reason: "Unchanged accepted bank evidence carries forward",
      },
    },
    Onboarding.OnboardingDecision,
  );

  const delta = await post(
    book,
    "/onboarding/snapshots",
    {
      purpose: "final_delta",
      controlIds: endingControls.map((entry) => entry.id),
      historicalRunIds: [run.id],
      closingCertificateId: null,
      deltaId: comparedDelta.id,
    },
    Onboarding.OnboardingSnapshot,
  );

  expect(delta.carriedLimitationDecisionIds).toEqual([originalLimitation.id, payrollLimitation.id]);
  expect(delta.asOf).toBe("2026-09-30");
  expect(delta.blockers).toEqual([]);
  const acceptanceKey = key();

  const acceptance = {
    method: "POST",
    headers: { "idempotency-key": acceptanceKey },
    body: JSON.stringify({
      snapshotId: delta.id,
      expectedDigest: delta.digest,
      decision: { kind: "accept_final_delta", reason: "No changed final effects" },
    }),
  };

  const accepted = await decoded(
    await request(reviewer, "/onboarding/decisions", acceptance),
    Onboarding.OnboardingDecision,
  );

  await post(
    book,
    "/onboarding/responsibilities",
    {
      expectedRevision: policy.revision,
      assignments: { ...policy.assignments, preparerId: reviewer.actorId },
    },
    Onboarding.OnboardingResponsibilities,
  );
  const delegated = await capture("book_zero", [...explained.controlIds]);
  expect(delegated.carriedLimitationDecisionIds).toEqual(
    expect.arrayContaining([bankLimitation.id, originalLimitation.id, payrollLimitation.id]),
  );

  await failure(
    await request(reviewer, "/onboarding/decisions", {
      ...acceptance,
      headers: { "idempotency-key": key() },
    }),
    409,
    "StaleDependency",
  );
  expect(
    await decoded(
      await request(reviewer, "/onboarding/decisions", acceptance),
      Onboarding.OnboardingDecision,
    ),
  ).toEqual(accepted);
  await verifyDeltaEffects(book, reviewer, plan);

  await saveSanitizedJourney("onboarding-current-acceptance", {
    openingDecision,
    opening,
    batch,
    batchApproval,
    replacementApproval,
    beforeChunk,
    cursor,
    zero,
    unexplained,
    explained,
    bankLimitation,
    originalControl,
    refreshedOpening,
    originalLimitation,
    handoffControl,
    payrollLimitation,
    carried,
    delegated,
    delta,
    accepted,
  });
});

async function verifyDeltaEffects(
  book: Awaited<ReturnType<typeof fixture>>,
  reviewer: Awaited<ReturnType<typeof fixture>>,
  baselinePlan: typeof Sie.SiePlan.Type,
) {
  const occurrence = await post(
    book,
    "/source-occurrences",
    {
      sourceSystem: "synthetic_incumbent",
      sourceAccountId: "incumbent_book",
      occurrenceKey: key(),
      sourceRevision: "final_delta",
      filename: "final-delta.sie",
      mediaType: "application/octet-stream",
      contentBase64: Buffer.from(
        '#FLAGGA 0\n#FORMAT UTF8\n#SIETYP 4\n#RAR 0 20260101 20261231\n#KONTO 1930 "Bank"\n#KONTO 2999 "Clearing"\n#IB 0 1930 0.00\n#UB 0 1930 126.00\n#IB 0 2999 0.00\n#UB 0 2999 -126.00\n#VER A 1 20260831 "Changed movement"\n{\n#TRANS 1930 {} 125.00\n#TRANS 2999 {} -125.00\n}\n#VER A 3 20260930 "New movement"\n{\n#TRANS 1930 {} 1.00\n#TRANS 2999 {} -1.00\n}\n',
      ).toString("base64"),
    },
    Intake.SourceOccurrence,
  );

  const preview = await post(
    book,
    `/source-occurrences/${occurrence.id}/sie-previews`,
    { encoding: "utf-8" },
    Sie.SiePreview,
  );

  const plan = await post(
    book,
    `/sie-previews/${preview.id}/plans`,
    {
      ...baselinePlan.input,
      digest: preview.digest,
      openingControls: baselinePlan.input.openingControls.map((control) => ({
        ...control,
        independentClosingMinor: control.sourceAccount === "1930" ? "12600" : "-12600",
      })),
    },
    Sie.SiePlan,
  );

  const delta = await post(
    book,
    "/onboarding/source-deltas",
    { candidatePreviewId: preview.id, expectedPreviewDigest: preview.digest },
    Delta.OnboardingDelta,
  );

  expect(delta.rows.map((row) => row.kind)).toEqual(["changed", "new", "removed"]);
  const effects: Array<typeof Delta.OnboardingDeltaEffect.Type> = [];

  for (const row of delta.rows) {
    const decision = await post(
      book,
      "/onboarding/source-delta-decisions",
      {
        deltaId: delta.id,
        expectedDigest: delta.digest,
        sourceReference: row.sourceReference,
        choice: "use_change",
        reason: "Apply independently retained final source",
      },
      Delta.OnboardingDeltaDecision,
    );

    const proposal = await post(
      book,
      "/onboarding/source-delta-proposals",
      {
        deltaId: delta.id,
        expectedDeltaDigest: delta.digest,
        sourceReference: row.sourceReference,
        sourcePlanId: plan.id,
        expectedSourcePlanDigest: plan.digest,
        accountingPeriodId: "period_2026",
        rationale: "Apply retained source before 1 October authority boundary",
      },
      Delta.OnboardingDeltaProposal,
    );

    expect(proposal.decisionId).toBe(decision.id);
    expect(proposal.changes).toHaveLength(row.kind === "changed" ? 2 : 1);
    await failure(
      await request(book, "/onboarding/source-delta-approvals", {
        method: "POST",
        body: JSON.stringify({ proposalId: proposal.id, expectedDigest: proposal.digest }),
      }),
      403,
      "ApprovalRequired",
    );

    const approved = await post(
      reviewer,
      "/onboarding/source-delta-approvals",
      { proposalId: proposal.id, expectedDigest: proposal.digest },
      Delta.OnboardingDeltaApproval,
    );

    if (row.kind === "changed") {
      const authorityDatabase = await database();

      try {
        await authorityDatabase.query(
          "update openerp.identity_admissions set enabled=false where actor_id=$1",
          [reviewer.actorId],
        );

        const revoked = await decoded(
          await request(book, `/onboarding/source-delta-proposals/${proposal.id}`),
          Delta.OnboardingDeltaProposalView,
        );

        expect(revoked.current).toBe(true);
        expect(revoked.approvals).toEqual([]);
      } finally {
        await authorityDatabase.query(
          "update openerp.identity_admissions set enabled=true where actor_id=$1",
          [reviewer.actorId],
        );
        await authorityDatabase.end();
      }
    }

    const execution = {
      proposalId: proposal.id,
      expectedDigest: proposal.digest,
      approvalIds: approved.approvals.map((approval) => approval.id),
    };

    if (row.kind === "changed") {
      const before = await persisted(book);
      await failure(
        await request(book, "/onboarding/source-delta-effects", {
          method: "POST",
          body: JSON.stringify({
            ...execution,
            approvalIds: [execution.approvalIds[0], "missing_approval"],
          }),
        }),
        403,
        "ApprovalRequired",
      );
      expect(await persisted(book)).toEqual(before);
    }

    const idempotencyKey = key();

    const requestOptions = {
      method: "POST",
      headers: { "idempotency-key": idempotencyKey },
      body: JSON.stringify(execution),
    };

    const effect = await decoded(
      await request(book, "/onboarding/source-delta-effects", requestOptions),
      Delta.OnboardingDeltaEffect,
    );

    expect(
      await decoded(
        await request(book, "/onboarding/source-delta-effects", requestOptions),
        Delta.OnboardingDeltaEffect,
      ),
    ).toEqual(effect);
    expect(effect.effectiveVoucherId === null).toBe(row.kind === "removed");
    effects.push(effect);
  }

  const completed = await decoded(
    await request(book, `/onboarding/source-deltas/${delta.id}`),
    Delta.OnboardingDeltaView,
  );

  expect(completed.current).toBe(true);
  expect(completed.blockers).toEqual([]);
  expect(completed.effects).toHaveLength(3);

  const next = await post(
    book,
    "/onboarding/source-deltas",
    { candidatePreviewId: preview.id, expectedPreviewDigest: preview.digest },
    Delta.OnboardingDelta,
  );

  expect(next.rows.map((row) => row.kind)).toEqual(["unchanged", "unchanged"]);

  const onboarding = await decoded(
    await request(book, "/onboarding/lifecycle"),
    Onboarding.OnboardingLifecycle,
  );

  expect(onboarding.projection.counts.importedVouchers).toBe(2);
  await saveSanitizedJourney("onboarding-delta-effects", { delta, effects, completed, next });
}
