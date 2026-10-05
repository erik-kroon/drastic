import { Capabilities } from "@open-erp/contracts/capabilities";
import { effectCapability } from "./shared";
import * as Owner from "../payroll/employee-claims";
import * as Payments from "../payroll/employee-claim-payments";

export const employeeClaimCapabilities = {
  payroll_submit_employee_claim: effectCapability(
    Capabilities.payroll_submit_employee_claim,
    Owner.submitEmployeeClaim,
  ),
  payroll_list_employee_claims: effectCapability(
    Capabilities.payroll_list_employee_claims,
    Owner.listEmployeeClaims,
  ),
  payroll_get_employee_claim: effectCapability(
    Capabilities.payroll_get_employee_claim,
    Owner.getEmployeeClaim,
  ),
  payroll_revise_employee_claim: effectCapability(
    Capabilities.payroll_revise_employee_claim,
    Owner.reviseEmployeeClaim,
  ),
  payroll_review_employee_claim: effectCapability(
    Capabilities.payroll_review_employee_claim,
    Owner.reviewEmployeeClaim,
  ),
  payroll_approve_employee_claim: effectCapability(
    Capabilities.payroll_approve_employee_claim,
    Owner.approveEmployeeClaim,
  ),
  payroll_request_claim_completion: effectCapability(
    Capabilities.payroll_request_claim_completion,
    Owner.requestClaimCompletion,
  ),
  payroll_propose_employee_payee: effectCapability(
    Capabilities.payroll_propose_employee_payee,
    Payments.proposeEmployeePayee,
  ),
  payroll_verify_employee_payee: effectCapability(
    Capabilities.payroll_verify_employee_payee,
    Payments.verifyEmployeePayee,
  ),
  payroll_prepare_claim_payment_file: effectCapability(
    Capabilities.payroll_prepare_claim_payment_file,
    Payments.prepareClaimPaymentFile,
  ),
  payroll_approve_claim_payment_file: effectCapability(
    Capabilities.payroll_approve_claim_payment_file,
    Payments.approveClaimPaymentFile,
  ),
  payroll_prepare_claim_settlement: effectCapability(
    Capabilities.payroll_prepare_claim_settlement,
    Payments.prepareClaimSettlement,
  ),
  payroll_approve_claim_settlement: effectCapability(
    Capabilities.payroll_approve_claim_settlement,
    Payments.approveClaimSettlement,
  ),
};
