export const workGroupAccounts: Array<{ id: string; code: string; name: string }>;

export function seedWorkGroup(config: { base: string; cookie: string; periodId: string }): Promise<{
  changed: unknown;
  unfamiliar: unknown;
  priorReceiptId: string;
  candidates: unknown[];
  expectedNetMinor: "20000";
  expectedTaxMinor: "5000";
  expectedGrossMinor: "25000";
}>;
