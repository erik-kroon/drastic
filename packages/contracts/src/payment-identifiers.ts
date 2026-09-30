import * as Schema from "effect/Schema";
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import {
  PaymentIdentifierInput,
  PaymentIdentifierResult,
  BankAccountHintInput,
  BankAccountHint,
} from "@open-erp/domain/payment-identifiers";
import { Scope } from "./accounting";
import { accountingErrors } from "./accounting-errors";

export { PaymentIdentifierInput, PaymentIdentifierResult };

export { BankAccountHintInput, BankAccountHint };

export const BankAccountHintView = Schema.Struct({ scope: Scope, result: BankAccountHint });

export const PaymentIdentifierView = Schema.Struct({
  scope: Scope,
  result: PaymentIdentifierResult,
});

export const PaymentIdentifiersApi = HttpApiGroup.make("paymentIdentifiers").add(
  HttpApiEndpoint.post(
    "checkPaymentIdentifier",
    "/v1/entities/:entityId/books/:bookId/commerce/payment-identifiers",
    {
      params: Scope,
      payload: PaymentIdentifierInput.annotate({ parseOptions: { onExcessProperty: "error" } }),
      success: PaymentIdentifierView,
      error: accountingErrors,
    },
  ),
  HttpApiEndpoint.post(
    "checkBankAccountHint",
    "/v1/entities/:entityId/books/:bookId/commerce/payment-identifiers/bank-account",
    {
      params: Scope,
      payload: BankAccountHintInput.annotate({ parseOptions: { onExcessProperty: "error" } }),
      success: BankAccountHintView,
      error: accountingErrors,
    },
  ),
);

export const PaymentIdentifierCapabilities = {
  payments_check_bank_account: {
    description:
      "Calculate a non-blocking clearing/account checksum hint under the explicit retained reference_r2_v1 rules. Unknown clearing or unsupported input stays no opinion, not invalid. Preserves original details, verifies no account existence and grants no payment authority.",
    input: Schema.Struct({ scope: Scope, input: BankAccountHintInput }),
    output: BankAccountHintView,
    readOnly: true,
  },
  payments_check_identifier: {
    description:
      "Check and format a bankgiro, plusgiro or OCR checksum, calculate a modulus-10 check digit or explicitly generate an OCR candidate. Preserves invalid input. Checksum validity verifies no bank account, invoice reference, payee or payment authority; stores and pays nothing.",
    input: Schema.Struct({ scope: Scope, input: PaymentIdentifierInput }),
    output: PaymentIdentifierView,
    readOnly: true,
  },
};
