import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import * as Mapping from "../../../packages/contracts/src/onboarding-mappings";
import * as Sie from "@open-erp/contracts/sie-import";
import * as Intake from "@open-erp/contracts/source-intake";
import {
  fixture,
  post,
  request,
  decoded,
  failure,
  environment,
  persisted,
} from "./support/fixtures";

test("retained account mapping survives reload, remembered defaults remain proposals and conflicts preserve the ledger", async () => {
  const book = await fixture();
  const original =
    '#FLAGGA 0\n#PROGRAM "Synthetic export" 1\n#FORMAT PC8\n#SIETYP 4\n#GEN 20261004\n#FNAMN "Synthetic"\n#RAR 0 20260101 20261231\n#KONTO 2999 "Other liabilities"\n#IB 0 2999 0.00\n#UB 0 2999 0.00\n#VER A 1 20260922 "Synthetic mapping source"\n{\n#TRANS 2999 {} -125.00\n#TRANS 1930 {} 125.00\n}\n';

  const occurrence = await post(
    book,
    "/source-occurrences",
    {
      sourceSystem: "mapping-fixture",
      sourceAccountId: "ledger-export",
      occurrenceKey: "mapping-first",
      sourceRevision: "1",
      filename: "source.se",
      mediaType: "application/octet-stream",
      contentBase64: Buffer.from(original).toString("base64"),
    },
    Intake.SourceOccurrence,
  );

  const preview = await post(
    book,
    `/source-occurrences/${occurrence.id}/sie-previews`,
    { encoding: "utf-8" },
    Sie.SiePreview,
  );
  const before = await persisted(book);
  const input = {
    previewId: preview.id,
    expectedPreviewDigest: preview.digest,
    sourceAccount: "2999",
    accountId: "account_clearing",
    remember: true,
    expectedRevision: 0,
  };
  const key = "mapping-e2e-first-review";
  const saved = await decoded(
    await request(book, "/onboarding/account-mappings", {
      method: "POST",
      headers: { "idempotency-key": key },
      body: JSON.stringify(input),
    }),
    Mapping.OnboardingMapping,
  );
  expect(
    await decoded(
      await request(book, "/onboarding/account-mappings", {
        method: "POST",
        headers: { "idempotency-key": key },
        body: JSON.stringify(input),
      }),
      Mapping.OnboardingMapping,
    ),
  ).toEqual(saved);
  const reloaded = await decoded(
    await request(book, `/onboarding/account-mappings?previewId=${preview.id}`),
    Mapping.OnboardingMappings,
  );
  expect(reloaded.current).toEqual([saved]);
  expect(reloaded.proposedDefaults).toEqual([
    { sourceAccount: "2999", accountId: "account_clearing" },
  ]);
  await failure(
    await request(book, "/onboarding/account-mappings", {
      method: "POST",
      headers: { "idempotency-key": key },
      body: JSON.stringify({ ...input, remember: false }),
    }),
    409,
    "IdempotencyConflict",
  );
  await failure(
    await request(book, "/onboarding/account-mappings", {
      method: "POST",
      body: JSON.stringify({ ...input, remember: false }),
    }),
    409,
    "StaleDependency",
  );
  await failure(
    await request(book, "/onboarding/account-mappings", {
      method: "POST",
      headers: { authorization: `Bearer ${book.agentToken}` },
      body: JSON.stringify({ ...input, expectedRevision: 1 }),
    }),
    403,
    "Forbidden",
  );
  const cleared = await post(
    book,
    "/onboarding/account-mappings",
    { ...input, remember: false, expectedRevision: 1 },
    Mapping.OnboardingMapping,
  );
  const final = await decoded(
    await request(book, `/onboarding/account-mappings?previewId=${preview.id}`),
    Mapping.OnboardingMappings,
  );
  expect(final.current).toEqual([cleared]);
  expect(final.proposedDefaults).toEqual([]);
  expect(final.history).toHaveLength(2);
  expect(await persisted(book)).toEqual(before);
  await writeFile(
    join(environment().artifacts, "onboarding-mappings-journey.json"),
    JSON.stringify({ saved, cleared, final, financialEffects: "unchanged" }, null, 2),
  );
});
