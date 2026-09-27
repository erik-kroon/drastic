import { loadEngine, validateVoucher, allocate, calculateVat, solveCover } from "../lib/index.mjs";

const e = await loadEngine();

const scope = { entityId: "demo-company", bookId: "demo-book", snapshotId: "immutable-snapshot-1" };

console.log(
  JSON.stringify(
    {
      authority: e.authority,
      voucher: validateVoucher(e, [
        { debitMinor: "125000", creditMinor: "0" },
        { debitMinor: "0", creditMinor: "125000" },
      ]),
      allocation: allocate(e, {
        amountMinor: "60000",
        sourceRemainingMinor: "100000",
        targetRemainingMinor: "90000",
      }),
      vat: calculateVat(e, {
        contributions: [
          { box: "10", signedMinor: "199", included: true },
          { box: "48", signedMinor: "101", included: true },
        ],
        currencyScale: 2,
        filingUnitScale: 0,
        rounding: "toward_zero",
        declareNet: true,
      }),
      cover: solveCover(e, {
        scope,
        currency: "SEK",
        scale: 2,
        direction: "inflow",
        targetMinor: "10000",
        poolComplete: true,
        candidates: ["4000", "6000", "10000"].map((n, i) => ({
          id: `line-${i}`,
          revision: "1",
          scope,
          currency: "SEK",
          scale: 2,
          direction: "inflow",
          remainingMinor: n,
        })),
        limits: { maxCardinality: 3, nodeBudget: 100 },
      }),
    },
    null,
    2,
  ),
);
