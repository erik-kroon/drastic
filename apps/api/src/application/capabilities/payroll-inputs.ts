import { Capabilities } from "@open-erp/contracts/capabilities";
import { effectCapability } from "./shared";
import * as Owner from "../payroll/inputs";

export const payrollInputCapabilities = {
  payroll_submit_input: effectCapability(Capabilities.payroll_submit_input, Owner.submitInput),
  payroll_review_input: effectCapability(Capabilities.payroll_review_input, Owner.reviewInput),
  payroll_prepare_input_payment: effectCapability(
    Capabilities.payroll_prepare_input_payment,
    Owner.prepareDirectPayment,
  ),
  payroll_approve_input: effectCapability(Capabilities.payroll_approve_input, Owner.approveInput),
  payroll_execute_input: effectCapability(Capabilities.payroll_execute_input, Owner.executeInput),
  payroll_get_input: effectCapability(Capabilities.payroll_get_input, Owner.getInput),
};
