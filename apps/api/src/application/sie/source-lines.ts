import * as Accounting from "@open-erp/contracts/accounting";
import * as Sie from "@open-erp/contracts/sie-import";
import * as Effect from "effect/Effect";
import { failure } from "../failures";
import { minorUnits } from "./source-controls";

type Voucher = (typeof Sie.SiePreview.Type.vouchers)[number];

export const linesFor = Effect.fn("historical.sourceLines")(function* (
  plan: typeof Sie.SiePlan.Type,
  voucher: Voucher,
) {
  const lines: Array<(typeof Accounting.PrepareJournal.Type.lines)[number]> = [];

  for (const item of voucher.transactions.filter((row) => row.kind === "TRANS")) {
    const account = plan.input.mappings.find(
      (row) => row.sourceAccount === item.account,
    )?.accountId;

    const amount = minorUnits(item.amount);

    if (!account || amount === undefined || amount === 0n || item.dimensions !== "{}")
      return yield* failure("InvalidJournal");
    lines.push({
      accountId: account,
      debitMinor: (amount > 0n ? amount : 0n).toString(),
      creditMinor: (amount < 0n ? -amount : 0n).toString(),
      description: `SIE ${voucher.sourceReference}`,
    });
  }

  return lines;
});
