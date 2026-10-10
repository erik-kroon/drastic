import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import * as Acceptance from "@open-erp/contracts/supplier-acceptance";
import * as Drafts from "@open-erp/contracts/supplier-invoice-drafts";
import { createDraft, supplierFixture } from "./support/supplier-review";
import {
  createSession,
  decoded,
  environment,
  failure,
  key,
  persisted,
  post,
  request,
} from "./support/fixtures";

// Failure contract (ordinary supplier acceptance; mandates stay disabled):
// review or approval posts a journal; a revised source amount can execute under
// old approval; fresh exact approval posts twice or replay creates another voucher.
test("supplier draft amount revision refuses old approval before one exact posting and replay", async () => {
  const setup = await supplierFixture();
  const book = { ...setup.book, token: (await createSession(setup.book)).token };
  const before = await persisted(book);
  const draft = await createDraft(book, setup.content);

  if (!before) throw new Error("Missing baseline book");

  const reviewInput = (revision: typeof Drafts.SupplierInvoiceDraftRevision.Type) => ({
    profile: "synthetic-manual-supplier-v1" as const,
    draftId: revision.id,
    expectedRevision: revision.revision,
    expectedDigest: revision.digest,
    controlAccountId: "account_clearing",
    debitAccountId: "account_bank",
    accountingPeriodId: "period_2026",
    series: "A",
    reason: "Synthetic exact supplier approval proof",
    acknowledgeSyntheticOnly: true as const,
  });

  const first = await post(
    book,
    "/commerce/supplier-acceptance-reviews",
    reviewInput(draft),
    Acceptance.SupplierAcceptanceReview,
  );

  const firstApprovalInput = {
    version: 1,
    digest: first.digest,
    acknowledgeSyntheticOnly: true,
  } as const;

  const firstApproval = await post(
    book,
    `/commerce/supplier-acceptance-reviews/${first.id}/approvals`,
    firstApprovalInput,
    Acceptance.SupplierAcceptanceApproval,
  );

  const afterApproval = await persisted(book);

  expect(afterApproval).toEqual(before);

  const amount = "12000";

  const revised = await post(
    book,
    `/commerce/supplier-invoice-drafts/${draft.id}/revisions`,
    {
      expectedRevision: draft.revision,
      expectedDigest: draft.digest,
      reason: "Correct retained supplier amount before acceptance",
      content: {
        ...setup.content,
        sourceTotalMinor: amount,
        lines: setup.content.lines.map((line) => ({
          ...line,
          unitPriceMinor: amount,
          baseMinor: amount,
          sourceGrossMinor: amount,
        })),
      },
    },
    Drafts.SupplierInvoiceDraftRevision,
  );

  expect(revised.totals.grossMinor).toBe(amount);

  const refused = await request(book, `/commerce/supplier-acceptance-reviews/${first.id}/execute`, {
    method: "POST",
    body: JSON.stringify({ ...firstApprovalInput, approvalId: firstApproval.id }),
  });

  await failure(refused, 409, "StaleDependency");
  const afterRefusal = await persisted(book);

  expect(afterRefusal).toEqual(before);

  const current = await post(
    book,
    "/commerce/supplier-acceptance-reviews",
    reviewInput(revised),
    Acceptance.SupplierAcceptanceReview,
  );

  const approvalInput = {
    version: 1,
    digest: current.digest,
    acknowledgeSyntheticOnly: true,
  } as const;

  const approval = await post(
    book,
    `/commerce/supplier-acceptance-reviews/${current.id}/approvals`,
    approvalInput,
    Acceptance.SupplierAcceptanceApproval,
  );

  expect(await persisted(book)).toEqual(before);

  const executionPath = `/commerce/supplier-acceptance-reviews/${current.id}/execute`;
  const executionBody = JSON.stringify({ ...approvalInput, approvalId: approval.id });
  const idempotencyKey = key();

  const accepted = await decoded(
    await request(book, executionPath, {
      method: "POST",
      headers: { "idempotency-key": idempotencyKey },
      body: executionBody,
    }),
    Acceptance.SupplierAcceptanceReceipt,
  );

  const afterPosting = await persisted(book);

  if (!afterPosting) throw new Error("Missing posted book");

  expect(Number(afterPosting.sequence) - Number(before.sequence)).toBe(1);
  expect(afterPosting.vouchers - before.vouchers).toBe(1);
  expect(afterPosting.receipts - before.receipts).toBe(1);
  expect(afterPosting.lines - before.lines).toBe(2);
  expect(accepted.postingReceipt.voucherId).toBeTruthy();

  const replay = await decoded(
    await request(book, executionPath, {
      method: "POST",
      headers: { "idempotency-key": idempotencyKey },
      body: executionBody,
    }),
    Acceptance.SupplierAcceptanceReceipt,
  );

  expect(replay).toEqual(accepted);
  expect(await persisted(book)).toEqual(afterPosting);
  await writeFile(
    join(environment().artifacts, "supplier-approval-proof.json"),
    JSON.stringify(
      {
        syntheticOnly: true,
        draftId: draft.id,
        originalReviewId: first.id,
        rejectedApprovalId: firstApproval.id,
        revisedDraftDigest: revised.digest,
        refused: { status: refused.status, code: "StaleDependency" },
        acceptedReviewId: current.id,
        acceptedApprovalId: approval.id,
        postingReceiptId: accepted.postingReceipt.id,
        voucherId: accepted.postingReceipt.voucherId,
        replayReceiptId: replay.id,
        before,
        afterApproval,
        afterRefusal,
        afterPosting,
      },
      null,
      2,
    ),
  );
});
