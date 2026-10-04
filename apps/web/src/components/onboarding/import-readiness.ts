import type * as Sie from "@open-erp/contracts/sie-import";

export function missingSourceAccounts(
  preview: typeof Sie.SiePreview.Type | undefined,
  accounts: readonly { active: boolean; code: string }[],
) {
  return [
    ...new Set(
      preview?.vouchers.flatMap((voucher) =>
        voucher.transactions
          .filter(
            (item) => !accounts.some((account) => account.active && account.code === item.account),
          )
          .map((item) => item.account),
      ) ?? [],
    ),
  ];
}

export function importReadiness(
  preview: typeof Sie.SiePreview.Type | undefined,
  unresolvedAccounts: readonly string[],
  findings: readonly { voucherOrdinal: number }[],
) {
  if (!preview) return { total: null, ready: null, decisions: null };

  const affected = new Set(
    preview.vouchers
      .filter((voucher) =>
        voucher.transactions.some((line) => unresolvedAccounts.includes(line.account)),
      )
      .map((voucher) => voucher.ordinal),
  );

  for (const finding of findings) affected.add(finding.voucherOrdinal);

  for (const diagnostic of preview.diagnostics) {
    const record = preview.records.find((entry) => entry.line === diagnostic.line);

    if (record?.voucherOrdinal) affected.add(record.voucherOrdinal);
    else for (const voucher of preview.vouchers) affected.add(voucher.ordinal);
  }

  return {
    total: preview.vouchers.length,
    ready: preview.vouchers.length - affected.size,
    decisions: affected.size,
  };
}
