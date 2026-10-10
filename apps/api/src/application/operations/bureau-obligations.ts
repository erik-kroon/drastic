import { capabilities } from "../capabilities";
import { Api } from "@open-erp/contracts/api";

import { scopeFromPath } from "../operation-scope";

import { bindHttpOperation } from "../capabilities/http-operation";

export const BureauObligationsOperations = {
  listBureauObligations: bindHttpOperation(
    Api.groups.bureauObligations.endpoints.listBureauObligations,
    capabilities.bureau_list_obligations,
    ({ params }) => ({ scope: scopeFromPath(params) }),
  ),
};
