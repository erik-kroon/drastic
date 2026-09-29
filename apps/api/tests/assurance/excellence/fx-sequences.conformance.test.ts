import { expect, test } from "vitest";
import * as F from "@open-erp/domain/fx-remeasurement";
import { succeeded, failedWith } from "../pure-support";
import {
  generator,
  assertExactRows,
} from "../../../../../verification/assurance/excellence/models/supplier.mjs";

function input(
  direction: "receivable" | "payable",
  units: string,
  carrying: string,
  numerator: string,
  version: string,
): F.ValuationSelection {
  return {
    currency: "USD",
    accountingCutoff: "2026-09-30",
    recordedCutoff: "2026-10-01T00:00:00Z",
    complete: true,
    expectedItemCount: 1,
    bookScale: 2,
    unrealizedGainAccountId: "account_gain",
    unrealizedLossAccountId: "account_loss",
    economicDecisionId: `valuation_${version}`,
    supersedesEffectId: null,
    items: [
      {
        itemId: "item_one",
        direction,
        controlAccountId: "account_control",
        remainingOriginalMinor: units,
        originalScale: 2,
        currentBookCarryingMinor: carrying,
        capacityVersion: version,
        consumedAfterCutoff: false,
        rateRevisionId: `rate_${version}`,
        rateNumerator: numerator,
        rateDenominator: "100",
        rounding: "half_up",
      },
    ],
  };
}

for (const direction of ["receivable", "payable"] as const) {
  test(`[EXC-FX-${direction}] generated valuation chains preserve quantities and post only changes in current carrying`, () => {
    const random = generator(direction === "receivable" ? 1234 : 4321);
    const units = 10000n;
    let carrying = 100000n;
    const deltas: string[] = [];

    for (let i = 0; i < 150; i++) {
      const numerator = BigInt(900 + (random() % 300)),
        target = (units * numerator) / 100n;

      const selection = input(
        direction,
        String(units),
        String(carrying),
        String(numerator),
        String(i + 1),
      );

      const plan = succeeded(F.prepareValuation(selection)),
        delta = target - carrying;

      expect(plan.effects[0]?.targetCarryingMinor).toBe(String(target));
      expect(plan.effects[0]?.deltaMinor).toBe(String(delta));
      const control = direction === "receivable" ? delta : -delta;

      const wanted =
        control === 0n
          ? []
          : [
              { accountId: "account_control", signedMinor: String(control) },
              {
                accountId: control > 0n ? "account_gain" : "account_loss",
                signedMinor: String(-control),
              },
            ];

      assertExactRows(
        plan.journal.map((r) => ({
          accountId: r.accountId,
          signedMinor: String(BigInt(r.debitMinor) - BigInt(r.creditMinor)),
        })),
        wanted,
      );
      expect(plan.consumesVoucher).toBe(delta !== 0n);
      deltas.push(String(delta));
      carrying = target;
      expect(F.carryingAfter("100000", deltas, [])).toBe(String(carrying));

      const replayed = succeeded(
        F.prepareValuation({
          ...selection,
          items: [{ ...selection.items[0]!, currentBookCarryingMinor: String(carrying) }],
        }),
      );

      expect(replayed.journal).toEqual([]);
      expect(replayed.effects[0]?.deltaMinor).toBe("0");
    }
  });
}

test("[EXC-FX-MEMBERSHIP] complete membership cannot be substituted by duplicates or a late new item", () => {
  const s = input("receivable", "10000", "100000", "1085", "1");
  const p = succeeded(F.prepareValuation(s));
  failedWith(F.prepareValuation({ ...s, complete: false }), "IncompletePopulation");
  failedWith(F.prepareValuation({ ...s, expectedItemCount: 2 }), "IncompletePopulation");
  failedWith(
    F.prepareValuation({ ...s, expectedItemCount: 2, items: [s.items[0]!, s.items[0]!] }),
    "DuplicateItem",
  );
  failedWith(
    F.assertValuationMembership(p, [
      ...p.membership,
      { itemId: "late_item", capacityVersion: "1" },
    ]),
    "StalePopulation",
  );
  failedWith(
    F.assertValuationMembership(p, [{ itemId: "item_one", capacityVersion: "2" }]),
    "StalePopulation",
  );
  failedWith(
    F.prepareValuation({ ...s, items: [{ ...s.items[0]!, consumedAfterCutoff: true }] }),
    "UnsupportedLaterConsumption",
  );
});
