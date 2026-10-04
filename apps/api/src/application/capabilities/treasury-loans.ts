import { Capabilities } from "@open-erp/contracts/capabilities";
import { effectCapability } from "./shared";
import * as Owner from "../treasury/loans";

export const treasuryLoanCapabilities = {
  treasury_adopt_loan: effectCapability(Capabilities.treasury_adopt_loan, Owner.adopt),
  treasury_record_loan_rate: effectCapability(
    Capabilities.treasury_record_loan_rate,
    Owner.recordRate,
  ),
  treasury_prepare_loan_review: effectCapability(
    Capabilities.treasury_prepare_loan_review,
    Owner.prepare,
  ),
  treasury_approve_loan_review: effectCapability(
    Capabilities.treasury_approve_loan_review,
    Owner.approve,
  ),
  treasury_execute_loan_review: effectCapability(
    Capabilities.treasury_execute_loan_review,
    Owner.execute,
  ),
  treasury_get_loan: effectCapability(Capabilities.treasury_get_loan, Owner.get),
  treasury_get_loan_review: effectCapability(
    Capabilities.treasury_get_loan_review,
    Owner.getReview,
  ),
};
