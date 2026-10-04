import * as Effect from "effect/Effect";
import type * as O from "@open-erp/contracts/onboarding";
import type { Transaction } from "../db/transaction";
import * as Db from "../db/onboarding-lifecycle";
import { rejectedOnboardingControls } from "./onboarding-control-rejection";
import { isoNow } from "./posting";

type Projection = typeof O.OnboardingProjection.Type;

type Control = typeof O.OnboardingControl.Type;

export const readFirstPeriodProgress = Effect.fn("onboarding.firstPeriodProgress")(function* (
  tx: Transaction,
  current: typeof O.OnboardingCase.Type,
  projection: Projection,
  controls: readonly Control[],
  activation: typeof O.OnboardingActivationReceipt.Type | null,
) {
  if (!activation || !current.configuration.dates.provingPeriodEndsOn) return null;
  const checkedOn = (yield* isoNow(tx)).slice(0, 10);
  const startsOn = activation.authoritativeFrom;
  const endsOn = current.configuration.dates.provingPeriodEndsOn;
  const through = checkedOn < endsOn ? checkedOn : endsOn;
  const rejected = yield* rejectedOnboardingControls(tx, current.scope);

  const latest = controls
    .filter((control) => control.asOf >= startsOn && control.asOf <= through)
    .toSorted(
      (left, right) =>
        right.qualifiedAt.localeCompare(left.qualifiedAt) || right.id.localeCompare(left.id),
    );

  const selected = (kind: Control["kind"]) => {
    const control = latest.find((entry) => entry.kind === kind);

    return control && !rejected.has(control.id) ? control : undefined;
  };

  const original = selected("historical_originals");

  const bank = projection.bankStatements
    .filter(
      (statement) =>
        statement.startsOn >= startsOn &&
        statement.endsOn <= through &&
        statement.completeness.declaredComplete,
    )
    .toSorted((left, right) => right.endsOn.localeCompare(left.endsOn))[0];

  const matches = (kind: "sales_open_items" | "purchase_open_items") =>
    Effect.gen(function* () {
      const control = selected(kind);

      if (!control?.openItemDetails) return null;
      const balances = yield* Db.readBalances(tx, current.scope.bookId, control.asOf);
      const expected = new Map<string, bigint>();

      for (const fact of control.facts)
        expected.set(
          fact.accountId,
          (expected.get(fact.accountId) ?? 0n) + BigInt(fact.amountMinor),
        );

      if (
        [...expected].some(
          ([accountId, amount]) =>
            balances.find((balance) => balance.accountId === accountId)?.amount !==
            amount.toString(),
        )
      )
        return false;
      const direction = kind === "sales_open_items" ? "customer" : "supplier";

      const invoices = projection.invoices.filter(
        (invoice) => invoice.direction === direction && invoice.issuedOn <= control.asOf,
      );

      if (invoices.length !== control.openItemDetails.length) return false;

      return control.openItemDetails.every((item) => {
        const found = invoices.filter((invoice) => invoice.documentNumber === item.sourceIdentity);
        const invoice = found[0];

        return (
          found.length === 1 &&
          invoice !== undefined &&
          invoice.outstandingMinor !== null &&
          invoice.blockers.length === 0 &&
          invoice.currency === control.currency &&
          BigInt(invoice.outstandingMinor) * (direction === "supplier" ? -1n : 1n) ===
            BigInt(item.outstandingMinor)
        );
      });
    });

  return {
    checkedOn,
    bankThrough: bank?.endsOn ?? null,
    originalCoverage: original?.originalCoverage
      ? original.originalCoverage.rows.every((row) => row.occurrenceId !== null)
      : null,
    salesMatches: yield* matches("sales_open_items"),
    purchaseMatches: yield* matches("purchase_open_items"),
    pendingProposals: Number(
      (yield* Db.pendingAccountingWork(tx, current.scope.bookId, startsOn, endsOn))[0]?.count ??
        "0",
    ),
  } satisfies typeof O.OnboardingFirstPeriodProgress.Type;
});
