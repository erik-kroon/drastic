import { capabilities } from "../capabilities";
import { scopeFromPath } from "../operation-scope";
import { Api } from "@open-erp/contracts/api";

import * as Commerce from "../commerce/legal";

import { defineHttpOperation, bindHttpOperation } from "../capabilities/http-operation";

export const LegalSalesPolicyOperations = {
  getLegalSalesPolicy: bindHttpOperation(
    Api.groups.legalSalesPolicies.endpoints.getLegalSalesPolicy,
    capabilities.commerce_get_legal_sales_policy,
    ({ params }) => ({ scope: scopeFromPath(params), id: params.id }),
  ),
  legalSalesPolicyHistory: bindHttpOperation(
    Api.groups.legalSalesPolicies.endpoints.legalSalesPolicyHistory,
    capabilities.commerce_legal_sales_policy_history,
    ({ params }) => ({ scope: scopeFromPath(params) }),
  ),
  activateLegalSalesPolicy: defineHttpOperation(
    Api.groups.legalSalesPolicies.endpoints.activateLegalSalesPolicy,
    (token, { params, headers, payload }) =>
      Commerce.activateLegalSalesPolicy(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
};
