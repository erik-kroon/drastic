import { readFile } from "node:fs/promises";
import { basename, dirname } from "node:path";
import * as Schema from "effect/Schema";
import { test } from "@e2e-dev/web";
import { expect } from "e2e";

const Session = Schema.Struct({
  workspace: Schema.String,
  recoveryId: Schema.String,
  cookies: Schema.Array(Schema.Struct({ name: Schema.String, value: Schema.String })),
});

test("Luna reviews the real blocked paid recovery without proposing a financial effect", async ({
  app,
  browser,
  screen,
  agent,
}) => {
  const path = process.env.OPENERP_PAYROLL_REVIEW_SESSION;

  test.skip(!path, "Requires the owned Vitest paid-recovery fixture and authenticated browser");

  if (
    !path ||
    basename(path) !== "model-session.json" ||
    !basename(dirname(path)).startsWith("openerp-payroll-review-")
  )
    throw new Error("Owned payroll review session required");
  const session = Schema.decodeSync(Schema.fromJsonString(Session))(await readFile(path, "utf8"));
  const origin = new URL(session.workspace);

  if (
    origin.protocol !== "http:" ||
    origin.hostname !== "127.0.0.1" ||
    origin.origin !== app.baseUrl ||
    !/^\/entities\/[a-zA-Z0-9_-]+\/books\/[a-zA-Z0-9_-]+$/.test(origin.pathname)
  )
    throw new Error("Payroll review must stay on the disposable loopback book");
  await browser.setCookies(
    session.cookies.map((cookie) => ({
      ...cookie,
      url: origin.origin,
      httpOnly: true,
      sameSite: "Lax" as const,
    })),
  );
  await app.open(
    `${origin.pathname}/tax?view=paid-recovery&record=${encodeURIComponent(session.recoveryId)}`,
  );
  await expect(screen.getByRole("heading", "600,00", { exact: true })).toBeVisible();
  await expect(screen.getByText("Underlag för kvittning saknas.", { exact: true })).toBeVisible();
  await expect(screen.getByText("Begäran pågår...", { exact: true })).toHaveCount(0);
  await agent.assert(
    "This real payroll recovery screen clearly says the 600,00 recovery cannot be offset yet: lawful evidence is missing, October capacity is 450,00 and 150,00 remains for November with unknown capacity. It distinguishes a saved split proposal from any posting and requires independent review. The amount, two blockers, source selector and actions are readable, with no overlapping text.",
  );
  await app.screenshot("paid-recovery-luna-blocked-1440x900");
});
