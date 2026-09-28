import { expect, test } from "vitest";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as Close from "@open-erp/contracts/financial-close";
import * as Accounting from "@open-erp/contracts/accounting";
import {
  database,
  approve,
  evidence,
  execute,
  journal,
  decoded,
  environment,
  failure,
  key,
  persisted,
  post,
  request,
  saveEvidence,
} from "./support/fixtures";
import {
  capture,
  closeApproval,
  closeFixture,
  closePath,
  controls,
  finalProposal,
  movement,
  mapping,
  recognizeTax,
  taxBridge,
} from "./support/financial-close";

// Three-year failure contract: a reviewed FY2026 opening includes all prior
// balances, including open FY2025. A normal FY2025 posting must be fenced while
// that certificate is active. If maintenance bypasses the fence, FY2027 capture
// must refuse the stale opening rather than omit the backdated amount.
test("an active close fences prior-year postings and refuses an out-of-band stale opening", async () => {
  const context = await closeFixture();
  const { book } = context;
  const admin = await database();

  try {
    await admin.query(
      "insert into openerp.fiscal_years(book_id,id,starts_on,ends_on) values($1,'fy_2025','2025-01-01','2025-12-31')",
      [book.bookId],
    );
    await admin.query(
      "insert into openerp.periods(book_id,id,fiscal_year_id,starts_on,ends_on) values($1,'period_2025','fy_2025','2025-01-01','2025-12-31')",
      [book.bookId],
    );
  } finally {
    await admin.end();
  }

  const source = await evidence(book);
  const input = journal(source.id, "1000");

  const backdated = await post(
    book,
    "/change-sets",
    {
      ...input,
      accountingPeriodId: "period_2025",
      postingDate: "2025-12-31",
      lines: input.lines.map((line) =>
        line.accountId === "account_clearing" ? { ...line, accountId: "account_equity" } : line,
      ),
    },
    Accounting.ChangeSet,
  );

  const backdatedApproval = await approve(book, backdated);
  const basis = await taxBridge(context);

  await recognizeTax(context, basis.bridge);
  await controls(context);

  const proposal = await finalProposal(context, basis);
  const approval = await closeApproval(context, proposal);

  const certificate = await post(
    book,
    `${closePath}/proposals/${proposal.id}/execute`,
    { version: 1, digest: proposal.digest, approvalId: approval.id },
    Close.FinancialCloseCertificate,
  );

  const opening = await decoded(
    await request(book, `${closePath}/opening-sets/${certificate.openingSetId}`),
    Close.FinancialOpeningSet,
  );

  const future = await post(
    book,
    "/change-sets",
    { ...input, eventKey: key(), accountingPeriodId: "period_2027", postingDate: "2027-01-01" },
    Accounting.ChangeSet,
  );

  await execute(book, future);

  const before = await persisted(book);

  await failure(
    await request(book, `/change-sets/${backdated.id}/execute`, {
      method: "POST",
      body: JSON.stringify({
        version: 1,
        planDigest: backdated.planDigest,
        approvalId: backdatedApproval.id,
      }),
    }),
    409,
    "StaleDependency",
  );
  expect(await persisted(book)).toEqual(before);

  // A complete approved reopen releases the normal posting fence. Preserve its
  // event, then use a maintenance-only fixture to simulate an out-of-band writer
  // against the old opening without modifying any immutable opening bytes.
  const reopen = await post(
    book,
    `${closePath}/fy_2026/reopen`,
    { certificateId: certificate.id, reason: "Prior-year correction" },
    Close.FinancialReopenProposal,
  );

  const review = await post(
    context.reviewer,
    `${closePath}/reopen-proposals/${reopen.id}/approvals`,
    { version: 1, digest: reopen.digest },
    Close.FinalProposalApproval,
  );

  const authorizedReopen = await post(
    book,
    `${closePath}/reopen-proposals/${reopen.id}/execute`,
    { version: 1, digest: reopen.digest, approvalId: review.id },
    Close.FinancialReopenEvent,
  );

  await post(
    book,
    `/change-sets/${backdated.id}/execute`,
    { version: 1, planDigest: backdated.planDigest, approvalId: backdatedApproval.id },
    Accounting.ExecutionReceipt,
  );

  const maintenance = await database();

  try {
    // This disposable database alteration models an external writer, not an API
    // capability. Removing only the reopen event isolates source-boundary checks.
    await maintenance.query(
      "alter table openerp.financial_reopen_events disable trigger immutable_financial_reopen_event",
    );
    await maintenance.query("delete from openerp.financial_reopen_events where book_id=$1", [
      book.bookId,
    ]);
  } finally {
    await maintenance.query(
      "alter table openerp.financial_reopen_events enable trigger immutable_financial_reopen_event",
    );
    await maintenance.end();
  }

  await failure(
    await request(book, "/statement-snapshots", {
      method: "POST",
      body: JSON.stringify({
        fiscalYearId: "fy_2027",
        asOf: "2027-12-31",
        plStartsOn: "2027-01-01",
        plEndsOn: "2027-12-31",
        mapping,
      }),
    }),
    409,
    "StaleDependency",
  );
  expect(
    await decoded(
      await request(book, `${closePath}/opening-sets/${certificate.openingSetId}`),
      Close.FinancialOpeningSet,
    ),
  ).toEqual(opening);
  await writeFile(
    join(environment().artifacts, "financial-close-prior-year-boundary.json"),
    JSON.stringify(
      {
        certificate,
        opening,
        authorizedReopen,
        normalBackdatedPosting: "StaleDependency",
        futurePosting: "committed",
        maintenanceOnlyFixture:
          "Removed successful reopen event after approved correction to isolate opening source drift",
        staleOpeningCapture: "StaleDependency",
        openingBytesUnchanged: true,
      },
      null,
      2,
    ),
  );
  await saveEvidence("financial-close-prior-year-fence", book);
}, 120_000);

test("financial close: executed tax, exact transfer, rollback, replay, approved reopen, delta reclose and single opening", async () => {
  const context = await closeFixture();
  const { book, reviewer, other } = context;
  const basis = await taxBridge(context);

  await controls(context);

  const preparationInput = {
    fiscalYearId: "fy_2026",
    statementSnapshotId: basis.snapshot.id,
    bridgeId: basis.bridge.id,
    nominalAccountId: "account_transfer",
    equityAccountId: "account_equity",
    evidenceId: context.source.id,
    reason: "Synthetic missing prerequisite refusal",
    proposedAdjustmentRefs: [],
    otherFamilies: [],
  };

  await failure(
    await request(book, `${closePath}/preparations`, {
      method: "POST",
      body: JSON.stringify(preparationInput),
    }),
    409,
    "StaleDependency",
  );

  const tax = await recognizeTax(context, basis.bridge);

  expect(tax.deltaMinor).toBe("15000");
  await controls(context, "unknown");
  await failure(
    await request(book, `${closePath}/preparations`, {
      method: "POST",
      body: JSON.stringify(preparationInput),
    }),
    409,
    "StaleDependency",
  );
  await controls(context);

  const proposal = await finalProposal(context, basis);

  expect(proposal.profitMinor).toBe("60000");
  expect(proposal.plan.transfer.deltaMinor).toBe("60000");
  expect(proposal.openingTarget).toEqual([
    { accountId: "account_bank", balanceMinor: "75000", nominal: false },
    { accountId: "account_clearing", balanceMinor: "-15000", nominal: false },
    { accountId: "account_equity", balanceMinor: "-60000", nominal: false },
  ]);

  const approval = await closeApproval(context, proposal);

  const command = {
    method: "POST",
    headers: { "idempotency-key": key() },
    body: JSON.stringify({ version: 1, digest: proposal.digest, approvalId: approval.id }),
  };

  const path = `${closePath}/proposals/${proposal.id}/execute`;
  const admin = await database();

  try {
    await admin.query("delete from openerp.memberships where book_id=$1 and actor_id=$2", [
      book.bookId,
      reviewer.actorId,
    ]);
    await failure(await request(book, path, command), 403, "ApprovalRequired");
    await admin.query(
      "insert into openerp.memberships(book_id,actor_id,role) values($1,$2,'operator')",
      [book.bookId, reviewer.actorId],
    );
    await failure(await request(other, path, command), 404, "NotFound");

    const before = await persisted(book);

    // Disposable fixture failure injection at the final persistence boundary.
    await admin.query(
      `alter table openerp.financial_close_certificates add constraint next23_injected_failure check(book_id <> ${admin.escapeLiteral(book.bookId)}) not valid`,
    );
    await failure(await request(book, path, command), 500, "InternalError");
    await admin.query(
      "alter table openerp.financial_close_certificates drop constraint next23_injected_failure",
    );
    expect(await persisted(book)).toEqual(before);
    expect(
      await decoded(await request(book, `${closePath}/fy_2026/status`), Close.FinancialYearStatus),
    ).toMatchObject({ status: "ready_for_finalization", blockers: [] });
  } finally {
    await admin.query(
      "alter table openerp.financial_close_certificates drop constraint if exists next23_injected_failure",
    );
    await admin.end();
  }

  const receipts = await Promise.all(
    Array.from({ length: 4 }, async () =>
      decoded(await request(book, path, command), Close.FinancialCloseCertificate),
    ),
  );

  const first = receipts[0]!;

  for (const receipt of receipts) expect(receipt).toEqual(first);

  const authority = await database();

  try {
    await authority.query("delete from openerp.memberships where book_id=$1 and actor_id=$2", [
      book.bookId,
      reviewer.actorId,
    ]);
    expect(
      await decoded(await request(book, path, command), Close.FinancialCloseCertificate),
    ).toEqual(first);
    await authority.query(
      "insert into openerp.memberships(book_id,actor_id,role) values($1,$2,'operator')",
      [book.bookId, reviewer.actorId],
    );
  } finally {
    await authority.end();
  }

  await failure(await request(reviewer, path, command), 409, "IdempotencyConflict");

  expect(first.transferDeltaMinor).toBe("60000");

  const opening = await decoded(
    await request(book, `${closePath}/opening-sets/${first.openingSetId}`),
    Close.FinancialOpeningSet,
  );

  expect(opening.rows).toEqual(proposal.openingTarget);

  const reopen = await post(
    book,
    `${closePath}/fy_2026/reopen`,
    { certificateId: first.id, reason: "Synthetic correction" },
    Close.FinancialReopenProposal,
  );

  const reopenApproval = await post(
    reviewer,
    `${closePath}/reopen-proposals/${reopen.id}/approvals`,
    { version: 1, digest: reopen.digest },
    Close.FinalProposalApproval,
  );

  await failure(
    await request(book, `${closePath}/reopen-proposals/${reopen.id}/execute`, {
      method: "POST",
      body: JSON.stringify({ version: 1, digest: reopen.digest, approvalId: "missing_approval" }),
    }),
    403,
    "ApprovalRequired",
  );

  const reopened = await post(
    book,
    `${closePath}/reopen-proposals/${reopen.id}/execute`,
    { version: 1, digest: reopen.digest, approvalId: reopenApproval.id },
    Close.FinancialReopenEvent,
  );

  expect(reopened.status).toBe("executed");
  expect(
    await decoded(await request(book, `${closePath}/fy_2026/status`), Close.FinancialYearStatus),
  ).toMatchObject({ status: "open", reopened: true });

  await failure(
    await request(book, `/vouchers/${first.transferVoucherId}/correction-proposals`, {
      method: "POST",
      body: JSON.stringify({
        accountingPeriodId: "period_2026",
        postingDate: "2026-12-31",
        rationale: "Owned transfer must use delta reclose",
      }),
    }),
    422,
    "UnsupportedProfile",
  );

  await movement(book, "account_expense", "account_bank", "12500");

  const revisedBasis = await taxBridge(context);
  const revisedTax = await recognizeTax(context, revisedBasis.bridge);

  expect(revisedTax.deltaMinor).toBe("-2500");
  await controls(context);

  const revised = await finalProposal(context, revisedBasis);

  expect(revised.profitMinor).toBe("50000");
  expect(revised.priorTransferMinor).toBe("60000");
  expect(revised.plan.transfer.deltaMinor).toBe("-10000");

  const revisedApproval = await closeApproval(context, revised);

  const second = await post(
    book,
    `${closePath}/proposals/${revised.id}/execute`,
    { version: 1, digest: revised.digest, approvalId: revisedApproval.id },
    Close.FinancialCloseCertificate,
  );

  const secondOpening = await decoded(
    await request(book, `${closePath}/opening-sets/${second.openingSetId}`),
    Close.FinancialOpeningSet,
  );

  expect(secondOpening.supersedesId).toBe(opening.id);
  expect(secondOpening.rows).toEqual([
    { accountId: "account_bank", balanceMinor: "62500", nominal: false },
    { accountId: "account_clearing", balanceMinor: "-12500", nominal: false },
    { accountId: "account_equity", balanceMinor: "-50000", nominal: false },
  ]);
  expect(
    await decoded(
      await request(book, `${closePath}/opening-sets/${opening.id}`),
      Close.FinancialOpeningSet,
    ),
  ).toEqual(opening);

  const nextYear = await capture(book, "2027");

  expect(nextYear.openingBasis).toMatchObject({
    representation: "financial_close",
    basisId: secondOpening.id,
    reviewed: true,
  });
  expect(nextYear.balance).toMatchObject({
    assetMinor: "62500",
    liabilityMinor: "12500",
    equityMinor: "50000",
    virtualUntransferredResultMinor: "0",
    balances: true,
  });

  const refusedPlan = await post(
    book,
    `${closePath}/fy_2026/reopen`,
    { certificateId: second.id, reason: "Consumed downstream refusal" },
    Close.FinancialReopenProposal,
  );

  const refusedApproval = await post(
    reviewer,
    `${closePath}/reopen-proposals/${refusedPlan.id}/approvals`,
    { version: 1, digest: refusedPlan.digest },
    Close.FinalProposalApproval,
  );

  const refused = await post(
    book,
    `${closePath}/reopen-proposals/${refusedPlan.id}/execute`,
    { version: 1, digest: refusedPlan.digest, approvalId: refusedApproval.id },
    Close.FinancialReopenEvent,
  );

  expect(refused.status).toBe("refused");
  expect(refused.downstreamRefusals).toContain(`statement_snapshot:${nextYear.id}`);
  expect(refused.unlockedPeriodIds).toEqual([]);

  const retained = await database();

  try {
    const saved = await retained.query<{ body: unknown }>(
      "select body from openerp.financial_reopen_events where book_id=$1 and id=$2",
      [book.bookId, refused.id],
    );

    expect(saved.rows[0]?.body).toEqual(refused);
  } finally {
    await retained.end();
  }

  await writeFile(
    join(environment().artifacts, "financial-close-journey.json"),
    JSON.stringify({ first, opening, reopened, second, secondOpening, nextYear, refused }, null, 2),
  );
  await saveEvidence("financial-close-ledger", book);
}, 120_000);

// Failure cases: interim capture must not lock the whole year; an evidence-only
// adjustment must not masquerade as an executed economic effect; a ledger change
// after approval must refuse without consuming the close approval or counters.
test("close refuses interim basis, unexecuted selected adjustment and stale approved basis", async () => {
  const context = await closeFixture();
  const interim = await taxBridge(context, await capture(context.book, "2026", "2026-06-30"));

  await recognizeTax(context, interim.bridge);
  await controls(context);

  const input = {
    fiscalYearId: "fy_2026",
    statementSnapshotId: interim.snapshot.id,
    bridgeId: interim.bridge.id,
    nominalAccountId: "account_transfer",
    equityAccountId: "account_equity",
    evidenceId: context.source.id,
    reason: "Interim refusal",
    proposedAdjustmentRefs: [],
    otherFamilies: [],
  };

  await failure(
    await request(context.book, `${closePath}/preparations`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
    409,
    "StaleDependency",
  );

  const basis = await taxBridge(context);

  await recognizeTax(context, basis.bridge);
  await controls(context);
  await failure(
    await request(context.book, `${closePath}/preparations`, {
      method: "POST",
      body: JSON.stringify({
        ...input,
        statementSnapshotId: basis.snapshot.id,
        bridgeId: basis.bridge.id,
        proposedAdjustmentRefs: [context.ref],
      }),
    }),
    409,
    "StaleDependency",
  );

  const proposal = await finalProposal(context, basis);
  const approval = await closeApproval(context, proposal);

  await controls(context, "unknown");
  await failure(
    await request(context.book, `${closePath}/proposals/${proposal.id}/execute`, {
      method: "POST",
      body: JSON.stringify({ version: 1, digest: proposal.digest, approvalId: approval.id }),
    }),
    409,
    "StaleDependency",
  );
  await controls(context);

  const refreshed = await finalProposal(context, basis);
  const refreshedApproval = await closeApproval(context, refreshed);

  await movement(context.book, "account_expense", "account_bank", "1000");

  const before = await persisted(context.book);

  await failure(
    await request(context.book, `${closePath}/proposals/${refreshed.id}/execute`, {
      method: "POST",
      body: JSON.stringify({
        version: 1,
        digest: refreshed.digest,
        approvalId: refreshedApproval.id,
      }),
    }),
    409,
    "StaleDependency",
  );
  expect(await persisted(context.book)).toEqual(before);
  await saveEvidence("financial-close-refusals", context.book);
}, 120_000);

test("zero-delta finalization creates a certificate and opening without a voucher or counter", async () => {
  const context = await closeFixture("0");
  const basis = await taxBridge(context);

  await recognizeTax(context, basis.bridge);
  await controls(context);

  const proposal = await finalProposal(context, basis);
  const approval = await closeApproval(context, proposal);
  const before = await persisted(context.book);

  const receipt = await post(
    context.book,
    `${closePath}/proposals/${proposal.id}/execute`,
    { version: 1, digest: proposal.digest, approvalId: approval.id },
    Close.FinancialCloseCertificate,
  );

  expect(receipt.transferDeltaMinor).toBe("0");
  expect(receipt.transferVoucherId).toBeNull();
  expect(await persisted(context.book)).toEqual(before);
  await saveEvidence("financial-close-zero", context.book);
}, 120_000);
