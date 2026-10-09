import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import { signInSyntheticOperator } from "./synthetic-session";

test("the K-01 palette switches appearance and survives reload", async ({
  app,
  browser,
  screen,
}) => {
  const output = process.env.OPENERP_E2E_OUTPUT;

  if (!output) throw new Error("Use the disposable synthetic browser launcher");
  const workspace = await signInSyntheticOperator(browser, app.baseUrl);

  const expectedColors = {
    light: {
      text: "#0f172a",
      secondary: "#475569",
      caption: "#64748b",
      action: "#2448a5",
      success: "#1e6256",
      warning: "#8a5a00",
      error: "#b4232a",
      surface: "#ffffff",
      "side-surface": "#f7f8fa",
      viewer: "#eef1f5",
      rule: "#e6eaf0",
      control: "#d3d8df",
      "selected-row": "#eef3fc",
      evidence: "#cfe0fb",
    },
    dark: {
      text: "#f7f8f8",
      secondary: "#b4b8c0",
      caption: "#8a8f98",
      action: "#7b9bf5",
      success: "#4cb782",
      warning: "#e5b547",
      error: "#eb5757",
      surface: "#141516",
      "side-surface": "#0f1011",
      viewer: "#08090a",
      rule: "#23252a",
      control: "#2e3035",
      "selected-row": "#141b2e",
      evidence: "#1e2a4a",
    },
  };

  const surface = () =>
    browser.evaluate(() => {
      const root = document.documentElement;
      const computed = getComputedStyle(root);

      const names = [
        "text",
        "secondary",
        "caption",
        "action",
        "success",
        "warning",
        "error",
        "surface",
        "side-surface",
        "viewer",
        "rule",
        "control",
        "selected-row",
        "evidence",
      ];

      return {
        dark: root.classList.contains("dark"),
        colorScheme: computed.colorScheme,
        background: getComputedStyle(document.body).backgroundColor,
        text: getComputedStyle(document.body).color,
        kanonColors: Object.fromEntries(
          names.map((name) => {
            const color = computed.getPropertyValue(`--kanon-color-${name}`).trim().toLowerCase();

            const expanded = color.replace(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/, "#$1$1$2$2$3$3");

            return [name, expanded];
          }),
        ),
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
  expect(light.kanonColors).toEqual(expectedColors.light);

  const shell = await browser.evaluate(() => {
    const sidebar = document.querySelector("aside");
    const selected = sidebar?.querySelector('a[aria-current="page"]');
    const companyMark = sidebar?.querySelector("a span[aria-hidden]");
    const avatar = sidebar?.querySelector("summary span[aria-hidden]");
    const group = sidebar?.querySelector("nav > p");

    if (!sidebar || !selected || !companyMark || !avatar || !group)
      throw new Error("The bureau shell is missing a required navigation part");

    return {
      sidebarWidth: sidebar.getBoundingClientRect().width,
      selectedBackground: getComputedStyle(selected).backgroundColor,
      labelColor: getComputedStyle(group).color,
      companyMarkWidth: companyMark.getBoundingClientRect().width,
      companyInitialSize: getComputedStyle(companyMark).fontSize,
      companyInitialLeading: getComputedStyle(companyMark).lineHeight,
      avatarWidth: avatar.getBoundingClientRect().width,
      avatarInitialSize: getComputedStyle(avatar).fontSize,
    };
  });

  const expectedShell = {
    sidebarWidth: 224,
    selectedBackground: "rgb(230, 234, 240)",
    labelColor: "rgb(71, 85, 105)",
    companyMarkWidth: 20,
    companyInitialSize: "11px",
    companyInitialLeading: "14px",
    avatarWidth: 22,
    avatarInitialSize: "10px",
  };

  expect(shell).toEqual(expectedShell);
  const lightShot = await app.screenshot("theme-light-overview");

  await choose("Utseende: mörkt");
  const dark = await surface();
  expect(dark).toEqual({
    dark: true,
    colorScheme: "dark",
    background: "rgb(8, 9, 10)",
    text: "rgb(247, 248, 248)",
    kanonColors: expectedColors.dark,
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
  const reloaded = await surface();

  expect(reloaded.dark).toBe(true);
  expect(reloaded.colorScheme).toBe("dark");
  expect(reloaded.kanonColors).toEqual(expectedColors.dark);

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
  expect(restored.kanonColors).toEqual(expectedColors.light);
  const restoredShot = await app.screenshot("theme-light-restored");

  await writeFile(
    join(output, "dark-theme.json"),
    JSON.stringify(
      {
        scope: "Synthetic operator book; appearance is a browser-local preference",
        reference: {
          board: "K-01",
          revision: "kanon-2026-10-09",
          jsxSha256: "5490062e76f16d304b8677f3e9a658cad9ace4d1cc022c47e4e1e7da35daa641",
        },
        expectedColors,
        shellReference: "K-06 / kanon-2026-10-09 stored JSX",
        expectedShell,
        shell,
        light,
        dark,
        reloaded,
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
