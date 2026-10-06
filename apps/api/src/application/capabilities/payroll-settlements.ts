import { Capabilities } from "@open-erp/contracts/capabilities";
import { effectCapability } from "./shared";
import * as Owner from "../payroll/settlements";

export const payrollSettlementCapabilities = {
  payroll_cancel_adjustment_instruction: effectCapability(
    Capabilities.payroll_cancel_adjustment_instruction,
    Owner.cancelAdjustmentInstruction,
  ),
  payroll_prepare_settlement: effectCapability(
    Capabilities.payroll_prepare_settlement,
    Owner.prepareSettlement,
  ),
  payroll_approve_settlement: effectCapability(
    Capabilities.payroll_approve_settlement,
    Owner.approveSettlement,
  ),
  payroll_execute_settlement: effectCapability(
    Capabilities.payroll_execute_settlement,
    Owner.executeSettlement,
  ),
  payroll_get_settlement: effectCapability(
    Capabilities.payroll_get_settlement,
    Owner.getSettlement,
  ),
  payroll_prepare_comparison: effectCapability(
    Capabilities.payroll_prepare_comparison,
    Owner.prepareComparison,
  ),
  payroll_record_adjustment_basis: effectCapability(
    Capabilities.payroll_record_adjustment_basis,
    Owner.recordAdjustmentBasis,
  ),
  payroll_prepare_period: effectCapability(
    Capabilities.payroll_prepare_period,
    Owner.preparePeriod,
  ),
  payroll_get_period: effectCapability(Capabilities.payroll_get_period, Owner.getPeriod),
};
