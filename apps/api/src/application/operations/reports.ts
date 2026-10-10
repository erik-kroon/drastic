import { capabilities } from "../capabilities";
import { scopeFromPath } from "../operation-scope";
import { Api } from "@open-erp/contracts/api";

import { bindHttpOperation } from "../capabilities/http-operation";

export const ReportOperations = {
  reportExplanation: bindHttpOperation(
    Api.groups.reports.endpoints.reportExplanation,
    capabilities.reports_explain,
    ({ params, query }) => ({
      scope: scopeFromPath(params),
      reportId: params.id,
      lineId: params.lineId,
      after: query.after,
    }),
  ),
  reportGeneralLedger: bindHttpOperation(
    Api.groups.reports.endpoints.reportGeneralLedger,
    capabilities.reports_general_ledger,
    ({ params, query }) => ({
      scope: scopeFromPath(params),
      reportId: params.id,
      lineId: params.lineId,
      after: query.after,
    }),
  ),
  reportLines: bindHttpOperation(
    Api.groups.reports.endpoints.reportLines,
    capabilities.reports_lines,
    ({ params, query }) => ({
      scope: scopeFromPath(params),
      reportId: params.id,
      after: query.after,
    }),
  ),
  getReport: bindHttpOperation(
    Api.groups.reports.endpoints.getReport,
    capabilities.reports_get,
    ({ params }) => ({ scope: scopeFromPath(params), reportId: params.id }),
  ),
  prepareReport: bindHttpOperation(
    Api.groups.reports.endpoints.prepareReport,
    capabilities.reports_prepare,
    ({ params, headers, payload }) => ({
      scope: scopeFromPath(params),
      idempotencyKey: headers["idempotency-key"],
      input: payload,
    }),
  ),
  listReports: bindHttpOperation(
    Api.groups.reports.endpoints.listReports,
    capabilities.reports_list,
    ({ params, query }) => ({ scope: scopeFromPath(params), after: query.after }),
  ),
  compareReports: bindHttpOperation(
    Api.groups.reports.endpoints.compareReports,
    capabilities.reports_compare,
    ({ params, query }) => ({
      scope: scopeFromPath(params),
      leftReportId: params.id,
      rightReportId: params.otherId,
      after: query.after,
    }),
  ),
  getReportFamily: bindHttpOperation(
    Api.groups.reports.endpoints.getReportFamily,
    capabilities.reports_get_family,
    ({ params }) => ({ scope: scopeFromPath(params), reportId: params.id }),
  ),
  prepareReportFamily: bindHttpOperation(
    Api.groups.reports.endpoints.prepareReportFamily,
    capabilities.reports_prepare_family,
    ({ params, headers, payload }) => ({
      scope: scopeFromPath(params),
      idempotencyKey: headers["idempotency-key"],
      input: payload,
    }),
  ),
};
