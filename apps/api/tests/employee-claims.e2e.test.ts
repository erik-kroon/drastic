import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import * as Claims from "@open-erp/contracts/employee-claims";
import * as Calculations from "@open-erp/contracts/payroll-calculations";
import * as Runs from "@open-erp/contracts/payroll-runs";
import * as A from "@open-erp/contracts/accounting";
import * as Inputs from "@open-erp/contracts/payroll-inputs";
import * as Tax from "@open-erp/contracts/expense-tax";
import * as Bank from "@open-erp/contracts/reconciliation";
import { database, environment, post, request, decoded, failure, key } from "./support/fixtures";
import { employeeClaimFixture } from "./support/employee-claims";
import { proveReminderRecovery } from "./support/reminder-recovery";

test("R40 retains three outcomes, recognizes once, exports separately and consumes fixed payroll capacity", async () => {
  const f = await employeeClaimFixture();

  const revision = await post(
    f.book,
    "/payroll/claims",
    f.submission,
    Claims.EmployeeClaimRevision,
  );

  const review = await post(
    f.book,
    `/payroll/claims/${revision.claimId}/reviews`,
    { ...f.review, revisionDigest: revision.digest },
    Claims.EmployeeClaimReview,
  );

  expect(review.items.map((item) => [item.outcome, item.reimbursementMinor])).toEqual([
    ["qualified", "1250000"],
    ["company_paid", "0"],
    ["duplicate", "0"],
  ]);
  expect(review.items[2]?.originalOccurrenceId).toBe(review.items[0]?.occurrence.id);
  expect([
    review.expenseMinor,
    review.deductibleVatMinor,
    review.liabilityMinor,
    review.directMinor,
    review.payrollMinor,
  ]).toEqual(["1000000", "250000", "1250000", "500000", "750000"]);
  await failure(
    await request(f.book, `/payroll/claims/reviews/${review.id}/approvals`, {
      method: "POST",
      body: JSON.stringify({ reviewDigest: review.digest }),
    }),
    403,
    "ApprovalRequired",
  );
  await failure(
    await request(f.reviewer, `/payroll/input-reviews/${review.preparedRecognition.id}/approvals`, {
      method: "POST",
      body: JSON.stringify({ reviewDigest: review.preparedRecognition.digest }),
    }),
    403,
    "ApprovalRequired",
  );
  await failure(
    await request(
      f.reviewer,
      `/change-sets/${review.preparedRecognition.postingPlan.id}/approvals`,
      {
        method: "POST",
        body: JSON.stringify({
          version: 1,
          planDigest: review.preparedRecognition.postingPlan.planDigest,
        }),
      },
    ),
    403,
    "ApprovalRequired",
  );
  await failure(
    await request(f.book, `/payroll/inputs/${review.preparedInput.id}/reviews`, {
      method: "POST",
      body: JSON.stringify({ inputDigest: review.preparedInput.digest }),
    }),
    403,
    "ApprovalRequired",
  );
  const approvalKey = key();

  const approve = async () =>
    decoded(
      await request(f.reviewer, `/payroll/claims/reviews/${review.id}/approvals`, {
        method: "POST",
        headers: { "idempotency-key": approvalKey },
        body: JSON.stringify({ reviewDigest: review.digest }),
      }),
      Claims.EmployeeClaimRecognition,
    );

  const recognition = await approve();
  const retry = await approve();
  expect(retry).toEqual(recognition);

  if (!recognition.directInstruction || !recognition.payrollInstruction)
    throw new Error("Expected positive split instructions");
  expect([
    recognition.directInstruction.amountMinor,
    recognition.payrollInstruction.amountMinor,
  ]).toEqual(["500000", "750000"]);
  await failure(
    await request(f.book, `/payroll/inputs/${review.preparedInput.id}/direct-payments`, {
      method: "POST",
      body: JSON.stringify({
        inputDigest: review.preparedInput.digest,
        amountMinor: "500000",
        bankAccountId: "account_bank",
        evidence: f.evidence,
        accountingPeriodId: "period_2026",
        postingDate: "2026-01-31",
        series: "A",
        reason: "Legacy bypass attempt",
      }),
    }),
    403,
    "ApprovalRequired",
  );

  const legacy = await decoded(
    await request(f.book, `/payroll/inputs/${review.preparedInput.id}`),
    Inputs.PayrollInputView,
  );

  expect(legacy.snapshot).toBeNull();

  const proposal = await post(
    f.book,
    "/payroll/claims/payees",
    f.payee,
    Claims.EmployeePayeeProposal,
  );

  const verified = await post(
    f.reviewer,
    `/payroll/claims/payees/${proposal.id}/verifications`,
    {
      proposalDigest: proposal.digest,
      evidence: f.evidence,
      reason: "Independent synthetic employee payee review",
      confirmIndependentCheck: true,
    },
    Claims.EmployeePayeeVerification,
  );

  const utcDate = new Date().toISOString().slice(0, 10);
  const calendarBoundaryObserved = f.file.executionDate > utcDate;

  if (calendarBoundaryObserved) {
    await failure(
      await request(
        f.book,
        `/payroll/claims/instructions/${recognition.directInstruction.id}/payment-previews`,
        {
          method: "POST",
          body: JSON.stringify({
            ...f.file,
            instructionDigest: recognition.directInstruction.digest,
            payeeVerificationId: verified.id,
            executionDate: utcDate,
          }),
        },
      ),
      422,
      "InvalidJournal",
    );
  }

  const preview = await post(
    f.book,
    `/payroll/claims/instructions/${recognition.directInstruction.id}/payment-previews`,
    {
      ...f.file,
      instructionDigest: recognition.directInstruction.digest,
      payeeVerificationId: verified.id,
    },
    Claims.ClaimPaymentPreview,
  );

  const exported = await post(
    f.reviewer,
    `/payroll/claims/payment-previews/${preview.id}/approvals`,
    { previewDigest: preview.digest, acknowledgeOfflineOnly: true },
    Claims.ClaimPaymentExport,
  );

  expect(exported.amountMinor).toBe("500000");
  expect(exported.paid).toBe(false);
  expect(Buffer.from(exported.base64, "base64").toString("utf8")).toContain(
    '<InstdAmt Ccy="SEK">5000.00</InstdAmt>',
  );

  const calculation = await post(
    f.book,
    "/payroll/calculations",
    {
      ...f.calculation.basis.reviewedInput,
      claimInstructionIds: [recognition.payrollInstruction.id],
    },
    Calculations.PayrollCalculation,
  );

  expect(calculation.basis.claimInstructions?.map((row) => row.amountMinor)).toEqual(["750000"]);

  const run = await post(
    f.book,
    "/payroll/runs",
    { ...f.input, calculationIds: [calculation.id] },
    Runs.PayrollRun,
  );

  const runApproval = await post(
    f.book,
    `/payroll/runs/${run.id}/approvals`,
    { runDigest: run.digest },
    Runs.PayrollRunApproval,
  );

  const runExecution = await post(
    f.book,
    `/payroll/runs/${run.id}/executions`,
    { runDigest: run.digest, approvalId: runApproval.id },
    Runs.PayrollRunExecution,
  );

  const view = await decoded(
    await request(f.book, `/payroll/claims/${revision.claimId}`),
    Claims.EmployeeClaimView,
  );

  expect(view.instructions.map((row) => [row.instruction.kind, row.status])).toEqual([
    ["direct", "exported_unknown"],
    ["payroll", "consumed"],
  ]);
  const admin = await database();
  let balances;

  try {
    balances = (
      await admin.query(
        "select account_id,sum(debit_minor::numeric-credit_minor::numeric)::text as balance from openerp.journal_lines where book_id=$1 and account_id in ('claim_expense','claim_vat','claim_liability') group by account_id order by account_id",
        [f.book.bookId],
      )
    ).rows;
  } finally {
    await admin.end();
  }

  expect(balances).toEqual([
    { account_id: "claim_expense", balance: "1000000" },
    { account_id: "claim_liability", balance: "-500000" },
    { account_id: "claim_vat", balance: "250000" },
  ]);

  const exportedOn = A.swedishBusinessDate(new Date(exported.createdAt));
  const observedOn = f.file.executionDate >= exportedOn ? f.file.executionDate : exportedOn;

  const declaration = {
    kind: "synthetic_bank_statement_v1",
    statementIdentifier: key(),
    sourceBankAccountId: "synthetic_claim_bank",
    accountId: "account_bank",
    currency: "SEK",
    startsOn: observedOn,
    endsOn: observedOn,
    openingMinor: "1000000",
    closingMinor: "500000",
    completeness: { declaredComplete: true, basis: "Whole retained synthetic bank row" },
    rows: [
      {
        rowOrdinal: 1,
        providerId: key(),
        date: observedOn,
        description: "Observed fixed employee claim payment",
        amountMinor: "-500000",
      },
    ],
  };

  const cashEvidence = await post(
    f.book,
    "/evidence",
    {
      title: "Observed claim bank payment",
      content: JSON.stringify(declaration),
      mediaType: "application/json",
      origin: "Synthetic R40 public API proof",
    },
    A.Evidence,
  );

  const statement = await post(
    f.book,
    "/bank-statements",
    { ...declaration, evidenceId: cashEvidence.id, existingMatches: [] },
    Bank.StatementImportReceipt,
  );

  const confirmation = {
    profile: "synthetic_employee_claim_bank_confirmation_v1",
    recordClass: "synthetic",
    scope: { entityId: f.book.entityId, bookId: f.book.bookId },
    statementId: statement.statement.id,
    rowOrdinal: 1,
    bankAccountId: "account_bank",
    bankEvidence: { evidenceId: cashEvidence.id, sha256: cashEvidence.sha256 },
    observedOn: observedOn,
    amountMinor: "500000",
    instructionId: recognition.directInstruction.id,
    instructionDigest: recognition.directInstruction.digest,
    exportId: exported.id,
    exportDigest: exported.digest,
    exportSha256: exported.sha256,
    previewId: preview.id,
    previewDigest: preview.digest,
    payeeVerificationId: verified.id,
    payeeVerificationDigest: verified.digest,
    creditorIban: verified.proposal.input.creditorIban,
  };

  const settlementInput = {
    instructionDigest: recognition.directInstruction.digest,
    exportId: exported.id,
    statementId: statement.statement.id,
    rowOrdinal: 1,
    bankAccountId: "account_bank",
    evidenceId: cashEvidence.id,
    postingDate: observedOn,
    accountingPeriodId: "period_2026",
    series: "A",
    payeeEvidence: f.evidence,
  };

  const settlementPath = `/payroll/claims/instructions/${recognition.directInstruction.id}/settlement-reviews`;

  await failure(
    await request(f.book, settlementPath, {
      method: "POST",
      body: JSON.stringify(settlementInput),
    }),
    422,
    "UnsupportedProfile",
  );

  for (const changed of [
    { exportSha256: "0".repeat(64) },
    { creditorIban: "DE89370400440532013000" },
    { statementId: "unrelated_same_amount_statement" },
  ]) {
    const unrelated = await post(
      f.book,
      "/evidence",
      {
        title: "Unrelated same-amount bank confirmation",
        content: JSON.stringify({ ...confirmation, ...changed }),
        mediaType: "application/json",
        origin: "Synthetic R40 association refusal",
      },
      A.Evidence,
    );

    await failure(
      await request(f.book, settlementPath, {
        method: "POST",
        body: JSON.stringify({
          ...settlementInput,
          payeeEvidence: { evidenceId: unrelated.id, sha256: unrelated.sha256 },
        }),
      }),
      409,
      "StaleDependency",
    );
  }

  const oldDeclaration = {
    ...declaration,
    statementIdentifier: key(),
    startsOn: "2026-01-31",
    endsOn: "2026-01-31",
    rows: declaration.rows.map((row) => ({ ...row, providerId: key(), date: "2026-01-31" })),
  };

  const oldEvidence = await post(
    f.book,
    "/evidence",
    {
      title: "Bank debit before this payment file",
      content: JSON.stringify(oldDeclaration),
      mediaType: "application/json",
      origin: "Synthetic chronology refusal",
    },
    A.Evidence,
  );

  const oldStatement = await post(
    f.book,
    "/bank-statements",
    {
      ...oldDeclaration,
      evidenceId: oldEvidence.id,
      existingMatches: [],
    },
    Bank.StatementImportReceipt,
  );

  const oldConfirmation = await post(
    f.book,
    "/evidence",
    {
      title: "Exact references with invalid chronology",
      content: JSON.stringify({
        ...confirmation,
        statementId: oldStatement.statement.id,
        bankEvidence: { evidenceId: oldEvidence.id, sha256: oldEvidence.sha256 },
        observedOn: "2026-01-31",
      }),
      mediaType: "application/json",
      origin: "Synthetic chronology refusal",
    },
    A.Evidence,
  );

  await failure(
    await request(f.book, settlementPath, {
      method: "POST",
      body: JSON.stringify({
        ...settlementInput,
        statementId: oldStatement.statement.id,
        evidenceId: oldEvidence.id,
        postingDate: "2026-01-31",
        payeeEvidence: { evidenceId: oldConfirmation.id, sha256: oldConfirmation.sha256 },
      }),
    }),
    409,
    "StaleDependency",
  );

  const confirmationEvidence = await post(
    f.book,
    "/evidence",
    {
      title: "Exact synthetic employee bank confirmation",
      content: JSON.stringify(confirmation),
      mediaType: "application/json",
      origin: "Retained source for independent settlement review",
    },
    A.Evidence,
  );

  const settlementReview = await post(
    f.book,
    settlementPath,
    {
      ...settlementInput,
      payeeEvidence: { evidenceId: confirmationEvidence.id, sha256: confirmationEvidence.sha256 },
    },
    Claims.ClaimSettlementReview,
  );

  const settlement = await post(
    f.reviewer,
    `/payroll/claims/settlement-reviews/${settlementReview.id}/approvals`,
    { reviewDigest: settlementReview.digest },
    Claims.ClaimSettlement,
  );

  const settledView = await decoded(
    await request(f.book, `/payroll/claims/${revision.claimId}`),
    Claims.EmployeeClaimView,
  );

  expect(settledView.instructions.find((row) => row.instruction.kind === "direct")?.status).toBe(
    "settled",
  );
  expect(settledView.completionAllowed).toBe(false);
  const check = await database();

  try {
    expect(
      (
        await check.query(
          "select sum(debit_minor::numeric-credit_minor::numeric)::text as balance from openerp.journal_lines where book_id=$1 and account_id='claim_liability'",
          [f.book.bookId],
        )
      ).rows,
    ).toEqual([{ balance: "0" }]);
    expect(
      (
        await check.query(
          "select count(*)::text as count from openerp.bank_matches where book_id=$1 and statement_id=$2 and voucher_id=$3",
          [f.book.bookId, statement.statement.id, settlement.postingReceipt.voucherId],
        )
      ).rows,
    ).toEqual([{ count: "1" }]);
  } finally {
    await check.end();
  }

  await writeFile(
    join(environment().artifacts, "employee-claims-r40-proof.json"),
    JSON.stringify(
      {
        command:
          "OPENERP_E2E_ARTIFACTS=test-results/r40-final bunx vp test run apps/api/tests/employee-claims.e2e.test.ts",
        revision,
        review,
        recognition,
        proposal,
        verified,
        preview,
        exported,
        calculation,
        run,
        runApproval,
        runExecution,
        view,
        balances,
        confirmation,
        confirmationEvidence,
        calendarBoundaryObserved,
        oldStatement,
        oldConfirmation,
        settlementReview,
        settlement,
        settledView,
      },
      null,
      2,
    ),
  );
}, 180000);

test("R40 current source drift refuses the old review while completion preserves originals and requires a fresh revision", async () => {
  const f = await employeeClaimFixture();

  if (!f.taxSource || !f.taxReview) throw new Error("Missing qualified synthetic tax source");

  const revision = await post(
    f.book,
    "/payroll/claims",
    f.submission,
    Claims.EmployeeClaimRevision,
  );

  const empty = await decoded(
    await request(f.book, `/payroll/claims/${revision.claimId}`),
    Claims.EmployeeClaimView,
  );

  expect(empty.currentReview).toBeNull();
  expect(empty.approvalAllowed).toBe(false);
  expect(empty.completionAllowed).toBe(true);

  const review = await post(
    f.book,
    `/payroll/claims/${revision.claimId}/reviews`,
    { ...f.review, revisionDigest: revision.digest },
    Claims.EmployeeClaimReview,
  );

  const changed = await post(
    f.reviewer,
    `/expense-tax/sources/${f.taxSource.sourceId}/reviews`,
    {
      sourceDigest: f.taxSource.digest,
      expectedReviewDigest: f.taxReview.digest,
      facts: {
        ...f.taxReview.facts,
        rationale: "Fresh independent qualification supersedes the old review",
      },
    },
    Tax.TaxReview,
  );

  const stale = await decoded(
    await request(f.reviewer, `/payroll/claims/${revision.claimId}`),
    Claims.EmployeeClaimView,
  );

  expect([stale.pendingReviewCurrent, stale.approvalAllowed, stale.completionAllowed]).toEqual([
    false,
    false,
    true,
  ]);
  await failure(
    await request(f.reviewer, `/payroll/claims/reviews/${review.id}/approvals`, {
      method: "POST",
      body: JSON.stringify({ reviewDigest: review.digest }),
    }),
    409,
    "StaleDependency",
  );

  const completion = await post(
    f.reviewer,
    `/payroll/claims/${revision.claimId}/completion-requests`,
    { revisionDigest: revision.digest, reason: "Resolve changed retained source qualification" },
    Claims.ClaimCompletionRequest,
  );

  const revised = await post(
    f.book,
    `/payroll/claims/${revision.claimId}/revisions`,
    {
      ...f.submission,
      expectedRevisionDigest: revision.digest,
      purpose: "Completed retained claim qualification",
      items: f.submission.items.map((item, index) =>
        index === 0 ? { ...item, taxReviewDigest: changed.digest } : item,
      ),
    },
    Claims.EmployeeClaimRevision,
  );

  expect(revised.previousRevisionId).toBe(revision.id);
  expect(revised.items.map((row) => row.occurrence)).toEqual(
    revision.items.map((row) => row.occurrence),
  );

  const fresh = await post(
    f.book,
    `/payroll/claims/${revision.claimId}/reviews`,
    { ...f.review, revisionDigest: revised.digest, directMinor: "0" },
    Claims.EmployeeClaimReview,
  );

  const recognition = await post(
    f.reviewer,
    `/payroll/claims/reviews/${fresh.id}/approvals`,
    { reviewDigest: fresh.digest },
    Claims.EmployeeClaimRecognition,
  );

  expect(recognition.directInstruction).toBeNull();
  expect(recognition.payrollInstruction?.amountMinor).toBe("1250000");

  const history = await decoded(
    await request(f.reviewer, `/payroll/claims/${revision.claimId}`),
    Claims.EmployeeClaimView,
  );

  expect(history.revisions).toEqual([revision, revised]);
  expect(history.currentRevision).toBe(revised.revision);
  expect(history.current.id).toBe(revised.id);
  expect(history.currentRevision).toBe(Math.max(...history.revisions.map((row) => row.revision)));
  expect(history.reviews).toEqual([review, fresh]);
  expect(history.completionRequests).toEqual([completion]);
  await writeFile(
    join(environment().artifacts, "employee-claims-r40-completion-proof.json"),
    JSON.stringify(
      {
        revision,
        review,
        changed,
        stale,
        completion,
        revised,
        fresh,
        recognition,
        history,
        revisionAuthority: "retained_monotonic_revision",
        timestampTieObserved: revision.createdAt === revised.createdAt,
      },
      null,
      2,
    ),
  );
});

test("R40 all-direct mints one positive instruction and a no-review completion remains publicly recoverable", async () => {
  const f = await employeeClaimFixture();

  const revision = await post(
    f.book,
    "/payroll/claims",
    f.submission,
    Claims.EmployeeClaimRevision,
  );

  const completion = await post(
    f.reviewer,
    `/payroll/claims/${revision.claimId}/completion-requests`,
    { revisionDigest: revision.digest, reason: "Complete the purpose before review" },
    Claims.ClaimCompletionRequest,
  );

  const revised = await post(
    f.book,
    `/payroll/claims/${revision.claimId}/revisions`,
    {
      ...f.submission,
      expectedRevisionDigest: revision.digest,
      purpose: "Completed purpose before recognition",
    },
    Claims.EmployeeClaimRevision,
  );

  const review = await post(
    f.book,
    `/payroll/claims/${revision.claimId}/reviews`,
    { ...f.review, revisionDigest: revised.digest, directMinor: "1250000" },
    Claims.EmployeeClaimReview,
  );

  const recognition = await post(
    f.reviewer,
    `/payroll/claims/reviews/${review.id}/approvals`,
    { reviewDigest: review.digest },
    Claims.EmployeeClaimRecognition,
  );

  expect(recognition.directInstruction?.amountMinor).toBe("1250000");
  expect(recognition.payrollInstruction).toBeNull();

  const directory = await decoded(
    await request(f.reviewer, "/payroll/claims"),
    Claims.EmployeeClaimDirectory,
  );

  expect(
    directory.claims.find((row) => row.claimId === revision.claimId)?.completionRequests,
  ).toEqual([completion]);
  await writeFile(
    join(environment().artifacts, "employee-claims-r40-direct-proof.json"),
    JSON.stringify({ revision, completion, revised, review, recognition, directory }, null, 2),
  );
});

test("R40 submitted originals fence previously approved legacy inputs and concurrent recognition posts only once", async () => {
  const f = await employeeClaimFixture();

  if (!f.taxSource || !f.taxReview) throw new Error("Missing retained qualification");
  const receipt = f.receipt;

  const legacyInput = await post(
    f.book,
    "/payroll/inputs",
    {
      employeeId: f.submission.employeeId,
      month: f.submission.month,
      recordClass: "synthetic",
      economicKey: `legacy_${key()}`,
      evidence: { evidenceId: f.taxSource.facts.evidenceId, sha256: f.taxSource.evidenceSha256 },
      purpose: "Prepared before claim submission",
      accountingPeriodId: "period_2026",
      postingDate: "2026-01-15",
      series: "A",
      liabilityAccountId: "claim_liability",
      basis: {
        kind: "claim",
        paidBy: "employee",
        counterpartyId: receipt.counterpartyId,
        supplierDocumentNumber: receipt.supplierDocumentNumber,
        inputVatAccountId: "claim_vat",
        line: {
          sourceLineId: receipt.sourceLineId,
          expenseAccountId: "claim_expense",
          netMinor: receipt.netMinor,
          sourceTaxMinor: receipt.vatMinor,
          sourceGrossMinor: receipt.grossMinor,
          treatment: {
            treatmentId: "synthetic_expense_tax_v1",
            rate: { numerator: "1", denominator: "4" },
            deduction: { numerator: "1", denominator: "1" },
            invoiceTaxRounding: "half_up",
            deductionRounding: "half_up",
            acceptancePolicy: "exact_match",
            toleranceMinor: "0",
            basis: f.taxReview.facts.deductionBasis,
          },
          sourceRefs: [
            {
              evidenceId: f.taxSource.facts.evidenceId,
              sourceKey: f.submission.items[0]?.occurrenceId,
            },
          ],
        },
      },
    },
    Inputs.PayrollInput,
  );

  const legacyReview = await post(
    f.book,
    `/payroll/inputs/${legacyInput.id}/reviews`,
    { inputDigest: legacyInput.digest },
    Inputs.PayrollInputReview,
  );

  const legacyApproval = await post(
    f.book,
    `/payroll/input-reviews/${legacyReview.id}/approvals`,
    { reviewDigest: legacyReview.digest },
    Inputs.PayrollInputApproval,
  );

  const revision = await post(
    f.book,
    "/payroll/claims",
    f.submission,
    Claims.EmployeeClaimRevision,
  );

  await failure(
    await request(f.book, `/payroll/input-reviews/${legacyReview.id}/executions`, {
      method: "POST",
      body: JSON.stringify({ reviewDigest: legacyReview.digest, approvalId: legacyApproval.id }),
    }),
    403,
    "ApprovalRequired",
  );
  await failure(
    await request(f.book, `/payroll/inputs/${legacyInput.id}/reviews`, {
      method: "POST",
      body: JSON.stringify({ inputDigest: legacyInput.digest }),
    }),
    403,
    "ApprovalRequired",
  );

  const clone = await post(
    f.book,
    "/change-sets",
    {
      kind: "manual_journal",
      eventKey: `clone_${key()}`,
      evidenceId: f.taxSource.facts.evidenceId,
      accountingPeriodId: "period_2026",
      postingDate: "2026-01-15",
      series: "A",
      description: "Generic clone of retained employee receipt",
      rationale: "Attempt another posting route",
      taxAssessment: "not_applicable",
      lines: [
        {
          accountId: "claim_expense",
          debitMinor: "1250000",
          creditMinor: "0",
          description: "Cloned expense",
        },
        {
          accountId: "claim_liability",
          debitMinor: "0",
          creditMinor: "1250000",
          description: "Cloned debt",
        },
      ],
    },
    A.ChangeSet,
  );

  await failure(
    await request(f.reviewer, `/change-sets/${clone.id}/approvals`, {
      method: "POST",
      body: JSON.stringify({ version: 1, planDigest: clone.planDigest }),
    }),
    403,
    "ApprovalRequired",
  );

  const review = await post(
    f.book,
    `/payroll/claims/${revision.claimId}/reviews`,
    { ...f.review, revisionDigest: revision.digest },
    Claims.EmployeeClaimReview,
  );

  const responses = await Promise.all([
    request(f.reviewer, `/payroll/claims/reviews/${review.id}/approvals`, {
      method: "POST",
      body: JSON.stringify({ reviewDigest: review.digest }),
    }),
    request(f.reviewer, `/payroll/claims/reviews/${review.id}/approvals`, {
      method: "POST",
      body: JSON.stringify({ reviewDigest: review.digest }),
    }),
  ]);

  expect(responses.map((response) => response.status).sort((left, right) => left - right)).toEqual([
    200, 409,
  ]);
  const success = responses.find((response) => response.status === 200);

  if (!success) throw new Error("No recognition committed");
  const recognition = await decoded(success, Claims.EmployeeClaimRecognition);
  const rejected = responses.find((response) => response.status === 409);

  if (!rejected) throw new Error("Concurrent recognition did not refuse");
  await failure(rejected, 409, "AlreadyPosted");
  const admin = await database();

  try {
    expect(
      (
        await admin.query(
          "select count(*)::text as count from openerp.employee_claim_recognitions where book_id=$1 and claim_id=$2",
          [f.book.bookId, revision.claimId],
        )
      ).rows,
    ).toEqual([{ count: "1" }]);
    expect(
      (
        await admin.query(
          "select sum(debit_minor::numeric-credit_minor::numeric)::text as balance from openerp.journal_lines where book_id=$1 and account_id='claim_expense'",
          [f.book.bookId],
        )
      ).rows,
    ).toEqual([{ balance: "1000000" }]);
  } finally {
    await admin.end();
  }

  await writeFile(
    join(environment().artifacts, "employee-claims-r40-fences-proof.json"),
    JSON.stringify(
      { legacyInput, legacyReview, legacyApproval, revision, clone, review, recognition },
      null,
      2,
    ),
  );
});

test("R40 current V7 backup, inspect and fenced restore preserve retained claim decisions and fixed instructions", async () => {
  const f = await employeeClaimFixture();

  const revision = await post(
    f.book,
    "/payroll/claims",
    f.submission,
    Claims.EmployeeClaimRevision,
  );

  const completion = await post(
    f.reviewer,
    `/payroll/claims/${revision.claimId}/completion-requests`,
    {
      revisionDigest: revision.digest,
      reason: "Retained completion checkpoint before restored review",
    },
    Claims.ClaimCompletionRequest,
  );

  const revised = await post(
    f.book,
    `/payroll/claims/${revision.claimId}/revisions`,
    {
      ...f.submission,
      expectedRevisionDigest: revision.digest,
      purpose: "Completed retained source proof",
    },
    Claims.EmployeeClaimRevision,
  );

  const review = await post(
    f.book,
    `/payroll/claims/${revision.claimId}/reviews`,
    { ...f.review, revisionDigest: revised.digest },
    Claims.EmployeeClaimReview,
  );

  const recognition = await post(
    f.reviewer,
    `/payroll/claims/reviews/${review.id}/approvals`,
    { reviewDigest: review.digest },
    Claims.EmployeeClaimRecognition,
  );

  const recovered = (await proveReminderRecovery(f.book.bookId, [7]))[0];

  if (!recovered || recovered.inventory.version !== 7)
    throw new Error("Current claim recovery inventory missing");
  expect(recovered.restoredInventory).toEqual(recovered.inventory);
  expect(recovered.inspection.durableWork).toBe("matched");
  expect(recovered.receipt.durableWork?.inventoryVerification).toBe("matched");
  expect(recovered.suspension.inventoryVerification).toBe("matched");
  expect(recovered.suspension.resumeAllowed).toBe(false);
  expect(recovered.fence).toEqual({ allowConnections: false, connectionLimit: 0 });

  const represented = recovered.inventory.employeeClaimRecords.filter(
    (row) => row.bookId === f.book.bookId,
  );

  expect(represented.map((row) => row.table).sort()).toEqual(
    [
      "employee_claims",
      "employee_claim_revisions",
      "employee_claim_revisions",
      "employee_claim_reviews",
      "employee_claim_completion_requests",
      "employee_claim_recognitions",
      "employee_claim_instructions",
      "employee_claim_instructions",
    ].sort(),
  );
  await writeFile(
    join(environment().artifacts, "employee-claims-r40-recovery-proof.json"),
    JSON.stringify({ revision, completion, revised, review, recognition, recovered }, null, 2),
  );
}, 180000);

test("R40 rejects another pending claim owner and prior recognized legacy source before retaining a fence", async () => {
  const pending = await employeeClaimFixture();

  const first = await post(
    pending.book,
    "/payroll/claims",
    pending.submission,
    Claims.EmployeeClaimRevision,
  );

  const duplicate = await request(pending.book, "/payroll/claims", {
    method: "POST",
    body: JSON.stringify({ ...pending.submission, claimKey: `other_${key()}` }),
  });

  await failure(duplicate, 409, "AlreadyPosted");

  const directory = await decoded(
    await request(pending.book, "/payroll/claims"),
    Claims.EmployeeClaimDirectory,
  );

  expect(directory.claims.map((row) => row.claimId)).toEqual([first.claimId]);

  const f = await employeeClaimFixture();

  if (!f.taxSource || !f.taxReview) throw new Error("Missing retained qualification");
  const receipt = f.receipt;

  const legacyInput = await post(
    f.book,
    "/payroll/inputs",
    {
      employeeId: f.submission.employeeId,
      month: f.submission.month,
      recordClass: "synthetic",
      economicKey: `legacy_${key()}`,
      evidence: { evidenceId: f.taxSource.facts.evidenceId, sha256: f.taxSource.evidenceSha256 },
      purpose: "Prepared before claim submission",
      accountingPeriodId: "period_2026",
      postingDate: "2026-01-15",
      series: "A",
      liabilityAccountId: "claim_liability",
      basis: {
        kind: "claim",
        paidBy: "employee",
        counterpartyId: receipt.counterpartyId,
        supplierDocumentNumber: receipt.supplierDocumentNumber,
        inputVatAccountId: "claim_vat",
        line: {
          sourceLineId: receipt.sourceLineId,
          expenseAccountId: "claim_expense",
          netMinor: receipt.netMinor,
          sourceTaxMinor: receipt.vatMinor,
          sourceGrossMinor: receipt.grossMinor,
          treatment: {
            treatmentId: "synthetic_expense_tax_v1",
            rate: { numerator: "1", denominator: "4" },
            deduction: { numerator: "1", denominator: "1" },
            invoiceTaxRounding: "half_up",
            deductionRounding: "half_up",
            acceptancePolicy: "exact_match",
            toleranceMinor: "0",
            basis: f.taxReview.facts.deductionBasis,
          },
          sourceRefs: [
            {
              evidenceId: f.taxSource.facts.evidenceId,
              sourceKey: f.submission.items[0]?.occurrenceId,
            },
          ],
        },
      },
    },
    Inputs.PayrollInput,
  );

  const legacyReview = await post(
    f.book,
    `/payroll/inputs/${legacyInput.id}/reviews`,
    { inputDigest: legacyInput.digest },
    Inputs.PayrollInputReview,
  );

  const legacyApproval = await post(
    f.book,
    `/payroll/input-reviews/${legacyReview.id}/approvals`,
    { reviewDigest: legacyReview.digest },
    Inputs.PayrollInputApproval,
  );

  const legacyExecution = await post(
    f.book,
    `/payroll/input-reviews/${legacyReview.id}/executions`,
    { reviewDigest: legacyReview.digest, approvalId: legacyApproval.id },
    Inputs.PayrollInputExecution,
  );

  await failure(
    await request(f.book, "/payroll/claims", {
      method: "POST",
      body: JSON.stringify(f.submission),
    }),
    409,
    "AlreadyPosted",
  );

  const empty = await decoded(
    await request(f.book, "/payroll/claims"),
    Claims.EmployeeClaimDirectory,
  );

  expect(empty.claims).toEqual([]);

  const legacyView = await decoded(
    await request(f.book, `/payroll/inputs/${legacyInput.id}`),
    Inputs.PayrollInputView,
  );

  expect(legacyView.snapshot).not.toBeNull();
  await writeFile(
    join(environment().artifacts, "employee-claims-r40-source-conflicts-proof.json"),
    JSON.stringify(
      {
        first,
        directory,
        legacyInput,
        legacyReview,
        legacyApproval,
        legacyExecution,
        empty,
        legacyView,
      },
      null,
      2,
    ),
  );
});
