import { capabilities } from "../capabilities";
import { scopeFromPath } from "../operation-scope";
import { Api } from "@open-erp/contracts/api";

import { bindHttpOperation } from "../capabilities/http-operation";

export const SieOperations = {
  resumeSie: bindHttpOperation(
    Api.groups.sie.endpoints.resumeSie,
    capabilities.sie_resume,
    ({ params }) => ({ scope: scopeFromPath(params), id: params.id }),
  ),
  listSie: bindHttpOperation(
    Api.groups.sie.endpoints.listSie,
    capabilities.sie_list,
    ({ params, query: cursor }) => ({ scope: scopeFromPath(params), ...cursor }),
  ),
  getSie: bindHttpOperation(
    Api.groups.sie.endpoints.getSie,
    capabilities.sie_get,
    ({ params }) => ({ scope: scopeFromPath(params), id: params.id }),
  ),
  prepareSie: bindHttpOperation(
    Api.groups.sie.endpoints.prepareSie,
    capabilities.sie_prepare,
    ({ params, headers, payload }) => ({
      scope: scopeFromPath(params),
      idempotencyKey: headers["idempotency-key"],
      input: payload,
    }),
  ),
};
