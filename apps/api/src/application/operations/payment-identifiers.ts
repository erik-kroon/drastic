import { capabilities } from "../capabilities";
import { Api } from "@open-erp/contracts/api";
import { scopeFromPath } from "../operation-scope";

import { bindHttpOperation } from "../capabilities/http-operation";

export const PaymentIdentifierOperations = {
  checkBankAccountHint: bindHttpOperation(
    Api.groups.paymentIdentifiers.endpoints.checkBankAccountHint,
    capabilities.payments_check_bank_account,
    ({ params, payload }) => ({ scope: scopeFromPath(params), input: payload }),
  ),
  checkPaymentIdentifier: bindHttpOperation(
    Api.groups.paymentIdentifiers.endpoints.checkPaymentIdentifier,
    capabilities.payments_check_identifier,
    ({ params, payload }) => ({ scope: scopeFromPath(params), input: payload }),
  ),
};
