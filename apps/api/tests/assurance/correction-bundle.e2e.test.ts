import { expect, test } from "vitest";
import * as Corrections from "@open-erp/contracts/corrections";
import * as Reports from "@open-erp/contracts/reports";
import {
  database,
  decoded,
  execute,
  failure,
  fixture,
  key,
  ledger,
  onePosting,
  persisted,
  post,
  prepare,
  request,
} from "../support/fixtures";
import {
  cleanupOwned,
  freshCommandCount,
  injectScopedInsertFault,
  rawVoucherRows,
  saveSanitizedJourney,
  waitForBlockedExecutors,
} from "./database-support";

async function correctionFixture() {
  const book = await fixture();
  const original = await execute(book, await prepare(book));

  const intent = {
    datePolicy: "explicit_open_period" as const,
    accountingPeriodId: "period_2026",
    postingDate: "2026-09-23",
    rationale: "Synthetic independent correction from 12500 to 7000 minor units",
    replacement: {
      description: "Correct synthetic transfer",
      lines: [
        {
          accountId: "account_bank",
          debitMinor: "7000",
          creditMinor: "0",
          description: "Corrected bank debit",
        },
        {
          accountId: "account_clearing",
          debitMinor: "0",
          creditMinor: "7000",
          description: "Corrected clearing credit",
        },
      ],
    },
  };

  const impact = await post(
    book,
    `/vouchers/${original.voucherId}/correction-impact-reviews`,
    intent,
    Corrections.CorrectionImpact,
  );

  expect(impact.basis.blockers).toEqual([]);

  const bundle = await post(
    book,
    `/vouchers/${original.voucherId}/correction-bundles`,
    {
      ...intent,
      impactReview: { id: impact.id, digest: impact.digest },
    },
    Corrections.CorrectionBundle,
  );

  const approval = await post(
    book,
    `/correction-bundles/${bundle.id}/approvals`,
    {
      version: 1,
      bundleDigest: bundle.bundleDigest,
    },
    Corrections.CorrectionBundleApproval,
  );

  return { book, original, intent, impact, bundle, approval };
}

const correctedPosting = {
  sequence: "3",
  vouchers: 3,
  lines: 6,
  receipts: 3,
  outbox: 3,
  consumed: 3,
  counter: "3",
};

test("a late correction-bundle fault rolls back both children and exact retry recovers once", async () => {
  const { book, original, bundle, approval } = await correctionFixture();

  const before = await persisted(book);
  const beforeRows = await rawVoucherRows(book);

  for (const child of [bundle.reversal, bundle.replacement]) {
    await failure(
      await request(book, `/change-sets/${child.id}/execute`, {
        method: "POST",
        body: JSON.stringify({ version: 1, planDigest: child.planDigest, approvalId: approval.id }),
      }),
      422,
      "UnsupportedProfile",
    );
  }

  expect(await persisted(book)).toEqual(before);

  const commandKey = key();

  const command = {
    method: "POST",
    headers: { "idempotency-key": commandKey },
    body: JSON.stringify({
      version: 1,
      bundleDigest: bundle.bundleDigest,
      approvalId: approval.id,
    }),
  };

  const removeFault = await injectScopedInsertFault(book, "correction_bundle_receipts");

  try {
    const response = await request(book, `/correction-bundles/${bundle.id}/execute`, command);

    expect(response.status, await response.text()).toBe(500);
    expect(await persisted(book)).toEqual(before);
    expect(await rawVoucherRows(book)).toEqual(beforeRows);
    expect(await freshCommandCount(book, commandKey)).toBe(0);
    expect(
      (
        await decoded(
          await request(book, `/correction-bundles/${bundle.id}`),
          Corrections.CorrectionBundleView,
        )
      ).receipt,
    ).toBeNull();
  } finally {
    await removeFault();
  }

  const receipt = await decoded(
    await request(book, `/correction-bundles/${bundle.id}/execute`, command),
    Corrections.CorrectionBundleReceipt,
  );

  expect(receipt.originalVoucherId).toBe(original.voucherId);
  expect(await persisted(book)).toEqual(correctedPosting);
  expect(await freshCommandCount(book, commandKey)).toBe(1);
  expect(
    await decoded(
      await request(book, `/correction-bundles/${bundle.id}/execute`, command),
      Corrections.CorrectionBundleReceipt,
    ),
  ).toEqual(receipt);
  expect(await persisted(book)).toEqual(correctedPosting);
  const rows = await rawVoucherRows(book);

  const balance = rows
    .filter((row) => row.account_id === "account_bank")
    .reduce((sum, row) => sum + BigInt(row.debit) - BigInt(row.credit), 0n);

  expect(balance).toBe(7000n);
  await saveSanitizedJourney("correction-bundle-late-fault", {
    before,
    beforeRows,
    receipt,
    rows,
    bankBalanceMinor: balance.toString(),
    persisted: await persisted(book),
  });
});

test("concurrent first correction commands commit once and retain fresh-key replay", async () => {
  const { book, original, bundle, approval } = await correctionFixture();
  expect(await persisted(book)).toEqual(onePosting);
  expect(
    (await ledger(book)).accounts.find((account) => account.accountId === "account_bank")
      ?.balanceMinor,
  ).toBe("12500");
  const commandKey = key();
  const input = { version: 1, bundleDigest: bundle.bundleDigest, approvalId: approval.id };
  const blocker = await database();
  const observer = await database();
  const abort = new AbortController();
  let requests: Array<Promise<Response>> = [];

  try {
    await blocker.query("BEGIN");
    await blocker.query("SELECT id FROM openerp.books WHERE id=$1 FOR UPDATE", [book.bookId]);

    const pid = (await blocker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]
      ?.pid;

    if (pid === undefined) throw new Error("No blocker PID");
    requests = Array.from({ length: 2 }, () =>
      request(book, `/correction-bundles/${bundle.id}/execute`, {
        method: "POST",
        headers: { "idempotency-key": commandKey },
        body: JSON.stringify(input),
        signal: abort.signal,
      }),
    );
    const settled = Promise.allSettled(requests);
    const waiters = await waitForBlockedExecutors(observer, pid, 2);
    await blocker.query("COMMIT");

    const receipts = await Promise.all(
      requests.map(async (pending) => decoded(await pending, Corrections.CorrectionBundleReceipt)),
    );

    await settled;
    expect(receipts[0]).toEqual(receipts[1]);
    expect(receipts[0]?.originalVoucherId).toBe(original.voucherId);
    expect(await persisted(book)).toEqual(correctedPosting);
    expect(await freshCommandCount(book, commandKey)).toBe(1);

    const freshKey = key();

    const replay = await decoded(
      await request(book, `/correction-bundles/${bundle.id}/execute`, {
        method: "POST",
        headers: { "idempotency-key": freshKey },
        body: JSON.stringify(input),
      }),
      Corrections.CorrectionBundleReceipt,
    );

    expect(replay).toEqual(receipts[0]);
    expect(await freshCommandCount(book, freshKey)).toBe(1);
    await failure(
      await request(book, `/correction-bundles/${bundle.id}/execute`, {
        method: "POST",
        headers: { "idempotency-key": freshKey },
        body: JSON.stringify({ ...input, bundleDigest: `sha256:${"0".repeat(64)}` }),
      }),
      409,
      "IdempotencyConflict",
    );
    expect(await persisted(book)).toEqual(correctedPosting);

    const bankBalance = (await ledger(book)).accounts.find(
      (account) => account.accountId === "account_bank",
    )?.balanceMinor;

    expect(bankBalance).toBe("7000");
    await saveSanitizedJourney("correction-bundle-concurrent-replay", {
      commandKey,
      freshKey,
      observedBlockedRuntimePids: waiters,
      receipts,
      replay,
      bankBalanceMinor: bankBalance,
      persisted: await persisted(book),
    });
  } finally {
    abort.abort();
    await cleanupOwned([
      () => blocker.query("ROLLBACK"),
      () => Promise.allSettled(requests),
      () => blocker.end(),
      () => observer.end(),
    ]);
  }
});

test("competing correction bundles permit one aggregate and retain the refused alternative", async () => {
  const { book, original, intent, impact, bundle, approval } = await correctionFixture();

  const alternative = await post(
    book,
    `/vouchers/${original.voucherId}/correction-bundles`,
    { ...intent, impactReview: { id: impact.id, digest: impact.digest } },
    Corrections.CorrectionBundle,
  );

  const alternativeApproval = await post(
    book,
    `/correction-bundles/${alternative.id}/approvals`,
    { version: 1, bundleDigest: alternative.bundleDigest },
    Corrections.CorrectionBundleApproval,
  );

  const candidates = [
    { bundle, approval, commandKey: key() },
    { bundle: alternative, approval: alternativeApproval, commandKey: key() },
  ];

  expect(await persisted(book)).toEqual(onePosting);
  expect(
    (await ledger(book)).accounts.find((account) => account.accountId === "account_bank")
      ?.balanceMinor,
  ).toBe("12500");
  const blocker = await database();
  const observer = await database();
  const abort = new AbortController();
  let requests: Array<Promise<Response>> = [];

  try {
    await blocker.query("BEGIN");
    await blocker.query("SELECT id FROM openerp.books WHERE id=$1 FOR UPDATE", [book.bookId]);

    const pid = (await blocker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]
      ?.pid;

    if (pid === undefined) throw new Error("No blocker PID");
    requests = candidates.map((candidate) =>
      request(book, `/correction-bundles/${candidate.bundle.id}/execute`, {
        method: "POST",
        headers: { "idempotency-key": candidate.commandKey },
        body: JSON.stringify({
          version: 1,
          bundleDigest: candidate.bundle.bundleDigest,
          approvalId: candidate.approval.id,
        }),
        signal: abort.signal,
      }),
    );
    const settled = Promise.allSettled(requests);
    const waiters = await waitForBlockedExecutors(observer, pid, 2);
    await blocker.query("COMMIT");
    const responses = await Promise.all(requests);
    await settled;
    expect(
      responses.map((response) => response.status).sort((left, right) => left - right),
    ).toEqual([200, 409]);
    const outcomes = [];

    for (const [index, response] of responses.entries()) {
      const candidate = candidates[index];

      if (!candidate) throw new Error("Missing correction candidate");

      if (response.status === 200) {
        const receipt = await decoded(response, Corrections.CorrectionBundleReceipt);
        expect(receipt.bundleId).toBe(candidate.bundle.id);
        expect(receipt.originalVoucherId).toBe(original.voucherId);
        expect(await freshCommandCount(book, candidate.commandKey)).toBe(1);
        outcomes.push({ bundleId: candidate.bundle.id, receipt });
      } else {
        await failure(response, 409, "StaleDependency");
        expect(await freshCommandCount(book, candidate.commandKey)).toBe(0);

        const view = await decoded(
          await request(book, `/correction-bundles/${candidate.bundle.id}`),
          Corrections.CorrectionBundleView,
        );

        expect(view.receipt).toBeNull();
        expect(view.approval).toEqual(candidate.approval);
        outcomes.push({ bundleId: candidate.bundle.id, refusal: "StaleDependency", view });
      }
    }

    expect(await persisted(book)).toEqual(correctedPosting);

    const chain = await decoded(
      await request(book, `/vouchers/${original.voucherId}/correction-chain`),
      Corrections.CorrectionChain,
    );

    expect(chain.receipts).toHaveLength(1);
    expect(chain.vouchers).toHaveLength(3);
    expect(
      chain.balances.find((account) => account.accountId === "account_bank")?.balanceMinor,
    ).toBe("7000");
    await saveSanitizedJourney("correction-bundle-competing-alternatives", {
      observedBlockedRuntimePids: waiters,
      outcomes,
      chain,
      persisted: await persisted(book),
    });
  } finally {
    abort.abort();
    await cleanupOwned([
      () => blocker.query("ROLLBACK"),
      () => Promise.allSettled(requests),
      () => blocker.end(),
      () => observer.end(),
    ]);
  }
});

test("revoked correction approver membership refuses authorized agent execution without effects", async () => {
  const { book, bundle, approval } = await correctionFixture();
  const before = await persisted(book);
  const beforeRows = await rawVoucherRows(book);
  expect(before).toEqual(onePosting);
  expect(
    (await ledger(book)).accounts.find((account) => account.accountId === "account_bank")
      ?.balanceMinor,
  ).toBe("12500");
  const admin = await database();

  try {
    const deleted = await admin.query(
      "DELETE FROM openerp.memberships WHERE book_id=$1 AND actor_id=$2",
      [book.bookId, book.actorId],
    );

    expect(deleted.rowCount).toBe(1);
  } finally {
    await admin.end();
  }

  const agent = { ...book, token: book.agentToken };
  const commandKey = key();
  await failure(
    await request(agent, `/correction-bundles/${bundle.id}/execute`, {
      method: "POST",
      headers: { "idempotency-key": commandKey },
      body: JSON.stringify({
        version: 1,
        bundleDigest: bundle.bundleDigest,
        approvalId: approval.id,
      }),
    }),
    403,
    "ApprovalRequired",
  );
  expect(await persisted(book)).toEqual(before);
  expect(await rawVoucherRows(book)).toEqual(beforeRows);
  expect(await freshCommandCount(book, commandKey)).toBe(0);

  const view = await decoded(
    await request(agent, `/correction-bundles/${bundle.id}`),
    Corrections.CorrectionBundleView,
  );

  expect(view.approval).toBeNull();
  expect(view.receipt).toBeNull();
  expect(
    (await ledger(agent)).accounts.find((account) => account.accountId === "account_bank")
      ?.balanceMinor,
  ).toBe("12500");
  await saveSanitizedJourney("correction-bundle-revoked-membership", {
    before,
    beforeRows,
    commandKey,
    refusal: "ApprovalRequired",
    view,
    persisted: await persisted(book),
    rows: await rawVoucherRows(book),
  });
});

test("new related report stales correction review and fresh correction preserves historical report", async () => {
  const { book, original, intent, impact, bundle, approval } = await correctionFixture();
  const before = await persisted(book);
  const beforeRows = await rawVoucherRows(book);
  expect(before).toEqual(onePosting);
  const reportInput = { kind: "trial_balance_v1", startsOn: "2026-01-01", endsOn: "2026-12-31" };

  const historicalReport = await post(
    book,
    "/report-snapshots",
    reportInput,
    Reports.ReportSnapshot,
  );

  const historicalLines = await decoded(
    await request(book, `/report-snapshots/${historicalReport.id}/lines`),
    Reports.ReportLines,
  );

  expect(historicalReport.sequence).toBe("1");
  expect(
    historicalLines.items.find((line) => line.accountId === "account_bank")?.closingMinor,
  ).toBe("12500");

  const staleImpact = await decoded(
    await request(book, `/correction-impact-reviews/${impact.id}`),
    Corrections.CorrectionImpactView,
  );

  expect(staleImpact.impact).toEqual(impact);
  expect(staleImpact.snapshotCurrent).toBe(false);
  const commandKey = key();
  await failure(
    await request(book, `/correction-bundles/${bundle.id}/execute`, {
      method: "POST",
      headers: { "idempotency-key": commandKey },
      body: JSON.stringify({
        version: 1,
        bundleDigest: bundle.bundleDigest,
        approvalId: approval.id,
      }),
    }),
    409,
    "StaleDependency",
  );
  expect(await persisted(book)).toEqual(before);
  expect(await rawVoucherRows(book)).toEqual(beforeRows);
  expect(await freshCommandCount(book, commandKey)).toBe(0);

  const currentImpact = await post(
    book,
    `/vouchers/${original.voucherId}/correction-impact-reviews`,
    intent,
    Corrections.CorrectionImpact,
  );

  expect(currentImpact.basis.blockers).toEqual([]);
  expect(
    currentImpact.basis.resources.find((resource) => resource.id === historicalReport.id),
  ).toMatchObject({ kind: "report", blocks: false });

  const currentBundle = await post(
    book,
    `/vouchers/${original.voucherId}/correction-bundles`,
    { ...intent, impactReview: { id: currentImpact.id, digest: currentImpact.digest } },
    Corrections.CorrectionBundle,
  );

  const currentApproval = await post(
    book,
    `/correction-bundles/${currentBundle.id}/approvals`,
    { version: 1, bundleDigest: currentBundle.bundleDigest },
    Corrections.CorrectionBundleApproval,
  );

  const receipt = await post(
    book,
    `/correction-bundles/${currentBundle.id}/execute`,
    { version: 1, bundleDigest: currentBundle.bundleDigest, approvalId: currentApproval.id },
    Corrections.CorrectionBundleReceipt,
  );

  expect(await persisted(book)).toEqual(correctedPosting);
  expect(
    await decoded(
      await request(book, `/report-snapshots/${historicalReport.id}`),
      Reports.ReportSnapshot,
    ),
  ).toEqual(historicalReport);
  expect(
    await decoded(
      await request(book, `/report-snapshots/${historicalReport.id}/lines`),
      Reports.ReportLines,
    ),
  ).toEqual(historicalLines);
  const currentReport = await post(book, "/report-snapshots", reportInput, Reports.ReportSnapshot);

  const currentLines = await decoded(
    await request(book, `/report-snapshots/${currentReport.id}/lines`),
    Reports.ReportLines,
  );

  expect(currentReport.sequence).toBe("3");
  expect(currentLines.items.find((line) => line.accountId === "account_bank")?.closingMinor).toBe(
    "7000",
  );
  await saveSanitizedJourney("correction-bundle-related-report", {
    before,
    historicalReport,
    historicalLines,
    staleImpact,
    currentImpact,
    receipt,
    currentReport,
    currentLines,
    persisted: await persisted(book),
  });
});
