import { capabilities } from "../capabilities";
import { Api } from "@open-erp/contracts/api";

import * as Payslips from "../payroll/payslips";
import { scopeFromPath } from "../operation-scope";

import { defineHttpOperation, bindHttpOperation } from "../capabilities/http-operation";

export const PayrollRunOperations = {
  renderPayrollPayslip: defineHttpOperation(
    Api.groups.payrollRun.endpoints.renderPayrollPayslip,
    (token, { params, headers, payload }) =>
      Payslips.renderPayslip(token, {
        scope: scopeFromPath(params),
        documentId: params.documentId,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  getPayrollPayslipArtifact: bindHttpOperation(
    Api.groups.payrollRun.endpoints.getPayrollPayslipArtifact,
    capabilities.payroll_get_payslip_artifact,
    ({ params }) => ({
      scope: scopeFromPath(params),
      documentId: params.documentId,
    }),
  ),
  getPayrollPayslip: bindHttpOperation(
    Api.groups.payrollRun.endpoints.getPayrollPayslip,
    capabilities.payroll_get_payslip,
    ({ params }) => ({ scope: scopeFromPath(params), documentId: params.documentId }),
  ),
  listPayrollRuns: bindHttpOperation(
    Api.groups.payrollRun.endpoints.listPayrollRuns,
    capabilities.payroll_list_runs,
    ({ params, query }) => ({ scope: scopeFromPath(params), after: query.after }),
  ),
  getPayrollRun: bindHttpOperation(
    Api.groups.payrollRun.endpoints.getPayrollRun,
    capabilities.payroll_get_run,
    ({ params }) => ({ scope: scopeFromPath(params), runId: params.runId }),
  ),
  executePayrollRun: bindHttpOperation(
    Api.groups.payrollRun.endpoints.executePayrollRun,
    capabilities.payroll_execute_run,
    ({ params, headers, payload }) => ({
      scope: scopeFromPath(params),
      runId: params.runId,
      idempotencyKey: headers["idempotency-key"],
      input: payload,
    }),
  ),
  approvePayrollRun: bindHttpOperation(
    Api.groups.payrollRun.endpoints.approvePayrollRun,
    capabilities.payroll_approve_run,
    ({ params, headers, payload }) => ({
      scope: scopeFromPath(params),
      runId: params.runId,
      idempotencyKey: headers["idempotency-key"],
      input: payload,
    }),
  ),
  preparePayrollRun: bindHttpOperation(
    Api.groups.payrollRun.endpoints.preparePayrollRun,
    capabilities.payroll_prepare_run,
    ({ params, headers, payload }) => ({
      scope: scopeFromPath(params),
      idempotencyKey: headers["idempotency-key"],
      input: payload,
    }),
  ),
};
