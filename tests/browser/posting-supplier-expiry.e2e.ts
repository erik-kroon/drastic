import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as Schema from "effect/Schema";
import * as Accounting from "../../packages/contracts/src/accounting";
import * as Acceptance from "../../packages/contracts/src/supplier-acceptance";
import * as Recovery from "../../packages/contracts/src/posting-recovery";
import * as Workspace from "../../packages/contracts/src/workspace";
import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import { signInSyntheticOperator } from "./synthetic-session";

const ExpiryFixture = Schema.Struct({
  synthetic: Schema.Literal(true),
  scope: Accounting.Scope,
  draftId: Accounting.Identifier,
  reviewId: Accounting.Identifier,
  postingPlanId: Accounting.Identifier,
  approvalId: Accounting.Identifier,
  digest: Accounting.Digest,
  expectedGrossMinor: Schema.Literal("249000"),
  approvalCreatedAt: Schema.String,
  approvalExpiresAt: Schema.String,
  historicalApprovalFixture: Schema.Literal(true),
  posted: Schema.Literal(false),
  route: Schema.String,
  purchaseRoute: Schema.String,
});

test("native supplier expiry renews unchanged approval and recovers one posting receipt", async ({
  app,
  browser,
  screen,
  agent,
}) => {
  const output = process.env.OPENERP_E2E_OUTPUT;

  if (!output) throw new Error("Run the fresh browser launcher with PAPER_SUPPLIER_EXPIRY=1");

  const fixture = Schema.decodeSync(Schema.fromJsonString(ExpiryFixture))(
    await readFile(join(output, "runtime", "supplier-expiry-seed.json"), "utf8"),
  );

  const workspace = await signInSyntheticOperator(browser, app.baseUrl);
  const origin = new URL(workspace).origin;
  const base = workspace.replace(origin, `${origin}/api/v1`);

  const cookie = (await browser.cookies())
    .map((entry) => `${entry.name}=${entry.value}`)
    .join("; ");

  expect(fixture.scope).toEqual({ entityId: "entity_synthetic", bookId: "book_synthetic" });
  expect(`${origin}${fixture.route}`).toBe(`${workspace}/`);
  expect(Date.parse(fixture.approvalExpiresAt) - Date.parse(fixture.approvalCreatedAt)).toBe(
    3600000,
  );

  const call = async <S extends Schema.Top & { readonly DecodingServices: never }>(
    path: string,
    schema: S,
    body?: unknown,
    key: string = crypto.randomUUID(),
  ): Promise<S["Type"]> => {
    const response = await fetch(`${base}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { cookie, origin, "content-type": "application/json", "idempotency-key": key },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });

    const responseBody = await response.text();

    expect(response.status).toBe(200);

    return Schema.decodeSync(Schema.fromJsonString(schema))(responseBody);
  };

  const reviewPath = `/commerce/supplier-acceptance-reviews/${fixture.reviewId}`;
  const before = await call("/ledger", Accounting.LedgerSnapshot);
  const expired = await call(reviewPath, Acceptance.SupplierAcceptanceView);

  expect(expired.plan.id).toBe(fixture.reviewId);
  expect(expired.plan.digest).toBe(fixture.digest);
  expect(expired.plan.postingPlan.id).toBe(fixture.postingPlanId);
  expect(expired.approval?.id).toBe(fixture.approvalId);
  expect(expired.approvalObservation.state).toBe("expired");
  expect(expired.dependenciesCurrent).toBe(true);
  expect(expired.approvalUsable).toBe(false);
  expect(expired.acceptance).toBeNull();

  const rejected = await fetch(`${base}${reviewPath}/execute`, {
    method: "POST",
    headers: {
      cookie,
      origin,
      "content-type": "application/json",
      "idempotency-key": crypto.randomUUID(),
    },
    body: JSON.stringify({
      version: 1,
      digest: fixture.digest,
      approvalId: fixture.approvalId,
      acknowledgeSyntheticOnly: true,
    }),
    signal: AbortSignal.timeout(20000),
  });

  const refusal = Schema.decodeSync(
    Schema.fromJsonString(Schema.Struct({ code: Schema.Literal("ApprovalRequired") })),
  )(await rejected.text());

  expect(rejected.status).toBe(403);
  expect(await call("/ledger", Accounting.LedgerSnapshot)).toEqual(before);
  expect((await call(reviewPath, Acceptance.SupplierAcceptanceView)).acceptance).toBeNull();

  const queue = await call("/attention?status=open&sort=oldest", Workspace.AttentionPage);

  const item = queue.items.find(
    (candidate) => candidate.supplierReview?.reviewId === fixture.reviewId,
  );

  if (!item?.supplierReview)
    throw new Error("Native expired supplier proposal is missing from daily work");

  expect(item.supplierReview.digest).toBe(fixture.digest);
  expect(item.supplierReview.approvalObservation.state).toBe("expired");
  expect(item.supplierReview.approvalExpiresAt).toBe(fixture.approvalExpiresAt);
  expect(item.supplierReview.dependenciesCurrent).toBe(true);

  await app.open(`${origin}${fixture.route}`);

  const row = screen.getByRole("button", /^Vinter & Co AB, faktura 882/);

  await expect(row).toContainText("Gick ut 15:05");
  await row.focus();
  await row.press("Enter");

  const pane = screen.getByRole("region", "Godkännandet");
  const renew = pane.getByRole("button", "Godkänn igen", { exact: true });
  const disabledPost = pane.getByRole("button", "Bokför", { exact: true });

  await expect(pane).toContainText("Oförändrat");
  await expect(pane).toContainText("Godkänt av Elin Sund");
  await expect(pane).toContainText("15:05, utgånget");
  await expect(disabledPost).toBeDisabled();
  await expect(renew).toBeEnabled();

  const expiredScreenshot = await app.screenshot("supplier-native-expiry-unchanged-proposal");

  await agent.assert(
    "The selected Vinter supplier proposal says its approval expired, the proposal is unchanged, Godkänn igen is available and Bokför is disabled. Return only the configured JSON judgment. Do not infer any posting or provider outcome.",
    { timeout: 30000 },
  );
  await expect(disabledPost).toBeDisabled();
  await renew.focus();
  await renew.press("Enter");
  await expect
    .poll(async () => (await call(reviewPath, Acceptance.SupplierAcceptanceView)).approval?.ordinal)
    .toBe(2);

  const renewed = await call(reviewPath, Acceptance.SupplierAcceptanceView);

  if (!renewed.approval) throw new Error("Keyboard renewal did not retain a native approval");

  expect(renewed.plan).toEqual(expired.plan);
  expect(renewed.approval.id === fixture.approvalId).toBe(false);
  expect(renewed.approval.digest).toBe(fixture.digest);
  expect(renewed.approvalObservation.state).toBe("available");
  expect(renewed.approvalUsable).toBe(true);
  expect(renewed.acceptance).toBeNull();
  expect(await call("/ledger", Accounting.LedgerSnapshot)).toEqual(before);

  const renewedQueue = await call("/attention?status=open&sort=oldest", Workspace.AttentionPage);

  expect(
    renewedQueue.items.find((candidate) => candidate.supplierReview?.reviewId === fixture.reviewId)
      ?.supplierReview?.approvalObservation.state,
  ).toBe("available");
  await app.open(`${origin}${fixture.purchaseRoute}`);

  const acknowledgment = screen.getByRole(
    "checkbox",
    "Jag förstår att detta bokför förslaget utan att fastställa momsbehandling.",
  );

  const execute = screen.getByRole("button", "Bokför och registrera", { exact: true });

  await expect(execute).toBeVisible();
  await acknowledgment.focus();
  await acknowledgment.press("Space");
  await expect(acknowledgment).toBeChecked();

  const renewedApprovalId = renewed.approval.id;

  let committed: typeof Acceptance.SupplierAcceptanceReceipt.Type | undefined;
  let executionInput: typeof Acceptance.ExecuteSupplierAcceptance.Type | undefined;
  let executionKey = "";
  const executionPath = `${base}${reviewPath}/execute`;

  await browser.route(executionPath, async (route) => {
    try {
      executionKey = route.request.headers["idempotency-key"] ?? "";
      executionInput = Schema.decodeSync(
        Schema.fromJsonString(Acceptance.ExecuteSupplierAcceptance),
      )(route.request.postData ?? "");

      expect(executionKey).toMatch(/^[a-zA-Z0-9_-]{8,128}$/);
      expect(executionInput.approvalId).toBe(renewedApprovalId);

      const response = await fetch(route.request.url, {
        method: route.request.method,
        headers: { ...route.request.headers, cookie, origin },
        body: route.request.postData ?? undefined,
        signal: AbortSignal.timeout(20000),
      });

      const responseBody = await response.text();

      expect(response.status).toBe(200);
      committed = Schema.decodeSync(Schema.fromJsonString(Acceptance.SupplierAcceptanceReceipt))(
        responseBody,
      );
    } finally {
      await route.abort();
    }
  });
  await execute.focus();
  await execute.press("Enter");
  await expect.poll(() => committed?.reviewId).toBe(fixture.reviewId);
  await browser.unroute(executionPath);

  if (!committed || !executionInput)
    throw new Error("Native aggregate execution did not retain its response and original command");

  const receipt = committed;
  const after = await call("/ledger", Accounting.LedgerSnapshot);
  const voucher = await call(`/vouchers/${receipt.postingReceipt.voucherId}`, Accounting.Voucher);

  const authority = await call(
    `/posting-recovery/${fixture.postingPlanId}`,
    Recovery.PostingRecovery,
  );

  const consumption = authority.approvalConsumptions[0];

  if (!consumption)
    throw new Error("Supplier execution did not retain approval consumption evidence");

  expect(consumption.approverBasis.actorId).toBe(renewed.approval.actorId);
  expect(consumption.approverBasis.permission).toBe("approve_change");
  expect(consumption.approverBasis.policy).toBe("generic-posting-authority-v1");

  if (authority.approvalObservation.state !== "consumed")
    throw new Error("Native approval was not retained as consumed by the posting owner");

  expect(authority.approvalObservation.approval.id).toBe(renewed.approval.id);
  expect(Date.parse(authority.approvalObservation.approval.expiresAt)).toBe(
    Date.parse(renewed.approval.expiresAt),
  );
  expect(
    Date.parse(authority.approvalObservation.basis.checkedAt) <=
      Date.parse(renewed.approvalObservation.observedAt),
  ).toBe(true);
  expect(
    Date.parse(consumption.executorBasis.checkedAt) >=
      Date.parse(renewed.approvalObservation.observedAt),
  ).toBe(true);

  expect(receipt.reviewDigest).toBe(fixture.digest);
  expect(receipt.approvalId).toBe(renewed.approval.id);
  expect(receipt.paid).toBe(false);
  expect(BigInt(after.sequence) - BigInt(before.sequence)).toBe(1n);
  expect(
    BigInt(
      after.accounts.find((account) => account.accountId === "expiry_consulting")?.balanceMinor ??
        "0",
    ) -
      BigInt(
        before.accounts.find((account) => account.accountId === "expiry_consulting")
          ?.balanceMinor ?? "0",
      ),
  ).toBe(249000n);
  expect(
    BigInt(
      after.accounts.find((account) => account.accountId === "expiry_payable")?.balanceMinor ?? "0",
    ) -
      BigInt(
        before.accounts.find((account) => account.accountId === "expiry_payable")?.balanceMinor ??
          "0",
      ),
  ).toBe(-249000n);

  await browser.evaluate("() => localStorage.clear()");
  await browser.reload();
  await expect(screen.getByRole("link", "Visa verifikation", { exact: true })).toBeVisible();
  await expect(screen.getByRole("button", "Bokför och registrera", { exact: true })).toHaveCount(0);

  const recovered = await call(reviewPath, Acceptance.SupplierAcceptanceView);

  const replayed = await call(
    `${reviewPath}/execute`,
    Acceptance.SupplierAcceptanceReceipt,
    executionInput,
    executionKey,
  );

  expect(recovered.approvalObservation.state).toBe("consumed");
  expect(recovered.acceptance).toEqual(receipt);
  expect(replayed).toEqual(receipt);
  expect(await call("/ledger", Accounting.LedgerSnapshot)).toEqual(after);
  expect(await call(`/vouchers/${receipt.postingReceipt.voucherId}`, Accounting.Voucher)).toEqual(
    voucher,
  );

  const recoveredScreenshot = await app.screenshot(
    "supplier-original-receipt-after-lost-response-and-replay",
  );

  await writeFile(
    join(output, "posting-supplier-expiry-journey.json"),
    JSON.stringify(
      {
        synthetic: true,
        fixture,
        refusal,
        queueItem: item,
        expired,
        renewed,
        executionKey,
        executionInput,
        receipt,
        recoveredAcceptance: recovered.acceptance,
        replayed,
        before,
        after,
        voucher,
        approvalConsumption: consumption,
        originalApprovalObservation: authority.approvalObservation,
        expected: {
          ledgerIncrement: "1",
          expenseDeltaMinor: "249000",
          payableDeltaMinor: "-249000",
          paid: false,
        },
        screenshots: { expiredScreenshot, recoveredScreenshot },
      },
      null,
      2,
    ),
  );
});
