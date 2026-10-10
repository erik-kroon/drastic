import { capabilities } from "../capabilities";
import { scopeFromPath } from "../operation-scope";
import { Api } from "@open-erp/contracts/api";

import { bindHttpOperation } from "../capabilities/http-operation";

export const CashFlowOperations = {
  prepareCashFlowStatement: bindHttpOperation(
    Api.groups.cashFlow.endpoints.prepareCashFlowStatement,
    capabilities.reports_cash_flow_statement,
    ({ params, payload }) => ({
      scope: scopeFromPath(params),
      input: payload,
    }),
  ),
};
