import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as Schema from "effect/Schema";
import * as Identifiers from "@open-erp/contracts/payment-identifiers";
import { expect, test } from "vitest";
import { environment, fixture, persisted, request } from "./support/fixtures";
import { withWorkspaceBrowser } from "./support/workspace-browser";

const View = Identifiers.BankAccountHintView;

// Independent sums: clearing 1100 + account 1 uses the last ten digits,
// whose weighted sum is 10+1=11; 4000 + account 7 uses all eleven, 4+7=11.
// A nine-digit padded account 19 has sum 1*2+9=11. The exceptions use R1.
test("PRY-17 keeps unknown distinct from invalid and uses every declared checksum family", async () => {
  const book = await fixture();
  const before = await persisted(book);

  const vectors = [
    { clearing: "1100", account: "1", status: "valid", rule: "mod11_last10" },
    { clearing: "1100", account: "2", status: "invalid", rule: "mod11_last10" },
    { clearing: "4000", account: "7", status: "valid", rule: "mod11_full" },
    { clearing: "4000", account: "8", status: "invalid", rule: "mod11_full" },
    { clearing: "6000", account: "19", status: "valid", rule: "mod11_9" },
    { clearing: "6000", account: "18", status: "invalid", rule: "mod11_9" },
    { clearing: "6000", account: "000000000", status: "invalid", rule: "mod11_9" },
    { clearing: "3300", account: "18", status: "valid", rule: "mod10_10" },
    { clearing: "3782", account: "18", status: "valid", rule: "mod10_10" },
    { clearing: "3300", account: "19", status: "invalid", rule: "mod10_10" },
    { clearing: "8000", account: "000018", status: "valid", rule: "account_clearing_mod10" },
    { clearing: "8000", account: "000019", status: "invalid", rule: "account_clearing_mod10" },
    { clearing: "80002", account: "000018", status: "valid", rule: "account_clearing_mod10" },
    { clearing: "80001", account: "000018", status: "invalid", rule: "account_clearing_mod10" },
    { clearing: "9100", account: "1", status: "unknown", rule: null },
    { clearing: "1100", account: "12345678", status: "unknown", rule: "mod11_last10" },
    { clearing: "6000", account: "1234567890", status: "unknown", rule: "mod11_9" },
    { clearing: "3300", account: "12345678901", status: "unknown", rule: "mod10_10" },
    { clearing: "8000", account: "18", status: "unknown", rule: "account_clearing_mod10" },
    { clearing: "", account: "18", status: "unknown", rule: null },
    { clearing: "abcd", account: "18", status: "unknown", rule: null },
    { clearing: "110", account: "1", status: "unknown", rule: null },
    { clearing: "800023", account: "000018", status: "unknown", rule: null },
    { clearing: "+1100", account: "1", status: "unknown", rule: null },
    { clearing: "1100", account: "1x", status: "unknown", rule: "mod11_last10" },
    { clearing: "6000", account: "", status: "unknown", rule: "mod11_9" },
    { clearing: "11001", account: "1", status: "unknown", rule: "mod11_last10" },
  ];

  const results = [];

  for (const vector of vectors) {
    const response = await request(book, "/commerce/payment-identifiers/bank-account", {
      method: "POST",
      body: JSON.stringify({
        profile: "reference_r2_v1",
        clearing: vector.clearing,
        account: vector.account,
      }),
    });

    expect(response.status).toBe(200);
    const observed = Schema.decodeUnknownSync(View)(await response.json());
    expect(observed.result.status, `${vector.clearing}/${vector.account}`).toBe(vector.status);
    expect(observed.result.rule).toBe(vector.rule);
    expect(observed.result.account).toBe(vector.account);
    results.push(observed);
  }

  const response = await fetch(`${environment().baseUrl}/api/mcp`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${book.agentToken}`,
      "content-type": "application/json",
      accept: "application/json",
      "MCP-Protocol-Version": "2025-11-25",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "payments_check_bank_account",
        arguments: {
          scope: { entityId: book.entityId, bookId: book.bookId },
          input: { profile: "reference_r2_v1", clearing: "9100", account: "1" },
        },
      },
    }),
  });

  expect(response.status).toBe(200);

  const rpc = Schema.decodeUnknownSync(
    Schema.Struct({
      result: Schema.Struct({
        isError: Schema.Literal(false),
        structuredContent: Schema.Struct({ result: View }),
      }),
    }),
  )(await response.json());

  expect(rpc.result.structuredContent.result).toEqual(
    results.find((result) => result.result.clearing === "9100" && result.result.account === "1"),
  );
  expect(await persisted(book)).toEqual(before);

  const missingProfile = await request(book, "/commerce/payment-identifiers/bank-account", {
    method: "POST",
    body: JSON.stringify({ clearing: "1100", account: "1" }),
  });

  expect(missingProfile.status).toBe(400);

  const oversized = await request(book, "/commerce/payment-identifiers/bank-account", {
    method: "POST",
    body: JSON.stringify({ profile: "reference_r2_v1", clearing: "1100", account: "1".repeat(21) }),
  });

  expect(oversized.status).toBe(400);
  await writeFile(
    join(environment().artifacts, "pry-17-bank-account-hints.json"),
    JSON.stringify({ vectors, results, mcp: rpc, noFinancialEffects: true }, null, 2),
  );
});

test("PRY-17 supplier workspace shows valid, invalid and no-opinion hints without losing prefixes", async () => {
  const book = await fixture();
  await withWorkspaceBrowser(book, "pry-17", async (page, workspace) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${workspace}/purchases?view=supplier-payment-files`);
    await page.getByText("Check clearing and account number", { exact: true }).click();
    await page.getByLabel("Clearing number", { exact: true }).fill("80002");
    await page.getByLabel("Account number", { exact: true }).fill("000018");
    const check = page.getByRole("button", { name: "Check account checksum", exact: true });
    await check.focus();
    await page.keyboard.press("Enter");
    await page.getByText("Account checksum valid (reference rules)", { exact: true }).waitFor();
    expect(await page.getByLabel("Account number", { exact: true }).inputValue()).toBe("000018");
    await page.getByLabel("Account number", { exact: true }).fill("000019");
    expect(
      await page.getByText("Account checksum valid (reference rules)", { exact: true }).count(),
    ).toBe(0);
    await check.click();
    await page.getByText("Account checksum invalid (reference rules)", { exact: true }).waitFor();
    await page.getByLabel("Clearing number", { exact: true }).fill("9100");
    await check.click();
    await page.getByText("No opinion for these details", { exact: true }).waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
      .toBe(true);
    await check.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: join(environment().artifacts, "pry-17-account-hint-narrow.png"),
    });
    expect(errors).toEqual([]);
    expect((await persisted(book))?.vouchers).toBe(0);
    await writeFile(
      join(environment().artifacts, "pry-17-browser.json"),
      JSON.stringify(
        { keyboardCheck: true, narrowWidth: 390, zeroPrefixPreserved: true, errors },
        null,
        2,
      ),
    );
  });
}, 120000);
