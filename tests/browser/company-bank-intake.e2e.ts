import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import { signInSyntheticOperator } from "./synthetic-session";

test("A native company reviews and imports its original bank CSV without postings", async ({
  app,
  browser,
  screen,
  agent,
}) => {
  await signInSyntheticOperator(browser, app.baseUrl);
  await app.open("/companies");
  await screen.getByRole("button", "Skapa nytt företag").click();
  await screen.getByLabel("Företagsnamn").fill("Synthetic native bank trial");
  await screen.getByRole("button", "Skapa företag", { exact: true }).click();
  await expect(browser).toHaveURL(/\/entities\/entity_[^/]+\/books\/book_[^/]+\/setup/);
  const workspace = (await browser.url()).split("/setup")[0]!;
  await app.open(`${workspace}/settings?section=accounting`);
  await screen.getByLabel("Första dag").fill("2025-05-17");
  await screen.getByLabel("Sista dag").fill("2026-04-30");
  await screen.getByLabel("Kontonummer 1").fill("1930");
  await screen.getByLabel("Kontonamn 1").fill("Synthetic company bank");
  await screen.getByRole("button", "Skapa konton och perioder").click();
  await expect(screen.getByRole("heading", "Konfigurera bokföringen")).toBeHidden();
  await app.open(`${workspace}/accounts?view=imports&record=new`);
  await screen
    .getByLabel("Dokument", { exact: true })
    .setInputFiles("tests/browser/fixtures/synthetic-native-bank.csv");
  await expect(screen.getByLabel("Dokument", { exact: true })).toHaveValue(
    /synthetic-native-bank\.csv$/,
  );
  await screen.getByRole("button", "Spara original", { exact: true }).click();
  await expect(screen.getByRole("heading", "synthetic-native-bank.csv")).toBeVisible();
  await screen.getByLabel("Datumkolumn").fill("date");
  await screen.getByLabel("Beskrivningskolumn").fill("text");
  await screen.getByLabel("Beloppskolumn").fill("amount");
  await screen.getByRole("combobox", "Konto", { exact: true }).click();
  await screen.getByRole("option", "1930, Synthetic company bank", { exact: true }).click();
  await screen.getByRole("combobox", "Positiva belopp betyder", { exact: true }).click();
  await screen.getByRole("option", "Positivt betyder inflöde", { exact: true }).click();
  await screen.getByLabel("Kontoutdrag från").fill("2025-06-01");
  await screen.getByLabel("Kontoutdrag till").fill("2025-06-30");
  await screen.getByLabel("Ingående saldo, SEK").fill("0");
  await screen.getByLabel("Utgående saldo, SEK").fill("22500");
  await screen.getByLabel("Anteckning om täckning").fill("Synthetic observed June interval only");
  await screen.getByRole("button", "Förhandsgranska transaktioner").click();
  await expect(
    screen.getByText("Inga blockerande fel. Operatörsgranskning krävs fortfarande.", {
      exact: true,
    }),
  ).toBeVisible();
  await app.screenshot("native-company-bank-preview");
  await screen.getByLabel("Motivering till granskningen").fill("Synthetic source intake UI proof");
  await screen.getByRole("checkbox", { name: /^Jag har granskat originalbyte/ }).check();
  await agent.act(
    "Click Godkänn exakt denna förhandsgranskning once to approve the displayed synthetic bank preview.",
  );
  await expect(screen.getByRole("button", "Importera granskade observationer")).toBeEnabled();
  await agent.act(
    "Click Importera granskade observationer once to import the approved synthetic bank observations.",
  );
  await expect(
    screen.getByText("Observationer importerade. Inga bokföringsrader skapades eller matchades.", {
      exact: true,
    }),
  ).toBeVisible();
  await browser.reload();
  await expect(
    screen.getByText("Observationer importerade. Inga bokföringsrader skapades eller matchades.", {
      exact: true,
    }),
  ).toBeVisible();
  await app.screenshot("native-company-bank-admission");
  const output = process.env.OPENERP_E2E_OUTPUT;

  if (!output) throw new Error("Browser artifact directory is missing");

  await writeFile(
    join(output, "native-company-bank-ui.json"),
    JSON.stringify(
      {
        scope: "synthetic native company",
        original: "synthetic-native-bank.csv",
        expectedRows: 2,
        expectedMovementMinor: "2250000",
        admittedAfterReload: true,
        financialPostingClaim: false,
      },
      null,
      2,
    ),
  );
});
