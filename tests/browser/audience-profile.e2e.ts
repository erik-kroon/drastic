import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import { signInSyntheticOperator } from "./synthetic-session";

// ADR 0019. Failure obligations, stated before implementation: the client
// profile still lists bureau-only destinations; an emptied group still renders
// its heading; the choice is lost on reload; switching profile changes what the
// API admits for the same session.
test("the audience profile changes navigation only and survives reload", async ({
  app,
  browser,
  screen,
  agent,
}) => {
  const output = process.env.OPENERP_E2E_OUTPUT;

  if (!output) throw new Error("Use the disposable synthetic browser launcher");
  const workspace = await signInSyntheticOperator(browser, app.baseUrl);
  const origin = new URL(workspace).origin;
  const api = workspace.replace(origin, `${origin}/api/v1`);

  const cookie = (await browser.cookies())
    .map((entry) => `${entry.name}=${entry.value}`)
    .join("; ");

  const admitted = async () => {
    const response = await fetch(`${api}/workspace`, {
      headers: { cookie, origin },
      signal: AbortSignal.timeout(20000),
    });

    return response.status;
  };

  const navigation = (label: string) => screen.getByRole("navigation", label, { exact: true });

  await app.open(`${workspace}/overview`);
  await expect(screen.getByRole("link", "Bokföring", { exact: true })).toBeVisible({
    timeout: 90_000,
  });
  const before = await admitted();
  const bureau = await app.screenshot("audience-bureau-navigation");

  await agent.act(
    "Open the account menu at the bottom of the sidebar, open the Vy dropdown and select Visa som klient. Stop once it is selected.",
  );
  await expect(navigation("Arbete").getByRole("link")).toHaveCount(1);
  await expect(navigation("Arbete").getByRole("link", "Dokument", { exact: true })).toBeVisible();
  await expect(navigation("Redovisning").getByRole("link")).toHaveCount(1);
  await expect(
    navigation("Redovisning").getByRole("link", "Rapporter", { exact: true }),
  ).toBeVisible();

  for (const hidden of [
    "Bank",
    "Försäljning",
    "Inköp",
    "Bokföring",
    "Skatt och löner",
    "Bokslut",
    "Klientlista",
    "Avancerade verktyg",
  ])
    await expect(screen.getByRole("link", hidden, { exact: true })).toHaveCount(0);

  await browser.reload();
  await expect(navigation("Redovisning").getByRole("link")).toHaveCount(1, { timeout: 90_000 });
  await expect(screen.getByRole("link", "Bokföring", { exact: true })).toHaveCount(0);
  const client = await app.screenshot("audience-client-navigation-after-reload");

  // The profile is not authority: the same session still reaches bookkeeping.
  await app.open(`${workspace}/books`);
  await expect(screen.getByRole("navigation", "Redovisning", { exact: true })).toBeVisible({
    timeout: 90_000,
  });
  const after = await admitted();
  expect(before).toBe(200);
  expect(after).toBe(before);
  const direct = await app.screenshot("audience-client-direct-bookkeeping");

  await screen.getByText("Elin Sund", { exact: true }).click();
  await screen.getByRole("combobox", "Vy", { exact: true }).click();
  await screen.getByRole("option", "Visa som byrå", { exact: true }).click();
  await expect(screen.getByRole("link", "Bokföring", { exact: true })).toBeVisible();
  await expect(navigation("Arbete").getByRole("link")).toHaveCount(4);
  const restored = await app.screenshot("audience-bureau-restored");

  await writeFile(
    join(output, "audience-profile.json"),
    JSON.stringify(
      {
        scope: "Synthetic operator book; audience profile is browser-local shell composition",
        client: {
          work: ["Dokument"],
          accounting: ["Rapporter"],
          accountMenuHides: ["Klientlista", "Avancerade verktyg"],
          retainedAfterReload: true,
        },
        authority: { workspaceStatus: after, unchangedAcrossProfiles: true },
        screenshots: [bureau, client, direct, restored],
      },
      null,
      2,
    ),
  );
});
