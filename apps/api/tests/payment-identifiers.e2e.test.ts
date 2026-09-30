import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import * as Schema from "effect/Schema";
import * as Identifiers from "@open-erp/contracts/payment-identifiers";
import { environment, fixture, persisted, request } from "./support/fixtures";
import { withWorkspaceBrowser } from "./support/workspace-browser";

const Observation = Identifiers.PaymentIdentifierView;

// Independent R1 arithmetic: 123456 -> weighted sum 24 -> digit 6;
// 1234567 -> sum 26 -> digit 4; 00012 -> sum 5 -> digit 5.
test("PRY-16 serves giro and OCR checks without financial effects and matches MCP", async () => {
  const book = await fixture();
  const before = await persisted(book);

  const vectors = [
    { kind: "check_digit", value: "123456", status: "generated", output: "6" },
    { kind: "bankgiro", value: "123-4566", status: "valid", output: "123-4566" },
    { kind: "bankgiro", value: "12345674", status: "valid", output: "1234-5674" },
    { kind: "bankgiro", value: "123-4567", status: "invalid", output: "123-4567" },
    { kind: "bankgiro", value: "1234", status: "invalid", output: "1234" },
    { kind: "bankgiro", value: "123a4566", status: "invalid", output: "123a4566" },
    { kind: "bankgiro", value: "-1234566", status: "invalid", output: "-1234566" },
    { kind: "bankgiro", value: "123--4566", status: "invalid", output: "123--4566" },
    { kind: "plusgiro", value: "18", status: "valid", output: "1-8" },
    { kind: "plusgiro", value: "1234566", status: "valid", output: "123456-6" },
    { kind: "plusgiro", value: "12345674", status: "valid", output: "1234567-4" },
    { kind: "plusgiro", value: "19", status: "invalid", output: "19" },
    { kind: "ocr", value: "000125", status: "valid", output: "000125" },
    { kind: "ocr", value: "18", status: "valid", output: "18" },
    { kind: "ocr", value: `1${"0".repeat(23)}9`, status: "valid", output: `1${"0".repeat(23)}9` },
    { kind: "ocr", value: "000126", status: "invalid", output: "000126" },
    { kind: "generate_ocr", value: "Invoice-00012", status: "generated", output: "000125" },
    {
      kind: "generate_ocr",
      value: `1${"0".repeat(23)}`,
      status: "generated",
      output: `1${"0".repeat(23)}9`,
    },
    { kind: "generate_ocr", value: "No digits", status: "unsupported", output: "No digits" },
    { kind: "generate_ocr", value: "1".repeat(25), status: "unsupported", output: "1".repeat(25) },
    { kind: "ocr", value: "1".repeat(26), status: "invalid", output: "1".repeat(26) },
    { kind: "check_digit", value: "１２３", status: "unsupported", output: "１２３" },
  ];

  const results = [];

  for (const vector of vectors) {
    const response = await request(book, "/commerce/payment-identifiers", {
      method: "POST",
      body: JSON.stringify({ kind: vector.kind, value: vector.value }),
    });

    expect(response.status).toBe(200);
    const observed = Schema.decodeUnknownSync(Observation)(await response.json());
    expect(observed.result.status, vector.value).toBe(vector.status);
    expect(observed.result.output, vector.value).toBe(vector.output);
    expect(observed.result.input).toBe(vector.value);
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
        name: "payments_check_identifier",
        arguments: {
          scope: { entityId: book.entityId, bookId: book.bookId },
          input: { kind: "bankgiro", value: "123-4566" },
        },
      },
    }),
  });

  expect(response.status).toBe(200);

  const rpc = Schema.decodeUnknownSync(
    Schema.Struct({
      result: Schema.Struct({
        isError: Schema.Literal(false),
        structuredContent: Schema.Struct({ result: Observation }),
      }),
    }),
  )(await response.json());

  expect(rpc.result.structuredContent.result).toEqual(results[1]);
  expect(await persisted(book)).toEqual(before);

  const malformed = await request(book, "/commerce/payment-identifiers", {
    method: "POST",
    body: JSON.stringify({ kind: "bankgiro", value: "1".repeat(201) }),
  });

  expect(malformed.status).toBe(400);
  await writeFile(
    join(environment().artifacts, "pry-16-payment-identifiers.json"),
    JSON.stringify({ vectors, results, mcp: rpc, noFinancialEffects: true }, null, 2),
  );
});

test("PRY-16 supplier workspace checks a giro and generates an OCR candidate through real controls", async () => {
  const book = await fixture();
  await withWorkspaceBrowser(book, "pry-16", async (page, workspace) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${workspace}/purchases?view=supplier-payment-files`);
    await page.getByText("Check giro and OCR identifiers", { exact: true }).click();
    await page.getByLabel("Number or source identifier", { exact: true }).fill("123-4566");
    const check = page.getByRole("button", { name: "Check identifier", exact: true });
    await check.focus();
    await page.keyboard.press("Enter");
    await page.getByText("Checksum valid", { exact: true }).waitFor();
    await page.getByLabel("Number or source identifier", { exact: true }).fill("123-4567");
    expect(await page.getByText("Checksum valid", { exact: true }).count()).toBe(0);
    await page.getByRole("button", { name: "Check identifier", exact: true }).click();
    await page.getByText("Invalid length, characters or check digit", { exact: true }).waitFor();
    await page.getByLabel("Identifier type", { exact: true }).click();
    await page.getByRole("option", { name: "Generate OCR candidate", exact: true }).click();
    await page.getByLabel("Number or source identifier", { exact: true }).fill("Invoice-00012");
    await page.getByRole("button", { name: "Check identifier", exact: true }).click();
    await page.getByText("000125", { exact: true }).waitFor();
    await page.screenshot({
      path: join(environment().artifacts, "pry-16-identifiers-desktop.png"),
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
      .toBe(true);
    await page.getByLabel("Number or source identifier", { exact: true }).fill("Invoice-00013");
    await page.getByRole("button", { name: "Check identifier", exact: true }).click();
    await page.getByText("000133", { exact: true }).waitFor();
    await writeFile(
      join(environment().artifacts, "pry-16-layout.json"),
      JSON.stringify(
        await page.evaluate(() => ({
          width: window.innerWidth,
          documentWidth: document.documentElement.scrollWidth,
        })),
        null,
        2,
      ),
    );
    await page.screenshot({
      path: join(environment().artifacts, "pry-16-identifiers-narrow.png"),
    });
    expect(errors).toEqual([]);
    expect((await persisted(book))?.vouchers).toBe(0);
    await writeFile(
      join(environment().artifacts, "pry-16-browser.json"),
      JSON.stringify(
        {
          keyboardCheck: true,
          narrowWidth: 390,
          desktopOcr: "000125",
          narrowOcr: "000133",
          errors,
        },
        null,
        2,
      ),
    );
  });
}, 120000);
