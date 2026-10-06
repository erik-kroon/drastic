import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import * as Acceptance from "@open-erp/contracts/supplier-acceptance";
import * as Cases from "@open-erp/contracts/cases";
import { createDraft, supplierFixture } from "./support/supplier-review";
import {
  createSession,
  decoded,
  environment,
  failure,
  fixture,
  persisted,
  post,
  prepare,
  request,
} from "./support/fixtures";

test("native supplier review resolution retains the aggregate owner and refuses generic approval", async () => {
  const setup = await supplierFixture();
  const book = { ...setup.book, token: (await createSession(setup.book)).token };
  const draft = await createDraft(book, setup.content);

  const review = await post(
    book,
    "/commerce/supplier-acceptance-reviews",
    {
      profile: "synthetic-manual-supplier-v1",
      draftId: draft.id,
      expectedRevision: draft.revision,
      expectedDigest: draft.digest,
      controlAccountId: "account_clearing",
      debitAccountId: "account_bank",
      accountingPeriodId: "period_2026",
      series: "A",
      reason: "Retained native focused review owner",
      acknowledgeSyntheticOnly: true,
    },
    Acceptance.SupplierAcceptanceReview,
  );

  const before = await persisted(book);
  const path = `/review-targets/${review.postingPlan.id}`;
  const resolved = await decoded(await request(book, path), Cases.ReviewResolution);

  expect(resolved).toMatchObject({
    kind: "supplier_acceptance",
    changeSetId: review.postingPlan.id,
    planDigest: review.postingPlan.planDigest,
    reviewId: review.id,
    reviewDigest: review.digest,
    draftId: draft.id,
  });

  expect(await decoded(await request(book, path), Cases.ReviewResolution)).toMatchObject({
    ...resolved,
    resolvedAt: expect.any(String),
  });

  await failure(
    await request(book, `/change-sets/${review.postingPlan.id}/approvals`, {
      method: "POST",
      body: JSON.stringify({ version: 1, planDigest: review.postingPlan.planDigest }),
    }),
    403,
    "ApprovalRequired",
  );

  const foreign = await fixture();
  await failure(await request(foreign, path), 404, "NotFound");
  await failure(await request(book, "/review-targets/nonexistent_review_child"), 404, "NotFound");
  expect(await persisted(book)).toEqual(before);

  await writeFile(
    join(environment().artifacts, "supplier-focused-review-owner.json"),
    JSON.stringify(
      {
        syntheticOnly: true,
        resolved,
        genericApprovalRefused: true,
        foreignScopeRefused: true,
        before,
        after: await persisted(book),
      },
      null,
      2,
    ),
  );
});

test("an ordinary posting proposal remains a standalone review target", async () => {
  const book = await fixture();
  const plan = await prepare(book);
  const before = await persisted(book);

  const resolved = await decoded(
    await request(book, `/review-targets/${plan.id}`),
    Cases.ReviewResolution,
  );

  expect(resolved).toMatchObject({
    kind: "standalone",
    changeSetId: plan.id,
    planDigest: plan.planDigest,
  });

  expect(await persisted(book)).toEqual(before);
});
