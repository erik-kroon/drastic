import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as Schema from "effect/Schema";
import * as Source from "../../packages/contracts/src/source-intake";
import * as Extraction from "../../packages/contracts/src/supplier-extraction";
import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import { compareSourceHighlight } from "../../verification/paper/document-intelligence/compare.mjs";
import { signInSyntheticOperator } from "./synthetic-session";

const Rectangle = Schema.Struct({
  x: Schema.Finite,
  y: Schema.Finite,
  width: Schema.Finite,
  height: Schema.Finite,
});

const Geometry = Schema.Struct({
  overlay: Rectangle,
  original: Rectangle,
  points: Schema.String,
  fill: Schema.String,
});

const Fixture = Schema.Struct({
  synthetic: Schema.Literal(true),
  source: Source.SourceOccurrence,
  state: Extraction.SupplierExtractionState,
  expectedNumber: Schema.String,
  expectedTotal: Schema.String,
  submissions: Schema.Literal(1),
});

test("retained source regions follow page and zoom while uncertain values require review", async ({
  app,
  browser,
  screen,
  agent,
}) => {
  const output = process.env.OPENERP_E2E_OUTPUT;

  if (!output) throw new Error("Use the disposable browser launcher");

  const fixture = Schema.decodeSync(Schema.fromJsonString(Fixture))(
    await readFile(join(output, "runtime", "document-intelligence-fixture.json"), "utf8"),
  );

  const workspace = await signInSyntheticOperator(browser, app.baseUrl);

  await app.open(`${workspace}/purchases?view=supplier-drafts&record=inbox:${fixture.source.id}`);

  const review = screen.getByRole("dialog", "Ny leverantörsfaktura");

  await expect(
    review.getByText("Total enligt fakturan: Behöver granskas", { exact: true }),
  ).toBeVisible({ timeout: 90000 });
  await expect(
    review.getByRole("button", "Använd total enligt fakturan", { exact: true }),
  ).toHaveCount(0);
  await expect(
    review.getByText(
      "Fakturadatum: En uppgift saknas i läsningen. Kontrollera och fyll i den själv.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    review.getByText(
      "Förfallodatum: En uppgift saknas i läsningen. Kontrollera och fyll i den själv.",
      { exact: true },
    ),
  ).toBeVisible();
  await review.getByRole("button", "Sida 1: “DOC-113”", { exact: true }).click();
  await expect(review.getByRole("img", "Källmarkering: DOC-113", { exact: true })).toBeVisible();
  await review.getByRole("combobox", "Zoom", { exact: true }).click();
  await screen.getByRole("option", "125 %", { exact: true }).click();
  await expect(review.getByRole("img", "Källmarkering: DOC-113", { exact: true })).toBeVisible();
  await review.getByRole("button", "Använd fakturanummer", { exact: true }).click();
  await expect(review.getByLabel("Leverantörens fakturanummer")).toHaveValue("DOC-113");

  const geometry = Schema.decodeUnknownSync(Geometry)(
    await browser.evaluate(() => {
      const svg = document.querySelector('svg[aria-label="Källmarkering: DOC-113"]');
      const canvas = svg?.parentElement?.querySelector("canvas");

      if (!svg || !canvas) throw new Error("Missing rendered source evidence");

      const overlay = svg.getBoundingClientRect();
      const original = canvas.getBoundingClientRect();

      return {
        overlay: { x: overlay.x, y: overlay.y, width: overlay.width, height: overlay.height },
        original: { x: original.x, y: original.y, width: original.width, height: original.height },
        points: svg.querySelector("polygon")?.getAttribute("points") ?? null,
        fill: getComputedStyle(svg.querySelector("polygon")!).fill,
      };
    }),
  );

  expect(geometry.overlay).toEqual(geometry.original);
  expect(geometry.fill).toBe("rgb(207, 224, 251)");
  const points = geometry.points.split(/[ ,]/u).map(Number);
  const expected = [0.1, 0.12, 98 / 300, 0.12, 98 / 300, 0.18, 0.1, 0.18];

  expect(points).toHaveLength(expected.length);

  for (const [index, point] of expected.entries()) expect(points[index]).toBeCloseTo(point, 8);

  const raster = Schema.decodeUnknownSync(Schema.String)(
    await browser.evaluate(async () => {
      const svg = document.querySelector('svg[aria-label="Källmarkering: DOC-113"]');

      if (!(svg instanceof SVGSVGElement))
        throw new Error("Missing visible selected source region");

      const bounds = svg.getBoundingClientRect();
      const clone = svg.cloneNode(true);

      if (!(clone instanceof SVGSVGElement) || bounds.width !== 375 || bounds.height !== 375)
        throw new Error("Source highlight rendering dimensions changed");

      const polygon = clone.querySelector("polygon");
      const originalPolygon = svg.querySelector("polygon");

      if (!polygon || !originalPolygon) throw new Error("Missing source polygon");

      clone.style.cssText = "";
      clone.setAttribute("width", String(bounds.width));
      clone.setAttribute("height", String(bounds.height));
      polygon.style.fill = getComputedStyle(originalPolygon).fill;
      const image = new Image();

      image.src = `data:image/svg+xml,${encodeURIComponent(new XMLSerializer().serializeToString(clone))}`;
      await image.decode();
      const canvas = document.createElement("canvas");

      canvas.width = bounds.width;
      canvas.height = bounds.height;
      const context = canvas.getContext("2d");

      if (!context) throw new Error("Missing source comparison renderer");

      context.fillStyle = "white";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0);

      return canvas.toDataURL("image/png");
    }),
  );

  if (!raster.startsWith("data:image/png;base64,"))
    throw new Error("Invalid source comparison raster");

  const parity = await compareSourceHighlight(
    Buffer.from(raster.slice("data:image/png;base64,".length), "base64"),
    output,
  );

  expect(parity.passed).toBe(true);

  const highlighted = await app.screenshot("document-intelligence-selected-source");

  await review.getByRole("combobox", "Sida", { exact: true }).click();
  await screen.getByRole("option", "2 av 2", { exact: true }).click();
  await expect(review.getByRole("img", "Källmarkering: DOC-113", { exact: true })).toHaveCount(0);
  await expect(review.getByLabel("Leverantörens fakturanummer")).toHaveValue("DOC-113");
  const otherPage = await app.screenshot("document-intelligence-other-page");

  await review.getByRole("combobox", "Sida", { exact: true }).click();
  await screen.getByRole("option", "1 av 2", { exact: true }).click();
  await expect(review.getByRole("img", "Källmarkering: DOC-113", { exact: true })).toBeVisible();
  await agent.assert(
    "The original has a pale blue source highlight for DOC-113. The invoice number is DOC-113. The extracted invoice total says Behöver granskas and has no Använd button. The reader uncertainty is explained. Do not treat the uncertain total as accepted.",
    { timeout: 30000, vision: true },
  );

  const finalScreenshot = await app.screenshot("document-intelligence-review-obligations");
  const origin = new URL(workspace).origin;

  const cookie = (await browser.cookies())
    .map((entry) => `${entry.name}=${entry.value}`)
    .join("; ");

  const response = await fetch(
    `${workspace.replace(origin, `${origin}/api/v1`)}/commerce/supplier-inbox/${fixture.source.id}/extraction`,
    {
      headers: { cookie, origin },
      signal: AbortSignal.timeout(15000),
    },
  );

  expect(response.status).toBe(200);

  const retained = Schema.decodeSync(Schema.fromJsonString(Extraction.SupplierExtractionState))(
    await response.text(),
  );

  expect(retained.attempt).toEqual(fixture.state.attempt);
  expect(retained.requests).toEqual(fixture.state.requests);
  expect(retained.fieldDecisions).toEqual(fixture.state.fieldDecisions);
  await writeFile(
    join(output, "document-intelligence-browser.json"),
    JSON.stringify(
      {
        synthetic: true,
        sourceId: fixture.source.id,
        sourceHash: fixture.source.sha256,
        attemptId: fixture.state.attempt?.attemptId,
        providerSubmissions: fixture.submissions,
        attemptUnchanged: true,
        uncertainTotalNotSelectable: true,
        pageSelectionHidesOtherPageRegion: true,
        zoom: 125,
        geometry,
        parity,
        screenshots: [highlighted, otherPage, finalScreenshot],
      },
      null,
      2,
    ),
  );
});
