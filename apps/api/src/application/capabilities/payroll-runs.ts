import { Capabilities } from "@open-erp/contracts/capabilities";
import { effectCapability } from "./shared";
import { prepareRun, approveRun, executeRun, getRun, listRuns } from "../payroll/runs";
import { getPayslip, getPayslipArtifact } from "../payroll/payslips";

export const payrollRunCapabilities = {
  payroll_prepare_run: effectCapability(Capabilities.payroll_prepare_run, prepareRun),
  payroll_approve_run: effectCapability(Capabilities.payroll_approve_run, approveRun),
  payroll_execute_run: effectCapability(Capabilities.payroll_execute_run, executeRun),
  payroll_get_run: effectCapability(Capabilities.payroll_get_run, getRun),
  payroll_list_runs: effectCapability(Capabilities.payroll_list_runs, listRuns),
  payroll_get_payslip: effectCapability(Capabilities.payroll_get_payslip, getPayslip),
  payroll_get_payslip_artifact: effectCapability(
    Capabilities.payroll_get_payslip_artifact,
    getPayslipArtifact,
  ),
};
