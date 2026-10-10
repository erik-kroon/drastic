import { capabilities } from "../capabilities";
import { scopeFromPath } from "../operation-scope";
import { Api } from "@open-erp/contracts/api";

import {
  approveAnnualReport,
  finalizeAnnualReport,
  prepareAnnualReport,
  prepareReportPresentation,
  renderReportArtifact,
} from "../reports/annual-report";

import { defineHttpOperation, bindHttpOperation } from "../capabilities/http-operation";

export const AnnualReportOperations = {
  annualReportHistory: bindHttpOperation(
    Api.groups.annualReport.endpoints.annualReportHistory,
    capabilities.reports_annual_report_history,
    ({ params }) => ({ scope: scopeFromPath(params), id: params.id }),
  ),
  getAnnualReport: bindHttpOperation(
    Api.groups.annualReport.endpoints.getAnnualReport,
    capabilities.reports_get_annual_report,
    ({ params }) => ({ scope: scopeFromPath(params), id: params.id }),
  ),
  renderReportArtifact: defineHttpOperation(
    Api.groups.annualReport.endpoints.renderReportArtifact,
    (token, { params, headers, payload }) =>
      renderReportArtifact(token, {
        scope: scopeFromPath(params),
        presentationId: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  prepareReportPresentation: defineHttpOperation(
    Api.groups.annualReport.endpoints.prepareReportPresentation,
    (token, { params, headers, payload }) =>
      prepareReportPresentation(token, {
        scope: scopeFromPath(params),
        finalId: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  finalizeAnnualReport: defineHttpOperation(
    Api.groups.annualReport.endpoints.finalizeAnnualReport,
    (token, { params, headers, payload }) =>
      finalizeAnnualReport(token, {
        scope: scopeFromPath(params),
        draftId: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  approveAnnualReport: defineHttpOperation(
    Api.groups.annualReport.endpoints.approveAnnualReport,
    (token, { params, headers, payload }) =>
      approveAnnualReport(token, {
        scope: scopeFromPath(params),
        draftId: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  prepareAnnualReport: defineHttpOperation(
    Api.groups.annualReport.endpoints.prepareAnnualReport,
    (token, { params, headers, payload }) =>
      prepareAnnualReport(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
};
