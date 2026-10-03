import * as Result from "effect/Result";

export function exactCommercialBase(quantity: string, unitPriceMinor: string) {
  const [whole = "0", fraction = ""] = quantity.split(".");
  const scale = 10n ** BigInt(fraction.length);
  const product = BigInt(whole + fraction) * BigInt(unitPriceMinor);

  return product % scale === 0n ? product / scale : null;
}

export function commercialLineAmounts(input: {
  readonly quantity: string;
  readonly unitPriceMinor: string;
  readonly discountMinor: string;
  readonly chargeMinor: string;
  readonly taxRule: "line-tax-half-up-minor-25-v1" | "unresolved";
}) {
  const base = exactCommercialBase(input.quantity, input.unitPriceMinor);
  const discount = BigInt(input.discountMinor);
  const charge = BigInt(input.chargeMinor);
  const maximum = 10n ** 38n;

  if (base === null || discount > base || base >= maximum) return Result.fail("InvalidJournal");
  const net = base - discount + charge;
  const tax = input.taxRule === "unresolved" ? null : (net * 25n + 50n) / 100n;
  const gross = tax === null ? null : net + tax;

  if (net >= maximum || (gross !== null && gross >= maximum)) return Result.fail("InvalidJournal");

  return Result.succeed({ base, net, tax, gross });
}
