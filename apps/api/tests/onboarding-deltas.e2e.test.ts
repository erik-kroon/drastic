import * as Onboarding from "@open-erp/contracts/onboarding";
import { expect, test } from "vitest";
import * as Delta from "@open-erp/contracts/onboarding-deltas";
import * as Intake from "@open-erp/contracts/source-intake";
import * as Sie from "@open-erp/contracts/sie-import";
import { decoded, failure, fixture, key, persisted, post, request } from "./support/fixtures";
import { saveSanitizedJourney } from "./assurance/database-support";

test("final source delta retains review intent without manufacturing financial effects", async () => {
  const book = await fixture();
  const other = await fixture();
  await post(book, "/onboarding", { path: "demo" }, Onboarding.OnboardingCase);
  await post(
    book,
    "/onboarding/revisions",
    {
      expectedRevision: 1,
      configuration: {
        migrationDepth: "current_fiscal_year",
        incumbentSystem: "Synthetic predecessor",
        dates: {
          historyStartsOn: "2026-01-01",
          historyEndsOn: "2026-09-30",
          detailStartsOn: "2026-01-01",
          openingOn: "2026-08-31",
          acceptanceStartsOn: "2026-09-01",
          acceptanceEndsOn: "2026-09-30",
          candidateLiveOn: "2026-10-01",
          provingPeriodEndsOn: "2026-10-31",
        },
      },
    },
    Onboarding.OnboardingCase,
  );

  const original = await post(
    book,
    "/source-occurrences",
    {
      sourceSystem: "independent_incumbent",
      sourceAccountId: "complete_ledger",
      occurrenceKey: key(),
      sourceRevision: "final",
      filename: "final.se",
      mediaType: "application/octet-stream",
      contentBase64: Buffer.from(
        '#FLAGGA 0\n#PROGRAM "Synthetic" 1\n#FORMAT UTF8\n#SIETYP 4\n#GEN 20261004\n#FNAMN "Synthetic"\n#RAR 0 20260101 20261231\n#KONTO 1930 "Bank"\n#KONTO 2999 "Clearing"\n#IB 0 1930 0.00\n#IB 0 2999 0.00\n#UB 0 1930 125.00\n#UB 0 2999 -125.00\n#VER A 1 20260922 "New source voucher"\n{\n#TRANS 1930 {} 125.00\n#TRANS 2999 {} -125.00\n}\n',
      ).toString("base64"),
    },
    Intake.SourceOccurrence,
  );

  const preview = await post(
    book,
    `/source-occurrences/${original.id}/sie-previews`,
    { encoding: "utf-8" },
    Sie.SiePreview,
  );

  const before = await persisted(book);
  const command = { candidatePreviewId: preview.id, expectedPreviewDigest: preview.digest };
  const delta = await post(book, "/onboarding/source-deltas", command, Delta.OnboardingDelta);
  expect(delta.rows.map((row) => row.kind)).toEqual(["new"]);
  expect(delta.rows[0]?.sourceReference).toBe(preview.vouchers[0]?.sourceReference);

  const choice = {
    deltaId: delta.id,
    expectedDigest: delta.digest,
    sourceReference: delta.rows[0]?.sourceReference,
    choice: "use_change",
    reason: "Review this retained change",
  };

  const decision = await post(
    book,
    "/onboarding/source-delta-decisions",
    choice,
    Delta.OnboardingDeltaDecision,
  );

  const state = await decoded(
    await request(book, `/onboarding/source-deltas/${delta.id}`),
    Delta.OnboardingDeltaView,
  );

  expect(state.decisions).toEqual([decision]);
  expect(state.blockers).toContain("source_change_not_posted");
  await failure(await request(other, `/onboarding/source-deltas/${delta.id}`), 404, "NotFound");
  await failure(
    await request(book, "/onboarding/source-delta-decisions", {
      method: "POST",
      headers: { authorization: `Bearer ${book.agentToken}` },
      body: JSON.stringify(choice),
    }),
    403,
    "Forbidden",
  );
  expect(
    (
      await request(book, "/onboarding/source-delta-decisions", {
        method: "POST",
        body: JSON.stringify({ ...choice, amountMinor: "0" }),
      })
    ).ok,
  ).toBe(false);
  expect(await persisted(book)).toEqual(before);

  const octoberSource = await post(
    book,
    "/source-occurrences",
    {
      sourceSystem: "independent_incumbent",
      sourceAccountId: "complete_ledger",
      occurrenceKey: key(),
      sourceRevision: "october",
      filename: "october.se",
      mediaType: "application/octet-stream",
      contentBase64: Buffer.from(
        '#FLAGGA 0\n#FORMAT UTF8\n#SIETYP 4\n#RAR 0 20260101 20261231\n#KONTO 1930 "Bank"\n#KONTO 2999 "Clearing"\n#VER A 2 20261001 "OpenERP authority period"\n{\n#TRANS 1930 {} 125.00\n#TRANS 2999 {} -125.00\n}\n',
      ).toString("base64"),
    },
    Intake.SourceOccurrence,
  );

  const octoberPreview = await post(
    book,
    `/source-occurrences/${octoberSource.id}/sie-previews`,
    { encoding: "utf-8" },
    Sie.SiePreview,
  );

  expect(octoberPreview.ready).toBe(true);
  await failure(
    await request(book, "/onboarding/source-deltas", {
      method: "POST",
      body: JSON.stringify({
        candidatePreviewId: octoberPreview.id,
        expectedPreviewDigest: octoberPreview.digest,
      }),
    }),
    422,
    "UnsupportedProfile",
  );
  await saveSanitizedJourney("onboarding-source-deltas", {
    delta,
    decision,
    state,
    financialEffects: "unchanged",
  });
});
