import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";
import * as E from "@open-erp/contracts/decision-examples";
import { environment, post, type BookFixture } from "./fixtures";

export async function assertPersonalOwnersExcluded(book: BookFixture, owner: string) {
  const exported = await post(
    book,
    "/automation/decision-examples",
    { purpose: "training", selectedDecisionIds: [] },
    E.DecisionExampleExport,
  );

  expect(exported.manifest.denominators.inventory).toBeGreaterThan(0);
  expect(
    Object.values(exported.manifest.exclusionCounts).reduce((sum, count) => sum + count, 0),
  ).toBe(exported.manifest.denominators.excluded);
  await writeFile(
    join(environment().artifacts, `decision-examples-${owner}.json`),
    JSON.stringify(exported, null, 2),
  );
  expect(exported.examples).toHaveLength(0);
  expect(exported.exclusions).toEqual(
    expect.arrayContaining([expect.objectContaining({ owner, reason: "personal_owner" })]),
  );
  expect(exported.manifest.denominators.excluded).toBe(exported.manifest.denominators.inventory);
  expect(JSON.stringify(exported)).not.toContain("Sara Lind");

  return exported;
}

export async function assertEvaluationRefused(book: BookFixture, id: string) {
  const { failure, key, request } = await import("./fixtures");
  await failure(
    await request(book, "/automation/decision-examples", {
      method: "POST",
      headers: { "idempotency-key": key() },
      body: JSON.stringify({ purpose: "evaluation", selectedDecisionIds: [id] }),
    }),
    422,
    "UnsupportedProfile",
  );
}
