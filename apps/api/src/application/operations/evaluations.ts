import { capabilities } from "../capabilities";
import { Api } from "@open-erp/contracts/api";

import { scopeFromPath } from "../operation-scope";

import { bindHttpOperation } from "../capabilities/http-operation";

export const EvaluationOperations = {
  getEvaluationContract: bindHttpOperation(
    Api.groups.evaluations.endpoints.getEvaluationContract,
    capabilities.evaluation_get_contract,
    ({ params }) => ({ scope: scopeFromPath(params), id: params.id }),
  ),
  captureEvaluationContract: bindHttpOperation(
    Api.groups.evaluations.endpoints.captureEvaluationContract,
    capabilities.evaluation_capture_contract,
    ({ params, headers, payload }) => ({
      scope: scopeFromPath(params),
      idempotencyKey: headers["idempotency-key"],
      input: payload,
    }),
  ),
};
