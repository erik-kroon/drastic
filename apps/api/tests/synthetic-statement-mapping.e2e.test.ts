import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { environment } from "./support/fixtures";

test("synthetic SE mapping respects authored account boundaries and refuses malformed releases", async () => {
  const { syntheticStatementMappingRelease, resolveSyntheticStatementAccount } =
    await import("../../../jurisdictions/se/src/statements/synthetic-mapping");

  const expected = [
    ["3000", "synthetic_k2_net_sales", "income"],
    ["3799", "synthetic_k2_net_sales", "income"],
    ["3800", "synthetic_k2_other_income", "income"],
    ["4000", "synthetic_k2_goods_cost", "expense"],
    ["5400", "synthetic_k2_external_cost", "expense"],
    ["6550", "synthetic_k2_external_cost", "expense"],
    ["6999", "synthetic_k2_external_cost", "expense"],
    ["7000", "synthetic_k2_personnel_cost", "expense"],
    ["7700", "synthetic_k2_depreciation", "expense"],
    ["7999", "synthetic_k2_other_cost", "expense"],
  ] as const;

  const observed = expected.map(([code, statementLeaf, classification]) => {
    const result = resolveSyntheticStatementAccount(syntheticStatementMappingRelease, code);

    expect(result).toEqual({
      status: "known",
      statementLeaf,
      classification,
      placement: "income_statement",
    });

    return { code, expected: { statementLeaf, classification }, observed: result };
  });

  for (const code of ["1000", "8000", "05400", "54x0"]) {
    expect(resolveSyntheticStatementAccount(syntheticStatementMappingRelease, code).status).toBe(
      "unknown",
    );
  }

  const gap = {
    ...syntheticStatementMappingRelease,
    ranges: syntheticStatementMappingRelease.ranges.filter((range) => range.from !== "5000"),
  };

  const reversed = {
    ...syntheticStatementMappingRelease,
    ranges: [{ ...syntheticStatementMappingRelease.ranges[0]!, from: "3999", to: "3000" }],
  };

  const overlap = {
    ...syntheticStatementMappingRelease,
    ranges: [
      ...syntheticStatementMappingRelease.ranges,
      { ...syntheticStatementMappingRelease.ranges[0]!, from: "3500", to: "4500" },
    ],
  };

  expect(resolveSyntheticStatementAccount(gap, "5400")).toEqual({
    status: "unknown",
    reason: "account_not_mapped",
  });
  expect(resolveSyntheticStatementAccount(reversed, "3000")).toEqual({
    status: "unknown",
    reason: "invalid_release",
  });
  expect(resolveSyntheticStatementAccount(overlap, "6550")).toEqual({
    status: "unknown",
    reason: "invalid_release",
  });

  const changed = {
    ...syntheticStatementMappingRelease,
    ranges: syntheticStatementMappingRelease.ranges.map((range) => ({
      ...range,
      statementLeaf: `changed_${range.statementLeaf}`,
    })),
  };

  const checksum = (value: unknown) =>
    createHash("sha256").update(JSON.stringify(value)).digest("hex");

  expect(checksum(changed)).not.toBe(checksum(syntheticStatementMappingRelease));
  expect(resolveSyntheticStatementAccount(changed, "5400")).not.toEqual(
    resolveSyntheticStatementAccount(syntheticStatementMappingRelease, "5400"),
  );
  await writeFile(
    join(environment().artifacts, "synthetic-statement-mapping.json"),
    JSON.stringify({ expected, observed, gap, reversed, overlap, changed }, null, 2),
  );
});
