import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import * as Recovery from "@open-erp/contracts/paid-payroll-recovery";
import * as Calculations from "@open-erp/contracts/payroll-calculations";
import { environment, post, request, decoded } from "./support/fixtures";
import { paidRecoveryFixture } from "./support/paid-payroll-recovery";
import { withWorkspaceBrowser } from "./support/workspace-browser";

// Independent actors, immutable history, two conserved installments, exact
// approvals, zero-net settlement and reload must survive the complete UI path.
test("paid recovery browser completes independently approved claim and installments", async () => {
  const f = await paidRecoveryFixture();
  const original = await f.history();

  const before = await post(
    f.book,
    "/payroll/paid-recoveries",
    {
      comparisonId: f.comparison.id,
      calculationId: f.capacity.id,
    },
    Recovery.PaidRecoveryView,
  );

  const november = await post(
    f.book,
    "/payroll/calculations",
    await f.laterInput("2026-11", "15000"),
    Calculations.PayrollCalculation,
  );

  const id = before.assessment.id;

  const read = async () =>
    decoded(await request(f.book, `/payroll/paid-recoveries/${id}`), Recovery.PaidRecoveryView);

  await withWorkspaceBrowser(
    f.book,
    "paid-recovery-completion",
    async (page, workspace, signInAs) => {
      const open = async (actorId: string) => {
        await signInAs(actorId);
        await page.evaluate(() => localStorage.setItem("PARAGLIDE_LOCALE", "sv"));
        await page.goto(`${workspace}/tax?view=paid-recovery&record=${id}`);
        await page.getByRole("heading", { name: "600,00", exact: true }).waitFor();
      };

      const click = (name: string) => page.getByRole("button", { name, exact: true }).click();
      await open(f.book.actorId);
      await click("Spara uppdelning");
      await expect.poll(async () => (await read()).drafts.length).toBe(1);
      await page.getByRole("combobox", { name: "Underlag", exact: true }).selectOption(f.source.id);
      await page
        .getByRole("textbox", { name: "Motivering", exact: true })
        .fill("Independently reviewed synthetic recovery");
      await click("Bifoga underlag");
      await expect.poll(async () => (await read()).attachments.length).toBe(1);
      await open(f.qualifier.actorId);
      await click("Kvalificera bruttofordran");
      await expect
        .poll(async () => (await read()).qualifications.some((q) => q.purpose === "gross_claim"))
        .toBe(true);
      await open(f.book.actorId);
      await page
        .getByRole("textbox", { name: "Fordringskonto", exact: true })
        .fill("employee_recovery");
      await page
        .getByRole("textbox", { name: "Bokföringsperiod", exact: true })
        .fill("period_2026");
      await page.getByRole("textbox", { name: "Bokföringsdatum", exact: true }).fill("2026-10-05");
      await click("Förbered fordran");
      await expect.poll(async () => (await read()).claimReview !== null).toBe(true);
      await open(f.approver.actorId);
      await click("Godkänn fordran");
      await expect.poll(async () => (await read()).claimSettlement?.approvals.length).toBe(1);
      await open(f.book.actorId);
      await click("Verkställ fordran");
      await expect.poll(async () => (await read()).claimExecution !== null).toBe(true);
      await open(f.qualifier.actorId);
      await click("Kvalificera nettokvittning");
      await expect
        .poll(async () => (await read()).qualifications.some((q) => q.purpose === "net_offset"))
        .toBe(true);

      for (const [month, capacityId] of [
        ["2026-10", f.capacity.id],
        ["2026-11", november.id],
      ]) {
        await open(f.book.actorId);
        await page
          .getByRole("textbox", { name: `Kapacitetsberäkning ${month}`, exact: true })
          .fill(capacityId!);
        await click(`Förbered kvittning ${month}`);
        await expect
          .poll(
            async () => (await read()).legs.find((row) => row.leg.month === month)?.reviews.length,
          )
          .toBe(1);
        await open(f.approver.actorId);
        await click(`Godkänn kvittning ${month}`);
        await expect
          .poll(
            async () =>
              (await read()).legs.find((row) => row.leg.month === month)?.reviews[0]?.approvals
                .length,
          )
          .toBe(1);
        await open(f.book.actorId);
        await click(`Verkställ kvittning ${month}`);
        await expect
          .poll(
            async () =>
              (await read()).legs.find((row) => row.leg.month === month)?.reviews[0]?.execution !==
              null,
          )
          .toBe(true);
        await click(`Förbered lönekörning ${month}`);
        await page.screenshot({
          path: join(environment().artifacts, `paid-recovery-run-${month}.png`),
        });
        await writeFile(
          join(environment().artifacts, `paid-recovery-run-${month}.txt`),
          await page.locator("body").innerText(),
        );
        await writeFile(
          join(environment().artifacts, `paid-recovery-run-${month}.json`),
          JSON.stringify(await read(), null, 2),
        );
        await expect
          .poll(
            async () =>
              (await read()).legs.find((row) => row.leg.month === month)?.payrollRun != null,
          )
          .toBe(true);
        await open(f.approver.actorId);
        await click(`Godkänn lönekörning ${month}`);
        await expect
          .poll(
            async () =>
              (await read()).legs.find((row) => row.leg.month === month)?.payrollRun?.approval !=
              null,
          )
          .toBe(true);
        await open(f.book.actorId);
        await click(`Bokför lönekörning ${month}`);
        await expect
          .poll(
            async () =>
              (await read()).legs.find((row) => row.leg.month === month)?.payrollRun?.execution !=
              null,
          )
          .toBe(true);
      }

      await click("Förbered kvittad utbetalning 2026-10");
      await expect.poll(async () => (await read()).legs[0]?.noncash !== null).toBe(true);
      await open(f.approver.actorId);
      await click("Godkänn kvittad utbetalning 2026-10");
      await expect.poll(async () => (await read()).legs[0]?.noncash?.approvals.length).toBe(1);
      await open(f.book.actorId);
      await click("Registrera kvittad utbetalning 2026-10");
      await expect.poll(async () => (await read()).legs[0]?.noncash?.execution !== null).toBe(true);
      await page.reload();
      const after = await read();
      expect(after.claimRemainingMinor).toBe("0");
      expect(after.originalPaidEvent).toEqual(before.originalPaidEvent);
      expect(await f.history()).toEqual(original);
      expect(after.legs[0]?.noncash?.execution?.paidEvent?.paidMinor).toBe("0");
      expect(after.legs[0]?.noncash?.review.cash).toBeNull();
      await page.screenshot({ path: join(environment().artifacts, "paid-recovery-completed.png") });
      await writeFile(
        join(environment().artifacts, "paid-recovery-completed.json"),
        JSON.stringify({ before, after }, null, 2),
      );
    },
    { existingSessionUser: true, additionalActors: [f.qualifier.actorId, f.approver.actorId] },
  );
}, 600000);
