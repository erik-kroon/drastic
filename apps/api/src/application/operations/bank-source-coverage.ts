import { capabilities } from "../capabilities";
import { scopeFromPath } from "../operation-scope";
import { Api } from "@open-erp/contracts/api";

import { bindHttpOperation } from "../capabilities/http-operation";

export const BankSourceCoverageOperations = {
  listBankSourceCoverage: bindHttpOperation(
    Api.groups.bankSourceCoverage.endpoints.listBankSourceCoverage,
    capabilities.bank_list_source_coverage,
    ({ params }) => ({ scope: scopeFromPath(params) }),
  ),
  getBankSourceCoverage: bindHttpOperation(
    Api.groups.bankSourceCoverage.endpoints.getBankSourceCoverage,
    capabilities.bank_get_source_coverage,
    ({ params }) => ({ scope: scopeFromPath(params), id: params.id }),
  ),
  createBankSourceCoverage: bindHttpOperation(
    Api.groups.bankSourceCoverage.endpoints.createBankSourceCoverage,
    capabilities.bank_create_source_coverage,
    ({ params, headers, payload }) => ({
      scope: scopeFromPath(params),
      idempotencyKey: headers["idempotency-key"],
      input: payload,
    }),
  ),
};
