import { capabilities } from "../capabilities";
import { scopeFromPath } from "../operation-scope";
import { Api } from "@open-erp/contracts/api";

import { bindHttpOperation } from "../capabilities/http-operation";

export const RegisterReportOperations = {
  listRegisterReports: bindHttpOperation(
    Api.groups.registerReports.endpoints.listRegisterReports,
    capabilities.commerce_list_register_reports,
    ({ params, query }) => ({
      scope: scopeFromPath(params),
      after: query.after,
    }),
  ),
  getRegisterReport: bindHttpOperation(
    Api.groups.registerReports.endpoints.getRegisterReport,
    capabilities.commerce_get_register_report,
    ({ params }) => ({ scope: scopeFromPath(params), id: params.id }),
  ),
  createRegisterReport: bindHttpOperation(
    Api.groups.registerReports.endpoints.createRegisterReport,
    capabilities.commerce_create_register_report,
    ({ params, headers, payload }) => ({
      scope: scopeFromPath(params),
      idempotencyKey: headers["idempotency-key"],
      input: payload,
    }),
  ),
};
