import { capabilities } from "../capabilities";
import { scopeFromPath } from "../operation-scope";
import { Api } from "@open-erp/contracts/api";

import { signBankReconciliation } from "../banking/signoffs";

import { defineHttpOperation, bindHttpOperation } from "../capabilities/http-operation";

export const BankSignoffOperations = {
  listBankSignoffs: bindHttpOperation(
    Api.groups.bankSignoffs.endpoints.listBankSignoffs,
    capabilities.bank_list_signoffs,
    ({ params }) => ({ scope: scopeFromPath(params) }),
  ),
  getBankSignoff: bindHttpOperation(
    Api.groups.bankSignoffs.endpoints.getBankSignoff,
    capabilities.bank_get_signoff,
    ({ params }) => ({ scope: scopeFromPath(params), id: params.id }),
  ),
  signBankReconciliation: defineHttpOperation(
    Api.groups.bankSignoffs.endpoints.signBankReconciliation,
    (token, { params, headers, payload }) =>
      signBankReconciliation(token, {
        scope: scopeFromPath(params),
        planId: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  prepareBankSignoff: bindHttpOperation(
    Api.groups.bankSignoffs.endpoints.prepareBankSignoff,
    capabilities.bank_prepare_signoff,
    ({ params, headers, payload }) => ({
      scope: scopeFromPath(params),
      idempotencyKey: headers["idempotency-key"],
      input: payload,
    }),
  ),
};
