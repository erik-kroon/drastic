import type * as Sie from "@open-erp/contracts/sie-import";
import * as Effect from "effect/Effect";
import { failure } from "../failures";

type Preview = typeof Sie.SiePreview.Type;

type Input = typeof Sie.SealSiePlan.Type;

export function minorUnits(amount: string) {
  if (!/^-?\d+(\.\d{1,2})?$/.test(amount)) return undefined;
  const [whole = "0", fraction = ""] = amount.replace(/^-/, "").split(".");
  const minor = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));

  return amount.startsWith("-") ? -minor : minor;
}

export function checkControls(preview: Preview, input: Input) {
  return Effect.gen(function* () {
    const mapped = new Set(input.mappings.map((mapping) => mapping.sourceAccount));

    if (mapped.size !== input.mappings.length) return yield* failure("InvalidJournal");

    for (const record of preview.records) {
      if (!["KONTO", "TRANS", "RTRANS", "BTRANS", "IB", "UB", "RES"].includes(record.tag)) continue;
      const account = record.fields[["IB", "UB", "RES"].includes(record.tag) ? 1 : 0];

      if (account === undefined || !mapped.has(account)) return yield* failure("InvalidJournal");
    }

    const compared = new Set<string>();

    for (const control of input.openingControls) {
      const key = `${control.sourceAccount}:${control.year}`;

      if (!mapped.has(control.sourceAccount) || compared.has(key))
        return yield* failure("InvalidJournal");
      compared.add(key);

      const source = preview.controls.filter(
        (c) => c.account === control.sourceAccount && c.year === control.year,
      );

      const opening = source.filter((c) => c.kind === "IB");
      const closing = source.filter((c) => c.kind === "UB");

      if (
        opening.length !== 1 ||
        closing.length !== 1 ||
        minorUnits(opening[0]!.amount) !== BigInt(control.independentOpeningMinor) ||
        minorUnits(closing[0]!.amount) !== BigInt(control.independentClosingMinor)
      )
        return yield* failure("InvalidJournal");
    }

    if (
      input.openingControls.length === 0 ||
      preview.controls.some((c) => c.kind !== "RES" && !compared.has(`${c.account}:${c.year}`))
    )
      return yield* failure("InvalidJournal");
    const identities = new Set<string>();
    const balances = new Map<string, bigint>();

    for (const item of input.openItems) {
      const parsed = Date.parse(`${item.asOf}T00:00:00.000Z`);

      if (
        identities.has(item.sourceIdentity) ||
        !mapped.has(item.sourceAccount) ||
        !Number.isFinite(parsed) ||
        new Date(parsed).toISOString().slice(0, 10) !== item.asOf
      )
        return yield* failure("InvalidJournal");
      identities.add(item.sourceIdentity);
      const key = `${item.sourceAccount}:${item.currency}`;
      balances.set(key, (balances.get(key) ?? 0n) + BigInt(item.outstandingMinor));
    }

    const openCompared = new Set<string>();

    for (const control of input.openItemControls) {
      const key = `${control.sourceAccount}:${control.currency}`;

      if (
        openCompared.has(key) ||
        !mapped.has(control.sourceAccount) ||
        (balances.get(key) ?? 0n) !== BigInt(control.independentOutstandingMinor)
      )
        return yield* failure("InvalidJournal");
      openCompared.add(key);
    }

    if (
      [...balances.keys()].some((key) => !openCompared.has(key)) ||
      (input.openItems.length === 0 && input.openItemControls.length !== 0)
    )
      return yield* failure("InvalidJournal");
  });
}
