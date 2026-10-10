import { Capabilities } from "@open-erp/contracts/capabilities";
import { effectCapability } from "./shared";
import * as Owner from "../payroll/paid-recovery";

export const paidRecoveryCapabilities = {
  payroll_prepare_paid_recovery: effectCapability(
    Capabilities.payroll_prepare_paid_recovery,
    Owner.preparePaidRecovery,
  ),
  payroll_split_paid_recovery: effectCapability(
    Capabilities.payroll_split_paid_recovery,
    Owner.splitPaidRecovery,
  ),
  payroll_attach_paid_recovery: effectCapability(
    Capabilities.payroll_attach_paid_recovery,
    Owner.attachPaidRecovery,
  ),
  payroll_cancel_paid_recovery: effectCapability(
    Capabilities.payroll_cancel_paid_recovery,
    Owner.cancelPaidRecovery,
  ),
  payroll_get_paid_recovery: effectCapability(
    Capabilities.payroll_get_paid_recovery,
    Owner.getPaidRecovery,
  ),
  payroll_list_paid_recoveries: effectCapability(
    Capabilities.payroll_list_paid_recoveries,
    Owner.listPaidRecoveries,
  ),
};
