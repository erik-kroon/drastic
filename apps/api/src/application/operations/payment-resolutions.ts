import { capabilities } from "../capabilities";
import { scopeFromPath } from "../operation-scope";
import { Api } from "@open-erp/contracts/api";

import { preparePaymentReplacement } from "../purchases/payment-resolutions";

import { defineHttpOperation, bindHttpOperation } from "../capabilities/http-operation";

export const PaymentResolutionOperations = {
  preparePaymentReplacement: defineHttpOperation(
    Api.groups.paymentResolutions.endpoints.preparePaymentReplacement,
    (token, { params, headers, payload }) =>
      preparePaymentReplacement(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  resolvePaymentInstruction: bindHttpOperation(
    Api.groups.paymentResolutions.endpoints.resolvePaymentInstruction,
    capabilities.payments_resolve_instruction,
    ({ params, headers, payload }) => ({
      scope: scopeFromPath(params),
      idempotencyKey: headers["idempotency-key"],
      input: payload,
    }),
  ),
};
