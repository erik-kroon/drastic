import { minor } from "./money.mjs";

export function validateVoucher(engine, lines) {
  if (!Array.isArray(lines) || lines.length > 2000)
    throw new RangeError("Maximum 2000 voucher lines");
  let rows = engine.c("Ledger.End");

  for (const row of lines.toReversed())
    rows = engine.c(
      "Ledger.Line",
      engine.nat(minor(row.debitMinor)),
      engine.nat(minor(row.creditMinor)),
      rows,
    );
  const result = engine.call("Ledger.validate", rows);

  return {
    accepted: result.k === "Ledger.Accepted",
    debitMinor: engine.fromNat(engine.call("Ledger.debits", rows)).toString(),
    creditMinor: engine.fromNat(engine.call("Ledger.credits", rows)).toString(),
    scopeChecked: false,
    postingAuthorized: false,
  };
}

export function allocate(engine, { amountMinor, sourceRemainingMinor, targetRemainingMinor }) {
  const result = engine.call(
    "Allocation.allocate",
    engine.nat(minor(amountMinor)),
    engine.nat(minor(sourceRemainingMinor)),
    engine.nat(minor(targetRemainingMinor)),
  );

  if (result.k !== "Allocation.Allocated")
    return { status: result.k.split(".").at(-1), mayExecute: false };
  const allocation = engine.force(result.x[0]);
  const restored = engine.call("Allocation.restore", result.x[0]);

  return {
    status: "allocated-arithmetic",
    amountMinor: engine.fromNat(allocation.x[0]).toString(),
    sourceAfterMinor: engine.fromNat(allocation.x[3]).toString(),
    targetAfterMinor: engine.fromNat(allocation.x[4]).toString(),
    restoredSourceMinor: engine.fromNat(restored.x[0]).toString(),
    restoredTargetMinor: engine.fromNat(restored.x[1]).toString(),
    mayExecute: false,
  };
}
