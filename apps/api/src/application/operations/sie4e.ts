import { capabilities } from "../capabilities";
import { Api } from "@open-erp/contracts/api";

import { scopeFromPath } from "../operation-scope";

import { bindHttpOperation } from "../capabilities/http-operation";

export const Sie4EOperations = {
  resumeSie4E: bindHttpOperation(
    Api.groups.sieFullBook.endpoints.resumeSie4E,
    capabilities.sie4e_resume,
    ({ params }) => ({ scope: scopeFromPath(params), id: params.id }),
  ),
  listSie4E: bindHttpOperation(
    Api.groups.sieFullBook.endpoints.listSie4E,
    capabilities.sie4e_list,
    ({ params, query }) => ({ scope: scopeFromPath(params), after: query.after }),
  ),
  sie4ERows: bindHttpOperation(
    Api.groups.sieFullBook.endpoints.sie4ERows,
    capabilities.sie4e_rows,
    ({ params, query }) => ({ scope: scopeFromPath(params), id: params.id, after: query.after }),
  ),
  getSie4E: bindHttpOperation(
    Api.groups.sieFullBook.endpoints.getSie4E,
    capabilities.sie4e_get,
    ({ params }) => ({ scope: scopeFromPath(params), id: params.id }),
  ),
  prepareSie4E: bindHttpOperation(
    Api.groups.sieFullBook.endpoints.prepareSie4E,
    capabilities.sie4e_prepare,
    ({ params, headers, payload }) => ({
      scope: scopeFromPath(params),
      idempotencyKey: headers["idempotency-key"],
      input: payload,
    }),
  ),
};
