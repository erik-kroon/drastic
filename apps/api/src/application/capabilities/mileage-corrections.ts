import { Capabilities } from "@open-erp/contracts/capabilities";
import { effectCapability } from "./shared";
import * as Owner from "../payroll/mileage-corrections";

export const mileageCorrectionCapabilities = {
  payroll_prepare_mileage_correction: effectCapability(
    Capabilities.payroll_prepare_mileage_correction,
    Owner.prepareMileageCorrection,
  ),
  payroll_review_mileage_correction: effectCapability(
    Capabilities.payroll_review_mileage_correction,
    Owner.reviewMileageCorrection,
  ),
  payroll_submit_mileage_correction: effectCapability(
    Capabilities.payroll_submit_mileage_correction,
    Owner.submitMileageCorrection,
  ),
  payroll_cancel_mileage_correction: effectCapability(
    Capabilities.payroll_cancel_mileage_correction,
    Owner.cancelMileageCorrection,
  ),
  payroll_get_mileage_correction: effectCapability(
    Capabilities.payroll_get_mileage_correction,
    Owner.getMileageCorrection,
  ),
  payroll_list_mileage_corrections: effectCapability(
    Capabilities.payroll_list_mileage_corrections,
    Owner.listMileageCorrections,
  ),
};
