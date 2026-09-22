import * as Vat from "@open-erp/contracts/vat-returns";
import * as Effect from "effect/Effect";
import { query, scopeParameter } from "../db/query";
import { calculateVatDraft } from "@open-erp/jurisdiction-se/vat";

export const prepareVatDraft = Effect.fn("prepareVatDraft")(function* (
  token: string,
  command: typeof Vat.PrepareVatCommand.Type,
) {
  const scope = scopeParameter(command.scope);
  const basis = yield* query("vatReturnBasis", [token, scope], Vat.VatBasis);
  const calculation = calculateVatDraft(basis, command.input);
  return yield* query(
    "sealVatReturnDraft",
    [
      token,
      scope,
      command.idempotencyKey,
      JSON.stringify(command.input),
      JSON.stringify(basis),
      JSON.stringify(calculation),
    ],
    Vat.VatDraft,
  );
});
