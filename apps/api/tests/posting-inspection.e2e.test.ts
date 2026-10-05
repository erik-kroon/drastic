import { createHash } from "node:crypto";
import { expect, test } from "vitest";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Recovery from "@open-erp/contracts/posting-recovery";
import {
  approve,
  database,
  decoded,
  emptyPosting,
  evidence,
  execution,
  failure,
  fixture,
  journal,
  key,
  ledger,
  persisted,
  request,
} from "./support/fixtures";
import { saveSanitizedJourney } from "./assurance/database-support";

test("retained inspection links exact Unicode evidence, period, authority and one receipt", async () => {
  const book = await fixture();
  const source = await evidence(book);

  const original = await decoded(
    await request(book, `/evidence/${source.id}`),
    Accounting.EvidenceContent,
  );

  const expectedContent = "Återföring: räksmörgås, 125,00 SEK. Synthetic only.";

  expect(original.content).toBe(expectedContent);
  expect(original.sha256).toBe(createHash("sha256").update(expectedContent, "utf8").digest("hex"));

  const input = journal(source.id, "9007199254740993");

  const plan = await decoded(
    await request(book, "/change-sets", {
      method: "POST",
      body: JSON.stringify(input),
    }),
    Accounting.ChangeSet,
  );

  const review = await decoded(
    await request(book, `/posting-recovery/${plan.id}`),
    Recovery.PostingRecovery,
  );

  const action = plan.groups[0]?.actions[0];

  if (!action) throw new Error("Prepared proposal has no retained action");

  expect(action.accountingPeriodId).toBe("period_2026");
  expect(action.postingDate).toBe("2026-09-22");
  expect(action.evidenceRefs).toContainEqual({
    evidenceId: source.id,
    sha256: source.sha256,
    locator: input.eventKey,
  });
  expect(
    action.lines.map(({ accountId, debitMinor, creditMinor, description }) => ({
      accountId,
      debitMinor,
      creditMinor,
      description,
    })),
  ).toEqual(input.lines);
  expect(review.plan).toEqual(plan);
  expect(review.validation.status).toBe("current");
  expect(await persisted(book)).toEqual(emptyPosting);

  const approval = await approve(book, plan);
  const commandKey = key();

  const command = {
    method: "POST",
    headers: { "idempotency-key": commandKey },
    body: JSON.stringify(execution(plan, approval)),
  };

  const receipt = await decoded(
    await request(book, `/change-sets/${plan.id}/execute`, command),
    Accounting.ExecutionReceipt,
  );

  const recovered = await decoded(
    await request(book, `/posting-recovery/${plan.id}`),
    Recovery.PostingRecovery,
  );

  const voucher = await decoded(
    await request(book, `/vouchers/${receipt.voucherId}`),
    Accounting.Voucher,
  );

  expect(voucher.action).toEqual(action);
  expect(recovered.summary.executionReceipt).toEqual(receipt);
  expect(recovered.plan).toEqual(plan);
  expect(recovered.approvalConsumptions).toHaveLength(1);
  expect(recovered.approvalConsumptions[0]).toMatchObject({
    approvalId: approval.id,
    receiptId: receipt.id,
    approverBasis: { actorId: book.actorId },
    executorBasis: { actorId: book.actorId },
  });
  expect(
    await decoded(await request(book, `/receipts/${commandKey}`), Accounting.ExecutionReceipt),
  ).toEqual(receipt);
  const after = await ledger(book);

  expect(
    await decoded(
      await request(book, `/change-sets/${plan.id}/execute`, command),
      Accounting.ExecutionReceipt,
    ),
  ).toEqual(receipt);
  expect(await ledger(book)).toEqual(after);
  expect(
    await decoded(await request(book, `/evidence/${source.id}`), Accounting.EvidenceContent),
  ).toEqual(original);
  await saveSanitizedJourney("inspection-exact-linked-receipt", {
    original,
    plan,
    review,
    approval,
    receipt,
    recovered,
    voucher,
    after,
  });
});

test("stale dependency inspection preserves the sealed plan and original evidence without effects", async () => {
  const book = await fixture();
  const source = await evidence(book);

  const plan = await decoded(
    await request(book, "/change-sets", {
      method: "POST",
      body: JSON.stringify(journal(source.id)),
    }),
    Accounting.ChangeSet,
  );

  const approval = await approve(book, plan);

  const original = await decoded(
    await request(book, `/evidence/${source.id}`),
    Accounting.EvidenceContent,
  );

  const admin = await database();

  try {
    await admin.query(
      "UPDATE openerp.accounts SET version = version + 1 WHERE book_id = $1 AND id = 'account_bank'",
      [book.bookId],
    );
  } finally {
    await admin.end();
  }

  const observed = await decoded(
    await request(book, `/posting-recovery/${plan.id}`),
    Recovery.PostingRecovery,
  );

  expect(observed.plan).toEqual(plan);
  expect(observed.validation).toMatchObject({
    status: "blocked",
    blocker: { code: "StaleDependency" },
  });
  await failure(
    await request(book, `/change-sets/${plan.id}/execute`, {
      method: "POST",
      body: JSON.stringify(execution(plan, approval)),
    }),
    409,
    "StaleDependency",
  );
  expect(await persisted(book)).toEqual(emptyPosting);
  expect(
    await decoded(await request(book, `/evidence/${source.id}`), Accounting.EvidenceContent),
  ).toEqual(original);
  expect(
    await decoded(await request(book, `/change-sets/${plan.id}`), Accounting.ChangeSet),
  ).toEqual(plan);
  await saveSanitizedJourney("inspection-stale-retained-plan", {
    original,
    plan,
    observed,
    persisted: await persisted(book),
  });
});
