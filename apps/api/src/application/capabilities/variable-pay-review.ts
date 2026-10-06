import { Capabilities } from "@open-erp/contracts/capabilities";
import { effectCapability } from "./shared";
import * as Owner from "../payroll/variable-pay";

export const variablePayReviewCapabilities = {
  payroll_assess_variable_input: effectCapability(
    Capabilities.payroll_assess_variable_input,
    Owner.assessVariablePay,
  ),
  payroll_select_variable_input: effectCapability(
    Capabilities.payroll_select_variable_input,
    Owner.selectVariablePay,
  ),
  payroll_dispose_variable_input: effectCapability(
    Capabilities.payroll_dispose_variable_input,
    Owner.disposeVariablePay,
  ),
  payroll_get_variable_assessment: effectCapability(
    Capabilities.payroll_get_variable_assessment,
    Owner.getVariablePayAssessment,
  ),
  payroll_list_variable_assessments: effectCapability(
    Capabilities.payroll_list_variable_assessments,
    Owner.listVariablePayAssessments,
  ),
};
