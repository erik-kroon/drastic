import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import { signInSyntheticOperator } from "./synthetic-session";

// Failure obligations, stated before implementation: choosing dark leaves the
// light palette; the choice is lost on reload; the server document lacks the
// pre-paint script so a saved choice flashes light; a register surface keeps
// hard-coded light colours; returning to light leaves the dark class behind.
test("the dark appearance applies page 18 colours and survives reload", async ({
  app,
  browser,
  screen,
}) => {
  const output = process.env.OPENERP_E2E_OUTPUT;

  if (!output) throw new Error("Use the disposable synthetic browser launcher");
  const workspace = await signInSyntheticOperator(browser, app.baseUrl);

  const surface = () =>
    browser.evaluate(() => {
      const root = document.documentElement;

      return {
        dark: root.classList.contains("dark"),
        colorScheme: getComputedStyle(root).colorScheme,
        background: getComputedStyle(document.body).backgroundColor,
        text: getComputedStyle(document.body).color,
      };
    });

  const choose = async (label: string) => {
    await screen.getByText("Elin Sund", { exact: true }).click();
    await screen.getByRole("combobox", "Utseende", { exact: true }).click();
    await screen.getByRole("option", label, { exact: true }).click();
    await expect(screen.getByRole("option", label, { exact: true })).toHaveCount(0);
    await screen.getByText("Elin Sund", { exact: true }).click();
    await expect(screen.getByRole("combobox", "Utseende", { exact: true })).not.toBeVisible();
  };

  await app.open(`${workspace}/overview`);
  await expect(screen.getByRole("heading", "Översikt", { exact: true })).toBeVisible({
    timeout: 90_000,
  });
  const light = await surface();
  expect(light.dark).toBe(false);
  expect(light.colorScheme).toBe("light");
  const lightShot = await app.screenshot("theme-light-overview");

  await choose("Utseende: mörkt");
  const dark = await surface();
  expect(dark).toEqual({
    dark: true,
    colorScheme: "dark",
    background: "rgb(8, 9, 10)",
    text: "rgb(247, 248, 248)",
  });
  const darkShot = await app.screenshot("theme-dark-overview");

  const served = await fetch(`${workspace}/overview`, {
    headers: {
      cookie: (await browser.cookies()).map((entry) => `${entry.name}=${entry.value}`).join("; "),
    },
    signal: AbortSignal.timeout(20000),
  }).then((response) => response.text());

  expect(served).toContain('localStorage.getItem("drastic.theme")');

  await browser.reload();
  await expect(screen.getByRole("heading", "Översikt", { exact: true })).toBeVisible({
    timeout: 90_000,
  });
  expect((await surface()).dark).toBe(true);

  await app.open(`${workspace}/books`);
  await expect(screen.getByRole("heading", "Bokföring", { exact: true })).toBeVisible({
    timeout: 90_000,
  });

  const register = await browser.evaluate(
    () => getComputedStyle(document.querySelector("main") ?? document.body).color,
  );

  expect(register).toBe("rgb(247, 248, 248)");
  const registerShot = await app.screenshot("theme-dark-bookkeeping");

  await choose("Utseende: ljust");
  const restored = await surface();
  expect(restored.dark).toBe(false);
  expect(restored.colorScheme).toBe("light");
  const restoredShot = await app.screenshot("theme-light-restored");

  await writeFile(
    join(output, "dark-theme.json"),
    JSON.stringify(
      {
        scope: "Synthetic operator book; appearance is a browser-local preference",
        light,
        dark,
        prePaintScriptInServerDocument: true,
        retainedAfterReload: true,
        registerText: register,
        restored,
        screenshots: [lightShot, darkShot, registerShot, restoredShot],
      },
      null,
      2,
    ),
  );
});
