import * as Effect from "effect/Effect";
import * as Contracts from "@open-erp/contracts/payment-identifiers";
import { checkPaymentIdentifier } from "@open-erp/domain/payment-identifiers";
import { decode, toJsonObject, withBook, type Scope } from "../commerce/support";

export const inspectPaymentIdentifier = Effect.fn("payments.inspectIdentifier")(function* (
  token: string,
  command: { readonly scope: Scope; readonly input: typeof Contracts.PaymentIdentifierInput.Type },
) {
  return yield* withBook(token, command.scope, false, function* () {
    return yield* decode(
      Contracts.PaymentIdentifierView,
      yield* toJsonObject({ scope: command.scope, result: checkPaymentIdentifier(command.input) }),
    );
  });
});
