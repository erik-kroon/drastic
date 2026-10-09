import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "@e2e-dev/web";
import { expect } from "e2e";

// Failure obligations, stated before implementation: a chart has no accessible
// name or table equivalent; the table shows rounded or re-derived amounts; the
// previous-year ticks are missing or hidden behind their bars; end labels are
// missing or collide; the reserve line is clipped; colours stay light in dark.
test("kanon charts draw page 18 data with exact table equivalents in light and dark", async ({
  app,
  browser,
  screen,
}) => {
  const output = process.env.OPENERP_E2E_OUTPUT;

  if (!output) throw new Error("Use the disposable synthetic browser launcher");
  await browser.setViewport({ width: 1440, height: 1000 });
  await app.open(`${app.baseUrl}/kanon/charts`);

  const monthly = screen.getByRole("figure", "Intäkter per månad", { exact: true });
  const forecast = screen.getByRole("figure", "Saldo framåt", { exact: true });
  const waterfall = screen.getByRole("figure", "Från intäkter till resultat", { exact: true });
  await expect(monthly).toBeVisible({ timeout: 90_000 });
  await expect(forecast).toBeVisible();
  await expect(waterfall).toBeVisible();
  await expect(
    screen.getByRole("img", "Banksaldo de senaste åtta veckorna: 241 200 kr till 312 450 kr", {
      exact: true,
    }),
  ).toBeVisible();

  const drawn = () =>
    browser.evaluate(() => {
      const figure = (name: string) => document.querySelector(`figure[aria-label="${name}"]`);

      const texts = (name: string) =>
        Array.from(figure(name)?.querySelectorAll("svg text") ?? []).map((node) => {
          const box = node.getBoundingClientRect();

          return { text: node.textContent ?? "", top: box.top, bottom: box.bottom };
        });

      const ticks = Array.from(
        figure("Intäkter per månad")?.querySelectorAll("svg line[stroke-width='2']") ?? [],
      ).length;

      const bars = Array.from(
        figure("Intäkter per månad")?.querySelectorAll("svg .recharts-bar-rectangle path") ?? [],
      ).length;

      return {
        ticks,
        bars,
        forecastTexts: texts("Saldo framåt"),
        background: getComputedStyle(document.body).backgroundColor,
      };
    });

  const light = await drawn();
  expect(light.bars).toBe(9);
  expect(light.ticks).toBe(9);

  const endLabels = ["Saldo", "Lägst under dagen", "Din gräns"].map((text) =>
    light.forecastTexts.find((entry) => entry.text === text),
  );

  for (const label of endLabels) expect(label).toBeDefined();

  for (const [index, label] of endLabels.entries())
    for (const other of endLabels.slice(index + 1))
      expect(label!.bottom <= other!.top || other!.bottom <= label!.top).toBe(true);

  const lightShot = await app.screenshot("kanon-charts-light");

  await monthly.getByRole("button", "Visa som tabell", { exact: true }).click();
  await expect(monthly.getByRole("table")).toBeVisible();
  await expect(monthly.getByRole("row", /sep/)).toContainText("148 240 kr");
  await expect(monthly.getByRole("row", /sep/)).toContainText("125 000 kr");
  await waterfall.getByRole("button", "Visa som tabell", { exact: true }).click();
  await expect(waterfall.getByRole("row", /Resultat/)).toContainText("89 905 kr");
  await expect(waterfall.getByRole("row", /Övrigt/)).toContainText("\u2212400 035 kr");
  const tableShot = await app.screenshot("kanon-charts-tables");
  await monthly.getByRole("button", "Visa som diagram", { exact: true }).click();
  await waterfall.getByRole("button", "Visa som diagram", { exact: true }).click();

  await browser.evaluate(() => {
    localStorage.setItem("drastic.theme", "dark");

    return true;
  });
  await browser.reload();
  await expect(monthly).toBeVisible({ timeout: 90_000 });
  const dark = await drawn();
  expect(dark.background).toBe("rgb(8, 9, 10)");
  expect(dark.ticks).toBe(9);
  const darkShot = await app.screenshot("kanon-charts-dark");

  await writeFile(
    join(output, "kanon-charts.json"),
    JSON.stringify(
      {
        scope: "Kanon reference route with the synthetic page 18 scenario",
        monthly: { bars: light.bars, previousYearTicks: light.ticks },
        forecastEndLabelsSeparated: ["Saldo", "Lägst under dagen", "Din gräns"],
        tables: { september: ["148 240 kr", "125 000 kr"], result: "89 905 kr" },
        darkBackground: dark.background,
        screenshots: [lightShot, tableShot, darkShot],
      },
      null,
      2,
    ),
  );
});
