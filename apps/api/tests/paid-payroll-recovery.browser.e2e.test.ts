import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import * as Recovery from "@open-erp/contracts/paid-payroll-recovery";
import { environment, post, request, decoded } from "./support/fixtures";
import { paidRecoveryFixture } from "./support/paid-payroll-recovery";
import { withWorkspaceBrowser } from "./support/workspace-browser";

// Missing authority, stale assessment, unqualified evidence, uncertain writes,
// reload loss and cancellation must not create financial state. Canonical claims,
// installment execution and zero-net settlement are qualified by the HTTP journey.
test("paid recovery browser retains blocked assessment, split, saved evidence and cancellation", async () => {
  const f = await paidRecoveryFixture({ visualNames: true });

  const view = await post(
    f.book,
    "/payroll/paid-recoveries",
    {
      comparisonId: f.comparison.id,
      calculationId: f.capacity.id,
    },
    Recovery.PaidRecoveryView,
  );

  const id = view.assessment.id;
  const artifact = "paid-recovery-browser";
  await withWorkspaceBrowser(
    f.book,
    artifact,
    async (page, workspace) => {
      await page.evaluate(() => localStorage.setItem("PARAGLIDE_LOCALE", "sv"));
      await page.goto(`${workspace}/tax?view=paid-recovery&record=${id}`);
      await expect
        .poll(() => page.getByText("Kan inte kvittas", { exact: true }).isVisible(), {
          timeout: 60000,
        })
        .toBe(true);
      await expect
        .poll(() => page.getByRole("heading", { name: "600,00", exact: true }).isVisible(), {
          timeout: 60000,
        })
        .toBe(true);
      await expect
        .poll(() => page.getByText("Underlag för kvittning saknas.", { exact: true }).isVisible(), {
          timeout: 60000,
        })
        .toBe(true);
      const source = page.getByRole("combobox", { name: "Underlag", exact: true });
      expect(await source.inputValue()).toBe("");
      await page.getByText("Begäran pågår...", { exact: true }).waitFor({ state: "hidden" });
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: join(environment().artifacts, `${artifact}-blocked.png`) });
      await page.getByRole("button", { name: "Spara uppdelning", exact: true }).press("Enter");
      await expect
        .poll(
          async () =>
            (
              await decoded(
                await request(f.book, `/payroll/paid-recoveries/${id}`),
                Recovery.PaidRecoveryView,
              )
            ).drafts.length,
        )
        .toBe(1);
      await page.reload();
      await expect
        .poll(() => page.getByText("Senare kapacitet är inte känd", { exact: true }).isVisible(), {
          timeout: 60000,
        })
        .toBe(true);
      await source.selectOption(f.source.id);
      await page
        .getByRole("textbox", { name: "Motivering", exact: true })
        .fill("Reviewed synthetic recovery source");
      await page.getByRole("button", { name: "Bifoga underlag", exact: true }).press("Enter");
      await expect
        .poll(
          () => page.getByText("Underlaget är inte kvalificerat", { exact: true }).isVisible(),
          { timeout: 60000 },
        )
        .toBe(true);
      await page.reload();
      await expect
        .poll(
          () => page.getByText("Underlaget är inte kvalificerat", { exact: true }).isVisible(),
          { timeout: 60000 },
        )
        .toBe(true);
      await page.getByRole("button", { name: "Avbryt försök", exact: true }).click();
      await page
        .getByRole("textbox", { name: "Orsak till avbrott", exact: true })
        .fill("Cancelled synthetic recovery attempt");
      await page.getByRole("button", { name: "Bekräfta avbrott", exact: true }).click();
      await expect
        .poll(() => page.getByText("Försöket är avbrutet", { exact: true }).isVisible(), {
          timeout: 60000,
        })
        .toBe(true);
      await page.screenshot({ path: join(environment().artifacts, `${artifact}-cancelled.png`) });

      const final = await decoded(
        await request(f.book, `/payroll/paid-recoveries/${id}`),
        Recovery.PaidRecoveryView,
      );

      expect(final.cancellation).not.toBeNull();
      expect(final.claimExecution).toBeNull();
      expect(final.originalPaidEvent).toEqual(view.originalPaidEvent);
      await writeFile(
        join(environment().artifacts, `${artifact}.json`),
        JSON.stringify({ before: view, after: final }, null, 2),
      );
    },
    { existingSessionUser: true },
  );
}, 300000);
