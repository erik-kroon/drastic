export type SyntheticStatementMappingRelease = {
  readonly id: string;
  readonly schema: "synthetic_se_statement_mapping_v1";
  readonly qualification: "synthetic_only";
  readonly ranges: ReadonlyArray<{
    readonly from: string;
    readonly to: string;
    readonly classification: "income" | "expense";
    readonly statementLeaf: string;
  }>;
};

export const syntheticStatementMappingRelease: SyntheticStatementMappingRelease = {
  id: "synthetic_se_k2_income_expense_v1",
  schema: "synthetic_se_statement_mapping_v1",
  qualification: "synthetic_only",
  ranges: [
    { from: "3000", to: "3799", classification: "income", statementLeaf: "synthetic_k2_net_sales" },
    {
      from: "3800",
      to: "3999",
      classification: "income",
      statementLeaf: "synthetic_k2_other_income",
    },
    {
      from: "4000",
      to: "4999",
      classification: "expense",
      statementLeaf: "synthetic_k2_goods_cost",
    },
    {
      from: "5000",
      to: "6999",
      classification: "expense",
      statementLeaf: "synthetic_k2_external_cost",
    },
    {
      from: "7000",
      to: "7699",
      classification: "expense",
      statementLeaf: "synthetic_k2_personnel_cost",
    },
    {
      from: "7700",
      to: "7899",
      classification: "expense",
      statementLeaf: "synthetic_k2_depreciation",
    },
    {
      from: "7900",
      to: "7999",
      classification: "expense",
      statementLeaf: "synthetic_k2_other_cost",
    },
  ],
};

export function resolveSyntheticStatementAccount(
  release: SyntheticStatementMappingRelease,
  code: string,
) {
  const ranges = [...release.ranges].sort((left, right) =>
    left.from < right.from ? -1 : left.from > right.from ? 1 : 0,
  );

  if (
    release.schema !== "synthetic_se_statement_mapping_v1" ||
    release.qualification !== "synthetic_only" ||
    ranges.length === 0 ||
    ranges.length > 64 ||
    ranges.some(
      (range, index) =>
        !/^[3-7][0-9]{3}$/.test(range.from) ||
        !/^[3-7][0-9]{3}$/.test(range.to) ||
        range.from > range.to ||
        range.statementLeaf.length === 0 ||
        !["income", "expense"].includes(range.classification) ||
        (index > 0 && ranges[index - 1]!.to >= range.from),
    )
  )
    return { status: "unknown" as const, reason: "invalid_release" as const };

  const range = /^[0-9]{4}$/.test(code)
    ? ranges.find((item) => item.from <= code && code <= item.to)
    : undefined;

  return range
    ? {
        status: "known" as const,
        classification: range.classification,
        placement: "income_statement" as const,
        statementLeaf: range.statementLeaf,
      }
    : { status: "unknown" as const, reason: "account_not_mapped" as const };
}
