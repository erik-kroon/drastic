import * as Effect from "effect/Effect";
import * as O from "@open-erp/contracts/onboarding";
import * as Commerce from "@open-erp/contracts/commerce";
import * as Db from "../db/onboarding-projection";
import * as InvoiceDb from "../db/commerce/invoices";
import type { Transaction } from "../db/transaction";
import { databaseFailure } from "../db/transaction";
import { decode, type Scope } from "./commerce/support";
import { failure } from "./failures";

export const readOnboardingProjectionInTransaction = Effect.fn("onboarding.readProjection")(
  function* (tx: Transaction, scope: Scope) {
    const row = (yield* Db.readProjectionMaterial(tx, scope).pipe(
      Effect.mapError(databaseFailure),
    ))[0];

    if (!row) return yield* failure("NotFound");
    const material = row.body;

    for (const value of Object.values(material)) {
      if (Array.isArray(value) && value.length > 1000) return yield* failure("UnsupportedProfile");
    }

    const identities = yield* InvoiceDb.readInvoiceIdentityPage(tx, scope.bookId, "", 1001).pipe(
      Effect.mapError(databaseFailure),
    );

    if (identities.length > 1000) return yield* failure("UnsupportedProfile");

    const invoices =
      identities.length === 0
        ? []
        : yield* InvoiceDb.readLiveInvoicePage(
            tx,
            scope.bookId,
            identities.map((item) => item.id),
          ).pipe(Effect.mapError(databaseFailure));

    const decoded = yield* Effect.forEach(invoices, (item) => decode(Commerce.Invoice, item.body));

    return yield* decode(O.OnboardingProjection, { ...material, invoices: decoded });
  },
);

type Explanation = {
  readonly controlId: string;
  readonly accountId: string;
  readonly explainedMinor: string;
  readonly evidenceIds: readonly string[];
};

export const qualifiedBankExplanationsInTransaction = Effect.fn("onboarding.bankExplanations")(
  function* (
    tx: Transaction,
    scope: Scope,
    asOf: string,
    controls: readonly (typeof O.OnboardingControl.Type)[],
  ) {
    const timing = controls.filter((control) => control.kind === "bank_reconciling_items");
    const facts = timing.flatMap((control) => control.facts);
    const identities = facts.map((fact) => fact.sourceIdentity);

    if (identities.length > 1000 || new Set(identities).size !== identities.length)
      return yield* failure("InvalidJournal");

    if (timing.some((control) => control.asOf !== asOf)) return yield* failure("StaleDependency");

    const lines =
      identities.length === 0
        ? []
        : yield* Db.readBankTimingLines(tx, scope.bookId, asOf, identities).pipe(
            Effect.mapError(databaseFailure),
          );

    if (lines.length !== identities.length) return yield* failure("StaleDependency");
    const explained = new Map<string, { amount: bigint; evidence: Set<string> }>();

    for (const fact of facts) {
      const line = lines.find((item) => item.identity === fact.sourceIdentity);

      if (
        !line ||
        line.accountId !== fact.accountId ||
        line.remainingMinor === "0" ||
        line.remainingMinor !== fact.amountMinor ||
        line.evidenceIds.length === 0
      )
        return yield* failure("StaleDependency");

      const paired = controls.filter(
        (control) =>
          control.kind === "bank" &&
          control.asOf === asOf &&
          control.facts.some((item) => item.accountId === fact.accountId),
      );

      if (paired.length !== 1) return yield* failure("InvalidJournal");
      const bank = paired[0];

      if (
        !bank ||
        timing.some((control) => control.facts.includes(fact) && control.currency !== bank.currency)
      )
        return yield* failure("InvalidJournal");
      const key = `${bank.id}:${fact.accountId}`;
      const entry = explained.get(key) ?? { amount: 0n, evidence: new Set<string>() };
      entry.amount += BigInt(line.remainingMinor);

      for (const id of line.evidenceIds) entry.evidence.add(id);
      explained.set(key, entry);
    }

    const result: Explanation[] = [];

    for (const control of controls.filter((item) => item.kind === "bank")) {
      for (const accountId of new Set(control.facts.map((fact) => fact.accountId))) {
        const entry = explained.get(`${control.id}:${accountId}`);

        if (entry)
          result.push({
            controlId: control.id,
            accountId,
            explainedMinor: entry.amount.toString(),
            evidenceIds: [...entry.evidence].sort(),
          });
      }
    }

    return result;
  },
);
