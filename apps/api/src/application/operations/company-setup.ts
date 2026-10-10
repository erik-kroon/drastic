import { capabilities } from "../capabilities";
import { scopeFromPath } from "../operation-scope";
import { Api } from "@open-erp/contracts/api";

import { bindHttpOperation } from "../capabilities/http-operation";

export const CompanySetupOperations = {
  initializeNativeLedger: bindHttpOperation(
    Api.groups.companySetup.endpoints.initializeNativeLedger,
    capabilities.company_initialize_native_ledger,
    ({ params, headers, payload }) => ({
      scope: scopeFromPath(params),
      idempotencyKey: headers["idempotency-key"],
      input: payload,
    }),
  ),
  saveCompanySetup: bindHttpOperation(
    Api.groups.companySetup.endpoints.saveCompanySetup,
    capabilities.company_save_setup,
    ({ params, headers, payload }) => ({
      scope: scopeFromPath(params),
      idempotencyKey: headers["idempotency-key"],
      input: payload,
    }),
  ),
  getCompanySetup: bindHttpOperation(
    Api.groups.companySetup.endpoints.getCompanySetup,
    capabilities.company_get_setup,
    ({ params }) => ({ scope: scopeFromPath(params) }),
  ),
  createCompany: bindHttpOperation(
    Api.groups.companySetup.endpoints.createCompany,
    capabilities.company_create,
    ({ headers, payload }) => ({
      idempotencyKey: headers["idempotency-key"],
      input: payload,
    }),
  ),
};
