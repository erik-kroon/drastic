import * as Contracts from "@open-erp/contracts/historical-adoptions";
import * as Domain from "@open-erp/domain/historical-adoptions";
import * as Effect from "effect/Effect";
import * as Db from "../../db/commerce/historical-settlements";
import * as AdoptionDb from "../../db/historical-adoptions";
import type { Transaction } from "../../db/transaction";
import { decode, withBook, type Scope } from "./support";
import { failure } from "../failures";
import { digest } from "../json";
import { checkedAdoption } from "../sie/adoption-basis";

export const readHistoricalObligation = Effect.fn("commerce.readHistoricalObligation")(function* (
  tx: Transaction,
  scope: Scope,
  id: string,
) {
  const row = (yield* AdoptionDb.readAdoption(tx, scope.bookId, id))[0];

  if (!row) return yield* failure("NotFound");
  const adoption = yield* decode(Contracts.Adoption, row.body);

  const settlements = yield* Effect.forEach(
    yield* Db.readSettlements(tx, scope.bookId, adoption.id),
    (row) => decode(Contracts.Settlement, row.body),
  );

  const amounts = settlements.map((row) => row.amountMinor);

  const remainingMinor = yield* checkedAdoption(
    Domain.historicalObligationRemaining({
      openingResidualMinor: adoption.openingResidualMinor,
      settlementMinor: amounts,
      supportedCreditMinor: [],
      supportedCorrectionMinor: [],
    }),
  );

  yield* checkedAdoption(
    Domain.assertLiveControl({
      openingMinor: adoption.openingResidualMinor,
      liveMinor: remainingMinor,
      settlementMinor: amounts,
      creditMinor: [],
      correctionMinor: [],
    }),
  );

  return yield* decode(Contracts.Obligation, {
    adoption,
    remainingMinor,
    settledMinor: amounts.reduce((sum, row) => sum + BigInt(row), 0n).toString(),
    version: yield* digest(
      settlements.map((row) => ({ id: row.id, amountMinor: row.amountMinor })),
    ),
    creditSupport: "original_tax_detail_required",
  });
});

export const getHistoricalObligation = Effect.fn("commerce.getHistoricalObligation")(function* (
  token: string,
  command: { scope: Scope; id: string },
) {
  return yield* withBook(token, command.scope, false, function* (tx) {
    return yield* readHistoricalObligation(tx, command.scope, command.id);
  });
});

export const prepareHistoricalCredit = Effect.fn("commerce.prepareHistoricalCredit")(function* (
  token: string,
  command: { scope: Scope; id: string; idempotencyKey: string; input: { rationale: string } },
) {
  return yield* withBook(token, command.scope, true, function* (tx) {
    yield* readHistoricalObligation(tx, command.scope, command.id);

    return yield* checkedAdoption(Domain.refuseResidualCredit(command.input.rationale));
  });
});
